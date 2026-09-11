/* Node harness for js/moneyout.js (pure money-out aggregator).
   Verifies per-day grouping, categories, the "why" labels, legacy
   expense handling, deletable flags, and per-month totals. */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(
  path.join('d:\\wafer\\Wafer_documentary\\dail-ledger v1.7\\js', 'moneyout.js'),
  'utf8');

function prod(id, date, capital, laborMinutes, laborCost, bags, pieces, notes) {
  return { id: id, date: date, capital: capital, laborMinutes: laborMinutes, laborCost: laborCost, bags: bags, pieces: pieces, notes: notes };
}

const state = {
  suppliers: [ { id: 's1', name: 'Aung Shop' } ],
  production: [
    prod('p1', '2026-09-08', 50000, 120, 3000, 12, 72, 'eggs were pricey'),
    prod('p2', '2026-09-07', 40000, 60, 1500, 10, 60, ''),
    prod('p3', '2026-09-08', 0, 0, 0, 0, 0, '')
  ],
  purchases: [
    { id: 'b1', supplierId: 's1', date: '2026-09-08', items: [ { name: 'Flour' }, { name: 'Oil' } ], itemTotal: 80000, paidNow: 50000, paid: 0, note: '' }
  ],
  payments: [
    { id: 'w1', supplierId: 's1', date: '2026-09-08', amount: 20000 }
  ],
  expenses: [
    { id: 'e1', date: '2026-09-08', amount: 15000, desc: 'New fryer screen', category: 'Equipment' },
    { date: '2026-09-08', amount: 7000, desc: 'Legacy expense, no id' }
  ],
  cash: { opening: 0, adjustments: [
    { id: 'c1', date: '2026-09-08', amount: -10000, label: 'Owner draw' },
    { id: 'c2', date: '2026-09-08', amount: 5000, label: 'Loan in' }
  ] }
};

const sandbox = { state: state, console: console };
vm.createContext(sandbox);
vm.runInContext(src, sandbox);

const moneyOutForDay = sandbox.moneyOutForDay;
const moneyOutForMonth = sandbox.moneyOutForMonth;

let pass = 0, fail = 0;
function ok(cond, msg) {
  if (cond) { pass++; console.log('PASS ' + msg); }
  else { fail++; console.log('FAIL ' + msg); }
}

const d = moneyOutForDay('2026-09-08');

ok(d.total === 155000, 'day total = 155,000 (production 50k + labor 3k + purchase 50k + payment 20k + expenses 22k + cash-out 10k)');
ok(d.rows.length === 7, '7 outgoing rows for the day (legacy expense included)');
ok(d.byCategory.production === 50000, 'category production = 50,000');
ok(d.byCategory.labor === 3000, 'category labor = 3,000');
ok(d.byCategory.purchase === 50000, 'category purchase = 50,000');
ok(d.byCategory.payment === 20000, 'category payment = 20,000');
ok(d.byCategory.expense === 22000, 'category expense = 22,000 (id + legacy)');
ok(d.byCategory.cashout === 10000, 'category cash-out = 10,000 (positive adjustment excluded)');

const prodRow = d.rows.find(function (r) { return r.type === 'production'; });
ok(!!prodRow && prodRow.label.indexOf('12 bags') > -1 && prodRow.label.indexOf('72 pcs') > -1, 'production row shows the batch size as the why');
ok(!!prodRow && prodRow.detail === 'eggs were pricey', 'production row carries the batch note as detail');

const expIdRow = d.rows.find(function (r) { return r.id === 'expense-e1'; });
ok(!!expIdRow && expIdRow.deletable === true, 'expense with id is deletable');

const expLegacyRow = d.rows.find(function (r) { return r.id.indexOf('legacy') > -1; });
ok(!!expLegacyRow && expLegacyRow.deletable === false, 'legacy expense (no id) is counted but not deletable');

const cashOutRow = d.rows.find(function (r) { return r.type === 'cashout'; });
ok(!!cashOutRow && cashOutRow.amount === 10000 && cashOutRow.deletable, 'negative cash adjustment = deletable 10,000 cash-out row');

const purchaseRow = d.rows.find(function (r) { return r.type === 'purchase'; });
ok(!!purchaseRow && purchaseRow.label.indexOf('Aung Shop') > -1 && purchaseRow.detail === 'Flour, Oil', 'purchase row names the shop and the items bought');

const laborRow = d.rows.find(function (r) { return r.type === 'labor'; });
ok(!!laborRow && laborRow.label.indexOf('2 hrs') > -1, 'labor row shows 2 hrs as the why');

ok(d.rows[0].type === 'production', 'rows sorted in category order (production first)');

const m = moneyOutForMonth('2026-09');
ok(m.total === 196500, 'month total = 196,500 (includes the 7th-day batch too)');
ok(m.byCategory.production === 90000 && m.byCategory.labor === 4500, 'month production & labor categories sum both days');

const empty = moneyOutForDay('2026-01-01');
ok(empty.rows.length === 0 && empty.total === 0, 'a day with no activity yields zero rows');

console.log('');
console.log(fail === 0 ? 'ALL MONEY-OUT CHECKS PASSED' : (fail + ' FAILED'));
process.exit(fail === 0 ? 0 : 1);
