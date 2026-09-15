/* Node harness for the new electricity-tier billing + supplier payment cap.
   - electricityBillParts: (T/4 × 50) + (T/4 × 100) + (T/4 × 150) + (T/4 × 300)
   - ingredientCostSingle / ingredientCostFor use the tiered formula for Electricity
   - applySupplierPayment never books more than the shop is actually owed */
const fs = require('fs');
const path = require('path');
const dir = 'd:\\wafer\\Wafer_documentary\\dail-ledger v1.8\\js';
const read = (f) => fs.readFileSync(path.join(dir, f), 'utf8');

global.window = global;
global.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
global.document = {
  body: { classList: { add() {}, remove() {}, contains() { return false; }, toggle() {} } },
  getElementById: () => ({ classList: { add() {}, remove() {}, contains() { return false; } }, appendChild() {}, remove() {}, setAttribute() {}, addEventListener() {}, querySelectorAll: () => [], innerHTML: '', textContent: '', value: '' }),
  querySelectorAll: () => [],
  createElement: () => ({ classList: { add() {}, remove() {} }, querySelectorAll: () => [], addEventListener() {}, appendChild() {}, innerHTML: '' }),
  addEventListener() {}
};
global.showToast = () => {};
global.lucide = { createIcons() {} };
global.uid = () => 'uid-' + Math.random().toString(36).slice(2, 9);

const TEST_BODY = `
let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) { pass++; console.log('PASS ' + msg); } else { fail++; console.log('FAIL ' + msg); } }
const eq = (a, b) => Math.abs(a - b) < 0.001;

/* ---------- 1) Electricity tiered bill formula ---------- */
const b62 = electricityBillParts(62);
ok(eq(b62.quarter, 15.5), '62 units / 4 = 15.5 units per quarter');
ok(eq(b62.parts[0], 775) && eq(b62.parts[1], 1550) && eq(b62.parts[2], 2325) && eq(b62.parts[3], 4650),
   'quarters billed at 50/100/150/300 -> 775+1550+2325+4650');
ok(eq(b62.total, 9300), '62-unit bill = 9,300 Ks (got ' + b62.total + ')');
ok(eq(electricityBillParts(0).total, 0), '0 units = 0 Ks');
ok(eq(electricityBillParts(4).total, 600), 'one 4-unit batch = 600 Ks (got ' + electricityBillParts(4).total + ')');

/* ---------- 2) Ingredient cost (electricity special-cased everywhere) ---------- */
state = {
  prices: [
    { name: 'Flour', unit: 'g', price: 4600 },
    { name: 'Egg', unit: 'unit', price: 300 },
    { name: 'Electricity', unit: 'unit', price: 150 },
    { name: 'Packaging', unit: 'unit', price: 4 }
  ],
  purchases: [], payments: [], suppliers: [], production: [], customers: [], customerPayments: [],
  sales: [], inventoryMovements: [], inventory: {}, expenses: [], recurringExpenses: [], waste: [],
  priceHistory: [], recipes: [], cash: { opening: 0, adjustments: [] }, entries: {}, draft: null,
  updatedAt: null, stock: { pieces: 0, cost: 0 }, settings: { hourlyWage: 1500 }, inventoryMovementVersion: 1
};
ok(eq(ingredientCostSingle(state.prices[2], 4), 600), 'Electricity 4 units = 600 Ks (tiered) — not 4×150');
ok(eq(ingredientCostFor({ Flour: 100, Egg: 2, Electricity: 4, Packaging: 82 }), 460 + 600 + 600 + 328),
   'ingredientCostFor = 460(flour)+600(eggs)+600(electric tiered)+328(packaging) = ' + ingredientCostFor({ Flour: 100, Egg: 2, Electricity: 4, Packaging: 82 }));
ok(eq(ingredientCostFor({ Electricity: 62 }), 9300), '62 electricity units through production cost = 9,300 Ks');

/* ---------- 3) Supplier payment can never exceed what is owed ---------- */
function freshState() {
  return {
    suppliers: [{ id: 's1', name: 'Sun Market' }],
    purchases: [
      { id: 'p1', supplierId: 's1', date: '2026-09-01', itemTotal: 10000, paidNow: 0, paid: 0 }
    ],
    payments: [],
    customers: [], customerPayments: [], sales: [], production: [], prices: state.prices,
    inventoryMovements: [], inventory: {}, expenses: [], recurringExpenses: [], waste: [],
    priceHistory: [], recipes: [], cash: { opening: 0, adjustments: [] }, entries: {}, draft: null,
    updatedAt: null, stock: { pieces: 0, cost: 0 }, settings: { hourlyWage: 1500 }, inventoryMovementVersion: 1
  };
}

state = freshState();
const owed0 = supplierBalance('s1');
ok(eq(owed0, 10000), 'initially owed 10,000');
const appliedBig = applySupplierPayment('s1', 15000);   // tries to overpay 15,000
ok(eq(appliedBig, 10000), 'overpayment of 15,000 is capped to the 10,000 owed (got ' + appliedBig + ')');
ok(eq(state.purchases[0].paid, 10000), 'purchase paid lifted by exactly the capped amount');
ok(eq(supplierBalance('s1'), 0) && eq(totalPayable(), 0), 'payable is 0 — nothing overcounted');

state = freshState();
const appliedFracc = applySupplierPayment('s1', 10000.6);  // fractional overpay
ok(eq(appliedFracc, 10000), '10000.6 payment capped to 10000 (never rounds UP past the debt: got ' + appliedFracc + ')');
ok(eq(state.purchases[0].paid, 10000), 'fractional excess is not booked');

/* FIFO across two purchases, partial payment */
state = freshState();
state.purchases[0].date = '2026-09-05';                    // p1 is the NEWER purchase
state.purchases[0].itemTotal = 6000;
state.purchases.push({ id: 'p2', supplierId: 's1', date: '2026-09-01', itemTotal: 4000, paidNow: 0, paid: 0 });
const appliedFifo = applySupplierPayment('s1', 5000);
ok(eq(appliedFifo, 5000), '5,000 payment applied in full');
ok(eq(state.purchases.find(p => p.id === 'p2').paid, 4000) && eq(state.purchases.find(p => p.id === 'p1').paid, 1000),
   'oldest purchase settled fully first (old 4000 -> 4000, newer 6000 -> 1000)');
ok(eq(supplierBalance('s1'), 5000), 'remaining balance 5,000');

/* No debt -> payment is refused */
state = freshState();
applySupplierPayment('s1', 10000);
const appliedNone = applySupplierPayment('s1', 5000);
ok(eq(appliedNone, 0), 'paying a fully-settled shop books 0 (got ' + appliedNone + ')');

/* normalizeSupplierPayables stays idempotent with capped payments */
state = freshState();
state.payments.push({ id: 'pay1', supplierId: 's1', date: '2026-09-02', amount: applySupplierPayment('s1', 10000.35) });
normalizeSupplierPayables();
ok(eq(state.purchases[0].paid, 10000), 'normalize keeps the capped paid (10,000)');
const snap = JSON.stringify(state.purchases);
normalizeSupplierPayables();
ok(JSON.stringify(state.purchases) === snap, 'normalizeSupplierPayables is idempotent with capped payments');

/* ---------- 3b) Supplier-purchase line cost: electricity can never overcharge ---------- */
const electIng = { name: 'Electricity', unit: 'unit', price: 250 };
const flourIng = { name: 'Flour', unit: 'g', price: 4600 };
const eggIng = { name: 'Egg', unit: 'unit', price: 300 };
ok(eq(purchaseLineAmount(electIng, 4, 250), 600), '4 electricity units in a supplier purchase = 600 Ks tiered (was 1,000 — the overcharge)');
ok(eq(purchaseLineAmount(electIng, 1, 250), 150), '1 electricity unit = 150 Ks (was 250 — exactly 100 more than the real cost)');
ok(eq(purchaseLineAmount(electIng, 0.5, 250), 75), 'half a unit = 75 Ks (was 125 — exactly 50 more than the real cost)');
ok(eq(purchaseLineAmount(flourIng, 10000, 4600), 46000), 'gram item still uses the typed per-kg price: 10kg flour @4600 = 46,000');
ok(eq(purchaseLineAmount(eggIng, 30, 300), 9000), 'unit item still uses the typed per-unit price: 30 eggs @300 = 9,000');
ok(eq(toMoney(99999.6), 99999.6), 'purchase itemTotal is kept at 2 decimals — never rounded UP to 100,000');

console.log(fail === 0 ? 'ALL ELECTRICITY + SUPPLIER PAYMENT CHECKS PASSED' : (fail + ' FAILED'));
`;

const src = read('config.js') + '\n' + read('helpers.js') + '\n' + read('suppliers.js') + '\n' + TEST_BODY;
eval(src);

/* ---------- 4) Tools renderers smoke test (DOM stubs) ---------- */
const TEST_BODY2 = `
let pass2 = 0, fail2 = 0;
function ok2(cond, msg) { if (cond) { pass2++; console.log('PASS ' + msg); } else { fail2++; console.log('FAIL ' + msg); } }

state = {
  prices: [
    { name: 'Flour', unit: 'g', price: 4600 },
    { name: 'Egg', unit: 'unit', price: 300 },
    { name: 'Electricity', unit: 'unit', price: 150 },
    { name: 'Water', unit: 'g', price: 0, stock: false }
  ],
  production: [
    { id: 'pr1', date: '2026-09-12', bags: 16, pieces: 96, createdAt: '2026-09-12T07:45:00Z',
      usage: { Flour: 100, Egg: 2, Electricity: 4, Water: 580 } },
    { id: 'pr0', date: '2026-09-10', bags: 32, pieces: 192, createdAt: '2026-09-10T06:10:00Z',
      usage: { Flour: 200, Egg: 4, Electricity: 8, Water: 580 } }
  ],
  suppliers: [], purchases: [], payments: [], customers: [], customerPayments: [], sales: [],
  inventoryMovements: [], inventory: {}, expenses: [], recurringExpenses: [], waste: [],
  priceHistory: [], recipes: [], cash: { opening: 0, adjustments: [] }, entries: {}, draft: null,
  updatedAt: null, stock: { pieces: 0, cost: 0 }, settings: { hourlyWage: 1500 }, inventoryMovementVersion: 1
};

const icEl = { innerHTML: '' };
document.getElementById = (id) => (id === 'ingredientCostList' ? icEl : (id === 'electricityBillUnits' ? { value: '62' } : (id === 'electricityBillResult' ? ebEl : { addEventListener() {}, innerHTML: '', textContent: '', value: '' })));
const ebEl = { innerHTML: '' };

renderIngredientCosts();
ok2(/Flour/.test(icEl.innerHTML) && /Electricity/.test(icEl.innerHTML), 'ingredient cost card lists each ingredient');
ok2(/Sep 12/.test(icEl.innerHTML), 'per-batch detail shows the logged date & time');
ok2(/pr1/.test(icEl.innerHTML) === false, 'detail is grouped per batch, not per production id printed');
// Electricity total across both batches: 4 + 8 = 12 units -> 12*150 = 1800 Ks tiered.
ok2(icEl.innerHTML.indexOf('1,800') > -1, 'electricity grand total uses the tiered 50/100/150/300 rate (1,800 Ks for 12 units)');
ok2(icEl.innerHTML.indexOf('tiered 50/100/150/300') > -1, 'electricity rows are labelled as tiered');

renderElectricityBill();
ok2(/9,300/.test(ebEl.innerHTML), 'electricity bill card shows 62 units -> 9,300 Ks');
ok2(/15.5/.test(ebEl.innerHTML), 'electricity bill card shows 15.5 units per quarter');

console.log(fail2 === 0 ? 'ALL TOOLS RENDER SMOKE CHECKS PASSED' : (fail2 + ' FAILED'));
`;
const src2 = read('config.js') + '\n' + read('helpers.js') + '\n' + read('tools.js') + '\n' + TEST_BODY2;
eval(src2);