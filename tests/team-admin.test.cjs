const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {stripTypeScriptTypes}=require('node:module');
const actor={id:'manager',display_name:'Manager',active:true,role:'Manager'};
function backend({legacy=false,missing=false,authError=false,profileError=false}={}) {
 const calls={created:0,deleted:0,keys:[]};
 const env={NEXT_PUBLIC_SUPABASE_URL:'https://example.invalid',NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:'public'};
 if(!missing)env[legacy?'SUBABASE_SERVICE_ROLE_KEY':'SUPABASE_SERVICE_ROLE_KEY']='service-test';
 const admin={auth:{admin:{createUser:async()=>{calls.created++;return {data:{user:{id:'new-user'}},error:authError?{message:'User already registered'}:null}},deleteUser:async()=>{calls.deleted++;return {error:null}}}},from:()=>({select:()=>({eq:()=>({single:async()=>({data:actor,error:null})})}),upsert:async()=>({error:profileError?{message:'Profile rejected'}:null})})};
 const createClient=(_url,key)=>{calls.keys.push(key);return key==='public'?{auth:{getUser:async token=>({data:{user:token==='valid'?{id:'manager'}:null},error:null})}}:admin};
 let source=stripTypeScriptTypes(fs.readFileSync('src/app/api/team/route.ts','utf8'),{mode:'transform'}).replace(/import \{([^}]+)\} from "([^"]+)";/g,'const {$1}=require("$2");').replace(/export /g,'');
 const ctx={module:{exports:{}},process:{env},require:name=>name==='@supabase/supabase-js'?{createClient}:name==='next/server'?{NextResponse:{json:(b,i)=>Response.json(b,i)}}:require(name)};
 vm.runInNewContext(source+'\nmodule.exports={POST}',ctx);
 const request=(token='valid')=>new Request('https://test.invalid/api/team',{method:'POST',headers:{authorization:`Bearer ${token}`},body:JSON.stringify({action:'create',display_name:'New Person',email:'new@example.invalid',role:'Administrative',default_commission_rate:0})});
 return {post:ctx.module.exports.POST,request,calls};
}
test('canonical and legacy server key both create a login and return its temporary password',async()=>{
 for(const legacy of [false,true]){const b=backend({legacy});const res=await b.post(b.request());assert.equal(res.status,200);const body=await res.json();assert.equal(body.user.id,'new-user');assert.ok(body.temporary_password.length>=16);assert.equal(b.calls.created,1);assert.ok(b.calls.keys.includes('service-test'));}
});
test('unauthenticated requests never create users',async()=>{const b=backend();assert.equal((await b.post(b.request('invalid'))).status,401);assert.equal(b.calls.created,0);});
test('missing configuration and duplicate users return actionable errors',async()=>{
 const missing=backend({missing:true});const res=await missing.post(missing.request());assert.equal(res.status,500);assert.match((await res.json()).error,/service-role key is missing/);assert.equal(missing.calls.created,0);
 const duplicate=backend({authError:true});const d=await duplicate.post(duplicate.request());assert.equal(d.status,400);assert.match((await d.json()).error,/already registered/);
});
test('profile failure rolls back the created login',async()=>{const b=backend({profileError:true});const res=await b.post(b.request());assert.equal(res.status,400);assert.equal(b.calls.deleted,1);assert.equal((await res.json()).temporary_password,undefined);});
test('save validation, server errors and success are shown inside Team modal',async()=>{
 const page=fs.readFileSync('src/app/page.tsx','utf8');const start=page.indexOf('  async function saveTeamMember()'),end=page.indexOf('  async function resetTeamPassword()',start);
 const source=stripTypeScriptTypes(page.slice(start,end),{mode:'transform'});
 const messages=[];const ctx={teamAdminSaving:false,teamAdminMode:'new',teamAdminForm:{display_name:'',email:'new@example.invalid',commission_pct:'0',phone:'',role:'Administrative'},setTeamAdminMessage:m=>messages.push(m),setTeamAdminSaving:()=>{},teamAdminApi:async()=>({ok:false,payload:{error:'User already registered'}}),numberOrZero:v=>Number(v)||0,setSelectedAdminTeamMember:()=>{},setTeamAdminMode:()=>{},setTeamAdminForm:()=>{},setTeamTemporaryPassword:()=>{},loadAdminTeam:async()=>{},loadTeam:async()=>{},loadProfile:async()=>{}};
 vm.createContext(ctx);vm.runInContext(source,ctx);await ctx.saveTeamMember();assert.equal(messages.at(-1),'Team member name is required.');
 ctx.teamAdminForm.display_name='New Person';await ctx.saveTeamMember();assert.equal(messages.at(-1),'User already registered');
 ctx.teamAdminApi=async()=>({ok:true,payload:{user:{id:'new-user',display_name:'New Person'},temporary_password:'test-only'}});await ctx.saveTeamMember();assert.equal(messages.at(-1),'Team member login created.');
 const modal=page.slice(page.indexOf('{teamAdminModalOpen && ('));assert.match(modal, /role="status" aria-live="polite"[\s\S]*?\{teamAdminMessage\}/);
});
