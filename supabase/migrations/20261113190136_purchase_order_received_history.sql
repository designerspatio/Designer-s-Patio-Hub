-- Serialize receiving on the PO before touching individual lines. Financial
-- tariff/surcharge lines do not represent physical merchandise to receive.
create or replace function public.dp_receive_po_line(p_purchase_order_item_id uuid,p_quantity integer)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare po_id uuid; after_qty integer; total integer; completed integer; po public.purchase_orders;
begin
 if auth.uid() is null or not exists(select 1 from public.profiles where id=auth.uid() and active) then
  raise exception 'An active Hub account is required' using errcode='42501';
 end if;
 if p_quantity is null or p_quantity<=0 then raise exception 'Receiving quantity must be positive'; end if;
 select purchase_order_id into po_id from public.purchase_order_items where id=p_purchase_order_item_id;
 if po_id is null then raise exception 'Purchase order line not found'; end if;
 select * into po from public.purchase_orders where id=po_id for update;
 if not found then raise exception 'Purchase order not found'; end if;
 update public.purchase_order_items set received_quantity=received_quantity+p_quantity,updated_at=clock_timestamp()
 where id=p_purchase_order_item_id and purchase_order_id=po_id and received_quantity+p_quantity<=quantity
 returning received_quantity into after_qty;
 if not found then raise exception 'Receiving quantity exceeds outstanding quantity'; end if;
 select count(*),count(*) filter(where received_quantity>=quantity) into total,completed
 from public.purchase_order_items where purchase_order_id=po_id and quantity>0
 and coalesce(sku,'') !~ '^__DP_(TARIFF|SURCHARGE)__';
 if total>0 then
  update public.purchase_orders set status=case when completed=total then 'Received' else 'Partially Received' end,updated_at=clock_timestamp()
  where id=po_id and status<>'Closed';
 end if;
 select * into po from public.purchase_orders where id=po_id;
 return jsonb_build_object('purchase_order_item_id',p_purchase_order_item_id,'received_quantity',after_qty,
  'purchase_order',to_jsonb(po),'items',(select coalesce(jsonb_agg(to_jsonb(i) order by i.sort_order),'[]'::jsonb) from public.purchase_order_items i where i.purchase_order_id=po_id));
end $$;
revoke all on function public.dp_receive_po_line(uuid,integer) from public,anon;
grant execute on function public.dp_receive_po_line(uuid,integer) to authenticated;

-- Normalize previously completed merchandise POs without moving incomplete ones.
update public.purchase_orders p set status='Received',updated_at=clock_timestamp()
where p.status not in ('Received','Closed')
 and exists(select 1 from public.purchase_order_items i where i.purchase_order_id=p.id and i.quantity>0 and coalesce(i.sku,'') !~ '^__DP_(TARIFF|SURCHARGE)__')
 and not exists(select 1 from public.purchase_order_items i where i.purchase_order_id=p.id and i.quantity>0 and coalesce(i.sku,'') !~ '^__DP_(TARIFF|SURCHARGE)__' and i.received_quantity<i.quantity);
