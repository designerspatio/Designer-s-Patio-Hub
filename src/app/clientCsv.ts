export type CsvClient = { id: string; client_name: string | null; active: boolean | null; assigned_user_id: string | null; [key: string]: unknown };
export const CLIENT_CSV_FIELDS = ['client_name','city','state','zip_code','phone','email','street_address','first_name','last_name','company_name','business_type','lead_status','notes','tax_exempt','assigned_user_id'] as const;
export type ClientCsvRow = { [key: string]: string | boolean | null };
export type ParsedClients = { rows: ClientCsvRow[]; duplicates: number; blanks: number; recoveredNames: number };
const aliases: Record<string,string> = { clientname:'client_name', name:'client_name', client:'client_name', city:'city', state:'state', zip:'zip_code', zipcode:'zip_code', postalcode:'zip_code', phone:'phone', phonenumber:'phone', email:'email', emailaddress:'email', address:'street_address', streetaddress:'street_address', firstname:'first_name', lastname:'last_name', company:'company_name', companyname:'company_name', businesstype:'business_type', leadstatus:'lead_status', notes:'notes', taxexempt:'tax_exempt', assigneduserid:'assigned_user_id', clientid:'id', id:'id' };
export const clientNameKey = (value: unknown) => String(value || '').toLowerCase().replace(/[^a-z0-9]/g,'');
function csvTable(source: string): string[][] {
  const rows: string[][]=[];let row: string[]=[],cell='',quoted=false,closed=false;
  source=source.replace(/^\uFEFF/,'');
  for(let i=0;i<source.length;i++) {
    const c=source[i];
    if(quoted) { if(c==='"') { if(source[i+1]==='"'){cell+='"';i++;} else {quoted=false;closed=true;} } else cell+=c; }
    else if(c===',' || c==='\n' || c==='\r') {
      row.push(cell);cell='';closed=false;
      if(c!==','){rows.push(row);row=[];if(c==='\r'&&source[i+1]==='\n')i++;}
    } else if(c==='"' && !cell && !closed) quoted=true;
    else {if(closed && c.trim()) throw new Error('Unexpected text after a quoted CSV field.');if(!closed)cell+=c;}
  }
  if(quoted)throw new Error('The CSV contains an unclosed quoted field.');
  if(cell || row.length || closed){row.push(cell);rows.push(row);}
  return rows;
}
export function parseClientCsv(source: string): ParsedClients {
  const table=csvTable(source);if(!table.length)throw new Error('The CSV is empty.');
  const headers=table[0].map(h=>aliases[h.toLowerCase().replace(/[^a-z0-9]/g,'')]);
  if(!headers.includes('client_name'))throw new Error('Include a CLIENT NAME column.');
  const known=headers.filter(Boolean);if(new Set(known).size!==known.length)throw new Error('The CSV has duplicate client columns.');
  let blanks=0,duplicates=0,recoveredNames=0;
  const entries: {row: ClientCsvRow;line:number}[]=[];
  table.slice(1).forEach((cells,index)=>{
    if(cells.every(c=>!c.trim())){blanks++;return;}
    if(cells.length!==headers.length)throw new Error(`Row ${index+2} has ${cells.length} fields; expected ${headers.length}.`);
    const row:ClientCsvRow={};cells.forEach((cell,i)=>{
      const key=headers[i];if(!key)return;
      // Remove only the protective apostrophe used by this export for spreadsheet formulas.
      let value=cell.trim().replace(/^'(?=[=+@-])/,'');
      if(key==='tax_exempt') {
        if(!['','true','false','yes','no','1','0'].includes(value.toLowerCase()))throw new Error(`Invalid tax exemption on row ${index+2}.`);
        row[key]=['true','yes','1'].includes(value.toLowerCase());
      } else row[key]=value || null;
    });entries.push({row,line:index+2});
  });
  for(const entry of entries) {
    if(entry.row.client_name)continue;
    const email=String(entry.row.email || '').toLowerCase();
    const matches=entries.filter(e=>e.row.client_name && email && String(e.row.email||'').toLowerCase()===email);
    const names=new Set(matches.map(e=>clientNameKey(e.row.client_name)));
    if(names.size!==1)throw new Error(`Row ${entry.line} is missing a client name and cannot be matched uniquely by email.`);
    entry.row.client_name=matches[0].row.client_name;recoveredNames++;
  }
  const seen=new Set<string>();const rows:ClientCsvRow[]=[];
  for(const {row} of entries) {
    const key=JSON.stringify(Object.keys(row).sort().map(k=>[k,row[k]]));
    if(seen.has(key)){duplicates++;continue;}seen.add(key);rows.push(row);
  }
  if(!rows.length)throw new Error('The CSV has no clients to import.');
  if(rows.length>20000)throw new Error('Please import no more than 20,000 clients at a time.');
  return {rows,duplicates,blanks,recoveredNames};
}
function cell(value: unknown): string {
  let text=value==null?'':String(value);if(/^[\s]*[=+@-]/.test(text))text="'"+text;
  return '"'+text.replace(/"/g,'""')+'"';
}
export function exportClientsCsv(clients: CsvClient[], backup=false) {
  const fields: string[]=backup ? [...new Set(clients.flatMap(c=>Object.keys(c)))].sort() : ['id',...CLIENT_CSV_FIELDS];
  return '\uFEFF'+[fields.map(cell).join(','),...clients.map(c=>fields.map(f=>cell(c[f])).join(','))].join('\r\n');
}
export type ClientImportPlan = { writes: CsvClient[]; archiveIds: string[]; preserved: CsvClient[]; added: number; updated: number; skipped: number };
export function planClientImport(rows:ClientCsvRow[],existing:CsvClient[],userId:string,replace:boolean,protect:string[],newId:()=>string):ClientImportPlan {
  const preserved=existing.filter(c=>protect.some(p=>clientNameKey(c.client_name).includes(clientNameKey(p))));
  if(replace)for(const name of protect)if(!preserved.some(c=>clientNameKey(c.client_name).includes(clientNameKey(name))))throw new Error(`Cannot find protected client "${name}". Check the spelling before replacing the list.`);
  const protectedIds=new Set(preserved.map(c=>c.id));const used=new Set<string>();const writes:CsvClient[]=[];let added=0,updated=0,skipped=0;
  const nameCounts=new Map<string,number>();for(const row of rows){const k=clientNameKey(row.client_name);nameCounts.set(k,(nameCounts.get(k)||0)+1);}
  for(const row of rows) {
    if(protect.some(p=>clientNameKey(row.client_name).includes(clientNameKey(p)))){skipped++;continue;}
    let match:CsvClient|undefined;
    if(row.id) {
      match=existing.find(c=>c.id===row.id);if(!match)throw new Error(`Client ID for ${row.client_name} is not in this Hub. Remove the ID to import a new client.`);
      if(used.has(match.id))throw new Error(`Multiple CSV rows use the same client ID for ${row.client_name}.`);
    } else {
      const candidates=existing.filter(c=>!used.has(c.id) && clientNameKey(c.client_name)===clientNameKey(row.client_name));
      const exact=candidates.filter(c=>['email','phone','city','state','zip_code'].every(k=>String(c[k]||'').trim().toLowerCase()===String(row[k]||'').trim().toLowerCase()));
      if(exact.length===1)match=exact[0];
      else if(candidates.length===1 && nameCounts.get(clientNameKey(row.client_name))===1)match=candidates[0];
      else if(candidates.length>0 && !replace)throw new Error(`Multiple contacts match ${row.client_name}. Use exported client IDs to choose which existing records to update.`);
    }
    if(match && protectedIds.has(match.id)){skipped++;continue;}
    const record:CsvClient={id:match?.id||newId(),client_name:String(row.client_name),assigned_user_id:match?.assigned_user_id||userId,active:true};
    // Keep existing non-CSV fields, including assignments, names, and tax status.
    for(const field of CLIENT_CSV_FIELDS)(record as Record<string,unknown>)[field]=field in row?row[field]:(match?.[field]??(field==='tax_exempt'?false:field==='assigned_user_id'?userId:null));
    if(!record.assigned_user_id)record.assigned_user_id=match?.assigned_user_id || userId;
    writes.push(record);used.add(record.id);if(match)updated++;else added++;
  }
  const archiveIds=replace?existing.filter(c=>c.active!==false&&!protectedIds.has(c.id)&&!used.has(c.id)).map(c=>c.id):[];
  return {writes,archiveIds,preserved,added,updated,skipped};
}
