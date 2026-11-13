import type {SupabaseClient} from '@supabase/supabase-js';
import {withPoDeadline} from './poAcknowledgements';
export async function claimRequest(supabase:SupabaseClient|null,method:string,body?:unknown,query=''){
 return withPoDeadline(async signal=>{const s=await supabase?.auth.getSession();if(!s?.data.session)throw new Error('Please sign in again.');const r=await fetch('/api/claims'+query,{method,cache:'no-store',signal,headers:{Authorization:`Bearer ${s.data.session.access_token}`,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});const data=await r.json();if(!r.ok)throw new Error(data.error||'Claims request failed.');return data;});
}
