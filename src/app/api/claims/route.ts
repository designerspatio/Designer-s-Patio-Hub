import {NextResponse,after} from 'next/server';
import {claimsContext,HttpError} from './context';
import {sheetConfigured,syncClaim} from './sheets';
import {validateClaim,canCloseClaim,type Claim,type ClaimData} from '../../claims';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=60;
const json=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'no-store'}});
const fail=(e:unknown)=>json({error:e instanceof Error?e.message:'Claims request failed.'},e instanceof HttpError?e.status:503);
type Admin=Awaited<ReturnType<typeof claimsContext>>['admin'];
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
export async function GET(request:Request){try{const {admin}=await claimsContext(request);const {data,error}=await admin.from('warranty_claims').select('*').order('claim_number',{ascending:false}).limit(2000);if(error)throw new Error('Unable to load claims.');return json({claims:data,sheetConfigured:sheetConfigured(),truncated:data.length===2000});}catch(e){return fail(e);}}
export async function POST(request:Request){try{
 const {admin,user,profile}=await claimsContext(request);
 const raw=await request.text();if(Buffer.byteLength(raw)>200000)throw new HttpError('Claim request is too large.',413);
 let body;try{body=JSON.parse(raw);}catch{throw new HttpError('Invalid request.');}
 let current:Claim|null=null;
 if(body.id){const r=await admin.from('warranty_claims').select('*').eq('id',body.id).single();if(r.error)throw new HttpError('Claim not found.',404);current=r.data as Claim;if(current.version!==body.version)throw new HttpError('Claim changed on another device. Refresh and retry.',409);}
 if(body.action==='sync'){if(!current)throw new HttpError('Save the claim first.');await sync(admin,current.id);return json({claim:(await admin.from('warranty_claims').select('*').eq('id',current.id).single()).data});}
 let d:ClaimData;
 try{d=validateClaim(body.action==='save'||!current?body.data:structuredClone(current.data));}catch(e){throw new HttpError((e as Error).message);}
 const now=new Date().toISOString();let inventoryId:string|null=null,quantity:number|null=null;
 if(body.action==='save'){
  d.po=current?.data.po||null;
  for(const line of d.lines){const prior=current?.data.lines.find(l=>l.id===line.id);line.received=prior?.received||0;line.dispositionCompletedAt=prior?.dispositionCompletedAt;
   if(prior?.dispositionCompletedAt && JSON.stringify({...line,received:0})!==JSON.stringify({...prior,received:0}))throw new HttpError('Completed return items cannot be edited.');
   if(line.received>line.quantity)throw new HttpError('Quantity cannot be less than what was received.');
  }
  if(current?.data.lines.some(l=>(l.dispositionCompletedAt||l.received>0)&&!d.lines.some(n=>n.id===l.id)))throw new HttpError('Received or completed return items cannot be removed.');
  if(current?.data.po && (d.clientId!==current.data.clientId||d.manufacturerId!==current.data.manufacturerId))throw new HttpError('Customer and manufacturer cannot change after a claims PO is issued.');
  if(current?.data.po && JSON.stringify(d.lines.map(l=>[l.id,l.sku,l.description,l.quantity,l.unitCost,l.finish,l.fabric]))!==JSON.stringify(current.data.lines.map(l=>[l.id,l.sku,l.description,l.quantity,l.unitCost,l.finish,l.fabric])))throw new HttpError('Items on an issued claims PO cannot be changed.');
  await lookupNames(admin,d);
 }else if(!current)throw new HttpError('Save the claim first.');
 else if(body.action==='generate_po'){
  if(d.po)throw new HttpError('This claim already has a PO.');
  d.po={number:`CPO-${current.claim_number}`,createdAt:now,acknowledgement:'',expectedShipDate:'',invoiceRequired:false,invoiceReference:'',freight:0,closedAt:''};d.status='Replacement Ordered';
 }else if(body.action==='update_po'){
  if(!d.po||d.po.closedAt)throw new HttpError('An open claims PO is required.');
  const p=body.po||{};if(typeof p.invoiceRequired!=='boolean'||!Number.isFinite(p.freight)||p.freight<0)throw new HttpError('Check the invoice setting and freight.');
  d.po={...d.po,acknowledgement:String(p.acknowledgement||'').slice(0,200),expectedShipDate:String(p.expectedShipDate||'').slice(0,10),invoiceRequired:p.invoiceRequired,invoiceReference:String(p.invoiceReference||'').slice(0,200),freight:p.freight};
 }else if(body.action==='receive'){
  if(!d.po||d.po.closedAt)throw new HttpError('An open claims PO is required.');
  const line=d.lines.find(l=>l.id===body.lineId),qty=Number(body.quantity);
  if(!line||!Number.isSafeInteger(qty)||qty<1||line.received+qty>line.quantity)throw new HttpError('Enter a whole quantity within the outstanding amount.');
  line.received+=qty;d.status=d.lines.every(l=>l.received===l.quantity)?'Received':'Partially Received';
 }else if(body.action==='disposition'){
  const line=d.lines.find(l=>l.id===body.lineId);if(!line||line.disposition==='Pending'||line.dispositionCompletedAt)throw new HttpError('Choose a disposition that has not been completed.');
  if(line.disposition==='Return to stock'){
   if(!line.inventoryId)throw new HttpError('Select the inventory item to return to stock.');
   const item=await admin.from('inventory_items').select('id,manufacturer_id,active').eq('id',line.inventoryId).single();
   if(item.error||!item.data.active||item.data.manufacturer_id!==d.manufacturerId)throw new HttpError('Select an active inventory item from this manufacturer.');
   inventoryId=line.inventoryId;quantity=line.quantity;
  }
  line.dispositionCompletedAt=now;
 }else if(body.action==='close_po'){
  if(!d.po||d.po.closedAt)throw new HttpError('An open claims PO is required.');
  if(d.lines.some(l=>l.received<l.quantity))throw new HttpError('Receive all replacement items before closing the claims PO.');
  if(d.po.invoiceRequired&&!d.po.invoiceReference.trim())throw new HttpError('Record an invoice reference, or choose no invoice expected.');d.po.closedAt=now;
 }else throw new HttpError('Unknown claims action.');
 if(d.status==='Closed'&&!canCloseClaim(d))throw new HttpError('Complete all return dispositions and close the claims PO first.');
 if(current?.data.status==='Closed')throw new HttpError('Closed claims cannot be changed.');
 d.history=[...(current?.data.history||[]),{at:now,by:profile.display_name||user.id,action:body.action}];
 const r=await admin.rpc('dp_save_warranty_claim',{p_id:current?.id||null,p_version:current?.version||0,p_data:d,p_actor:user.id,p_inventory_id:inventoryId,p_quantity:quantity});
 if(r.error)throw new HttpError(/another device/.test(r.error.message)?r.error.message:'Claim could not be saved. Refresh and retry.',/another device/.test(r.error.message)?409:503);
 const saved=r.data as Claim;
 // Keep the Hub save independent of Google's availability and latency.
 if(sheetConfigured()){
  after(async()=>{try{await sync(admin,saved.id);}catch{await admin.from('warranty_claims').update({sync_error:'Google Sheet sync failed. Use Retry sheet sync.'}).eq('id',saved.id);}});
 }else{
  saved.sync_error='Google Sheet connection needs a service account. Claim is saved; retry sync after setup.';
  await admin.from('warranty_claims').update({sync_error:saved.sync_error}).eq('id',saved.id);
 }
 return json({claim:saved});
 }catch(e){return fail(e);}}
