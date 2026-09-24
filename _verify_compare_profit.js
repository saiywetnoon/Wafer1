/* ============================================================
   VERIFY — COMPARE PRICE & PACK — PROFIT MATRIX (v1.15.0)
   ----------------------------------------------------------------------------
   New Business Tools card: "what-if is my profit if I sell at a different
   price, packed with more/fewer pieces per bag, or rolled at a different
   grams-per-roll?"  Profit = (price × bags) − (capital + labor), same
   convention as the Break-Even / Target-Profit calculators.

      • ppb mode (pieces per bag): bags = floor(pieces ÷ packValue)
      • gpr mode (grams per roll):  pieces = floor(mixGrams ÷ packValue),
                                    bags = floor(pieces ÷ currentPpb)

   This harness extracts the PURE function compareProfitScenario() from the
   REAL js/tools.js and unit-tests the math, then statically checks the UI
   wiring (dispatcher, card ids) and the build stamp.

   Run:  node _verify_compare_profit.js
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

const toolsSrc = read('tools.js');
const lineNo = toolsSrc.slice(0, toolsSrc.indexOf('function compareProfitScenario')).split('\n').length;
const scenario = new Function('return ' + extractFunction(toolsSrc, 'compareProfitScenario'))();

console.log('compareProfitScenario extracted from js/tools.js (function at line ' + lineNo + ')\n-- unit tests --');

/* Baseline batch: 4400 g mix, 220 pieces, 5 pcs/bag, capital 2000, labor 500. */
const M = 4400, P = 220, PPB = 5, CAP = 2000, LAB = 500;

/* ppb mode — packing knob changes only the bag count */
{
  const r = scenario(M, P, PPB, CAP, LAB, 100, 5, 'ppb');
  ok(r.pieces === 220 && r.bags === 44 && r.revenue === 4400 && near(r.profit, 1900) && near(r.margin, 43.1818), 'ppb @100Ks×5/bag → 44 bags, profit 1,900 (43.18% margin)');
  const r2 = scenario(M, P, PPB, CAP, LAB, 100, 4, 'ppb');
  ok(r2.bags === 55 && near(r2.profit, 3000), 'ppb @100Ks×4/bag → 55 bags, profit 3,000');
  const r3 = scenario(M, P, PPB, CAP, LAB, 100, 6, 'ppb');
  ok(r3.bags === 36 && near(r3.profit, 1100), 'ppb @100Ks×6/bag → 36 bags, profit 1,100');
}

/* gpr mode — rolling knob changes the piece/roll count */
{
  const r = scenario(M, P, PPB, CAP, LAB, 100, 20, 'gpr');
  ok(r.pieces === 220 && r.bags === 44 && near(r.profit, 1900), 'gpr @100Ks×20g/roll → 220 pcs → 44 bags, profit 1,900');
  const r2 = scenario(M, P, PPB, CAP, LAB, 100, 25, 'gpr');
  ok(r2.pieces === 176 && r2.bags === 35 && near(r2.profit, 1000), 'gpr @100Ks×25g/roll → 176 pcs → 35 bags, profit 1,000');
  const r3 = scenario(M, P, PPB, CAP, LAB, 100, 10, 'gpr');
  ok(r3.pieces === 440 && r3.bags === 88 && near(r3.profit, 6300), 'gpr @100Ks×10g/roll → 440 pcs → 88 bags, profit 6,300');
  const r4 = scenario(229, P, PPB, CAP, LAB, 100, 20, 'gpr');
  ok(r4.pieces === 11 && r4.bags === 2, 'gpr fractional mix → floor pieces, floor bags');
}

/* sanity: no sales / bad inputs never crash and never inflate profit */
{
  const r = scenario(M, P, PPB, CAP, LAB, 0, 5, 'ppb');
  ok(r.revenue === 0 && near(r.profit, -2500) && r.bags === 44, 'price 0 → 0 revenue, profit = −(capital+labor)');
  const r2 = scenario(M, P, PPB, CAP, LAB, 100, 0, 'ppb');
  ok(r2.bags === 0 && near(r2.profit, -2500), 'pack 0 → 0 bags, loss = capital+labor');
  const r3 = scenario(0, 0, PPB, CAP, LAB, 100, 5, 'gpr');
  ok(r3.pieces === 0 && r3.bags === 0, 'empty batch → zeros, no crash');
}

console.log('\n-- static wiring checks --');
const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const config = read('config.js');

ok(toolsSrc.indexOf('renderCompareProfit();') >= 0, 'renderTools() dispatcher calls renderCompareProfit()');
ok(toolsSrc.indexOf('function renderCompareProfit') >= 0, 'renderCompareProfit() defined in tools.js');
['cpMatrix', 'cpBaseline', 'cpPrices', 'cpPacks', 'cpPackMode'].forEach(function (id) {
  ok(html.indexOf('id="' + id + '"') >= 0, 'card element #' + id + ' exists in index.html');
});
const compCard = html.indexOf('Compare Price & Pack');
const wasteCard = html.indexOf('Waste / Scrap');
ok(compCard > 0 && compCard < wasteCard, 'Compare card sits before the Waste card in the Tools tab');

const htmlBuild = (html.match(/data-build="([^"]+)"/) || [])[1];
const jsBuild = (config.match(/__LEDGER_BUILD = '([^']+)'/) || [])[1];
ok(!!htmlBuild && htmlBuild === jsBuild, 'build stamp matches index.html + js/config.js: ' + htmlBuild);
ok(!!htmlBuild && /^v1\.\d+\.\d+$/.test(htmlBuild), 'build stamp is a v1.x.x release (this feature landed in v1.15.0)');

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);