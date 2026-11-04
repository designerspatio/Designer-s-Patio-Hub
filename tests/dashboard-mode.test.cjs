const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { stripTypeScriptTypes } = require("node:module");
const source = stripTypeScriptTypes(fs.readFileSync("src/app/dashboardMode.ts", "utf8"), { mode: "transform" }).replace(/export /g, "");
const context = { module: { exports: {} } };
vm.runInNewContext(source + "\nmodule.exports={dashboardModeForProfile,remainingBalance,dateAtOrAfter};", context);
const { dashboardModeForProfile, remainingBalance, dateAtOrAfter } = context.module.exports;

test("Pamela sees payables even with accounting shared mailbox", () => {
  assert.equal(dashboardModeForProfile({ display_name: "Pamela Williams", role: "Shipping / Accounting", email: "accounting@designerspatio.com" }), "payables");
});
test("Accounting Team sees receivables", () => {
  assert.equal(dashboardModeForProfile({ display_name: "Accounting Team", role: "Shipping / Accounting", email: "ar@designerspatio.com" }), "receivables");
  assert.equal(dashboardModeForProfile({ display_name: "Accounting", role: "Shipping / Accounting", email: "accounting@designerspatio.com" }), "receivables");
});
test("Owner login opens executive business highlights without affecting other roles", () => {
  assert.equal(dashboardModeForProfile({ display_name: "Geneva", role: "Owner", email: "showroom@designerspatio.com" }), "owner");
  assert.equal(dashboardModeForProfile({ display_name: "Pamela Williams", role: "Shipping / Accounting", email: "accounting@designerspatio.com" }), "payables");
  assert.equal(dashboardModeForProfile({ display_name: "Accounting Team", role: "Shipping / Accounting", email: "accounting@designerspatio.com" }), "receivables");
});
test("Normal sales users stay on sales dashboard", () => {
  assert.equal(dashboardModeForProfile({ display_name: "Joey", role: "Assistant Manager", email: "sales@designerspatio.com" }), "sales");
  assert.equal(dashboardModeForProfile(null), "sales");
});
test("Account balances net recorded payments and reversals", () => {
  assert.equal(remainingBalance(1000, 300), 700);
  assert.equal(remainingBalance(1000, 1100), 0);
  assert.equal(remainingBalance(1000, 300 - 100), 800);
  assert.equal(dateAtOrAfter("2026-11-04", "2026-11-01"), true);
  assert.equal(dateAtOrAfter("2026-10-01", "2026-11-01"), false);
});
