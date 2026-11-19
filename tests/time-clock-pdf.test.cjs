const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");
const {stripTypeScriptTypes}=require("node:module");
function loadModule(path,mocks={}){
 const code=stripTypeScriptTypes(fs.readFileSync(path,"utf8"),{mode:"transform"})
  .replace(/^import .*;$/gm,"").replace(/export /g,"");
 const ctx={module:{exports:{}},...mocks,Blob,Date,Uint8Array,URL,console};
 const symbols=path.includes("Pdf")?"makeTimecardPdf":"CLOCK_TZ,addDays,workedHours,weekBounds,formatHours";
 vm.runInNewContext(code+"\nmodule.exports={"+symbols+"};",ctx,{filename:path});
 return ctx.module.exports;
}
const clock=loadModule("src/app/timeClock.ts");
const pdf=loadModule("src/app/timeClockPdf.ts",clock);
const entry={name:"Andrew Jones",segments:[{kind:"work",started_at:"2026-11-16T15:00:00.000Z",ended_at:"2026-11-16T23:00:00.000Z",employee_id:"a",id:"1"}]};
test("one-employee PDF includes employee and worked total",async()=>{
 const doc=pdf.makeTimecardPdf("2026-11-15",[entry],Date.parse("2026-11-23T00:00:00Z"));
 assert.equal(doc.type,"application/pdf");
 const bytes=Buffer.from(await doc.arrayBuffer());
 assert.match(bytes.toString("latin1",0,20),/^%PDF-1.4/);
 assert.match(bytes.toString("latin1"),/Andrew Jones/);
 assert.match(bytes.toString("latin1"),/TOTAL WORKED HOURS: 8.00/);
 assert.doesNotMatch(bytes.toString("latin1"),/ALL EMPLOYEES TOTAL:/);
});
test("all employee PDF prints each employee and combined hours",async()=>{
 const doc=pdf.makeTimecardPdf("2026-11-15",[entry,{name:"Niyah Brown",segments:[]}],Date.parse("2026-11-23T00:00:00Z"));
 const source=Buffer.from(await doc.arrayBuffer()).toString("latin1");
 assert.match(source,/Andrew Jones/);
 assert.match(source,/Niyah Brown/);
 assert.match(source,/ALL EMPLOYEES TOTAL: 8.00/);
 assert.match(source,/Unpaid breaks excluded/);
});
