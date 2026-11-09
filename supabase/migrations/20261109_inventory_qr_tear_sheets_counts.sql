
-- Public-facing fields are intentionally separate from staff-only inventory fields.
alter table public.inventory_items
 add column if not exists image_url text,
 add column if not exists dimensions text,
 add column if not exists internal_notes text;

create table if not exists public.inventory_counts (
 id uuid primary key default gen_random_uuid(),
 name text not null,
 location_filter text,
 status text not null default 'In Progress' check (status in ('In Progress','Finalized')),
 started_at timestamptz not null default now(),
 started_by uuid not null references public.profiles(id),
 finalized_at timestamptz,
 finalized_by uuid references public.profiles(id)
);

create table if not exists public.inventory_count_lines (
 id uuid primary key default gen_random_uuid(),
 count_id uuid not null references public.inventory_counts(id) on delete cascade,
 inventory_item_id uuid not null references public.inventory_items(id),
 item_name_snapshot text not null,
 sku_snapshot text,
 location_snapshot text,
 expected_qty integer not null check (expected_qty>=0),
 counted_qty integer not null default 0 check (counted_qty>=0),
 last_scanned_at timestamptz,
 unique(count_id,inventory_item_id)
);
create index if not exists idx_inventory_count_lines_count on public.inventory_count_lines(count_id);

create table if not exists public.inventory_count_events (
 id uuid primary key default gen_random_uuid(),
 count_id uuid not null references public.inventory_counts(id) on delete cascade,
 inventory_item_id uuid not null references public.inventory_items(id),
 quantity_delta integer not null,
 event_type text not null check (event_type in ('Scan','Manual')),
 recorded_by uuid not null references public.profiles(id),
 recorded_at timestamptz not null default now()
);

alter table public.inventory_counts enable row level security;
alter table public.inventory_count_lines enable row level security;
alter table public.inventory_count_events enable row level security;
revoke all on public.inventory_counts,public.inventory_count_lines,public.inventory_count_events from anon;
grant select on public.inventory_counts,public.inventory_count_lines,public.inventory_count_events to authenticated;

drop policy if exists dp_inventory_counts_read on public.inventory_counts;
create policy dp_inventory_counts_read on public.inventory_counts for select to authenticated
using (exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.active=true));
drop policy if exists dp_inventory_count_lines_read on public.inventory_count_lines;
create policy dp_inventory_count_lines_read on public.inventory_count_lines for select to authenticated
using (exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.active=true));
drop policy if exists dp_inventory_count_events_read on public.inventory_count_events;
create policy dp_inventory_count_events_read on public.inventory_count_events for select to authenticated
using (exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.active=true));

create or replace function public.dp_start_inventory_count(p_name text,p_location text default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid;
begin
 if (select auth.uid()) is null or not exists(
 select 1 from public.profiles where id=(select auth.uid()) and active=true)
 then raise exception 'Active staff account required' using errcode='42501'; end if;
 if length(trim(coalesce(p_name,'')))<2 then raise exception 'Name this count'; end if;
 insert into public.inventory_counts(name,location_filter,started_by)
 values(trim(p_name),nullif(trim(coalesce(p_location,'')),''),auth.uid()) returning id into v_id;
 insert into public.inventory_count_lines(count_id,inventory_item_id,item_name_snapshot,sku_snapshot,location_snapshot,expected_qty)
 select v_id,id,name,sku,location,quantity_on_hand from public.inventory_items
 where active=true and (nullif(trim(coalesce(p_location,'')),'') is null
 or lower(trim(coalesce(location,'')))=lower(trim(p_location)));
 return v_id;
end $$;

create or replace function public.dp_record_inventory_scan(p_count_id uuid,p_item_id uuid,p_delta integer default 1)
returns integer language plpgsql security definer set search_path='' as $$
declare v_count public.inventory_counts%rowtype; v_total integer;
begin
 if (select auth.uid()) is null or not exists(
 select 1 from public.profiles where id=(select auth.uid()) and active=true)
 then raise exception 'Active staff account required' using errcode='42501'; end if;
 if p_delta not in (-1,1) then raise exception 'Scan increment must be +1 or -1'; end if;
 select * into v_count from public.inventory_counts where id=p_count_id for update;
 if not found or v_count.status<>'In Progress' then raise exception 'Count is closed or missing'; end if;
 update public.inventory_count_lines
 set counted_qty=counted_qty+p_delta,last_scanned_at=now()
 where count_id=p_count_id and inventory_item_id=p_item_id and counted_qty+p_delta>=0
 returning counted_qty into v_total;
 if not found then raise exception 'Item is outside this count, or cannot subtract below zero'; end if;
 insert into public.inventory_count_events(count_id,inventory_item_id,quantity_delta,event_type,recorded_by)
 values(p_count_id,p_item_id,p_delta,'Scan',auth.uid());
 return v_total;
end $$;

create or replace function public.dp_set_inventory_count_quantity(p_count_id uuid,p_item_id uuid,p_quantity integer)
returns void language plpgsql security definer set search_path='' as $$
declare v_status text; v_before integer;
begin
 if (select auth.uid()) is null or not exists(
 select 1 from public.profiles where id=(select auth.uid()) and active=true)
 then raise exception 'Active staff account required' using errcode='42501'; end if;
 if p_quantity is null or p_quantity<0 or p_quantity>1000000
 then raise exception 'Invalid quantity'; end if;
 select status into v_status from public.inventory_counts where id=p_count_id for update;
 if v_status is distinct from 'In Progress' then raise exception 'Count is closed or missing'; end if;
 select counted_qty into v_before from public.inventory_count_lines
 where count_id=p_count_id and inventory_item_id=p_item_id for update;
 if not found then raise exception 'Item is not in this count'; end if;
 update public.inventory_count_lines set counted_qty=p_quantity,last_scanned_at=now()
 where count_id=p_count_id and inventory_item_id=p_item_id;
 insert into public.inventory_count_events(count_id,inventory_item_id,quantity_delta,event_type,recorded_by)
 values(p_count_id,p_item_id,p_quantity-v_before,'Manual',auth.uid());
end $$;

create or replace function public.dp_finalize_inventory_count(p_count_id uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
 if (select auth.uid()) is null or not exists(
 select 1 from public.profiles where id=(select auth.uid()) and active=true)
 then raise exception 'Active staff account required' using errcode='42501'; end if;
 update public.inventory_counts set status='Finalized',finalized_at=now(),finalized_by=auth.uid()
 where id=p_count_id and status='In Progress';
 if not found then raise exception 'Count already finalized or not found'; end if;
end $$;

revoke all on function public.dp_start_inventory_count(text,text),
 public.dp_record_inventory_scan(uuid,uuid,integer),
 public.dp_set_inventory_count_quantity(uuid,uuid,integer),
 public.dp_finalize_inventory_count(uuid) from public,anon;
grant execute on function public.dp_start_inventory_count(text,text),
 public.dp_record_inventory_scan(uuid,uuid,integer),
 public.dp_set_inventory_count_quantity(uuid,uuid,integer),
 public.dp_finalize_inventory_count(uuid) to authenticated;

-- The public tear-sheet endpoint returns only public merchandising fields.
create or replace function public.dp_public_inventory_tear_sheet(p_item_id uuid)
returns table(item_id uuid,item_name text,item_sku text,item_dimensions text,item_image_url text)
language sql stable security definer set search_path='' as $$
 select id,name,sku,dimensions,image_url from public.inventory_items
 where id=p_item_id and active=true
$$;
revoke all on function public.dp_public_inventory_tear_sheet(uuid) from public;
grant execute on function public.dp_public_inventory_tear_sheet(uuid) to anon,authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('inventory-images','inventory-images',true,10485760,array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;

drop policy if exists dp_inventory_images_upload on storage.objects;
create policy dp_inventory_images_upload on storage.objects
for insert to authenticated
with check (bucket_id='inventory-images' and (storage.extension(name) in ('jpg','jpeg','png','webp')));
drop policy if exists dp_inventory_images_read on storage.objects;
create policy dp_inventory_images_read on storage.objects
for select to authenticated using (bucket_id='inventory-images');
