/**
 * Inventory sellability rules shared by quote and sales-order flows.
 *
 * An inventory item is a SKU, not necessarily a unique physical piece. Track
 * damaged and nailed-down units separately so the remaining units can sell.
 * Reservations exist only for customer sales orders, not draft quotes.
 *
 * IMPORTANT: Commit reservations and inventory movements atomically in the
 * database. These helpers are validation/calculation, not a substitute for
 * database row locks or serializable transactions.
 */
export type InventoryAvailability = {
  id: string;
  quantity_on_hand: number;
  quantity_damaged?: number | null;
  quantity_nailed_down?: number | null;
  quantity_reserved?: number | null;
  active?: boolean;
};

export type InventoryReservationLine = {
  inventory_item_id: string;
  quantity: number;
};

const nonNegativeInt = (n: unknown): n is number =>
  typeof n === "number" && Number.isSafeInteger(n) && n >= 0;

export function validateInventoryCounts(item: InventoryAvailability): string {
  if (!item?.id) return "An inventory item ID is required.";
  if (!nonNegativeInt(item.quantity_on_hand)) return "On-hand quantity must be a non-negative whole number.";
  for (const [label, value] of [
    ["Damaged", item.quantity_damaged ?? 0],
    ["Nailed-down", item.quantity_nailed_down ?? 0],
    ["Reserved", item.quantity_reserved ?? 0],
  ] as const) {
    if (!nonNegativeInt(value)) return label + " quantity must be a non-negative whole number.";
  }
  const damaged = item.quantity_damaged ?? 0;
  const nailed = item.quantity_nailed_down ?? 0;
  const reserved = item.quantity_reserved ?? 0;
  if (damaged + nailed > item.quantity_on_hand)
    return "Damaged and nailed-down quantities cannot exceed on-hand quantity.";
  if (reserved > item.quantity_on_hand - damaged - nailed)
    return "Reserved quantity cannot exceed sellable inventory.";
  return "";
}

export function availableToSell(item: InventoryAvailability): number {
  if (item.active === false || validateInventoryCounts(item)) return 0;
  return item.quantity_on_hand - (item.quantity_damaged ?? 0)
    - (item.quantity_nailed_down ?? 0) - (item.quantity_reserved ?? 0);
}

export function inventoryAvailabilityLabel(item: InventoryAvailability): string {
  if (item.active === false) return "Inactive";
  const error = validateInventoryCounts(item);
  if (error) return "Needs inventory review";
  if (availableToSell(item) > 0) return "Available";
  if (item.quantity_on_hand === 0) return "Out of stock";
  if ((item.quantity_damaged ?? 0) === item.quantity_on_hand) return "Damaged";
  if ((item.quantity_nailed_down ?? 0) === item.quantity_on_hand) return "Nailed down";
  if ((item.quantity_reserved ?? 0) > 0) return "Reserved";
  return "Unavailable";
}

export function validateInventorySelection(
  lines: InventoryReservationLine[],
  inventory: Map<string, InventoryAvailability>,
  existingOrderReservations: Map<string, number> = new Map()
): string {
  const required = new Map<string, number>();
  for (const line of lines) {
    if (!line.inventory_item_id || !Number.isSafeInteger(line.quantity) || line.quantity <= 0)
      return "Select an inventory item and enter a positive whole-number quantity.";
    required.set(line.inventory_item_id,
      (required.get(line.inventory_item_id) ?? 0) + line.quantity);
  }
  for (const [id, quantity] of required) {
    const item = inventory.get(id);
    if (!item || item.active === false) return "Selected inventory item is unavailable.";
    const error = validateInventoryCounts(item);
    if (error) return error;
    const owned = existingOrderReservations.get(id) ?? 0;
    if (!nonNegativeInt(owned) || owned > (item.quantity_reserved ?? 0))
      return "Existing order reservation is invalid.";
    const available = availableToSell(item) + owned;
    if (quantity > available)
      return "Only " + available + " sellable unit(s) remain for item " + id + ".";
  }
  return "";
}

/** Quote lines check live availability but do NOT reserve units. */
export function validateQuoteInventory(
  lines: InventoryReservationLine[],
  inventory: Map<string, InventoryAvailability>
): string {
  return validateInventorySelection(lines, inventory);
}

/** Sales-order edits can retain the quantities already reserved to that order. */
export function validateSalesOrderInventory(
  lines: InventoryReservationLine[],
  inventory: Map<string, InventoryAvailability>,
  existingOrderReservations: Map<string, number> = new Map()
): string {
  return validateInventorySelection(lines, inventory, existingOrderReservations);
}

/**
 * Create the new per-SKU reservation totals after a validated SO edit.
 * Caller must persist under a database lock, recheck then commit.
 */
export function reservationDeltas(
  nextLines: InventoryReservationLine[],
  previousLines: InventoryReservationLine[] = []
): Map<string, number> {
  const delta = new Map<string, number>();
  for (const line of previousLines)
    delta.set(line.inventory_item_id, (delta.get(line.inventory_item_id) ?? 0) - line.quantity);
  for (const line of nextLines)
    delta.set(line.inventory_item_id, (delta.get(line.inventory_item_id) ?? 0) + line.quantity);
  return delta;
}
