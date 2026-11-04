"use client";

import { useEffect, useMemo, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  STOCK_STATUSES, effectiveStockStatus, remainingForLine, stockOrderTotals,
  stockRef, type StockOrder, type StockOrderInput, type StockOrderLine, type StockOrderReceived
} from "./stockOrders";
import styles from "./StockPurchaseOrders.module.css";

export type StockInventoryItem = {
  id:string; name:string; sku:string|null; manufacturer_id:string|null;
  quantity_on_hand:number; unit_cost:number; msrp:number; active:boolean;
  location:string|null;
};
type Manufacturer={id:string;name:string;active:boolean|null};
type Props={
  supabase:SupabaseClient|null;
  orders:StockOrder[]; received:StockOrderReceived; version:number;
  loading:boolean; error:string;
  inventory:StockInventoryItem[]; manufacturers:Manufacturer[];
  openOrderId:string|null; onOpenOrderHandled:()=>void;
  onRefresh:()=>Promise<void>; onInventoryCreated:()=>Promise<void>;
};
const dollars=(n:number)=>n.toLocaleString("en-US",{style:"currency",currency:"USD"});
const localDay=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;};
const newDraft=():StockOrderInput=>({manufacturer_id:"",status:"Draft",order_date:localDay(),estimated_ship_date:null,notes:null,lines:[]});
const newItem=()=>({name:"",sku:"",description:"",location:"",unit_cost:"0",msrp:"0"});
const statuses=STOCK_STATUSES.filter(s=>s!=="Cancelled");
export default function StockPurchaseOrders(props:Props){
 const [selectedId,setSelectedId]=useState<string|null>(null);
 const [editing,setEditing]=useState(false);
 const [draft,setDraft]=useState<StockOrderInput>(newDraft);
 const [search,setSearch]=useState("");
 const [vendorItemSearch,setVendorItemSearch]=useState("");
 const [chosenItem,setChosenItem]=useState("");
 const [chosenQty,setChosenQty]=useState("1");
 const [chosenCost,setChosenCost]=useState("");
 const [newItemOpen,setNewItemOpen]=useState(false);
 const [itemDraft,setItemDraft]=useState(newItem);
 const [receiptQty,setReceiptQty]=useState<Record<string,string>>({});
 const [saving,setSaving]=useState(false);
 const [error,setError]=useState("");
 const [success,setSuccess]=useState("");

 const selected=props.orders.find(po=>po.id===selectedId)||null;
 const names=useMemo(()=>Object.fromEntries(props.manufacturers.map(m=>[m.id,m.name])),[props.manufacturers]);
 const vendorItems=useMemo(()=>props.inventory.filter(item=>item.active!==false&&item.manufacturer_id===draft.manufacturer_id)
   .filter(item=>!vendorItemSearch.trim() || `${item.name} ${item.sku||""}`.toLowerCase().includes(vendorItemSearch.trim().toLowerCase()))
   .sort((a,b)=>a.name.localeCompare(b.name)),[props.inventory,draft.manufacturer_id,vendorItemSearch]);
 const availableItems=vendorItems.filter(item=>!draft.lines.some(line=>line.inventory_item_id===item.id));
 const sorted=useMemo(()=>[...props.orders].sort((a,b)=>b.sequence-a.sequence)
   .filter(po=>!search.trim() || [stockRef(po.sequence),names[po.manufacturer_id],po.status,po.order_date,...po.lines.map(l=>l.name)]
   .join(" ").toLowerCase().includes(search.trim().toLowerCase())),[props.orders,search,names]);
 useEffect(()=>{
  if(props.openOrderId){
   setSelectedId(props.openOrderId);setEditing(false);setNewItemOpen(false);setError("");setSuccess("");
   props.onOpenOrderHandled();
  }
 },[props.openOrderId,props.onOpenOrderHandled]);

 async function request(body:Record<string,unknown>){
  if(!props.supabase)throw new Error("Sign in again to manage stock orders.");
  const auth=await props.supabase.auth.getSession();
  const token=auth.data.session?.access_token;
  if(!token)throw new Error("Your Hub login has expired. Sign in again.");
  const resp=await fetch("/api/stock-orders",{
   method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${token}`},
   body:JSON.stringify(body),cache:"no-store"
  });
  const data=await resp.json().catch(()=>({error:"Invalid response from stock purchasing."}));
  if(!resp.ok)throw new Error(data.error||"Stock purchasing action failed.");
  return data;
 }
 async function run(work:()=>Promise<void>){
  if(saving)return;
  setSaving(true);setError("");setSuccess("");
  try{await work();}
  catch(e){setError(e instanceof Error?e.message:"Stock order action failed.");}
  finally{setSaving(false);}
 }
 function openNew(){
  setSelectedId(null);setDraft(newDraft());setEditing(true);setNewItemOpen(false);
  setVendorItemSearch("");setChosenItem("");setChosenQty("1");setChosenCost("");
  setError("");setSuccess("");
 }
 function openExisting(po:StockOrder){
  setSelectedId(po.id);setEditing(false);setNewItemOpen(false);
  setReceiptQty(Object.fromEntries(po.lines.map(line=>[line.id,String(remainingForLine(line,props.received))])));
  setError("");setSuccess("");
 }
 function editExisting(po:StockOrder){
  setSelectedId(po.id);
  setDraft({manufacturer_id:po.manufacturer_id,status:po.status,order_date:po.order_date,
    estimated_ship_date:po.estimated_ship_date,notes:po.notes,
    lines:po.lines.map(line=>({...line}))});
  setEditing(true);setNewItemOpen(false);setChosenItem("");setChosenQty("1");setChosenCost("");setVendorItemSearch("");
  setError("");setSuccess("");
 }
 function addItemLine(){
  const item=props.inventory.find(x=>x.id===chosenItem);
  const qty=Number(chosenQty),cost=Number(chosenCost);
  if(!item||item.active===false||item.manufacturer_id!==draft.manufacturer_id){
   setError("Choose an active inventory item from the selected manufacturer.");return;
  }
  if(draft.lines.some(line=>line.inventory_item_id===item.id)){
   setError("This inventory item is already on the PO. Edit its quantity instead.");return;
  }
  if(!Number.isSafeInteger(qty)||qty<1||qty>100000||!Number.isFinite(cost)||cost<0){
   setError("Enter a whole-number quantity and valid, non-negative unit cost.");return;
  }
  const line:StockOrderLine={id:crypto.randomUUID(),inventory_item_id:item.id,name:item.name,sku:item.sku||"",quantity:qty,unit_cost:cost};
  setDraft(current=>({...current,lines:[...current.lines,line]}));
  setChosenItem("");setChosenQty("1");setChosenCost("");setError("");
 }
 async function saveOrder(){
  await run(async()=>{
   if(!draft.manufacturer_id||!draft.lines.length)throw new Error("Choose a manufacturer and add at least one inventory item.");
   for(const line of draft.lines){
    if(!Number.isSafeInteger(line.quantity)||line.quantity<=0||!Number.isFinite(line.unit_cost)||line.unit_cost<0)
     throw new Error("All stock PO quantities and costs must be valid.");
   }
   const data=await request({action:selectedId?"update":"create",version:props.version,order_id:selectedId,order:draft});
   setSelectedId(data.order.id);setEditing(false);setNewItemOpen(false);
   setReceiptQty({});
   await props.onRefresh();
   setSuccess(`${stockRef(data.order.sequence)} saved.`);
  });
 }
 async function changeStatus(po:StockOrder,status:string){
  await run(async()=>{
   if(!window.confirm(`Change ${stockRef(po.sequence)} to ${status}?`))return;
   await request({action:"status",version:props.version,order_id:po.id,status});
   await props.onRefresh();
   setSuccess(`${stockRef(po.sequence)} updated to ${status}.`);
  });
 }
 async function createInventory(){
  await run(async()=>{
   if(!draft.manufacturer_id)throw new Error("Choose a manufacturer before creating inventory.");
   if(!itemDraft.name.trim())throw new Error("Enter the inventory item name.");
   if(!Number.isFinite(Number(itemDraft.unit_cost))||Number(itemDraft.unit_cost)<0||
      !Number.isFinite(Number(itemDraft.msrp))||Number(itemDraft.msrp)<0)
    throw new Error("Inventory cost and MSRP must be valid non-negative numbers.");
   const data=await request({action:"create_item",item:{...itemDraft,manufacturer_id:draft.manufacturer_id,unit_cost:Number(itemDraft.unit_cost),msrp:Number(itemDraft.msrp)}});
   await props.onInventoryCreated();
   const item=data.item as StockInventoryItem;
   setChosenItem(item.id);setChosenCost(String(item.unit_cost));
   setItemDraft(newItem());setNewItemOpen(false);
   setSuccess(`${item.name} was added to Inventory with zero units on hand. Choose quantity and add it to this PO.`);
  });
 }
 async function receive(po:StockOrder){
  await run(async()=>{
   const lines=po.lines.map(line=>({line_id:line.id,quantity:Number(receiptQty[line.id]||0)}))
     .filter(line=>line.quantity>0);
   if(!lines.length)throw new Error("Enter quantities for the items that arrived.");
   for(const line of lines){
    const ordered=po.lines.find(x=>x.id===line.line_id)!;
    if(!Number.isSafeInteger(line.quantity)||line.quantity>remainingForLine(ordered,props.received))
     throw new Error(`You can receive at most ${remainingForLine(ordered,props.received)} units of ${ordered.name}.`);
   }
   const total=lines.reduce((sum,line)=>sum+line.quantity,0);
   if(!window.confirm(`Receive ${total} stock ${total===1?"unit":"units"} from ${stockRef(po.sequence)} into Inventory? This updates on-hand quantities and creates inventory movement history.`))return;
   try{
    await request({action:"receive",order_id:po.id,receipt_id:crypto.randomUUID(),lines});
   }catch(e){
    await Promise.all([props.onRefresh(),props.onInventoryCreated()]);
    throw e;
   }
   await Promise.all([props.onRefresh(),props.onInventoryCreated()]);
   setReceiptQty({});
   setSuccess(`${total} ${total===1?"unit":"units"} received. Inventory quantities and receiving history have been updated.`);
  });
 }
 return <div className={styles.root}>
  <div className={styles.hero}>
   <div><div className={styles.eyebrow}>PURCHASING · SHOWROOM & WAREHOUSE STOCK</div>
    <h1>Stock Purchase Orders</h1>
    <p>Create stock orders independent of client sales, select or add inventory products, and receive deliveries directly into inventory.</p>
   </div>
   <div className={styles.actions}><button onClick={()=>void props.onRefresh()} disabled={saving||props.loading}>↻ Refresh</button>
    <button className={styles.primary} onClick={openNew} disabled={saving}>＋ New stock PO</button></div>
  </div>
  {props.error && <p className={styles.error} role="alert">{props.error}</p>}
  {error && <p className={styles.error} role="alert">{error}</p>}
  {success && <p className={styles.success} role="status">{success}</p>}
  <div className={styles.summary}>
    <div><span>STOCK PURCHASE ORDERS</span><strong>{props.orders.length}</strong></div>
    <div><span>ACTIVE / INCOMING</span><strong>{props.orders.filter(po=>po.status!=="Draft"&&po.status!=="Cancelled"&&effectiveStockStatus(po,props.received)!=="Received").length}</strong></div>
    <div><span>VALUE STILL ON ORDER</span><strong>{dollars(props.orders.filter(po=>po.status!=="Draft"&&po.status!=="Cancelled").reduce((sum,po)=>sum+stockOrderTotals(po,props.received).pending,0))}</strong></div>
  </div>
  <div className={styles.layout}>
   <section className={styles.list}>
    <div className={styles.listHeading}><h2>Stock orders</h2><input aria-label="Search stock POs" type="search" placeholder="Find PO, vendor, status or item…" value={search} onChange={e=>setSearch(e.target.value)}/></div>
    {props.loading ? <p className={styles.empty}>Loading stock orders…</p> : sorted.length===0 ?
     <p className={styles.empty}>No stock orders match your search. Create one to start tracking incoming inventory.</p> :
     sorted.map(po=>{const totals=stockOrderTotals(po,props.received);
       return <button key={po.id} onClick={()=>openExisting(po)} className={`${styles.poRow} ${po.id===selectedId?styles.selected:""}`}>
        <div><strong>{stockRef(po.sequence)}</strong><span>{names[po.manufacturer_id]||"Vendor"}</span></div>
        <div className={styles.right}><span>{effectiveStockStatus(po,props.received)}</span><strong>{dollars(totals.pending)}</strong><small>{totals.remainingUnits} of {totals.orderedUnits} units to receive</small></div>
       </button>;
     })}
   </section>
   <section className={styles.detail}>
    {editing ? <div className={styles.editor}>
      <div className={styles.detailHeading}><div className={styles.eyebrow}>{selectedId?"EDIT STOCK PO":"NEW STOCK PO"}</div>
       <h2>{selectedId?stockRef(selected?.sequence||0):"Build a stock purchase order"}</h2></div>
      <div className={styles.formGrid}>
       <label>Manufacturer <select value={draft.manufacturer_id} disabled={Boolean(selectedId)} onChange={e=>{setDraft(v=>({...v,manufacturer_id:e.target.value,lines:[]}));setChosenItem("");setChosenCost("");}}>
        <option value="">Choose a vendor…</option>
        {props.manufacturers.filter(m=>m.active!==false||m.id===draft.manufacturer_id).sort((a,b)=>a.name.localeCompare(b.name)).map(m=><option key={m.id} value={m.id}>{m.name}</option>)}
       </select></label>
       <label>Order date <input type="date" value={draft.order_date} onChange={e=>setDraft(v=>({...v,order_date:e.target.value}))}/></label>
       <label>Status <select value={draft.status} onChange={e=>setDraft(v=>({...v,status:e.target.value as StockOrderInput["status"]}))}>
        {statuses.map(status=><option key={status} value={status}>{status}</option>)}
       </select></label>
       <label>Estimated ship date <input type="date" value={draft.estimated_ship_date||""} onChange={e=>setDraft(v=>({...v,estimated_ship_date:e.target.value||null}))}/></label>
      </div>
      <label className={styles.noteLabel}>PO notes <textarea rows={2} value={draft.notes||""} maxLength={4000} onChange={e=>setDraft(v=>({...v,notes:e.target.value}))} placeholder="Acknowledgements, showroom stock details, special instructions…"/></label>
      <div className={styles.sectionTitle}><h3>Products on this stock PO</h3><span>{draft.lines.length} items</span></div>
      {draft.lines.length===0 ? <p className={styles.empty}>Add the inventory pieces that you are purchasing for stock.</p> :
       <div className={styles.lines}>{draft.lines.map(line=><div key={line.id} className={styles.line}>
        <div><strong>{line.name}</strong><span>{line.sku || "No SKU"}</span></div>
        <label>Qty <input type="number" min="1" max="100000" step="1" value={line.quantity} onChange={e=>setDraft(v=>({...v,lines:v.lines.map(l=>l.id===line.id?{...l,quantity:Number(e.target.value)}:l)}))}/></label>
        <label>Unit cost <input type="number" min="0" step=".01" value={line.unit_cost} onChange={e=>setDraft(v=>({...v,lines:v.lines.map(l=>l.id===line.id?{...l,unit_cost:Number(e.target.value)}:l)}))}/></label>
        <strong>{dollars(line.quantity*line.unit_cost)}</strong>
        <button className={styles.removeLine} type="button" onClick={()=>setDraft(v=>({...v,lines:v.lines.filter(l=>l.id!==line.id)}))} aria-label={`Remove ${line.name}`}>×</button>
       </div>)}</div>}
      <div className={styles.addLineSection}>
       <h3>Add an inventory item</h3>
       <input type="search" placeholder="Filter this manufacturer's inventory by name or SKU" aria-label="Filter inventory items" value={vendorItemSearch} onChange={e=>setVendorItemSearch(e.target.value)} disabled={!draft.manufacturer_id}/>
       <div className={styles.addLineGrid}>
        <label>Inventory item <select value={chosenItem} disabled={!draft.manufacturer_id} onChange={e=>{const id=e.target.value;setChosenItem(id);setChosenCost(String(props.inventory.find(item=>item.id===id)?.unit_cost ?? ""));}}>
         <option value="">Choose an existing item…</option>
         {availableItems.slice(0,500).map(item=><option key={item.id} value={item.id}>{item.name}{item.sku?" · "+item.sku:""} (on hand: {item.quantity_on_hand})</option>)}
         {chosenItem&&!availableItems.some(item=>item.id===chosenItem)&&props.inventory.some(item=>item.id===chosenItem) && <option value={chosenItem}>{props.inventory.find(item=>item.id===chosenItem)?.name}</option>}
        </select></label>
        <label>Quantity <input type="number" step="1" min="1" value={chosenQty} onChange={e=>setChosenQty(e.target.value)}/></label>
        <label>Unit cost <input type="number" step=".01" min="0" value={chosenCost} onChange={e=>setChosenCost(e.target.value)}/></label>
       </div>
       <div className={styles.actions}><button type="button" onClick={addItemLine} disabled={!chosenItem}>＋ Add item to PO</button>
        <button type="button" onClick={()=>{setNewItemOpen(v=>!v);setItemDraft(newItem());}} disabled={!draft.manufacturer_id}>
         {newItemOpen?"Close new item":"＋ Create new inventory item"}</button></div>
       {newItemOpen && <div className={styles.newItem}>
        <h3>New inventory item (starts with 0 on hand)</h3>
        <div className={styles.formGrid}>
         <label>Name <input required value={itemDraft.name} maxLength={180} onChange={e=>setItemDraft(v=>({...v,name:e.target.value}))}/></label>
         <label>SKU <input value={itemDraft.sku} maxLength={100} onChange={e=>setItemDraft(v=>({...v,sku:e.target.value}))}/></label>
         <label>Location <input value={itemDraft.location} maxLength={140} placeholder="Showroom, warehouse…" onChange={e=>setItemDraft(v=>({...v,location:e.target.value}))}/></label>
         <label>Unit cost <input type="number" min="0" step=".01" value={itemDraft.unit_cost} onChange={e=>setItemDraft(v=>({...v,unit_cost:e.target.value}))}/></label>
         <label>MSRP <input type="number" min="0" step=".01" value={itemDraft.msrp} onChange={e=>setItemDraft(v=>({...v,msrp:e.target.value}))}/></label>
         <label>Description <input value={itemDraft.description} maxLength={1500} onChange={e=>setItemDraft(v=>({...v,description:e.target.value}))}/></label>
        </div>
        <button type="button" onClick={()=>void createInventory()} disabled={saving||!itemDraft.name.trim()} className={styles.primary}>{saving?"Saving…":"Save new inventory item"}</button>
       </div>}
      </div>
      <div className={styles.total}><span>Stock merchandise ordered at cost</span><strong>{dollars(draft.lines.reduce((sum,line)=>sum+line.quantity*line.unit_cost,0))}</strong></div>
      <div className={styles.actions}><button type="button" className={styles.primary} onClick={()=>void saveOrder()} disabled={saving||!draft.lines.length}>{saving?"Saving…":selectedId?"Save stock PO":"Create stock PO"}</button>
        <button type="button" onClick={()=>{setEditing(false);setError("");}} disabled={saving}>Cancel</button></div>
    </div> : selected ? <div>
      <div className={styles.detailHeading}><div className={styles.eyebrow}>STOCK PURCHASE ORDER</div>
       <h2>{stockRef(selected.sequence)}</h2><p>{names[selected.manufacturer_id]||"Vendor"} · {selected.order_date}</p></div>
      <div className={styles.statusRow}><span className={styles.status}>{effectiveStockStatus(selected,props.received)}</span>
       <span>Estimated ship: {selected.estimated_ship_date||"Not set"}</span>
      </div>
      <div className={styles.total}><span>Original merchandise cost</span><strong>{dollars(stockOrderTotals(selected,props.received).ordered)}</strong></div>
      <div className={styles.total}><span>Remaining stock on order</span><strong>{dollars(stockOrderTotals(selected,props.received).pending)}</strong></div>
      <div className={styles.actionBar}>
       {effectiveStockStatus(selected,props.received)!=="Received" && selected.status!=="Cancelled" &&
        <button onClick={()=>editExisting(selected)} disabled={saving}>Edit PO</button>}
       {selected.status==="Draft" &&
        <button className={styles.primary} disabled={saving} onClick={()=>void changeStatus(selected,"Submitted")}>Submit PO</button>}
       {selected.status!=="Draft"&&selected.status!=="Cancelled"&&effectiveStockStatus(selected,props.received)!=="Received" &&
        <label>Update status <select value={selected.status} disabled={saving} onChange={e=>void changeStatus(selected,e.target.value)}>
         {statuses.filter(s=>s!=="Draft").map(s=><option value={s} key={s}>{s}</option>)}
        </select></label>}
       {selected.status!=="Cancelled"&&effectiveStockStatus(selected,props.received)!=="Received"&&selected.lines.every(l=>remainingForLine(l,props.received)===l.quantity) &&
        <button disabled={saving} onClick={()=>void changeStatus(selected,"Cancelled")}>Cancel PO</button>}
      </div>
      {selected.notes && <p className={styles.note}>{selected.notes}</p>}
      <div className={styles.sectionTitle}><h3>Receiving inventory</h3><span>Receive all or part of a delivery</span></div>
      <div className={styles.receiveTable}>
       <div className={styles.receiveHeader}><span>PRODUCT</span><span>ORDERED</span><span>RECEIVED</span><span>REMAINING</span><span>RECEIVE NOW</span></div>
       {selected.lines.map(line=>{const received=line.quantity-remainingForLine(line,props.received);const outstanding=remainingForLine(line,props.received);
        return <div className={styles.receiveLine} key={line.id}>
          <div><strong>{line.name}</strong><span>{line.sku||"No SKU"} · {dollars(line.unit_cost)}/unit</span></div>
          <div>{line.quantity}</div><div>{received}</div><div><strong>{outstanding}</strong></div>
          <div><input type="number" min="0" max={outstanding} step="1" aria-label={`Receive quantity for ${line.name}`}
           value={receiptQty[line.id]===undefined?String(outstanding):receiptQty[line.id]}
           onChange={e=>setReceiptQty(v=>({...v,[line.id]:e.target.value}))}
           disabled={saving||outstanding===0||selected.status==="Draft"||selected.status==="Cancelled"}/></div>
        </div>;
       })}
      </div>
      {effectiveStockStatus(selected,props.received)==="Received" ? <p className={styles.success}>All ordered stock has been received into inventory.</p> :
       selected.status==="Draft" ? <p className={styles.hint}>Submit this stock PO before receiving a delivery.</p> :
       selected.status==="Cancelled" ? <p className={styles.hint}>Cancelled POs cannot be received.</p> :
       <div className={styles.actions}><button type="button" className={styles.primary} disabled={saving||!selected.lines.some(line=>remainingForLine(line,props.received)>0)}
         onClick={()=>void receive(selected)}>{saving?"Receiving…":"✓ Receive selected into inventory"}</button>
        <button type="button" disabled={saving} onClick={()=>setReceiptQty(Object.fromEntries(selected.lines.map(line=>[line.id,"0"])))}>Clear quantities</button>
        <button type="button" disabled={saving} onClick={()=>setReceiptQty(Object.fromEntries(selected.lines.map(line=>[line.id,String(remainingForLine(line,props.received))])))}>All remaining</button>
       </div>}
      <p className={styles.hint}>Receiving raises on-hand inventory quantities and creates an auditable movement for every received item. Partially received POs stay open for the balance.</p>
    </div> : <div className={styles.emptyDetail}><h2>Choose or create a stock PO</h2><p>Select a stock order from the left, or start a new one to order showroom and warehouse inventory.</p>
      <button className={styles.primary} onClick={openNew}>＋ New stock PO</button></div>}
   </section>
  </div>
 </div>;
}
