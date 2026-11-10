import { plainOrderNotes, readChargeSettings, writeChargeSettings, validateChargeSettings } from './orderCharges';
import { isManufacturerCharge } from './manufacturerCharges';

type Source = { id:string; client_id:string; quote_number:number; status:string; converted_sales_order_id:string|null; notes:string|null; freight_amount:number; adjustment_amount:number };
export const canMergeQuote = (quote:Source) => !quote.converted_sales_order_id && !['Archived','Converted','Cancelled','Canceled'].includes(quote.status);
const cents = (n:number) => Math.round((n + Number.EPSILON)*100)/100;
/** Prepare only: originals are never modified. The normal quote editor saves the new draft. */
export function mergeQuoteHeaders(quotes:Source[]) {
  if(quotes.length<2 || new Set(quotes.map(q=>q.id)).size!==quotes.length) throw new Error('Select at least two different quotes.');
  if(!quotes[0].client_id || quotes.some(q=>q.client_id!==quotes[0].client_id)) throw new Error('Only quotes for the same client can be merged.');
  if(quotes.some(q=>!canMergeQuote(q))) throw new Error('Archived, canceled or converted quotes cannot be merged. Refresh the quotes and select open quotes.');
  for(const q of quotes) { const error=validateChargeSettings(q.notes||''); if(error) throw new Error(`Quote #${q.quote_number}: ${error}`); }
  const settings=quotes.map(q=>readChargeSettings(q.notes||''));
  const primary=settings[0];
  const signature=(s:NonNullable<typeof primary>)=>JSON.stringify([s.status,s.status==='In-state'?8.25:Number(s.rate),s.taxFreight]);
  if(settings.some(s=>Boolean(s)!==Boolean(primary) || (s && primary && signature(s)!==signature(primary))))
    throw new Error('These quotes have different tax settings. Make their tax status, rate and freight tax settings match before merging.');
  const notes=quotes.map(q=>[`Merged from quote #${q.quote_number}`,plainOrderNotes(q.notes||'')].filter(Boolean).join('\n')).join('\n\n');
  return {
    notes: primary ? writeChargeSettings(notes,{...primary,manualTax:String(cents(settings.reduce((n,s)=>n+Number(s?.manualTax||0),0))),charges:settings.flatMap((s,i)=>s!.charges.map(c=>({...c,name:`Quote #${quotes[i].quote_number}: ${c.name}`})))}) : notes,
    freight_amount:String(cents(quotes.reduce((n,q)=>n+Number(q.freight_amount||0),0))),
    adjustment_amount:primary?'0':String(cents(quotes.reduce((n,q)=>n+Number(q.adjustment_amount||0),0))),
  };
}
export function mergeQuoteLines<T extends {id?:string;quote_id?:string;local_id:string;sku:string;sort_order:number}>(lines:T[],newId:()=>string):T[] {
  return lines.filter(line=>!isManufacturerCharge(line)).map((line,index)=>({...line,id:undefined,quote_id:undefined,local_id:newId(),sort_order:index}));
}
