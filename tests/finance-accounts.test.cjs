const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { stripTypeScriptTypes } = require("node:module");
const source=stripTypeScriptTypes(fs.readFileSync("src/app/financeAccounts.ts","utf8"),{mode:"transform"}).replace(/export /g,"");
const context={module:{exports:{}}};
vm.runInNewContext(source+"\nmodule.exports={validateExpenseAccount,summarizeExpenseAccounts,summarizeVendors};",context);
const {validateExpenseAccount,summarizeExpenseAccounts,summarizeVendors}=context.module.exports;
test("allows new shared expense accounts but not duplicate payee+category or label",()=>{
 const account={id:"1",name:"Internet & Phone",payee:"AT&T Business",category:"Telecom",created_at:"2026-11-04"};
 assert.equal(validateExpenseAccount({name:"Insurance",payee:"Travelers",category:"Insurance"},[account]),"");
 assert.match(validateExpenseAccount({name:"Internet & Phone",payee:"Other",category:"Other"},[account]),/already exists/);
 assert.match(validateExpenseAccount({name:"Duplicate",payee:"at&t business",category:"telecom"},[account]),/already tracked/);
});
test("aggregates historic expenses only for that matching company AND category",()=>{
 const accounts=[{id:"1",name:"Internet & Phone",payee:"AT&T Business",category:"Telecom",created_at:"2026-11-04"}];
 const expenses=[
  {payee:"AT&T BUSINESS",category:"Telecom",amount:135,expense_date:"2026-11-03"},
  {payee:"AT&T Business",category:"Telecom",amount:125,expense_date:"2026-09-01"},
  {payee:"AT&T Business",category:"Other",amount:90,expense_date:"2026-11-03"},
  {payee:"Other phone",category:"Telecom",amount:100,expense_date:"2026-11-03"}
 ];
 const result=summarizeExpenseAccounts(accounts,expenses,"2026-10-05");
 assert.equal(result[0].totalPaid,260);
 assert.equal(result[0].last30,135);
 assert.equal(result[0].payments,2);
});
test("vendor ledger shows invoiced paid and still open without counting void invoices",()=>{
 const bills=[
  {id:"b1",manufacturer_id:"ebel",status:"Open",total_amount:1000},
  {id:"b2",manufacturer_id:"ebel",status:"Paid",total_amount:200},
  {id:"b3",manufacturer_id:"homecrest",status:"Approved",total_amount:300},
  {id:"b4",manufacturer_id:"ebel",status:"Void",total_amount:9000}
 ];
 const payments=[
  {vendor_invoice_id:"b1",manufacturer_id:"ebel",amount:450},
  {vendor_invoice_id:"b2",manufacturer_id:"ebel",amount:200},
  {vendor_invoice_id:"b3",manufacturer_id:"homecrest",amount:50}
 ];
 const r=summarizeVendors(bills,payments,{ebel:"Ebel",homecrest:"HomeCrest"});
 const e=r.find(x=>x.id==="ebel"),h=r.find(x=>x.id==="homecrest");
 assert.equal(e.invoiced,1200); assert.equal(e.paid,650); assert.equal(e.open,550); assert.equal(e.invoices,2);
 assert.equal(h.invoiced,300); assert.equal(h.paid,50); assert.equal(h.open,250);
});
