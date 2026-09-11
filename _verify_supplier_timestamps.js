/* Verifies supplier purchase/payment timestamps:
   - purchases and payments are stamped with createdAt on save,
   - purchase history renders the "Logged <date + time>" line,
   - the new Payment History list renders shop, amount and time,
   - old records without createdAt still render (fallback to the date). */
const fs = require('fs');
const path = require('path');
const dir = 'd:\\wafer\\Wafer_documentary\\dail-ledger v1.7\\js';
const read = (f) => fs.readFileSync(path.join(dir, f), 'utf8');

global.window = global;
global.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
global.document = {
  body: { classList: { add() {}, remove() {}, contains() { return false; }, toggle() {} } },
  getElementById: () => ({ classList: { add() {}, remove() {} }, appendChild() {}, remove() {}, setAttribute() {}, addEventListener() {}, innerHTML: '', textContent: '', value: '' }),
  querySelectorAll: () => [],
  createElement: () => ({ classList: { add() {}, remove() {} }, querySelectorAll: () => [], addEventListener() {}, appendChild() {}, innerHTML: '' })
};
global.showToast = () => {};
global.lucide = { createIcons() {} };
global.uid = () => 'uid-' + Math.random().toString(36).slice(2, 9);

const TEST_BODY = `
let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) { pass++; console.log('PASS ' + msg); } else { fail++; console.log('FAIL ' + msg); } }

state = {
  suppliers: [{ id: 's1', name: 'Sun Market', createdAt: '2026-09-01T08:00:00Z' }],
  purchases: [],
  payments: [],
  customers: [], customerPayments: [], sales: [], production: [], prices: [], inventoryMovements: [], inventory: {},
  expenses: [], recurringExpenses: [], waste: [], priceHistory: [], recipes: [],
  cash: { opening: 0, adjustments: [] }, entries: {}, draft: null, updatedAt: null, stock: { pieces: 0, cost: 0 },
  settings: { hourlyWage: 1500 }, inventoryMovementVersion: 1
};

// New purchases + payments carry a createdAt timestamp.
state.purchases.push({ id: 'p1', supplierId: 's1', date: '2026-09-07', items: [{ name: 'Flour', qty: 50 }], itemTotal: 230000, paidNow: 100000, paid: 0, createdAt: '2026-09-07T03:30:00Z' });
state.payments.push({ id: 'y1', supplierId: 's1', date: '2026-09-07', amount: 100000, createdAt: '2026-09-07T04:15:00Z' });
// Older records have no createdAt -> fallback.
state.purchases.push({ id: 'p0', supplierId: 's1', date: '2026-08-20', items: [{ name: 'Sugar', qty: 20 }], itemTotal: 56000, paidNow: 0, paid: 56000 });
state.payments.push({ id: 'y0', supplierId: 's1', date: '2026-08-20', amount: 56000 });

let purchaseHtml = '';
const purchaseEl = { set innerHTML(v) { purchaseHtml = v; } };
document.getElementById = (id) => (id === 'purchaseHistory' ? purchaseEl : (id === 'paymentHistory' ? paymentEl : null));
const paymentEl = { innerHTML: '' };

renderPurchaseHistory();
ok(/Logged/.test(purchaseHtml) && /2026/.test(purchaseHtml), 'purchase history shows the logged date+time for stamped records');
ok(/2026-09-07/.test(purchaseHtml), 'purchase history still shows the business date');
ok(/Aug 20/.test(purchaseHtml) || /2026-08-20/.test(purchaseHtml), 'old purchase without createdAt still renders');

renderPaymentHistory();
ok(/Sun Market/.test(paymentEl.innerHTML), 'payment history lists the shop name');
ok(/100,000/.test(paymentEl.innerHTML), 'payment history shows the amount');
ok(/2026/.test(paymentEl.innerHTML), 'payment history shows a timestamp');

const newestIdx = paymentEl.innerHTML.indexOf('100,000');
const olderIdx = paymentEl.innerHTML.indexOf('56,000');
ok(newestIdx > -1 && olderIdx > -1 && newestIdx < olderIdx, 'payment history is sorted newest-first');

/* --- normalizeSupplierPayables: the payments ledger lowers payable even when
   the purchase mutation was dropped by the sync merge (same-updatedAt clash).
   Must be idempotent and never REDUCE a recorded paid (legacy safety). --- */
state = {
  suppliers: [{ id: 's1', name: 'Sun Market', createdAt: '2026-08-01T08:00:00Z' }],
  purchases: [],
  payments: [],
  customers: [], customerPayments: [], sales: [], production: [], prices: [], inventoryMovements: [], inventory: {},
  expenses: [], recurringExpenses: [], waste: [], priceHistory: [], recipes: [],
  cash: { opening: 0, adjustments: [] }, entries: {}, draft: null, updatedAt: null, stock: { pieces: 0, cost: 0 },
  settings: { hourlyWage: 1500 }, inventoryMovementVersion: 1
};
state.purchases.push({ id: 'pu1', supplierId: 's1', date: '2026-09-01', items: [{ name: 'Flour', qty: 20 }], itemTotal: 10000, paidNow: 0, paid: 0 });
state.payments.push({ id: 'pay1', supplierId: 's1', date: '2026-09-02', amount: 4000, createdAt: '2026-09-02T10:00:00Z' });
normalizeSupplierPayables();
ok(state.purchases[0].paid === 4000, 'payments ledger lifts the dropped purchase mutation (paid 0 -> 4000)');
ok(totalPayable() === 6000, 'Total Payable drops to 6000 after normalizeSupplierPayables (got ' + totalPayable() + ')');
const paidSnapshot = JSON.stringify(state.purchases);
normalizeSupplierPayables();
ok(JSON.stringify(state.purchases) === paidSnapshot, 'normalizeSupplierPayables is idempotent');
state.purchases[0].paid = 5000;
normalizeSupplierPayables();
ok(state.purchases[0].paid === 5000, 'never reduces a recorded paid below the ledger (legacy safety)');
state.purchases[0].paid = 0;
state.payments = [];
normalizeSupplierPayables();
ok(state.purchases[0].paid === 0, 'no payments -> no forced allocation');
// Oldest-first allocation across two purchases, with a partial payment.
state.purchases[0].paid = 0;
state.purchases[0].date = '2026-09-05';      // pu1 is the NEWER (bigger) purchase
state.purchases.push({ id: 'pu2', supplierId: 's1', date: '2026-09-01', items: [{ name: 'Sugar', qty: 10 }], itemTotal: 1000, paidNow: 0, paid: 0 });
state.payments = [{ id: 'pay2', supplierId: 's1', date: '2026-09-06', amount: 1500, createdAt: '2026-09-06T10:00:00Z' }];
normalizeSupplierPayables();
ok(state.purchases[0].paid === 500 && state.purchases[1].paid === 1000,
  'oldest-first allocation: older 1000 purchase settled fully, remainder 500 to newer (got ' + state.purchases[0].paid + ',' + state.purchases[1].paid + ')');
ok(totalPayable() === 9500, 'Total Payable reflects oldest-first allocation (got ' + totalPayable() + ')');

console.log(fail === 0 ? 'ALL SUPPLIER TIMESTAMP CHECKS PASSED' : (fail + ' FAILED'));
`;

const src = read('config.js') + '\n' + read('helpers.js') + '\n' + read('suppliers.js') + '\n' + TEST_BODY;
eval(src);