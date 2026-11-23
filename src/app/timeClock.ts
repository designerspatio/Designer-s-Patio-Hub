export type ClockSegment={id:string;employee_id:string;kind:"work"|"break";started_at:string;ended_at:string|null};
export type ClockAdjustment={id:string;employee_id:string;segment_id:string;action:string;reason:string;corrected_at:string;corrected_by:string};
export const CLOCK_TZ="America/Chicago";
export const CLOCK_EMPLOYEES=[{id:"1571764c-5bdd-4910-b8a1-fbf8ca904ec0",name:"Andrew Jones"},{id:"43cbb740-7489-4299-907c-ec5b9886f1a2",name:"Niyah Brown"}] as const;
export const GENEVA_ID="17b37a5d-1774-46fe-ae3a-b3ce76671e02";
export function addDays(day:string,n:number){const d=new Date(day+"T12:00:00Z");d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);}
export function sundayOf(day:string){const d=new Date(day+"T12:00:00Z");d.setUTCDate(d.getUTCDate()-d.getUTCDay());return d.toISOString().slice(0,10);}
export function chicagoDay(date:Date){const p=Object.fromEntries(new Intl.DateTimeFormat("en-US",{timeZone:CLOCK_TZ,year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(date).filter(x=>x.type!=="literal").map(x=>[x.type,x.value]));return p.year+"-"+p.month+"-"+p.day;}
function offsetMs(instant:number){const text=new Intl.DateTimeFormat("en-US",{timeZone:CLOCK_TZ,timeZoneName:"shortOffset"}).formatToParts(new Date(instant)).find(x=>x.type==="timeZoneName")?.value||"GMT-6";const m=text.match(/GMT([+-])(\d+)(?::(\d+))?/);return m?(m[1]==="+"?1:-1)*(Number(m[2])*60+Number(m[3]||0))*60000:0;}
export function chicagoToIso(value:string){if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value))return null;const wall=Date.parse(value+":00Z");if(!Number.isFinite(wall))return null;let utc=wall-offsetMs(wall);utc=wall-offsetMs(utc);return new Date(utc).toISOString();}
export function chicagoInput(value:string|null){if(!value)return "";const p=Object.fromEntries(new Intl.DateTimeFormat("en-US",{timeZone:CLOCK_TZ,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(new Date(value)).filter(x=>x.type!=="literal").map(x=>[x.type,x.value]));return p.year+"-"+p.month+"-"+p.day+"T"+p.hour+":"+p.minute;}
// Keep the stored seconds on unchanged boundaries so adjacent punches stay adjacent.
export function correctionTime(value: string, original?: string | null) {
  return original && value === chicagoInput(original) ? original : chicagoToIso(value);
}
export function weekBounds(sunday:string){return {start:chicagoToIso(sunday+"T00:00")!,end:chicagoToIso(addDays(sunday,7)+"T00:00")!};}
export function workedHours(rows:ClockSegment[],start:number,end:number,now:number=Date.now()){return rows.reduce((sum,row)=>{if(row.kind==="break")return sum;return sum+Math.max(0,Math.min(end,now,Date.parse(row.ended_at||new Date(now).toISOString()))-Math.max(start,Date.parse(row.started_at)))/3600000;},0);}
export function formatHours(value:number){return value.toFixed(2);}
export function formatPunch(value:string){return new Date(value).toLocaleString("en-US",{timeZone:CLOCK_TZ,weekday:"short",hour:"numeric",minute:"2-digit"});}
