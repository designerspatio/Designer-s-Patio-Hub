export type PoAcknowledgementFilter = 'all' | 'acknowledged' | 'unacknowledged';
export function isPoAcknowledged(order:{id:string;status?:string;acknowledgement_number?:string|null;acknowledgement_date?:string|null},uploadedPoIds:readonly string[]=[]){
 return Boolean(order.acknowledgement_number?.trim()||order.acknowledgement_date||order.status==='Acknowledged'||uploadedPoIds.includes(order.id));
}
export function matchesPoAcknowledgement(order:Parameters<typeof isPoAcknowledged>[0],filter:PoAcknowledgementFilter,uploadedPoIds:readonly string[]=[]){
 return filter==='all'||isPoAcknowledged(order,uploadedPoIds)===(filter==='acknowledged');
}
export class PoSaveTimeout extends Error {constructor(){super('The save could not be confirmed in time. Your edits are still on screen. Reopen the PO to check whether it saved before retrying.');}}
export async function withPoDeadline<T>(operation:(signal:AbortSignal)=>PromiseLike<T>,timeoutMs=20000):Promise<T>{
 const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
 try{return await Promise.race([Promise.resolve().then(()=>operation(controller.signal)),new Promise<never>((_,reject)=>{timer=setTimeout(()=>{reject(new PoSaveTimeout());controller.abort();},timeoutMs);})]);}
 finally{if(timer)clearTimeout(timer);}
}
export async function savePoRpc<T>(client:{rpc:Function},name:string,args:Record<string,unknown>,timeoutMs=20000):Promise<T>{
 const result=await withPoDeadline<{data:unknown;error:{message:string}|null}>(signal=>client.rpc(name,args).abortSignal(signal),timeoutMs);
 if(result.error)throw new Error(result.error.message);
 // PostgREST can represent a composite return as a one-row array. Normalize it
 // before updating form state; never reopen a PO using an undefined ID.
 const data=Array.isArray(result.data)?result.data.length===1?result.data[0]:null:result.data;
 if(!data||typeof data!=='object')throw new Error('The server returned no save confirmation. Your edits have been kept. Reopen the PO to check its saved values.');
 return data as T;
}
export type ManualAckDraft={vendor_name:string;po_number:string;freight_amount:string;acknowledgement_number:string;acknowledgement_date:string;expected_ship_date:string;lines:{purchase_order_item_id:string|null;sku:string;quantity:string;unit_cost:string;extra:boolean}[]};
export function manualAcknowledgementPayload(draft:ManualAckDraft,items:{id:string;unit_cost:number;acknowledged_unit_cost:number|null}[]){
 const money=(v:string)=>{if(!v.trim())return null;const n=Number(v);if(!Number.isFinite(n)||n<0||n>100000000)throw new Error('Enter a valid non-negative cost or freight amount.');return n;};
 const seen=new Set<string>();
 const lines=draft.lines.map(line=>{
  const quantity=line.quantity.trim()===''?null:Number(line.quantity);
  if(quantity!==null&&(!Number.isSafeInteger(quantity)||quantity<1))throw new Error('Acknowledged quantities must be positive whole numbers.');
  if(!line.extra){if(!line.purchase_order_item_id||seen.has(line.purchase_order_item_id)||!items.some(i=>i.id===line.purchase_order_item_id))throw new Error('Acknowledgement items changed. Reopen the review.');seen.add(line.purchase_order_item_id);}
  return {...line,sku:line.sku.trim(),quantity,unit_cost:money(line.unit_cost)};
 });
 if(items.some(i=>!seen.has(i.id)))throw new Error('Acknowledgement items changed. Reopen the review.');
 for(const value of [draft.acknowledgement_date,draft.expected_ship_date])if(value&&!/^\d{4}-\d{2}-\d{2}$/.test(value))throw new Error('Enter a valid date.');
 return {...draft,freight_amount:money(draft.freight_amount),lines,cost_updates:items.map(item=>({id:item.id,expected_unit_cost:item.unit_cost,expected_acknowledged_unit_cost:item.acknowledged_unit_cost,acknowledged_unit_cost:lines.find(l=>!l.extra&&l.purchase_order_item_id===item.id)?.unit_cost??item.acknowledged_unit_cost}))};
}
