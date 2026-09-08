/* ============================================================
   MONEY OUT — every outward cash item for a given day, combined
   across production (materials + labor), stock purchases paid,
   supplier payments, one-time expenses and cash-out adjustments.
   This module is PURE domain logic (no DOM access) so it can be
   unit-tested in Node and reused by both the Dashboard card and
   the Cash-tab panel.
   ============================================================ */

/* Category registry. Keys are stable identifiers stored on the row;
   order here is the display order. `chip` is a small Tailwind badge,
   `color` a text colour. */
var MONEY_OUT_TYPES = {
  production: { key: 'production', label: 'Ingredients & Materials', color: 'text-amber-400', chip: 'bg-amber-500/15 border-amber-500/40 text-amber-300' },
  labor:      { key: 'labor',      label: 'Labor',                  color: 'text-sky-400',    chip: 'bg-sky-500/15 border-sky-500/40 text-sky-300' },
  purchase:   { key: 'purchase',   label: 'Stock Purchase',         color: 'text-orange-400', chip: 'bg-orange-500/15 border-orange-500/40 text-orange-300' },
  payment:    { key: 'payment',    label: 'Supplier Payment',       color: 'text-red-400',    chip: 'bg-red-500/15 border-red-500/40 text-red-300' },
  expense:    { key: 'expense',    label: 'One-Time Expense',       color: 'text-purple-400', chip: 'bg-purple-500/15 border-purple-500/40 text-purple-300' },
  cashout:    { key: 'cashout',    label: 'Owner Draw / Cash Out',  color: 'text-gray-300',   chip: 'bg-gray-500/15 border-gray-500/40 text-gray-300' }
};

/* Categories offered on the One-Time Expenses form. Stored on each expense. */
var EXPENSE_CATEGORIES = [
  'Equipment', 'Transport', 'Rent & Bills', 'Packaging',
  'Raw Materials', 'Fuel & Energy', 'Marketing', 'Other'
];

function moneyOutType(key) {
  return MONEY_OUT_TYPES[key] || MONEY_OUT_TYPES.cashout;
}

/* Resolve a supplier id to its name (defined in suppliers.js in the browser). */
function supplierNameMoneyOut(id) {
  var s = (state.suppliers || []).find(function (x) { return x.id === id; });
  return s ? s.name : 'Unknown shop';
}

/* All outward items dated on `dateStr` (ISO yyyy-mm-dd). Returns
   { rows: [...], total, byCategory: { typeKey: amount } }.
   Each row: { id, type, date, amount, label (the "why"), detail, deletable, ref }. */
function moneyOutForDay(dateStr) {
  var rows = [];

  // 1) Production: ingredient/materials capital + labor wages.
  (state.production || []).forEach(function (p) {
    if (p.date !== dateStr) return;
    if ((p.capital || 0) > 0) {
      rows.push({
        id: 'prod-' + p.id,
        type: 'production', date: p.date, amount: (p.capital || 0),
        label: 'Batch materials (' + (p.bags || 0) + ' bags · ' + (p.pieces || 0) + ' pcs)',
        detail: p.notes || 'Rolled batch ingredients & extra cost',
        deletable: false, ref: p
      });
    }
    if ((p.laborCost || 0) > 0) {
      var hrs = (p.laborMinutes || 0) / 60;
      rows.push({
        id: 'labor-' + p.id,
        type: 'labor', date: p.date, amount: (p.laborCost || 0),
        label: 'Labor wages (' + (Math.round(hrs * 10) / 10) + ' hrs)',
        detail: p.notes || 'Production labor',
        deletable: false, ref: p
      });
    }
  });

  // 2) Stock purchases: only the portion actually PAID on purchase day.
  (state.purchases || []).forEach(function (pr) {
    if (pr.date !== dateStr) return;
    var paid = (pr.paidNow || 0);
    if (paid <= 0) return;
    var names = (pr.items || []).map(function (it) { return it.name; }).join(', ');
    rows.push({
      id: 'purchase-' + pr.id,
      type: 'purchase', date: pr.date, amount: paid,
      label: 'Stock purchase — ' + supplierNameMoneyOut(pr.supplierId),
      detail: names || (pr.note || 'Inventory purchase, paid on delivery'),
      deletable: false, ref: pr
    });
  });

  // 3) Supplier payments (settling shop credit).
  (state.payments || []).forEach(function (pm) {
    if (pm.date !== dateStr) return;
    rows.push({
      id: 'payment-' + pm.id,
      type: 'payment', date: pm.date, amount: (pm.amount || 0),
      label: 'Payment to ' + supplierNameMoneyOut(pm.supplierId),
      detail: 'Settles shop credit',
      deletable: false, ref: pm
    });
  });

  // 4) One-time expenses.
  (state.expenses || []).forEach(function (e) {
    if ((e.date || '') !== dateStr) return;
    rows.push({
      id: 'expense-' + (e.id || 'legacy-' + e.date + '-' + (e.amount || 0)),
      type: 'expense', date: e.date, amount: (e.amount || 0),
      label: (e.category || 'Other') + ' expense',
      detail: e.desc || 'One-time expense',
      deletable: !!e.id, ref: e
    });
  });

  // 5) Cash-out adjustments (negative cash adjustments = money out).
  ((state.cash && state.cash.adjustments) || []).forEach(function (a) {
    if (a.date !== dateStr || (a.amount || 0) >= 0) return;
    rows.push({
      id: 'cashout-' + a.id,
      type: 'cashout', date: a.date, amount: Math.abs(a.amount),
      label: 'Owner draw / cash out',
      detail: a.label || 'Cash removed from drawer',
      deletable: true, ref: a
    });
  });

  var byCategory = {};
  var total = 0;
  rows.forEach(function (r) {
    byCategory[r.type] = (byCategory[r.type] || 0) + r.amount;
    total += r.amount;
  });
  var order = Object.keys(MONEY_OUT_TYPES);
  rows.sort(function (a, b) {
    var oa = order.indexOf(a.type), ob = order.indexOf(b.type);
    if (oa !== ob) return oa - ob;
    return (b.amount || 0) - (a.amount || 0);
  });

  return { rows: rows, total: total, byCategory: byCategory };
}

/* Total money out for a whole month (ISO yyyy-mm), used by reports. */
function moneyOutForMonth(monthStr) {
  var total = 0;
  var byCategory = {};
  ['production', 'labor', 'purchase', 'payment', 'expense', 'cashout'].forEach(function (k) {
    byCategory[k] = 0;
  });
  (state.production || []).forEach(function (p) {
    if ((p.date || '').slice(0, 7) !== monthStr) return;
    byCategory.production += (p.capital || 0);
    byCategory.labor += (p.laborCost || 0);
  });
  (state.purchases || []).forEach(function (pr) {
    if ((pr.date || '').slice(0, 7) !== monthStr) return;
    byCategory.purchase += (pr.paidNow || 0);
  });
  (state.payments || []).forEach(function (pm) {
    if ((pm.date || '').slice(0, 7) !== monthStr) return;
    byCategory.payment += (pm.amount || 0);
  });
  (state.expenses || []).forEach(function (e) {
    if ((e.date || '').slice(0, 7) !== monthStr) return;
    byCategory.expense += (e.amount || 0);
  });
  ((state.cash && state.cash.adjustments) || []).forEach(function (a) {
    if ((a.date || '').slice(0, 7) !== monthStr || (a.amount || 0) >= 0) return;
    byCategory.cashout += Math.abs(a.amount);
  });
  Object.keys(byCategory).forEach(function (k) { total += byCategory[k]; });
  return { total: total, byCategory: byCategory };
}