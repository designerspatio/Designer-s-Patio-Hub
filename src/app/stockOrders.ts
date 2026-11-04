/**
 * Standalone showroom/warehouse STOCK purchase orders.
 * They are intentionally separate from customer-linked purchase_orders, which
 * cannot reliably represent unassigned stock in the existing Hub schema.
 * Receiving is audited in inventory_movements and increases inventory_items.
 */
export type StockOrderStatus =
  "Draft" | "Submitted" | "Acknowledged" | "In Production" |
  "Ready to Ship" | "Shipped" | "Cancelled";
export const STOCK_STATUSES: StockOrderStatus[] = [
  "Draft", "Submitted", "Acknowledged", "In Production",
  "Ready to Ship", "Shipped", "Cancelled"
];
export type StockOrderLine = {
  id: string; inventory_item_id: string; name: string; sku: string;
  quantity: number; unit_cost: number;
};
export type StockOrder = {
  id: string; sequence: number; manufacturer_id: string;
  status: StockOrderStatus; order_date: string; estimated_ship_date: string | null;
  notes: string | null; lines: StockOrderLine[];
  created_by: string; created_at: string; updated_at: string;
};
export type StockOrderInput = {
  manufacturer_id: string; status: StockOrderStatus;
  order_date: string; estimated_ship_date: string | null;
  notes: string | null; lines: StockOrderLine[];
};
export type StockOrderCatalog = {version:number; orders:StockOrder[]};
export type StockOrderReceived = Record<string,number>;
export type StockReceiptInput = {line_id:string; quantity:number};
export const stockRef = (sequence:number) => "STK-" + String(sequence).padStart(4,"0");
export const stockLineMarker = (orderId:string,lineId:string) => "stock-po:" + orderId + ":" + lineId;
export const stockReceiptReason = (receiptId:string, sequence?:number) => sequence ? stockRef(sequence) + " · Receipt " + receiptId : "Stock receipt " + receiptId;
const asNumber = (v:unknown) => Number.isFinite(Number(v)) ? Number(v) : 0;
export const isStockOrderLocked = (order:StockOrder) => order.status !== "Draft";
export function receivedForLine(line:StockOrderLine,received:StockOrderReceived) {
  return Math.max(0,Math.min(line.quantity, asNumber(received[line.id])));
}
export function remainingForLine(line:StockOrderLine,received:StockOrderReceived) {
  return Math.max(0,line.quantity - receivedForLine(line,received));
}
export function effectiveStockStatus(order:StockOrder,received:StockOrderReceived):string {
  const total=order.lines.reduce((n,l)=>n+l.quantity,0);
  const delivered=order.lines.reduce((n,l)=>n+receivedForLine(l,received),0);
  if(total>0 && delivered>=total) return "Received";
  if(delivered>0) return "Partially Received";
  return order.status;
}
export function verifyStockOrderInput(input:StockOrderInput, manufacturerInventory:Map<string,{manufacturer_id:string|null;active:boolean;name:string;sku:string|null;unit_cost:number}>):string {
  if(!input || typeof input!=="object") return "Enter a stock purchase order.";
  if(!input.manufacturer_id || typeof input.manufacturer_id!=="string") return "Choose a manufacturer.";
  if(!STOCK_STATUSES.includes(input.status)) return "Choose a valid stock order status.";
  if(!/^\d{4}-\d{2}-\d{2}$/.test(input.order_date)||Number.isNaN(new Date(input.order_date+"T12:00:00").getTime()))return "Enter a valid order date.";
  if(input.estimated_ship_date && !/^\d{4}-\d{2}-\d{2}$/.test(input.estimated_ship_date))return "Enter a valid estimated ship date.";
  if(input.notes && (typeof input.notes!=="string" || input.notes.length>4000))return "Notes must be under 4,000 characters.";
  if(!Array.isArray(input.lines)||input.lines.length===0||input.lines.length>150)return "Choose 1 to 150 inventory items.";
  const seen=new Set<string>();
  const seenLines=new Set<string>();
  for(const line of input.lines) {
    if(!/^[a-f0-9-]{36}$/i.test(line.id))return "Invalid order line. Refresh and try again.";
    if(seenLines.has(line.id))return "Duplicate stock PO line identifiers. Refresh and try again.";
    seenLines.add(line.id);
    if(typeof line.inventory_item_id!=="string")return "Choose an inventory item for every line.";
    if(seen.has(line.inventory_item_id))return "An inventory item can appear only once per stock PO. Adjust its quantity instead.";
    seen.add(line.inventory_item_id);
    const item=manufacturerInventory.get(line.inventory_item_id);
    if(!item||item.active===false)return "Select an active inventory item for every line.";
    if(item.manufacturer_id!==input.manufacturer_id)return "Every stock item must belong to the selected manufacturer.";
    if(!Number.isSafeInteger(line.quantity)||line.quantity<1||line.quantity>100000)return "Enter whole-number quantities from 1 to 100,000.";
    if(!Number.isFinite(line.unit_cost)||line.unit_cost<0||line.unit_cost>100000000)return "Enter a valid, non-negative unit cost.";
  }
  return "";
}
export function stockOrderTotals(order:StockOrder,received:StockOrderReceived) {
  const ordered=order.lines.reduce((sum,l)=>sum+l.quantity*Math.max(0,asNumber(l.unit_cost)),0);
  const pending=order.lines.reduce((sum,l)=>sum+remainingForLine(l,received)*Math.max(0,asNumber(l.unit_cost)),0);
  return {ordered:Math.round(ordered*100)/100,pending:Math.round(pending*100)/100,
    orderedUnits:order.lines.reduce((sum,l)=>sum+l.quantity,0),
    remainingUnits:order.lines.reduce((sum,l)=>sum+remainingForLine(l,received),0)};
}
