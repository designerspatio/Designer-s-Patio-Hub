import {isManufacturerCharge} from './manufacturerCharges';
// Account identity, not editable display names, controls these editor controls.
export const GENEVA_ACCOUNT_ID = '17b37a5d-1774-46fe-ae3a-b3ce76671e02';
export function canManageQuoteFinancials(profile:{id?:string;role?:string|null;active?:boolean|null}|null|undefined) {
  return profile?.id===GENEVA_ACCOUNT_ID && profile.role==='Owner' && profile.active!==false;
}
// Freight, tax and additional charges live on headers, outside this product basis.
export function productCommissionable(item:{sku?:string|null;commissionable?:boolean|null}) {
  return !isManufacturerCharge(item) && item.commissionable!==false;
}
