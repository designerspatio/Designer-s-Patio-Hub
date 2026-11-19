"use client";
import {useCallback,useEffect,useMemo,useState} from "react";
import type {SupabaseClient} from "@supabase/supabase-js";
import {CLOCK_EMPLOYEES,GENEVA_ID,CLOCK_TZ,sundayOf,chicagoDay,addDays,weekBounds,workedHours,formatHours,formatPunch,chicagoInput,chicagoToIso,type ClockSegment,type ClockAdjustment} from "./timeClock";
import styles from "./TimeClockPanel.module.css";
type Props={supabase:SupabaseClient|null;userId:string;owner?:boolean};
type Correction={id:string;kind:"work"|"break";start:string;end:string;reason:string};
function displayDay(day:string){return new Date(day+"T12:00:00Z").toLocaleDateString("en-US",{timeZone:"UTC",month:"short",day:"numeric",year:"numeric"});}
export default function TimeClockPanel({supabase,userId,owner=false}:Props){
 const isOwner=owner&&userId===GENEVA_ID;
 const authorized=CLOCK_EMPLOYEES.some(u=>u.id===userId);
 const [selected,setSelected]=useState<string>(isOwner?CLOCK_EMPLOYEES[0].id:userId);
 const [week,setWeek]=useState(()=>sundayOf(chicagoDay(new Date())));
 const [rows,setRows]=useState<ClockSegment[]>([]);
 const [active,setActive]=useState<ClockSegment|null>(null);
 const [history,setHistory]=useState<ClockAdjustment[]>([]);
 const [showHistory,setShowHistory]=useState(false);
 const [correction,setCorrection]=useState<Correction|null>(null);
 const [loading,setLoading]=useState(true);
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState("");
 const [notice,setNotice]=useState("");
 const [now,setNow]=useState(()=>Date.now());
 const employee=isOwner?selected:userId;
 const bounds=useMemo(()=>weekBounds(week),[week]);
 const start=Date.parse(bounds.start),end=Date.parse(bounds.end);
 const refresh=useCallback(async()=>{
  if(!supabase||!(isOwner||authorized))return;
  setLoading(true);setError("");
  const [segments,opened,adjustments]=await Promise.all([
   supabase.from("time_clock_segments").select("id,employee_id,kind,started_at,ended_at")
    .eq("employee_id",employee).gte("started_at",new Date(start-86400000).toISOString()).lt("started_at",bounds.end).order("started_at"),
   supabase.from("time_clock_segments").select("id,employee_id,kind,started_at,ended_at")
    .eq("employee_id",employee).is("ended_at",null).limit(1).maybeSingle(),
   isOwner?supabase.from("time_clock_adjustments").select("id,employee_id,segment_id,action,reason,corrected_at,corrected_by")
    .eq("employee_id",employee).order("corrected_at",{ascending:false}).limit(40):Promise.resolve({data:[],error:null})
  ]);
  if(segments.error||opened.error||adjustments.error){
   setError(segments.error?.message||opened.error?.message||adjustments.error?.message||"Unable to load timecard");
  }else{
   const list=(segments.data||[]) as ClockSegment[];
   const current=opened.data as ClockSegment|null;
   if(current&&!list.some(x=>x.id===current.id)&&Date.parse(current.started_at)<end)list.push(current);
   setRows(list);setActive(current);setHistory((adjustments.data||[]) as ClockAdjustment[]);
  }
  setLoading(false);
 },[supabase,employee,start,end,bounds.end,isOwner,authorized]);
 useEffect(()=>{void refresh();},[refresh]);
 useEffect(()=>{const id=setInterval(()=>setNow(Date.now()),30000);return()=>clearInterval(id);},[]);
 const total=workedHours(rows,start,end,now);
 const visible=rows.filter(x=>Date.parse(x.started_at)<end&&(!x.ended_at||Date.parse(x.ended_at)>start));
 const breaks=visible.filter(x=>x.kind==="break").reduce((sum,row)=>sum+Math.max(0,Math.min(end,now,Date.parse(row.ended_at||new Date(now).toISOString()))-Math.max(start,Date.parse(row.started_at)))/60000,0);
 async function punch(action:"in"|"break"|"return"|"out"){
  if(!supabase||busy||!authorized||isOwner)return;
  setBusy(true);setError("");setNotice("");
  const {error:err}=await supabase.rpc("dp_time_clock_action",{p_action:action});
  if(err)setError(err.message);else{setNotice(({in:"Clocked in",break:"Break started",return:"Returned from break",out:"Clocked out"} as const)[action]);await refresh();}
  setBusy(false);
 }
 function editRow(row?:ClockSegment){
  setCorrection(row?{id:row.id,kind:row.kind,start:chicagoInput(row.started_at),end:chicagoInput(row.ended_at),reason:""}:
   {id:"",kind:"work",start:chicagoDay(new Date())+"T09:00",end:chicagoDay(new Date())+"T17:00",reason:""});
  setError("");setNotice("");
 }
 async function saveCorrection(action:"add"|"edit"|"remove"){
  if(!supabase||!isOwner||!correction||busy)return;
  if(correction.reason.trim().length<3){setError("A correction reason is required.");return;}
  const startAt=chicagoToIso(correction.start),endAt=correction.end?chicagoToIso(correction.end):null;
  if(action!=="remove"&&(!startAt||(correction.end&&!endAt))){setError("Enter valid clock times.");return;}
  if(action==="remove"&&!window.confirm("Remove this entry? It will remain documented in the correction history."))return;
  setBusy(true);setError("");setNotice("");
  const {error:err}=await supabase.rpc("dp_time_clock_adjust",{
   p_action:action,p_employee_id:employee,p_segment_id:correction.id||null,
   p_kind:correction.kind,p_start:action==="remove"?null:startAt,
   p_end:action==="remove"?null:endAt,p_reason:correction.reason.trim()
  });
  if(err)setError(err.message);else{setNotice("Timecard correction saved with audit history.");setCorrection(null);await refresh();}
  setBusy(false);
 }
 if(!(authorized||isOwner))return null;
 return <section className={styles.panel} aria-label={isOwner?"Employee timecards":"My time clock"}>
  <header className={styles.header}>
   <div><small>{isOwner?"OWNER · TIME RECORDS":"STAFF TIME CLOCK"}</small>
    <h2>{isOwner?"Employee Timecards":"My Time Clock"}</h2>
    <p>{isOwner?"Review and correct employee punches. Every correction requires a reason.":"Track paid work and unpaid breaks. Review your weekly record below."}</p></div>
   <div className={styles.total}><small>WEEKLY HOURS WORKED</small><strong>{formatHours(total)}</strong><span>{displayDay(week)} – {displayDay(addDays(week,6))}</span></div>
  </header>
  <div className={styles.controls}>
   {isOwner&&<label>Employee <select value={selected} onChange={e=>{setSelected(e.target.value);setCorrection(null);}}>{CLOCK_EMPLOYEES.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select></label>}
   <button type="button" onClick={()=>{setWeek(addDays(week,-7));setCorrection(null);}}>← Previous week</button>
   <strong>{displayDay(week)} – {displayDay(addDays(week,6))}</strong>
   <button type="button" disabled={week>=sundayOf(chicagoDay(new Date()))} onClick={()=>{setWeek(addDays(week,7));setCorrection(null);}}>Next week →</button>
   <button type="button" onClick={()=>void refresh()} disabled={busy||loading}>Refresh</button>
  </div>
  {!isOwner&&<div className={styles.punch}>
   <div><small>CURRENT STATUS</small><strong>{!active?"Clocked Out":active.kind==="break"?"On Break":"Working"}</strong><span>{active?formatPunch(active.started_at):"Ready to clock in"}</span></div>
   <div className={styles.buttons}>
    {!active?<button type="button" className={styles.primary} disabled={busy} onClick={()=>void punch("in")}>Clock In</button>:
    active.kind==="work"?<>
     <button type="button" className={styles.primary} disabled={busy} onClick={()=>void punch("break")}>Clock Out for Break</button>
     <button type="button" disabled={busy} onClick={()=>void punch("out")}>Clock Out for Day</button>
    </>:<>
     <button type="button" className={styles.primary} disabled={busy} onClick={()=>void punch("return")}>Clock Back In</button>
     <button type="button" disabled={busy} onClick={()=>void punch("out")}>End Shift</button>
    </>}
   </div>
  </div>}
  {error&&<p role="alert" className={styles.error}>{error}</p>}
  {notice&&<p role="status" className={styles.notice}>{notice}</p>}
  <div className={styles.stats}><div><small>WORK PERIODS</small><strong>{visible.filter(x=>x.kind==="work").length}</strong></div><div><small>UNPAID BREAKS</small><strong>{Math.round(breaks)} min</strong></div><div><small>TOTAL HOURS</small><strong>{formatHours(total)}</strong></div></div>
  <div className={styles.titleRow}><h3>Weekly Timecard</h3>{isOwner&&<button type="button" disabled={busy} onClick={()=>editRow()}>+ Add Missing Entry</button>}</div>
  {loading?<p>Loading timecard…</p>:<div className={styles.scroller}><table><thead><tr><th>Day</th><th>Clock In / Start</th><th>Clock Out / End</th><th>Type</th><th>Hours</th>{isOwner&&<th>Adjust</th>}</tr></thead><tbody>
   {!visible.length?<tr><td colSpan={isOwner?6:5}>No records this week.</td></tr>:
   visible.map(row=><tr key={row.id}><td>{new Date(row.started_at).toLocaleDateString("en-US",{timeZone:CLOCK_TZ,weekday:"short",month:"short",day:"numeric"})}</td>
    <td>{formatPunch(row.started_at)}</td><td>{row.ended_at?formatPunch(row.ended_at):"In progress"}</td>
    <td>{row.kind==="work"?"Work":"Break (unpaid)"}</td>
    <td>{row.kind==="work"?formatHours(workedHours([row],start,end,now)):"0.00"}</td>
    {isOwner&&<td><button type="button" disabled={busy} onClick={()=>editRow(row)}>Correct</button></td>}</tr>)}
   </tbody><tfoot><tr><td colSpan={4}>Sunday–Saturday total</td><td>{formatHours(total)}</td>{isOwner&&<td/>}</tr></tfoot></table></div>}
  <div className={styles.days}>{Array.from({length:7},(_,i)=>{const day=addDays(week,i);const from=Date.parse(chicagoToIso(day+"T00:00")!);const to=Date.parse(chicagoToIso(addDays(day,1)+"T00:00")!);return <div key={day}><small>{new Date(day+"T12:00:00Z").toLocaleDateString("en-US",{timeZone:"UTC",weekday:"short"})}</small><strong>{formatHours(workedHours(rows,from,to,now))}</strong></div>;})}</div>
  {isOwner&&correction&&<div className={styles.editor}><h3>{correction.id?"Correct Timecard Entry":"Add Missing Timecard Entry"}</h3>
   <div className={styles.fields}>
    <label>Type<select value={correction.kind} onChange={e=>setCorrection({...correction,kind:e.target.value as "work"|"break"})}><option value="work">Work</option><option value="break">Unpaid break</option></select></label>
    <label>Start (Dallas time)<input type="datetime-local" value={correction.start} onChange={e=>setCorrection({...correction,start:e.target.value})}/></label>
    <label>End (Dallas time)<input type="datetime-local" value={correction.end} onChange={e=>setCorrection({...correction,end:e.target.value})}/></label>
    <label className={styles.reason}>Reason for correction<textarea rows={2} value={correction.reason} onChange={e=>setCorrection({...correction,reason:e.target.value})} placeholder="Missed clock-in / clock-out"/></label>
   </div>
   <div className={styles.buttons}><button className={styles.primary} type="button" disabled={busy} onClick={()=>void saveCorrection(correction.id?"edit":"add")}>Save Correction</button>{correction.id&&<button type="button" disabled={busy} onClick={()=>void saveCorrection("remove")}>Remove Entry</button>}<button type="button" disabled={busy} onClick={()=>setCorrection(null)}>Cancel</button></div>
  </div>}
  {isOwner&&<div className={styles.audit}><button type="button" onClick={()=>setShowHistory(!showHistory)}>{showHistory?"Hide":"View"} Correction History ({history.length})</button>{showHistory&&(history.length?history.map(x=><p key={x.id}>{new Date(x.corrected_at).toLocaleString("en-US",{timeZone:CLOCK_TZ})} · {x.action.toUpperCase()} · {x.reason}</p>):<p>No corrections for this employee.</p>)}</div>}
 </section>;
}
