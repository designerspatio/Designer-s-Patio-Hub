export type ExpenseAccount = {
  id: string;
  name: string;
  payee: string;
  category: string;
  created_at: string;
};
export type ExpenseAccountDraft = Pick<ExpenseAccount, "name" | "payee" | "category">;
export type ExpenseRecord = { payee: string; category: string | null; amount: number; expense_date: string };
export type VendorBill = { id: string; manufacturer_id: string | null; status: string; total_amount: number };
export type VendorPayment = { vendor_invoice_id: string; manufacturer_id: string | null; amount: number };
export const expenseKey = (value: string | null | undefined) => (value || "").trim().replace(/\s+/g, " ").toLowerCase();
export function validateExpenseAccount(draft: ExpenseAccountDraft, existing: ExpenseAccount[]): string {
  const name = draft.name.trim(), payee = draft.payee.trim(), category = draft.category.trim();
  if (!name || !payee || !category) return "Enter an account name, company/payee, and expense category.";
  if (name.length > 100 || payee.length > 120 || category.length > 100) return "Account details must be 100–120 characters or less.";
  if (existing.some(a => expenseKey(a.name) === expenseKey(name))) return "An account with that name already exists.";
  if (existing.some(a => expenseKey(a.payee) === expenseKey(payee) && expenseKey(a.category) === expenseKey(category))) return "This payee and category are already tracked by another account.";
  if (existing.length >= 250) return "Expense account limit reached.";
  return "";
}
export function summarizeExpenseAccounts(accounts: ExpenseAccount[], expenses: ExpenseRecord[], cutoff: string) {
  return accounts.map(account => {
    const matches = expenses.filter(expense => expenseKey(expense.payee) === expenseKey(account.payee) && expenseKey(expense.category) === expenseKey(account.category));
    const paid = matches.reduce((sum, expense) => sum + (Number(expense.amount) || 0), 0);
    const recent = matches.filter(expense => expense.expense_date >= cutoff).reduce((sum, expense) => sum + (Number(expense.amount) || 0), 0);
    return { account, totalPaid: Math.round(paid * 100) / 100, last30: Math.round(recent * 100) / 100, payments: matches.length };
  }).sort((a,b)=> a.account.name.localeCompare(b.account.name));
}
export function summarizeVendors(bills: VendorBill[], payments: VendorPayment[], names: Record<string, string>) {
  const byInvoice = new Map(bills.map(bill => [bill.id, bill]));
  const totals = new Map<string, {id:string; name:string; invoiced:number; paid:number; open:number; invoices:number;}>();
  function row(id:string) {
    let r = totals.get(id);
    if (!r) {r={id,name:names[id]|| (id === "__unassigned__" ? "Unassigned vendor" : "Vendor"),invoiced:0,paid:0,open:0,invoices:0}; totals.set(id,r);}
    return r;
  }
  const paymentsByInvoice = new Map<string,number>();
  for(const p of payments) paymentsByInvoice.set(p.vendor_invoice_id,(paymentsByInvoice.get(p.vendor_invoice_id)||0)+(Number(p.amount)||0));
  for(const bill of bills) {
    if (bill.status === "Void") continue;
    const r=row(bill.manufacturer_id||"__unassigned__");
    const amount=Number(bill.total_amount)||0;
    r.invoiced+=amount;r.invoices++;
    if(bill.status !== "Paid")r.open+=Math.max(0,amount-(paymentsByInvoice.get(bill.id)||0));
  }
  for(const payment of payments){
    const bill = byInvoice.get(payment.vendor_invoice_id);
    // Attribute to the invoice manufacturer to avoid mismatched manufacturer snapshots.
    const id=bill?.manufacturer_id||payment.manufacturer_id||"__unassigned__";
    row(id).paid+=Number(payment.amount)||0;
  }
  return [...totals.values()].map(r=>({...r,invoiced:Math.round(r.invoiced*100)/100,paid:Math.round(r.paid*100)/100,open:Math.round(r.open*100)/100}))
    .sort((a,b)=>b.open-a.open || a.name.localeCompare(b.name));
}
