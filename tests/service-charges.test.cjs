const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),{stripTypeScriptTypes}=require('node:module');
const code = ['src/app/orderCharges.ts','src/app/serviceCharges.ts'].map(p=>stripTypeScriptTypes(fs.readFileSync(p,'utf8'),{mode:'transform'}).replace(/^import .*;\n/gm,'').replace(/export /g,'')).join('\n');
const ctx={};vm.createContext(ctx);vm.runInContext(code,ctx);
const settings={status:'Out-of-state',rate:'8.25',taxFreight:true,manualTax:'0',charges:[]};
const notes=ctx.writeChargeSettings('Deliver to client',settings);
test('converted order uses service-charge wording while quote and in-state wording stay accurate',()=>{
 assert.equal(ctx.salesChargeLabel(notes),'Out-of-state service charge');
 assert.match(ctx.displayOrderNotes(notes,true),/Out-of-state service charge: 8.25%/);
 assert.match(ctx.displayOrderNotes(notes),/Out-of-state sales tax/);
 assert.equal(ctx.salesChargeLabel(ctx.writeChargeSettings('',{...settings,status:'In-state'})),'Sales tax');
 assert.equal(ctx.salesChargeLabel(ctx.writeChargeSettings('',{...settings,status:'Tax exempt'})),'Tax exempt');
});
test('service-charge report uses saved amount exactly once and does not infer status from destination',()=>{
 const order={notes,tax_amount:'90.75',status:'Open'};
 assert.equal(ctx.outOfStateServiceCharge(order),90.75);
 for(const status of ['Void','Canceled','Cancelled']) assert.equal(ctx.outOfStateServiceCharge({...order,status}),0);
 assert.equal(ctx.outOfStateServiceCharge({...order,notes:null}),0);
 assert.equal(ctx.outOfStateServiceCharge({...order,notes:ctx.writeChargeSettings('',{...settings,status:'In-state'})}),0);
 assert.equal(ctx.calculateOrderCharges(notes,1000,100,0).total,1190.75);
});
test('daily, full-month and YTD boundaries include leap day and year transitions without timezone shifts',()=>{
 for(const [period,date,start,end] of [
 ['day','2026-11-04','2026-11-04','2026-11-04'],
 ['month','2024-02-14','2024-02-01','2024-02-29'],
 ['month','2026-12-01','2026-12-01','2026-12-31'],
 ['ytd','2026-11-06','2026-01-01','2026-11-06'],
 ['ytd','2027-01-01','2027-01-01','2027-01-01']]){
  const r=ctx.serviceChargeRange(period,date);assert.equal(r.start,start);assert.equal(r.end,end);
 }
 assert.throws(()=>ctx.serviceChargeRange('day',''));assert.throws(()=>ctx.serviceChargeRange('day','2026-02-30'));
});
