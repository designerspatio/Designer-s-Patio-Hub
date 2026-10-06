import { csvTable } from './clientCsv';
export type Mapping = { date:number; payee:number; amount:number; category:number; reference:number; type:number };
export type Options = { negativeCharges:boolean; dayFirst:boolean; account:string; category:string };
export type ExpenseRow = { line:number; expense_date:string; payee:string; amount:number; category:string; reference:string; reason:string; key:string; occurrence:number };
export function readStatement(source:string) {
  const table=csvTable(source).filter(r=>r.some(c=>c.trim()));
  if(table.length<2)throw new Error('Include a header row and at least one transaction.');
  if(table.length>5001)throw new Error('Import up to 5,000 transactions at a time.');
  const headers=table[0];
  const index=(names:string[])=>headers.findIndex(h=>names.includes(h.toLowerCase().replace(/[^a-z0-9]/g,'')));
  const mapping:Mapping={date:index(['transactiondate','date','posteddate','postingdate']),payee:index(['description','merchant','payee','transactiondescription','name']),amount:index(['amount','transactionamount','debit','charge','charges']),category:index(['category']),reference:index(['reference','reference number'.replace(/ /g,''),'transactionid']),type:index(['type','transactiontype'])};
  return {headers,rows:table.slice(1),mapping};
}
function dateValue(value:string,dayFirst:boolean) {
  let y:number,m:number,d:number;
  let match=value.trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if(match){[,y,m,d]=match.map(Number);}else{
    match=value.trim().match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);
    if(!match)return '';
    y=+match[3];m=+match[dayFirst?2:1];d=+match[dayFirst?1:2];
  }
  const date=new Date(Date.UTC(y,m-1,d));
  return date.getUTCFullYear()===y&&date.getUTCMonth()===m-1&&date.getUTCDate()===d?`${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`:'';
}
export function statementRows(rows:string[][],headers:string[],map:Mapping,options:Options):ExpenseRow[] {
  if([map.date,map.payee,map.amount].some(n=>n<0))throw new Error('Choose the date, merchant/description, and charge amount columns.');
  if(new Set([map.date,map.payee,map.amount]).size!==3)throw new Error('Date, description, and amount must use different columns.');
  const counts=new Map<string,number>();
  return rows.map((cells,i)=>{
    const get=(n:number)=>cells[n]?.trim()||'';
    const expense_date=dateValue(get(map.date),options.dayFirst),payee=get(map.payee);
    const raw=get(map.amount).replace(/[$,\s]/g,'').replace(/^\((.*)\)$/,'-$1');
    const parsed=/^[+-]?\d+(\.\d{1,2})?$/.test(raw)?Number(raw):NaN;
    const amount=Math.round(parsed*(options.negativeCharges?-1:1)*100)/100;
    const type=get(map.type);
    let reason='';
    if(cells.length!==headers.length)reason='Wrong number of columns';
    else if(!expense_date)reason='Invalid date';
    else if(!payee)reason='Missing merchant/description';
    else if(!Number.isFinite(amount))reason='Invalid or empty charge amount';
    else if(/\b(payment|autopay|refund|credit|return)\b/i.test(type)||/\b(payment received|payment thank you|autopay payment|automatic payment|online payment|payment - thank you)\b/i.test(payee))reason='Payment or credit';
    else if(amount<=0)reason='Credit, payment, or zero amount';
    const reference=get(map.reference);
    const key=JSON.stringify([options.account.trim().toLowerCase(),expense_date,payee.toLowerCase().replace(/\s+/g,' '),amount,reference]);
    const occurrence=(counts.get(key)||0)+1;counts.set(key,occurrence);
    return {line:i+2,expense_date,payee,amount,category:get(map.category)||options.category.trim(),reference,reason,key,occurrence};
  });
}
export async function expenseImportId(row:ExpenseRow) {
  const bytes=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode('statement-expense-v1:'+row.key+':'+row.occurrence)));
  bytes[6]=(bytes[6]&15)|80;bytes[8]=(bytes[8]&63)|128;
  const h=Array.from(bytes.slice(0,16),b=>b.toString(16).padStart(2,'0')).join('');
  return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
}
