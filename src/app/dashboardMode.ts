export type DashboardMode = "sales" | "payables" | "receivables";
export type DashboardIdentity = { display_name?: string | null; role?: string | null; email?: string | null } | null | undefined;

// Named accounting logins can share a Hub role while having distinct home screens.
// This selects presentation only. Database access still follows Supabase RLS.
export function dashboardModeForProfile(profile: DashboardIdentity): DashboardMode {
  if (!profile) return "sales";
  const name = (profile.display_name || "").trim().toLowerCase();
  const role = (profile.role || "").trim().toLowerCase();
  const email = (profile.email || "").trim().toLowerCase().split("@")[0];
  if (/\bpamela\b/.test(name) || role === "accounts payable") return "payables";
  if (/\baccounting\s+team\b/.test(name) || role === "accounts receivable" || email === "accounting") return "receivables";
  if (role === "shipping / accounting") return "payables";
  return "sales";
}

export const numericAmount = (value: number | null | undefined) => Number.isFinite(Number(value)) ? Number(value) : 0;
export const roundedMoney = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
export function remainingBalance(total: number, paid: number) {
  return roundedMoney(Math.max(0, numericAmount(total) - numericAmount(paid)));
}
export function dateAtOrAfter(date: string | null | undefined, cutoff: string) {
  return Boolean(date && date.slice(0, 10) >= cutoff);
}
