-- Saving vendor changes is atomic and does not depend on extraction/comparison.
create or replace function public.dp_save_acknowledgement_review(
 p_ack_id uuid,p_expected_ack_updated_at timestamptz,p_expected_po_updated_at timestamptz,p_review jsonb
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare ack public.purchase_order_acknowledgements; po public.purchase_orders; header jsonb;
begin
 if auth.uid() is null or not exists(select 1 from public.profiles where id=auth.uid() and active) then
  raise exception 'An active Hub profile is required' using errcode='42501';
 end if;
 select * into ack from public.purchase_order_acknowledgements where id=p_ack_id;
 if not found then raise exception 'Acknowledgement not found'; end if;
 -- Same lock order as the main PO save: PO, then detail records.
 select * into po from public.purchase_orders where id=ack.purchase_order_id for update;
 select * into ack from public.purchase_order_acknowledgements where id=p_ack_id for update;
 if ack.updated_at is distinct from p_expected_ack_updated_at then
  raise exception 'This acknowledgement changed. Reopen it before saving.' using errcode='40001';
 end if;
 if jsonb_typeof(p_review->'lines') is distinct from 'array' then raise exception 'Acknowledgement lines are required'; end if;
 if exists(select 1 from jsonb_array_elements(p_review->'lines') l where (l->>'quantity')::numeric is not null and ((l->>'quantity')::numeric<1 or (l->>'quantity')::numeric<>trunc((l->>'quantity')::numeric))) then raise exception 'Quantities must be positive whole numbers'; end if;
 header=to_jsonb(po)||jsonb_build_object(
  'status',case when po.status in ('Draft','Submitted') then 'Acknowledged' else po.status end,
  'acknowledgement_number',nullif(trim(p_review->>'acknowledgement_number'),''),
  'acknowledgement_date',coalesce(nullif(p_review->>'acknowledgement_date','')::date,po.acknowledgement_date,current_date),
  'estimated_ship_date',nullif(p_review->>'expected_ship_date','')::date,
  'freight_amount',coalesce((p_review->>'freight_amount')::numeric,po.freight_amount));
 po:=public.dp_save_purchase_order_details(po.id,p_expected_po_updated_at,header,p_review->'cost_updates');
 update public.purchase_order_acknowledgements set
  vendor_name_detected=nullif(trim(p_review->>'vendor_name'),''),
  po_number_detected=nullif(trim(p_review->>'po_number'),''),
  expected_ship_date=nullif(p_review->>'expected_ship_date','')::date,
  comparison_status='Pending',comparison_summary='Manually saved. Comparison is optional.',
  comparison_details=coalesce(comparison_details,'{}'::jsonb)||jsonb_build_object(
   'vendor_name',p_review->>'vendor_name','po_number',p_review->>'po_number',
   'freight_amount',p_review->'freight_amount','lines',p_review->'lines',
   'manual_saved_at',clock_timestamp(),'manual_saved_by',auth.uid()),updated_at=clock_timestamp()
 where id=p_ack_id returning * into ack;
 -- Prior discrepancy flags describe old captured values.
 delete from public.purchase_order_acknowledgement_issues where acknowledgement_id=p_ack_id;
 -- Ship-date synchronization triggers may also update the PO revision.
 select * into po from public.purchase_orders where id=po.id;
 return jsonb_build_object('acknowledgement',to_jsonb(ack),'purchase_order',to_jsonb(po),
  'items',(select coalesce(jsonb_agg(to_jsonb(i) order by i.sort_order),'[]'::jsonb) from public.purchase_order_items i where i.purchase_order_id=po.id));
end $$;
