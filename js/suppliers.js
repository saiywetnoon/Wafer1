/* ============================================================
   SUPPLIERS / PURCHASES & PAYABLES
   ============================================================ */

function totalPayable() {
  return (state.purchases || []).reduce(function (s, p) {
    var paid = (p.paid || 0) + (p.paidNow || 0);
    return s + Math.max(0, (p.itemTotal || 0) - paid);
  }, 0);
}

function totalReceivable() {
  return (state.customers || []).reduce(function (s, c) { return s + (c.debt || 0); }, 0);
}

function supplierName(id) {
  var s = (state.suppliers || []).find(function (x) { return x.id === id; });
  return s ? s.name : 'Unknown';
}

function supplierById(id) {
  return (state.suppliers || []).find(function (x) { return x.id === id; });
}

function supplierBalance(id) {
  return (state.purchases || []).reduce(function (s, p) {
    if (p.supplierId !== id) return s;
    var paid = (p.paid || 0) + (p.paidNow || 0);
    return s + Math.max(0, (p.itemTotal || 0) - paid);
  }, 0);
}

/* Replay the payments ledger onto purchases (oldest purchase first — the same
   allocation the payment form uses) and lift each purchase's `paid` to cover
   what the ledger proves was settled. The payments ledger is the merge-safe
   source of truth: a payment recorded on the phone arrives on the computer as
   a brand-new row (never dropped), whereas the purchase record it mutated can
   be dropped by the sync merge because the payment handler used to change
   `paid` WITHOUT re-stamping updatedAt — a same-timestamp clash keeps this
   device's copy and "Total Payable" never dropped. This replay is idempotent
   and never REDUCES a recorded `paid`, so legacy manual balances stay safe. */
function normalizeSupplierPayables() {
  state.purchases = state.purchases || [];
  state.payments = state.payments || [];
  var out = state.purchases.map(function (p) {
    return {
      p: p,
      supplierId: p.supplierId,
      date: String(p.date || ''),
      bal: Math.max(0, toMoney(p.itemTotal) - toMoney(p.paidNow)),
      allocated: 0
    };
  });
  var pays = (state.payments || []).slice().sort(function (a, b) {
    return String(a && (a.createdAt || a.date) || '').localeCompare(String(b && (b.createdAt || b.date) || ''));
  });
  pays.forEach(function (pay) {
    if (!pay || !pay.supplierId) return;
    var remaining = Math.max(0, toMoney(pay.amount));
    out
      .filter(function (o) { return o.supplierId === pay.supplierId; })
      .sort(function (a, b) { return a.date.localeCompare(b.date); })
      .forEach(function (o) {
        if (remaining <= 0 || o.bal <= 0) return;
        var apply = Math.min(o.bal, remaining);
        o.bal -= apply;
        remaining -= apply;
        o.allocated += apply;
      });
  });
  out.forEach(function (o) {
    var recorded = toMoney(o.p.paid);
    var target = Math.round(o.allocated);
    if (target > recorded) { o.p.paid = target; o.p.updatedAt = new Date().toISOString(); }
  });
}

/* ---------- Master render ---------- */
function renderSuppliers() {
  // Self-heal: replay the payments ledger so a phone-recorded payment that
  // synced in as a row (but whose purchase mutation was dropped by the merge)
  // still lowers Total Payable / the per-supplier balance on this device.
  if (typeof normalizeSupplierPayables === 'function') normalizeSupplierPayables();
  renderSupplierDropdowns();
  renderSupplierList();
  renderPurchaseHistory();
  renderPaymentHistory();
  var d = $('purchaseDate'); if (d) d.value = d.value || today();
  var t = $('totalPayable'); if (t) t.textContent = fmtKs(totalPayable());
  var r = $('netReceivable'); if (r) r.textContent = fmtKs(totalReceivable());
  var n = $('netPosition'); if (n) n.textContent = fmtKs(totalReceivable() - totalPayable());
  lucide.createIcons();
}

function renderSupplierDropdowns() {
  var suppliers = state.suppliers || [];
  ['purchaseSupplier', 'paymentShop'].forEach(function (id) {
    var sel = $(id);
    if (!sel) return;
    var current = sel.value;
    sel.innerHTML = '<option value="">Select shop...</option>' + suppliers.map(function (s) {
      return '<option value="' + s.id + '">' + esc(s.name) + '</option>';
    }).join('');
    if (current) sel.value = current;
  });
}

function renderSupplierList() {
  var body = $('supplierListBody');
  if (!body) return;
  var suppliers = state.suppliers || [];
  body.innerHTML = suppliers.length ? suppliers.map(function (s) {
    var bal = supplierBalance(s.id);
    var added = s.createdAt ? fmtDateTime(s.createdAt) : '';
    return '<tr class="border-b border-gray-800">' +
      '<td class="py-1.5 pr-2 min-w-0">' +
        '<div class="font-medium truncate">' + esc(s.name) + (s.phone ? ' <span class="text-gray-500 font-normal">(' + esc(s.phone) + ')</span>' : '') + '</div>' +
      '</td>' +
      '<td class="py-1.5 pr-2 text-gray-500 whitespace-nowrap">' + (added ? esc(added) : '<span class="text-gray-600">—</span>') + '</td>' +
      '<td class="py-1.5 pr-2 ' + (bal > 0 ? 'text-red-400' : 'text-emerald-400') + ' font-semibold">' + fmtKs(bal) + '</td>' +
      '<td class="py-1.5 text-right whitespace-nowrap"><button onclick="deleteSupplier(\'' + s.id + '\')" class="text-red-500 hover:text-red-400" title="Delete this supplier"><i data-lucide="trash-2" class="w-3.5 h-3.5"></i></button></td>' +
      '</tr>';
  }).join('') : '<tr><td colspan="4" class="py-4 text-center text-gray-500">No suppliers yet. Add the shops you buy from above.</td></tr>';
}

function renderPurchaseHistory() {
  var his = $('purchaseHistory');
  if (!his) return;
  var purchases = (state.purchases || []).slice().sort(function (a, b) { return (b.date || '').localeCompare(a.date || ''); });
  if (!purchases.length) { his.innerHTML = '<div class="py-4 text-center text-gray-500">No purchases recorded yet. Log your first stock purchase above.</div>'; return; }
  his.innerHTML = purchases.map(function (p) {
    var sup = supplierName(p.supplierId);
    var paid = (p.paid || 0) + (p.paidNow || 0);
    var bal = Math.max(0, (p.itemTotal || 0) - paid);
    var items = (p.items || []).map(function (it) { return it.qty + ' × ' + it.name; }).join(', ');
    return '<div class="flex flex-wrap items-center justify-between gap-2 py-2 border-b border-gray-700 last:border-0">' +
      '<div class="min-w-0"><div class="font-semibold text-gray-300">' + esc(p.date) + ' — ' + esc(sup) + '</div>' +
      (p.createdAt ? '<div class="text-[10px] text-gray-500">Logged ' + esc(fmtDateTime(p.createdAt)) + '</div>' : '') +
      '<div class="text-gray-500 truncate">' + esc(items) + '</div>' +
      '<div class="text-gray-500">Total ' + fmtKs(p.itemTotal) + ' · Paid ' + fmtKs(paid) + '</div></div>' +
      '<div class="text-right shrink-0"><div class="' + (bal > 0 ? 'text-red-400 font-bold' : 'text-emerald-400 font-bold') + '">' + fmtKs(bal) + '</div></div>' +
      '</div>';
  }).join('');
}

/* Payment history — every payment made to a shop, newest first, with
   the exact time it was recorded (older records show only the business date). */
function renderPaymentHistory() {
  var his = $('paymentHistory');
  if (!his) return;
  var payments = (state.payments || []).slice().sort(function (a, b) {
    var ta = Date.parse(a.createdAt) || Date.parse(a.date + 'T12:00:00') || 0;
    var tb = Date.parse(b.createdAt) || Date.parse(b.date + 'T12:00:00') || 0;
    return tb - ta;
  });
  if (!payments.length) { his.innerHTML = '<div class="py-3 text-center text-gray-500">No payments recorded yet. Use the form above to pay a shop.</div>'; return; }
  his.innerHTML = payments.map(function (p) {
    var sup = supplierName(p.supplierId);
    var when = p.createdAt ? fmtDateTime(p.createdAt) : (p.date ? fmtDateTime(p.date + 'T12:00:00') : '');
    return '<div class="flex flex-wrap items-center justify-between gap-2 py-1.5 border-b border-gray-700 last:border-0">' +
      '<div class="min-w-0"><div class="font-semibold text-gray-300">' + esc(sup) + '</div>' +
      (when ? '<div class="text-[10px] text-gray-500">' + esc(when) + '</div>' : '') +
      '</div>' +
      '<div class="text-right shrink-0 font-semibold text-emerald-400">' + fmtKs(p.amount) + '</div>' +
      '</div>';
  }).join('');
}

/* ---------- Add / delete supplier ---------- */
$('addSupplierBtn').addEventListener('click', function () {
  var name = validateText($('supplierName'));
  if (!name) { showToast('Enter a shop name.', 'error'); return; }
  if (!state.suppliers) state.suppliers = [];
  var nowIso = new Date().toISOString();
  state.suppliers.push({ id: uid(), name: name, phone: $('supplierPhone').value.trim(), createdAt: nowIso, updatedAt: nowIso });
  saveState();
  $('supplierName').value = '';
  $('supplierPhone').value = '';
  renderSuppliers();
  showToast('Supplier "' + name + '" added.');
});

function deleteSupplier(id) {
  var s = supplierById(id);
  var label = s ? s.name : 'this supplier';
  if (!confirm('Delete "' + label + '" from your suppliers?\n\nTheir purchase and payment history is kept so your totals stay correct — the shop just stops being listed.')) return;
  state.suppliers = (state.suppliers || []).filter(function (x) { return x.id !== id; });
  saveState();
  renderSuppliers();
  showToast('Supplier "' + label + '" deleted.');
}

/* ---------- Purchase items builder ---------- */
function priceItemByName(name) {
  return (state.prices || []).find(function (ing) { return ing.name === name; });
}

function itemOptions(selected) {
  var opts = (state.prices || []).map(function (ing) { return '<option value="' + esc(ing.name) + '">' + esc(ing.name) + '</option>'; });
  if (selected && selected !== '') {
    opts.unshift('<option value="' + esc(selected) + '">' + esc(selected) + '</option>');
  }
  opts.unshift('<option value="">— ingredient —</option>');
  return opts.join('');
}

function addItemRow(name) {
  var wrap = $('purchaseItems');
  var row = document.createElement('div');
  row.className = 'purchase-item flex items-center gap-2';
  row.innerHTML =
    '<select class="purchase-item-name flex-1 px-2 py-1.5 rounded border border-gray-700 bg-gray-800 text-xs focus:outline-none focus:ring-1 focus:ring-emerald-500">' + itemOptions(name) + '</select>' +
    '<input type="number" min="0" step="0.01" placeholder="Qty" class="purchase-item-qty w-20 px-2 py-1.5 rounded border border-gray-700 bg-gray-800 text-xs text-right focus:outline-none focus:ring-1 focus:ring-emerald-500">' +
    '<input type="number" min="0" step="10" placeholder="Price" class="purchase-item-price w-24 px-2 py-1.5 rounded border border-gray-700 bg-gray-800 text-xs text-right focus:outline-none focus:ring-1 focus:ring-emerald-500">' +
    '<button class="px-2 py-1 rounded bg-red-600 hover:bg-red-500 text-white text-xs" onclick="removeItemRow(this)"><i data-lucide="x" class="w-3 h-3"></i></button>';
  wrap.appendChild(row);
  row.querySelector('.purchase-item-name').value = (name && name !== '') ? name : (state.prices.length ? state.prices[0].name : '');
  var ing = priceItemByName(row.querySelector('.purchase-item-name').value);
  row.querySelector('.purchase-item-price').value = ing ? ing.price : '';
  row.querySelector('.purchase-item-name').addEventListener('change', function () {
    var s = priceItemByName(this.value);
    row.querySelector('.purchase-item-price').value = s ? s.price : '';
    recalcPurchaseTotal();
  });
  row.querySelector('.purchase-item-qty').addEventListener('input', recalcPurchaseTotal);
  row.querySelector('.purchase-item-price').addEventListener('input', recalcPurchaseTotal);
  row.querySelectorAll('input').forEach(function (el) {
    el.addEventListener('input', function () { clearError(el); });
    el.addEventListener('change', function () { clearError(el); });
  });
  lucide.createIcons();
}

function removeItemRow(btn) {
  var row = btn.closest('.purchase-item');
  if (row) row.remove();
  recalcPurchaseTotal();
  lucide.createIcons();
}

function recalcPurchaseTotal() {
  var rows = document.querySelectorAll('#purchaseItems .purchase-item');
  var total = 0;
  rows.forEach(function (row) {
    var name = row.querySelector('.purchase-item-name').value;
    var qty = parseFloat(row.querySelector('.purchase-item-qty').value) || 0;
    var price = parseFloat(row.querySelector('.purchase-item-price').value) || 0;
    var ing = priceItemByName(name);
    if (ing && ing.unit === 'g') total += (qty / 1000) * price;
    else total += qty * price;
  });
  var t = $('purchaseItemTotal'); if (t) t.textContent = fmtKs(total);
}

$('addPurchaseItemBtn').addEventListener('click', function () {
  addItemRow();
  recalcPurchaseTotal();
});
/* ---------- Save purchase (adds to inventory) ---------- */
$('savePurchaseBtn').addEventListener('click', function () {
  var supplierId = $('purchaseSupplier').value;
  var date = $('purchaseDate').value || today();
  if (!supplierId) { showToast('Select a shop for this purchase.', 'error'); return; }
  var rows = document.querySelectorAll('#purchaseItems .purchase-item');
  var items = [];
  var itemTotal = 0;
  rows.forEach(function (row) {
    var name = row.querySelector('.purchase-item-name').value;
    var qty = parseFloat(row.querySelector('.purchase-item-qty').value) || 0;
    var price = parseFloat(row.querySelector('.purchase-item-price').value) || 0;
    if (!name || !price || qty <= 0) return;
    var ing = priceItemByName(name);
    var amount = (ing && ing.unit === 'g') ? (qty / 1000) * price : qty * price;
    items.push({ name: name, qty: qty, unit: ing ? ing.unit : 'unit', price: price, amount: amount });
    itemTotal += amount;
  });
  if (!items.length) { showToast('Add at least one item with a valid qty and price.', 'error'); return; }
  var paidNow = parseFloat($('purchasePaidNow').value) || 0;
  if (paidNow > itemTotal) paidNow = itemTotal;
  const purchaseId = uid();
  // Purchases are immutable dated inventory movements, not direct stock edits.
  items.forEach(function (it) {
    recordInventoryMovement({ date: date, ingredientName: it.name, qty: it.qty,
      type: 'purchase', reason: 'Supplier purchase', referenceId: purchaseId });
  });
  if (!state.purchases) state.purchases = [];
  var purchaseNowIso = new Date().toISOString();
  state.purchases.push({
    id: purchaseId,
    supplierId: supplierId,
    date: date,
    items: items,
    itemTotal: Math.round(itemTotal),
    paidNow: Math.round(paidNow),
    note: '',
    createdAt: purchaseNowIso,
    updatedAt: purchaseNowIso
  });
  saveState();
  renderAll();
  clearPurchaseForm();
  triggerGoogleSync();
  // Offer to sync actual purchase prices back to the price list so margins
  // reflect what you really paid, and record any change in price history.
  var updated = [];
  items.forEach(function (it) {
    var ing = priceItemByName(it.name);
    if (!ing) return;
    var pricePer = (ing.unit === 'g') ? it.amount / (it.qty / 1000) : it.amount / it.qty;
    if (Math.abs(pricePer - (parseFloat(ing.price) || 0)) > 0.5) {
      updated.push({ name: it.name, old: parseFloat(ing.price) || 0, neu: pricePer });
    }
  });
  if (updated.length) {
  updated.forEach(function (u) {
    var ing = priceItemByName(u.name);
    if (!ing) return;
    if (!state.priceHistory) state.priceHistory = [];
    state.priceHistory.push({ id: uid(), date: today(), name: u.name, old: Math.round(u.old), new: Math.round(u.neu), updatedAt: new Date().toISOString() });
    ing.updatedAt = new Date().toISOString();
    ing.price = Math.round(u.neu);
  });
  saveState();
  updateGoogleSyncStatus('Price list updated from purchase prices.', 'success');
  }
  var msg = 'Purchase saved — stock added to inventory.';
  if (paidNow < itemTotal) msg += ' You owe ' + fmtKs(Math.round(itemTotal - paidNow)) + ' to the shop.';
  else msg += ' Fully paid.';
  showToast(msg);
});

function clearPurchaseForm() {
  var wrap = $('purchaseItems'); if (wrap) wrap.innerHTML = '';
  var c = $('purchasePaidNow'); if (c) c.value = 0;
  var t = $('purchaseItemTotal'); if (t) t.textContent = fmtKs(0);
}

/* ---------- Record payment to settle supplier debt ---------- */
$('recordSupplierPaymentBtn').addEventListener('click', function () {
  var supplierId = $('paymentShop').value;
  var amount = parseFloat($('supplierPaymentAmount').value);
  var date = $('supplierPaymentDate').value || today();
  if (!supplierId) { showToast('Select a shop to pay.', 'error'); return; }
  if (isNaN(amount) || amount <= 0) { showToast('Enter a valid payment amount.', 'error'); return; }
  // Allocate payment to the shop's oldest unpaid purchases first
  var remaining = amount;
  (state.purchases || []).filter(function (p) { return p.supplierId === supplierId; })
    .sort(function (a, b) { return (a.date || '').localeCompare(b.date || ''); })
    .forEach(function (p) {
      if (remaining <= 0) return;
      var paid = (p.paid || 0) + (p.paidNow || 0);
      var bal = Math.max(0, (p.itemTotal || 0) - paid);
      var apply = Math.min(bal, remaining);
      p.paid = (p.paid || 0) + apply;
      remaining -= apply;
      // Re-stamp the purchase so the merge on other devices recognises this
      // payment as an edit (same-id clashes are won by the newest updatedAt).
      // Without this the phone's payment shows up as a `payments` row on the
      // computer while the purchase carrying the reduced balance is dropped as
      // "not newer" — Total Payable never drops.
      if (apply > 0) p.updatedAt = new Date().toISOString();
    });
  if (!state.payments) state.payments = [];
  state.payments.push({ id: uid(), supplierId: supplierId, date: date, amount: Math.round(amount), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  saveState();
  renderSuppliers();
  $('supplierPaymentAmount').value = '';
  triggerGoogleSync();
  showToast('Payment of ' + fmtKs(amount) + ' recorded to ' + supplierName(supplierId) + '.');
});
