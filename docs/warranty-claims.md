# Warranty & Claims

Warranty Manager accounts open on the warranty desk. Management can use Warranty & Claims in the sidebar. The original personal workspace endpoint, task data and notepad remain unchanged.

Claims live in `public.warranty_claims` separately from sales, revenue, commissions and ordinary purchase orders. An authenticated server endpoint checks the current active profile role before every read or write. The table and save function have no client-role grants. The service-only invoker RPC atomically checks the revision and records any return-to-stock inventory increment and movement. Retry conflicts return HTTP 409.

Each claim supports customer and optional original sales-order links, manufacturer, items, vendor reference, status, notes, and an activity history. Claims POs support zero-cost replacement items, acknowledgement number, expected ship date, freight, partial receiving, print/save PDF, invoice expectation and invoice reference. Closing a no-invoice PO does not require an invoice and creates no AP balance. Actual invoices must be recorded through Accounting. Return dispositions are confirmed separately from replacement receiving. Completing return to stock adds the specified quantity to the selected active inventory item; return to vendor and field destroy record completion without adding saleable inventory.

## Google Sheet connection

Production must have the secret environment variable `GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON`, containing a Google service account JSON credential with the Sheets API enabled. Configure this directly in Vercel; do not commit or paste the credential into source or chat. Share spreadsheet `1r4U88JfKK-9aMzxbUes0KxjuEKm4Mt6RgBwJ2pdSqsU` with that service account's `client_email` as Editor, then redeploy to apply the environment change.

The server creates a dedicated `Hub Claims` tab in the supplied workbook, leaving existing tabs and their layout unchanged. It exports one row per claim using RAW values and a deterministic claim-number row to prevent duplicate rows on retries. Treat Hub Claims as an output tab: don't reorder or delete rows manually. Sync is one-way Hub → Sheet. Existing spreadsheet claims are not imported automatically.

Hub saves complete before Google sync runs through Next.js `after`. Missing credentials or Google errors leave the claim saved with a visible pending/error status. Once connected, use Retry sheet sync on pending existing claims. New changes sync automatically. Use Refresh to see completed background sync status. A per-claim lease serializes sync attempts; expired leases recover after 90 seconds. Pending syncs can be retried manually if a process is interrupted. Optional `HUB_PUBLIC_URL` overrides the default production deep-link origin.

## Verification

Run `node --test tests/claims*.test.cjs tests/dashboard-mode.test.cjs tests/crm-workspace.test.cjs` and `npm run build`. The migration is `supabase/migrations/20261113173754_warranty_claims.sql`.
