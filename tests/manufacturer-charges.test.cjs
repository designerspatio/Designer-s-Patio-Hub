const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const {stripTypeScriptTypes} = require('node:module');
const code = stripTypeScriptTypes(fs.readFileSync('src/app/manufacturerCharges.ts','utf8'),{mode:'transform'}).replace(/export /g,'');
const ctx={module:{exports:{}}};vm.runInNewContext(code+'\nmodule.exports={syncManufacturerCharges,isManufacturerCharge}',ctx);
const {syncManufacturerCharges:sync,isManufacturerCharge:isCharge}=ctx.module.exports;
const manufacturers=[{id:'ebel',name:'Ebel'},{id:'other',name:'Other'}];
const line=(extra={})=>({id:'product',local_id:'product',manufacturer_id:'ebel',sku:'CHAIR',quantity:'2',msrp_at_grade:1000,discount_pct:50,unit_price:500,purchasing_factor_snapshot:0.4,tariff_pct_snapshot:6,surcharge_pct_snapshot:0,expected_unit_cost:424,commissionable:true,fulfillment_method:'Special Order',...extra});
test('Ebel 6% uses net for customer and base cost for PO, never double charges legacy costs',()=>{
 const result=sync([line()],manufacturers);assert.equal(result.length,2);
 assert.equal(result[0].expected_unit_cost,400);
 assert.equal(result[1].unit_price,60);assert.equal(result[1].expected_unit_cost,48);
 assert.equal(result[1].commissionable,false);assert.equal(result[1].quantity,'1');
 assert.equal(result.reduce((sum,i)=>sum+Number(i.quantity)*i.unit_price,0),1060);
 assert.equal(result.reduce((sum,i)=>sum+Number(i.quantity)*i.expected_unit_cost,0),848);
 assert.equal(result[1].id,undefined);assert.equal(result[1].source_quote_item_id,null);
});
test('save/reopen is idempotent, keeps row IDs and recalculates quantities/prices',()=>{
 const saved=sync([line()],manufacturers);saved[1].id='charge-id';saved[1].local_id='charge-id';
 const again=sync(saved,manufacturers);assert.equal(JSON.stringify(again),JSON.stringify(saved));
 saved[0].quantity='3';saved[0].unit_price=450;
 const edited=sync(saved,manufacturers);assert.equal(edited[1].id,'charge-id');assert.equal(edited[1].unit_price,81);assert.equal(edited[1].expected_unit_cost,72);
 assert.equal(sync([saved[1]],manufacturers).length,0);
 saved[0].tariff_pct_snapshot=0;assert.equal(sync(saved,manufacturers).length,1);
});
test('mixed manufacturers, rates, surcharges and fulfillment groups stay independent',()=>{
 const rows=sync([line({surcharge_pct_snapshot:3}),line({id:'other',manufacturer_id:'other',tariff_pct_snapshot:0}),line({id:'stock',fulfillment_method:'Inventory',quantity:'1'})],manufacturers);
 const charges=rows.filter(isCharge);assert.equal(charges.length,3);
 assert.equal(charges.filter(i=>i.fulfillment_method==='Special Order').reduce((n,i)=>n+i.expected_unit_cost,0),72);
 assert.equal(charges.filter(i=>i.fulfillment_method==='Inventory')[0].expected_unit_cost,24);
 assert.ok(charges.every(i=>i.manufacturer_id==='ebel' && i.tariff_pct_snapshot===0 && i.surcharge_pct_snapshot===0));
});
test('round per grouped charge, no compounding and no live manufacturer rate overrides',()=>{
 const rows=sync([line({quantity:'1',unit_price:33.33,surcharge_pct_snapshot:6}),line({id:'two',quantity:'1',unit_price:33.33,surcharge_pct_snapshot:6})],manufacturers);
 assert.equal(rows[2].unit_price,4);assert.equal(rows[3].unit_price,4);
 assert.equal(sync([line({tariff_pct_snapshot:0})],[{id:'ebel',name:'Ebel',tariff_pct:10}]).length,1);
});
test('line calculators preserve generated costs on quote-to-sale conversion',()=>{
 const page=fs.readFileSync('src/app/page.tsx','utf8');
 const start=page.indexOf('function calculateQuoteItem('),end=page.indexOf('function saleOrderToEditForm',start);
 const fn=stripTypeScriptTypes(page.slice(start,end),{mode:'transform'});
 const sandbox={isManufacturerCharge:isCharge,numberOrZero:v=>Number(v)||0};vm.createContext(sandbox);vm.runInContext(fn,sandbox);
 const rows=sync([line()],manufacturers);assert.equal(sandbox.calculateQuoteItem(rows[1]).expected_unit_cost,48);
 assert.equal(sandbox.calculateQuoteItem(rows[0]).expected_unit_cost,400);
});
