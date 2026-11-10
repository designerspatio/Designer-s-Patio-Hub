import {isManufacturerCharge,syncManufacturerCharges} from './manufacturerCharges';
import {readChargeSettings,writeChargeSettings,calculateOrderCharges} from './orderCharges';
export function splitQuoteLines<T extends Parameters<typeof syncManufacturerCharges>[0][number]>(lines:T[],ids:string[],manufacturers:{id:string;name:string}[]) {
 const products=lines.filter(l=>!isManufacturerCharge(l));
 const chosen=new Set(ids);
 if(!ids.length || chosen.size!==ids.length || ids.some(id=>!products.some(l=>l.id===id))) throw new Error('Select saved product items to split.');
 if(products.every(l=>chosen.has(l.id!))) throw new Error('Leave at least one product item on the original quote.');
 return {remaining:syncManufacturerCharges(products.filter(l=>!chosen.has(l.id!)),manufacturers),moved:syncManufacturerCharges(products.filter(l=>chosen.has(l.id!)),manufacturers)};
}
export function splitQuoteCharges(notes:string,legacyAdjustment:number,freight:number,remaining:number,moved:number,quoteNumber:number) {
 const settings=readChargeSettings(notes);
 const newNotes=settings ? writeChargeSettings(`Split from quote #${quoteNumber}\n${notes}`,{...settings,charges:[],manualTax:'0'}) : `Split from quote #${quoteNumber}\n${notes}`;
 const oldCharges=calculateOrderCharges(notes,remaining,freight,legacyAdjustment);
 const newCharges=calculateOrderCharges(newNotes,moved,0,0);
 return {remaining:{notes,adjustment_amount:oldCharges.additional+oldCharges.tax},moved:{notes:newNotes,adjustment_amount:newCharges.additional+newCharges.tax}};
}
