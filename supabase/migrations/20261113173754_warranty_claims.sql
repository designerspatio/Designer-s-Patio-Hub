-- Claims stay separate from revenue, commissions, sales orders and ordinary AP.
create table public.warranty_claims (
 id uuid primary key default gen_random_uuid(),
 claim_number bigint generated always as identity unique not null,
 version integer not null default 1,
 data jsonb not null,
 created_by uuid not null references public.profiles(id),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 synced_at timestamptz,
 synced_version integer,
 sync_error text,
 sync_lock_until timestamptz
);
alter table public.warranty_claims enable row level security;
revoke all on public.warranty_claims from anon,authenticated;
grant all on public.warranty_claims to service_role;
grant usage,select on sequence public.warranty_claims_claim_number_seq to service_role;
-- API verifies the current authenticated profile before calling this service-only
-- invoker function. Row update and stock return are one transaction.
create function public.dp_save_warranty_claim(p_id uuid,p_version integer,p_data jsonb,p_actor uuid,p_inventory_id uuid default null,p_quantity integer default null)
returns public.warranty_claims language plpgsql security invoker set search_path='' as $$
declare result public.warranty_claims; before_qty integer;
begin
 if not exists(select 1 from public.profiles where id=p_actor and active and role::text in ('Owner','Manager','Assistant Manager','Warranty Manager')) then raise exception 'Claims permission denied'; end if;
 if p_id is null then
  if p_inventory_id is not null then raise exception 'Save claim before returning merchandise'; end if;
  insert into public.warranty_claims(data,created_by) values(p_data,p_actor) returning * into result;
 else
  update public.warranty_claims set data=p_data,version=version+1,updated_at=now(),sync_error=null where id=p_id and version=p_version returning * into result;
  if not found then raise exception 'Claim changed on another device. Refresh before retrying.'; end if;
 end if;
 if p_inventory_id is not null then
  if p_quantity is null or p_quantity<1 then raise exception 'Return quantity must be positive'; end if;
  select quantity_on_hand into before_qty from public.inventory_items where id=p_inventory_id and active for update;
  if not found then raise exception 'Choose an active inventory item'; end if;
  update public.inventory_items set quantity_on_hand=quantity_on_hand+p_quantity,updated_at=now() where id=p_inventory_id;
  insert into public.inventory_movements(inventory_item_id,movement_type,quantity_change,quantity_before,quantity_after,reason,notes,created_by)
   values(p_inventory_id,'Received',p_quantity,before_qty,before_qty+p_quantity,'Warranty return to stock','claim:'||result.id::text,p_actor);
 end if;
 return result;
end $$;
revoke all on function public.dp_save_warranty_claim(uuid,integer,jsonb,uuid,uuid,integer) from public,anon,authenticated;
grant execute on function public.dp_save_warranty_claim(uuid,integer,jsonb,uuid,uuid,integer) to service_role;
