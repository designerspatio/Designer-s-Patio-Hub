"use client";
import { useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { parseClientCsv, planClientImport, exportClientsCsv, type ParsedClients, type CsvClient } from './clientCsv';
function download(name:string,text:string,type='text/csv;charset=utf-8') {
  const url=URL.createObjectURL(new Blob([text],{type}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
export async function fetchAllClients(supabase:SupabaseClient):Promise<CsvClient[]> {
  const records:CsvClient[]=[];
  for(let start=0;;start+=500){const {data,error}=await supabase.from('clients').select('*').order('id').range(start,start+499);if(error)throw new Error(error.message);records.push(...(data||[]));if(!data||data.length<500)return records;}
}
export default function ClientCsvPanel({supabase,userId,visibleClients,onComplete}:{supabase:SupabaseClient;userId:string;visibleClients:CsvClient[];onComplete:()=>Promise<void>}) {
  const [open,setOpen]=useState(false),[parsed,setParsed]=useState<ParsedClients|null>(null),[sourceName,setSourceName]=useState('');
  const [existing,setExisting]=useState<CsvClient[]>([]),[replace,setReplace]=useState(false),[protect,setProtect]=useState('Paradigm\nHHL Interiors');
  const [busy,setBusy]=useState(false),[message,setMessage]=useState(''),[confirmed,setConfirmed]=useState(false);
  const [plan,setPlan]=useState<ReturnType<typeof planClientImport>|null>(null);
  const protections=()=>replace?protect.split(/[\n,]/).map(s=>s.trim()).filter(Boolean):[];
  async function readFile(file:File) {
    setBusy(true);setMessage('Reading CSV and loading current clients...');setPlan(null);setConfirmed(false);
    try {
      if(file.size>10*1024*1024)throw new Error('Please use a CSV smaller than 10 MB.');
      const result=parseClientCsv(await file.text());const current=await fetchAllClients(supabase);
      setParsed(result);setSourceName(file.name);setExisting(current);setMessage('File validated. Review the import before applying it.');
    }catch(e){setParsed(null);setMessage(e instanceof Error?e.message:'Unable to read CSV.');}finally{setBusy(false);}
  }
  function preview(){if(!parsed)return;try{setPlan(planClientImport(parsed.rows,existing,userId,replace,protections(),()=>crypto.randomUUID()));setConfirmed(false);setMessage('Review the counts and protected records below.');}catch(e){setPlan(null);setMessage(e instanceof Error?e.message:'Unable to preview import.');}}
  async function apply() {
    if(!plan||!parsed||busy||!confirmed)return;setBusy(true);let saved=0,archived=0;
    try {
      const current=await fetchAllClients(supabase);
      if(JSON.stringify(current)!==JSON.stringify(existing))throw new Error('Clients changed after the preview. Select the CSV again to refresh the preview.');
      // Save a complete local backup before touching any records. No client data goes into source control.
      download(`Clients-before-import-${new Date().toISOString().replace(/[:.]/g,'-')}.json`,JSON.stringify(existing,null,2),'application/json');
      for(let start=0;start<plan.writes.length;start+=100) {
        const batch=plan.writes.slice(start,start+100);setMessage(`Saving clients ${start+1}-${start+batch.length} of ${plan.writes.length}...`);
        const {data,error}=await supabase.from('clients').upsert(batch,{onConflict:'id'}).select('id');
        if(error)throw new Error(error.message);if(data?.length!==batch.length)throw new Error('Not every client was saved. Check account permissions.');saved+=batch.length;
      }
      // Archive only after every incoming record has saved. Existing IDs and all order links survive.
      for(let start=0;start<plan.archiveIds.length;start+=100) {
        const ids=plan.archiveIds.slice(start,start+100);const {data,error}=await supabase.from('clients').update({active:false}).in('id',ids).select('id');
        if(error)throw new Error(error.message);if(data?.length!==ids.length)throw new Error('Not every superseded client was archived.');archived+=ids.length;
      }
      const after=await fetchAllClients(supabase);
      for(const client of plan.preserved)if(JSON.stringify(after.find(c=>c.id===client.id))!==JSON.stringify(client))throw new Error(`Verification failed for preserved client ${client.client_name}.`);
      for(const row of plan.writes) {
        const actual=after.find(c=>c.id===row.id);
        if(!actual || Object.entries(row).some(([key,value])=>actual[key]!==value))throw new Error(`Verification failed for ${row.client_name}.`);
      }
      for(const id of plan.archiveIds)if(after.find(c=>c.id===id)?.active!==false)throw new Error('A superseded client is still active.');
      setMessage(`Import complete: ${plan.added} added, ${plan.updated} updated, ${archived} archived, ${plan.preserved.length} preserved unchanged.`);setPlan(null);setParsed(null);await onComplete();
    }catch(e){setMessage(`Import stopped: ${e instanceof Error?e.message:'Unknown error'}. ${saved} clients saved and ${archived} archived. Your pre-import backup was downloaded; no client records were deleted.`);await onComplete();}finally{setBusy(false);}
  }
  return <section className="client-csv-tools" aria-label="Client CSV tools">
    <div className="client-csv-actions">
      <button className="inventory-export-button" type="button" disabled={busy||!visibleClients.length} onClick={()=>download('Designers-Patio-Clients.csv',exportClientsCsv(visibleClients))}>Export CSV ({visibleClients.length})</button>
      <button className="inventory-export-button" type="button" disabled={busy} onClick={()=>setOpen(!open)}>{open?'Close Import':'Import CSV'}</button>
      <span>Export includes the clients in your current view and search.</span>
    </div>
    {open&&<div className="client-csv-panel">
      <h2>Import clients</h2>
      <p>Use CLIENT NAME, CITY, STATE, ZIP, PHONE, and EMAIL. Exports also include client IDs, assignment, address, notes, and tax status for updating existing records.</p>
      <label>Choose client CSV <input type="file" accept=".csv,text/csv" disabled={busy} onChange={e=>{const file=e.target.files?.[0];e.target.value='';if(file)void readFile(file);}}/></label>
      <label>Import mode <select disabled={busy} value={replace?'replace':'merge'} onChange={e=>{setReplace(e.target.value==='replace');setPlan(null);setConfirmed(false);}}>
        <option value="merge">Add or update clients</option><option value="replace">Replace active client list</option>
      </select></label>
      {replace&&<><label>Clients to preserve unchanged (one name per line)<textarea rows={2} value={protect} disabled={busy} onChange={e=>{setProtect(e.target.value);setPlan(null);}}/></label>
      <p>Replacement covers all client records available to your account, regardless of My Records filters. Superseded records are archived to preserve quote, order, and document history. You can reopen them in Archived Clients and save them to reactivate.</p></>}
      {parsed&&<><p><strong>{sourceName}</strong>: {parsed.rows.length} clients; {parsed.duplicates} exact duplicates and {parsed.blanks} blank rows skipped; {parsed.recoveredNames} missing names recovered by a unique email match.</p>
      <button type="button" className="inventory-export-button" disabled={busy} onClick={preview}>Preview Import</button></>}
      {plan&&<div className="client-csv-preview">
        <p><strong>{plan.added} new · {plan.updated} updates · {plan.archiveIds.length} archived · {plan.preserved.length} protected</strong></p>
        {plan.preserved.length>0&&<p>Preserved unchanged: {plan.preserved.map(c=>c.client_name).join(', ')}</p>}
        <table><thead><tr><th>Client</th><th>City</th><th>Email</th><th>Phone</th></tr></thead><tbody>{plan.writes.slice(0,8).map(c=><tr key={c.id}><td>{c.client_name}</td><td>{String(c.city||'')}</td><td>{String(c.email||'')}</td><td>{String(c.phone||'')}</td></tr>)}</tbody></table>
        <label className="client-csv-confirm"><input type="checkbox" checked={confirmed} disabled={busy} onChange={e=>setConfirmed(e.target.checked)}/>Apply this preview. Download a backup before importing.</label>
        <button type="button" className="new-client-button" disabled={busy||!confirmed} onClick={()=>void apply()}>{busy?'Importing...':replace?'Replace Client List':'Import Clients'}</button>
      </div>}
      <p role="status" aria-live="polite">{message}</p>
    </div>}
  </section>;
}
