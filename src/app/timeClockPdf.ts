import {CLOCK_TZ,addDays,workedHours,weekBounds,formatHours,type ClockSegment} from "./timeClock";
export type PdfTimecard={name:string;segments:ClockSegment[]};
const safe=(v:string)=>v.normalize("NFKD").replace(/[^\x20-\x7e]/g,"-").replace(/\\/g,"\\\\").replace(/\(/g,"\\(").replace(/\)/g,"\\)");
const stamp=(v:string)=>new Date(v).toLocaleString("en-US",{timeZone:CLOCK_TZ,month:"short",day:"numeric",hour:"numeric",minute:"2-digit"});
export function makeTimecardPdf(week:string,entries:PdfTimecard[],now=Date.now()):Blob{
 const {start,end}=weekBounds(week),begin=Date.parse(start),finish=Date.parse(end);
 const pages:string[][]=[];let allHours=0;
 for(const person of entries){
  let lines=[`DESIGNER'S PATIO | WEEKLY TIMECARD`,`Sunday ${week} - Saturday ${addDays(week,6)}   |   Central Time`,"",`EMPLOYEE: ${person.name}`,"START                            END                            TYPE             HOURS",""];
  const segments=person.segments.filter(r=>Date.parse(r.started_at)<finish&&(!r.ended_at||Date.parse(r.ended_at)>begin));
  if(!segments.length)lines.push("No recorded punches for this week.");
  for(const seg of segments){
   const from=stamp(seg.started_at).padEnd(33).slice(0,33);
   const to=(seg.ended_at?stamp(seg.ended_at):"OPEN - MISSED CLOCK OUT").padEnd(33).slice(0,33);
   lines.push(`${from}${to}${seg.kind==="break"?"Unpaid break":"Work"}    ${seg.kind==="work"?formatHours(workedHours([seg],begin,finish,now)):"0.00"}`);
  }
  const total=workedHours(person.segments,begin,finish,now);allHours+=total;
  lines.push("",`TOTAL WORKED HOURS: ${formatHours(total)}  (breaks excluded)`);
  lines.push("Recorded punches include Geneva's approved corrections.");
  for(let i=0;i<lines.length;i+=42)pages.push(i?["DESIGNER'S PATIO | TIMECARD (continued)",...lines.slice(i,i+41)]:lines.slice(i,i+42));
 }
 if(entries.length>1)pages.push(["DESIGNER'S PATIO | ALL EMPLOYEES","",`Sunday ${week} - Saturday ${addDays(week,6)}`,"",...entries.map(p=>`${p.name}: ${formatHours(workedHours(p.segments,begin,finish,now))} hours`),"",`ALL EMPLOYEES TOTAL: ${formatHours(allHours)} hours`,"Unpaid breaks excluded. Open punches are calculated through export time."]);
 const objects:string[]=["","<< /Type /Catalog /Pages 2 0 R >>","","<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>","<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>"];
 const pageIds:number[]=[];
 for(const lines of pages){
  const id=objects.length;objects.push("");pageIds.push(id);
  let y=755;const commands:string[]=[];
  lines.forEach((line,i)=>{const big=i===0||line.startsWith("EMPLOYEE:")||line.startsWith("TOTAL")||line.startsWith("ALL EMPLOYEES");const size=i===0?16:big?11:9;commands.push(`BT /${big?"F2":"F1"} ${size} Tf 40 ${y} Td (${safe(line)}) Tj ET`);y-=i===0?30:line===""?12:big?21:16;});
  const stream=commands.join("\n");const c=objects.length;objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  objects[id]=`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${c} 0 R >>`;
 }
 objects[2]=`<< /Type /Pages /Count ${pageIds.length} /Kids [${pageIds.map(i=>i+" 0 R").join(" ")}] >>`;
 let out="%PDF-1.4\n";const offsets=[0];
 for(let i=1;i<objects.length;i++){offsets[i]=out.length;out+=`${i} 0 obj\n${objects[i]}\nendobj\n`;}
 const cross=out.length;out+=`xref\n0 ${objects.length}\n0000000000 65535 f \n`;
 for(let i=1;i<objects.length;i++)out+=String(offsets[i]).padStart(10,"0")+" 00000 n \n";
 out+=`trailer\n<< /Root 1 0 R /Size ${objects.length} >>\nstartxref\n${cross}\n%%EOF`;
 return new Blob([Uint8Array.from(out,c=>c.charCodeAt(0))],{type:"application/pdf"});
}
export function exportTimecardPdf(week:string,entries:PdfTimecard[]){
 const url=URL.createObjectURL(makeTimecardPdf(week,entries));
 const a=document.createElement("a");a.href=url;a.download=`Designers-Patio-Timecard-${week}-${entries.length===1?entries[0].name.replace(/\W+/g,"-"):"All-Employees"}.pdf`;
 document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
}
