const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');
function moduleFrom(path, imports = {}) {
  let source = stripTypeScriptTypes(fs.readFileSync(path, 'utf8'), { mode: 'transform' });
  const names = [...source.matchAll(/export (?:async )?(?:function|const|class) (\w+)/g)].map(match => match[1]);
  source = source.replace(/import \{([^}]+)\} from "([^"]+)";/g, 'const {$1} = require("$2");')
    .replace(/export /g, '') + '\nObject.assign(module.exports, {' + names.join(',') + '});';
  const module = { exports: {} };
  vm.runInNewContext(source, { exports: module.exports, module, require: name => imports[name] || require(name), process, Buffer, Response, Request, console, Date, Set });
  return module.exports;
}
const model = moduleFrom('src/app/crmWorkspace.ts');
const plain = value => JSON.parse(JSON.stringify(value));
const state = () => ({ ...model.emptyWorkspace(), note: 'Client talking points', tasks: [{id:'task-1', title:'Send fabric options', clientId:'client-1', dueDate:'2026-10-02', priority:'high', createdAt:'2026-10-02T12:00:00Z', completedAt:null}] });
test('validates workspace, rejects invalid dates, duplicate tasks and oversized notes', () => {
  assert.equal(model.parseWorkspace(state()).tasks[0].title, 'Send fabric options');
  assert.throws(() => model.parseWorkspace({...state(), note:'x'.repeat(20001)}));
  assert.throws(() => model.parseWorkspace({...state(), tasks:[state().tasks[0], state().tasks[0]]}));
  assert.throws(() => model.parseWorkspace({...state(), tasks:[{...state().tasks[0], dueDate:'2026-02-30'}]}));
  assert.equal(model.isDate('2028-02-29'),true);
  assert.equal(model.isDate('2026-02-29'),false);
});
test('classifies due, overdue, undated, upcoming and completed tasks without date timezone shifts', () => {
  const task = state().tasks[0];
  assert.equal(model.taskGroup(task, '2026-10-02'), 'today');
  assert.equal(model.taskGroup(task, '2026-10-03'), 'overdue');
  assert.equal(model.taskGroup(task, '2026-10-01'), 'upcoming');
  assert.equal(model.taskGroup({...task,dueDate:''}, '2026-10-01'), 'undated');
  assert.equal(model.taskGroup({...task,completedAt:'2026-10-02T15:00:00Z'}, '2026-10-03'), 'completed');
  assert.equal(model.dateAfter(1,new Date(2026,11,31,23)), '2027-01-01');
});
function backend() {
  const files = new Map(); let publicBucket = false, failRead = false, inactive = false;
  const storage = {
    getBucket: async () => ({data:{public:publicBucket},error:null}),
    from: () => ({
      list: async (id) => failRead ? {data:null,error:{message:'down'}} : {data:[...files.keys()].filter(p=>p.startsWith(id+'/')).sort().reverse().slice(0,1).map(p=>({name:p.split('/')[1]})),error:null},
      download: async path => ({data:{text:async()=>files.get(path)},error:null}),
      upload: async (path, content, opts) => {
        assert.equal(opts.upsert,false);
        if(files.has(path)) return {error:{message:'The resource already exists',statusCode:'409'}};
        files.set(path,content); return {error:null};
      }
    })
  };
  const createClient = () => ({
    auth:{getUser: async token=>({data:{user:token === 'invalid' ? null : {id:token}},error:null})}, storage,
    from:()=>({select:()=>({eq:(_k,id)=>({single:async()=>({data:{id,active:!inactive},error:null})})})})
  });
  process.env.NEXT_PUBLIC_SUPABASE_URL='https://test.invalid';
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY='test-public';
  process.env.SUPABASE_SERVICE_ROLE_KEY='test-service';
  const route = moduleFrom('src/app/api/workspace/route.ts', {'@supabase/supabase-js':{createClient},'../../crmWorkspace':model,'next/server':{NextResponse:{json:(body,init)=>Response.json(body,init)}}});
  const req=(user,body)=>new Request('http://test/api/workspace', {method:body?'PUT':'GET',headers:user?{authorization:`Bearer ${user}`}:{},...(body?{body:JSON.stringify(body)}:{})});
  return {route,req,files,setPublic:()=>publicBucket=true,setFailure:()=>failRead=true,setInactive:()=>inactive=true};
}
test('API verifies sign-in and active accounts, keeps each user isolated and persists on reload', async()=> {
  const {route,req,setInactive}=backend();
  assert.equal((await route.GET(req())).status,401);
  assert.equal((await route.GET(req('invalid'))).status,401);
  const saved=await route.PUT(req('user-a',state())); assert.equal(saved.status,200);
  const a=await (await route.GET(req('user-a'))).json();
  assert.equal(a.workspace.note,'Client talking points'); assert.equal(a.workspace.version,1);
  const b=await (await route.GET(req('user-b'))).json(); assert.deepEqual(b.workspace,plain(model.emptyWorkspace()));
  assert.equal((await route.PUT(req('user-a',state()))).status,409);
  setInactive(); assert.equal((await route.GET(req('user-a'))).status,403);
});
test('simultaneous saves cannot overwrite each other', async()=> {
  const {route,req,files}=backend();
  const responses=await Promise.all([route.PUT(req('user-a',{...state(),note:'tab 1'})),route.PUT(req('user-a',{...state(),note:'tab 2'}))]);
  assert.deepEqual(responses.map(r=>r.status).sort(),[200,409]); assert.equal(files.size,1);
});
test('legacy server key setting supports saving and reloading without weakening authentication', async()=> {
  const {route,req}=backend();
  const canonical=process.env.SUPABASE_SERVICE_ROLE_KEY;
  const legacy=process.env.SUBABASE_SERVICE_ROLE_KEY;
  try {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    process.env.SUBABASE_SERVICE_ROLE_KEY='test-service';
    assert.equal((await route.GET(req('invalid'))).status,401);
    assert.equal((await route.PUT(req('user-a',state()))).status,200);
    const loaded=await (await route.GET(req('user-a'))).json();
    assert.equal(loaded.workspace.note,'Client talking points');
    delete process.env.SUBABASE_SERVICE_ROLE_KEY;
    assert.equal((await route.GET(req('user-a'))).status,503);
  } finally {
    process.env.SUPABASE_SERVICE_ROLE_KEY=canonical;
    if (legacy === undefined) delete process.env.SUBABASE_SERVICE_ROLE_KEY;
    else process.env.SUBABASE_SERVICE_ROLE_KEY=legacy;
  }
});
test('storage failures and public bucket misconfiguration never appear as empty or successful saves',async()=> {
  const a=backend(); a.setFailure(); assert.equal((await a.route.GET(a.req('user-a'))).status,503);
  const b=backend(); b.setPublic(); assert.equal((await b.route.PUT(b.req('user-a',state()))).status,503); assert.equal(b.files.size,0);
});
