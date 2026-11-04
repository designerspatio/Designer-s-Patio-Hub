-- Designer's Patio: inventory condition flags and atomic SO reservations.
-- Apply to Supabase BEFORE deploying the app changes.
ALTER TABLE public.inventory_items
  ADD COLUMN IF NOT EXISTS quantity_damaged integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS quantity_nailed_down integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS quantity_reserved integer NOT NULL DEFAULT 0;
ALTER TABLE public.quote_items
  ADD COLUMN IF NOT EXISTS inventory_item_id uuid REFERENCES public.inventory_items(id);
ALTER TABLE public.sales_order_items
  ADD COLUMN IF NOT EXISTS inventory_fulfilled_at timestamptz;
ALTER TABLE public.inventory_items
  ADD CONSTRAINT inventory_quantities_sellable_check
  CHECK (quantity_on_hand >= 0 AND quantity_damaged >= 0 AND quantity_nailed_down >= 0
    AND quantity_reserved >= 0 AND quantity_damaged + quantity_nailed_down + quantity_reserved <= quantity_on_hand);
CREATE INDEX IF NOT EXISTS idx_quote_items_inventory ON public.quote_items(inventory_item_id);
CREATE INDEX IF NOT EXISTS idx_sale_items_inventory ON public.sales_order_items(inventory_item_id)
  WHERE inventory_item_id IS NOT NULL;

-- Persisted computed quantity in inventory_items is authoritative and maintained
-- in the same transaction as SO line inserts/edits/deletes, using row locks.
CREATE OR REPLACE FUNCTION public.dp_inventory_reservation_change()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE old_units integer := 0; new_units integer := 0; row_data record;
BEGIN
  IF TG_OP IN ('UPDATE','DELETE') AND OLD.fulfillment_method = 'Inventory'
     AND OLD.inventory_item_id IS NOT NULL AND OLD.inventory_fulfilled_at IS NULL THEN
    old_units := OLD.quantity;
  END IF;
  IF TG_OP IN ('UPDATE','INSERT') AND NEW.fulfillment_method = 'Inventory'
     AND NEW.inventory_item_id IS NOT NULL AND NEW.inventory_fulfilled_at IS NULL THEN
    new_units := NEW.quantity;
  END IF;

  -- Lock both SKUs in ID order. Avoid deadlocks if an order swaps inventory lines.
  FOR row_data IN
    SELECT i.id, i.quantity_on_hand, i.quantity_damaged, i.quantity_nailed_down, i.quantity_reserved, i.active
    FROM public.inventory_items i
    WHERE i.id IN (
      CASE WHEN TG_OP IN ('UPDATE','DELETE') THEN OLD.inventory_item_id ELSE NULL END,
      CASE WHEN TG_OP IN ('UPDATE','INSERT') THEN NEW.inventory_item_id ELSE NULL END)
    ORDER BY i.id FOR UPDATE
  LOOP
    IF TG_OP IN ('UPDATE','DELETE') AND row_data.id = OLD.inventory_item_id THEN
      UPDATE public.inventory_items SET quantity_reserved=quantity_reserved-old_units,
        updated_at=now() WHERE id=row_data.id;
    END IF;
    IF TG_OP IN ('UPDATE','INSERT') AND row_data.id = NEW.inventory_item_id THEN
      UPDATE public.inventory_items SET quantity_reserved=quantity_reserved+new_units,
        updated_at=now() WHERE id=row_data.id;
    END IF;
  END LOOP;
  RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;

DROP TRIGGER IF EXISTS dp_inventory_reservation_change ON public.sales_order_items;
CREATE TRIGGER dp_inventory_reservation_change
AFTER INSERT OR UPDATE OF quantity,fulfillment_method,inventory_item_id,inventory_fulfilled_at OR DELETE
ON public.sales_order_items FOR EACH ROW EXECUTE FUNCTION public.dp_inventory_reservation_change();

-- The check above enforces both quantity and item condition on every reservation,
-- including two orders saved concurrently; inactive items are rejected as well.
CREATE OR REPLACE FUNCTION public.dp_validate_inventory_sale_line()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE row_data record;
BEGIN
 IF NEW.fulfillment_method='Inventory' THEN
   IF NEW.inventory_item_id IS NULL THEN
     RAISE EXCEPTION 'Choose an inventory item for every inventory sales-order line';
   END IF;
   SELECT * INTO row_data FROM public.inventory_items WHERE id=NEW.inventory_item_id FOR UPDATE;
   IF NOT FOUND OR row_data.active IS FALSE THEN
     RAISE EXCEPTION 'Inventory item is inactive or missing';
   END IF;
   IF NEW.quantity IS NULL OR NEW.quantity <= 0 THEN
     RAISE EXCEPTION 'Inventory sale quantity must be positive';
   END IF;
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS dp_validate_inventory_sale_line ON public.sales_order_items;
CREATE TRIGGER dp_validate_inventory_sale_line
BEFORE INSERT OR UPDATE OF quantity,fulfillment_method,inventory_item_id
ON public.sales_order_items FOR EACH ROW EXECUTE FUNCTION public.dp_validate_inventory_sale_line();

CREATE OR REPLACE FUNCTION public.dp_validate_quote_inventory()
RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
DECLARE row_data record;
BEGIN
 IF NEW.inventory_item_id IS NOT NULL THEN
   SELECT * INTO row_data FROM public.inventory_items WHERE id=NEW.inventory_item_id;
   IF NOT FOUND OR row_data.active IS FALSE OR
     row_data.quantity_on_hand-row_data.quantity_damaged-row_data.quantity_nailed_down-row_data.quantity_reserved < NEW.quantity
   THEN RAISE EXCEPTION 'Inventory item is not currently sellable in the quoted quantity'; END IF;
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS dp_validate_quote_inventory ON public.quote_items;
CREATE TRIGGER dp_validate_quote_inventory
BEFORE INSERT OR UPDATE OF quantity,inventory_item_id ON public.quote_items
FOR EACH ROW EXECUTE FUNCTION public.dp_validate_quote_inventory();

-- Ensure a previously reserved unit is decremented exactly once when the SO ships.
CREATE OR REPLACE FUNCTION public.dp_fulfill_inventory_order()
RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
DECLARE l record;
BEGIN
 IF NEW.status IN ('Shipped','Delivered','Completed','Fulfilled')
  AND OLD.status NOT IN ('Shipped','Delivered','Completed','Fulfilled') THEN
  FOR l IN SELECT * FROM public.sales_order_items
    WHERE sales_order_id=NEW.id AND fulfillment_method='Inventory'
      AND inventory_item_id IS NOT NULL AND inventory_fulfilled_at IS NULL
    ORDER BY inventory_item_id FOR UPDATE
  LOOP
    UPDATE public.sales_order_items SET inventory_fulfilled_at=now() WHERE id=l.id;
    UPDATE public.inventory_items SET quantity_on_hand=quantity_on_hand-l.quantity,
      updated_at=now() WHERE id=l.inventory_item_id;
  END LOOP;
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS dp_fulfill_inventory_order ON public.sales_orders;
CREATE TRIGGER dp_fulfill_inventory_order
AFTER UPDATE OF status ON public.sales_orders
FOR EACH ROW EXECUTE FUNCTION public.dp_fulfill_inventory_order();
