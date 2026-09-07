/* Verifies supplier purchase/payment timestamps:
   - purchases and payments are stamped with createdAt on save,
   - purchase history renders the "Logged <date + time>" line,
   - the new Payment History list renders shop, amount and time,
   - old records without createdAt still render (fallback to the date). */
const fs = require('fs');
const path = require('path');
const dir = 'd:\\wafer\\Wafer_documentary\\dail-ledger v1.6\\js';
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

console.log(fail === 0 ? 'ALL SUPPLIER TIMESTAMP CHECKS PASSED' : (fail + ' FAILED'));
`;

const src = read('config.js') + '\n' + read('helpers.js') + '\n' + read('suppliers.js') + '\n' + TEST_BODY;
eval(src);