import {NextResponse,after} from 'next/server';
import {claimsContext,HttpError} from './context';
import {sheetConfigured,syncClaim} from './sheets';
import {mayManageClaims,validateClaim,canCloseClaim,claimOrderLines,type Claim,type ClaimData} from '../../claims';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=60;
const json=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'no-store'}});
const fail=(e:unknown)=>json({error:e instanceof Error?e.message:'Claims request failed.'},e instanceof HttpError?e.status:503);
type Admin=Awaited<ReturnType<typeof claimsContext>>['admin'];
function confirmedClaim(value:unknown):Claim{const row=Array.isArray(value)?value[0]:value;if(!row||typeof row!=='object'||!('id' in row))throw new HttpError('Save confirmation was incomplete. Reopen the claim to check before retrying.',503);return row as Claim;}
async function sync(admin:Admin,id:string){
 const now=new Date().toISOString();
 const lock=await admin.from('warranty_claims').update({sync_lock_until:new Date(Date.now()+90000).toISOString()}).eq('id',id).or(`sync_lock_until.is.null,sync_lock_until.lt.${now}`).select('*').maybeSingle();
 if(lock.error||!lock.data)return;
 try{
  let claim=lock.data as Claim;
  for(let attempt=0;attempt<3;attempt++){
   try{await syncClaim(claim);}catch(e){await admin.from('warranty_claims').update({sync_error:e instanceof Error?e.message:'Google Sheet sync failed.'}).eq('id',id);return;}
   await admin.from('warranty_claims').update({synced_at:new Date().toISOString(),synced_version:claim.version,sync_error:null}).eq('id',id);
   const latest=await admin.from('warranty_claims').select('*').eq('id',id).single();
   if(latest.error||latest.data.version===claim.version)return;
   claim=latest.data as Claim;
  }
 }finally{await admin.from('warranty_claims').update({sync_lock_until:null}).eq('id',id);}
}
async function lookupNames(admin:Admin,d:ClaimData){
 const [c,m]=await Promise.all([admin.from('clients').select('*').eq('id',d.clientId).single(),admin.from('manufacturers').select('id,name').eq('id',d.manufacturerId).single()]);
 if(c.error||m.error)throw new HttpError('Customer or manufacturer could not be verified.');
 d.clientName=c.data.client_name||c.data.company_name||[c.data.first_name,c.data.last_name].filter(Boolean).join(' ')||c.data.name||'Customer';d.manufacturerName=m.data.name;
 if(d.salesOrderId){const s=await admin.from('sales_orders').select('id,client_id,sale_number').eq('id',d.salesOrderId).single();if(s.error||s.data.client_id!==d.clientId)throw new HttpError('Select a sales order belonging to this customer.');d.salesOrderNumber=String(s.data.sale_number);}else d.salesOrderNumber='';
}
async function queueSync(admin:Admin,saved:Claim){
 if(sheetConfigured())after(async()=>{try{await sync(admin,saved.id);}catch{await admin.from('warranty_claims').update({sync_error:'Google Sheet sync failed. Use Retry sheet sync.'}).eq('id',saved.id);}});
 else{saved.sync_error='Google Sheet connection needs a service account. Claim is saved; retry sync after setup.';after(async()=>{await admin.from('warranty_claims').update({sync_error:saved.sync_error}).eq('id',saved.id);});}
}
export async function GET(request:Request){try{
 const {admin,profile}=await claimsContext(request,false);const url=new URL(request.url);
 if(url.searchParams.has('salesOrderId')){
  if(!mayManageClaims(profile))throw new HttpError('Importing original sales-order items is limited to claim managers.',403);
  const id=url.searchParams.get('salesOrderId'),clientId=url.searchParams.get('clientId'),manufacturerId=url.searchParams.get('manufacturerId');
  const order=await admin.from('sales_orders').select('id,client_id').eq('id',id).single();if(order.error||order.data.client_id!==clientId)throw new HttpError('Choose an original sales order belonging to this customer.');
  const result=await admin.from('sales_order_items').select('id,sales_order_id,manufacturer_id,sku,description,finish,fabric_name,quantity,expected_unit_cost,acknowledged_unit_cost,inventory_item_id').eq('sales_order_id',id).eq('manufacturer_id',manufacturerId).order('sort_order');
  if(result.error)throw new HttpError('Original sales-order items could not be loaded.',503);
  return json({items:(result.data||[]).filter(i=>!/^__DP_(TARIFF|SURCHARGE)__/.test(i.sku||''))});
 }
 if(url.searchParams.has('creditsFor')){
  if(!mayManageClaims(profile))throw new HttpError('Account credit details are limited to warranty and management accounts.',403);
  const id=url.searchParams.get('creditsFor');const claim=await admin.from('warranty_claims').select('*').eq('id',id).single();if(claim.error)throw new HttpError('Claim not found.',404);
  const credits=await admin.from('claim_vendor_credits').select('*').eq('claim_id',id).order('created_at');if(credits.error)throw new HttpError('Credits could not be loaded.',503);
  const ids=(credits.data||[]).map(c=>c.id);
  const apps=ids.length?await admin.from('claim_vendor_credit_applications').select('*').in('credit_id',ids).order('created_at'):{data:[],error:null};
  const invoices=await admin.from('vendor_invoices').select('id,invoice_number,vendor_invoice_number,total_amount,status').eq('manufacturer_id',claim.data.data.manufacturerId).neq('status','Void').order('invoice_number',{ascending:false}).limit(1000);
  if(apps.error||invoices.error)throw new HttpError('Credit applications or invoices could not be loaded.',503);
  const invoiceIds=(invoices.data||[]).map(i=>i.id);const totals:Record<string,number>={};
  if(invoiceIds.length){for(let start=0;start<10000;start+=1000){const paid=await admin.from('vendor_payments').select('vendor_invoice_id,amount').in('vendor_invoice_id',invoiceIds).order('id').range(start,start+999);if(paid.error)throw new HttpError('Invoice balances could not be loaded.',503);for(const p of paid.data||[])totals[p.vendor_invoice_id]=(totals[p.vendor_invoice_id]||0)+Number(p.amount);if((paid.data||[]).length<1000)break;if(start===9000)throw new HttpError('Invoice payment history needs an administrator review.',503);}}
  return json({credits:credits.data,applications:apps.data,invoices:(invoices.data||[]).map(i=>({...i,outstanding:Math.max(0,Math.round((Number(i.total_amount)-(totals[i.id]||0))*100)/100)}))});
 }
 const {data,error}=await admin.from('warranty_claims').select('*').order('claim_number',{ascending:false}).limit(2000);if(error)throw new Error('Unable to load claims.');return json({claims:data,sheetConfigured:sheetConfigured(),truncated:data.length===2000});
}catch(e){return fail(e);}}
export async function POST(request:Request){try{
 const {admin,user,profile}=await claimsContext(request);
 const raw=await request.text();if(Buffer.byteLength(raw)>200000)throw new HttpError('Claim request is too large.',413);
 let body;try{body=JSON.parse(raw);}catch{throw new HttpError('Invalid request.');}
 if(['create_credit','apply_credit','reverse_credit','void_credit'].includes(body.action)){
  if(!body.id)throw new HttpError('Save the claim before recording credits.');
  const result=await admin.rpc('dp_claim_vendor_credit_action',{p_claim_id:body.id,p_actor:user.id,p_action:body.action,p_input:body.credit||{}});
  if(result.error)throw new HttpError(result.error.code==='23505'?'This manufacturer credit memo has already been recorded.':result.error.message,400);
  const saved=confirmedClaim(result.data);await queueSync(admin,saved);return json({claim:saved});
 }
 let current:Claim|null=null;
 if(body.id){const r=await admin.from('warranty_claims').select('*').eq('id',body.id).single();if(r.error)throw new HttpError('Claim not found.',404);current=r.data as Claim;if(current.version!==body.version)throw new HttpError('Claim changed on another device. Refresh and retry.',409);}
 if(body.action==='sync'){if(!current)throw new HttpError('Save the claim first.');await sync(admin,current.id);return json({claim:(await admin.from('warranty_claims').select('*').eq('id',current.id).single()).data});}
 let d:ClaimData;
 try{d=validateClaim(['save','save_and_generate_po'].includes(body.action)||!current?body.data:structuredClone(current.data));}catch(e){throw new HttpError((e as Error).message);}
 const now=new Date().toISOString();let inventoryId:string|null=null,quantity:number|null=null;
 if(['save','save_and_generate_po'].includes(body.action)){
  d.po=current?.data.po||null;d.accountCredits=current?.data.accountCredits||[];
  if(d.orderLines!==undefined){const priorOrders=current?claimOrderLines(current.data):[];for(const order of d.orderLines)order.received=priorOrders.find(l=>l.id===order.id)?.received||0;}
  for(const line of d.lines){const prior=current?.data.lines.find(l=>l.id===line.id);line.received=prior?.received||0;line.dispositionCompletedAt=prior?.dispositionCompletedAt;
   if(prior?.dispositionCompletedAt && JSON.stringify({...line,received:0})!==JSON.stringify({...prior,received:0}))throw new HttpError('Completed return items cannot be edited.');
   if(line.received>line.quantity)throw new HttpError('Quantity cannot be less than what was received.');
  }
  if(current?.data.lines.some(l=>(l.dispositionCompletedAt||l.received>0)&&!d.lines.some(n=>n.id===l.id)))throw new HttpError('Received or completed return items cannot be removed.');
  if((current?.data.po||(current?.data.accountCredits||[]).length) && (d.clientId!==current.data.clientId||d.manufacturerId!==current.data.manufacturerId))throw new HttpError('Customer and manufacturer cannot change after a claims PO or account credit is issued.');
  if(current?.data.po){
   const previous=claimOrderLines(current.data),next=claimOrderLines(d),spec=(l:typeof next[number])=>JSON.stringify([l.id,l.sku,l.description,l.quantity,l.unitCost,l.finish,l.fabric]);
   if(previous.some(l=>!next.some(n=>n.id===l.id&&spec(n)===spec(l))))throw new HttpError('Items already on an issued claims PO cannot be changed or removed.');
   if(next.length>previous.length){if(current.data.po.closedAt)throw new HttpError('A closed claims PO cannot accept additional items.');d.status=next.some(l=>l.received>0)?'Partially Received':'Replacement Ordered';}
  }
  await lookupNames(admin,d);
  const imported=d.lines.filter(l=>l.sourceSalesOrderItemId);
  if(imported.length){if(!d.salesOrderId)throw new HttpError('Imported items require the original sales order.');const source=await admin.from('sales_order_items').select('id,sales_order_id,manufacturer_id,quantity').in('id',imported.map(l=>l.sourceSalesOrderItemId!));if(source.error)throw new HttpError('Original items could not be verified.',503);const used=new Set<string>();for(const line of imported){const item=source.data?.find(i=>i.id===line.sourceSalesOrderItemId);if(!item||item.sales_order_id!==d.salesOrderId||item.manufacturer_id!==d.manufacturerId||line.quantity>Number(item.quantity)||used.has(item.id))throw new HttpError('Imported items must belong to this sales order and manufacturer, with quantities no greater than originally sold.');used.add(item.id);}}

 }else if(!current)throw new HttpError('Save the claim first.');
 else if(body.action==='generate_po'){
  if(d.po)throw new HttpError('This claim already has a PO.');
  if(!claimOrderLines(d).length)throw new HttpError('Add items or parts to order before generating a claims PO.');
  d.po={number:`CPO-${current.claim_number}`,createdAt:now,acknowledgement:'',expectedShipDate:'',invoiceRequired:false,invoiceReference:'',freight:0,closedAt:''};d.status='Replacement Ordered';
 }else if(body.action==='update_po'){
  if(!d.po||d.po.closedAt)throw new HttpError('An open claims PO is required.');
  const p=body.po||{};if(typeof p.invoiceRequired!=='boolean'||!Number.isFinite(p.freight)||p.freight<0)throw new HttpError('Check the invoice setting and freight.');
  d.po={...d.po,acknowledgement:String(p.acknowledgement||'').slice(0,200),expectedShipDate:String(p.expectedShipDate||'').slice(0,10),invoiceRequired:p.invoiceRequired,invoiceReference:String(p.invoiceReference||'').slice(0,200),freight:p.freight};
 }else if(body.action==='receive'){
  if(!d.po||d.po.closedAt)throw new HttpError('An open claims PO is required.');
  const line=(d.orderLines??d.lines).find(l=>l.id===body.lineId),qty=Number(body.quantity);
  if(!line||!Number.isSafeInteger(qty)||qty<1||line.received+qty>line.quantity)throw new HttpError('Enter a whole quantity within the outstanding amount.');
  line.received+=qty;d.status=claimOrderLines(d).every(l=>l.received===l.quantity)?'Received':'Partially Received';
 }else if(body.action==='disposition'){
  const line=d.lines.find(l=>l.id===body.lineId);if(!line||['Pending','No return'].includes(line.disposition)||line.dispositionCompletedAt)throw new HttpError('Choose a disposition that has not been completed.');
  if(line.disposition==='Return to stock'){
   if(!line.inventoryId)throw new HttpError('Select the inventory item to return to stock.');
   const item=await admin.from('inventory_items').select('id,manufacturer_id,active').eq('id',line.inventoryId).single();
   if(item.error||!item.data.active||item.data.manufacturer_id!==d.manufacturerId)throw new HttpError('Select an active inventory item from this manufacturer.');
   inventoryId=line.inventoryId;quantity=line.quantity;
  }
  line.dispositionCompletedAt=now;
 }else if(body.action==='close_po'){
  if(!d.po||d.po.closedAt)throw new HttpError('An open claims PO is required.');
  if(claimOrderLines(d).some(l=>l.received<l.quantity))throw new HttpError('Receive all replacement items before closing the claims PO.');
  if(d.po.invoiceRequired&&!d.po.invoiceReference.trim())throw new HttpError('Record an invoice reference, or choose no invoice expected.');d.po.closedAt=now;
 }else throw new HttpError('Unknown claims action.');
 if(body.action==='save_and_generate_po'){
  if(d.po)throw new HttpError('This claim already has a PO.');
  if(!d.issue.trim())throw new HttpError('Describe the issue before generating a claim PO.');
  if(!claimOrderLines(d).length)throw new HttpError('Add items or parts to order before generating a claim PO.');
  d.po={number:current?`CPO-${current.claim_number}`:'CPO-AUTO',createdAt:now,acknowledgement:'',expectedShipDate:'',invoiceRequired:false,invoiceReference:'',freight:0,closedAt:''};d.status='Replacement Ordered';
 }
 if(d.status==='Closed'&&!canCloseClaim(d))throw new HttpError('Complete all return dispositions and close the claims PO first.');
 if(current?.data.status==='Closed')throw new HttpError('Closed claims cannot be changed.');
 d.history=[...(current?.data.history||[]),{at:now,by:profile.display_name||user.id,action:body.action}];
 const r=await admin.rpc(body.action==='save_and_generate_po'?'dp_save_warranty_claim_with_po':'dp_save_warranty_claim',{p_id:current?.id||null,p_version:current?.version||0,p_data:d,p_actor:user.id,p_inventory_id:inventoryId,p_quantity:quantity});
 if(r.error)throw new HttpError(/another device/.test(r.error.message)?r.error.message:'Claim could not be saved. Refresh and retry.',/another device/.test(r.error.message)?409:503);
 const saved=confirmedClaim(r.data);
 await queueSync(admin,saved);
 return json({claim:saved});
 }catch(e){return fail(e);}}
