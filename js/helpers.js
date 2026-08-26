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
      var s = ev.s;
      var avg = stock.pieces > 0 ? (stock.cost / stock.pieces) : 0;
      var cogs = Math.round((s.pieces || 0) * avg);
      s.cogs = cogs;
      s.avgCost = Math.round(avg * 100) / 100;
      s.net = Math.round((s.amount || 0) - cogs);
      stock.pieces = Math.max(0, stock.pieces - (s.pieces || 0));
      stock.cost = Math.max(0, stock.cost - cogs);
    }
  });
  if (!state.stock) state.stock = { pieces: 0, cost: 0 };
  state.stock.pieces = Math.round(stock.pieces);
  state.stock.cost = Math.round(stock.cost);
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
    const item = (state.inventory || {})[ing.name];
    const stock = item ? (parseFloat(item.stock) || 0) : 0;
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

