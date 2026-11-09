import {createClient} from "@supabase/supabase-js";
import {DP_PDF_LOGO_DATA_URL} from "../../PdfBranding";
import {notFound} from "next/navigation";
import PrintButton from "./PrintButton";

export const dynamic="force-dynamic";
export default async function InventoryTearSheet({params}:{params:Promise<{id:string}>}){
 const {id}=await params;
 if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))notFound();
 const url=process.env.NEXT_PUBLIC_SUPABASE_URL;
 const key=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
 if(!url||!key)notFound();
 const supabase=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
 const {data,error}=await supabase.rpc("dp_public_inventory_tear_sheet",{p_item_id:id});
 const item=Array.isArray(data)?data[0]:null;
 if(error||!item)notFound();
 const field=(k:string,v:string|null|undefined)=><div style={{marginBottom:18}}><div style={{fontSize:11,color:'#52657b',letterSpacing:2,textTransform:'uppercase'}}>{k}</div><div style={{fontSize:18,marginTop:4}}>{v?.trim()||'Not listed'}</div></div>;
 return <main style={{background:'#f4f7fa',color:'#13273d',minHeight:'100vh',padding:'30px 15px',fontFamily:'Arial,sans-serif'}}>
 <article style={{background:'white',maxWidth:750,margin:'auto',padding:'36px 40px',boxShadow:'0 4px 26px #142e431a'}}>
 <header style={{borderBottom:'2px solid #164473',paddingBottom:18,marginBottom:28,display:'flex',justifyContent:'space-between',alignItems:'center',gap:20,flexWrap:'w¶»§q«^