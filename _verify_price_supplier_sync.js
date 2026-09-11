/* Verifies the two reported sync-loss bugs against the CURRENT code:
   1. Egg price edited 550 -> 560 on one device must SURVIVE a merge with a
      stale cloud copy (old bug: record-count tiebreak blind-replaced prices
      and wiped priceHistory -> "price reverted, no history").
   2. A purchase of 9 eggs (with supplier record) must SURVIVE a merge with a
      cloud copy that lacks the purchase ("eggs in inventory but no record
      in the supplier").
   Also checks priceHistory entries now union across devices by id instead of
   collapsing same-ingredient changes. */
const fs = require('fs');
const path = require('path');
const dir = 'd:\\wafer\\Wafer_documentary\\dail-ledger v1.6 - Copy\\js';
const read = (f) => fs.readFileSync(path.join(dir, f), 'utf8');

global.window = global;
global.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
global.document = {
  body: { classList: { add() {}, remove() {}, contains() { return false; }, toggle() {} } },
  getElementById: () => ({ classList: { add() {}, remove() {}, contains() { return false; } }, appendChild() {}, remove() {}, setAttribute() {}, addEventListener() {}, innerHTML: '', textContent: '', value: '' }),
  querySelectorAll: () => [],
  createElement: () => ({ classList: { add() {}, remove() {} }, querySelectorAll: () => [], addEventListener() {}, appendChild() {}, innerHTML: '' })
};
global.showToast = () => {};
global.updateGoogleSyncStatus = () => {};
global.updateAppStatus = () => {};
global.lucide = { createIcons() {} };
global.prompt = () => '';
global.confirm = () => false;

const TEST_BODY = `
let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) { pass++; console.log('PASS ' + msg); } else { fail++; console.log('FAIL ' + msg); } }

function freshState() {
  return {
    version: 2,
    prices: JSON.parse(JSON.stringify(DEFAULT_PRICES)),
    entries: {}, production: [], sales: [], stock: { pieces: 0, cost: 0 },
    settings: { hourlyWage: 1500 }, inventory: {}, inventoryMovements: [], inventoryMovementVersion: 0,
    customers: [], suppliers: [], purchases: [], payments: [], customerPayments: [],
    expenses: [], recurringExpenses: [], waste: [], priceHistory: [], recipes: [],
    cash: { opening: 0, adjustments: [] }, draft: null, updatedAt: null
  };
}

/* ---------- Scenario 1: egg price 550 -> 560 + priceHistory + 9-egg purchase
   must ALL survive a merge with a stale (older/count-heavier) cloud copy. ---- */
state = freshState();

// Device A (this PC) after the user's edits on day 6:
state.prices.find(function (p) { return p.name === 'Egg'; }).price = 560;
state.prices.find(function (p) { return p.name === 'Egg'; }).updatedAt = '2026-09-06T10:00:00.000Z';
state.priceHistory.push({ id: 'h_egg1', date: '2026-09-06', name: 'Egg', old: 550, new: 560, updatedAt: '2026-09-06T10:00:00.000Z' });
state.suppliers.push({ id: 's1', name: 'Sun Market', createdAt: '2026-08-01T08:00:00Z', updatedAt: '2026-08-01T08:00:00Z' });
state.purchases.push({ id: 'p9', supplierId: 's1', date: '2026-09-07', items: [{ name: 'Egg', qty: 9, unit: 'unit', price: 560, amount: 5040 }], itemTotal: 5040, paidNow: 0, paid: 0, createdAt: '2026-09-07T03:30:00Z', updatedAt: '2026-09-07T03:30:00Z' });
state.inventoryMovements.push({ id: 'm1', date: '2026-09-07', ingredientName: 'Egg', qty: 9, type: 'purchase', reason: 'Supplier purchase', referenceId: 'p9', createdAt: '2026-09-07T03:30:00Z' });
state.production.push({ id: 'pr1', date: '2026-09-05', pieces: 100, bags: 12, usage: { 'Egg': 2 }, capital: 5000, laborMinutes: 30, laborCost: 750, costPerPiece: 50 });
state.updatedAt = '2026-09-07T03:30:00.000Z';

// Remote cloud copy: MORE records total (so the OLD count-tiebreak would have
// chosen it), but STALE — Egg still 550, no priceHistory, missing the purchase.
const remote = freshState();
remote.prices.find(function (p) { return p.name === 'Egg'; }).price = 550;          // stale
remote.suppliers.push({ id: 's1', name: 'Sun Market', createdAt: '2026-08-01T08:00:00Z' });
remote.production.push({ id: 'pr1', date: '2026-09-05', pieces: 100, bags: 12, usage: { 'Egg': 2 }, capital: 5000, laborMinutes: 30, laborCost: 750, costPerPiece: 50 });
remote.production.push({ id: 'pr2', date: '2026-09-03', pieces: 80, bags: 10, usage: { 'Flour': 100 }, capital: 4000, laborMinutes: 25, laborCost: 625, costPerPiece: 50 }); // extra record cloud has
remote.sales.push({ id: 'sl1', date: '2026-09-04', pieces: 60, bags: 7, price: 500, amount: 30000, cogs: 0, avgCost: 0, net: 0 }); // extra record cloud has
remote.sales.push({ id: 'sl2', date: '2026-09-05', pieces: 90, bags: 11, price: 500, amount: 45000, cogs: 0, avgCost: 0, net: 0 });
remote.inventoryMovements.push({ id: 'm_old', date: '2026-08-20', ingredientName: 'Flour', qty: 50, type: 'purchase', reason: 'Old base stock', createdAt: '2026-08-20T08:00:00Z' });
remote.updatedAt = '2026-08-20T08:00:00.000Z';

// OLD behaviour would have said: remote has MORE records -> blind-replace local
// with remote -> Egg 550, no history, purchase gone. NEW behaviour: additive merge.
const changed = mergeRemoteIntoLocal(remote);

// 1) Price survives
const eggNow = state.prices.find(function (p) { return p.name === 'Egg'; });
ok(eggNow && eggNow.price === 560, 'Egg price stays 560 after merging a stale 550 cloud copy (got ' + (eggNow && eggNow.price) + ')');

// 2) priceHistory entry survives and remains untouched
ok(state.priceHistory.some(function (h) { return h.id === 'h_egg1' && h.old === 550 && h.new === 560; }),
   'priceHistory entry for Egg 550->560 survives the merge');

// 3) The 9-egg purchase + supplier record survive
ok(state.purchases.some(function (p) { return p.id === 'p9' && p.supplierId === 's1' && p.items.some(function (i) { return i.name === 'Egg' && i.qty === 9; }); }),
   '9-egg purchase record survives the merge (supplier tab keeps the record)');
ok(state.suppliers.some(function (s) { return s.id === 's1' && s.name === 'Sun Market'; }), 'supplier record survives');
ok(state.inventoryMovements.some(function (m) { return m.id === 'm1' && m.referenceId === 'p9'; }), 'inventory movement for the purchase survives');

// 4) Remote-ONLY records are still pulled in (additive, nothing dropped)
ok(state.production.some(function (p) { return p.id === 'pr2'; }), 'remote-only production record was merged IN');
ok(state.sales.length === 2, 'remote-only sales records were merged IN');

// 5) Price history entries with distinct ids union without collapsing
state.priceHistory.push({ id: 'h_egg2', date: '2026-09-08', name: 'Egg', old: 560, new: 570, updatedAt: '2026-09-08T09:00:00Z' });
const remote2 = freshState();
remote2.priceHistory.push({ id: 'h_sugar1', date: '2026-09-08', name: 'Sugar', old: 2800, new: 3000, updatedAt: '2026-09-08T09:00:00Z' });
mergeRemoteIntoLocal(remote2);
ok(state.priceHistory.some(function (h) { return h.id === 'h_egg1'; })
   && state.priceHistory.some(function (h) { return h.id === 'h_egg2'; })
   && state.priceHistory.some(function (h) { return h.id === 'h_sugar1'; }),
   'priceHistory unions across devices by id (' + state.priceHistory.length + ' entries, no collapse)');

// 6) Newer remote price WINS the same-row clash (updatedAt respected)
const remote3 = freshState();
remote3.prices.find(function (p) { return p.name === 'Egg'; }).price = 575;
remote3.prices.find(function (p) { return p.name === 'Egg'; }).updatedAt = '2026-09-09T12:00:00.000Z';
mergeRemoteIntoLocal(remote3);
ok(state.prices.find(function (p) { return p.name === 'Egg'; }).price === 575,
   'a genuinely NEWER remote Egg price (575) correctly wins the merge (got ' + state.prices.find(function (p) { return p.name === 'Egg'; }).price + ')');

// 7) normalizeSupplierPayables still runs on the merged state without crashing
try { normalizeSupplierPayables(); ok(true, 'normalizeSupplierPayables runs clean after merge'); }
catch (e) { ok(false, 'normalizeSupplierPayables crashed: ' + e.message); }

console.log(fail === 0 ? 'ALL PRICE/SUPPLIER SYNC CHECKS PASSED' : (fail + ' CHECK(S) FAILED'));
process.exit(fail === 0 ? 0 : 1);
`;

const src = read('config.js') + '\n' + read('helpers.js') + '\n' + read('suppliers.js') + '\n' + read('cloud.js') + '\n' + TEST_BODY;
eval(src);