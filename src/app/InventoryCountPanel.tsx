"use client";

import {useCallback,useEffect,useMemo,useRef,useState} from "react";
import type {SupabaseClient} from "@supabase/supabase-js";
import type {Html5Qrcode} from "html5-qrcode";

type Count={id:string;name:string;location_filter:string|null;status:string;started_at:string;finalized_at:string|null};
type Line={id:string;count_id:string;inventory_item_id:string;item_name_snapshot:string;sku_snapshot:string|null;location_snapshot:string|null;expected_qty:number;counted_qty:number;last_scanned_at:string|null};
type Item={id:string;name:string;sku:string|null;location:string|null;quantity_on_hand:number;active:boolean};
const itemIdFromScan=(raw:string):string|null=>{
 const input=raw.trim();const matched=input.match(/(?:^|\/i\/)([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:[/?#]|$)/i);
 return matched?.[1]?.toLowerCase() || (/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(input)?input.toLowerCase():null);
};
const csv=(value:unknown)=>{let cell=String(value??"");if(typeof value==="string"&&/^[=+\\-@\\t\\r]/.test(cell.trimStart()))cell="\'"+cell;return `"${cell.replaceAll('"','""')}"`;};

export default function InventoryCountPanel({supabase,items}:{supabase:SupabaseClient|null;items:Item[]}){
 const [counts,setCounts]=useState<Count[]>([]);
 const [selectedId,setSelectedId]=useState("");
 const [lines,setLines]=useState<Line[]>([]);
 const [newName,setNewName]=useState("");
 const [location,setLocation]=useState("");
 const [scan,setScan]=useState("");
 const [busy,setBusy]=useState(false);
 const [message,setMessage]=useState("");
 const [cameraOn,setCameraOn]=useState(false);
 const [showAll,setShowAll]=useState(false);
 const scanner=useRef<Html5Qrcode|null>(null);
 const lastCamera=useRef<{value:string;time:number}>({value:"",time:0});
 const locked=useRef(false);
 const selected=counts.find(c=>c.id===selectedId)||null;
 const locations=useMemo(()=>[...new Set(items.map(i=>i.location?.trim()).filter(Boolean) as string[])].sort(),[items]);
 const refreshCounts=useCallback(async()=>{
  if(!supabase)return;
  const {data,error}=await supabase.from("inventory_counts").select("id,name,location_filter,status,started_at,finalized_at").order("started_at",{ascending:false}).limit(50);
  if(error)setMessage("Could not load count sessions: "+error.message);else setCounts((data||[]) as Count[]);
 },[supabase]);
 const refreshLines=useCallback(async(id:string)=>{
  if(!supabase||!id){setLines([]);return;}
  const {data,error}=await supabase.from("inventory_count_lines").select("id,count_id,inventory_item_id,item_name_snapshot,sku_snapshot,location_snapshot,expected_qty,counted_qty,last_scanned_at").eq("count_id",id).order("item_name_snapshot");
  if(error)setMessage("Could not load count lines: "+error.message);else setLines((data||[]) as Line[]);
 },[supabase]);
 useEffect(()=>{void refreshCounts()},[refreshCounts]);
 useEffect(()=>{void refreshLines(selectedId)},[selectedId,refreshLines]);
 const start=async()=>{
  if(!supabase||newName.trim().length<2){setMessage("Enter a count name.");return;}
  setBusy(true);const {data,error}=await supabase.rpc("dp_start_inventory_count",{p_name:newName.trim(),p_location:location||null});
  setBusy(false);
  if(error){setMessage(error.message);return;}
  await refreshCounts();setSelectedId(data);setNewName("");setMessage("Count started. Expected quantities were snapshotted before scanning.");
 };
 const record=async(raw:string,fromCamera=false)=>{
  if(locked.current||!supabase||!selected||selected.status!=="In Progress")return;
  const parsedId=itemIdFromScan(raw);
  const skuMatches=parsedId?[]:lines.filter(l=>l.sku_snapshot?.trim().toLowerCase()===raw.trim().toLowerCase());
  if(!parsedId && skuMatches.length>1){setMessage("More than one inventory item uses this SKU. Scan the item's unique QR tag instead.");return;}
  const id=parsedId||(skuMatches.length===1?skuMatches[0].inventory_item_id:null);
  const line=lines.find(l=>l.inventory_item_id===id);
  if(!line){setMessage("This code is not in this count. Scan a tag included in the starting snapshot.");return;}
  if(fromCamera){const now=Date.now();if(lastCamera.current.value===raw&&now-lastCamera.current.time<2500)return;lastCamera.current={value:raw,time:now};}
  locked.current=true;setBusy(true);
  const {data,error}=await supabase.rpc("dp_record_inventory_scan",{p_count_id:selected.id,p_item_id:line.inventory_item_id,p_delta:1});
  setBusy(false);locked.current=false;
  if(error){setMessage(error.message);return;}
  setLines(previous=>previous.map(l=>l.id===line.id?{...l,counted_qty:Number(data),last_scanned_at:new Date().toISOString()}:l));
  setMessage(`Counted 1 × ${line.item_name_snapshot}; total found ${data}.`);setScan("");
 };
 const setCount=async(line:Line,quantity:number)=>{
  if(!supabase||!selected||selected.status!=="In Progress"||!Number.isSafeInteger(quantity)||quantity<0)return;
  setBusy(true);const {error}=await supabase.rpc("dp_set_inventory_count_quantity",{p_count_id:selected.id,p_item_id:line.inventory_item_id,p_quantity:quantity});
  setBusy(false);if(error){setMessage(error.message);return;}
  await refreshLines(selected.id);setMessage("Count quantity updated. Adjustment recorded in count history.");
 };
 const finish=async()=>{
  if(!supabase||!selected||selected.status!=="In Progress")return;
  if(!window.confirm("Finalize this count and lock its reconciliation report? This will NOT change inventory stock balances."))return;
  setBusy(true);const {error}=await supabase.rpc("dp_finalize_inventory_count",{p_count_id:selected.id});setBusy(false);
  if(error){setMessage(error.message);return;}await refreshCounts();await refreshLines(selected.id);setMessage("Count finalized. Actual inventory quantities remain unchanged until an authorized stock adjustment.");
 };
 const closeCamera=useCallback(async()=>{
  const s=scanner.current;scanner.current=null;
  if(s){try{await s.stop()}catch{}try{s.clear()}catch{}}
  setCameraOn(false);
 },[]);
 useEffect(()=>()=>{void closeCamera()},[closeCamera]);
 const openCamera=async()=>{
  if(cameraOn){await closeCamera();return;}
  try{
   setCameraOn(true);
   await new Promise(resolve=>setTimeout(resolve,100));
   const {Html5Qrcode}=await import("html5-qrcode");
   const s=new Html5Qrcode("dp-qr-camera",{verbose:false});scanner.current=s;
   lastCamera.current={value:"",time:0};
   await s.start({facingMode:"environment"},{fps:8,qrbox:{width:210,height:210}},code=>{void (async()=>{await record(code,true);await closeCamera()})()},()=>{});
   setCameraOn(true);
  }catch(e){setMessage("Camera could not start. Use the scanner input instead: "+String(e));await closeCamera();}
 };
 const expected=lines.reduce((sum,line)=>sum+line.expected_qty,0),counted=lines.reduce((sum,line)=>sum+line.counted_qty,0),scanned=lines.filter(l=>l.last_scanned_at).length;
 const discrepancies=lines.filter(l=>l.counted_qty!==l.expected_qty||!l.last_scanned_at);
 const visible=showAll?lines:discrepancies;
 const download=()=>{
  if(!selected)return;
  const headers=["Item","SKU","Location","Expected at count start","Physically counted","Variance","Scanned?","Status"];
  const rows=lines.map(l=>[l.item_name_snapshot,l.sku_snapshot,l.location_snapshot,l.expected_qty,l.counted_qty,l.counted_qty-l.expected_qty,l.last_scanned_at?"Yes":"No",!l.last_scanned_at?"Not scanned":l.counted_qty===l.expected_qty?"Matched":l.counted_qty>l.expected_qty?"Overage":"Shortage"]);
  const content=[headers,...rows].map(row=>row.map(csv).join(",")).join("\r\n");
  const url=URL.createObjectURL(new Blob(["\ufeff"+content],{type:"text/csv;charset=utf-8"}));
  const a=document.createElement("a");a.href=url;a.download=`inventory-reconciliation-${selected.name.replace(/[^a-z0-9-]/gi,"-")}.csv`;a.click();URL.revokeObjectURL(url);
 };
 return <section style={{border:"1px solid #dce5ee",borderRadius:12,padding:18,marginBottom:22,display:"grid",gap:14}}>
 <div><h2 style={{margin:"0 0 4px"}}>QR Inventory Count & Reconciliation</h2><p style={{margin:0}}>Take a frozen starting snapshot, scan each unit, and export the variances. Counts never automatically change stock.</p></div>
 <div style={{display:"flex",gap:10,flexWrap:"wrap",alignItems:"end"}}>
 <label style={{display:"grid",gap:4}}>Count name<input placeholder="November showroom inventory" value={newName} onChange={e=>setNewName(e.target.value)}/></label>
 <label style={{display:"grid",gap:4}}>Location<select value={location} onChange={e=>setLocation(e.target.value)}><option value="">All locations</option>{locations.map(v=><option key={v}>{v}</option>)}</select></label>
 <button className="page-primary" disabled={busy} onClick={start}>Start New Count</button>
 </div>
 <label style={{display:"grid",gap:5}}>Current or previous count<select value={selectedId} onChange={e=>{void closeCamera();setSelectedId(e.target.value)}}><option value="">Select a count...</option>{counts.map(c=><option value={c.id} key={c.id}>{c.name} • {new Date(c.started_at).toLocaleDateString()} • {c.status}</option>)}</select></label>
 {selected&&<>
  <div style={{display:"flex",gap:16,flexWrap:"wrap"}}><strong>Starting units: {expected}</strong><strong>Counted: {counted}</strong><strong>Items scanned: {scanned}/{lines.length}</strong><strong>Variance: {counted-expected>=0?"+":""}{counted-expected}</strong></div>
  {selected.status==="In Progress"&&<><form onSubmit={e=>{e.preventDefault();void record(scan)}} style={{display:"flex",gap:8,flexWrap:"wrap"}}><input style={{flex:"1 1 260px"}} autoFocus placeholder="Scan QR URL or SKU, then Enter" value={scan} onChange={e=>setScan(e.target.value)} disabled={busy}/><button type="submit" disabled={busy||!scan.trim()}>Count +1</button><button type="button" onClick={()=>void openCamera()}>{cameraOn?"Stop Camera":"Scan with Camera"}</button></form><div id="dp-qr-camera" style={{width:280,maxWidth:"100%",display:cameraOn?"block":"none"}}/></>}
  <div style={{display:"flex",gap:10,flexWrap:"wrap"}}><button onClick={download}>Download reconciliation CSV</button><button onClick={()=>setShowAll(v=>!v)}>{showAll?"Show discrepancies only":"Show all counted items"}</button>{selected.status==="In Progress"&&<button disabled={busy} onClick={finish}>Finalize & Lock Count</button>}</div>
  <div style={{overflowX:"auto"}}><table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}><thead><tr>{["Item","Expected","Counted","Variance","Result","Action"].map(t=><th key={t} style={{textAlign:"left",padding:7,borderBottom:"1px solid #b5c6d3"}}>{t}</th>)}</tr></thead><tbody>{visible.map(l=><tr key={l.id}><td style={{padding:7,borderBottom:"1px solid #e0e6ec"}}><strong>{l.item_name_snapshot}</strong><div style={{color:"#607488"}}>{l.sku_snapshot} · {l.location_snapshot}</div></td><td>{l.expected_qty}</td><td>{l.counted_qty}</td><td>{l.counted_qty-l.expected_qty}</td><td>{!l.last_scanned_at?"Not scanned":l.counted_qty===l.expected_qty?"Matched":l.counted_qty>l.expected_qty?"Overage":"Shortage"}</td><td>{selected.status==="In Progress"&&<><button disabled={busy} onClick={()=>void record(l.inventory_item_id)}>+1</button><button disabled={busy||l.counted_qty===0} onClick={()=>void setCount(l,l.counted_qty-1)}>−1</button></>}</td></tr>)}</tbody></table>{visible.length===0&&<p>Every item has been accounted for.</p>}</div>
 </>}
 {message&&<div role="status" style={{background:"#f0f5fa",padding:10,borderRadius:6}}>{message}</div>}
 </section>;
}
