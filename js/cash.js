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
  state.cash.adjustments.push({ id: uid(), date: today(), amount: amount, label: label });
  saveState();
  renderCash();
  showToast(amount > 0 ? 'Cash added to drawer.' : 'Cash removed from drawer.');
}

function removeCashAdjustment(id) {
  if (!confirm('Delete this cash adjustment?')) return;
  if (!state.cash) return;
  state.cash.adjustments = (state.cash.adjustments || []).filter(function (a) { return a.id !== id; });
  saveState();
  renderCash();
}

function financeTotals() {
  var entries = Object.keys(state.entries || {}).map(function (d) { return state.entries[d]; });
  var sales = entries.reduce(function (s, e) { return s + (e.revenue || 0); }, 0);
  var customerPay = (state.customerPayments || []).reduce(function (s, p) { return s + (p.amount || 0); }, 0);
  var adjustIn = cashAdjustments().reduce(function (s, a) { return s + (a.amount > 0 ? a.amount : 0); }, 0);
  var cashIn = sales + customerPay + adjustIn;

  var purchasesPaid = (state.purchases || []).reduce(function (s, p) { return s + ((p.paidNow || 0) + (p.paid || 0)); }, 0);
  var supplierPay = (state.payments || []).reduce(function (s, p) { return s + (p.amount || 0); }, 0);
  var oneTime = (state.expenses || []).reduce(function (s, e) { return s + (e.amount || 0); }, 0);
  var labor = entries.reduce(function (s, e) { return s + (e.laborCost || 0); }, 0);
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
      '<div class="flex justify-between py-1 border-b border-gray-700"><span>Sales (all entries)</span><span class="text-emerald-400 font-semibold">' + fmtKs(t.sales) + '</span></div>' +
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