alter table public.quote_items
  add column item_type text not null default 'Special Order' check (item_type in ('Special Order','Stock Item','COM Fabric')),
  add column com_ship_to jsonb;
alter table public.sales_order_items
  add column item_type text not null default 'Special Order' check (item_type in ('Special Order','Stock Item','COM Fabric')),
  add column com_ship_to jsonb;
alter table public.purchase_orders
  add column com_manufacturer_id uuid references public.manufacturers(id);
update public.quote_items set item_type='Stock Item' where inventory_item_id is not null;
update public.sales_order_items set item_type='Stock Item' where inventory_item_id is not null;
notify pgrst, 'reload schema';
