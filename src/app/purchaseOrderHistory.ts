import { isManufacturerCharge } from "./manufacturerCharges";
export type PurchaseOrderSection = "active" | "history";
type Order = {id:string;status:string};
type ReceiptLine = {sku?:string|null;quantity:number;received_quantity:number};
export function purchaseOrderInHistory(order:Order,items:readonly ReceiptLine[]=[]){
 if(order.status==="Received"||order.status==="Closed")return true;
 const merchandise=items.filter(item=>!isManufacturerCharge(item)&&Number(item.quantity)>0);
 return merchandise.length>0&&merchandise.every(item=>Number(item.received_quantity)>=Number(item.quantity));
}
// Purchase orders always use the complete team list. Salesperson view filters
// belong to clients, quotes and sales; they never narrow purchasing or history.
export function partitionPurchaseOrders<T extends Order>(orders:readonly T[],itemsByOrder:Record<string,readonly ReceiptLine[]>){
 const active:T[]=[],history:T[]=[];
 for(const order of orders)(purchaseOrderInHistory(order,itemsByOrder[order.id])?history:active).push(order);
 return {active,history};
}
