/* Verifies DELETION SYNC (tombstones) for sales & stock — the reason sales/
   stock data used to disagree between devices:
   - A sale deleted on device B must NOT resurrect on device A's next merge.
   - After the exchange both devices have identical sales lists and stock.
   - A fresh device pulling the cloud also respects every tombstone. */
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
global.saveState = () => {};
global.lucide = { createIcons() {} };
global.prompt = () => '';
global.confirm = () => false;

const TEST_BODY = `
let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) { pass++; console.log('PASS ' + msg); } else { fail++; console.log('FAIL ' + msg); } }
function fresh() {
  return {
    prices: JSON.parse(JSON.stringify(DEFAULT_PRICES)),
    entries: {}, production: [], sales: [], stock: { pieces: 0, cost: 0 },
    settings: { hourlyWage: 1500 }, inventory: {}, inventoryMovements: [], inventoryMovementVersion: 0,
    customers: [], suppliers: [], purchases: [], payments: [], customerPayments: [],
    expenses: [], recurringExpenses: [], waste: [], priceHistory: [], recipes: [],
    deletions: {}, cash: { opening: 0, adjustments: [] }, draft: null, updatedAt: null
  };
}

/* ---- Device A: rolled 100 pcs, sold 30 (s1) + 40 (s2) -> stock 30 pcs ---- */
const A = fresh();
A.production.push({ id: 'pr1', date: '2026-09-06', pieces: 100, bags: 12, capital: 5000, laborMinutes: 30, laborCost: 750, costPerPiece: 50, createdAt: '2026-09-06T08:00:00Z', updatedAt: '2026-09-06T08:00:00Z' });
A.sales.push({ id: 's1', date: '2026-09-06', pieces: 30, bags: 4, price: 600, amount: 2400, paidAmount: 2400, createdAt: '2026-09-06T09:00:00Z', updatedAt: '2026-09-06T09:00:00Z' });
A.sales.push({ id: 's2', date: '2026-09-06', pieces: 40, bags: 5, price: 600, amount: 3000, paidAmount: 3000, createdAt: '2026-09-06T10:00:00Z', updatedAt: '2026-09-06T10:00:00Z' });
state = A;
rebuildStockAndCogs();
ok(A.stock.pieces === 30, 'device A stock after both sales = 30 pcs (got ' + A.stock.pieces + ')');

/* ---- Device B has the same records, user deletes sale s2 there ---- */
const B = fresh();
B.production = JSON.parse(JSON.stringify(A.production));
B.sales = JSON.parse(JSON.stringify(A.sales));
state = B;
markDeleted('sales', 's2');
B.sales = B.sales.filter(function (x) { return x.id !== 's2'; });
rebuildStockAndCogs();
ok(B.stock.pieces === 70, 'device B deleted s2 -> stock back to 70 pcs (got ' + B.stock.pieces + ')');
ok(!!B.deletions['sales|s2'], 'device B wrote a tombstone for s2');

/* ---- A merges B's copy: s2 must NOT resurrect on A ---- */
state = A;
mergeRemoteIntoLocal(B);
ok(!A.sales.some(function (x) { return x.id === 's2'; }), 'deleted s2 does NOT resurrect on device A after merge');
ok(A.deletions && A.deletions['sales|s2'], 'device A adopted the s2 tombstone');
rebuildStockAndCogs();
ok(A.stock.pieces === 70, 'device A stock now also 70 pcs (got ' + A.stock.pieces + ')');

/* ---- B merges A back: nothing changes, both copies converged ---- */
const stateBsnap = JSON.stringify(B.stock) + '|' + B.sales.map(function (x) { return x.id; }).join(',');
state = B;
mergeRemoteIntoLocal(A);
rebuildStockAndCogs();
ok(B.sales.length === 1 && B.sales[0].id === 's1', 'device B still has only s1');
ok(B.stock.pieces === 70, 'device B stock unchanged at 70 pcs');

/* ---- Fresh device C pulls the cloud (which now has the tombstone) ---- */
const C = fresh();
state = C;
const remoteForC = { state: A };
applyCloudRemote(remoteForC);
ok(!C.sales.some(function (x) { return x.id === 's2'; }), 'fresh device C does not receive the deleted sale');
ok(C.stock.pieces === 70, 'fresh device C stock = 70 pcs (got ' + C.stock.pieces + ')');

console.log(fail === 0 ? 'ALL SALE/STOCK DELETION-SYNC CHECKS PASSED' : (fail + ' CHECK(S) FAILED'));
process.exit(fail === 0 ? 0 : 1);
`;

eval(read('config.js') + '\n' + read('helpers.js') + '\n' + read('suppliers.js') + '\n' + read('sales.js') + '\n' + read('cloud.js') + '\n' + TEST_BODY);