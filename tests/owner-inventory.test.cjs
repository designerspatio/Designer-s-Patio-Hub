const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { stripTypeScriptTypes } = require("node:module");
const source=stripTypeScriptTypes(fs.readFileSync("src/app/ownerInventory.ts","utf8"),{mode:"transform"}).replace(/export /g,"");
const context={module:{exports:{}}};
vm.runInNewContext(source+"\nmodule.exports={summarizeOwnerInventory,isIncomingStockPO};",context);
const {summarizeOwnerInventory,isIncomingStockPO}=context.module.exports;
const inventory=[
  {id:"a",quantity_on_hand:4,unit_cost:125,active:true},
  {id:"b",quantity_on_hand:3,unit_cost:70,active:true},
  {id:"c",quantity_on_hand:10,unit_cost:999,active:false},
  {id:"d",quantity_on_hand:2,unit_cost:0,active:true},
  {id:"e",quantity_on_hand:-1,unit_cost:200,active:true},
];
const purchaseOrders=[
  {id:"po1",po_number:1201,sales_order_id:null,manufacturer_id:"ebel",status:"Acknowledged",order_date:"2026-10-30",estimated_ship_date:"2026-11-12"},
  {id:"po2",po_number:1202,sales_order_id:null,manufacturer_id:"homecrest",status:"Shipped",order_date:"2026-10-30",estimated_ship_date:"2026-11-04"},
  {id:"po3",po_number:1203,sales_order_id:"sale-123",manufacturer_id:"ebel",status:"Submitted",order_date:"2026-10-30",estimated_ship_date:null},
  {id:"po4",po_number:1204,sales_order_id:null,manufacturer_id:"ebel",status:"Received",order_date:"2026-09-30",estimated_ship_date:null},
  {id:"po5",po_number:1205,sales_order_id:null,manufacturer_id:"ebel",status:"Draft",order_date:"2026-11-01",estimated_ship_date:null},
  {id:"po6",po_number:1206,sales_order_id:null,manufacturer_id:"ebel",status:"Submitted",order_date:"2026-10-31",estimated_ship_date:null}
];
const lines={
  po1:[{id:"line1",sales_order_item_id:null,quantity:5,unit_cost:100,acknowledged_unit_cost:95}],
  po2:[{id:"line2",sales_order_item_id:null,quantity:2,unit_cost:300,acknowledged_unit_cost:null}],
  po3:[{id:"line3",sales_order_item_id:"sale-line",quantity:8,unit_cost:700,acknowledged_unit_cost:null}],
  po4:[{id:"line4",sales_order_item_id:null,quantity:4,unit_cost:100,acknowledged_unit_cost:null}],
  po5:[{id:"line5",sales_order_item_id:null,quantity:3,unit_cost:150,acknowledged_unit_cost:null}],
  po6:[{id:"line6",sales_order_item_id:"sale-line-x",quantity:2,unit_cost:200,acknowledged_unit_cost:null}]
};
const receipts=[{purchase_order_item_id:"line1",movement_type:"Received",quantity_change:2},{purchase_order_item_id:"line1",movement_type:"Adjustment",quantity_change:99}];
test("on-hand inventory uses active positive quantities at cost, and flags missing costs",()=>{
 const result=summarizeOwnerInventory(inventory,[],{},{"ebel":"Ebel"});
 assert.equal(result.onHandCost,710);assert.equal(result.unitsOnHand,9);assert.equal(result.activeSkus,3);assert.equal(result.missingUnitCosts,1);
});
test("incoming stock excludes sales-linked client POs, drafts and received orders",()=>{
 const result=summarizeOwnerInventory(inventory,purchaseOrders,lines,{ebel:"Ebel",homecrest:"HomeCrest"},receipts);
 assert.equal(result.incomingPOCount,2);assert.equal(result.ignoredClientPOCount,2);
 assert.deepEqual(Array.from(result.incomingOrders,row=>row.number),[1202,1201]);
 assert.equal(result.incomingCost,885);
 assert.equal(result.projectedCost,1595);
 assert.equal(result.incomingUnits,5);
 assert.equal(result.incomingOrders.find(po=>po.number===1201).incomingCost,285);
 assert.equal(result.incomingOrders.find(po=>po.number===1201).orderedCost,475);
});
test("zero unit-cost stock is visible but cannot inflate valuation",()=>{
 const p={id:"unpriced",po_number:1300,sales_order_id:null,manufacturer_id:"ebel",status:"Submitted",order_date:"2026-11-03",estimated_ship_date:null};
 const result=summarizeOwnerInventory([], [p], {unpriced:[{id:"item",sales_order_item_id:null,quantity:2,unit_cost:0,acknowledged_unit_cost:null}]}, {ebel:"Ebel"});
 assert.equal(result.incomingOrders.length,1);assert.equal(result.incomingOrders[0].uncodedLines,1);assert.equal(result.incomingCost,0);
});
test("a sale-linked PO or line never qualifies as stock",()=>{
 assert.equal(isIncomingStockPO(purchaseOrders[2],lines.po3),false);
 assert.equal(isIncomingStockPO(purchaseOrders[5],lines.po6),false);
 assert.equal(isIncomingStockPO(purchaseOrders[0],lines.po1),true);
 assert.equal(isIncomingStockPO(purchaseOrders[4],lines.po5),false);
});
