export type ComDestination = { manufacturer_id: string; name: string; address: string; contact?: string; phone?: string };
export type ItemSource = { item_type?: "Special Order" | "Stock Item" | "COM Fabric"; com_ship_to?: ComDestination | null };
export function sourceError(lines: (ItemSource & { inventory_item_id?: string | null; sku?: string | null })[]) {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^__DP_(TARIFF|SURCHARGE)__/.test(line.sku || "")) continue;
    if (line.item_type === "Stock Item" && !line.inventory_item_id) return `Choose a stock item for item ${i + 1}.`;
    if (line.item_type === "COM Fabric" && line.com_ship_to && (!line.com_ship_to.manufacturer_id || !line.com_ship_to.name.trim() || !line.com_ship_to.address.trim())) return `Choose the receiving manufacturer and enter its full ship-to address for COM item ${i + 1}.`;
  }
  return "";
}
export function poGroupKey(line: ItemSource & { manufacturer_id: string | null }) {
  const destination = line.item_type === "COM Fabric" ? line.com_ship_to : null;
  return `${line.manufacturer_id || ""}:${destination?.manufacturer_id || ""}`;
}
export function comPoShipping(destination: ComDestination | null | undefined) {
  return destination ? { com_manufacturer_id: destination.manufacturer_id, ship_to_name: destination.name,
    ship_to_address: destination.address, ship_to_contact: destination.contact || null, ship_to_phone: destination.phone || null,
    ship_to_city: null, ship_to_state: null, ship_to_zip: null } : {};
}
