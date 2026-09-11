/* ============================================================
   CASH DRAWER / CASH FLOW
   Tracks the running cash position:
     opening + cash-in (sales + customer payments + adjustments)
     - cash-out (purchases paid, supplier payments, one-time
       expenses, labor, withdrawals) = cash on hand.
   Note: sales are treated as cash unless a customer has an
   open receivable, tracked separately in the Customers tab.
   Set the opening balance once when you start.
   ============================================================ */

function cashOpening() {
  var cab = state.cash || {};
  return parseFloat(cab.opening) || 0;
}

function cashAdjustments() {
  return (state.cash && state.cash.adjustments) || [];
}

function addCashAdjustment(amount, label) {
  if (isNaN(amount) || amount === 0) { showToast('Enter a valid non-zero amount.', 'error'); return; }
  if (!label) { showToast('Add a short description (e.g. petrol, draw, deposit).', 'error'); return; }
  if (!state.cash) state.cash = { opening: 0, adjustments: [] };
  if (!Array.isArray(state.cash.adjustments)) state.cash.adjustments = [];
  state.cash.adjustments.push({ id: uid(), date: today(), amount: amount, label: label, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  saveState();
  renderCash();
  showToast(amount > 0 ? 'Cash added to drawer.' : 'Cash removed from drawer.');
}

function removeCashAdjustment(id) {
  if (!confirm('Delete this cash adjustment?')) return;
  if (!state.cash) return;
  state.cash.adjustments = (state.cash.adjustments || []).filter(function (a) { return a.id !== id; });
  if (typeof markDeleted === 'function') markDeleted('cashAdjustments', id);
  saveState();
  renderCash();
}

function financeTotals() {
  // Revenue can be on credit. Only money actually received at the sale belongs
  // in the cash drawer; customer repayments are counted separately below.
  var sales = (state.sales || []).reduce(function (s, x) {
    return s + (x.paidAmount === undefined ? (x.amount || 0) : (x.paidAmount || 0));
  }, 0);
  var customerPay = (state.customerPayments || []).reduce(function (s, p) { return s + (p.amount || 0); }, 0);
  var adjustIn = cashAdjustments().reduce(function (s, a) { return s + (a.amount > 0 ? a.amount : 0); }, 0);
  var cashIn = sales + customerPay + adjustIn;

  var purchasesPaid = (state.purchases || []).reduce(function (s, p) { return s + ((p.paidNow || 0) + (p.paid || 0)); }, 0);
  var supplierPay = (state.payments || []).reduce(function (s, p) { return s + (p.amount || 0); }, 0);
  var oneTime = (state.expenses || []).reduce(function (s, e) { return s + (e.amount || 0); }, 0);
  var labor = (state.production || []).reduce(function (s, p) { return s + (p.laborCost || 0); }, 0);
  var adjustOut = cashAdjustments().reduce(function (s, a) { return s + (a.amount < 0 ? Math.abs(a.amount) : 0); }, 0);
  var cashOut = purchasesPaid + supplierPay + oneTime + labor + adjustOut;

  var opening = cashOpening();
  var netChange = cashIn - cashOut;
  return {
    opening: opening, sales: sales, customerPay: customerPay, adjustIn: adjustIn,
    purchasesPaid: purchasesPaid, supplierPay: supplierPay, oneTime: oneTime,
    labor: labor, adjustOut: adjustOut, cashIn: cashIn, cashOut: cashOut,
    netChange: netChange, closing: opening + netChange
  };
}

function renderCash() {
  var t = financeTotals();
  var recv = (typeof totalReceivable === 'function') ? totalReceivable() : 0;

  if ($('cashOpening')) $('cashOpening').value = Math.round(cashOpening());
  if ($('cashCurrent')) { $('cashCurrent').textContent = fmtKs(t.closing); $('cashCurrent').className = 'text-2xl font-extrabold ' + (t.closing >= 0 ? 'text-emerald-400' : 'text-red-400'); }
  if ($('cashIn')) $('cashIn').textContent = fmtKs(t.cashIn);
  if ($('cashOut')) $('cashOut').textContent = fmtKs(t.cashOut);
  if ($('cashNetChange')) $('cashNetChange').textContent = fmtKs(t.netChange);
  if ($('cashReceivable')) $('cashReceivable').textContent = fmtKs(recv);

  var inList = $('cashInList');
  if (inList) {
    inList.innerHTML =
      '<div class="flex justify-between py-1 border-b border-gray-700"><span>Sales paid now</span><span class="text-emerald-400 font-semibold">' + fmtKs(t.sales) + '</span></div>' +
      '<div class="flex justify-between py-1 border-b border-gray-700"><span>Customer payments received</span><span class="text-emerald-400 font-semibold">' + fmtKs(t.customerPay) + '</span></div>' +
      '<div class="flex justify-between py-1 border-b border-gray-700"><span>Cash-in adjustments</span><span class="text-emerald-400 font-semibold">' + fmtKs(t.adjustIn) + '</span></div>' +
      '<div class="flex justify-between py-1 font-bold"><span>Total cash in</span><span class="text-emerald-400">' + fmtKs(t.cashIn) + '</span></div>';
  }
  var outList = $('cashOutList');
  if (outList) {
    outList.innerHTML =
      '<div class="flex justify-between py-1 border-b border-gray-700"><span>Stock purchases paid</span><span class="text-red-400 font-semibold">' + fmtKs(t.purchasesPaid) + '</span></div>' +
      '<div class="flex justify-between py-1 border-b border-gray-700"><span>Supplier payments</span><span class="text-red-400 font-semibold">' + fmtKs(t.supplierPay) + '</span></div>' +
      '<div class="flex justify-between py-1 border-b border-gray-700"><span>One-time expenses</span><span class="text-red-400 font-semibold">' + fmtKs(t.oneTime) + '</span></div>' +
      '<div class="flex justify-between py-1 border-b border-gray-700"><span>Labor paid</span><span class="text-red-400 font-semibold">' + fmtKs(t.labor) + '</span></div>' +
      '<div class="flex justify-between py-1 border-b border-gray-700"><span>Cash-out adjustments</span><span class="text-red-400 font-semibold">' + fmtKs(t.adjustOut) + '</span></div>' +
      '<div class="flex justify-between py-1 font-bold"><span>Total cash out</span><span class="text-red-400">' + fmtKs(t.cashOut) + '</span></div>';
  }

  var list = $('cashAdjustList');
  if (list) {
    var adjust = cashAdjustments().slice().reverse();
    list.innerHTML = adjust.length ? adjust.map(function (a) {
      return '<div class="flex items-center justify-between gap-2 py-1.5 border-b border-gray-700 last:border-0">' +
        '<span class="truncate text-xs" title="' + esc(a.label) + '">' + esc(a.date) + ' · ' + esc(a.label) + '</span>' +
        '<span class="flex items-center gap-2 shrink-0"><span class="' + (a.amount >= 0 ? 'text-emerald-400' : 'text-red-400') + ' font-semibold">' + (a.amount >= 0 ? '+' : '-') + fmtKs(Math.abs(a.amount)) + '</span>' +
        '<button onclick="removeCashAdjustment(\'' + a.id + '\')" class="text-red-500 hover:text-red-400" title="Delete"><i data-lucide="trash-2" class="w-3.5 h-3.5"></i></button></span></div>';
    }).join('') : '<div class="text-gray-500">No manual adjustments yet.</div>';
    lucide.createIcons();
  }
  if ($('moneyOutDate') && !$('moneyOutDate').value) $('moneyOutDate').value = today();
  renderMoneyOutList({ listId: 'moneyOutList', totalEl: 'moneyOutTotal', chipsEl: 'moneyOutChips', date: moneyOutDateValue() });
  renderCashCount();
}

/* ---------- Daily Cash Count / Close (automated) ----------
   Expected cash today = today's PAID sales + today's customer payments, both of
   which are already tracked automatically when you log sales / repayments. This
   removes the need for a manual "post sales to drawer" step and gives a live
   expected-vs-counted variance for the daily close. */
function cashExpectedToday() {
  var d = today();
  var sales = (state.sales || []).reduce(function (s, x) {
    return x.date === d ? s + (x.paidAmount === undefined ? (x.amount || 0) : (x.paidAmount || 0)) : s;
  }, 0);
  var pay = (state.customerPayments || []).reduce(function (s, p) { return p.date === d ? s + (p.amount || 0) : s; }, 0);
  return sales + pay;
}
function renderCashCount() {
  var exp = cashExpectedToday();
  var expEl = $('cashExpectedToday');
  if (expEl) expEl.textContent = fmtKs(exp);
  var counted = parseFloat(($('cashCounted') || {}).value) || 0;
  var varEl = $('cashVariance');
  if (varEl) {
    var variance = counted - exp;
    varEl.textContent = (variance >= 0 ? '+' : '') + fmtKs(variance);
    varEl.className = 'font-extrabold text-lg ' + (Math.abs(variance) < 1 ? 'text-gray-400' : variance > 0 ? 'text-emerald-400' : 'text-red-400');
  }
}

$('cashOpening').addEventListener('change', function () {
  var v = parseFloat($('cashOpening').value);
  if (!state.cash) state.cash = { opening: 0, adjustments: [] };
  state.cash.opening = !isNaN(v) ? v : 0;
  saveState();
  renderCash();
  showToast('Opening cash balance saved.');
});

$('cashAdjustInBtn').addEventListener('click', function () {
  addCashAdjustment(Math.abs(parseFloat($('cashAdjustAmount').value) || 0), $('cashAdjustLabel').value.trim());
  $('cashAdjustAmount').value = '';
  $('cashAdjustLabel').value = '';
});
$('cashAdjustOutBtn').addEventListener('click', function () {
  addCashAdjustment(-Math.abs(parseFloat($('cashAdjustAmount').value) || 0), $('cashAdjustLabel').value.trim());
  $('cashAdjustAmount').value = '';
  $('cashAdjustLabel').value = '';
});

$('cashCounted').addEventListener('input', renderCashCount);
$('cashPostVarianceBtn').addEventListener('click', function () {
  var exp = cashExpectedToday();
  var counted = parseFloat($('cashCounted').value) || 0;
  var variance = Math.round(counted - exp);
  if (Math.abs(variance) < 1) { showToast('Counting matches expected — no adjustment needed.', 'info'); return; }
  addCashAdjustment(variance, 'Daily count variance (' + fmt(counted) + ' counted vs ' + fmt(exp) + ' expected)');
  $('cashCounted').value = '';
  renderCashCount();
  showToast('Variance ' + (variance > 0 ? '+' : '') + fmtKs(variance) + ' posted to the cash drawer.');
});

/* ---------- CashHooks API (hardware / external integration) ----------
   A tiny, stable interface so a barcode scanner, POS hardware hook, or a future
   hardware drawer plugin can record cash events without touching app internals:
     CashHooks.recordSale(amount, label)
     CashHooks.recordAdjustment(amount, label)
     CashHooks.expectedToday()
     CashHooks.close(counted)   → posts the variance as an adjustment
   */
window.CashHooks = {
  recordSale: function (amount, label) {
    addCashAdjustment(Math.round(amount) || 0, label || 'Sale (external POS)');
  },
  recordAdjustment: function (amount, label) {
    addCashAdjustment(Math.round(amount) || 0, label || 'Adjustment (external)');
  },
  expectedToday: function () { return cashExpectedToday(); },
  postVariance: function (counted) {
    var exp = cashExpectedToday();
    var variance = Math.round((parseFloat(counted) || 0) - exp);
    if (Math.abs(variance) >= 1) addCashAdjustment(variance, 'Daily count variance (external close)');
    return variance;
  }
};

/* ============================================================
   MONEY OUT PANEL — itemized, categorized day-spend view.

   Backed by moneyOutForDay()/moneyOutForMonth() in js/moneyout.js
   (pure, DOM-free logic); this file owns the DOM rendering. Every
   outward row shows its category badge, the reason ("why"), and
   its amount; expenses and cash-out adjustments can be deleted here
   (production/purchases/payments are managed on their own tabs).)
   ============================================================ */

function moneyOutDateValue() {
  var el = $('moneyOutDate');
  return (el && el.value) ? el.value : today();
}

function moneyOutRowHtml(r) {
  var t = moneyOutType(r.type);
  var refId = (r.deletable && r.ref && r.ref.id) ? String(r.ref.id).replace(/'/g, '').replace(/"/g, '') : '';
  var delBtn = refId ? '<button onclick="deleteMoneyOutRow(\'' + r.type + '\',\'' + refId + '\')" class="text-red-500 hover:text-red-400" title="Delete this item"><i data-lucide="trash-2" class="w-3.5 h-3.5"></i></button>' : '';
  return '<div class="flex items-start justify-between gap-2 py-1.5 border-b border-gray-700 last:border-0">' +
    '<div class="min-w-0">' +
      '<div class="flex items-center gap-1.5 flex-wrap"><span class="text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded border ' + t.chip + '">' + t.label + '</span>' +
      '<span class="text-xs font-semibold text-gray-200">' + esc(r.label) + '</span></div>' +
      (r.detail ? '<div class="text-[10px] text-gray-500 truncate" title="' + esc(r.detail) + '">' + esc(r.detail) + '</div>' : '') +
    '</div>' +
    '<div class="flex items-center gap-2 shrink-0"><span class="text-xs font-bold text-red-400">' + fmtKs(r.amount) + '</span>' + delBtn + '</div></div>';
}

/* Render one money-out list into a container.
   opts: { listId, totalEl?, chipsEl?, date?, maxRows?, emptyLabel? } */
function renderMoneyOutList(opts) {
  opts = opts || {};
  var el = $(opts.listId); if (!el) return;
  var dateStr = opts.date || today();
  var d = moneyOutForDay(dateStr);
  if (opts.totalEl) { var tel = $(opts.totalEl); if (tel) tel.textContent = fmtKs(d.total); }
  if (opts.chipsEl) {

    var cel = $(opts.chipsEl);
    if (cel) {
      var keys = Object.keys(MONEY_OUT_TYPES).filter(function (k) { return (d.byCategory[k] || 0) > 0; });
      cel.innerHTML = keys.length ? keys.map(function (k) {
        var t = moneyOutType(k);
        return '<span class="text-[10px] font-bold px-2 py-0.5 rounded-full border ' + t.chip + '">' + t.label + ' · ' + fmtKs(d.byCategory[k]) + '</span>';
      }).join('') : '<span class="text-[10px] text-gray-500">No spending that day.</span>';
    }
  }
  var maxRows = opts.maxRows || 0;
  var shown = maxRows > 0 && d.rows.length > maxRows ? d.rows.slice(0, maxRows) : d.rows;

  el.innerHTML = shown.length ? shown.map(moneyOutRowHtml).join('') +
    (d.rows.length > shown.length ? '<div class="text-[10px] text-gray-500 pt-1">+' + (d.rows.length - shown.length) + ' more — open the Cash tab for the full list</div>' : '')
    : '<div class="text-xs text-gray-500 py-1">' + (opts.emptyLabel || ('Nothing went out on ' + esc(dateStr) + ' — log a production batch, purchase, expense or cash-out.')) + '</div>';
  lucide.createIcons();
}

/* Today's Money Out card on the Dashboard (compact). */
function renderMoneyOutTodayDash() {
  renderMoneyOutList({
    listId: 'moneyOutTodayList',
    totalEl: 'moneyOutTodayTotal',
    chipsEl: 'moneyOutTodayChips',
    date: today(),
    maxRows: 10,
    emptyLabel: 'No money out today yet — log a production batch, purchase, expense or cash-out to see it here.'
  });
}

/* Delete an outgoing row that supports inline deletion (expense, cash-out). */
function deleteMoneyOutRow(type, id) {
  if (type === 'expense') { if (typeof removeExpense !== 'function') return; removeExpense(id); }
  else if (type === 'cashout') { removeCashAdjustment(id); }
  else return;
  // Re-render both money-out surfaces (dashboard card + cash panel)。
  renderMoneyOutTodayDash();
  renderMoneyOutList({ listId: 'moneyOutList', totalEl: 'moneyOutTotal', chipsEl: 'moneyOutChips', date: moneyOutDateValue() });
}

$('moneyOutDate').addEventListener('change', function () {
  renderMoneyOutList({ listId: 'moneyOutList', totalEl: 'moneyOutTotal', chipsEl: 'moneyOutChips', date: moneyOutDateValue() });
});
