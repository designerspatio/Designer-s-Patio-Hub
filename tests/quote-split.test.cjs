const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {stripTypeScriptTypes}=require('node:module');
const source=['manufacturerCharges','orderCharges','quoteSplit'].map(n=>stripTypeScriptTypes(fs.readFileSync(`src/app/${n}.ts`,'utf8'),{mode:'transform'}).replace(/^import .*;\s*$/gm,'').replace(/export /g,'').replaceAll('const cents =','var cents =')).join('\n');
const ctx={module:{exports:{}}};vm.runInNewContext(source+'\nmodule.exports={splitQuoteLines,splitQuoteCharges,writeChargeSettings,readChargeSettings};',ctx);
const {splitQuoteLines:split,splitQuoteCharges:charges,writeChargeSettings:write,readChargeSettings:read}=ctx.module.exports;
const line=id=>({id,local_id:id,sku:id,manufacturer_id:'m',quantity:'2',unit_price:100,msrp_at_grade:200,purchasing_factor_snapshot:.4,expected_unit_cost:80,tariff_pct_snapshot:6,surcharge_pct_snapshot:0});
test('moves selected whole rows, preserves IDs/pricing, rebuilds charges separately',()=>{
 const lines=[line('a'),line('b')]; const parts=split(lines,['a'],[{id:'m',name:'Brand'}]);
 assert.equal(parts.moved[0].id,'a');assert.equal(parts.remaining[0].id,'b');assert.equal(parts.moved[0].quantity,'2');assert.equal(parts.moved[1].unit_price,12);assert.equal(parts.remaining[1].unit_price,12);assert.equal(lines.length,2);
});
test('rejects empty, all, duplicate, unknown and generated charge selections',()=>{
 for(const ids of [[],['a','b'],['a','a'],['unknown'],['charge']])assert.throws(()=>split([line('a'),line('b'),{...line('charge'),sku:'__DP_TARIFF__m'}],ids,[]));
});
test('keeps freight and extras original; applies tax independently',()=>{
 const notes=write('Customer notes',{status:'In-state',rate:'8.25',taxFreight:true,manualTax:'0',charges:[{name:'Delivery',amount:'20',taxable:true}]});
 const result=charges(notes,999,10,100,200,42);assert.equal(result.remaining.adjustment_amount,30.73);assert.equal(result.moved.adjustment_amount,16.5);assert.equal(read(result.moved.notes).charges.length,0);assert.match(result.moved.notes,/Split from quote #42/);assert.match(result.moved.notes,/Customer notes/);
});
test('manual tax and legacy adjustments are never duplicated',()=>{
 const notes=write('',{status:'Manual',rate:'0',taxFreight:false,manualTax:'25',charges:[]});
 assert.equal(charges(notes,25,10,100,200,1).moved.adjustment_amount,0);assert.equal(charges(notes,25,10,100,200,1).remaining.adjustment_amount,25);
 assert.equal(charges('',33,10,100,200,1).remaining.adjustment_amount,33);assert.equal(charges('',33,10,100,200,1).moved.adjustment_amount,0);
});
