-- Sales order procurement and posting: one transactional source of truth.
ALTER TABLE public.purchase_order_items ADD COLUMN IF NOT EXISTS received_quantity integer NOT NULL DEFAULT 0;
ALTER TABLE public.purchase_order_items ADD COLUMN IF NOT EXISTS posted_quantity integer NOT NULL DEFAULT 0;
ALTER TABLE public.sales_order_items ADD COLUMN IF NOT EXISTS posted_out_quantity integer NOT NULL DEFAULT 0;
ALTER TABLE public.sales_order_items ADD COLUMN IF NOT EXISTS last_posted_out_at timestamptz;
ALTER TABLE public.purchase_order_items
  ADD CONSTRAINT dp_po_quantities_check CHECK
  (received_quantity>=0 AND posted_quantity>=0 AND posted_quantity<=received_quantity AND received_quantity<=quantity);
ALTER TABLE public.sales_order_items
  ADD CONSTRAINT dp_sale_posted_quantity_check CHECK
  (posted_out_quantity>=0 AND posted_out_quantity<=quantity);

-- Manual full PO receipt is handled by the same receipt quantities used by posting.
ALTER TABLE public.purchase_orders DROP CONSTRAINT IF EXISTS purchase_orders_status_check;
ALTER TABLE public.purchase_orders ADD CONSTRAINT purchase_orders_status_check
  CHECK (status IN ('Draft','Submitted','Acknowledged','In Production','Ready to Ship',
    'Shipped','Partially Received','Received','Closed'));

CREATE OR REPLACE FUNCTION public.dp_purchase_order_sets_sale_on_order()
RETURNS trigger LANGUAGE plpgsql SET search_path='public' AS $$
BEGIN
 IF NEW.sales_order_id IS NOT NULL THEN
   UPDATE public.sales_orders SET status='On Order',updated_at=now()
     WHERE id=NEW.sales_order_id AND status='Open';
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS dp_purchase_order_sets_sale_on_order ON public.purchase_orders;
CREATE TRIGGER dp_purchase_order_sets_sale_on_order
AFTER INSERT ON public.purchase_orders FOR EACH ROW
EXECUTE FUNCTION public.dp_purchase_order_sets_sale_on_order();

CREATE OR REPLACE FUNCTION public.dp_full_receive_po_on_status()
RETURNS trigger LANGUAGE plpgsql SET search_path='public' AS $$
BEGIN
 IF NEW.status='Received' AND OLD.status IS DISTINCT FROM 'Received' THEN
   UPDATE public.purchase_order_items SET received_quantity=quantity,updated_at=now()
     WHERE purchase_order_id=NEW.id AND received_quantity<quantity;
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS dp_full_receive_po_on_status ON public.purchase_orders;
CREATE TRIGGER dp_full_receive_po_on_status AFTER UPDATE OF status ON public.purchase_orders
FOR EACH ROW EXECUTE FUNCTION public.dp_full_receive_po_on_status();

CREATE OR REPLACE FUNCTION public.dp_receive_po_line(
  p_purchase_order_item_id uuid, p_quantity integer)
RETURNS jsonb LANGUAGE plpgsql SET search_path='public' AS $$
DECLARE
  v_po_id uuid;
  v_after integer;
  v_total integer;
  v_completed integer;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in to receive purchase orders'; END IF;
 IF p_quantity IS NULL OR p_quantity<=0 THEN RAISE EXCEPTION 'Receiving quantity must be positive'; END IF;
 SELECT purchase_order_id INTO v_po_id FROM public.purchase_order_items WHERE id=p_purchase_order_item_id FOR UPDATE;
 IF v_po_id IS NULL THEN RAISE EXCEPTION 'Purchase order line not found'; END IF;
 UPDATE public.purchase_order_items SET received_quantity=received_quantity+p_quantity,
       updated_at=now()
   WHERE id=p_purchase_order_item_id AND received_quantity+p_quantity<=quantity
 RETURNING received_quantity INTO v_after;
 IF NOT FOUND THEN RAISE EXCEPTION 'Receiving quantity exceeds outstanding quantity'; END IF;
 SELECT count(*),count(*) FILTER (WHERE received_quantity>=quantity)
 INTO v_total,v_completed FROM public.purchase_order_items
 WHERE purchase_order_id=v_po_id AND sales_order_item_id IS NOT NULL;
 IF v_total>0 THEN
   UPDATE public.purchase_orders
      SET status=CASE WHEN v_completed=v_total THEN 'Received' ELSE 'Partially Received' END,updated_at=now()
    WHERE id=v_po_id AND status NOT IN ('Closed');
 END IF;
 RETURN jsonb_build_object('purchase_order_item_id',p_purchase_order_item_id,'received_quantity',v_after);
END $$;

CREATE OR REPLACE FUNCTION public.dp_post_out_sale_item(
 p_sales_order_item_id uuid, p_quantity integer DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SET search_path='public' AS $$
DECLARE
  v_order_id uuid;
  v_quantity integer;
  v_posted integer;
  v_sku text;
  v_method text;
  v_needed integer;
  v_ready integer;
  v_take integer;
  v_po record;
  v_missing integer;
  v_status text;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in to post sales orders'; END IF;
 SELECT sales_order_id INTO v_order_id FROM public.sales_order_items WHERE id=p_sales_order_item_id;
 IF v_order_id IS NULL THEN RAISE EXCEPTION 'Sales order line not found'; END IF;
 -- Serialize all post-outs on the same sales order, including separate lines.
 PERFORM 1 FROM public.sales_orders WHERE id=v_order_id FOR UPDATE;
 SELECT quantity,posted_out_quantity,sku,fulfillment_method INTO v_quantity,v_posted,v_sku,v_method
 FROM public.sales_order_items WHERE id=p_sales_order_item_id AND sales_order_id=v_order_id FOR UPDATE;
 IF v_sku LIKE '__DP_TARIFF__%' OR v_sku LIKE '__DP_SURCHARGE__%' THEN
   RAISE EXCEPTION 'Automatic charge lines do not post out'; END IF;
 v_needed:=COALESCE(p_quantity,v_quantity-v_posted);
 IF v_needed<=0 OR v_needed>v_quantity-v_posted THEN
   RAISE EXCEPTION 'Posted quantity must be within the remaining unposted quantity';
 END IF;
 IF v_method='Special Order' THEN
   SELECT COALESCE(sum(received_quantity-posted_quantity),0) INTO v_ready
     FROM public.purchase_order_items WHERE sales_order_item_id=p_sales_order_item_id;
   IF v_ready<v_needed THEN
     RAISE EXCEPTION 'Only % received, unposted unit(s) available to post out',v_ready;
   END IF;
   FOR v_po IN SELECT id,received_quantity-posted_quantity AS available
     FROM public.purchase_order_items WHERE sales_order_item_id=p_sales_order_item_id
       AND received_quantity>posted_quantity ORDER BY id FOR UPDATE
   LOOP
     EXIT WHEN v_needed=0;
     v_take:=LEAST(v_needed,v_po.available);
     UPDATE public.purchase_order_items SET posted_quantity=posted_quantity+v_take,updated_at=now()
       WHERE id=v_po.id;
     v_needed:=v_needed-v_take;
   END LOOP;
 END IF;
 UPDATE public.sales_order_items SET posted_out_quantity=posted_out_quantity+COALESCE(p_quantity,v_quantity-v_posted),
   last_posted_out_at=now(),updated_at=now() WHERE id=p_sales_order_item_id;
 SELECT count(*) INTO v_missing FROM public.sales_order_items
  WHERE sales_order_id=v_order_id AND (sku IS NULL OR sku !~ '^__DP_(TARIFF|SURCHARGE)__')
  AND posted_out_quantity<quantity;
 v_status:=CASE WHEN v_missing=0 THEN 'Closed' ELSE 'Shipped' END;
 UPDATE public.sales_orders SET status=v_status,updated_at=now() WHERE id=v_order_id;
 RETURN jsonb_build_object('sales_order_item_id',p_sales_order_item_id,'status',v_status);
END $$;
REVOKE ALL ON FUNCTION public.dp_receive_po_line(uuid,integer) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.dp_post_out_sale_item(uuid,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.dp_receive_po_line(uuid,integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dp_post_out_sale_item(uuid,integer) TO authenticated;
