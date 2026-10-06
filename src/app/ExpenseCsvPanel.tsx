'use client';
import { useRef, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { readStatement, statementRows, expenseImportId, type Mapping, type Options, type ExpenseRow } from './expenseCsv';
type ReviewRow=ExpenseRow & {id:string; selected:boolean};
export default function ExpenseCsvPanel({supabase,userId,onComplete}:{supabase:SupabaseClient;userId:string;onComplete:()=>Promise<void>}) {
  const input=useRef<HTMLInputElement>(null);
  const [open,setOpen]=useState(false),[file,setFile]=useState(''),[source,setSource]=useState<ReturnType<typeof readStatement>|null>(null);
  const [mapping,setMapping]=useState<Mapping>({date:-1,payee:-1,amount:-1,category:-1,reference:-1,type:-1});
  const [options,setOptions]=useState<Options>({negativeCharges:false,dayFirst:false,account:'',category:''});
  const [review,setReview]=useState<ReviewRow[]>([]),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
  const selected=review.filter(r=>r.selected&&!r.reason);
  async function existingExpenses() {
    const result:{id:string;expense_date:string;payee:string;amount:number;payment_method:string|null}[]=[];
    for(let start=0;;start+=500){
      const {data,error}=await supabase.from('expenses').select('id,expense_date,payee,amount,payment_method').order('id').range(start,start+499);
      if(error)throw new Error(error.message);
      result.push(...(data||[]));if(!data||data.length<500)break;
    }
    return result;
  }
  async function preview() {
    if(!source)return;
    setBusy(true);setMessage('');setReview([]);
    try {
      if(!options.account.trim())throw new Error('Enter a card label, such as Business Visa 1234. Use the same label for future statements.');
      const rows=statementRows(source.rows,source.headers,mapping,options),existing=await existingExpenses(),ids=new Set(existing.map(r=>r.id));
      const next=await Promise.all(rows.map(async r=>{
        const id=await expenseImportId(r);
        const duplicate=ids.has(id);
        const possible=existing.some(e=>e.expense_date===r.expense_date&&e.payee.trim().toLowerCase()===r.payee.trim().toLowerCase()&&Number(e.amount)===r.amount);
        return {...r,id,reason:r.reason||(duplicate?'Already imported':''),selected:!r.reason&&!duplicate&&!possible};
      }));
      setReview(next);setMessage('Review every row. Charges matching an existing expense by date, merchant, and amount start unchecked. Payments and credits are excluded; handle credits separately.');
    }catch(e){setMessage(e instanceof Error?e.message:'Could not preview statement.');}finally{setBusy(false);}
  }
  async function save() {
    if(!selected.length||busy)return;
    setBusy(true);setMessage('');
    try {
      const existing=new Set((await existingExpenses()).map(r=>r.id));
      const rows=selected.filter(r=>!existing.has(r.id));
      if(rows.length){
        const {data,error}=await supabase.from('expenses').insert(rows.map(r=>({id:r.id,expense_date:r.expense_date,payee:r.payee,description:r.payee,amount:r.amount,category:r.category||null,payment_method:'Credit Card',reference:r.reference||null,notes:`CSV statement: ${file}\nCard: ${options.account.trim()}\nSource row: ${r.line}`,created_by:userId}))).select('id');
        if(error)throw new Error(error.message+' No statement batch was saved. Refresh the preview before retrying.');
        if(data?.length!==rows.length)throw new Error('The saved row count could not be verified. Refresh the preview before retrying.');
      }
      setReview([]);setSource(null);setFile('');
      setMessage(`Imported ${rows.length} expenses. ${selected.length-rows.length} already-imported charges skipped.`);
      try{await onComplete();}catch{setMessage(`Imported ${rows.length} expenses. Reload Accounting to refresh the list.`);}
    }catch(e){setMessage(e instanceof Error?e.message:'Import failed. Refresh the preview before retrying.');}finally{setBusy(false);}
  }
  function changeOptions(next:Options){setOptions(next);setReview([]);setMessage('');}
  return <section className="expense-csv">
    <button className="page-primary" onClick={()=>setOpen(!open)} disabled={busy}>{open?'Close statement import':'Import Credit Card CSV'}</button>
    {open&&<div>
      <h2>Import a credit card statement</h2>
      <p>Upload a CSV with a header row, match its columns, then select the charges to record as expenses. Remove statement totals and introductory lines before uploading.</p>
      <input ref={input} type="file" accept=".csv,text/csv" aria-label="Credit card statement CSV" disabled={busy} onChange={async e=>{
        const chosen=e.target.files?.[0];e.target.value='';if(!chosen)return;setReview([]);setMessage('');setSource(null);setBusy(true);
        try{if(chosen.size>10*1024*1024)throw new Error('Choose a CSV smaller than 10 MB.');const parsed=readStatement(await chosen.text());setSource(parsed);setMapping(parsed.mapping);setFile(chosen.name);}catch(err){setMessage(err instanceof Error?err.message:'Could not read CSV.');}finally{setBusy(false);}
      }}/>
      {source&&<fieldset disabled={busy}>
        <legend>{file} · {source.rows.length} transactions</legend>
        <div className="expense-csv-fields">
          <label>Card label (name and last 4 digits)<input value={options.account} onChange={e=>changeOptions({...options,account:e.target.value})} placeholder="Business Visa 1234"/></label>
          <label>Default category<input value={options.category} onChange={e=>changeOptions({...options,category:e.target.value})} placeholder="Uncategorized"/></label>
          {([['date','Date'],['payee','Merchant / description'],['amount','Charge amount / debit'],['category','Category (optional)'],['reference','Reference (optional)'],['type','Transaction type (optional)']] as [keyof Mapping,string][]).map(([key,label])=><label key={key}>{label}<select value={mapping[key]} onChange={e=>{setMapping({...mapping,[key]:Number(e.target.value)});setReview([]);setMessage('');}}><option value={-1}>Choose column</option>{source.headers.map((h,i)=><option value={i} key={i}>{i+1}. {h}</option>)}</select></label>)}
          <label>Charges appear as<select value={options.negativeCharges?'negative':'positive'} onChange={e=>changeOptions({...options,negativeCharges:e.target.value==='negative'})}><option value="positive">Positive amounts</option><option value="negative">Negative amounts</option></select></label>
          <label>Date format<select value={options.dayFirst?'dmy':'mdy'} onChange={e=>changeOptions({...options,dayFirst:e.target.value==='dmy'})}><option value="mdy">MM/DD/YYYY</option><option value="dmy">DD/MM/YYYY</option></select><small>YYYY-MM-DD also accepted.</small></label>
        </div>
        <p>For separate debit and credit columns, choose the debit/charge column. Keep the same card label and date column on future imports to identify repeated transactions.</p>
        <button onClick={preview} disabled={busy}>{busy?'Working…':'Preview expenses'}</button>
      </fieldset>}
      {message&&<p role="status">{message}</p>}
      {!!review.length&&<div>
        <h3>{selected.length} selected · ${selected.reduce((sum,r)=>sum+r.amount,0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}</h3>
        <p>{review.filter(r=>r.reason).length} rows excluded. Uncheck any remaining payments, credits, or charges you do not want to import.</p>
        <button disabled={busy} onClick={()=>setReview(review.map(r=>({...r,selected:false})))}>Clear selection</button>
        <div className="expense-csv-table"><table><thead><tr><th>Import</th><th>Row</th><th>Date</th><th>Merchant / description</th><th>Category</th><th>Amount</th><th>Status</th></tr></thead><tbody>{review.map(r=><tr key={r.line}><td><input type="checkbox" aria-label={`Import row ${r.line}`} checked={r.selected} disabled={busy||!!r.reason} onChange={e=>setReview(review.map(x=>x.line===r.line?{...x,selected:e.target.checked}:x))}/></td><td>{r.line}</td><td>{r.expense_date||'—'}</td><td>{r.payee}</td><td>{r.category||'Uncategorized'}</td><td>{Number.isFinite(r.amount)?r.amount.toFixed(2):'—'}</td><td>{r.reason||(r.selected?'Ready':'Not selected — review for duplicate')}</td></tr>)}</tbody></table></div>
        <button className="page-primary" disabled={busy||!selected.length} onClick={save}>{busy?'Importing…':`Import ${selected.length} expenses`}</button>
      </div>}
    </div>}
  </section>;
}
