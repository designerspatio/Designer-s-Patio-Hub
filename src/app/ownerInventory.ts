import { type StockOrder, type StockOrderReceived, stockOrderTotals, stockRef, effectiveStockStatus } from "./stockOrders";

// Owner dashboard inventory valuation. Stock POs must be genuinely detached from a
// client sale; sales-linked POs are never classified as incoming showroom inventory.
export type OwnerStockItem = {
  id: string;
  quantity_on_hand: number;
  unit_cost: number;
  active: boolean;
};
export type OwnerStockPO = {
  id: string;
  po_number: number;
  sales_order_id: string | null;
  manufacturer_id: string | null;
  status: string;
  estimated_ship_date: string | null;
  order_date: string;
  notes?: string | null;
};
export type OwnerStockLine = {
  id: string;
  sales_order_item_id: string | null;
  quantity: number;
  unit_cost: number;
  acknowledged_unit_cost: number | null;
};
export type OwnerStockReceipt = {
  purchase_order_item_id: string | null;
  movement_type: string;
  quantity_change: number;
};
export type OwnerIncomingPO = {
  id: string;
  number: number;
  manufacturerId: string | null;
  vendor: string;
  status: string;
  estimatedShipDate: string | null;
  orderedCost: number;
  incomingCost: number;
  pendingUnits: number;
  uncodedLines: number;
  displayNumber: string;
  stockOrderId: string | null;
};
export type OwnerInventorySummary = {
  onHandCost: number;
  unitsOnHand: number;
  activeSkus: number;
  missingUnitCosts: number;
  incomingCost: number;
  incomingUnits: number;
  incomingPOCount: number;
  projectedCost: number;
  incomingOrders: OwnerIncomingPO[];
  ignoredClientPOCount: number;
};

const value = (v: number | null | undefined) => Number.isFinite(Number(v)) ? Number(v) : 0;
const cents = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;
const inactivePOStatuses = new Set(["draft", "received", "closed", "cancelled", "canceled", "void", "voided"]);
const receiptTypes = new Set(["received", "receipt", "purchase order received", "stock received"]);

export function isIncomingStockPO(
  po: OwnerStockPO,
  lines: OwnerStockLine[]
): boolean {
  if (Boolean(po.sales_order_id)) return false;
  if (lines.some(line => Boolean(line.sales_order_item_id))) return false;
  return !inactivePOStatuses.has(String(po.status || "").trim().toLowerCase());
}

export function summarizeOwnerInventory(
  inventory: OwnerStockItem[],
  purchaseOrders: OwnerStockPO[],
  purchaseOrderItems: Record<string, OwnerStockLine[]>,
  manufacturerNames: Record<string, string>,
  receipts: OwnerStockReceipt[] = [],
  stockOrders: StockOrder[] = [],
  stockReceived: StockOrderReceived = {}
): OwnerInventorySummary {
  let onHandCost = 0;
  let unitsOnHand = 0;
  let activeSkus = 0;
  let missingUnitCosts = 0;
  for (const item of inventory) {
    if (item.active === false) continue;
    const quantity = Math.max(0, value(item.quantity_on_hand));
    if (!quantity) continue;
    activeSkus++;
    unitsOnHand += quantity;
    const unitCost = Math.max(0, value(item.unit_cost));
    if (!unitCost) missingUnitCosts++;
    onHandCost += quantity * unitCost;
  }

  const receivedQuantity = new Map<string, number>();
  for (const receipt of receipts) {
    if (!receipt.purchase_order_item_id) continue;
    if (!receiptTypes.has(String(receipt.movement_type || "").trim().toLowerCase())) continue;
    receivedQuantity.set(receipt.purchase_order_item_id,
      (receivedQuantity.get(receipt.purchase_order_item_id) || 0) + value(receipt.quantity_change));
  }

  const incomingOrders: OwnerIncomingPO[] = [];
  let ignoredClientPOCount = 0;
  for (const po of purchaseOrders) {
    const lines = purchaseOrderItems[po.id] || [];
    if (Boolean(po.sales_order_id) || lines.some(line => Boolean(line.sales_order_item_id))) {
      ignoredClientPOCount++;
      continue;
    }
    if (!isIncomingStockPO(po, lines)) continue;
    let orderedCost = 0;
    let incomingCost = 0;
    let pendingUnits = 0;
    let uncodedLines = 0;
    for (const line of lines) {
      const qty = Math.max(0, value(line.quantity));
      const remaining = Math.max(0, qty - Math.max(0, receivedQuantity.get(line.id) || 0));
      const cost = Math.max(0, value(line.acknowledged_unit_cost ?? line.unit_cost));
      if (!cost && remaining > 0) uncodedLines++;
      orderedCost += qty * cost;
      incomingCost += remaining * cost;
      pendingUnits += remaining;
    }
    // Keep unpriced and empty stock POs visible so they can be corrected.
    if (pendingUnits <= 0 && lines.length > 0) continue;
    incomingOrders.push({
      id: po.id,
      number: po.po_number,
      manufacturerId: po.manufacturer_id,
      vendor: po.manufacturer_id ? manufacturerNames[po.manufacturer_id] || "Unknown vendor" : "Unassigned vendor",
      status: po.status,
      estimatedShipDate: po.estimated_ship_date,
      orderedCost: cents(orderedCost),
      incomingCost: cents(incomingCost),
      pendingUnits,
      uncodedLines,
      displayNumber: "PO #" + String(po.po_number),
      stockOrderId: null
    });
  }
  for (const order of stockOrders) {
    if (order.status === "Draft" || order.status === "Cancelled" || effectiveStockStatus(order,stockReceived) === "Received") continue;
    const totals=stockOrderTotals(order,stockReceived);
    if (totals.remainingUnits <= 0) continue;
    incomingOrders.push({
      id:"stock:"+order.id,
      number:order.sequence,
      manufacturerId:order.manufacturer_id,
      vendor:manufacturerNames[order.manufacturer_id] || "Unknown vendor",
      status:effectiveStockStatus(order,stockReceived),
      estimatedShipDate:order.estimated_ship_date,
      orderedCost:totals.ordered,
      incomingCost:totals.pending,
      pendingUnits:totals.remainingUnits,
      uncodedLines:order.lines.filter(line=>line.unit_cost<=0).length,
      displayNumber:stockRef(order.sequence),
      stockOrderId:order.id
    });
  }
  incomingOrders.sort((a,b)=>b.incomingCost-a.incomingCost || b.number-a.number);
  const incomingCost = cents(incomingOrders.reduce((sum,po)=>sum+po.incomingCost,0));
  return {
    onHandCost:cents(onHandCost),
    unitsOnHand,
    activeSkus,
    missingUnitCosts,
    incomingCost,
    incomingUnits:incomingOrders.reduce((sum,po)=>sum+po.pendingUnits,0),
    incomingPOCount:incomingOrders.length,
    projectedCost:cents(onHandCost+incomingCost),
    incomingOrders,
    ignoredClientPOCount
  };
}
