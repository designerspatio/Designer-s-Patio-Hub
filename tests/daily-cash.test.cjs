const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');
const source = fs.readFileSync('src/app/page.tsx', 'utf8');
function harness(name, end, tables, overrides = {}) {
  const alerts = [], writes = [], rpcCalls = [];
  const ctx = {
    supabase: { rpc(name, args) {
      rpcCalls.push({name,args});
      return {single: async () => tables.rpcResult};
    }, from(table) {
      const filters = []; let operation = 'select', payload;
      const q = {
        select() { return q; }, order() { return q; },
        eq(k,v) { filters.push(r => r[k] === v); return q; },
        in(k,v) { filters.push(r => v.includes(r[k])); return q; },
        insert(v) { operation = 'insert'; payload = v; return q; },
        upsert(v) { operation = 'upsert'; payload = v; return q; },
        update(v) { operation = 'update'; payload = v; return q; },
        then(resolve) {
          if (tables[table] instanceof Error) return Promise.resolve(resolve({data:null,error:{message:tables[table].message}}));
          if (operation !== 'select') {
            writes.push({table,operation,payload});
            if (operation === 'insert') tables[table].push(...payload);
          }
          return Promise.resolve(resolve({data:(tables[table] || []).filter(r=>filters.every(f=>f(r))),error:null}));
        }
      }; return q;
    }},
    window:{alert:s=>alerts.push(s),confirm:()=>true},
    paymentColumns:'*',dailyCashBatchPaymentColumns:'*',dailyCashTenderTotalColumns:'*',
    paymentMethods:['Cash','Visa'],numberOrZero:v=>Number(v)||0,money:v=>`$${v}`,
    dailyCashTenderDrafts:{Cash:{actual_amount:'999'}},selectedDailyCashBatch:{id:'other'},
    setDailyCashSyncing(){},setDailyCashBatchPayments(){},setMessage(){},setPostingDailyCash(){},
    setDailyCashTenderTotals(){},setDailyCashTenderDrafts(drafts){ctx.drafts=drafts;},
    setSelectedDailyCashBatch(batch){ctx.postedBatch=batch;},
    dailyCashBatchPayments:[],dailyCashNotes:'',selectedSale:null,
    loadDailyCashBatchDetails:async()=>{},loadDailyCashBatches:async()=>{},
    ...overrides
  };
  vm.createContext(ctx);
  const code = source.slice(source.indexOf(`  async function ${name}(`),source.indexOf(`  ${end}`,source.indexOf(`  async function ${name}(`)));
  vm.runInContext(stripTypeScriptTypes(code,{mode:'transform'}),ctx);
  return {run:ctx[name],writes,alerts,rpcCalls,ctx};
}
const batch = {id:'b',status:'Open',business_date:'2026-11-04'};
function fixtures(){return {payments:[
 {id:'p',payment_date:'2026-11-04',posted:true,posted_at:'2026-11-06T23:00:00Z',amount:100,payment_method:'Cash'},
 {id:'draft',payment_date:'2026-11-04',posted:false,amount:50,payment_method:'Cash'},
 {id:'other',payment_date:'2026-11-06',posted:true,amount:500,payment_method:'Cash'},
 {id:'locked',payment_date:'2026-11-04',posted:true,amount:300,payment_method:'Cash'}
],daily_cash_batch_payments:[{daily_cash_batch_id:'locked-batch',payment_id:'locked','daily_cash_batches.status':'Posted'}],daily_cash_tender_totals:[]};}
test('refresh previews both applied and legacy posted payments on their payment date',async()=>{
 const h=harness('syncDailyCashBatchPayments','function updateDailyCashTenderDraft',fixtures());
 const result=await h.run(batch,false,false);
 assert.deepEqual(Array.from(result,p=>p.id),['p','draft']);
 assert.equal(h.ctx.drafts.Cash.actual_amount,'150');
 assert.equal(h.writes.length,0);
});
test('locked batch is immutable and query failures cannot return stale payment data',async()=>{
 const h=harness('syncDailyCashBatchPayments','function updateDailyCashTenderDraft',fixtures());
 assert.equal(await h.run({...batch,status:'Posted'}),null);assert.equal(h.writes.length,0);
 const failed=harness('syncDailyCashBatchPayments','function updateDailyCashTenderDraft',{payments:new Error('offline')});
 assert.equal(await failed.run(batch),null);assert.match(failed.alerts[0],/offline/);
});
test('Daily Cash posts applied payments and locks the batch through one RPC',async()=>{
 const posted={...batch,status:'Posted'};
 const h=harness('postDailyCashBatch','function closeDailyCashBatch',{rpcResult:{data:posted,error:null}},{
   selectedDailyCashBatch:batch,dailyCashBatchPayments:fixtures().payments.slice(0,2),
   dailyCashTenderDrafts:{Cash:{actual_amount:'145',notes:'Drawer count'}},
 });
 await h.run();
 assert.equal(h.rpcCalls.length,1);
 assert.equal(h.rpcCalls[0].name,'dp_post_daily_cash');
 assert.equal(h.rpcCalls[0].args.p_batch_id,batch.id);
 assert.equal(h.rpcCalls[0].args.p_tenders[0].actual_amount,145);
 assert.equal(h.ctx.postedBatch,posted);
 assert.equal(h.writes.length,0);
});
test('Daily Cash displays posting failures without switching to a posted batch',async()=>{
 const h=harness('postDailyCashBatch','function closeDailyCashBatch',{
   rpcResult:{data:null,error:{message:'No customer payments are available'}},
 },{selectedDailyCashBatch:batch});
 await h.run();
 assert.equal(h.ctx.postedBatch,undefined);
 assert.match(h.alerts[0],/No customer payments/);
});
