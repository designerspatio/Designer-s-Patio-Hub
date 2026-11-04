const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");
const {stripTypeScriptTypes}=require("node:module");
const src=stripTypeScriptTypes(fs.readFileSync("src/app/stockOrders.ts","utf8"),{mode:"transform"}).replace(/export /g,"");
const sandbox={module:{exports:{}}};
vm.runInNewContext(src+"\nmodule.exports={verifyStockOrderInput,remainingForLine,effectiveStockStatus,stockOrderTotals,stockRef,stockLineMarker};",sandbox);
const {verifyStockOrderInput,remainingForLine,effectiveStockStatus,stockOrderTotals,stockRef,stockLineMarker}=sandbox.module.exports;
const id1="11111111-1111-4111-8111-111111111111",id2="22222222-2222-4222-8222-222222222222";
const inventory=new Map([
 ["item1",{manufacturer_id:"brandA",active:true,name:"Showroom chair",sku:"CHR",unit_cost:95}],
 ["item2",{manufacturer_id:"brandA",active:true,name:"Sofa",sku:"SOFA",unit_cost:500}],
 ["other",{manufacturer_id:"brandB",active:true,name:"Other manufacturer",sku:"",unit_cost:100}]
]);
const input={manufacturer_id:"brandA",status:"Submitted",order_date:"2026-11-04",estimated_ship_date:"2026-11-27",notes:null,
 lines:[{id:id1,inventory_item_id:"item1",name:"Showroom chair",sku:"CHR",quantity:4,unit_cost:100},
  {id:id2,inventory_item_id:"item2",name:"Sofa",sku:"SOFA",quantity:1,unit_cost:499.95}]};
const order={...input,id:"00000000-0000-4000-8000-000000000000",sequence:13,created_by:"user",
 created_at:"2026-11-04",updated_at:"2026-11-04"};
test("stock POs allow existing inventory only from the matching vendor",()=>{
 assert.equal(verifyStockOrderInput(input,inventory),"");
 const bad={...input,lines:[{...input.lines[0],inventory_item_id:"other"}]};
 assert.match(verifyStockOrderInput(bad,inventory),/manufacturer/);
});
test("prevents duplicate item lines and invalid order quantities and costs",()=>{
 assert.match(verifyStockOrderInput({...input,lines:[input.lines[0],{...input.lines[1],inventory_item_id:"item1"}]},inventory),/only once/);
 assert.match(verifyStockOrderInput({...input,lines:[{...input.lines[0],quantity:-1}]},inventory),/whole-number/);
 assert.match(verifyStockOrderInput({...input,lines:[{...input.lines[0],unit_cost:-12}]},inventory),/non-negative/);
});
test("receiving remains partial with accurate outstanding value",()=>{
 const receipts={[id1]:2,[id2]:1};
 assert.equal(remainingForLine(input.lines[0],receipts),2);
 assert.equal(remainingForLine(input.lines[1],receipts),0);
 assert.equal(effectiveStockStatus(order,receipts),"Partially Received");
 assert.equal(stockOrderTotals(order,receipts).ordered,899.95);
 assert.equal(stockOrderTotals(order,receipts).pending,200);
 assert.equal(stockOrderTotals(order,receipts).remainingUnits,2);
 assert.equal(effectiveStockStatus(order,{[id1]:4,[id2]:1}),"Received");
 assert.equal(effectiveStockStatus(order,{}),"Submitted");
});
test("stock references and receiving markers are stable, distinct from client POs",()=>{
 assert.equal(stockRef(13),"STK-0013");
 assert.equal(stockLineMarker(order.id,id1),"stock-po:"+order.id+":"+id1);
});
