/* ============================================================
   VERIFY — ADMIN DEFAULT RECIPE MANAGER + PRODUCTION PROFIT COMPARE (v1.17.0)
   ----------------------------------------------------------------------------
   Admin-only tool inside the Users & Permissions tab:
     1) Default Recipe Manager — manual, unit-aware editor for the standing
        recipe that pre-fills every day's form. It writes the SAME
        state.settings.defaultUsage store as the Production form's
        "Save as Default Recipe" button (one shared default, zero migration);
        Reset clears it so forms fall back to the built-in DEFAULT_USAGE.
     2) Profit Across Recipes & Batches — recent real batches + the active
        default recipe (what-if) + every saved Tools recipe, all costed at
        today's last sale price with the app's standard
        profit = (price × bags) − (capital + labor).

   This harness extracts the PURE math functions from the REAL js/admin-recipe.js
   (and electricityBillParts from helpers.js) and unit-tests them, then
   statically checks the UI wiring, the admin-only tab placement, and the
   build stamp.

   Run:  node _verify_admin_recipe.js
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const dir = path.join(__dirname, 'js');
const read = (f) => fs.readFileSync(path.join(dir, f), 'utf8');

let pass = 0, fail = 0;
function ok(cond, msg) {
  if (cond) { pass++; console.log('  PASS  ' + msg); }
  else { fail++; console.log('  FAIL  ' + msg); }
}
const near = (a, b) => Math.abs(a - b) <= 0.001;

/* ---------- extract one pure function from the real source ---------- */
function extractFunction(src, name) {
  const i = src.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('function ' + name + ' not found');
  const open = src.indexOf('{', i);
  let depth = 0;
  for (let k = open; k < src.length; k++) {
    if (src[k] === '{') depth++;
    else if (src[k] === '}') { depth--; if (depth === 0) return src.slice(i, k + 1); }
  }
  throw new Error('function ' + name + ' unbalanced');
}

const adminSrc = read('admin-recipe.js');
const helpersSrc = read('helpers.js');
const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const initSrc = read('init.js');
const configSrc = read('config.js');

/* ---------- sandbox the PURE functions from the REAL files ---------- */
global.electricityBillParts = new Function('return ' + extractFunction(helpersSrc, 'electricityBillParts'))();
global.ELECTRICITY_RATES = [50, 100, 150, 300]; // module-level const used by electricityBillParts
global.adminMixWeightGrams = new Function('return ' + extractFunction(adminSrc, 'adminMixWeightGrams'))();
global.adminLineCost = new Function('return ' + extractFunction(adminSrc, 'adminLineCost'))();
global.adminUsageCostBreakdown = new Function('return ' + extractFunction(adminSrc, 'adminUsageCostBreakdown'))();
global.adminExpectedPieces = new Function('return ' + extractFunction(adminSrc, 'adminExpectedPieces'))();
global.adminExpectedBags = new Function('return ' + extractFunction(adminSrc, 'adminExpectedBags'))();
global.adminMedianLaborCost = new Function('return ' + extractFunction(adminSrc, 'adminMedianLaborCost'))();
global.adminCompareRow = new Function('return ' + extractFunction(adminSrc, 'adminCompareRow'))();

/* Test price set (mirrors the ledger's pricing shape). */
global.state = {
  prices: [
    { name: 'Flour', unit: 'g', price: 4600, weightPerUnit: null },
    { name: 'Tapioca', unit: 'g', price: 2500, weightPerUnit: null },
    { name: 'Sugar', unit: 'g', price: 2000, weightPerUnit: null },
    { name: 'Egg', unit: 'unit', price: 300, weightPerUnit: 50 },
    { name: 'Water', unit: 'unit', price: 0, weightPerUnit: 1000 },
    { name: 'Packaging', unit: 'unit', price: 4, weightPerUnit: 17.14 },
    { name: 'Electricity', unit: 'unit', price: 150, weightPerUnit: null }
  ],
  settings: {}, recipes: [], production: []
};

/* ---------- unit-aware line costing ---------- */
ok(near(adminLineCost({ name: 'Flour', unit: 'g', price: 4600 }, 100), 460), 'g item: 100 g flour @ 4,600/kg = 460');
ok(near(adminLineCost({ name: 'Egg', unit: 'unit', price: 300 }, 2), 600), 'unit item: 2 eggs @ 300 = 600');
ok(near(adminLineCost({ name: 'Packaging', unit: 'unit', price: 4 }, 82), 328), 'unit item: 82 packs @ 4 = 328');
ok(near(adminLineCost({ name: 'Water', unit: 'unit', price: 0 }, 5), 0), 'zero-price item costs 0');
ok(near(adminLineCost({ name: 'Flour', unit: 'g', price: 4600 }, 0), 0), 'zero qty costs 0');
ok(near(adminLineCost({ name: 'Electricity', unit: 'unit', price: 150 }, 12), 1800), 'electricity uses tiered bill: 12 units = 1,800');

/* ---------- mix weight ---------- */
ok(near(adminMixWeightGrams({ name: 'Flour', unit: 'g' }, 100), 100), 'g item mix weight = qty');
ok(near(adminMixWeightGrams({ name: 'Egg', unit: 'unit', weightPerUnit: 50 }, 2), 100), 'unit item mix weight = qty × weightPerUnit');

/* ---------- full breakdown cross-check ---------- */
const usage = { Flour: 100, Tapioca: 280, Sugar: 60, Egg: 2, Water: 3, Packaging: 82, Electricity: 12 };
const b = adminUsageCostBreakdown(usage);
ok(near(b.capital, 4008), 'breakdown capital = 4,008 (unit-aware incl. tiered electricity)');
ok(b.mixWeight === 4945, 'breakdown mix weight = 4,945 g (rows rounded)');
const pkgRow = b.rows.find((r) => r.name === 'Packaging');
ok(pkgRow && pkgRow.unit === 'unit' && near(pkgRow.lineCost, 328), 'breakdown row unit/label/line-cost correct');
ok(b.rows.find((r) => r.name === 'Flour').unit === 'g', 'breakdown marks gram items as g');

/* ---------- expected pieces + full-set bags ---------- */
ok(adminExpectedPieces(usage, 20) === 247, 'expected pieces = floor(4945.48/20) = 247');
ok(adminExpectedBags(247, 5) === 49, 'expected bags (5/bag) = 49');
ok(adminExpectedBags(247, 0) === 0, 'expected bags with 0 ppb = 0');
ok(adminExpectedPieces(usage, 0) === 0, 'expected pieces with 0 wpr = 0');

/* ---------- median labour ---------- */
ok(near(adminMedianLaborCost([{ laborCost: 1000 }, { laborCost: 2000 }, { laborCost: 3000 }]), 2000), 'median labor (odd) = 2,000');
ok(near(adminMedianLaborCost([{ laborCost: 1000 }, { laborCost: 2000 }]), 1500), 'median labor (even) = 1,500');
ok(near(adminMedianLaborCost([{ laborCost: 0 }, { laborCost: 0 }, { laborCost: 500 }]), 500), 'median labor ignores 0-cost rows');
ok(near(adminMedianLaborCost([]), 0), 'median labor of empty = 0');


/* ---------- compare row (profit convention = Compare Price & Pack) ---------- */
const cr = adminCompareRow({ priceBag: 100, pieces: 247, bags: 49, capital: 4008, laborCost: 2000 });
ok(near(cr.costTotal, 6008), 'cost total = capital + labour = 6,008');
ok(near(cr.revenue, 4900), 'revenue = 100 × 49 = 4,900');
ok(near(cr.profit, 4900 - 6008), 'profit = revenue − cost = −1,108');
ok(near(cr.costPerPiece, Math.round((6008 / 247) * 100) / 100), 'cost per piece ≈ 24.32 (2-dp)');
ok(near(cr.costPerBag, Math.round((6008 / 49) * 100) / 100), 'cost per bag ≈ 122.61 (2-dp)');
ok(near(cr.margin, ((4900 - 6008) / 4900) * 100), 'margin % correct (negative → loss)');
ok(adminCompareRow({ priceBag: 0, pieces: 247, bags: 49, capital: 4008, laborCost: 2000 }).revenue === 0, 'no price → revenue 0, profit negative');
ok(adminCompareRow({ pieces: 0, bags: 0, capital: 0, laborCost: 0 }).costPerPiece === 0 && adminCompareRow({ pieces: 0, bags: 0, capital: 0, laborCost: 0 }).costPerBag === 0, 'zero pieces/bags → per-unit costs 0 (no div-by-zero)');

/* ---------- static wiring ---------- */
ok(adminSrc.indexOf('state.settings.defaultUsage') >= 0, 'admin module writes state.settings.defaultUsage (same store as the form)');
ok(adminSrc.indexOf('authIsAdmin') >= 0, 'admin module enforces admin privilege (authIsAdmin)');
ok(adminSrc.indexOf('admin-usage-input') >= 0, 'editor inputs use the dedicated admin-usage-input class');
ok(!/class="usage-input/.test(adminSrc), 'no plain usage-input class (avoids Production form draft-capture collision)');
ok(adminSrc.indexOf('defaultUsageUpdatedAt') >= 0 && adminSrc.indexOf('defaultUsageUpdatedBy') >= 0, 'provenance stamp (who/when) is recorded');
ok(initSrc.indexOf('renderAdminRecipe()') >= 0, 'init renderAll dispatches renderAdminRecipe()');
ok(initSrc.indexOf('renderAdminCompare()') >= 0, 'init renderAll dispatches renderAdminCompare()');
ok(initSrc.indexOf("typeof renderAdminRecipe === 'function'") >= 0, 'admin dispatch is guarded (non-fatal if module missing)');

/* cards live inside the admin-only Users tab */
const usersIdx = html.indexOf('<section id="tab-users"');
ok(usersIdx >= 0, 'Users tab section exists');
const recIdx = html.indexOf('id="adminRecipeTable"');
const cmpIdx = html.indexOf('id="adminCompareTable"');
const secClose = html.indexOf('</section>', usersIdx);
ok(recIdx > usersIdx && recIdx < secClose, 'Default Recipe card sits inside the Users tab (admin-only visibility)');
ok(cmpIdx > usersIdx && cmpIdx < secClose, 'Profit Compare card sits inside the Users tab (admin-only visibility)');
ok(html.indexOf('id="adminRecipeSave"') >= 0, 'Save button exists');
ok(html.indexOf('id="adminRecipeReset"') >= 0, 'Reset button exists');
ok(html.indexOf('id="adminRecipeSource"') >= 0 && html.indexOf('id="adminRecipeUpdated"') >= 0, 'source badge + provenance elements exist');
ok(html.indexOf('id="adminCompareInfo"') >= 0, 'compare info line exists');
ok(html.indexOf('data-lucide="chef-hat"') >= 0, 'recipe manager uses chef-hat icon');
ok(html.indexOf('data-lucide="scale"') >= 0, 'compare card uses scale icon');

/* script include order (admin-recipe before init so the dispatcher is ready) */
const aiIdx = html.indexOf('js/admin-recipe.js');
const initIdx = html.indexOf('js/init.js');
ok(aiIdx > 0 && initIdx > 0 && aiIdx < initIdx, 'admin-recipe.js is included before init.js');

/* build stamp matches */
const htmlBuild = (html.match(/data-build="([^"]+)"/) || [])[1];
const jsBuild = (configSrc.match(/__LEDGER_BUILD = '([^']+)'/) || [])[1];
ok(!!htmlBuild && htmlBuild === jsBuild, 'build stamp matches index.html + js/config.js: ' + htmlBuild);
ok(!!htmlBuild && /^v1\.\d+\.\d+$/.test(htmlBuild), 'build is a v1.x.x release (feature in v1.17.0)');

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);

