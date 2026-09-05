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
  // A closed day is locked: no new manual cash events for that date without reopening.
  if (isDayClosed(today())) { showToast('Today\'s cash is closed — reopen the day to post adjustments.', 'error'); return; }
  if (!state.cash) state.cash = { opening: 0, adjustments: [] };
  if (!Array.isArray(state.cash.adjustments)) state.cash.adjustments = [];
  state.cash.adjustments.push({ id: uid(), date: today(), amount: amount, label: label });
  saveState();
  renderCash();
  showToast(amount > 0 ? 'Cash added to drawer.' : 'Cash removed from drawer.');
}

async function removeCashAdjustment(id) {
  const ok = await Modal.confirm({ title: 'Delete cash adjustment?', message: 'This removes the adjustment from the cash drawer history.', danger: true, okLabel: 'Delete' });
  if (!ok) return;
  if (!state.cash) return;
  state.cash.adjustments = (state.cash.adjustments || []).filter(function (a) { return a.id !== id; });
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
  var counted = toFinite(($('cashCounted') || {}).value);
  var varEl = $('cashVariance');
  if (varEl) {
    var variance = counted - exp;
    varEl.textContent = (variance >= 0 ? '+' : '') + fmtKs(variance);
    varEl.className = 'font-extrabold text-lg ' + (Math.abs(variance) < 0.005 ? 'text-gray-400' : variance > 0 ? 'text-emerald-400' : 'text-red-400');
  }
  renderCashCloseUI();
}

/* ---------- Daily Cash Close / Reopen ----------
   A close record freezes one day's expected-vs-counted cash. Once closed, the
   day shows a closed banner, new manual adjustments for that day are blocked,
   and reopening requires a typed reason (kept in the record as an audit trail). */
function cashCloses() {
  return (state.cash && Array.isArray(state.cash.closes)) ? state.cash.closes : [];
}
function cashCloseOn(date) {
  var d = date || today();
  return cashCloses().find(function (c) { return c.date === d; }) || null;
}
function isDayClosed(date) {
  var c = cashCloseOn(date);
  return !!(c && !c.reopenedAt);
}
function postCashVariance(counted) {
  var exp = cashExpectedToday();
  var variance = Math.round(toFinite(counted) - exp);
  if (Math.abs(variance) < 1) return 0;
  addCashAdjustment(variance, 'Daily count variance (' + fmt(counted) + ' counted vs ' + fmt(exp) + ' expected)');
  return variance;
}
async function closeCashDay() {
  if (!state.cash) state.cash = { opening: 0, adjustments: [] };
  if (!Array.isArray(state.cash.closes)) state.cash.closes = [];
  if (isDayClosed(today())) { showToast('Today is already closed.', 'info'); renderCashCloseUI(); return; }
  var expected = cashExpectedToday();
  var counted = toFinite(($('cashCounted') || {}).value);
  if (counted <= 0 && expected > 0) { showToast('Enter the counted cash first.', 'error'); return; }
  var note = await Modal.prompt({
    title: 'Close today\'s cash',
    message: 'Expected ' + fmtKs(expected) + ' · counted ' + fmtKs(counted) + ' · variance ' + fmtKs(Math.round(counted - expected)) + '.\n\nOptional note (shortage / overage explanation):'
  });
  if (note === null) return; // cancelled
  // Post any variance to the drawer so the books match the count.
  var variance = postCashVariance(counted);
  state.cash.closes.push({
    id: uid(),
    date: today(),
    expected: Math.round(expected),
    counted: Math.round(counted),
    variance: Math.round(counted - expected),
    note: (note || '').trim(),
    closedBy: authEmail() || '',
    closedAt: new Date().toISOString(),
    reopenedAt: null,
    reopenedBy: null,
    reopenReason: ''
  });
  saveState();
  $('cashCounted').value = '';
  renderCash();
  showToast(variance ? 'Day closed — variance ' + (variance > 0 ? '+' : '') + fmtKs(variance) + ' posted.' : 'Day closed — counted matches expected.', 'success');
}
async function reopenCashDay() {
  var c = cashCloseOn(today());
  if (!c || c.reopenedAt) { showToast('Today is not closed.', 'info'); return; }
  var reason = await Modal.prompt({
    title: 'Reopen today',
    message: 'Reopening a closed day lets you record missing cash events.\n\nReason for reopening (required for the audit record):',
    validate: function (v) { return (v || '').trim() ? '' : 'A reason is required to reopen a closed day.'; }
  });
  if (reason === null) return;
  c.reopenedAt = new Date().toISOString();
  c.reopenedBy = authEmail() || '';
  c.reopenReason = reason.trim();
  saveState();
  renderCash();
  showToast('Today reopened: ' + reason.trim(), 'info');
}
function renderCashCloseUI() {
  var banner = $('cashCloseBanner');
  var closeBtn = $('cashCloseBtn');
  var reopenBtn = $('cashReopenBtn');
  var closed = isDayClosed(today());
  if (banner) {
    banner.innerHTML = closed
      ? '<div class="p-3 rounded-lg bg-amber-900/30 border border-amber-700/50 text-xs text-amber-200"><b>Today\'s cash is closed.</b> Manual adjustments for today are blocked. Reopen if you need to record a missed event.</div>'
      : '<div class="p-3 rounded-lg bg-gray-800/60 border border-gray-700 text-xs text-gray-400"><b>Awaiting close.</b> Count the drawer, then press "Close Today\'s Cash" to lock the day and store the record.</div>';
    banner.classList.remove('hidden');
  }
  if (closeBtn) closeBtn.classList.toggle('hidden', closed);
  if (reopenBtn) reopenBtn.classList.toggle('hidden', !closed);
  var hist = $('cashCloseHistory');
  if (hist) {
    var closes = cashCloses().slice().reverse();
    hist.innerHTML = closes.length
      ? '<div class="font-semibold text-gray-400 mb-1">Close history</div>' +
        closes.map(function (c) {
          var stateTxt = (c.reopenedAt ? ' <span class="text-gray-500">· reopened</span>' : ' <span class="text-emerald-400">closed</span>');
          var re = c.reopenReason ? '<div class="text-gray-600">reopen: ' + esc(c.reopenReason) + '</div>' : '';
          return '<div class="py-1 border-b border-gray-800 last:border-0">' + esc(c.date) +
            ' · exp ' + fmtKs(c.expected) + ' · counted ' + fmtKs(c.counted) +
            ' · var ' + ((c.variance >= 0 ? '+' : '') + fmtKs(c.variance)) + stateTxt + re + '</div>';
        }).join('')
      : '<div class="text-gray-500">No cash days closed yet.</div>';
  }
}

$('cashOpening').addEventListener('change', function () {
  var v = toFinite($('cashOpening').value);
  if (!state.cash) state.cash = { opening: 0, adjustments: [] };
  state.cash.opening = v;
  saveState();
  renderCash();
  showToast('Opening cash balance saved.');
});

$('cashAdjustInBtn').addEventListener('click', function () {
  addCashAdjustment(Math.abs(toFinite($('cashAdjustAmount').value)), $('cashAdjustLabel').value.trim());
  $('cashAdjustAmount').value = '';
  $('cashAdjustLabel').value = '';
});
$('cashAdjustOutBtn').addEventListener('click', function () {
  addCashAdjustment(-Math.abs(toFinite($('cashAdjustAmount').value)), $('cashAdjustLabel').value.trim());
  $('cashAdjustAmount').value = '';
  $('cashAdjustLabel').value = '';
});

$('cashCounted').addEventListener('input', renderCashCount);
$('cashPostVarianceBtn').addEventListener('click', function () {
  var exp = cashExpectedToday();
  var counted = toFinite($('cashCounted').value);
  var variance = Math.round(counted - exp);
  if (Math.abs(variance) < 1) { showToast('Counting matches expected — no adjustment needed.', 'info'); return; }
  postCashVariance(counted);
  $('cashCounted').value = '';
  renderCashCount();
  showToast('Variance ' + (variance > 0 ? '+' : '') + fmtKs(variance) + ' posted to the cash drawer.');
});
$('cashCloseBtn').addEventListener('click', closeCashDay);
$('cashReopenBtn').addEventListener('click', reopenCashDay);

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
