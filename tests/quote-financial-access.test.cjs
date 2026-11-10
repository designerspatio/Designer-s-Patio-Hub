const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {stripTypeScriptTypes}=require('node:module');
const source=['manufacturerCharges','quoteFinancialAccess'].map(n=>stripTypeScriptTypes(fs.readFileSync(`src/app/${n}.ts`,'utf8'),{mode:'transform'}).replace(/^import .*;\s*$/gm,'').replace(/export /g,'')).join('\n');
const ctx={module:{exports:{}}};vm.runInNewContext(source+'\nmodule.exports={canManageQuoteFinancials,productCommissionable,GENEVA_ACCOUNT_ID};',ctx);
const {canManageQuoteFinancials:allowed,productCommissionable:commission,GENEVA_ACCOUNT_ID:id}=ctx.module.exports;
test('only Geneva active owner account gets cost and commission controls',()=>{
 assert.equal(allowed({id,role:'Owner',active:true}),true);
 for(const profile of [null,{}, {id:'joey',role:'Assistant Manager'},{id:'other',role:'Owner'},{id,role:'Owner',active:false},{id,role:'Sales'}])assert.equal(allowed(profile),false);
});
test('stock and special order products default to commission; owner exclusions survive',()=>{
 for(const fulfillment_method of ['Inventory','Special Order']) {
 assert.equal(commission({sku:'chair',fulfillment_method}),true);
 assert.equal(commission({sku:'chair',fulfillment_method,commissionable:false}),false);
 }
});
test('automatic tariffs and surcharges never earn commission even on legacy flagged rows',()=>{
 for(const sku of ['__DP_TARIFF__m','__DP_SURCHARGE__m'])assert.equal(commission({sku,commissionable:true}),false);
});
test('quote cost summary and both commission editors are guarded',()=>{
 const page=fs.readFileSync('src/app/page.tsx','utf8');
 assert.match(page,/canEditQuoteFinancials && <div className="internal-cost-summary"/);
 assert.equal((page.match(/canEditQuoteFinancials && <label className="commission-toggle"/g)||[]).length,2);
 assert.equal((page.match(/field === "commissionable" && !canManageQuoteFinancials\(profile\)/g)||[]).length,2);
 assert.match(page,/const commissionable = items.reduce\([\s\S]*?productCommissionable\(item\)/);
});
