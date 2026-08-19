export type ManufacturerPricingRule={factor:number;defaultDiscountPct:number;tariffPct:number;surchargePct:number};
export function expectedUnitCost(msrp:number,r:ManufacturerPricingRule){
  return msrp*r.factor*(1+r.tariffPct/100+r.surchargePct/100);
}
export function quoteDefaults(r:ManufacturerPricingRule){
  return {discountPct:r.defaultDiscountPct,tariffPct:r.tariffPct,surchargePct:r.surchargePct};
}
