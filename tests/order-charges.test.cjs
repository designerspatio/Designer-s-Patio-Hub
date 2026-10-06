const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),{stripTypeScriptTypes}=require('node:module');
const code=stripTypeScriptTypes(fs.readFileSync('src/app/orderCharges.ts','utf8'),{mode:'transform'}).replace(/export /g,'');const ctx={module:{exports:{}}};vm.runInNewContext(code+'\nmodule.exports={readChargeSettings,writeChargeSettings,calculateOrderCharges,plainOrderNotes,validateChargeSettings}',ctx);
const {readChargeSettings,writeChargeSettings,calculateOrderCharges,plainOrderNotes,validateChargeSettings}=ctx.module.exports;
const settings={status:'In-state',rate:'8.25',taxFreight:true,manualTax:'0',charges:[{name:'Delivery service',amount:'50',taxable:true},{name:'Extra charge',amount:'20',taxable:false}]};
test('tax applies once to merchandise, optional freight and taxable charges',()=>{
 const notes=writeChargeSettings('Customer notes',settings);const q=calculateOrderCharges(notes,1000,100,0);assert.equal(q.additional,70);assert.equal(q.tax,94.88);assert.equal(q.total,1264.88);
 // Quote stores combined charges; reopening must not double tax or charges.
 const reopened=calculateOrderCharges(notes,1000,100,q.additional+q.tax);assert.equal(reopened.total,q.total);
 const sale=calculateOrderCharges(notes,1000,100,q.additional,q.tax);assert.equal(sale.total,q.total);
});
test('out of state supports custom rate; exempt is always zero; manual preserves old tax',()=>{
 const out=writeChargeSettings('',{...settings,status:'Out-of-state',rate:'5',taxFreight:false});assert.equal(calculateOrderCharges(out,1000,100,0).tax,52.5);
 const exempt=writeChargeSettings('',{...settings,status:'Tax exempt'});assert.equal(calculateOrderCharges(exempt,1000,100,0).tax,0);
 assert.equal(calculateOrderCharges('',1000,100,25,10).total,1135);
});
test('settings and multiword charge descriptions survive reload and freeform notes edits',()=>{
 const notes=writeChargeSettings('Please call\nbefore delivery',settings);assert.equal(plainOrderNotes(notes),'Please call\nbefore delivery');const read=readChargeSettings(notes);assert.equal(read.charges[0].name,'Delivery service');assert.equal(read.charges[0].amount,'50');assert.equal(read.charges[0].taxable,true);
 const edited=writeChargeSettings('New notes',read);assert.equal(plainOrderNotes(edited),'New notes');assert.equal(readChargeSettings(edited).rate,'8.25');
});
test('validation rejects missing rate and malformed charges, allows explicit zero rate',()=>{
 assert.ok(validateChargeSettings(writeChargeSettings('',{...settings,rate:''})));assert.ok(validateChargeSettings(writeChargeSettings('',{...settings,rate:'101'})));assert.equal(validateChargeSettings(writeChargeSettings('',{...settings,rate:'0'})),'');assert.ok(validateChargeSettings(writeChargeSettings('',{...settings,charges:[{name:'',amount:'10',taxable:false}]})));
});
test('changing freight recalculates tax and exempt retains charges',()=>{
 const notes=writeChargeSettings('',settings);assert.equal(calculateOrderCharges(notes,1000,200,0).tax,103.13);const ex=calculateOrderCharges(writeChargeSettings('',{...settings,status:'Tax exempt'}),1000,200,0);assert.equal(ex.additional,70);assert.equal(ex.total,1270);
});
