/* ============================================================
   VERIFY: sales profit model — average-cost COGS (not same-day)
   Reproduces the user report "I have 25 bags, sold 10 to one
   customer and the rest to another — why does it show a loss on
   the 10 bags?" and proves the fixed model books profit when
   goods are SOLD, never when they are merely rolled.

   Run:  node _verify_profit_model.js
   ============================================================ */
'use strict';

/* ---- minimal browser stubs so js/helpers.js loads in Node ---- */
global.document = {
  readyState: 'complete',
  addEventListener: function () {},
  getElementById: function () { return null; },
  querySelectorAll: function () { return []; },
  createElement: function () { return {}; }
};
global.document.body = {
  classList: { add: function () {}, remove: function () {}, contains: function () { return false; }, toggle: function () {} }
};
global.window = {};
global.localStorage = { getItem: function () { return null; }, setItem: function () {}, removeItem: function () {} };
global.lucide = { createIcons: function () {} };

const fs = require('fs');
const src = fs.readFileSync('js/helpers.js', 'utf8') +
  '\n;global.__h = { financeTotalsAll, entriesProdSales, saleProfit, rebuildStockAndCogs, projectedSaleCogs };';
eval(src);
const { financeTotalsAll, entriesProdSales, saleProfit, rebuildStockAndCogs, projectedSaleCogs } = global.__h;

let pass = 0, fail = 0;
function ok(cond, name) {
  console.log((cond ? 'PASS' : 'FAIL') + '  ' + name);
  if (cond) pass++; else fail++;
}
const eq = (a, b) => a === b;

/* ============================================================
   Scenario (the report): 25 bags produced, 10 sold to one
   customer the same day, the remaining 15 the NEXT day.
   Production: 25 bags / 125 pieces / 25,000 Ks → 200 Ks/piece.
   Selling price: 2,000 Ks per bag.
   ============================================================ */
global.state = {
  production: [{ id: 'p1', date: '2026-09-08', bags: 25, pieces: 125, capital: 25000, laborMinutes: 0, laborCost: 0 }],
  sales: [
    { id: 's1', date: '2026-09-08', bags: 10, pieces: 50, price: 2000, amount: 20000, cogs: 0, avgCost: 0, net: 0 },
    { id: 's2', date: '2026-09-09', bags: 15, pieces: 75, price: 2000, amount: 30000, cogs: 0, avgCost: 0, net: 0 }
  ],
  waste: [], customers: [], settings: {}, stock: { pieces: 0, cost: 0 }
};

// The app calls this after every change (renderAll → rebuildStockAndCogs).
rebuildStockAndCogs();

// Every sale now carries its true COGS — only the pieces it actually sold.
ok(eq(state.sales[0].cogs, 10000), 'sale A (10 bags) COGS = 10,000 (50 pcs × 200)');
ok(eq(state.sales[1].cogs, 15000), 'sale B (15 bags) COGS = 15,000 (75 pcs × 200)');

// Recent Sales "Profit" column must NOT show a loss on the 10-bag sale.
ok(eq(saleProfit(state.sales[0]), 10000), 'sale A profit = +10,000 (no fake loss)');
ok(eq(saleProfit(state.sales[1]), 15000), 'sale B profit = +15,000');

// Day audit / calendar / dashboard must stop booking the WHOLE batch cost
// against the day it was rolled.
const days = entriesProdSales();
const d1 = days.find(function (d) { return d.date === '2026-09-08'; });
const d2 = days.find(function (d) { return d.date === '2026-09-09'; });
ok(eq(d1.net, 10000), 'production day net = +10,000 (profit on the 10 sold)');
ok(eq(d2.net, 15000), 'next-day net = +15,000 (cost properly attributed)');
ok(eq(d1.cogs, 10000), 'day COGS = cost of goods SOLD, not all 25 bags');
ok(eq(d2.cogs, 15000), 'day 2 COGS = 15,000');

// Overall totals tie out everywhere.
const t = financeTotalsAll();
ok(eq(t.cogs, 25000), 'total COGS = 25,000 (only what was sold)');
ok(eq(t.net, 25000), 'total profit = 50,000 − 25,000 = 25,000');

// Stock is fully consumed → zero pieces and zero cost on hand.
ok(eq(state.stock.pieces, 0), 'stock 0 pieces after both sales');
ok(eq(state.stock.cost, 0), 'stock cost 0 after both sales');

// Editing sale A must project the SAME cogs as its saved row (no double charge).
const editEst = projectedSaleCogs({ id: 's1', date: '2026-09-08', bags: 10, pieces: 50, price: 2000, amount: 20000 });
ok(eq(editEst.cogs, 10000), 'edit preview replaces s1 → COGS stays 10,000');

/* ============================================================
   Same report with only the FIRST sale (10 of 25 bags sold).
   The OLD model showed a −5,000 loss; the fixed model must show
   +10,000 profit with the unsold 15 bags staying in stock.
   ============================================================ */
global.state.sales = [{ id: 's1', date: '2026-09-08', bags: 10, pieces: 50, price: 2000, amount: 20000, cogs: 0, avgCost: 0, net: 0 }];
global.state.stock = { pieces: 0, cost: 0 };

// Document the pre-fix behaviour (same-day matching: day revenue − day capital).
const oldDayNet = function (date) {
  let cap = 0, rev = 0;
  (state.production || []).forEach(function (p) { if (p.date === date) cap += (p.capital || 0); });
  (state.sales || []).forEach(function (s) { if (s.date === date) rev += (s.amount || 0); });
  return rev - cap;
};
ok(eq(oldDayNet('2026-09-08'), -5000), 'OLD model wrongly showed day 1 as −5,000 (bogus loss on 10 bags)');

rebuildStockAndCogs();
const d1b = entriesProdSales().find(function (d) { return d.date === '2026-09-08'; });
ok(eq(d1b.net, 10000), 'FIXED model shows day 1 as +10,000 profit on the 10 bags sold');
ok(eq(state.stock.pieces, 75), 'unsold 15 bags (75 pcs) stay in ready-to-sell stock');
ok(eq(state.stock.cost, 15000), 'their 15,000 cost stays in stock, not booked as a loss');

// Live-form preview for a NEW sale of 5 more bags from that stock.
const est = projectedSaleCogs({ id: 's3', date: '2026-09-10', bags: 5, pieces: 25, price: 2000, amount: 10000 });
ok(eq(est.cogs, 5000), 'live-form preview COGS for 5 more bags = 5,000 (25 pcs × 200)');

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);