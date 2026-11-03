/** Reserved SKU identifies generated charges through quote, sale, PO and QBO. */
export const isManufacturerCharge = (item: { sku?: string | null }) =>
  /^__DP_(TARIFF|SURCHARGE)__/.test(item.sku || '');
const number = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : 0;
const cents = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
type Line = {
  id?: string; local_id: string; manufacturer_id: string; sku: string;
  quantity: string; unit_price: number; msrp_at_grade: number;
  purchasing_factor_snapshot: number | null; expected_unit_cost: number | null;
  tariff_pct_snapshot: number; surcharge_pct_snapshot: number;
  fulfillment_method?: string;
};
/** Rebuild from merchandise only, keeping saved charge IDs stable for linked POs. */
export function syncManufacturerCharges<T extends Line>(lines: T[], manufacturers: {id: string; name: string}[]): T[] {
  const products = lines.filter(item => !isManufacturerCharge(item)).map(item => ({
    ...item,
    // Legacy expected costs included the tariff. Product cost now excludes it.
    expected_unit_cost: item.purchasing_factor_snapshot == null ? item.expected_unit_cost :
      Math.max(0, number(item.msrp_at_grade) * number(item.purchasing_factor_snapshot)),
  }));
  const groups = new Map<string, {template: T; kind: string; rate: number; net: number; cost: number}>();
  for (const item of products) {
    if (!item.manufacturer_id) continue;
    for (const kind of ['TARIFF', 'SURCHARGE'] as const) {
      const rate = Math.max(0, number(kind === 'TARIFF' ? item.tariff_pct_snapshot : item.surcharge_pct_snapshot));
      if (!rate) continue;
      const key = `${item.manufacturer_id}:${item.fulfillment_method || 'Special Order'}:${kind}:${rate}`;
      const group = groups.get(key) || {template: item, kind, rate, net: 0, cost: 0};
      group.net += number(item.quantity) * number(item.unit_price);
      group.cost += number(item.quantity) * number(item.expected_unit_cost);
      groups.set(key, group);
    }
  }
  const charges: T[] = [];
  for (const [key, group] of groups) {
    const {template, kind, rate} = group;
    const sku = `__DP_${kind}__${key}`;
    const previous = lines.find(item => item.sku === sku);
    const price = cents(group.net * rate / 100);
    const cost = cents(group.cost * rate / 100);
    if (!price && !cost) continue;
    const name = manufacturers.find(m => m.id === template.manufacturer_id)?.name || 'Manufacturer';
    charges.push({
      ...template, id: previous?.id, local_id: previous?.local_id || sku,
      source_quote_item_id: (previous as any)?.source_quote_item_id || null,
      sku, description: `${name} ${kind === 'TARIFF' ? 'Tariff' : 'Surcharge'} (${rate}%)`,
      quantity: '1', image_url: '', finish: '', fabric_name: '', grade: '', additional_details: '',
      msrp_at_grade: price, discount_pct: 0, unit_price: price,
      purchasing_factor_snapshot: null, tariff_pct_snapshot: 0, surcharge_pct_snapshot: 0,
      expected_unit_cost: cost, acknowledged_unit_cost: (previous as any)?.acknowledged_unit_cost ?? null,
      commissionable: false, inventory_item_id: '', sort_order: products.length + charges.length,
    } as T);
  }
  return [...products, ...charges];
}
