const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),{stripTypeScriptTypes}=require('node:module');
const compile=p=>stripTypeScriptTypes(fs.readFileSync(p,'utf8'),{mode:'transform'}).replace(/^import .*?;\n/gm,'').replace(/export /g,'');
const ctx={module:{exports:{}},crypto:require('node:crypto').webcrypto,TextEncoder};
vm.runInNewContext(compile('src/app/clientCsv.ts')+'\n'+compile('src/app/expenseCsv.ts')+'\nmodule.exports={readStatement,statementRows,expenseImportId};',ctx);
const {readStatement,statementRows,expenseImportId}=ctx.module.exports;
const options={negativeCharges:false,dayFirst:false,account:'Visa 1234',category:'Office'};
function parse(s,o=options){const p=readStatement(s);return statementRows(p.rows,p.headers,p.mapping,o);}
test('quoted descriptions, BOM, dollars, category and payments',()=>{
 const r=parse('\uFEFFDate,Description,Amount,Type\r\n10/05/2026,"Store, Inc","$1,234.56",Sale\r\n10/05/2026,Payment Thank You,1200,Payment\r\n10/05/2026,Return,-20,Credit');
 assert.equal(r[0].amount,1234.56);assert.equal(r[0].category,'Office');assert.equal(r[0].expense_date,'2026-10-05');assert.equal(r[0].reason,'');assert.match(r[1].reason,/Payment/);assert.ok(r[2].reason);
});
test('negative charge convention and parentheses do not turn credits into charges',()=>{
 const r=parse('Date,Description,Amount\n2026-10-05,Store,(12.50)\n2026-10-05,Refund,5',{...options,negativeCharges:true});assert.equal(r[0].amount,12.5);assert.equal(r[0].reason,'');assert.ok(r[1].reason);
});
test('strict dates and numeric values; separate debit column',()=>{
 const r=parse('Date,Description,Debit,Credit\n31/10/2026,Store,10,\n31/02/2026,Store,4,\n10/10/2026,Refund,,10\n10/10/2026,Store,12abc,',{...options,dayFirst:true});assert.equal(r[0].expense_date,'2026-10-31');assert.match(r[1].reason,/date/);assert.ok(r[2].reason);assert.ok(r[3].reason);
});
test('repeatable IDs preserve separate identical charges and separate cards',async()=>{
 const s='Date,Description,Amount\n10/05/2026,Store,10\n10/05/2026,Store,10';const r=parse(s),again=parse(s);assert.equal(await expenseImportId(r[0]),await expenseImportId(again[0]));assert.notEqual(await expenseImportId(r[0]),await expenseImportId(r[1]));assert.notEqual(await expenseImportId(r[0]),await expenseImportId(parse(s,{...options,account:'Amex 5678'})[0]));
});
test('malformed CSV and missing mapping are rejected',()=>{
 assert.throws(()=>readStatement('Date,Description,Amount\n"broken'));assert.throws(()=>parse('Date,Thing,Amount\n10/05/2026,Store,10'));assert.throws(()=>readStatement(''));
});
