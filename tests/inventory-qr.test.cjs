const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const source = (name) => fs.readFileSync(path.join(__dirname,"..","src","app",name),"utf8");

test("public QR tear sheet excludes pricing, costs, counts, and internal notes",()=>{
  const page=source(path.join("i","[id]","page.tsx"));
  assert.match(page,/dp_public_inventory_tear_sheet/);
  assert.match(page,/DP_PDF_LOGO_DATA_URL/);
  assert.match(page,/item\.item_dimensions/);
  assert.match(page,/214-217-9997/);
  assert.match(page,/2000 N Stemmons Fwy/);
  for(const forbidden of ["msrp","unit_cost","internal_notes","quantity_on_hand","sales_order"]){
    assert.doesNotMatch(page,new RegExp(forbidden,"i"),"Public route must not render "+forbidden);
  }
});

test("printed QR tags carry DP branding, customer URL and MSRP",()=>{
  const tag=source("InventoryQrTag.tsx");
  assert.match(tag,/QRCodeSVG/);
  assert.match(tag,/DP_PDF_LOGO_DATA_URL/);
  assert.match(tag,/\.vercel\.app\/i\//);
  assert.match(tag,/MSRP/);
  assert.match(tag,/Number of tags/);
});

test("inventory editor stores photos, dimensions and private notes",()=>{
  const page=source("page.tsx");
  for(const column of ["image_url","dimensions","internal_notes"]){
    assert.match(page,new RegExp(column));
  }
  assert.match(page,/storage\.from\("inventory-images"\)/);
});

test("count mode snapshots on start, records scans and exports discrepancies without stock changes",()=>{
  const panel=source("InventoryCountPanel.tsx");
  for(const name of ["dp_start_inventory_count","dp_record_inventory_scan","dp_set_inventory_count_quantity","dp_finalize_inventory_count"]){
    assert.match(panel,new RegExp(name));
  }
  assert.match(panel,/Download reconciliation CSV/);
  assert.match(panel,/Not scanned/);
  assert.doesNotMatch(panel,/from\("inventory_items"\)\.update/);
});
