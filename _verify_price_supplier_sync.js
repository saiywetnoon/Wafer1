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
const dir = 'd:\\wafer\\Wafer_documentary\\dail-ledger v1.7\\js';
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

/* ---------- Part 2: every writer stamps -> newest-wins everywhere ---------- */

// Production + sales records carry timestamps and the newest edit wins the merge.
state.production.push({ id: 'pr_stamp', date: '2026-09-10', pieces: 50, bags: 6, usage: { 'Egg': 1 }, capital: 2000, laborMinutes: 15, laborCost: 375, costPerPiece: 40, createdAt: '2026-09-10T08:00:00Z', updatedAt: '2026-09-10T08:00:00Z' });
mergeRemoteIntoLocal({ production: [{ id: 'pr_stamp', date: '2026-09-10', pieces: 60, bags: 7, usage: { 'Egg': 1 }, capital: 2100, laborMinutes: 15, laborCost: 375, costPerPiece: 35, createdAt: '2026-09-10T08:00:00Z', updatedAt: '2026-09-10T09:30:00Z' }] });
ok(state.production.find(function (p) { return p.id === 'pr_stamp'; }).pieces === 60,
   'newest production edit wins the same-id merge (got ' + state.production.find(function (p) { return p.id === 'pr_stamp'; }).pieces + ')');

state.sales.push({ id: 'sl_stamp', date: '2026-09-10', pieces: 40, bags: 5, price: 600, amount: 3000, paidAmount: 3000, createdAt: '2026-09-10T08:00:00Z', updatedAt: '2026-09-10T08:00:00Z' });
mergeRemoteIntoLocal({ sales: [{ id: 'sl_stamp', date: '2026-09-10', pieces: 45, bags: 6, price: 600, amount: 3600, paidAmount: 3600, createdAt: '2026-09-10T08:00:00Z', updatedAt: '2026-09-10T10:00:00Z' }] });
ok(state.sales.find(function (x) { return x.id === 'sl_stamp'; }).amount === 3600,
   'newest sale edit wins the same-id merge');

// Customers: balance recompute stamps only when something changed (no churn).
state.customers = [{ id: 'c1', name: 'Aung', debt: 0, standingOrder: 0, price: 1300, phone: '', extraDebt: 0, createdAt: '2026-08-01T00:00:00Z', updatedAt: '2026-08-01T00:00:00Z' }];
state.customerPayments = [];
state.sales = [];
const stampBefore = state.customers[0].updatedAt;
normalizeCustomerBalances();
ok(state.customers[0].updatedAt === stampBefore, 'normalizeCustomerBalances is stable when nothing changed (no churn)');
state.sales.push({ id: 'slc1', customerId: 'c1', date: '2026-09-10', amount: 13000, paidAmount: 3000, createdAt: '2026-09-10T08:00:00Z', updatedAt: '2026-09-10T08:00:00Z' });
state.customerPayments.push({ id: 'cp1', customerId: 'c1', date: '2026-09-11', amount: 5000, createdAt: '2026-09-11T08:00:00Z' });
normalizeCustomerBalances();
ok(state.customers[0].debt === 5000, 'customer debt recomputed from ledger (10000 - 5000 = 5000, got ' + state.customers[0].debt + ')');
ok(state.customers[0].updatedAt !== stampBefore, 'customer row stamped when its balance changed');

// Inventory items are created with timestamps so low-alert edits merge newest-wins.
state.inventory = {}; state.inventoryMovements = [];
const invItem = ensureInventoryItem('Egg');
ok(!!invItem.createdAt && !!invItem.updatedAt, 'inventory items are created with timestamps');

console.log(fail === 0 ? 'ALL PRICE/SUPPLIER SYNC CHECKS PASSED' : (fail + ' CHECK(S) FAILED'));
process.exit(fail === 0 ? 0 : 1);
`;

const src = read('config.js') + '\n' + read('helpers.js') + '\n' + read('suppliers.js') + '\n' + read('sales.js') + '\n' + read('cloud.js') + '\n' + TEST_BODY;
eval(src);