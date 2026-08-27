/* ---------- State ---------- */
let state = {
  version: 2,
  prices: JSON.parse(JSON.stringify(DEFAULT_PRICES)),
  entries: {},          // legacy (pre-accounts) — migrated into production/sales on first load
  production: [],       // batches you ROLLED: { id, date, pieces, bags, usage, additionalCost, capital, laborMinutes, laborCost, costPerPiece }
  sales: [],            // what you SOLD: { id, date, bags, pieces, price, amount, cogs, avgCost, net }
  stock: { pieces: 0, cost: 0 }, // finished goods ready to sell (cost basis for cogs)
  settings: { hourlyWage: 1500 },
  inventory: {},   // { ingredientName: { stock (derived snapshot), lowAlert } }
  inventoryMovements: [], // [{ id, date, ingredientName, qty (+/-), type, reason, referenceId }]
  inventoryMovementVersion: 0,
  customers: [],   // [{ id, name, phone, standingOrder, price, debt }]
  suppliers: [],   // [{ id, name, phone }]
  purchases: [],   // [{ id, supplierId, date, items: [{name, qty, unit, price, amount}], itemTotal, paidNow, note }]
  payments: [],    // [{ id, supplierId, date, amount }]
  customerPayments: [], // [{ id, customerId, date, amount }]  cash received when a customer repays debt
  expenses: [],    // [{ date, amount, desc }] one-time expenses
  recurringExpenses: [], // [{ id, name, amount }] monthly fixed costs (rent, net etc.)
  waste: [],       // [{ date, qty }] pieces scrapped
  priceHistory: [],// [{ date, name, old, new }]
  recipes: [],     // [{ name, usage }] reusable production formulas
  cash: { opening: 0, adjustments: [] }, // [{ id, date, amount, label }]
  updatedAt: null
};
let draftUsage = {};
let saveTimer = null;
let googleSyncTimer = null;
let draftSaveTimer = null;
let draftGoogleSyncTimer = null;
let draftRestored = false;

let cloudAutoSync = false;
function setCloudAutoSync(v) { cloudAutoSync = !!v; }
/* When true, the next saveState() persists locally but does NOT push to the
   cloud. Used while applying a real-time update we received from the server, so
   we never echo it back (which would re-trigger an event and loop forever). */
let cloudSyncSuppressed = false;
function setCloudSyncSuppressed(v) { cloudSyncSuppressed = !!v; }

/* ---------- Persistence (debounced) ---------- */
function persistState() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveState, 300);
}
function saveState() {
  state.updatedAt = new Date().toISOString();
  try {
    localStorage.setItem(companyStateKey(), JSON.stringify(state));
    // Every save also pushes to the cloud automatically when online (like a real app).
    // This ensures price, stock and any other edit reaches other devices without
    // a manual "upload". Guarded until boot/reconcile finishes.
    if (cloudAutoSync && !cloudSyncSuppressed && typeof triggerGoogleSync === 'function') {
      triggerGoogleSync();
    }
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
      if (parsed && parsed.inventory && typeof parsed.inventory === 'object') state.inventory = parsed.inventory;
      if (parsed && Array.isArray(parsed.inventoryMovements)) state.inventoryMovements = parsed.inventoryMovements;
      if (parsed && parsed.inventoryMovementVersion) state.inventoryMovementVersion = parsed.inventoryMovementVersion;
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
      if (parsed && Array.isArray(parsed.recipes)) state.recipes = parsed.recipes;
      if (parsed && parsed.cash && typeof parsed.cash === 'object') {
        state.cash = Object.assign({ opening: 0, adjustments: [] }, parsed.cash);
        if (!Array.isArray(state.cash.adjustments)) state.cash.adjustments = [];
      }
      if (parsed && parsed.updatedAt) state.updatedAt = parsed.updatedAt;
      // Production / Sales / Stock (v3 — separate roll dates from sale dates)
      if (Array.isArray(parsed.production)) state.production = parsed.production;
      if (Array.isArray(parsed.sales)) state.sales = parsed.sales;
      if (parsed.stock && typeof parsed.stock === 'object') {
        state.stock = { pieces: parseFloat(parsed.stock.pieces) || 0, cost: parseFloat(parsed.stock.cost) || 0 };
      }
      state.version = 2;
      if (typeof migrateInventoryMovements === 'function' && migrateInventoryMovements()) saveState();
    }
  } catch (e) { console.warn('Failed to load state', e); }
}

/* One-time migration: older saved ledgers kept one "Daily entry" that bundled
   production + sale on the same date. Split them into production[] (rolled)
   and sales[] (sold that day), seed the finished-goods stock, then clear the
   old entries so nothing is double-counted. */
function migrateLegacyEntries() {
  var legacy = state.entries || {};
  var keys = Object.keys(legacy);
  if ((state.production && state.production.length) || !keys.length) {
    if (!keys.length) state.entries = {};
    return;
  }
  keys.forEach(function (date) {
    var e = legacy[date] || {};
    var pieces = parseInt(e.pieces, 10) || 0;
    var bags = parseInt(e.bagsProduced, 10) || 0;
    var soldBags = parseInt(e.bagsSold, 10) || 0;
    var capital = parseFloat(e.capital) || 0;
    var laborHrs = (parseFloat(e.laborMinutes) || 0) / 60;
    var laborCost = parseFloat(e.laborCost) || (laborHrs * (state.settings.hourlyWage || 1500));
    var soldPieces = 0;
    if (pieces > 0 && bags > 0 && soldBags > 0) soldPieces = Math.round(soldBags * (pieces / bags));
    else soldPieces = soldBags;
    if (pieces > 0 || capital > 0) {
      var mixW = totalMixWeightFor(e.usage || {});
      var wpr = pieces > 0 && mixW > 0 ? Math.round((mixW / pieces) * 100) / 100 : 0;
      state.production.push({
        id: uid(), date: date, pieces: pieces, bags: bags,
        weightPerRoll: wpr, mixWeight: Math.round(mixW),
        expectedRolls: wpr > 0 ? Math.floor(mixW / wpr) : 0, notes: '',
        usage: e.usage || {}, additionalCost: parseFloat(e.additionalCost) || 0,
        capital: Math.round(capital), laborMinutes: parseFloat(e.laborMinutes) || 0,
        laborCost: Math.round(laborCost),
        costPerPiece: pieces > 0 ? Math.round(capital / pieces * 100) / 100 : 0
      });
    }
    if (soldBags > 0 || parseFloat(e.revenue) > 0) {
      state.sales.push({
        id: uid(), date: date, bags: soldBags, pieces: soldPieces,
        price: parseFloat(e.price) || 0, amount: Math.round(parseFloat(e.revenue) || 0),
        cogs: 0, avgCost: 0, net: 0
      });
    }
  });
  state.entries = {};
  saveState();
  rebuildStockAndCogs();
  saveState();
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
    weightPerRoll: $('logWeightPerRoll') ? (parseFloat($('logWeightPerRoll').value) || 0) : 0,
    notes: $('logNotes') ? ($('logNotes').value || '') : '',
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
    const existing = (state.production || []).find(function (p) { return p.date === d.date; });
    if (existing) return; // A saved production exists for that date → don't overwrite with draft
    draftUsage = Object.assign({}, d.usage);
    $('logDate').value = d.date || today();
    $('additionalCost').value = d.additionalCost || 0;
    $('logBagsProduced').value = d.bagsProduced || 0;
    $('logPieces').value = d.pieces || 0;
    $('logWeightPerRoll').value = d.weightPerRoll || 0;
    $('logNotes').value = d.notes || '';
    $('logLabor').value = d.laborMinutes || 0;
    $('hourlyWage').value = d.hourlyWage || state.settings.hourlyWage || 1500;
    draftRestored = true;
  } catch (e) { console.warn('Failed to restore draft', e); }
}
function clearDraft() {
  try { localStorage.removeItem(companyDraftKey()); } catch (e) {}
}

