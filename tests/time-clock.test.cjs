const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs"),vm=require("node:vm");
const {stripTypeScriptTypes}=require("node:module");
const source=stripTypeScriptTypes(fs.readFileSync("src/app/timeClock.ts","utf8"),{mode:"transform"}).replace(/export /g,"");
const ctx={module:{exports:{}}};
vm.runInNewContext(source+"\nmodule.exports={sundayOf,weekBounds,workedHours,addDays,chicagoToIso};",ctx);
const {sundayOf,weekBounds,workedHours,addDays}=ctx.module.exports;
test("weekly timecard always runs Sunday through Saturday",()=>{
 assert.equal(sundayOf("2026-11-19"),"2026-11-15");
 assert.equal(sundayOf("2026-11-15"),"2026-11-15");
 assert.equal(addDays(sundayOf("2026-11-19"),6),"2026-11-21");
});
test("Dallas weekly boundaries respect daylight-saving shifts",()=>{
 const b=weekBounds("2026-03-08");
 assert.equal(b.start,"2026-03-08T06:00:00.000Z");
 assert.equal(b.end,"2026-03-15T05:00:00.000Z");
});
test("weekly work totals exclude unpaid breaks",()=>{
 const b=weekBounds("2026-11-15");
 const rows=[
 {kind:"work",started_at:"2026-11-15T15:00:00Z",ended_at:"2026-11-15T17:00:00Z"},
 {kind:"break",started_at:"2026-11-15T17:00:00Z",ended_at:"2026-11-15T17:30:00Z"},
 {kind:"work",started_at:"2026-11-15T17:30:00Z",ended_at:"2026-11-15T21:30:00Z"}
 ];
 assert.equal(workedHours(rows,Date.parse(b.start),Date.parse(b.end),Date.parse(b.end)),6);
});
