/* Verifies the "stock empty on a fresh login / other device" path:
   - Device A records production (pieces ready in stock).
   - A fresh device pulls the account copy (the same path a brand-new login
     takes) and must end up with the production records AND the same stock.
   - An already-open device merging the change live gets the same stock. */
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

/* ---- Device A: rolled 100 pieces -> stock 100 pcs, pushed to the cloud ---- */
const A = fresh();
A.production.push({ id: 'pr1', date: '2026-09-06', pieces: 100, bags: 12, capital: 5000, laborMinutes: 30, laborCost: 750, costPerPiece: 50, createdAt: '2026-09-06T08:00:00Z', updatedAt: '2026-09-06T08:00:00Z' });
state = A;
rebuildStockAndCogs();
ok(A.stock.pieces === 100, 'device A: 100 pieces in stock (got ' + A.stock.pieces + ')');
const cloudPayload = { state: JSON.parse(JSON.stringify(A)), exportedAt: '2026-09-06T10:00:00Z' };

/* ---- Device B: brand-new login pulls the account copy ---- */
state = fresh();
const okApply = applyCloudRemote(cloudPayload);
ok(okApply === true, 'fresh device pull applied');
ok(state.production.length === 1 && state.production[0].pieces === 100, 'fresh device has the production record');
ok(state.stock.pieces === 100, 'fresh device shows 100 pieces in stock after pull (got ' + state.stock.pieces + ')');

/* ---- Device C: already open when A pushes; merges live ---- */
state = fresh();
const changed = mergeRemoteIntoLocal(cloudPayload.state);
rebuildStockAndCogs();
ok(state.production.length === 1, 'open device merged the live production');
ok(state.stock.pieces === 100, 'open device shows 100 pieces in stock after merge (got ' + state.stock.pieces + ')');

console.log(fail === 0 ? 'ALL STOCK-PULL CHECKS PASSED' : (fail + ' CHECK(S) FAILED'));
process.exit(fail === 0 ? 0 : 1);
`;

eval(read('config.js') + '\n' + read('helpers.js') + '\n' + read('suppliers.js') + '\n' + read('sales.js') + '\n' + read('cloud.js') + '\n' + TEST_BODY);