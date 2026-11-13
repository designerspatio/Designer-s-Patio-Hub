export const CLAIM_STATUSES = ['Open','Submitted','Approved','Replacement Ordered','Partially Received','Received','Closed','Denied'] as const;
export const DISPOSITIONS = ['Pending','Return to stock','Return to vendor','Field destroy'] as const;
export const CLAIM_SHEET_ID = '1r4U88JfKK-9aMzxbUes0KxjuEKm4Mt6RgBwJ2pdSqsU';
export type ClaimLine = {id:string; sku:string; description:string; finish:string; fabric:string; quantity:number; disposition:string; inventoryId:string; dispositionCompletedAt?:string; received:number; unitCost:number};
export type ClaimPO = {number:string; createdAt:string; acknowledgement:string; expectedShipDate:string; invoiceRequired:boolean; invoiceReference:string; freight:number; closedAt:string};
export type Claim = {id:string; claim_number:number; version:number; created_at:string; updated_at:string; data:ClaimData; sync_error:string|null; synced_at:string|null; synced_version:number|null};
export type ClaimData = {clientId:string; clientName:string; manufacturerId:string; manufacturerName:string; salesOrderId:string; salesOrderNumber:string; issue:string; status:string; notes:string; vendorReference:string; lines:ClaimLine[]; po:ClaimPO|null; history:{at:string;by:string;action:string}[]};
export function mayManageClaims(profile:{role?:string;display_name?:string;active?:boolean}|null) {return !!profile && profile.active!==false && ['Owner','Manager','Assistant Manager','Warranty Manager'].includes(profile.role||'');}
export function validateClaim(value:unknown):ClaimData {
 const d=value as ClaimData;
 if(!d||typeof d!=='object'||!d.clientId||!d.manufacturerId||!String(d.issue||'').trim())throw new Error('Choose a customer and manufacturer and describe the issue.');
 if(!CLAIM_STATUSES.includes(d.status as typeof CLAIM_STATUSES[number]))throw new Error('Choose a valid claim status.');
 if(!Array.isArray(d.lines)||d.lines.length<1||d.lines.length>100)throw new Error('Add between 1 and 100 claim items.');
 const ids=new Set<string>();
 for(const l of d.lines){
  if(!l.id||ids.has(l.id))throw new Error('Each claim item needs a unique ID.'); ids.add(l.id);
  if(!String(l.description||'').trim()||!Number.isSafeInteger(l.quantity)||l.quantity<1||l.quantity>10000)throw new Error('Each item needs a description and a positive whole quantity.');
  if(!DISPOSITIONS.includes(l.disposition as typeof DISPOSITIONS[number]))throw new Error('Choose a valid return disposition.');
  if(!Number.isFinite(l.unitCost)||l.unitCost<0||!Number.isSafeInteger(l.received)||l.received<0||l.received>l.quantity)throw new Error('Check item cost and received quantity.');
 }
 if(d.po && (!Number.isFinite(d.po.freight)||d.po.freight<0))throw new Error('Freight must be zero or greater.');
 return d;
}
export function canCloseClaim(data:ClaimData){return data.lines.every(l=>l.disposition==='Pending'?false:!!l.dispositionCompletedAt) && (!data.po||!!data.po.closedAt);}
export function sheetValues(claim:Claim,origin:string){const d=claim.data;return [`CL-${claim.claim_number}`,claim.created_at.slice(0,10),d.clientName,d.manufacturerName,d.salesOrderNumber,d.lines.map(l=>`${l.quantity} × ${l.sku} ${l.description}`).join('\n'),d.issue,d.status,d.vendorReference,d.po?.number||'',d.po?.acknowledgement||'',d.po?.expectedShipDate||'',d.lines.map(l=>`${l.received}/${l.quantity}`).join(', '),d.lines.map(l=>`${l.description}: ${l.disposition}${l.dispositionCompletedAt?' (completed)':''}`).join('\n'),d.po?(d.po.invoiceRequired?'Required':'No invoice expected'):'',d.notes,claim.updated_at,`${origin}/?claim=${claim.id}`];}
