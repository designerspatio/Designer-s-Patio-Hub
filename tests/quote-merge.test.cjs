const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {stripTypeScriptTypes}=require('node:module');
const ctx={module:{exports:{}}};
let source=['orderCharges','manufacturerCharges','quoteMerge'].map(name=>stripTypeScriptTypes(fs.readFileSync(`src/app/${name}.ts`,'utf8'),{mode:'transform'}).replace(/^import .*;\s*$/gm,'').replace(/export /g,'')).join('\n');
// Modules have their own cents helpers in production.
source=source.replaceAll('const cents =','var cents =');
vm.runInNewContext(source+'\nmodule.exports={mergeQuoteHeaders,mergeQuoteLines,writeChargeSettings,readChargeSettings,calculateOrderCharges,syncManufacturerCharges};',ctx);
const {mergeQuoteHeaders:merge,mergeQuoteLines,writeChargeSettings:write,readChargeSettings:read,calculateOrderCharges:calc,syncManufacturerCharges:sync}=ctx.module.exports;
const settings={status:'In-state',rate:'8.25',taxFreight:false,manualTax:'0',charges:[{name:'Delivery',amount:'20',taxable:false}]};
const q=(id,extra={})=>({id,quote_number:Number(id),client_id:'client',status:'Draft',converted_sales_order_id:null,notes:write('Notes '+id,settings),freight_amount:10,adjustment_amount:99,...extra});
test('same-client merge preserves notes, sums freight and charges, recalculates tax once',()=>{
 const result=merge([q('1'),q('2')]);assert.equal(result.freight_amount,'20');assert.equal(result.adjustment_amount,'0');assert.equal(read(result.notes).charges.length,2);
 const totals=calc(result.notes,200,20,0);assert.equal(totals.tax,16.5);assert.equal(totals.total,276.5);assert.match(result.notes,/Notes 1/);assert.match(result.notes,/Notes 2/);
});
test('rejects cross-client, duplicate, missing selection and converted or archived quotes',()=>{
 for(const rows of [[q('1')],[q('1'),q('1')],[q('1'),q('2',{client_id:'other'})],[q('1'),q('2',{converted_sales_order_id:'sale'})],[q('1'),q('2',{status:'Archived'})]])assert.throws(()=>merge(rows));
});
test('incompatible tax rules and legacy mixtures require correction',()=>{
 assert.throws(()=>merge([q('1'),q('2',{notes:write('',{...settings,status:'Tax exempt'})})]),/different tax/);
 assert.throws(()=>merge([q('1'),q('2',{notes:''})]),/different tax/);
});
test('manual taxes and legacy adjustments sum without duplication',()=>{
 const notes=write('',{...settings,status:'Manual',manualTax:'12.50'});
 assert.equal(read(merge([q('1',{notes}),q('2',{notes})]).notes).manualTax,'25');
 assert.equal(merge([q('1',{notes:'Old',adjustment_amount:12}),q('2',{notes:null,adjustment_amount:5})]).adjustment_amount,'17');
});
test('copies line snapshots with fresh identity and rebuilds tariffs only once',()=>{
 const product={id:'old',quote_id:'source',local_id:'old',sort_order:0,sku:'chair',manufacturer_id:'m',quantity:'2',unit_price:100,msrp_at_grade:200,purchasing_factor_snapshot:0.4,expected_unit_cost:80,tariff_pct_snapshot:6,surcharge_pct_snapshot:0};
 const originals=[product,{...product,id:'charge',sku:'__DP_TARIFF__old',unit_price:12}];let count=0;
 const result=mergeQuoteLines(originals,()=>String(++count));assert.equal(result.length,1);assert.equal(result[0].id,undefined);assert.equal(result[0].quote_id,undefined);assert.equal(result[0].unit_price,100);assert.equal(product.id,'old');
 const normalized=sync(result,[{id:'m',name:'Brand'}]);assert.equal(normalized.length,2);assert.equal(normalized[1].unit_price,12);
});
