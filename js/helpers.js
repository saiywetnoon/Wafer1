/* ---------- Helpers ---------- */
const $ = (id) => document.getElementById(id);
const fmt = (n) => Number(n).toLocaleString('en-US');
const fmtKs = (n) => fmt(Math.round(n)) + ' Ks';
const today = () => {
  const d = new Date();
  const off = d.getTimezoneOffset();
  const local = new Date(d.getTime() - off * 60000);
  return local.toISOString().slice(0, 10);
};
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
  if (c === '&') return '&' + 'amp;';
  if (c === '<') return '&' + 'lt;';
  if (c === '>') return '&' + 'gt;';
  if (c === '"') return '&' + 'quot;';
  return '&' + '#39;';
});

function entriesSorted() {
  return Object.keys(state.entries).sort().map(function (d) {
    const e = Object.assign({}, state.entries[d]);
    e.date = d;
    return e;
  });
}

/* ---------- Production / Sales / Stock (ready-to-sell goods) ---------- */
/* Production = what you ROLLED. Sales = what you SOLD that day (may come from
   rolls made today, tomorrow, or previous batches). Finished goods sit in
   state.stock until sold, so a day's cost is never forced into the same day's
   profit. pieces-per-bag is entered per sale because it varies. */

function prodList() {
  return (state.production || []).slice().sort(function (a, b) {
    return a.date === b.date ? 0 : (a.date < b.date ? -1 : 1);
  });
}
function salesList() {
  return (state.sales || []).slice().sort(function (a, b) {
    return a.date === b.date ? 0 : (a.date < b.date ? -1 : 1);
  });
}

/* Aggregate money + quantities across ALL production and sales. */
function financeTotalsAll() {
  var prod = prodList();
  var sales = salesList();
  return {
    capital: prod.reduce(function (s, p) { return s + (p.capital || 0); }, 0),
    productionBags: prod.reduce(function (s, p) { return s + (p.bags || 0); }, 0),
    productionPieces: prod.reduce(function (s, p) { return s + (p.pieces || 0); }, 0),
    laborMin: prod.reduce(function (s, p) { return s + (p.laborMinutes || 0); }, 0),
    laborCost: prod.reduce(function (s, p) { return s + (p.laborCost || 0); }, 0),
    revenue: sales.reduce(function (s, sl) { return s + (sl.amount || 0); }, 0),
    cogs: sales.reduce(function (s, sl) { return s + (sl.cogs || 0); }, 0),
    salesBags: sales.reduce(function (s, sl) { return s + (sl.bags || 0); }, 0),
    salesPieces: sales.reduce(function (s, sl) { return s + (sl.pieces || 0); }, 0),
    net: sales.reduce(function (s, sl) { return s + ((sl.amount || 0) - (sl.cogs || 0)); }, 0)
  };
}

/* Rebuild finished-goods stock and each sale's cost-of-goods by replaying
   production (adds pieces+cost) and sales (subtracts pieces at average cost)
   in date order. Run after any create / edit / delete so cogs stays correct
   even when today's production sells over several days. */
function rebuildStockAndCogs() {
  var events = [];
  (state.production || []).forEach(function (p) { events.push({ date: p.date, type: 0, p: p }); });
  (state.sales || []).forEach(function (s) { events.push({ date: s.date, type: 1, s: s }); });
  (state.waste || []).forEach(function (w) { events.push({ date: w.date, type: 2, w: w }); });
  events.sort(function (a, b) {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    return a.type - b.type; // production before sales on the same day
  });
  var stock = { pieces: 0, cost: 0 };
  events.forEach(function (ev) {
    if (ev.type === 0) {
      stock.pieces += (ev.p.pieces || 0);
      stock.cost += (ev.p.capital || 0);
    } else {
      var item = ev.type === 1 ? ev.s : ev.w;
      var qty = item.pieces !== undefined ? item.pieces : item.qty;
      var avg = stock.pieces > 0 ? (stock.cost / stock.pieces) : 0;
      var cost = Math.round((qty || 0) * avg);
      if (ev.type === 1) {
        item.cogs = cost;
        item.avgCost = Math.round(avg * 100) / 100;
        item.net = Math.round((item.amount || 0) - cost);
      } else {
        item.cost = cost;
        item.avgCost = Math.round(avg * 100) / 100;
      }
      stock.pieces = Math.max(0, stock.pieces - (qty || 0));
      stock.cost = Math.max(0, stock.cost - cost);
    }
  });
  if (!state.stock) state.stock = { pieces: 0, cost: 0 };
  state.stock.pieces = Math.round(stock.pieces);
  state.stock.cost = Math.round(stock.cost);
}

/* Validate a proposed sale/waste record against stock at its actual date.
   This prevents a future production batch from incorrectly covering an earlier
   sale and keeps stock from silently going negative. */
function finishedGoodsShortage(production, sales, waste) {
  var events = [];
  (production || []).forEach(function (p) { events.push({ date: p.date, type: 0, qty: p.pieces || 0 }); });
  (sales || []).forEach(function (s) { events.push({ date: s.date, type: 1, qty: s.pieces || 0 }); });
  (waste || []).forEach(function (w) { events.push({ date: w.date, type: 2, qty: w.qty || 0 }); });
  events.sort(function (a, b) { return a.date === b.date ? a.type - b.type : (a.date < b.date ? -1 : 1); });
  var stock = 0;
  for (var i = 0; i < events.length; i++) {
    var event = events[i];
    if (event.type === 0) stock += event.qty;
    else if (event.qty > stock) return { date: event.date, available: stock, requested: event.qty, type: event.type === 1 ? 'sale' : 'waste' };
    else stock -= event.qty;
  }
  return null;
}

function canSaveSale(record) {
  var sales = (state.sales || []).slice();
  var index = sales.findIndex(function (s) { return s.id === record.id; });
  if (index >= 0) sales[index] = record;
  else sales.push(record);
  return finishedGoodsShortage(state.production, sales, state.waste);
}

function canRecordWaste(record) {
  return finishedGoodsShortage(state.production, state.sales, (state.waste || []).concat([record]));
}

/* Number of ready-to-sell bags (using the most recent sale's pieces-per-bag
   as a hint, defaulting to the last production's average — just a guide). */
function stockBagsHint() {
  var perBag = 6;
  var sales = salesList();
  if (sales.length) {
    var last = sales[sales.length - 1];
    if (last.bags > 0) perBag = Math.round((last.pieces || 0) / last.bags) || 6;
  }
  var avg = stockAvgPiecesPerBag();
  if (avg > 0) perBag = Math.round(avg);
  return (state.stock && state.stock.pieces > 0) ? Math.max(0, Math.round((state.stock.pieces || 0) / perBag)) : 0;
}
function stockAvgPiecesPerBag() {
  var p = prodList();
  if (!p.length) return 0;
  var totB = 0, totP = 0;
  p.forEach(function (x) { totB += (x.bags || 0); totP += (x.pieces || 0); });
  return totB > 0 ? totP / totB : 0;
}
function stockAvgCostPerPiece() {
  var s = state.stock || {};
  return (s && s.pieces > 0) ? (s.cost / s.pieces) : 0;
}

/* One combined array keyed by date with what was ROLLED and what was SOLD,
   so the dashboard/calendar/monthly have a single view of the day. */
function entriesProdSales() {
  var map = {};
  (state.production || []).forEach(function (p) {
    if (!map[p.date]) map[p.date] = { date: p.date, prodBags: 0, prodPieces: 0, capital: 0, laborMin: 0, laborCost: 0, soldBags: 0, soldPieces: 0, revenue: 0, cogs: 0, net: 0 };
    var d = map[p.date];
    d.prodBags += (p.bags || 0); d.prodPieces += (p.pieces || 0); d.capital += (p.capital || 0);
    d.laborMin += (p.laborMinutes || 0); d.laborCost += (p.laborCost || 0);
  });
  (state.sales || []).forEach(function (s) {
    if (!map[s.date]) map[s.date] = { date: s.date, prodBags: 0, prodPieces: 0, capital: 0, laborMin: 0, laborCost: 0, soldBags: 0, soldPieces: 0, revenue: 0, cogs: 0, net: 0 };
    var d = map[s.date];
    d.soldBags += (s.bags || 0); d.soldPieces += (s.pieces || 0); d.revenue += (s.amount || 0);
    d.cogs += (s.cogs || 0); d.net += ((s.amount || 0) - (s.cogs || 0));
  });
  return Object.keys(map).sort().map(function (k) { return map[k]; });
}

/* ---------- Cash-sync-safe / metrics helpers ---------- */
function storageUsedKB() {
  try {
    const raw = localStorage.getItem(companyStateKey()) || '';
    return (new Blob([raw]).size / 1024); // KB (string length is a fine proxy)
  } catch (e) { return 0; }
}

function inventoryValue() {
  return (state.prices || []).reduce(function (sum, ing) {
    if (!isStockItem(ing.name)) return sum;
    const stock = inventoryStockFor(ing.name);
    if (stock <= 0) return sum;
    const price = parseFloat(ing.price) || 0;
    if (ing.unit === 'g') return sum + (stock / 1000) * price;   // price is per kg
    return sum + stock * price;                                  // price is per unit
  }, 0);
}

function totalStandingOrders() {
  return (state.customers || []).reduce(function (s, c) { return s + (c.standingOrder || 0); }, 0);
}

/* ---------- Cost & Weight Calculation ---------- */
function ingredientCostFor(usage) {
  return state.prices.reduce(function (sum, ing) {
    const qty = parseFloat(usage[ing.name]) || 0;
    if (ing.unit === 'g') return sum + (qty / 1000) * (parseFloat(ing.price) || 0);
    return sum + qty * (parseFloat(ing.price) || 0);
  }, 0);
}
function totalMixWeightFor(usage) {
  return state.prices.reduce(function (sum, ing) {
    const qty = parseFloat(usage[ing.name]) || 0;
    if (ing.unit === 'g') return sum + qty;
    return sum + qty * (parseFloat(ing.weightPerUnit) || 0);
  }, 0);
}

/* ---------- Ingredient inventory movement ledger ---------- */
function ensureInventoryItem(name) {
  if (!state.inventory) state.inventory = {};
  if (!state.inventory[name]) state.inventory[name] = { stock: 0, lowAlert: 0 };
  return state.inventory[name];
}
function inventoryStockFor(name) {
  return (state.inventoryMovements || []).reduce(function (total, movement) {
    return movement.ingredientName === name ? total + (parseFloat(movement.qty) || 0) : total;
  }, 0);
}
function syncInventorySnapshot(name) {
  const item = ensureInventoryItem(name);
  // True running balance — may be NEGATIVE after over-using stock without a
  // purchase, so the user sees what needs restocking instead of a lie ("0").
  item.stock = Math.round(inventoryStockFor(name) * 100) / 100;
  return item.stock;
}
/* An ingredient counts as STOCK only when it can be bought and stored (flour,
   eggs, bags…). Daily-usage items like water and electricity are NOT stock:
   they are excluded from inventory, movement recording, shortage checks and
   purchase planning. Opt out per item with the `stock: false` flag on the
   price-list entry. */
function isStockItem(name) {
  const ing = (state.prices || []).find(function (i) { return i.name === name; });
  return !ing || ing.stock !== false;
}
function recordInventoryMovement(movement) {
  const qty = parseFloat(movement && movement.qty);
  const name = String((movement && movement.ingredientName) || '').trim();
  if (!name || !isFinite(qty) || qty === 0) return null;
  if (!isStockItem(name)) return null;   // water/electricity etc. are usage, not stock
  if (!state.inventoryMovements) state.inventoryMovements = [];
  state.inventoryMovementVersion = 1;
  const record = {
    id: movement.id || uid(),
    date: movement.date || today(),
    ingredientName: name,
    qty: Math.round(qty * 100) / 100,
    type: movement.type || 'adjustment',
    reason: movement.reason || '',
    referenceId: movement.referenceId || '',
    createdAt: movement.createdAt || new Date().toISOString()
  };
  state.inventoryMovements.push(record);
  syncInventorySnapshot(name);
  return record;
}
function migrateInventoryMovements() {
  const hasLegacyStock = Object.keys(state.inventory || {}).some(function (name) {
    return (parseFloat(state.inventory[name].stock) || 0) > 0;
  });
  if (state.inventoryMovementVersion >= 1 && (!hasLegacyStock || (state.inventoryMovements || []).length)) return false;
  Object.keys(state.inventory || {}).forEach(function (name) {
    if (!isStockItem(name)) return;
    const qty = parseFloat(state.inventory[name].stock) || 0;
    if (qty > 0) recordInventoryMovement({
      date: today(), ingredientName: name, qty: qty, type: 'opening',
      reason: 'Opening balance migrated from previous inventory'
    });
  });
  state.inventoryMovementVersion = 1;
  return true;
}

/* ---------- Number / data utilities ----------
   Centralise the "coerce to a safe finite number" pattern that was repeated
   inline all over the ledger, so every consumer gets consistent, guarded values. */
function toFinite(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : (fallback === undefined ? 0 : fallback);
}
function toMoney(value) {
  return Math.round(toFinite(value) * 100) / 100;
}
function clamp(value, min, max) {
  const n = toFinite(value);
  return Math.min(max === undefined ? n : max, Math.max(min === undefined ? n : min, n));
}
/* Merge two id-addressable collections by key, keeping the LAST duplicate.
   Used to reconcile movement/collection copies without ever dropping records. */
function uniqueByKey(listA, listB, keyOf) {
  const map = new Map();
  (listA || []).concat(listB || []).forEach(function (item) {
    if (item == null) return;
    map.set(keyOf(item), item);
  });
  return Array.from(map.values());
}

function normalizeCustomerBalances() {
  state.customers = state.customers || [];
  // Authoritative balances derived ONLY from the movement ledger: sales credit
  // (+ amount − paid) minus payments received. This is the single source of truth.
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
    // One-time migration: capture any debt not explained by the ledger (e.g. debt
    // entered manually before this reconcile model existed) as a stable baseline so
    // the authoritative recompute below never silently drops it.
    if (customer.extraDebt === undefined) {
      customer.extraDebt = Math.max(0, toMoney((toMoney(customer.debt) - realLedger)));
    }
    // Debt is ALWAYS the authoritative sum: manual baseline + real ledger balance.
    customer.debt = Math.max(0, toMoney((toMoney(customer.extraDebt) + realLedger)));
    customer.standingOrder = Math.max(0, toFinite(customer.standingOrder));
    customer.price = Math.max(0, toFinite(customer.price, 1300));
    customer.phone = customer.phone || '';
  });
}

/* Merge two inventory-movement lists without losing records. The movement ledger
   is the source of truth for stock, so a remote/cloud copy must never wipe out
   local movements it doesn't know about — dedupe by record id when available. */
function mergeMovements(local, remote) {
  return uniqueByKey(local, remote, function (m) {
    return m && m.id ? m.id : [m.ingredientName, m.date, m.qty, m.type].join('|');
  });
}
function inventoryUsageShortage(oldUsage, newUsage) {
  const names = new Set(Object.keys(oldUsage || {}).concat(Object.keys(newUsage || {})));
  let shortage = null;
  names.forEach(function (name) {
    if (shortage) return;
    if (!isStockItem(name)) return;   // usage-only items (water, electricity) never block production
    const oldQty = parseFloat((oldUsage || {})[name]) || 0;
    const newQty = parseFloat((newUsage || {})[name]) || 0;
    const additional = newQty - oldQty;
    if (additional <= 0) return;
    const available = inventoryStockFor(name);
    // Only flag a REAL shortage: stock is on hand but the batch needs more than
    // remains. Items with NOTHING on hand (0 or already negative — e.g. a
    // default-recipe ingredient the user never stocked) must NOT silently block
    // the whole save; the batch is still recorded and the running balance goes
    // negative so the Inventory tab shows exactly what needs restocking.
    if (available > 0 && additional > available) shortage = { name: name, available: available, requested: additional };
  });
  return shortage;
}
/* Items whose running balance is NEGATIVE right now — used to warn the user
   that a save consumed more than was on hand, so they know to restock. */
function overConsumedStockItems() {
  const out = [];
  (state.prices || []).filter(isStockItem).forEach(function (ing) {
    const bal = Math.round(inventoryStockFor(ing.name) * 100) / 100;
    if (bal < 0) out.push(ing.name + ' ' + bal);
  });
  return out;
}
function reconcileProductionInventory(oldUsage, newUsage, date, referenceId) {
  const names = new Set(Object.keys(oldUsage || {}).concat(Object.keys(newUsage || {})));
  names.forEach(function (name) {
    if (!isStockItem(name)) return;
    const oldQty = parseFloat((oldUsage || {})[name]) || 0;
    const newQty = parseFloat((newUsage || {})[name]) || 0;
    const difference = newQty - oldQty;
    if (difference) recordInventoryMovement({
      date: date, ingredientName: name, qty: -difference,
      type: difference > 0 ? 'production' : 'production_reversal',
      reason: difference > 0 ? 'Used in production batch' : 'Returned from edited production batch',
      referenceId: referenceId
    });
  });
}

function replaceProductionInventory(oldRecord, newUsage, newDate, referenceId) {
  if (oldRecord && oldRecord.date !== newDate) {
    reconcileProductionInventory(oldRecord.usage, {}, oldRecord.date, referenceId);
    reconcileProductionInventory({}, newUsage, newDate, referenceId);
  } else {
    reconcileProductionInventory(oldRecord ? oldRecord.usage : {}, newUsage, newDate, referenceId);
  }
}

/* RFC-style CSV escaping plus formula-injection protection for Excel/Sheets. */
function csvCell(value) {
  var text = String(value == null ? '' : value);
  if (/^[=+\-@]/.test(text)) text = "'" + text;
  return '"' + text.replace(/"/g, '""') + '"';
}
function csvRow(values) { return values.map(csvCell).join(','); }

/* ---------- Toast ---------- */
function showToast(message, type) {
  type = type || 'success';
  const colors = { success: 'bg-emerald-600', error: 'bg-red-600', info: 'bg-amber-500' };
  const icons = { success: 'check-circle', error: 'alert-circle', info: 'info' };
  const el = document.createElement('div');
  el.className = 'toast ' + (colors[type] || 'bg-emerald-600') + ' text-white rounded-xl shadow-lg px-4 py-3 flex items-center gap-3 text-sm font-semibold';
  el.innerHTML = '<i data-lucide="' + (icons[type] || 'info') + '" class="w-5 h-5 shrink-0"></i><span>' + esc(message) + '</span>';
  $('toastContainer').appendChild(el);
  lucide.createIcons();
  setTimeout(function () {
    el.classList.add('out');
    setTimeout(function () { el.remove(); }, 300);
  }, 3200);
}

/* ---------- UI polish helpers ---------- */
/* Fill each responsive table's cells with data-label from its <th> so small
   screens can render rows as labelled cards. Colspan rows (empty states) are
   flagged and styled as friendly empty rows instead. */
function wireResponsiveTables() {
  document.querySelectorAll('table.responsive-table').forEach(function (tbl) {
    var heads = Array.prototype.map.call(tbl.querySelectorAll('thead th'), function (th) {
      return (th.textContent || '').trim();
    });
    if (!heads.length) return;
    tbl.querySelectorAll('tbody tr').forEach(function (tr) {
      if (tr.querySelector('td[colspan]')) { tr.classList.add('empty-row'); return; }
      Array.prototype.forEach.call(tr.querySelectorAll('td'), function (td, i) {
        if (i < heads.length) td.setAttribute('data-label', heads[i]);
      });
    });
  });
}
/* Brief emphasis when a number on screen changes. */
function flashEl(el) {
  if (!el || el.classList.contains('kpi-flash')) return;
  el.classList.add('kpi-flash');
  setTimeout(function () { el.classList.remove('kpi-flash'); }, 550);
}
/* Green pulse on a button after a successful save. */
function pulseSuccess(el) {
  if (!el) return;
  el.classList.remove('save-pulse');
  void el.offsetWidth;
  el.classList.add('save-pulse');
}
function pad2(n) { return (n < 10 ? '0' : '') + n; }
/* Live "saved · synced/offline" pill in the corner. */
function updateAppStatus() {
  var el = $('appStatusBar');
  var txt = $('appStatusText');
  if (!el || !txt) return;
  var d = new Date();
  var hm = pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  var configured = (typeof cloudIsAvailable === 'function') ? cloudIsAvailable() : false;
  var online = (typeof cloudIsOnline === 'function') ? cloudIsOnline() : true;
  var dirty = (typeof syncQueueIsDirty === 'function' ? syncQueueIsDirty() : false)
    || (typeof pendingCloudPushQueued === 'boolean' ? pendingCloudPushQueued : false);
  var label, stateClass;
  if (!configured) { label = 'Local'; stateClass = 'synced'; }
  else if (online && !dirty) { label = 'Synced'; stateClass = 'synced'; }
  else if (online && dirty) { label = 'Syncing…'; stateClass = 'pending'; }
  else if (dirty) { label = 'Offline — will sync'; stateClass = 'pending'; }
  else { label = 'Offline'; stateClass = 'offline'; }
  txt.textContent = hm + ' · ' + label;
  el.classList.remove('synced', 'offline', 'pending');
  el.classList.add(stateClass);
}

/* ---------- Validation ---------- */
function validateNum(input, opts) {
  opts = opts || {};
  const min = opts.min === undefined ? 0 : opts.min;
  const val = parseFloat(input.value);
  if (input.value.trim() === '' || isNaN(val)) { input.classList.add('field-error'); return null; }
  if (!isNaN(val) && val < min) { input.classList.add('field-error'); return null; }
  input.classList.remove('field-error');
  return isNaN(val) ? 0 : val;
}
function validateText(input) {
  if (input.value.trim() === '') { input.classList.add('field-error'); return null; }
  input.classList.remove('field-error');
  return input.value.trim();
}
function clearError(input) { input.classList.remove('field-error'); }
document.querySelectorAll('input, select').forEach(function (el) {
  el.addEventListener('input', function () { clearError(el); });
  el.addEventListener('change', function () { clearError(el); });
});

/* ---------- Tabs ---------- */
document.querySelectorAll('.tab-btn').forEach(function (btn) {
  btn.addEventListener('click', function () {
    document.querySelectorAll('.tab-btn').forEach(function (b) {
      b.classList.remove('active', 'bg-amber-500', 'text-gray-900');
      b.classList.add('bg-gray-800', 'text-gray-200');
    });
    btn.classList.add('active', 'bg-amber-500', 'text-gray-900');
    btn.classList.remove('bg-gray-800', 'text-gray-200');
    document.querySelectorAll('.tab-panel').forEach(function (p) { p.classList.add('hidden'); });
    $('tab-' + btn.dataset.tab).classList.remove('hidden');
    if (btn.dataset.tab === 'dashboard') renderDashboard();
    if (btn.dataset.tab === 'calendar') renderCalendar();
    if (btn.dataset.tab === 'inventory') renderInventory();
    if (btn.dataset.tab === 'customers') renderCustomers();
    if (btn.dataset.tab === 'suppliers') renderSuppliers();
    if (btn.dataset.tab === 'tools') renderTools();
    if (btn.dataset.tab === 'cash') renderCash();
    if (btn.dataset.tab === 'sync') renderSyncTab();
    if (btn.dataset.tab === 'sales') { updateSaleLive(); renderSalesTab(); }
  });
});

