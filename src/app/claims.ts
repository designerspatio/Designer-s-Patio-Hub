export const CLAIM_STATUSES = ['Draft','Open','Submitted','Approved','Replacement Ordered','Partially Received','Received','Closed','Denied'] as const;
export const DISPOSITIONS = ['Pending','No return','Return to stock','Return to vendor','Field destroy'] as const;
export const CLAIM_SHEET_ID = '1r4U88JfKK-9aMzxbUes0KxjuEKm4Mt6RgBwJ2pdSqsU';
export type ClaimLine = {sourceSalesOrderItemId?:string; id:string; sku:string; description:string; finish:string; fabric:string; quantity:number; disposition:string; inventoryId:string; dispositionCompletedAt?:string; received:number; unitCost:number};
export type ClaimOrderLine = {id:string;kind:'Item'|'Part'|'Reorder';sourceClaimLineId?:string;sku:string;description:string;finish:string;fabric:string;quantity:number;unitCost:number;received:number};
export type ClaimCreditSummary={id:string;reference:string;amount:number;applied:number;remaining:number;voided:boolean};
export type ClaimPO = {number:string; createdAt:string; acknowledgement:string; expectedShipDate:string; invoiceRequired:boolean; invoiceReference:string; freight:number; closedAt:string};
export type Claim = {id:string; claim_number:number; version:number; created_at:string; updated_at:string; data:ClaimData; sync_error:string|null; synced_at:string|null; synced_version:number|null};
export type ClaimData = {clientId:string; clientName:string; manufacturerId:string; manufacturerName:string; salesOrderId:string; salesOrderNumber:string; issue:string; status:string; notes:string; vendorReference:string; lines:ClaimLine[]; orderLines?:ClaimOrderLine[]; freightClaimReferences?:string; accountCredits?:ClaimCreditSummary[]; po:ClaimPO|null; history:{at:string;by:string;action:string}[]};
export function mayManageClaims(profile:{role?:string;display_name?:string;active?:boolean}|null) {return !!profile && profile.active!==false && ['Owner','Manager','Assistant Manager','Warranty Manager'].includes(profile.role||'');}
export function validateClaim(value:unknown):ClaimData {
 const d=value as ClaimData;
 if(!d||typeof d!=='object'||!d.clientId||!d.manufacturerId)throw new Error('Choose a customer and manufacturer.');
 if(!CLAIM_STATUSES.includes(d.status as typeof CLAIM_STATUSES[number]))throw new Error('Choose a valid claim status.');
 if(d.status!=='Draft'&&!String(d.issue||'').trim())throw new Error('Describe the issue, or choose Draft to save your progress.');
 if(!Array.isArray(d.lines)||d.lines.length>100)throw new Error('Add up to 100 claim items.');
 d.lines=d.lines.filter(l=>l.description?.trim()||l.sku?.trim()||l.finish?.trim()||l.fabric?.trim()||l.quantity!==1||l.unitCost!==0||l.received!==0||l.disposition!=='Pending'||l.inventoryId||l.sourceSalesOrderItemId||l.dispositionCompletedAt);
 const ids=new Set<string>();
 for(const l of d.lines){
  if(!l.id||ids.has(l.id))throw new Error('Each claim item needs a unique ID.'); ids.add(l.id);
  if(!String(l.description||'').trim()||!Number.isSafeInteger(l.quantity)||l.quantity<1||l.quantity>10000)throw new Error('Each item needs a description and a positive whole quantity.');
  if(!DISPOSITIONS.includes(l.disposition as typeof DISPOSITIONS[number]))throw new Error('Choose a valid return disposition.');
  if(!Number.isFinite(l.unitCost)||l.unitCost<0||!Number.isSafeInteger(l.received)||l.received<0||l.received>l.quantity)throw new Error('Check item cost and received quantity.');
 }
 if(d.orderLines!==undefined)validateClaimOrderLines(d.orderLines);
 if(typeof d.freightClaimReferences!=='undefined'&&(typeof d.freightClaimReferences!=='string'||d.freightClaimReferences.length>4000))throw new Error('Freight references must be under 4,000 characters.');
 if(d.po && (!Number.isFinite(d.po.freight)||d.po.freight<0))throw new Error('Freight must be zero or greater.');
 return d;
}
export function claimOrderLines(data:ClaimData):ClaimOrderLine[]{return data.orderLines??data.lines.map(l=>({id:l.id,kind:'Reorder',sourceClaimLineId:l.id,sku:l.sku,description:l.description,finish:l.finish||'',fabric:l.fabric||'',quantity:l.quantity,unitCost:l.unitCost,received:l.received}));}
export function withClaimDefaults(data:ClaimData):ClaimData{return {...data,orderLines:data.orderLines??(data.po?claimOrderLines(data):[]),freightClaimReferences:data.freightClaimReferences||'',accountCredits:data.accountCredits||[]};}
export function canCloseClaim(data:ClaimData){return data.lines.every(l=>l.disposition==='No return'||(l.disposition!=='Pending'&&!!l.dispositionCompletedAt)) && (data.po?!!data.po.closedAt:data.orderLines===undefined||data.orderLines.length===0);}
export type ClaimSaleItem={id:string;sales_order_id:string;manufacturer_id:string;sku:string|null;description:string|null;finish:string|null;fabric_name:string|null;quantity:number;expected_unit_cost:number|null;acknowledged_unit_cost:number|null;inventory_item_id:string|null};
export function claimLineFromSale(item:ClaimSaleItem,id:string,quantity=Number(item.quantity)):ClaimLine{
 if(!Number.isSafeInteger(quantity)||quantity<1||quantity>Number(item.quantity))throw new Error('Claim quantity must be within the original sales-order quantity.');
 return {id,sourceSalesOrderItemId:item.id,sku:item.sku||'',description:item.description||'Sales order item',finish:item.finish||'',fabric:item.fabric_name||'',quantity,unitCost:Number(item.acknowledged_unit_cost??item.expected_unit_cost??0),received:0,disposition:'Pending',inventoryId:item.inventory_item_id||''};
}
export function validateClaimOrderLines(lines:ClaimOrderLine[]){
 if(!Array.isArray(lines)||lines.length>100)throw new Error('Add up to 100 items or parts to order.');
 const seen=new Set<string>();for(const l of lines){if(!l.id||seen.has(l.id))throw new Error('Order item IDs must be unique.');seen.add(l.id);if(!['Item','Part','Reorder'].includes(l.kind)||!String(l.description||'').trim()||!Number.isSafeInteger(l.quantity)||l.quantity<1||!Number.isFinite(l.unitCost)||l.unitCost<0||!Number.isSafeInteger(l.received)||l.received<0||l.received>l.quantity)throw new Error('Check each ordered item’s description, quantity, cost and receiving.');}
}
export function sheetValues(claim:Claim,origin:string){const d=claim.data;return [`CL-${claim.claim_number}`,claim.created_at.slice(0,10),d.clientName,d.manufacturerName,d.salesOrderNumber,d.lines.map(l=>`${l.quantity} × ${l.sku} ${l.description}`).join('\n'),d.issue,d.status,d.vendorReference,d.po?.number||'',d.po?.acknowledgement||'',d.po?.expectedShipDate||'',claimOrderLines(d).map(l=>`${l.received}/${l.quantity}`).join(', '),d.lines.map(l=>`${l.description}: ${l.disposition}${l.dispositionCompletedAt?' (completed)':''}`).join('\n'),d.po?(d.po.invoiceRequired?'Required':'No invoice expected'):'',d.notes,claim.updated_at,`${origin}/?claim=${claim.id}`,d.freightClaimReferences||'',claimOrderLines(d).map(l=>`${l.kind}: ${l.quantity} × ${l.sku} ${l.description}`).join('\n'),(d.accountCredits||[]).map(c=>`${c.reference}: $${Number(c.amount).toFixed(2)} issued / $${Number(c.applied).toFixed(2)} applied / $${Number(c.remaining).toFixed(2)} available${c.voided?' (voided)':''}`).join('\n')];}
