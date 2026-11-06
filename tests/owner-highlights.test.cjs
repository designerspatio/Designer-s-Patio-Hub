const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { stripTypeScriptTypes } = require("node:module");
const source=stripTypeScriptTypes(fs.readFileSync("src/app/ownerHighlights.ts","utf8"),{mode:"transform"}).replace(/export /g,"");
const context={module:{exports:{}}};
vm.runInNewContext(source+"\nmodule.exports={buildOwnerHighlights,isBookedSale,isOpenQuote};",context);
const {buildOwnerHighlights,isBookedSale,isOpenQuote}=context.module.exports;

const data={
 today:"2026-11-04",
 sales:[
  {id:"a",order_date:"2026-01-15",status:"Open",salesperson_user_id:"one",freight_amount:50,adjustment_amount:10,tax_amount:25},
  {id:"b",order_date:"2026-10-30",status:"Ordered",salesperson_user_id:"two",freight_amount:70,tax_amount:75},
  {id:"c",order_date:"2026-11-03",status:"Complete",salesperson_user_id:"one",adjustment_amount:35},
  {id:"d",order_date:"2026-11-05",status:"Open",salesperson_user_id:"zero"},
  {id:"e",order_date:"2026-10-15",status:"Cancelled",salesperson_user_id:"zero"},
  {id:"f",order_date:"2025-11-03",status:"Closed",salesperson_user_id:"one"},
  {id:"g",order_date:"2026-06-01",status:"Draft",salesperson_user_id:"zero"}
 ],
 saleItems:{
  a:[{manufacturer_id:"ebel",quantity:2,unit_price:100},{manufacturer_id:"other",quantity:1,unit_price:50}],
  b:[{manufacturer_id:"other",quantity:3,unit_price:300}],
  c:[{manufacturer_id:"ebel",quantity:1,unit_price:400}],
  d:[{manufacturer_id:"ebel",quantity:1,unit_price:999}],
  e:[{manufacturer_id:"ebel",quantity:1,unit_price:1000}],
  f:[{manufacturer_id:"ebel",quantity:1,unit_price:500}],
  g:[{manufacturer_id:"ebel",quantity:1,unit_price:200}]
 },
 team:[{id:"one",display_name:"Geneva"},{id:"two",display_name:"Shawna"},{id:"zero",display_name:"Never sold"}],
 manufacturers:[{id:"ebel",name:"Ebel"},{id:"other",name:"Other brand"}],
 quotes:[{id:"q1",status:"Draft",converted_sales_order_id:null},{id:"q2",status:"Converted",converted_sales_order_id:"a"},{id:"q3",status:"Archived",converted_sales_order_id:null}],
 quoteItems:{q1:[{quantity:"2",unit_price:200}],q2:[{quantity:"1",unit_price:500}],q3:[{quantity:"1",unit_price:100}]},
 purchaseOrders:[{status:"Draft"},{status:"Sent"},{status:"Draft"}],
 invoices:[{id:"i1",status:"Open",due_date:"2026-11-08",total_amount:500},{id:"i2",status:"Paid",due_date:"2026-11-01",total_amount:1000},{id:"i3",status:"Approved",due_date:"2026-12-01",total_amount:300}],
 vendorPayments:[{vendor_invoice_id:"i1",amount:100},{vendor_invoice_id:"i2",amount:1000}]
};
test("owner YTD totals only booked sales through today, excluding cancelled, draft, future and prior year",()=>{
 const r=buildOwnerHighlights(data);
 assert.equal(r.ytdSales,1815); assert.equal(r.ytdOrders,3);
 assert.equal(r.thisMonthSales,435);
 assert.equal(r.previousYtdSales,500);
 assert.equal(r.openOrders,2);
 assert.equal(r.openQuotes,1); assert.equal(r.openQuoteValue,400);
 assert.equal(r.draftPurchaseOrders,2);
});
test("five top manufacturers ranked by net line value, and only people with sales appear",()=>{
 const r=buildOwnerHighlights(data);
 assert.deepEqual(Array.from(r.topManufacturers,x=>x.name),["Other brand","Ebel"]);
 assert.equal(r.topManufacturers[0].amount,950);
 assert.equal(r.topManufacturers[1].amount,600);
 assert.deepEqual(Array.from(r.salespeople,x=>x.name),["Shawna","Geneva"]);
 assert.equal(r.salespeople[0].amount,1045);
 assert.equal(r.salespeople[1].amount,770);
 assert.equal(r.totalManufacturerSales,1550);
 assert.equal(r.totalTeamSales,r.ytdSales);
});
test("owner gets month-by-month and upcoming vendor risk from recorded payments",()=>{
 const r=buildOwnerHighlights(data);
 assert.equal(r.months[0].amount,335);
 assert.equal(r.months[9].amount,1045);
 assert.equal(r.months[10].amount,435);
 assert.equal(r.openVendorBalance,700);
 assert.equal(r.billsDueSoon,1);
 assert.equal(r.dueSoonBalance,400);
});
test("only finalized orders count and only open quotes count",()=>{
 assert.equal(isBookedSale("Draft"),false);
 assert.equal(isBookedSale("Cancelled"),false);
 assert.equal(isBookedSale("Closed"),true);
 assert.equal(isOpenQuote({id:"q",status:"Converted",converted_sales_order_id:null}),false);
 assert.equal(isOpenQuote({id:"q",status:"Approved",converted_sales_order_id:null}),true);
});
