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
  draft: null,   // the LIVE production-form draft — synced to the cloud like any other field
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
/* True between a save and the 700ms debounced cloud push actually starting.
   Lets the beforeunload handler know a fresh change may still be awaiting its
   push, so closing the tab can flush it instead of stranding it locally. */
let pendingCloudPushQueued = false;
/* The user has been offered their stale (previous-day) draft once per session. */
let olderDraftPrompted = false;
/* True as soon as the user edits the production form — used to distinguish
   "the user typed something" from "the default recipe just pre-filled". */
let draftTouched = false;

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
  if (typeof updateAppStatus === 'function') {
    try { updateAppStatus(); } catch (e) { /* status pill is best-effort */ }
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
      // Synced production-form draft (auto-saved typing, cross-device).
      if (parsed && parsed.draft && typeof parsed.draft === 'object' && parsed.draft.date && parsed.draft.usage) {
        state.draft = parsed.draft;
      } else if (parsed && 'draft' in parsed) {
        state.draft = null;
      }
      // Production / Sales / Stock (v3 — separate roll dates from sale dates)
      if (Array.isArray(parsed.production)) state.production = parsed.production;
      if (Array.isArray(parsed.sales)) state.sales = parsed.sales;
      if (parsed.stock && typeof parsed.stock === 'object') {
        state.stock = { pieces: parseFloat(parsed.stock.pieces) || 0, cost: parseFloat(parsed.stock.cost) || 0 };
      }
      state.version = 2;
      if (typeof migrateInventoryMovements === 'function' && migrateInventoryMovements()) saveState();
      if (typeof normalizeCustomerBalances === 'function') {
        normalizeCustomerBalances();
        saveState();
      }
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
    hourlyWage: $('hourlyWage') ? (parseFloat($('hourlyWage').value) || 0) : 0,
    useBy: $('logUseBy') ? ($('logUseBy').value || '') : ''
  };
}
/* Auto-save the production form WITHOUT needing the Save button. The draft now
   lives INSIDE the ledger state, so saveState() puts it on this device AND (as
   soon as we are online) pushes it to the cloud automatically. Offline →
   stored locally + queued, and flushed on the next online moment.
   The draft value + mirror are updated on EVERY keystroke (crash/close-safe);
   only the heavier full-state save and cloud push are debounced. */
function persistDraft() {
  try {
    state.draft = Object.assign({ capturedAt: new Date().toISOString() }, captureDraft());
    try { localStorage.setItem(companyDraftKey(), JSON.stringify(state.draft)); } catch (e) {}
  } catch (e) { console.warn('Could not save draft', e); return; }
  clearTimeout(draftSaveTimer);
  draftSaveTimer = setTimeout(saveState, 400);
}
/* True when a saved draft represents real in-progress work. Blank / all-zero
   drafts must NOT be restored — they would otherwise hide the previous day's
   recipe that should prefill today's production form (setDefaultProductionUsage()
   bails out as soon as draftUsage has any key). */
function draftHasRealContent(d) {
  if (!d) return false;
  const usage = d.usage || {};
  const anyUsage = Object.keys(usage).some(function (k) { return toFinite(usage[k]) > 0; });
  return anyUsage
    || toFinite(d.bagsProduced) > 0
    || toFinite(d.pieces) > 0
    || toFinite(d.laborMinutes) > 0
    || toFinite(d.additionalCost) > 0
    || String(d.notes || '').trim() !== '';
}
function loadDraftIfNewer() {
  if (draftRestored) return;
  try {
    // Drafts are part of the SYNCED ledger state now; the localStorage mirror is
    // only a legacy/bootstrap fallback (and gets promoted into state on use).
    let d = state.draft || null;
    let local = null;
    try {
      const raw = localStorage.getItem(companyDraftKey());
      if (raw) local = JSON.parse(raw);
    } catch (e) { local = null; }
    if (!d && local) {
      // Older builds never synced this draft — promote it so the next save
      // pushes it up to the cloud automatically.
      state.draft = Object.assign({ capturedAt: new Date().toISOString() }, local);
      d = state.draft;
    }
    if (!d || !d.usage) {
      if (local && !draftHasRealContent(local)) clearDraftLocalMirror();
      return;
    }
    const existing = (state.production || []).find(function (p) { return p.date === d.date; });
    if (existing || !draftHasRealContent(d)) {
      // A committed batch already covers that day (or this is an all-zero
      // draft): drop the stale draft instead of letting it linger / re-push.
      clearDraftLocalMirror();
      if (state.draft) { state.draft = null; try { saveState(); } catch (e) {} }
      return;
    }
    // A draft from an earlier day (e.g. typed yesterday, tab closed before the
    // Save button was pressed) is offered once so it can be reviewed, instead
    // of this device discarding it.
    if (d.date !== today()) { applyStaleDraftRecovery(d); return; }
    restoreDraftToForm(d);
  } catch (e) { console.warn('Failed to restore draft', e); }
}
/* Put a draft's values back into the production form. */
function restoreDraftToForm(d) {
  draftUsage = Object.assign({}, d.usage);
  const fields = {
    logDate: d.date || today(),
    additionalCost: d.additionalCost || 0,
    logBagsProduced: d.bagsProduced || 0,
    logPieces: d.pieces || 0,
    logWeightPerRoll: d.weightPerRoll || 0,
    logNotes: d.notes || '',
    logLabor: d.laborMinutes || 0,
    hourlyWage: d.hourlyWage || state.settings.hourlyWage || 1500
  };
  Object.keys(fields).forEach(function (id) {
    const el = $(id);
    if (el) el.value = fields[id];
  });
  if ($('logUseBy')) $('logUseBy').value = d.useBy || '';
  draftRestored = true;
  // Move the form to the draft's date so the saved values are actually visible.
  if (typeof populateProductionForm === 'function') {
    try { populateProductionForm(d.date || today()); } catch (e) {}
  }
}
/* Remove the legacy localStorage mirror of the draft. */
function clearDraftLocalMirror() {
  try { localStorage.removeItem(companyDraftKey()); } catch (e) {}
}
/* A draft from a previous day is real, unsent work. Prompt once so it can be
   reviewed and saved as a normal batch. Declining keeps the draft in the synced
   state and the mirror — nothing is deleted by ignoring the prompt. */
function applyStaleDraftRecovery(d) {
  if (olderDraftPrompted) return;
  olderDraftPrompted = true;
  const ok = confirm(
    'You have a production draft from ' + d.date +
    ' (numbers typed but never added to stock).\n\n' +
    'Load it into the form now? (It has already auto-saved to this device and will sync to your account.)'
  );
  if (!ok) return;
  restoreDraftToForm(d);
  if (typeof updateDraftHint === 'function') { try { updateDraftHint(); } catch (e) {} }
  showToast('Loaded your draft from ' + d.date + '. Press Save Production Work when you want it added to stock.', 'info');
}
function clearDraft() {
  state.draft = null;
  try { localStorage.removeItem(companyDraftKey()); } catch (e) {}
  try { saveState(); } catch (e) {} // push the cleared-draft state so other devices stop showing it
}

