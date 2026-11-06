import { readChargeSettings } from './orderCharges';

export type ServiceChargePeriod = 'day' | 'month' | 'ytd' | 'year';
export function salesChargeLabel(notes: string) {
  const status = readChargeSettings(notes)?.status;
  return status === 'Out-of-state' ? 'Out-of-state service charge' : status === 'Tax exempt' ? 'Tax exempt' : 'Sales tax';
}
export function serviceChargeRange(period: ServiceChargePeriod, date: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date)) || new Date(date).toISOString().slice(0,10) !== date) throw new Error('Choose a valid report date.');
  if (period === 'day') return {start: date, end: date};
  if (period === 'ytd') return {start: `${date.slice(0,4)}-01-01`, end: date};
  if (period === 'year') return {start: `${date.slice(0,4)}-01-01`, end: `${date.slice(0,4)}-12-31`};
  const [year, month] = date.split('-').map(Number);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return {start: `${date.slice(0,7)}-01`, end: `${date.slice(0,7)}-${lastDay}`};
}
export function outOfStateServiceCharge(order: {notes: string | null; tax_amount: number | string | null; status: string}) {
  if (['cancelled','canceled','void'].includes(order.status.toLowerCase()) || readChargeSettings(order.notes || '')?.status !== 'Out-of-state') return 0;
  const amount = Number(order.tax_amount);
  return Number.isFinite(amount) ? Math.round(amount * 100) / 100 : 0;
}
