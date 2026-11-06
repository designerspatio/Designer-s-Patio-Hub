const test=require("node:test"),assert=require("node:assert/strict");
const fs=require("node:fs"),vm=require("node:vm");
const {stripTypeScriptTypes}=require("node:module");
const source=stripTypeScriptTypes(fs.readFileSync("src/app/quoteSalesperson.ts","utf8"),{mode:"transform"}).replace(/export /g,"");
const ctx={module:{exports:{}}};vm.runInNewContext(source+"\nmodule.exports={defaultQuoteSalesperson,salespersonOptionName};",ctx);
const {defaultQuoteSalesperson,salespersonOptionName}=ctx.module.exports;
test("client primary assignment wins over creator",()=>assert.equal(defaultQuoteSalesperson("geneva","joey"),"geneva"));
test("an unassigned client defaults to the quote creator",()=>assert.equal(defaultQuoteSalesperson(null,"joey"),"joey"));
test("no user session retains an empty selection",()=>assert.equal(defaultQuoteSalesperson(null,null),""));
test("owner is offered as primary salesperson with a recognizable label",()=>{
 assert.equal(salespersonOptionName({display_name:"Geneva Wallace Switzer Lawyer Searls Blackburn",role:"Owner"}),"Geneva (Owner)");
 assert.equal(salespersonOptionName({display_name:"Shawna Lawyer",role:"Manager"}),"Shawna Lawyer");
});
