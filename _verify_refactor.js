/* Verify the refactored logic (mirrors the implementation). */
function toFinite(value, fallback) { const n = Number(value); return Number.isFinite(n) ? n : (fallback === undefined ? 0 : fallback); }
function toMoney(value) { return Math.round(toFinite(value) * 100) / 100; }
function uniqueByKey(listA, listB, keyOf) { const map = new Map(); (listA || []).concat(listB || []).forEach(function (i) { if (i == null) return; map.set(keyOf(i), i); }); return Array.from(map.values()); }
function saleCreditAmount(sale) { return Math.max(0, (sale.amount || 0) - (sale.paidAmount === undefined ? (sale.amount || 0) : sale.paidAmount)); }

function normalizeCustomerBalances(state) {
  state.customers = state.customers || [];
  const ledger = {};
  state.customers.forEach(function (customer) { ledger[customer.id] = 0; });
  (state.sales || []).forEach(function (sale) {
    if (!sale || !sale.customerId || !(sale.customerId in ledger)) return;
    ledger[sale.customerId] += toMoney(saleCreditAmount(sale));
  });
  (state.customerPayments || []).forEach(function (payment) {
    if (!payment || !payment.customerId || !(payment.customerId in ledger)) return;
    ledger[payment.customerId] -= Math.abs(toMoney(payment.amount));
  });
  state.customers.forEach(function (customer) {
    const realLedger = toMoney(ledger[customer.id] || 0);
    if (customer.extraDebt === undefined) {
      customer.extraDebt = Math.max(0, toMoney(toMoney(customer.debt) - realLedger));
    }
    customer.debt = Math.max(0, toMoney(toMoney(customer.extraDebt) + realLedger));
  });
  return state;
}
function mergeMovements(local, remote) {
  return uniqueByKey(local, remote, function (m) { return m && m.id ? m.id : [m.ingredientName, m.date, m.qty, m.type].join('|'); });
}

console.log('== 1) customer debt: manual+credit-payments ==');
let s = { customers: [{ id: 'c1', debt: 5000, extraDebt: undefined }], sales: [{ customerId: 'c1', amount: 13000, paidAmount: 3000 }], customerPayments: [{ customerId: 'c1', amount: 2000 }] };
normalizeCustomerBalances(s);
console.log('debt:', s.customers[0].debt, '(expect 8000)');
s.customers[0].extraDebt = 3000;
s.customerPayments.push({ customerId: 'c1', amount: 5000 });
normalizeCustomerBalances(s);
console.log('debt:', s.customers[0].debt, '(expect 6000)');

console.log('== 2) merge dedupe ==');
const merged = mergeMovements([{ id: 'm1', ingredientName: 'Flour' }, { id: 'm2', ingredientName: 'Egg' }], [{ id: 'm1', ingredientName: 'Flour' }]);
console.log('count:', merged.length, '(expect 2)');

console.log('== 3) draftHasRealContent ==');
function draftHasRealContent(d) {
  if (!d) return false;
  const usage = d.usage || {};
  const anyUsage = Object.keys(usage).some(function (k) { return toFinite(usage[k]) > 0; });
  return anyUsage || toFinite(d.bagsProduced) > 0 || toFinite(d.pieces) > 0 || toFinite(d.laborMinutes) > 0 || toFinite(d.additionalCost) > 0 || String(d.notes || '').trim() !== '';
}
console.log('empty draft:', draftHasRealContent({ usage: { Flour: 0 }, bagsProduced: 0 }), '(expect false)');
console.log('real draft:', draftHasRealContent({ usage: { Flour: 100 }, pieces: 200 }), '(expect true)');

console.log('== 4) toMoney/toFinite/clamp guards ==');
console.log('toMoney("12.345")=', toMoney('12.345'), ' toFinite(null)=', toFinite(null), ' toFinite(undefined,1300)=', toFinite(undefined, 1300));

console.log('ALL CHECKS DONE');
