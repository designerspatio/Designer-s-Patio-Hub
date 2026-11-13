-- Partially received POs stay active and remain editable.
create or replace function public.dp_save_purchase_order_details(
 p_id uuid,p_expected_updated_at timestamptz,p_header jsonb,p_items jsonb
) returns public.purchase_orders language plpgsql security invoker set search_path='' as $$
declare po public.purchase_orders; entry jsonb; item public.purchase_order_items; cost numeric; freight numeric;
begin
 if auth.uid() is null or not exists(select 1 from public.profiles where id=auth.uid() and active) then
  raise exception 'An active Hub profile is required' using errcode='42501';
 end if;
 select * into po from public.purchase_orders where id=p_id for update;
 if not found then raise exception 'Purchase order not found'; end if;
 if po.updated_at is distinct from p_expected_updated_at then
  raise exception 'This PO changed on another device. Reopen it before saving.' using errcode='40001';
 end if;
 if p_header->>'status' not in ('Draft','Submitted','Acknowledged','In Production','Ready to Ship','Shipped','Partially Received','Received','Closed') or p_header->>'status' is null then
  raise exception 'Choose a valid PO status';
 end if;
 freight=(p_header->>'freight_amount')::numeric;
 if freight is null or freight<0 or freight>100000000 or freight::text in ('NaN','Infinity','-Infinity') then raise exception 'Enter valid non-negative freight'; end if;
 if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items)<>(select count(*) from public.purchase_order_items where purchase_order_id=p_id) then
  raise exception 'PO items changed. Reopen this purchase order.';
 end if;
 if (select count(distinct e->>'id') from jsonb_array_elements(p_items) e)<>jsonb_array_length(p_items) then raise exception 'Duplicate PO items'; end if;
 -- Lock and validate every line before changing either the header or costs.
 for entry in select value from jsonb_array_elements(p_items) loop
  select * into item from public.purchase_order_items where id=(entry->>'id')::uuid and purchase_order_id=p_id for update;
  if not found then raise exception 'An item does not belong to this PO'; end if;
  if item.acknowledged_unit_cost is distinct from (entry->>'expected_acknowledged_unit_cost')::numeric
   or item.unit_cost is distinct from (entry->>'expected_unit_cost')::numeric then
   raise exception 'PO pricing changed. Reopen this purchase order.' using errcode='40001';
  end if;
  cost=nullif(entry->>'acknowledged_unit_cost','')::numeric;
  if cost is not null and (cost<0 or cost>100000000 or cost::text in ('NaN','Infinity','-Infinity')) then raise exception 'Enter a valid non-negative unit cost'; end if;
 end loop;
 update public.purchase_orders set
  status=p_header->>'status',order_date=(p_header->>'order_date')::date,
  acknowledgement_number=nullif(trim(p_header->>'acknowledgement_number'),''),
  acknowledgement_date=nullif(p_header->>'acknowledgement_date','')::date,
  estimated_ship_date=nullif(p_header->>'estimated_ship_date','')::date,
  actual_ship_date=nullif(p_header->>'actual_ship_date','')::date,
  carrier=nullif(trim(p_header->>'carrier'),''),tracking_number=nullif(trim(p_header->>'tracking_number'),''),
  freight_amount=freight,notes=nullif(trim(p_header->>'notes'),''),
  ship_to_name=nullif(trim(p_header->>'ship_to_name'),''),ship_to_contact=nullif(trim(p_header->>'ship_to_contact'),''),
  ship_to_phone=nullif(trim(p_header->>'ship_to_phone'),''),ship_to_address=nullif(trim(p_header->>'ship_to_address'),''),
  ship_to_city=nullif(trim(p_header->>'ship_to_city'),''),ship_to_state=nullif(trim(p_header->>'ship_to_state'),''),
  ship_to_zip=nullif(trim(p_header->>'ship_to_zip'),''),delivery_notes=nullif(trim(p_header->>'delivery_notes'),''),updated_at=clock_timestamp()
 where id=p_id;
 for entry in select value from jsonb_array_elements(p_items) loop
  update public.purchase_order_items set acknowledged_unit_cost=nullif(entry->>'acknowledged_unit_cost','')::numeric,updated_at=now()
  where id=(entry->>'id')::uuid and purchase_order_id=p_id;
 end loop;
 select * into po from public.purchase_orders where id=p_id;
 return po;
end $$;
