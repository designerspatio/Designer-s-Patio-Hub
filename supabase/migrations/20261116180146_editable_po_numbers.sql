-- Reserve a new claim range without renumbering existing documents.
do $$
declare next_number bigint;
begin
 select greatest(72000,coalesce(max(claim_number)+1,72000)) into next_number from public.warranty_claims;
 perform setval('public.warranty_claims_claim_number_seq',next_number,false);
end $$;

-- Trigger needs access to both tables, including claims hidden from ordinary
-- authenticated clients. It only checks collisions and never returns claim data.
create or replace function public.dp_check_open_po_number()
returns trigger language plpgsql security definer set search_path='' as $$
declare number_key text; is_open boolean;
begin
 if auth.role() is distinct from 'service_role' and auth.uid() is not null
 and not exists(select 1 from public.profiles where id=auth.uid() and active) then
  raise exception 'An active Hub profile is required' using errcode='42501';
 end if;
 if tg_table_name='purchase_orders' then
  number_key=upper(trim(new.po_number::text));
  is_open=new.status::text not in ('Closed','Cancelled','Canceled');
 else
  number_key=upper(trim(new.data #>> '{po,number}'));
  is_open=new.data->'po' is not null and new.data->'po'<>'null'::jsonb
   and coalesce(new.data #>> '{po,closedAt}','')=''
   and coalesce(new.data->>'status','') not in ('Closed','Denied');
 end if;
 if not is_open or number_key is null or number_key='' then return new; end if;
 -- AUTO is replaced in the same transaction by the claim save RPC.
 if number_key='CPO-AUTO' then return new; end if;
 perform pg_advisory_xact_lock(hashtextextended('dp-open-po:'||number_key,0));
 if exists(select 1 from public.purchase_orders p where upper(trim(p.po_number::text))=number_key
  and p.status::text not in ('Closed','Cancelled','Canceled')
  and (tg_table_name<>'purchase_orders' or p.id<>new.id))
 or exists(select 1 from public.warranty_claims c where upper(trim(c.data #>> '{po,number}'))=number_key
  and coalesce(c.data #>> '{po,closedAt}','')=''
  and coalesce(c.data->>'status','') not in ('Closed','Denied')
  and (tg_table_name<>'warranty_claims' or c.id<>new.id)) then
  raise exception 'PO number % is already used by another open purchase order.',number_key using errcode='23505';
 end if;
 return new;
end $$;
revoke all on function public.dp_check_open_po_number() from public,anon,authenticated;
create trigger dp_check_open_po_number before insert or update of po_number,status on public.purchase_orders
 for each row execute function public.dp_check_open_po_number();
create trigger dp_check_open_claim_po_number before insert or update of data on public.warranty_claims
 for each row execute function public.dp_check_open_po_number();

-- Preserve the existing atomic save, permissions and concurrency checks.
do $$
declare definition text;
begin
 select pg_get_functiondef('public.dp_save_purchase_order_details(uuid,timestamptz,jsonb,jsonb)'::regprocedure) into definition;
 if position('po_number=coalesce' in definition)=0 then
 definition=replace(definition,'status=p_header->>''status'',order_date=',
 'po_number=coalesce(nullif(trim(p_header->>''po_number''),'''')::bigint,po.po_number),status=p_header->>''status'',order_date=');
 execute definition;
 end if;
end $$;
