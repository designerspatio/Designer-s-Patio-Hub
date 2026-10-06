export type ChargeSettings = { status:'In-state'|'Out-of-state'|'Tax exempt'|'Manual'; rate:string; taxFreight:boolean; manualTax:string; charges:{name:string;amount:string;taxable:boolean}[] };
const block=/\n?\[Tax and charges\]\n[\s\S]*?\n\[End tax and charges\]/;
export const plainOrderNotes=(notes:string)=>notes.replace(block,'');
export function readChargeSettings(notes:string):ChargeSettings|null {
  const match=notes.match(block);if(!match)return null;
  const lines=match[0].trim().split('\n');
  const get=(key:string)=>lines.find(l=>l.startsWith(key+': '))?.slice(key.length+2)||'';
  const status=get('Tax status') as ChargeSettings['status'];
  if(!['In-state','Out-of-state','Tax exempt','Manual'].includes(status))return null;
  return {status,rate:get('Tax rate').replace('%',''),taxFreight:get('Tax freight')==='Yes',manualTax:get('Manual tax'),charges:lines.filter(l=>l.startsWith('Additional charge: ')).map(l=>{const [name,amount,taxable]=l.slice(19).split(' | ');return {name,amount,taxable:taxable==='Taxable'};})};
}
export function writeChargeSettings(notes:string,s:ChargeSettings) {
  const clean=(v:string)=>v.replace(/[\r\n|]/g,' ');
  return [plainOrderNotes(notes),'[Tax and charges]',`Tax status: ${s.status}`,`Tax rate: ${clean(s.rate)}%`,`Tax freight: ${s.taxFreight?'Yes':'No'}`,`Manual tax: ${clean(s.manualTax)}`,...s.charges.map(c=>`Additional charge: ${clean(c.name)} | ${clean(c.amount)} | ${c.taxable?'Taxable':'Not taxable'}`),'[End tax and charges]'].filter(Boolean).join('\n');
}
const numeric=(v:string|number)=>Number.isFinite(Number(v))?Number(v):0;
const cents=(v:number)=>Math.round((v+Number.EPSILON)*100)/100;
export function calculateOrderCharges(notes:string,merchandise:number,freight:number,legacyAdjustment:number,legacyTax=0) {
  const settings=readChargeSettings(notes);
  if(!settings)return {additional:legacyAdjustment,tax:legacyTax,total:cents(merchandise+freight+legacyAdjustment+legacyTax)};
  const additional=cents(settings.charges.reduce((n,c)=>n+numeric(c.amount),0));
  const taxable=Math.max(0,merchandise+(settings.taxFreight?freight:0)+settings.charges.filter(c=>c.taxable).reduce((n,c)=>n+numeric(c.amount),0));
  const tax=settings.status==='Tax exempt'?0:settings.status==='Manual'?Math.max(0,numeric(settings.manualTax)):cents(taxable*Math.min(100,Math.max(0,numeric(settings.rate)))/100);
  return {additional,tax,total:cents(merchandise+freight+additional+tax)};
}
export function validateChargeSettings(notes:string) {
  const s=readChargeSettings(notes);if(!s)return '';
  if(s.status!=='Tax exempt'&&s.status!=='Manual'&&(!s.rate.trim()||!Number.isFinite(Number(s.rate))||Number(s.rate)<0||Number(s.rate)>100))return 'Enter a tax rate from 0 to 100%. Enter 0 explicitly if no tax is collected.';
  if(s.status==='Manual'&&(!s.manualTax.trim()||!Number.isFinite(Number(s.manualTax))||Number(s.manualTax)<0))return 'Enter a valid nonnegative tax amount.';
  if(s.charges.some(c=>!c.name.trim()||!c.amount.trim()||!Number.isFinite(Number(c.amount))))return 'Each additional charge needs a name and valid amount.';
  return '';
}
export function displayOrderNotes(notes:string) {
  const s=readChargeSettings(notes);if(!s)return notes;
  const tax=s.status==='Tax exempt'?'Tax exempt':s.status==='Manual'?`Sales tax: $${numeric(s.manualTax).toFixed(2)}`:`${s.status} sales tax: ${s.rate}%`;
  return [plainOrderNotes(notes),tax,...s.charges.map(c=>`${c.name}: $${numeric(c.amount).toFixed(2)}${c.taxable?' (taxable)':''}`)].filter(Boolean).join('\n');
}
