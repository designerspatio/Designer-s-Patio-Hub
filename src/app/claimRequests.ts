import type {SupabaseClient} from '@supabase/supabase-js';
import {withPoDeadline,PoSaveTimeout} from './poAcknowledgements';
export async function claimRequest(supabase:SupabaseClient|null,method:string,body?:unknown,query=''){
 try{return await withPoDeadline(async signal=>{const s=await supabase?.auth.getSession();if(!s?.data.session)throw new Error('Please sign in again.');const r=await fetch('/api/claims'+query,{method,cache:'no-store',signal,headers:{Authorization:`Bearer ${s.data.session.access_token}`,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});const data=await r.json();if(!r.ok)throw new Error(data.error||'Claims request failed.');return data;});}catch(e){if(e instanceof PoSaveTimeout)throw new Error('The claim save could not be confirmed in time. Your edits are still on screen. Refresh the claims list to check for the saved claim before retrying.');throw e;}
}
