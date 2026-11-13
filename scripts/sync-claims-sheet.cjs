const fs=require('node:fs'),ts=require('typescript');
require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,f);
const {syncClaim,sheetConfigured}=require('./src/app/api/claims/sheets.ts');
const {createClient}=require('@supabase/supabase-js');
(async()=>{
 if(!sheetConfigured())throw new Error('Google credential is missing from Production.');
 const db=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY||process.env.SUBABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
 const result=await db.from('warranty_claims').select('*').order('claim_number');
 if(result.error)throw new Error('Unable to load pending claims for sync verification.');
 let count=0;
 for(const initial of result.data){
  if(initial.synced_version===initial.version)continue;
  const now=new Date().toISOString();
  const lock=await db.from('warranty_claims').update({sync_lock_until:new Date(Date.now()+90000).toISOString()}).eq('id',initial.id).or('sync_lock_until.is.null,sync_lock_until.lt.'+now).select('*').maybeSingle();
  if(lock.error)throw new Error('Unable to acquire claim sync lock.');
  if(!lock.data)continue;
  try{
   await syncClaim(lock.data);
   const updated=await db.from('warranty_claims').update({synced_at:new Date().toISOString(),synced_version:lock.data.version,sync_error:null}).eq('id',initial.id);
   if(updated.error)throw new Error('Sheet write succeeded but Hub confirmation failed.');
   count++;
  }finally{await db.from('warranty_claims').update({sync_lock_until:null}).eq('id',initial.id);}
 }
 console.log('CLAIMS_SHEET_SYNC_VERIFIED_COUNT='+count);
})().catch(()=>{console.error('CLAIMS_SHEET_SYNC_VERIFICATION_FAILED: check credential format, Sheets API enablement and spreadsheet Editor access.');process.exitCode=1;});
