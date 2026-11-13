const fs=require('node:fs'),{stripTypeScriptTypes}=require('node:module');
require.extensions['.ts']=(m,f)=>{
 let source=stripTypeScriptTypes(fs.readFileSync(f,'utf8'),{mode:'transform'});
 const names=[...source.matchAll(/export (?:async )?(?:function|const|class) (\w+)/g)].map(x=>x[1]);
 source=source.replace(/import \{([^}]+)\} from ['"]([^'"]+)['"];?/g,'const {$1}=require("$2");').replace(/export /g,'');
 m._compile(source+'\nObject.assign(module.exports,{'+names.join(',')+'});',f);
};
const originalFetch=global.fetch;
global.fetch=async(url,options)=>{const response=await originalFetch(url,options);const host=new URL(String(url)).hostname;if(['oauth2.googleapis.com','sheets.googleapis.com'].includes(host))console.log('SHEETS_CONNECTION_CHECK '+host+' HTTP '+response.status);return response;};
const {syncClaim,sheetConfigured}=require('../src/app/api/claims/sheets.ts');
const {createClient}=require('@supabase/supabase-js');
(async()=>{
 if(!sheetConfigured())throw new Error('Google credential is missing from Production.');
 const db=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY||process.env.SUBABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
 const result=await db.from('warranty_claims').select('*').order('claim_number');
 if(result.error)throw new Error('Unable to load pending claims for sync verification.');
 console.log('CLAIMS_DATABASE_READ_OK');
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
