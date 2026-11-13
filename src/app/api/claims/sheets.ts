import {createSign} from 'node:crypto';
import {CLAIM_SHEET_ID,sheetValues,type Claim} from '../../claims';
const TAB='Hub Claims';
export function sheetConfigured(){return !!process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON;}
async function accessToken(){
 if(!sheetConfigured())throw new Error('Google Sheet connection needs a service account. Claim is saved; sync can be retried after setup.');
 const account=JSON.parse(process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON!);
 const now=Math.floor(Date.now()/1000);
 const b64=(value:unknown)=>Buffer.from(JSON.stringify(value)).toString('base64url');
 const part=b64({alg:'RS256',typ:'JWT'})+'.'+b64({iss:account.client_email,scope:'https://www.googleapis.com/auth/spreadsheets',aud:'https://oauth2.googleapis.com/token',iat:now,exp:now+3600});
 const signature=createSign('RSA-SHA256').update(part).sign(account.private_key,'base64url');
 const response=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion:part+'.'+signature}),signal:AbortSignal.timeout(10000)});
 const body=await response.json(); if(!response.ok||!body.access_token)throw new Error('Google authorization failed. Check the service account configuration.');return body.access_token as string;
}
export async function syncClaim(claim:Claim){
 const token=await accessToken(); const base=`https://sheets.googleapis.com/v4/spreadsheets/${CLAIM_SHEET_ID}`;
 async function call(path:string,method='GET',body?:unknown){const r=await fetch(base+path,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(10000)});if(!r.ok)throw new Error('Google Sheet sync failed. Verify service account Editor access and retry.');return r.json();}
 const meta=await call('?fields=sheets.properties');
 if(!meta.sheets?.some((s:{properties:{title:string}})=>s.properties.title===TAB)){
  // A dedicated tab preserves Niyah's existing claims and column layout.
  try{await call(':batchUpdate','POST',{requests:[{addSheet:{properties:{title:TAB}}}]});}catch{const retry=await call('?fields=sheets.properties');if(!retry.sheets?.some((s:{properties:{title:string}})=>s.properties.title===TAB))throw new Error('Could not create the Hub Claims tab.');}
 }
 const header=['Claim #','Opened','Customer','Manufacturer','Sales order','Items','Issue','Status','Claim reference #','Claims PO','Acknowledgement','Expected ship date','Received','Returned merchandise','Invoice','Notes','Updated','Hub link','Freight claim references','Items and parts ordered','Account credits'];
 await call(`/values/${encodeURIComponent("'Hub Claims'!A1:U1")}?valueInputOption=RAW`,'PUT',{values:[header]});
 // Stable, unique claim numbers map to stable rows; retries cannot append duplicates.
 const row=claim.claim_number+1;
 await call(`/values/${encodeURIComponent(`'Hub Claims'!A${row}:U${row}`)}?valueInputOption=RAW`,'PUT',{values:[sheetValues(claim,process.env.HUB_PUBLIC_URL||'https://designer-s-patio-hub.vercel.app')]});
}
