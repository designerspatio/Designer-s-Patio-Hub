export type PdfImage = { binary: string; width: number; height: number };
export type PoDocument = {
  number: string; vendor: string; sale: string;
  details: { label: string; value: string }[];
  items: { sku: string; description: string; specs: string; quantity: string; cost: string; total: string }[];
  totals: { label: string; value: string }[];
  notes: string;
};
export const PO_INSTRUCTIONS = [
  ["ORDERING", "For ordering questions, please contact orders@designerspatio.com."],
  ["BILLING", "Send all invoices and billing inquiries to accounting@designerspatio.com."],
  ["SHIP COMPLETE", "Ship orders complete unless requested otherwise."],
  ["FREIGHT", "Send weights and dimensions to shipping@designerspatio.com to arrange shipment, unless specifically opted into the vendor's freight program."],
  ["REFERENCE", "Reference this PO number on all acknowledgements, invoices, and correspondence."],
];
export function clean(value: string | null | undefined) {
  return (value || "").replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '\"')
    .replace(/[\u2013\u2014]/g, "-").replace(/\u2022/g, " | ")
    .replace(/[^\x20-\x7E]/g, " ").replace(/\s+/g, " ").trim();
}
function escapePdf(value: string) {
  return clean(value).replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}
const NAVY = "0.10 0.23 0.34", DARK = "0.16 0.20 0.24", MUTED = "0.36 0.42 0.48", WHITE = "1 1 1";
// Standard Helvetica metrics, in thousandths of an em.
const NORMAL_WIDTHS=[278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584];
const BOLD_WIDTHS=[278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611, 975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556, 333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584];
function width(value: string, size: number, bold=false) {
  const metrics=bold ? BOLD_WIDTHS : NORMAL_WIDTHS;
  return [...clean(value)].reduce((sum,c)=>sum+(metrics[c.charCodeAt(0)-32] || 0),0)*size/1000;
}
function wrap(value: string, max: number, size: number) {
  const lines: string[] = []; let line = "";
  for (const word of clean(value).split(" ")) {
    if (line && width(line + " " + word, size,true) > max) { lines.push(line); line = ""; }
    for (const c of (line ? " " : "") + word) {
      if (line && width(line + c, size,true) > max) { lines.push(line); line = ""; }
      line += c;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [""];
}
function rect(commands: string[], x: number, top: number, w: number, h: number, color: string) {
  commands.push(`q ${color} rg ${x} ${792-top-h} ${w} ${h} re f Q`);
}
function text(commands: string[], x: number, top: number, value: string, size=9, bold=false, color=DARK, right=false) {
  const offset = right ? width(value,size,bold) : 0;
  commands.push(`BT /${bold ? "F2" : "F1"} ${size} Tf ${color} rg 1 0 0 1 ${x-offset} ${792-top-size} Tm (${escapePdf(value)}) Tj ET`);
}
export function makePoPdf(data: PoDocument, logoImage: PdfImage | null) {
  const pages: string[][] = [[]]; let commands = pages[0]; let y=0;
  const nextPage = () => {
    commands=[]; pages.push(commands);
    text(commands,34,28,"DESIGNER'S PATIO",11,true,NAVY);
    text(commands,578,28,`PURCHASE ORDER ${data.number} / CONTINUED`,8,true,NAVY,true);
    rect(commands,34,48,544,1,NAVY); y=64;
  };
  const ensure = (height: number) => { if (y+height > 720) nextPage(); };
  if (logoImage) {
    const scale=Math.min(220/logoImage.width,108/logoImage.height);
    const w=logoImage.width*scale, h=logoImage.height*scale;
    commands.push(`q ${w} 0 0 ${h} ${34+(220-w)/2} ${792-24-h} cm /ImLogo Do Q`);
  } else text(commands,34,44,"DESIGNER'S PATIO",18,true,NAVY);
  text(commands,318,32,"PURCHASE ORDER",20,true,NAVY);
  let headerY=64;
  for (const line of wrap(`#${data.number}`,260,13)) { text(commands,318,headerY,line,13,true); headerY+=17; }
  for (const line of wrap(data.sale,260,9)) { text(commands,318,headerY+5,line,9,false,MUTED); headerY+=12; }
  const date=data.details.find(d=>d.label.toLowerCase()==="order date");
  if(date) { text(commands,318,headerY+14,`ORDER DATE  ${date.value}`,9); headerY+=30; }
  y=Math.max(142,headerY+15); rect(commands,34,y,544,2,NAVY); y+=18;
  text(commands,34,y,"VENDOR",8,true,NAVY); text(commands,318,y,"PURCHASER / ORDER CONTACT",8,true,NAVY); y+=16;
  const vendorLines=wrap(data.vendor || "Vendor",252,12);
  vendorLines.forEach((line,i)=>text(commands,34,y+i*16,line,12,true));
  text(commands,318,y,"Designer's Patio",11,true);
  text(commands,318,y+17,"orders@designerspatio.com",9);
  y+=Math.max(vendorLines.length*16,32)+18;
  const details=data.details.filter(d=>!["order date","status","vendor freight","po notes"].includes(d.label.toLowerCase()));
  for(let i=0;i<details.length;i+=2) {
    const cells=details.slice(i,i+2).map(d=>({...d,lines:wrap(d.value,246,9)}));
    const h=25+Math.max(...cells.map(c=>c.lines.length))*12; ensure(h);
    cells.forEach((cell,j)=>{const x=34+j*284;text(commands,x,y,cell.label.toUpperCase(),7,true,MUTED);cell.lines.forEach((l,k)=>text(commands,x,y+13+k*12,l));}); y+=h;
  }
  y+=5;
  const tableHead=()=>{
    rect(commands,34,y,544,25,NAVY);
    text(commands,42,y+8,"SKU / DESCRIPTION / SPECIFICATIONS",7.5,true,WHITE);
    text(commands,402,y+8,"QTY",7.5,true,WHITE,true);
    text(commands,480,y+8,"UNIT COST",7.5,true,WHITE,true);
    text(commands,570,y+8,"EXTENDED",7.5,true,WHITE,true); y+=25;
  };
  ensure(65);tableHead();
  data.items.forEach((item,index)=>{
    const lines=[...wrap(item.sku,312,9).map(v=>({v,bold:true,color:DARK})),...wrap(item.description,312,9).map(v=>({v,bold:false,color:DARK})),...(item.specs?wrap(item.specs,312,8).map(v=>({v,bold:false,color:MUTED})):[])];
    let pos=0;
    while(pos<lines.length) {
      const remaining=lines.length-pos;
      if(y+Math.min(remaining*12+20,60)>720){nextPage();tableHead();}
      const take=Math.min(remaining,Math.floor((720-y-20)/12));
      const h=take*12+20;
      if(index%2===0)rect(commands,34,y,544,h,"0.95 0.97 0.98");
      lines.slice(pos,pos+take).forEach((l,i)=>text(commands,42,y+10+i*12,l.v,l.color===MUTED?8:9,l.bold,l.color));
      if(pos===0) {
        [[item.quantity,402,36],[item.cost,480,69],[item.total,570,80]].forEach(([v,x,max])=>{const str=String(v);const size=Math.min(9,Number(max)/Math.max(1,width(str,1,true)));text(commands,Number(x),y+10,str,size,true,DARK,true);});
      }
      y+=h;rect(commands,34,y,544,.5,"0.83 0.87 0.90");pos+=take;
    }
  });
  if(!data.items.length){text(commands,42,y+12,"No merchandise lines.",9,false,MUTED);y+=36;}
  y+=14;
  ensure(data.totals.length*26+12);
  data.totals.forEach((total,i)=>{
    const last=i===data.totals.length-1;
    if(last)rect(commands,314,y,264,27,NAVY);
    text(commands,324,y+8,last?"PO TOTAL":total.label,8,last,last?WHITE:MUTED);
    text(commands,568,y+8,total.value,10,true,last?WHITE:DARK,true);y+=27;
  });
  const paragraph=(label: string,value: string)=>{
    const lines=wrap(value,526,9);ensure(40);
    text(commands,34,y,label,8,true,NAVY);y+=18;
    for(const line of lines){ensure(13);text(commands,42,y,line,9);y+=13;}y+=12;
  };
  y+=18;
  if(data.notes)paragraph("ORDER NOTES",data.notes);
  const instructionRows=PO_INSTRUCTIONS.map(([label,value])=>({label,lines:wrap(value,438,8.5)}));
  const instructionHeight=38+instructionRows.reduce((sum,row)=>sum+row.lines.length*12+8,0);
  ensure(instructionHeight);
  rect(commands,34,y,544,1,NAVY);y+=14;
  text(commands,34,y,"VENDOR INSTRUCTIONS",10,true,NAVY);y+=24;
  instructionRows.forEach(row=>{
    text(commands,34,y,row.label,7,true,NAVY);
    row.lines.forEach((line,i)=>text(commands,132,y+i*12,line,8.5));
    y+=row.lines.length*12+8;
  });
  const objects: string[] = [];
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";

  const logoObjectId = logoImage ? 5 : null;
  const firstPageObjectId = logoImage ? 6 : 5;
  const pageObjectNumbers = pages.map((_, i) => firstPageObjectId + i * 2);
  objects[2] = `<< /Type /Pages /Count ${pages.length} /Kids [${pageObjectNumbers
    .map((n) => `${n} 0 R`)
    .join(" ")}] >>`;
  objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
  objects[4] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>";

  if (logoImage && logoObjectId) {
    objects[logoObjectId] =
      `<< /Type /XObject /Subtype /Image /Width ${logoImage.width} /Height ${logoImage.height} ` +
      `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${logoImage.binary.length} >>\n` +
      `stream\n${logoImage.binary}\nendstream`;
  }

  pages.forEach((commands, pageIndex) => {
    rect(commands, 0, 742, 612, 50, NAVY);
    text(commands, 34, 755, "DESIGNER'S PATIO  /  TO THE TRADE", 8, true, WHITE);
    text(commands, 34, 770, "designerspatio.com", 8, false, WHITE);
    text(commands, 578, 755, `PO ${data.number}`, 8, true, WHITE, true);
    text(commands, 578, 770, `Page ${pageIndex + 1} of ${pages.length}`, 8, false, WHITE, true);
    const stream = commands.join("\n");
    const pageObj = pageObjectNumbers[pageIndex];
    const contentObj = pageObj + 1;

    const xObjects =
      logoImage && logoObjectId
        ? ` /XObject << /ImLogo ${logoObjectId} 0 R >>`
        : "";
    objects[pageObj] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R /F2 4 0 R >>${xObjects} >> /Contents ${contentObj} 0 R >>`;
    objects[contentObj] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  });

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [0];

  for (let i = 1; i < objects.length; i++) {
    offsets[i] = pdf.length;
    pdf += `${i} 0 obj\n${objects[i]}\nendobj\n`;
  }

  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length}\n`;
  pdf += "0000000000 65535 f \n";

  for (let i = 1; i < objects.length; i++) {
    pdf += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }

  pdf += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;

  const bytes = new Uint8Array(pdf.length);
  for (let index = 0; index < pdf.length; index += 1) {
    bytes[index] = pdf.charCodeAt(index) & 0xff;
  }

  return bytes;
}
