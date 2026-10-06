'use client';
import {calculateOrderCharges,readChargeSettings,writeChargeSettings,type ChargeSettings} from './orderCharges';
export default function OrderChargesEditor({notes,merchandise,freight,adjustment,tax=0,clientExempt,onChange}:{notes:string;merchandise:number;freight:number;adjustment:number;tax?:number;clientExempt?:boolean;onChange:(notes:string)=>void}) {
  const saved=readChargeSettings(notes);
  const s:ChargeSettings=saved||{status:'Manual',rate:'',taxFreight:false,manualTax:String(tax),charges:adjustment?[{name:'Existing adjustment',amount:String(adjustment),taxable:false}]:[]};
  const change=(next:ChargeSettings)=>onChange(writeChargeSettings(notes,next));
  const totals=calculateOrderCharges(notes,merchandise,freight,adjustment,tax);
  const money=(n:number)=>n.toLocaleString('en-US',{style:'currency',currency:'USD'});
  return <section className="order-charges-editor">
    <h3>Tax & additional charges</h3>
    {clientExempt&&<p>This client is marked tax exempt. Select Tax exempt to apply that status to this document.</p>}
    <div className="order-charge-fields"><label>Tax status<select value={s.status} onChange={e=>change({...s,status:e.target.value as ChargeSettings['status']})}><option>In-state</option><option>Out-of-state</option><option>Tax exempt</option><option value="Manual">Manual / existing tax amount</option></select></label>
    {(s.status==='In-state'||s.status==='Out-of-state')&&<><label>Tax rate (%)<input type="number" min="0" max="100" step="0.001" value={s.rate} onChange={e=>change({...s,rate:e.target.value})} placeholder="Enter applicable rate"/></label><label><input type="checkbox" checked={s.taxFreight} onChange={e=>change({...s,taxFreight:e.target.checked})}/> Include freight in taxable amount</label></>}
    {s.status==='Manual'&&<label>Tax amount<input type="number" min="0" step="0.01" value={s.manualTax} onChange={e=>change({...s,manualTax:e.target.value})}/></label>}</div>
    {(s.status==='In-state'||s.status==='Out-of-state')&&<p>Enter the rate for this order’s destination. A state selection does not determine the rate automatically.</p>}
    {s.charges.map((c,i)=><div className="order-charge-fields" key={i}><label>Charge description<input value={c.name} placeholder="Delivery, installation, service…" onChange={e=>change({...s,charges:s.charges.map((x,j)=>j===i?{...x,name:e.target.value}:x)})}/></label><label>Amount<input type="number" step="0.01" value={c.amount} onChange={e=>change({...s,charges:s.charges.map((x,j)=>j===i?{...x,amount:e.target.value}:x)})}/></label><label><input type="checkbox" checked={c.taxable} onChange={e=>change({...s,charges:s.charges.map((x,j)=>j===i?{...x,taxable:e.target.checked}:x)})}/> Taxable</label><button type="button" onClick={()=>change({...s,charges:s.charges.filter((_,j)=>j!==i)})}>Remove charge {i+1}</button></div>)}
    <button type="button" onClick={()=>change({...s,charges:[...s.charges,{name:'',amount:'0',taxable:false}]})}>+ Add additional charge</button>
    <div className="summary-row"><span>Additional charges</span><strong>{money(totals.additional)}</strong></div><div className="summary-row"><span>{s.status==='Tax exempt'?'Tax exempt':'Sales tax'}</span><strong>{money(totals.tax)}</strong></div><div className="summary-total"><span>Total including freight & tax</span><strong>{money(totals.total)}</strong></div>
  </section>;
}
