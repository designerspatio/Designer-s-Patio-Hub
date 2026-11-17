const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {stripTypeScriptTypes} = require('node:module');
function load(file,names){const ctx={module:{exports:{}}};vm.runInNewContext(stripTypeScriptTypes(fs.readFileSync(file,'utf8'),{mode:'transform'}).replace(/export /g,'')+'\nmodule.exports={'+names.join(',')+'}',ctx);return ctx.module.exports;}
const {sourceError,poGroupKey,comPoShipping}=load('src/app/itemSource.ts',['sourceError','poGroupKey','comPoShipping']);
const dest={manufacturer_id:'receiver-1',name:'Furniture manufacturer',address:'123 Factory Road, Dallas TX 75201'};
test('COM destinations create distinct PO groups and preserve their shipping address',()=>{
 const fabric={manufacturer_id:'fabric-supplier',item_type:'COM Fabric',com_ship_to:dest};
 assert.notEqual(poGroupKey(fabric),poGroupKey({manufacturer_id:'fabric-supplier',item_type:'Special Order'}));
 assert.notEqual(poGroupKey(fabric),poGroupKey({...fabric,com_ship_to:{...dest,manufacturer_id:'receiver-2'}}));
 assert.equal(comPoShipping(dest).ship_to_name,dest.name);
 assert.equal(comPoShipping(dest).ship_to_address,dest.address);
 assert.equal(comPoShipping(dest).com_manufacturer_id,dest.manufacturer_id);
 assert.equal(sourceError([fabric]),'');
 assert.match(sourceError([{...fabric,com_ship_to:{...dest,address:''}}]),/address/);
 assert.match(sourceError([{item_type:'Stock Item',inventory_item_id:null}]),/stock item/);
});
const {syncManufacturerCharges}=load('src/app/manufacturerCharges.ts',['syncManufacturerCharges']);
test('tariffs for separate COM destinations stay with their own PO group',()=>{
 const base={local_id:'a',manufacturer_id:'fabric-supplier',sku:'FAB',quantity:'1',unit_price:100,msrp_at_grade:100,purchasing_factor_snapshot:0.4,expected_unit_cost:40,tariff_pct_snapshot:6,surcharge_pct_snapshot:0,item_type:'COM Fabric',com_ship_to:dest};
 const rows=syncManufacturerCharges([base,{...base,local_id:'b',com_ship_to:{...dest,manufacturer_id:'receiver-2'}}],[]);
 const charges=rows.filter(l=>l.sku.startsWith('__DP_TARIFF__'));
 assert.equal(charges.length,2);
 assert.equal(charges[0].unit_price,6);
 assert.equal(charges[0].expected_unit_cost,2.4);
 assert.notEqual(poGroupKey(charges[0]),poGroupKey(charges[1]));
});
