import { NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  STOCK_STATUSES, effectiveStockStatus, stockLineMarker, stockReceiptReason,
  remainingForLine, verifyStockOrderInput, type StockOrder, type StockOrderCatalog,
  type StockOrderInput, type StockOrderReceived, type StockReceiptInput
} from "../../stockOrders";

export const runtime="nodejs";
export const dynamic="force-dynamic";
const BUCKET="hub-stock-purchase-orders";
const ROOT="catalog";
const options={auth:{persistSession:false,autoRefreshToken:false}};
const response=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{"Cache-Control":"no-store"}});
class HttpError extends Error { constructor(message:string, public status:number){super(message);} }
const missing=(error:{status?:number;statusCode?:string|number;message?:string})=>
 String(error.statusCode||error.status)==="404"||/not found|does not exist/i.test(error.message||"");
const number=(v:unknown)=>Number.isFinite(Number(v))?Number(v):0;
const uuid=(v:string)=>/^[a-f0-9-]{36}$/i.test(v);
const statusRoles=new Set(["Owner","Manager","Assistant Manager","Shipping / Accounting"]);
type Context={admin:SupabaseClient;userId:string};

async function authenticated(request:Request):Promise<Context>{
 const token=request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
 if(!token)throw new HttpError("Sign in again to use stock purchase orders.",401);
 const url=process.env.NEXT_PUBLIC_SUPABASE_URL;
 const publishable=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
 const service=process.env.SUPABASE_SERVICE_ROLE_KEY||process.env.SUBABASE_SERVICE_ROLE_KEY;
 if(!url||!publishable||!service)throw new HttpError("Stock PO storage is not configured. Ask an administrator to check the Hub Supabase connection.",503);
 const auth=createClient(url,publishable,options);
 const {data:{user},error}=await auth.auth.getUser(token);
 if(error||!user)throw new HttpError("Sign in again to use stock purchase orders.",401);
 const admin=createClient(url,service,options);
 const {data:profile,error:profileError}=await admin.from("profiles").select("id,active,role,display_name").eq("id",user.id).single();
 if(profileError||!profile)throw new HttpError("Could not verify your active Hub profile.",503);
 if(profile.active!==true)throw new HttpError("An active Hub account is required.",403);
 if(!statusRoles.has(profile.role) && !/\bpamela\b/i.test(profile.display_name||""))
  throw new HttpError("Stock purchasing and receiving are limited to purchasing and management.",403);
 return {admin,userId:user.id};
}
async function store(admin:SupabaseClient){
 let {data,error}=await admin.storage.getBucket(BUCKET);
 if(error&&missing(error)){
  const created=await admin.storage.createBucket(BUCKET,{public:false,fileSizeLimit:10485760,allowedMimeTypes:["application/json"]});
  if(created.error&&!/already exists|duplicate/i.test(created.error.message))throw new Error("Private stock order storage could not be created.");
  ({data,error}=await admin.storage.getBucket(BUCKET));
 }
 if(error||!data||data.public)throw new Error("Private stock order storage is unavailable.");
 return admin.storage.from(BUCKET);
}
type Store=Awaited<ReturnType<typeof store>>;
async function catalog(bucket:Store):Promise<StockOrderCatalog>{
 const {data,error}=await bucket.list(ROOT,{limit:1,sortBy:{column:"name",order:"desc"}});
 if(error)throw new Error("Could not read shared stock purchase orders.");
 if(!data?.length)return {version:0,orders:[]};
 const {data:file,error:downloadError}=await bucket.download(`${ROOT}/${data[0].name}`);
 if(downloadError||!file)throw new Error("Could not load the latest stock PO catalog.");
 const saved=JSON.parse(await file.text()) as StockOrderCatalog;
 if(!Number.isSafeInteger(saved.version)||!Array.isArray(saved.orders))throw new Error("The saved stock PO catalog is invalid.");
 return saved;
}
async function write(bucket:Store,previous:StockOrderCatalog,orders:StockOrder[]){
 const next:StockOrderCatalog={version:previous.version+1,orders};
 const path=`${ROOT}/${String(next.version).padStart(12,"0")}.json`;
 const {error}=await bucket.upload(path,JSON.stringify(next),{contentType:"application/json",cacheControl:"0",upsert:false});
 if(error){
  if(String(error.statusCode)==="409"||/already exists|duplicate/i.test(error.message))throw new HttpError("Someone else updated stock orders. Refresh and retry.",409);
  throw new Error("Stock purchase orders could not be saved.");
 }
 return next;
}
async function inventoryInfo(admin:SupabaseClient,ids:string[]) {
 const result=new Map<string,{manufacturer_id:string|null;active:boolean;name:string;sku:string|null;unit_cost:number}>();
 for(let start=0;start<ids.length;start+=100){
  const {data,error}=await admin.from("inventory_items").select("id,manufacturer_id,active,name,sku,unit_cost").in("id",ids.slice(start,start+100));
  if(error)throw new HttpError("Inventory items could not be verified.",503);
  for(const row of data||[])result.set(row.id,row);
 }
 return result;
}
async function readReceipts(admin:SupabaseClient):Promise<StockOrderReceived>{
 const amounts:StockOrderReceived={};
 for(let start=0;start<30000;start+=1000){
  const {data,error}=await admin.from("inventory_movements")
   .select("notes,movement_type,quantity_change")
   .like("notes","stock-po:%")
   .order("created_at",{ascending:true})
   .range(start,start+999);
  if(error)throw new HttpError("Could not load stock receiving history.",503);
  const page=data||[];
  for(const row of page){
   const matched=/^stock-po:([a-f0-9-]{36}):([a-f0-9-]{36})$/i.exec(String(row.notes||""));
   if(matched && String(row.movement_type||"").toLowerCase()==="received")
    amounts[matched[2]]=(amounts[matched[2]]||0)+number(row.quantity_change);
  }
  if(page.length<1000)return amounts;
 }
 throw new HttpError("Stock receipt history is too large to calculate completely. Contact an administrator.",503);
}
function checkVersion(body:{version?:unknown},saved:StockOrderCatalog) {
 if(!Number.isSafeInteger(body.version) || body.version!==saved.version)
  throw new HttpError("Stock orders changed in another session. Refresh the page and retry.",409);
}
function safeMessage(error:unknown) {
 return error instanceof HttpError ? response({error:error.message},error.status) :
  response({error:error instanceof Error?error.message:"Stock order request failed. No changes were confirmed."},503);
}
function validInputs(input:unknown):input is StockOrderInput{
 if(!input||typeof input!=="object"||Array.isArray(input))return false;
 const v=input as StockOrderInput;
 if(typeof v.manufacturer_id!=="string"||typeof v.status!=="string"||typeof v.order_date!=="string")return false;
 if(v.estimated_ship_date!==null&&typeof v.estimated_ship_date!=="string")return false;
 if(v.notes!==null&&typeof v.notes!=="string")return false;
 if(!Array.isArray(v.lines)||v.lines.length>150)return false;
 return v.lines.every(line=>line && typeof line.id==="string"&&typeof line.inventory_item_id==="string" &&
   typeof line.name==="string"&&typeof line.sku==="string"&&typeof line.quantity==="number"&&typeof line.unit_cost==="number");
}
async function checkedInput(admin:SupabaseClient,raw:unknown){
 if(!validInputs(raw))throw new HttpError("Complete the stock PO vendor, dates and inventory items.",400);
 const inv=await inventoryInfo(admin,raw.lines.map(l=>l.inventory_item_id));
 const error=verifyStockOrderInput(raw,inv);
 if(error)throw new HttpError(error,400);
 const {data:manufacturer,error:manufacturerError}=await admin.from("manufacturers").select("id").eq("id",raw.manufacturer_id).maybeSingle();
 if(manufacturerError||!manufacturer)throw new HttpError("Select a valid manufacturer.",400);
 const items=raw.lines.map(line=>{
  const item=inv.get(line.inventory_item_id)!;
  return {id:line.id,inventory_item_id:line.inventory_item_id,name:item.name,sku:item.sku||"",quantity:line.quantity,unit_cost:line.unit_cost};
 });
 return {...raw,estimated_ship_date:raw.estimated_ship_date||null,notes:raw.notes?.trim()||null,lines:items};
}
async function lockOrder(bucket:Store,orderId:string,receiptId:string){
 const path=`locks/${orderId}.json`;
 const body=JSON.stringify({receiptId,created_at:new Date().toISOString()});
 let result=await bucket.upload(path,body,{contentType:"application/json",upsert:false,cacheControl:"0"});
 if(result.error){
  if(!/exists|duplicate|conflict|already/i.test(result.error.message)&&String(result.error.statusCode)!=="409")
    throw new Error("Could not lock stock receipt for processing.");
  const {data}=await bucket.download(path);
  const existing=data?JSON.parse(await data.text()) as {created_at?:string}:null;
  const age=existing?.created_at?Date.now()-new Date(existing.created_at).getTime():0;
  if(!existing||!Number.isFinite(age)||age<180000)throw new HttpError("A receipt for this stock PO is already being processed. Try again shortly.",409);
  const removed=await bucket.remove([path]);
  if(removed.error)throw new HttpError("A previous stock receipt needs administrator attention before receiving again.",409);
  result=await bucket.upload(path,body,{contentType:"application/json",upsert:false,cacheControl:"0"});
  if(result.error)throw new HttpError("Another stock receipt is in progress. Refresh and retry.",409);
 }
 return path;
}
async function receive(admin:SupabaseClient,bucket:Store,body:{
 order_id?:string;receipt_id?:string;lines?:StockReceiptInput[];version?:number;
},saved:StockOrderCatalog,userId:string){
 if(!body.order_id||!uuid(body.order_id)||!body.receipt_id||!uuid(body.receipt_id)||!Array.isArray(body.lines)||
  body.lines.length===0||body.lines.length>150)throw new HttpError("Select valid stock receipt quantities.",400);
 const order=saved.orders.find(po=>po.id===body.order_id);
 if(!order)throw new HttpError("Stock purchase order not found.",404);
 if(order.status==="Draft"||order.status==="Cancelled")throw new HttpError("Submit the stock PO before receiving inventory.",400);
 const seen=new Set<string>();
 for(const entry of body.lines){
  if(!entry||!uuid(entry.line_id)||!Number.isSafeInteger(entry.quantity)||entry.quantity<=0||entry.quantity>100000 ||
    seen.has(entry.line_id)||!order.lines.some(line=>line.id===entry.line_id))
   throw new HttpError("Every receiving line needs a unique item and positive whole-number quantity.",400);
  seen.add(entry.line_id);
 }
 const lock=await lockOrder(bucket,order.id,body.receipt_id);
 const completed:string[]=[];
 try{
  const afterLock=await catalog(bucket);
  const active=afterLock.orders.find(po=>po.id===order.id);
  if(!active||active.status==="Draft"||active.status==="Cancelled")
   throw new HttpError("Stock PO has changed. Refresh before receiving.",409);
  const history=await readReceipts(admin);
  for(const entry of body.lines){
   const line=active.lines.find(item=>item.id===entry.line_id);
   if(!line)throw new HttpError("One of the stock order lines has changed. Refresh before receiving.",409);
   const note=stockLineMarker(active.id,line.id);
   const reason=stockReceiptReason(body.receipt_id);
   // Retry of the SAME receipt ID must not increment stock twice.
   const {data:prior,error:priorError}=await admin.from("inventory_movements")
     .select("id,quantity_change").eq("notes",note).eq("reason",reason).limit(1);
   if(priorError)throw new HttpError("Could not verify earlier receiving entries.",503);
   if(prior?.length){
    if(number(prior[0].quantity_change)!==entry.quantity)throw new HttpError("The receipt reference was already used for a different quantity.",409);
    completed.push(line.id);continue;
   }
   if(entry.quantity>remainingForLine(line,history))
    throw new HttpError(`Only ${remainingForLine(line,history)} units remain to receive for ${line.name}. Refresh the order.`,409);
   let updated=false;
   for(let attempt=0;attempt<4&&!updated;attempt++){
    const {data:item,error:itemError}=await admin.from("inventory_items")
      .select("id,quantity_on_hand,manufacturer_id,location,active,name,unit_cost").eq("id",line.inventory_item_id).maybeSingle();
    if(itemError||!item||item.active===false)
     throw new HttpError(`Inventory item ${line.name} is missing or inactive. Receiving has stopped.`,409);
    if(item.manufacturer_id!==active.manufacturer_id)
     throw new HttpError(`Manufacturer mismatch for ${line.name}. Receiving has stopped.`,409);
    const before=number(item.quantity_on_hand),after=before+entry.quantity;
    const oldCost=Math.max(0,number(item.unit_cost));
    const lineCost=Math.max(0,number(line.unit_cost));
    // Weighted average cost keeps the inventory valuation aligned with receipts
    // while preserving the pre-existing on-hand cost basis.
    const averageCost=Math.round(((Math.max(0,before)*oldCost)+(entry.quantity*lineCost))/Math.max(1,after)*100)/100;
    const {data:changed,error:updateError}=await admin.from("inventory_items")
      .update({quantity_on_hand:after,unit_cost:averageCost,updated_at:new Date().toISOString()})
      .eq("id",item.id).eq("quantity_on_hand",before).eq("unit_cost",item.unit_cost).select("id").maybeSingle();
    if(updateError)throw new HttpError(`Could not update stock quantity for ${line.name}.`,503);
    if(!changed)continue;
    const movement=await admin.from("inventory_movements").insert({
      inventory_item_id:item.id,movement_type:"Received",
      quantity_change:entry.quantity,quantity_before:before,quantity_after:after,
      to_location:item.location||null,
      reason,notes:note,created_by:userId
    }).select("id").single();
    if(movement.error||!movement.data){
      const rollback=await admin.from("inventory_items")
        .update({quantity_on_hand:before,unit_cost:oldCost,updated_at:new Date().toISOString()})
        .eq("id",item.id).eq("quantity_on_hand",after).eq("unit_cost",averageCost).select("id").maybeSingle();
      if(rollback.error||!rollback.data)
       throw new HttpError(`URGENT: Inventory was incremented for ${line.name} but its receipt history failed and automatic reversal did not complete. Verify inventory quantity before another receipt.`,503);
      throw new HttpError(`Stock for ${line.name} could not be recorded in movement history. The quantity change was reversed.`,503);
    }
    completed.push(line.id);
    history[line.id]=(history[line.id]||0)+entry.quantity;
    updated=true;
   }
   if(!updated)throw new HttpError(`Inventory for ${line.name} was edited concurrently. Retry receiving.`,409);
  }
  return response({ok:true,received:await readReceipts(admin),completed,order_id:order.id},200);
 }catch(error){
  const detail=error instanceof Error?error.message:"Unexpected stock receiving error.";
  if(completed.length) return response({error:`${detail} Some items were received successfully. Refresh the order before receiving again.`,completed,partial:true},409);
  throw error;
 }finally{
  // Locks are short-lived and unique per order, preventing parallel receives.
  await bucket.remove([lock]);
 }
}
export async function GET(request:Request) {
 try {
  const {admin}=await authenticated(request);
  const bucket=await store(admin);
  const saved=await catalog(bucket);
  const received=await readReceipts(admin);
  return response({version:saved.version,orders:saved.orders,received});
 } catch(error){return safeMessage(error);}
}
export async function POST(request:Request) {
 try{
  const {admin,userId}=await authenticated(request);
  const raw=await request.text();
  if(Buffer.byteLength(raw,"utf8")>131072)throw new HttpError("Stock order request is too large.",413);
  let body:Record<string,unknown>;
  try{body=JSON.parse(raw);}catch{throw new HttpError("Invalid stock order request.",400);}
  if(!body||typeof body!=="object"||typeof body.action!=="string")
   throw new HttpError("Choose a valid stock order action.",400);
  if(body.action==="create_item"){
   const item=body.item as Record<string,unknown>|undefined;
   if(!item||typeof item.name!=="string"||typeof item.manufacturer_id!=="string"||!item.name.trim()||
      !item.manufacturer_id||item.name.length>180||
      (item.sku!==undefined&&typeof item.sku!=="string")||
      (item.description!==undefined&&typeof item.description!=="string")||
      (item.location!==undefined&&typeof item.location!=="string")||
      (item.unit_cost!==undefined&&typeof item.unit_cost!=="number")||
      (item.msrp!==undefined&&typeof item.msrp!=="number")||
      number(item.unit_cost)<0||number(item.msrp)<0||number(item.unit_cost)>100000000||number(item.msrp)>100000000)
     throw new HttpError("Enter an item name, manufacturer and valid non-negative cost.",400);
   const {data:maker,error:makerError}=await admin.from("manufacturers").select("id").eq("id",item.manufacturer_id).maybeSingle();
   if(makerError||!maker)throw new HttpError("Choose a valid inventory manufacturer.",400);
   const {data:created,error}=await admin.from("inventory_items").insert({
    name:item.name.trim(),manufacturer_id:item.manufacturer_id,sku:String(item.sku||"").trim()||null,
    description:String(item.description||"").trim()||null,location:String(item.location||"").trim()||null,
    unit_cost:number(item.unit_cost),msrp:number(item.msrp),quantity_on_hand:0,active:true
   }).select("id,name,sku,manufacturer_id,unit_cost,quantity_on_hand,active,location").single();
   if(error||!created)throw new HttpError(`Could not create inventory item: ${error?.message||"unknown error"}`,503);
   return response({item:created},201);
  }
  const bucket=await store(admin);
  const saved=await catalog(bucket);
  if(body.action==="receive")return await receive(admin,bucket,body as {order_id?:string;receipt_id?:string;lines?:StockReceiptInput[];version?:number},saved,userId);
  checkVersion(body,saved);
  if(body.action==="create"){
   if(saved.orders.length>=3000)throw new HttpError("Stock order catalog limit reached. Contact an administrator.",409);
   const input=await checkedInput(admin,body.order);
   const number=saved.orders.reduce((max,po)=>Math.max(max,po.sequence),0)+1;
   const stamp=new Date().toISOString();
   const order:StockOrder={...input,id:crypto.randomUUID(),sequence:number,created_at:stamp,updated_at:stamp,created_by:userId};
   const next=await write(bucket,saved,[...saved.orders,order]);
   return response({catalog:next,order},201);
  }
  if(body.action==="update"||body.action==="status"){
   const id=body.order_id;
   if(typeof id!=="string"||!uuid(id))throw new HttpError("Choose a valid stock purchase order.",400);
   const index=saved.orders.findIndex(po=>po.id===id);
   if(index<0)throw new HttpError("Stock order does not exist.",404);
   const old=saved.orders[index];
   const received=await readReceipts(admin);
   const delivered=old.lines.some(line=>(received[line.id]||0)>0);
   if(body.action==="update"){
    if(delivered)throw new HttpError("Received stock POs cannot be edited. Record any changes through inventory adjustments.",409);
    if(old.status==="Cancelled")throw new HttpError("Cancelled stock POs cannot be edited.",409);
    const input=await checkedInput(admin,body.order);
    const replacement:StockOrder={...old,...input,updated_at:new Date().toISOString()};
    const next=await write(bucket,saved,saved.orders.map((po,i)=>i===index?replacement:po));
    return response({catalog:next,order:replacement});
   }
   const newStatus=body.status;
   if(typeof newStatus!=="string"||!STOCK_STATUSES.includes(newStatus as StockOrder["status"]))
    throw new HttpError("Choose a valid stock PO status.",400);
   if(delivered&&(newStatus==="Draft"||newStatus==="Cancelled"))
    throw new HttpError("Partially received orders cannot be returned to Draft or Cancelled.",409);
   if(effectiveStockStatus(old,received)==="Received")
    throw new HttpError("Fully received stock POs cannot change their status.",409);
   const updated:StockOrder={...old,status:newStatus as StockOrder["status"],updated_at:new Date().toISOString()};
   const next=await write(bucket,saved,saved.orders.map((po,i)=>i===index?updated:po));
   return response({catalog:next,order:updated});
  }
  throw new HttpError("This stock PO action is not supported.",400);
 }catch(error){return safeMessage(error);}
}
