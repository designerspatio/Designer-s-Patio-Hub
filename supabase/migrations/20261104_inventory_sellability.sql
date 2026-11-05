-- Preserve production's sales_order_inventory_sync deduction-on-allocation model.
-- Existing sales have already reduced quantity_on_hand; do not reserve/deduct twice.
ALTER TABLE public.inventory_items
 ADD COLUMN IF NOT EXISTS quantity_damaged integer NOT NULL DEFAULT 0,
 ADD COLUMN IF NOT EXISTS quantity_nailed_down integer NOT NULL DEFAULT 0;
ALTER TABLE public.quote_items
 ADD COLUMN IF NOT EXISTS inventory_item_id uuid REFERENCES public.inventory_items(id);
ALTER TABLE public.inventory_items ADD CONSTRAINT inventory_quantities_sellable_check
 CHECK (quantity_on_hand >= 0 AND quantity_damaged >= 0 AND quantity_nailed_down >= 0
 AND quantity_damaged + quantity_nailed_down <= quantity_on_hand);
CREATE INDEX IF NOT EXISTS idx_quote_items_inventory ON public.quote_items(inventory_item_id);
CREATE INDEX IF NOT EXISTS idx_sale_items_inventory ON public.sales_order_items(inventory_item_id)
 WHERE inventory_item_id IS NOT NULL;
CREATE OR REPLACE FUNCTION public.dp_validate_inventory_sale_line()
RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
DECLARE stock public.inventory_items%ROWTYPE; owned integer := 0;
BEGIN
 IF NEW.fulfillment_method='Inventory' THEN
  IF NEW.inventory_item_id IS NULL OR NEW.quantity IS NULL OR NEW.quantity <= 0 THEN
   RAISE EXCEPTION 'Choose an inventory item and a positive whole-number quantity';
  END IF;
  SELECT * INTO stock FROM public.inventory_items WHERE id=NEW.inventory_item_id FOR UPDATE;
  IF NOT FOUND OR stock.active IS NOT TRUE THEN
   RAISE EXCEPTION 'Inventory item is inactive or missing';
  END IF;
  IF TG_OP='UPDATE' THEN
   IF OLD.fulfillment_method='Inventory' AND OLD.inventory_item_id=NEW.inventory_item_id THEN
    owned := OLD.quantity;
   END IF;
  END IF;
  IF NEW.quantity > stock.quantity_on_hand-stock.quantity_damaged-stock.quantity_nailed_down+owned THEN
   RAISE EXCEPTION 'Insufficient sellable inventory: damaged and nailed-down units cannot be sold';
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER dp_validate_inventory_sale_line
 BEFORE INSERT OR UPDATE OF quantity,fulfillment_method,inventory_item_id ON public.sales_order_items
 FOR EACH ROW EXECUTE FUNCTION public.dp_validate_inventory_sale_line();
CREATE OR REPLACE FUNCTION public.dp_validate_quote_inventory()
RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
DECLARE stock public.inventory_items%ROWTYPE; other_units bigint;
BEGIN
 IF NEW.inventory_item_id IS NOT NULL THEN
  IF NEW.quantity IS NULL OR NEW.quantity <= 0 THEN RAISE EXCEPTION 'Inventory quote quantity must be positive'; END IF;
  SELECT * INTO stock FROM public.inventory_items WHERE id=NEW.inventory_item_id FOR UPDATE;
  IF NOT FOUND OR stock.active IS NOT TRUE THEN RAISE EXCEPTION 'Inventory item is inactive or missing'; END IF;
  SELECT coalesce(sum(quantity),0) INTO other_units FROM public.quote_items
   WHERE quote_id=NEW.quote_id AND inventory_item_id=NEW.inventory_item_id AND id<>NEW.id;
  IF other_units+NEW.quantity > stock.quantity_on_hand-stock.quantity_damaged-stock.quantity_nailed_down THEN
   RAISE EXCEPTION 'Inventory item is not currently sellable in the total quoted quantity';
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER dp_validate_quote_inventory
 BEFORE INSERT OR UPDATE OF quantity,inventory_item_id,quote_id ON public.quote_items
 FOR EACH ROW EXECUTE FUNCTION public.dp_validate_quote_inventory();
