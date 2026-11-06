const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');
const source = fs.readFileSync('src/app/page.tsx', 'utf8');
function harness(name, end, tables, overrides = {}) {
  const alerts = [], writes = [];
  const ctx = {
    supabase: { from(table) {
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
    loadDailyCashBatchDetails:async()=>{},loadDailyCashBatches:async()=>{},
    ...overrides
  };
  vm.createContext(ctx);
  const code = source.slice(source.indexOf(`  async function ${name}(`),source.indexOf(`  ${end}`,source.indexOf(`  async function ${name}(`)));
  vm.runInContext(stripTypeScriptTypes(code,{mode:'transform'}),ctx);
  return {run:ctx[name],writes,alerts};
}
const batch = {id:'b',status:'Open',business_date:'2026-11-04'};
function fixtures(){return {payments:[
 {id:'p',payment_date:'2026-11-04',posted:true,posted_at:'2026-11-06T23:00:00Z',amount:100,payment_method:'Cash'},
 {id:'draft',payment_date:'2026-11-04',posted:false,amount:50,payment_method:'Cash'},
 {id:'other',payment_date:'2026-11-06',posted:true,amount:500,payment_method:'Cash'},
 {id:'locked',payment_date:'2026-11-04',posted:true,amount:300,payment_method:'Cash'}
],daily_cash_batch_payments:[{daily_cash_batch_id:'locked-batch',payment_id:'locked'}],daily_cash_tender_totals:[]};}
test('backdated payments use payment date, exclude drafts and already batched payments; refresh is idempotent',async()=>{
 const h=harness('syncDailyCashBatchPayments','function updateDailyCashTenderDraft',fixtures());
 const result=await h.run(batch,false,false);
 assert.deepEqual(Array.from(result,p=>p.id),['p']);
 const cash=h.writes.find(w=>w.operation==='upsert').payload.find(t=>t.payment_method==='Cash');
 assert.equal(cash.system_amount,100);assert.equal(cash.actual_amount,100);
 await h.run(batch,false,false);
 assert.equal(h.writes.filter(w=>w.operation==='insert').length,1);
});
test('locked batch is immutable and query failures cannot return stale payment data',async()=>{
 const h=harness('syncDailyCashBatchPayments','function updateDailyCashTenderDraft',fixtures());
 assert.equal(await h.run({...batch,status:'Posted'}),null);assert.equal(h.writes.length,0);
 const failed=harness('syncDailyCashBatchPayments','function updateDailyCashTenderDraft',{payments:new Error('offline')});
 assert.equal(await failed.run(batch),null);assert.match(failed.alerts[0],/offline/);
});
test('Daily Cash cannot lock while customer payments remain unposted',async()=>{
 const h=harness('postDailyCashBatch','function closeDailyCashBatch',fixtures(),{selectedDailyCashBatch:batch});
 await h.run();assert.equal(h.writes.length,0);assert.match(h.alerts[0],/still unposted/);
});
test('Daily Cash cannot lock an empty batch or after a failed refresh',async()=>{
 for(const value of [null,[]]) {
  const h=harness('postDailyCashBatch','function closeDailyCashBatch',{payments:[]},{selectedDailyCashBatch:batch,syncDailyCashBatchPayments:async()=>value});
  await h.run();assert.equal(h.writes.length,0);
 }
});
