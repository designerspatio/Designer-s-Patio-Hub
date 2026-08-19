export const DEFAULT_COMMISSION_RATE=0.02;
export function isCommissionable(type:"merchandise"|"tariff"|"surcharge"|"freight"|"tax"|"other"){
  return type==="merchandise";
}
