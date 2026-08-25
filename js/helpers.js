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
  });
});

