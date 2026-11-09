const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const source = fs.readFileSync(path.join(__dirname, "../src/app/page.tsx"),"utf8");

test("Visa/Mastercard is the only card option in the customer payment selector", () => {
  const options = source.match(/const paymentMethods = \[([\s\S]*?)\] as const;/);
  assert.ok(options, "payment method options must exist");
  const methods = Array.from(options[1].matchAll(/"([^"]+)"/g), m => m[1]);
  assert.equal(methods.filter(m=>m === "Visa/Mastercard").length,1);
  assert.ok(!methods.includes("Visa"));
  assert.ok(!methods.includes("Mastercard"));
});

test("new payments and correction defaults use the merged tender method", () => {
  const defaults = source.match(/payment_method: "Visa\/Mastercard"/g) || [];
  assert.equal(defaults.length,2, "new-payment state and reset default should both be merged");
  assert.doesNotMatch(source,/payment_method: "Visa"/);
  assert.doesNotMatch(source,/payment_method: "Mastercard"/);
});

test("the same merged tender options drive Daily Cash totals and reconciliation", () => {
  assert.match(source,/paymentMethods\.map\(\s*\(method\) => \{/);
  assert.match(source,/paymentMethods\.reduce\(/);
});
