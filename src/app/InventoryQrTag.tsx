"use client";

import {QRCodeSVG} from "qrcode.react";
import {DP_PDF_LOGO_DATA_URL} from "./PdfBranding";

export type QrItem={id:string;name:string;sku?:string|null;msrp:number;dimensions?:string|null};
export const publicInventoryUrl=(id:string)=>`https://designer-s-patio-hub.vercel.app/i/${encodeURIComponent(id)}`;

export default function InventoryQrTag({item}:{item:QrItem}) {
 const print=()=>{
   const src=document.querySelector<HTMLElement>(`[data-qr-item="${item.id}"]`);
   if(!src)return;
   const printable=src.cloneNode(true) as HTMLElement;
   const win=window.open("","_blank","width=520,height=680");
   if(!win){window.alert("Allow popups to print the inventory tag.");return;}
   // Render cloned DOM, not raw user-provided HTML, into a dedicated print document.
   const style=win.document.createElement("style");
   style.textContent='@page{size:3in 4in;margin:.12in}body{font-family:Arial,sans-serif;text-align:center;margin:0;color:#121820}.tag{border:1px solid #a3b2be;padding:12px;display:flex;flex-direction:column;align-items:center;gap:9px;height:3.6in;box-sizing:border-box}.tag img{max-width:190px;max-height:90px;object-fit:contain}.item{font-size:13px;font-weight:bold}.sku{font-size:10px;color:#555}.msrp{font-size:19px;font-weight:800}.tag svg{max-width:175px;max-height:175px}';
   win.document.head.appendChild(style);
   win.document.body.appendChild(printable);
   win.focus();win.setTimeout(()=>win.print(),250);
 };
 return <div style={{display:"grid",gap:10,justifyItems:"start"}}>
   <div className="tag" data-qr-item={item.id} style={{display:"flex",flexDirection:"column",alignItems:"center",gap:8,border:"1px solid #d5e1eb",borderRadius:9,padding:12,background:"white",color:"#14233c",width:230}}>
      <img src={DP_PDF_LOGO_DATA_URL} alt="Designer's Patio" style={{maxWidth:180,maxHeight:75,objectFit:"contain"}}/>
      <QRCodeSVG value={publicInventoryUrl(item.id)} size={150} marginSize={2} level="M" />
      <div className="item" style={{fontWeight:700,textAlign:"center"}}>{item.name}</div>
      <div className="sku" style={{fontSize:11}}>{item.sku || ""}</div>
      <div className="msrp" style={{fontWeight:800,fontSize:20}}>MSRP ${Number(item.msrp||0).toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2})}</div>
   </div>
   <button type="button" className="inventory-export-button" onClick={print}>Print logo + QR + MSRP tag</button>
   <a href={publicInventoryUrl(item.id)} target="_blank" rel="noopener noreferrer">Preview customer tear sheet</a>
 </div>;
}
