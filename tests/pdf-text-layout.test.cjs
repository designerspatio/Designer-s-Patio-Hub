const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { stripTypeScriptTypes } = require("node:module");
const source = stripTypeScriptTypes(fs.readFileSync("src/app/pdfTextLayout.ts", "utf8"), { mode: "transform" })
  .replace(/export /g, "");
const sandbox = { module: { exports: {} } };
vm.runInNewContext(source + "\nmodule.exports = { pdfTextWidth, wrapPdfWidth };", sandbox);
const { pdfTextWidth, wrapPdfWidth } = sandbox.module.exports;

function assertFits(text, maxWidth, size, bold = false) {
  const lines = wrapPdfWidth(text, maxWidth, size, bold);
  assert.ok(lines.length > 0);
  for (const line of lines) {
    assert.ok(pdfTextWidth(line, size, bold) <= maxWidth + 0.001,
      "Overflow: " + JSON.stringify(line) + " at " + pdfTextWidth(line, size, bold));
  }
  assert.equal(lines.join("").replace(/\s/g, ""), text.replace(/\s/g, ""));
  return lines;
}

test("long OW Lee SKU wraps inside the narrow quote SKU column", () => {
  const lines = assertFits("5112-42RDO SP21PB", 45, 7.2);
  assert.ok(lines.length >= 2);
});
test("unbroken SKU always wraps, including long single tokens", () => {
  const lines = assertFits("ABCDEF1234567890CAPRIFIREPITXX", 45, 7.2);
  assert.ok(lines.length >= 3);
});
test("description uses actual Helvetica Bold widths and keeps every word", () => {
  const lines = assertFits('42" OCCASIONAL HEIGHT CAPRI FIRE', 121, 7.1, true);
  assert.ok(lines.length >= 2);
  assertFits("Manufacturer: OW LEE", 121, 7.1);
  assertFits("Finish: SP21 GRAPHITE/PB PALAZZO BLACK", 121, 7.1);
});
test("multi-page descriptions preserve all text without overflowing cells", () => {
  const text = "Extra long product details. ".repeat(150);
  const lines = assertFits(text, 121, 7.1);
  assert.ok(lines.length > 65);
});
test("empty values remain blank and narrower monetary labels fit", () => {
  assert.deepEqual([...wrapPdfWidth("", 45, 7.2)], [""]);
  const amount = "$12,345,678.90";
  const target = 62;
  const size = Math.min(7.2, 7.2 * target / pdfTextWidth(amount, 7.2, true));
  assert.ok(pdfTextWidth(amount, size, true) <= target + 0.001);
});
test("quote and sales PDFs display the stored project / customer PO", () => {
  const page = fs.readFileSync("src/app/page.tsx", "utf8");
  assert.match(page, /projectReference = \(quoteForm\.customer_po \|\| selectedQuote\.customer_po \|\| ""\)/);
  assert.match(page, /projectReference = \(selectedSale\.customer_po \|\| ""\)/);
  assert.equal((page.match(/textAt\(36, 365, "PROJECT \/ PO"/g) || []).length, 2);
  assert.ok(page.includes("skuLines.slice(lineOffset, lineOffset + linesHere)"));
});
