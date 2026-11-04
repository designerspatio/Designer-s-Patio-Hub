"use client";

import { useEffect, useMemo, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { dateAtOrAfter, numericAmount, remainingBalance, roundedMoney, type DashboardMode } from "./dashboardMode";
import styles from "./FinanceDashboard.module.css";

type Sale = { id: string; sale_number: number; client_id: string; status: string; order_date: string; freight_amount: number; adjustment_amount: number; tax_amount: number };
type SaleItem = { quantity: number; unit_price: number };
type Invoice = { id: string; invoice_number: number; vendor_invoice_number: string | null; manufacturer_id: string | null; invoice_date: string | null; due_date: string | null; status: string; total_amount: number };
type VendorPayment = { id: string; vendor_invoice_id: string; payment_date: string; amount: number; payment_method: string | null; reference: string | null };
type Expense = { id: string; expense_date: string; amount: number };
type Receipt = { id: string; sales_order_id: string; payment_date: string; amount: number; payment_method: string; reference: string | null; posted: boolean; created_at: string; reversal_of_payment_id: string | null };
type Props = {
  mode: Exclude<DashboardMode, "sales">; firstName: string; supabase: SupabaseClient | null;
  sales: Sale[]; saleItems: Record<string, SaleItem[]>; invoices: Invoice[]; vendorPayments: VendorPayment[]; expenses: Expense[];
  clients: Record<string, string>; manufacturers: Record<string, string>;
  loadingSales: boolean; loadingAccounting: boolean;
  onSale: (id: string) => void; onInvoice: (id: string) => void;
  onSales: () => void; onDailyCash: () => void; onInvoices: () => void; onExpenses: () => void; onPurchases: () => void;
  onNewInvoice: () => void; onNewExpense: () => void; onRefresh: () => void | Promise<void>;
};
const money = (value: number) => roundedMoney(value).toLocaleString("en-US", { style: "currency", currency: "USD" });
const dateKey = (date: Date) => String(date.getFullYear()) + "-" + String(date.getMonth() + 1).padStart(2, "0") + "-" + String(date.getDate()).padStart(2, "0");
const showDate = (date?: string | null) => date ? new Date(date.slice(0, 10) + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "No date";
const amount = (value: number | null | undefined) => numericAmount(value);

export default function FinanceDashboard(props: Props) {
  const { mode, supabase } = props;
  const [search, setSearch] = useState("");
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [receiptsLoading, setReceiptsLoading] = useState(mode === "receivables");
  const [receiptsError, setReceiptsError] = useState("");
  const [receiptsTruncated, setReceiptsTruncated] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const now = new Date();
  const today = dateKey(now);
  const last30 = dateKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 29));
  const inSeven = dateKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 7));

  useEffect(() => {
    if (mode !== "receivables") return;
    let mounted = true;
    async function readReceipts() {
      if (!supabase) { if (mounted) { setReceiptsLoading(false); setReceiptsError("Payment records are unavailable."); } return; }
      setReceiptsLoading(true); setReceiptsError("");
      try {
        const loaded: Receipt[] = [];
        // Supabase defaults to 1,000 rows; page so AR totals are not silently understated.
        for (let start = 0; start < 10000; start += 1000) {
          const { data, error } = await supabase.from("payments")
            .select("id,sales_order_id,payment_date,amount,payment_method,reference,posted,created_at,reversal_of_payment_id")
            .order("payment_date", { ascending: false }).order("created_at", { ascending: false })
            .range(start, start + 999);
          if (error) throw error;
          if (!mounted) return;
          const page = (data || []) as Receipt[];
          loaded.push(...page);
          if (page.length < 1000) break;
        }
        if (mounted) { setReceipts(loaded); setReceiptsTruncated(loaded.length === 10000); }
      } catch (error) {
        if (mounted) { setReceipts([]); setReceiptsError(error instanceof Error ? error.message : "Could not load customer payments."); }
      } finally { if (mounted) setReceiptsLoading(false); }
    }
    void readReceipts();
    return () => { mounted = false; };
  }, [mode, supabase, refreshKey]);

  const vendorPaid = useMemo(() => {
    const sums: Record<string, number> = {};
    props.vendorPayments.forEach(payment => { sums[payment.vendor_invoice_id] = (sums[payment.vendor_invoice_id] || 0) + amount(payment.amount); });
    return sums;
  }, [props.vendorPayments]);
  const outstandingBills = useMemo(() => props.invoices
    .filter(invoice => !["Void", "Paid"].includes(invoice.status))
    .map(invoice => ({ invoice, balance: remainingBalance(amount(invoice.total_amount), vendorPaid[invoice.id] || 0) }))
    .filter(row => row.balance > 0)
    .sort((a, b) => (a.invoice.due_date || "9999").localeCompare(b.invoice.due_date || "9999")), [props.invoices, vendorPaid]);
  const receiptTotals = useMemo(() => {
    const result: Record<string, number> = {};
    receipts.forEach(payment => { result[payment.sales_order_id] = (result[payment.sales_order_id] || 0) + amount(payment.amount); });
    return result;
  }, [receipts]);
  const salesBalances = useMemo(() => props.sales.filter(sale => !["Cancelled", "Canceled", "Void", "Voided"].includes(sale.status))
    .map(sale => {
      const merchandise = (props.saleItems[sale.id] || []).reduce((sum, item) => sum + amount(item.quantity) * amount(item.unit_price), 0);
      const total = merchandise + amount(sale.freight_amount) + amount(sale.adjustment_amount) + amount(sale.tax_amount);
      return { sale, total, balance: remainingBalance(total, receiptTotals[sale.id] || 0) };
    }).filter(row => row.balance > 0).sort((a, b) => b.balance - a.balance), [props.sales, props.saleItems, receiptTotals]);
  const saleById = useMemo(() => new Map(props.sales.map(sale => [sale.id, sale])), [props.sales]);
  const invoiceById = useMemo(() => new Map(props.invoices.map(invoice => [invoice.id, invoice])), [props.invoices]);
  const query = search.trim().toLowerCase();
  const filteredBills = outstandingBills.filter(({ invoice }) => !query || [
    invoice.vendor_invoice_number, String(invoice.invoice_number), props.manufacturers[invoice.manufacturer_id || ""], invoice.status
  ].join(" ").toLowerCase().includes(query));
  const filteredReceivables = salesBalances.filter(({ sale }) => !query || [
    sale.sale_number, sale.status, props.clients[sale.client_id]
  ].join(" ").toLowerCase().includes(query));
  const filteredReceipts = receipts.filter(payment => {
    if (!query) return true;
    const sale = saleById.get(payment.sales_order_id);
    return [payment.reference, payment.payment_method, payment.payment_date, sale?.sale_number, sale ? props.clients[sale.client_id] : ""]
      .join(" ").toLowerCase().includes(query);
  });
  const filterVendorPayments = props.vendorPayments.filter(payment => !query || [
    payment.reference, payment.payment_method, payment.payment_date,
    props.manufacturers[invoiceById.get(payment.vendor_invoice_id)?.manufacturer_id || ""]
  ].join(" ").toLowerCase().includes(query));
  const ap = mode === "payables";
  const received30 = receipts.filter(payment => dateAtOrAfter(payment.payment_date, last30)).reduce((sum, payment) => sum + amount(payment.amount), 0);
  const receivedToday = receipts.filter(payment => payment.payment_date.slice(0, 10) === today).reduce((sum, payment) => sum + amount(payment.amount), 0);
  const paid30 = props.vendorPayments.filter(payment => dateAtOrAfter(payment.payment_date, last30)).reduce((sum, payment) => sum + amount(payment.amount), 0);
  const expenses30 = props.expenses.filter(expense => dateAtOrAfter(expense.expense_date, last30)).reduce((sum, expense) => sum + amount(expense.amount), 0);
  const billsDueSoon = outstandingBills.filter(row => row.invoice.due_date && row.invoice.due_date <= inSeven);
  const metrics = ap ? [
    { label: "VENDOR BILLS OUTSTANDING", value: money(outstandingBills.reduce((sum, row) => sum + row.balance, 0)), detail: String(outstandingBills.length) + " unpaid invoices" },
    { label: "DUE / PAST DUE WITHIN 7 DAYS", value: String(billsDueSoon.length), detail: "Includes overdue vendor bills" },
    { label: "PAID TO VENDORS · 30 DAYS", value: money(paid30), detail: "Recorded vendor payments" },
    { label: "EXPENSES · 30 DAYS", value: money(expenses30), detail: "Recorded operating expenses" }
  ] : [
    { label: "RECEIVED TODAY", value: receiptsLoading || receiptsError ? "—" : money(receivedToday), detail: "Net customer payments" },
    { label: "MONEY IN · 30 DAYS", value: receiptsLoading || receiptsError ? "—" : money(received30), detail: "Net customer payment activity" },
    { label: "OUTSTANDING RECEIVABLES", value: receiptsLoading || receiptsError || props.loadingSales ? "—" : money(salesBalances.reduce((sum, row) => sum + row.balance, 0)), detail: "Hub sales less recorded payments" },
    { label: "SALES WITH BALANCES", value: receiptsLoading || receiptsError || props.loadingSales ? "—" : String(salesBalances.length), detail: "Sales orders awaiting payment" }
  ];

  async function refresh() {
    await props.onRefresh();
    setRefreshKey(value => value + 1);
  }

  return <div className={styles.dashboard}>
    <header className={styles.hero}>
      <div><div className={styles.kicker}>{ap ? "ACCOUNTS PAYABLE · PAMELA'S WORKSPACE" : "ACCOUNTS RECEIVABLE · ACCOUNTING WORKSPACE"}</div>
        <h1>{ap ? "Bills, vendor payments & expenses" : "Payments received & money coming in"}</h1>
        <p>{ap ? "Stay ahead of what Designer's Patio owes, with the vendor invoices that need attention first." : "See incoming customer payments, recent activity and sales order balances in one place."}</p></div>
      <div className={styles.heroActions}><span>{showDate(today)}</span><button type="button" onClick={() => void refresh()}>↻ Refresh records</button></div>
    </header>
    <div className={styles.quickActions}>
      {ap ? <>
        <button className={styles.primary} onClick={props.onNewInvoice}>＋ New vendor invoice</button>
        <button onClick={props.onInvoices}>Vendor invoices</button>
        <button onClick={props.onExpenses}>Operating expenses</button>
        <button onClick={props.onPurchases}>Purchase orders</button>
        <button onClick={props.onNewExpense}>＋ Record expense</button>
      </> : <>
        <button className={styles.primary} onClick={props.onSales}>Sales orders & balances</button>
        <button onClick={props.onDailyCash}>Daily Cash & deposits</button>
        <button onClick={() => document.getElementById("finance-recent-payments")?.scrollIntoView({ behavior: "smooth" })}>Payment history ↓</button>
      </>}
    </div>
    {(receiptsError && !ap) && <p className={styles.warning} role="alert">Customer payment records could not be loaded: {receiptsError}. Receivables totals are hidden until payments are available.</p>}
    {receiptsTruncated && !ap && <p className={styles.warning}>More than 10,000 payments may exist. This view is partial, so reconcile totals in the source ledger.</p>}
    <div className={styles.metrics}>
      {metrics.map(metric => <div key={metric.label} className={styles.metric}><span>{metric.label}</span><strong>{metric.value}</strong><small>{metric.detail}</small></div>)}
    </div>
    <div className={styles.searchBar}><label htmlFor="finance-dashboard-search">Find a {ap ? "vendor, invoice or payment" : "customer, sale or payment"}</label><input id="finance-dashboard-search" type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder={ap ? "Search vendor, invoice #, or payment reference…" : "Search customer, sale #, method, or reference…"} />{search && <button type="button" onClick={() => setSearch("")}>Clear</button>}</div>
    <div className={styles.columns}>
      {ap ? <>
        <section className={styles.panel}>
          <div className={styles.heading}><div><div className={styles.kicker}>WHAT NEEDS ATTENTION</div><h2>Unpaid vendor invoices</h2></div><button onClick={props.onInvoices}>View all →</button></div>
          {props.loadingAccounting ? <p className={styles.empty}>Loading vendor invoices…</p> : filteredBills.length === 0 ? <p className={styles.empty}>No unpaid vendor invoices match your search.</p> :
            filteredBills.slice(0, 12).map(({ invoice, balance }) =>
              <button className={styles.record} key={invoice.id} onClick={() => props.onInvoice(invoice.id)}>
                <div><strong>{props.manufacturers[invoice.manufacturer_id || ""] || "Vendor"}</strong><span>{invoice.vendor_invoice_number || "Invoice #" + invoice.invoice_number} · {invoice.status}</span></div>
                <div className={styles.end}><strong>{money(balance)}</strong><span className={invoice.due_date && invoice.due_date < today ? styles.overdue : ""}>Due {showDate(invoice.due_date)}</span></div>
              </button>)}
          {filteredBills.length > 12 && <p className={styles.more}>Showing 12 of {filteredBills.length} matching invoices. Open Vendor Invoices for the full list.</p>}
        </section>
        <section className={styles.panel}>
          <div className={styles.heading}><div><div className={styles.kicker}>MONEY GOING OUT</div><h2>Recent vendor payments</h2></div><button onClick={props.onInvoices}>Payment records →</button></div>
          {props.loadingAccounting ? <p className={styles.empty}>Loading payments…</p> : filterVendorPayments.length === 0 ? <p className={styles.empty}>No vendor payments match your search.</p> :
            [...filterVendorPayments].sort((a, b) => b.payment_date.localeCompare(a.payment_date)).slice(0, 12).map(payment => {
              const invoice = invoiceById.get(payment.vendor_invoice_id);
              return <button className={styles.record} key={payment.id} onClick={() => invoice ? props.onInvoice(invoice.id) : props.onInvoices()}>
                <div><strong>{props.manufacturers[invoice?.manufacturer_id || ""] || "Vendor payment"}</strong><span>{showDate(payment.payment_date)} · {payment.payment_method || "Payment"}{payment.reference ? " · " + payment.reference : ""}</span></div>
                <div className={styles.end}><strong>{money(amount(payment.amount))}</strong><span>{invoice ? "Invoice #" + (invoice.vendor_invoice_number || invoice.invoice_number) : "View accounting"}</span></div>
              </button>;
            })}
        </section>
      </> : <>
        <section className={styles.panel}>
          <div className={styles.heading}><div><div className={styles.kicker}>MONEY STILL COMING IN</div><h2>Outstanding customer balances</h2></div><button onClick={props.onSales}>View all sales →</button></div>
          {receiptsLoading || props.loadingSales ? <p className={styles.empty}>Calculating sales balances…</p> : receiptsError ? <p className={styles.empty}>Payment history is needed before balances can be shown.</p> : filteredReceivables.length === 0 ? <p className={styles.empty}>No outstanding balances match your search.</p> :
            filteredReceivables.slice(0, 12).map(({ sale, balance }) =>
              <button className={styles.record} key={sale.id} onClick={() => props.onSale(sale.id)}>
                <div><strong>{props.clients[sale.client_id] || "Customer"} · Sale #{sale.sale_number}</strong><span>{sale.status} · {showDate(sale.order_date)}</span></div>
                <div className={styles.end}><strong>{money(balance)}</strong><span>Open sales order →</span></div>
              </button>)}
          {filteredReceivables.length > 12 && <p className={styles.more}>Showing 12 of {filteredReceivables.length} sales with balances.</p>}
        </section>
        <section id="finance-recent-payments" className={styles.panel}>
          <div className={styles.heading}><div><div className={styles.kicker}>MONEY RECEIVED</div><h2>Recent customer payments</h2></div><button onClick={props.onDailyCash}>Daily Cash →</button></div>
          {receiptsLoading ? <p className={styles.empty}>Loading incoming payments…</p> : receiptsError ? <p className={styles.empty}>Payment history is temporarily unavailable.</p> : filteredReceipts.length === 0 ? <p className={styles.empty}>No payments match your search.</p> :
            filteredReceipts.slice(0, 12).map(payment => {
              const sale = saleById.get(payment.sales_order_id);
              return <button className={styles.record} key={payment.id} onClick={() => sale ? props.onSale(sale.id) : props.onSales()}>
                <div><strong>{sale ? props.clients[sale.client_id] || "Customer" : "Customer payment"}</strong><span>{showDate(payment.payment_date)} · {payment.payment_method || "Payment"} · {payment.posted ? "Posted" : "Unposted"}{payment.reference ? " · " + payment.reference : ""}</span></div>
                <div className={styles.end}><strong>{money(amount(payment.amount))}</strong><span>{sale ? "Sale #" + sale.sale_number : "View sales"}</span></div>
              </button>;
            })}
          {filteredReceipts.length > 12 && <p className={styles.more}>Showing 12 of {filteredReceipts.length} matching payments. Search by payment reference to locate older records.</p>}
        </section>
      </>}
    </div>
    <p className={styles.footnote}>Figures are calculated from the Hub's available records, not a bank statement. Use Accounting and Daily Cash for reconciliation. Dashboard shortcuts do not change user permissions.</p>
  </div>;
}
