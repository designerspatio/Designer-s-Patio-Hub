export type FulfillmentSource="inventory"|"special_order";
export function shouldCreatePurchaseOrder(source:FulfillmentSource){return source==="special_order";}
