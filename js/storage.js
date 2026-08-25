/* ---------- State ---------- */
let state = {
  version: 2,
  prices: JSON.parse(JSON.stringify(DEFAULT_PRICES)),
  entries: {},
  settings: { hourlyWage: 1500 },
  inventory: {},   // { ingredientName: { stock, lowAlert } }
  customers: [],   // [{ id, name, phone, standingOrder, price, debt }]
  suppliers: [],   // [{ id, name, phone }]
  purchases: [],   // [{ id, supplierId, date, items: [{name, qty, unit, price, amount}], itemTotal, paidNow, note }]
  payments: [],    // [{ id, supplierId, date, amount }]
  customerPayments: [], // [{ id, customerId, date, amount }]  cash received when a customer repays debt
  expenses: [],    // [{ date, amount, desc }] one-time expenses
  recurringExpenses: [], // [{ id, name, amount }] monthly fixed costs (rent, net etc.)
  waste: [],       // [{ date, qty }] pieces scrapped
  priceHistory: [],// [{ date, name, old, new }]
  cash: { opening: 0, adjustments: [] }, // [{ id, date, amount, label }]
  updatedAt: null
};
let draftUsage = {};
let saveTimer = null;
let googleSyncTimer = null;
let draftSaveTimer = null;
let draftGoogleSyncTimer = null;
let draftRestored = false;

/* ---------- Persistence (debounced) ---------- */
function persistState() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveState, 300);
}
function saveState() {
  state.updatedAt = new Date().toISOString();
  try {
    localStorage.setItem(companyStateKey(), JSON.stringify(state));
  } catch (e) {
    console.error('Failed to save state:', e);
    showToast('Warning: Storage is full — export your data soon.', 'error');
  }
}
function loadState() {
  try {
    const raw = localStorage.getItem(companyStateKey());
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && parsed.entries) state.entries = parsed.entries;
      if (parsed && Array.isArray(parsed.prices) && parsed.prices.length) state.prices = parsed.prices;
      if (parsed && parsed.settings) state.settings = Object.assign({ hourlyWage: 1500 }, parsed.settings);
      if (parsed && parsed.customers) state.customers = parsed.customers;
      if (parsed && parsed.suppliers) state.suppliers = parsed.suppliers;
      if (parsed && parsed.purchases) state.purchases = parsed.purchases;
      if (parsed && parsed.payments) state.payments = parsed.payments;
      // v2 fields (migrate older saved ledgers to the new shape)
      if (parsed && parsed.customerPayments) state.customerPayments = parsed.customerPayments;
      if (parsed && Array.isArray(parsed.expenses)) state.expenses = parsed.expenses;
      if (parsed && Array.isArray(parsed.recurringExpenses)) state.recurringExpenses = parsed.recurringExpenses;
      if (parsed && Array.isArray(parsed.waste)) state.waste = parsed.waste;
      if (parsed && Array.isArray(parsed.priceHistory)) state.priceHistory = parsed.priceHistory;
      if (parsed && parsed.cash && typeof parsed.cash === 'object') {
        state.cash = Object.assign({ opening: 0, adjustments: [] }, parsed.cash);
        if (!Array.isArray(state.cash.adjustments)) state.cash.adjustments = [];
      }
      if (parsed && parsed.updatedAt) state.updatedAt = parsed.updatedAt;
      state.version = 2;
    }
  } catch (e) { console.warn('Failed to load state', e); }
}

/* ---------- Draft Persistence (auto-save before refresh) ---------- */
function captureDraft() {
  const usage = {};
  document.querySelectorAll('.usage-input').forEach(function (inp) {
    const name = inp.dataset.name;
    const v = parseFloat(inp.value);
    usage[name] = (!isNaN(v) && v >= 0) ? v : 0;
  });
  return {
    updatedAt: new Date().toISOString(),
    date: $('logDate') ? $('logDate').value : today(),
    usage: usage,
    additionalCost: $('additionalCost') ? (parseFloat($('additionalCost').value) || 0) : 0,
    bagsProduced: $('logBagsProduced') ? (parseFloat($('logBagsProduced').value) || 0) : 0,
    pieces: $('logPieces') ? (parseFloat($('logPieces').value) || 0) : 0,
    bagsSold: $('logBagsSold') ? (parseFloat($('logBagsSold').value) || 0) : 0,
    price: $('logPrice') ? (parseFloat($('logPrice').value) || 0) : 1300,
    laborMinutes: $('logLabor') ? (parseFloat($('logLabor').value) || 0) : 0,
    hourlyWage: $('hourlyWage') ? (parseFloat($('hourlyWage').value) || 0) : 0
  };
}
function persistDraft() {
  clearTimeout(draftSaveTimer);
  draftSaveTimer = setTimeout(function () {
    try { localStorage.setItem(companyDraftKey(), JSON.stringify(captureDraft())); } catch (e) { console.warn('Could not save draft', e); }
  }, 400);
}
function loadDraftIfNewer() {
  if (draftRestored) return;
  try {
    const raw = localStorage.getItem(companyDraftKey());
    if (!raw) return;
    const d = JSON.parse(raw);
    if (!d || !d.usage) return;
    // Only restore draft if it's for today or is newer than a full entry on that date
    if (d.date !== today()) return;
    const existing = state.entries[d.date];
    if (existing) return; // A saved entry exists → don't overwrite with draft
    draftUsage = Object.assign({}, d.usage);
    $('logDate').value = d.date || today();
    $('additionalCost').value = d.additionalCost || 0;
    $('logBagsProduced').value = d.bagsProduced || 0;
    $('logPieces').value = d.pieces || 0;
    $('logBagsSold').value = d.bagsSold || 0;
    $('logPrice').value = d.price || 1300;
    $('logLabor').value = d.laborMinutes || 0;
    $('hourlyWage').value = d.hourlyWage || state.settings.hourlyWage || 1500;
    draftRestored = true;
  } catch (e) { console.warn('Failed to restore draft', e); }
}
function clearDraft() {
  try { localStorage.removeItem(companyDraftKey()); } catch (e) {}
}

