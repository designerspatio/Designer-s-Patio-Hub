export const PO_SHIPPING_FIELDS = ['ship_to_name','ship_to_contact','ship_to_phone','ship_to_address','ship_to_city','ship_to_state','ship_to_zip','delivery_notes'] as const;
export type PoShipping = { [K in typeof PO_SHIPPING_FIELDS[number]]?: string | null };
export function poShippingForm(source: PoShipping) {
 return Object.fromEntries(PO_SHIPPING_FIELDS.map(field => [field, source[field] || ''])) as Record<typeof PO_SHIPPING_FIELDS[number],string>;
}
export function parseConfirmedPoCost(value:string):number|null {
 if(!value.trim())return null;
 const n=Number(value);
 if(!Number.isFinite(n)||n<0||n>100000000)throw new Error('Enter a valid, non-negative confirmed unit cost, or leave it blank to use the estimate.');
 return n;
}
export function poCostDrafts(items:{id:string;acknowledged_unit_cost:number|null}[]) {
 return Object.fromEntries(items.map(item=>[item.id,item.acknowledged_unit_cost==null?'':String(item.acknowledged_unit_cost)]));
}
export function effectivePoCost(item:{id:string;unit_cost:number;acknowledged_unit_cost:number|null},drafts:Record<string,string>) {
 const draft=drafts[item.id];
 if(draft===undefined)return Number(item.acknowledged_unit_cost??item.unit_cost)||0;
 try{return parseConfirmedPoCost(draft)??Number(item.unit_cost);}catch{return Number(item.acknowledged_unit_cost??item.unit_cost)||0;}
}
export function poCostUpdates(items:{id:string;unit_cost:number;acknowledged_unit_cost:number|null}[],drafts:Record<string,string>){
 return items.map(item=>({id:item.id,acknowledged_unit_cost:parseConfirmedPoCost(drafts[item.id]??(item.acknowledged_unit_cost==null?'':String(item.acknowledged_unit_cost))),expected_unit_cost:item.unit_cost,expected_acknowledged_unit_cost:item.acknowledged_unit_cost}));
}
