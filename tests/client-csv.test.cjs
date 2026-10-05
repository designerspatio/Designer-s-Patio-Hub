const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),{stripTypeScriptTypes}=require('node:module');
const source=stripTypeScriptTypes(fs.readFileSync('src/app/clientCsv.ts','utf8'),{mode:'transform'}).replace(/export /g,'')+'\nmodule.exports={parseClientCsv,planClientImport,exportClientsCsv};';const ctx={module:{exports:{}}};vm.runInNewContext(source,ctx);const {parseClientCsv,planClientImport,exportClientsCsv}=ctx.module.exports;
const old=[{id:'p',client_name:'Paradigm',active:true,assigned_user_id:'owner',notes:'Preserve all of this'},{id:'h',client_name:'HHL Interiors',active:true,assigned_user_id:'owner'},{id:'a',client_name:'Acme',active:true,assigned_user_id:'owner',email:'old@acme.test',qbo_customer_id:'99'},{id:'o',client_name:'Old client',active:true,assigned_user_id:'owner'}];
test('handles BOM, quoted commas, embedded newlines, escaped quotes and blank rows',()=>{
 const p=parseClientCsv('\uFEFFCLIENT NAME,EMAIL,NOTES\r\n"Smith, Jane",jane@test.com,"Line 1\nLine ""2"""\r\n,,\r\n');assert.equal(p.rows[0].client_name,'Smith, Jane');assert.equal(p.rows[0].notes,'Line 1\nLine "2"');assert.equal(p.blanks,1);
 assert.throws(()=>parseClientCsv('CLIENT NAME,EMAIL\n"bad,x'));assert.throws(()=>parseClientCsv('CLIENT NAME,EMAIL\nx,y,z'));
});
test('restores only unique email names and deduplicates complete rows',()=>{
 const p=parseClientCsv('CLIENT NAME,EMAIL\nAcme,a@b.com\nAcme,a@b.com\n,a@b.com');assert.equal(p.rows.length,1);assert.equal(p.duplicates,2);assert.equal(p.recoveredNames,1);
 assert.throws(()=>parseClientCsv('CLIENT NAME,EMAIL\nA,a@b.com\nB,a@b.com\n,a@b.com'));
});
test('replacement preserves protected records and archives only superseded IDs',()=>{
 const p=planClientImport([{client_name:'Acme',email:'new@acme.test'},{client_name:'Paradigm',email:'do-not-change@x.test'},{client_name:'New client'}],old,'me',true,['Paradigm','HHL Interiors'],()=> 'new');
 assert.equal(p.added,1);assert.equal(p.updated,1);assert.equal(p.skipped,1);assert.deepEqual([...p.archiveIds],['o']);assert.equal(p.writes[0].id,'a');assert.equal(p.writes[0].assigned_user_id,'owner');assert.equal(p.preserved[0].notes,'Preserve all of this');assert.equal(p.writes.some(c=>c.id==='p'||c.id==='h'),false);
 assert.throws(()=>planClientImport([{client_name:'X'}],old,'me',true,['Missing client'],()=> 'new'));
});
test('merge never archives; IDs update exact rows and reject repeated IDs',()=>{
 const p=planClientImport([{id:'a',client_name:'Renamed'}],old,'me',false,[],()=> 'new');assert.equal(p.archiveIds.length,0);assert.equal(p.writes[0].id,'a');
 assert.throws(()=>planClientImport([{id:'a',client_name:'A'},{id:'a',client_name:'B'}],old,'me',false,[],()=> 'new'));
});
test('export prevents spreadsheet formulas and roundtrips commas, quotes, ZIP and multiline notes',()=>{
 const p=parseClientCsv(exportClientsCsv([{id:'id1',client_name:'=Formula',active:true,assigned_user_id:'me',zip_code:'00501',phone:'+12145551234',notes:'a,"b"\nc'}]));assert.equal(p.rows[0].client_name,'=Formula');assert.equal(p.rows[0].zip_code,'00501');assert.equal(p.rows[0].phone,'+12145551234');assert.equal(p.rows[0].notes,'a,"b"\nc');
});
