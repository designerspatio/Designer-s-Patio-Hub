const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");
const {stripTypeScriptTypes}=require("node:module");
const src=stripTypeScriptTypes(fs.readFileSync("src/app/inventoryAvailability.ts","utf8"),{mode:"transform"}).replace(/export /g,"");
const context={module:{exports:{}}};
vm.runInNewContext(src+"\nmodule.exports={availableToSell,validateInventoryCounts,inventoryAvailabilityLabel,validateQuoteInventory,validateSalesOrderInventory,reservationDeltas};",context);
const {availableToSell,validateInventoryCounts,inventoryAvailabilityLabel,validateQuoteInventory,validateSalesOrderInventory,reservationDeltas}=context.module.exports;
const item={id:"chair",quantity_on_hand:8,quantity_damaged:2,quantity_nailed_down:1,quantity_reserved:2,active:true};
test("damaged, nailed-down and reserved units are excluded from available stock",()=>{
 assert.equal(availableToSell(item),3);
 assert.equal(inventoryAvailabilityLabel(item),"Available");
});
test("on-hand stock is valued independently of sellable quantity",()=>{
 assert.equal(item.quantity_on_hand,8);
 assert.equal(availableToSell({...item,quantity_damaged:7,quantity_nailed_down:1,quantity_reserved:0}),0);
});
test("cannot mark overlapping or excessive units unavailable",()=>{
 assert.match(validateInventoryCounts({...item,quantity_damaged:8}),/exceed on-hand/);
 assert.match(validateInventoryCounts({...item,quantity_reserved:7}),/cannot exceed sellable/);
 assert.match(validateInventoryCounts({...item,quantity_nailed_down:-1}),/non-negative/);
});
test("quote never counts inactive or unavailable units",()=>{
 const inv=new Map([["chair",item],["inactive",{id:"inactive",quantity_on_hand:5,active:false}]]);
 assert.equal(validateQuoteInventory([{inventory_item_id:"chair",quantity:3}],inv),"");
 assert.match(validateQuoteInventory([{inventory_item_id:"chair",quantity:4}],inv),/Only 3/);
 assert.match(validateQuoteInventory([{inventory_item_id:"chair",quantity:2},{inventory_item_id:"chair",quantity:2}],inv),/Only 3/);
 assert.match(validateQuoteInventory([{inventory_item_id:"inactive",quantity:1}],inv),/unavailable/);
});
test("SO edit can reuse its own reserved stock, not another order's",()=>{
 const inv=new Map([["chair",item]]);
 assert.equal(validateSalesOrderInventory([{inventory_item_id:"chair",quantity:5}],inv,new Map([["chair",2]])),"");
 assert.match(validateSalesOrderInventory([{inventory_item_id:"chair",quantity:6}],inv,new Map([["chair",2]])),/Only 5/);
 assert.match(validateSalesOrderInventory([{inventory_item_id:"chair",quantity:4}],inv),/Only 3/);
});
test("reservation deltas release removed lines and add new ones",()=>{
 const d=reservationDeltas([{inventory_item_id:"chair",quantity:1},{inventory_item_id:"sofa",quantity:2}],
 [{inventory_item_id:"chair",quantity:3}]);
 assert.equal(d.get("chair"),-2);assert.equal(d.get("sofa"),2);
});
