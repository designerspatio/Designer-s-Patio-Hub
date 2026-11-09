"use client";

import {useCallback,useEffect,useMemo,useRef,useState} from "react";
import type {SupabaseClient} from "@supabase/supabase-js";
import type {Html5Qrcode} from "html5-qrcode";

type Count={id:string;name:string;location_filter:string|null;status:string;started_at:string;finalized_at:string|null};
type Line={id:string;count_id:string;inventory_item_id:string;item_name_snapshot:string;sku_snapshot:string|null;location_snapshot:string|null;expected_qty:number;counted_qty:number;last_scanned_at:string|null};
type Item={id:string;name:string;sku:string|null;location:string|null;quantity_on_hand:number;active:boolean};
const itemIdFromScan=(raw:string):string|null=>{
 const input=raw.trim();const matched=input.match(/(?:^|\/i\/)([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:[/?#]|$)/i);
 return matched?.[1]?.toLowerCase() || (/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(input)?input.toLowerCase():null);
};
const csv=(value:unknown)=>`"${String(value??"").replaceAll('"','""')}"`;

export default function InventoryCountPanel({supabase,items}:{supabase:SupabaseClient|null;items:Item[]}){
 const [counts,setCounts]=useState<Count[]>([]);
 const [selectedId,setSelectedId]=useState("");
 const [lines,setLines]=useState<Line[]>([]);
 const [newName,setNewName]=useState("");
 const [location,setLocation]=useState("");
 const [scan,setScan]=useState("");
 const [busy,setBusy]=useState(false);
 const [message,setMessage]=useState("");
 const [cameraOn,¶»§q«^