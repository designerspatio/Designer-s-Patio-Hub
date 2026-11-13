import {createClient} from '@supabase/supabase-js';
import {mayManageClaims} from '../../claims';
export class HttpError extends Error {constructor(message:string,public status=400){super(message);}}
export async function claimsContext(request:Request){
 const token=request.headers.get('authorization')?.match(/^Bearer (.+)$/i)?.[1];
 if(!token)throw new HttpError('Sign in to manage warranty claims.',401);
 const url=process.env.NEXT_PUBLIC_SUPABASE_URL, key=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, service=process.env.SUPABASE_SERVICE_ROLE_KEY||process.env.SUBABASE_SERVICE_ROLE_KEY;
 if(!url||!key||!service)throw new HttpError('Claims storage is not configured.',503);
 const options={auth:{persistSession:false,autoRefreshToken:false}};
 const {data:{user},error}=await createClient(url,key,options).auth.getUser(token);
 if(error||!user)throw new HttpError('Please sign in again.',401);
 const admin=createClient(url,service,options);
 const {data:profile,error:pe}=await admin.from('profiles').select('id,display_name,role,active').eq('id',user.id).single();
 if(pe||!profile||profile.active!==true||!mayManageClaims(profile))throw new HttpError('Claims are limited to warranty and management accounts.',403);
 return {admin,user,profile};
}
