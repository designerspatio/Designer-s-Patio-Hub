-- Atomic move: invoker permissions and existing RLS remain in force.
create or replace function public.dp_split_quote(
 p_quote_id uuid, p_item_ids uuid[], p_updated_at timestamptz,
 p_expected_items jsonb, p_remaining jsonb, p_moved jsonb
) returns public.quotes language plpgsql security invoker set search_path = '' as $$
declare
 source public.quotes%rowtype;
 created public.quotes%rowtype;
 actual jsonb;
 expected jsonb;
 product_count integer;
 selected_count integer;
 target_id uuid;
 payload jsonb;
 charge jsonb;
 line public.quote_items%rowtype;
begin
 if not exists(select 1 from public.profiles where id=auth.uid() and active is true) then
   raise exception 'An active staff account is required' using errcode='42501';
 end if;
 select * into strict source from public.quotes where id=p_quote_id for update;
 if source.approved or source.converted_sales_order_id is not null or source.status in ('Archived','Converted','Cancelled','Canceled') or exists(select 1 from public.sales_orders where source_quote_id=p_quote_id) then
   raise exception 'Only unapproved, open quotes can be split';
 end if;
 if source.updated_at is distinct from p_updated_at then raise exception 'Quote changed. Reopen it before splitting.'; end if;
 perform 1 from public.quote_items where quote_id=p_quote_id for update;
 select jsonb_agg(to_jsonb(i) order by i.id) into actual from public.quote_items i where quote_id=p_quote_id;
 select jsonb_agg(to_jsonb(i) order by i.id) into expected from jsonb_populate_recordset(null::public.quote_items,p_expected_items) i;
 if actual is distinct from expected then raise exception 'Quote items changed. Reopen it before splitting.'; end if;
 select count(*) into product_count from public.quote_items where quote_id=p_quote_id and coalesce(sku,'') !~ '^__DP_(TARIFF|SURCHARGE)__';
 select count(*) into selected_count from public.quote_items where quote_id=p_quote_id and id=any(p_item_ids) and coalesce(sku,'') !~ '^__DP_(TARIFF|SURCHARGE)__';
 if selected_count=0 or selected_count>=product_count or selected_count<>cardinality(p_item_ids) then
   raise exception 'Select product rows and leave at least one on the original quote';
 end if;
 if p_remaining->>'notes' is distinct from coalesce(source.notes,'') then raise exception 'Original notes must be preserved'; end if;
 insert into public.quotes(client_id,salesperson_user_id,status,quote_date,expiration_date,customer_po,notes,freight_amount,adjustment_amount,
 ship_to_name,ship_to_contact,ship_to_phone,ship_to_address,ship_to_city,ship_to_state,ship_to_zip,delivery_notes)
 values(source.client_id,source.salesperson_user_id,'Draft',(now() at time zone 'America/Chicago')::date,source.expiration_date,source.customer_po,
 p_moved->>'notes',0,(p_moved->>'adjustment_amount')::numeric,source.ship_to_name,source.ship_to_contact,source.ship_to_phone,source.ship_to_address,
 source.ship_to_city,source.ship_to_state,source.ship_to_zip,source.delivery_notes) returning * into created;
 update public.quote_items set quote_id=created.id,updated_at=now() where quote_id=p_quote_id and id=any(p_item_ids);
 -- Rebuild only generated tariff/surcharge rows; product identity and snapshots survive.
 delete from public.quote_items where quote_id=p_quote_id and coalesce(sku,'') ~ '^__DP_(TARIFF|SURCHARGE)__';
 foreach target_id in array array[p_quote_id,created.id] loop
   payload:=case when target_id=p_quote_id then p_remaining else p_moved end;
   for charge in select value from jsonb_array_elements(payload->'charges') loop
     if coalesce(charge->>'sku','') !~ '^__DP_(TARIFF|SURCHARGE)__' then raise exception 'Invalid manufacturer charge'; end if;
     line:=jsonb_populate_record(null::public.quote_items,charge || jsonb_build_object('id',gen_random_uuid(),'quote_id',target_id,'inventory_item_id',null,'created_at',now(),'updated_at',now()));
     insert into public.quote_items select (line).*;
   end loop;
 end loop;
 update public.quotes set status='Draft',adjustment_amount=(p_remaining->>'adjustment_amount')::numeric,updated_at=now() where id=p_quote_id;
 return created;
end;
$$;
revoke all on function public.dp_split_quote(uuid,uuid[],timestamptz,jsonb,jsonb,jsonb) from public,anon;
grant execute on function public.dp_split_quote(uuid,uuid[],timestamptz,jsonb,jsonb,jsonb) to authenticated;
