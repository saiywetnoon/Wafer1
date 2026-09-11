/* ============================================================
   CLOUD — online / access-from-anywhere layer
   ============================================================
   A single provider-agnostic interface the app uses to go online.
   Today it is backed by Google (Apps Script multi-tenant cloud in
   google-sync.gs). To swap in another provider later (e.g.
   Supabase), implement the same cloudPush/pull/backup/list/restore
   methods and keep every other module unchanged.

   Model:
   - A workspace is "bound" to a verified Google-account email
     (stored per-company as cfg.cloud.email).
   - When the signed-in Google account matches the bound email the
     workspace is ONLINE: data auto-pulls on open and auto-pushes
     on every change, from any device.
   - If nothing is bound yet, signing in auto-binds and then
     decides whether to pull (cloud has newer/any data) or push
     (this device starts the cloud copy).
   ============================================================ */

function cloudRawIdToken() { return (googleAuthUser && googleAuthUser.rawCredential) || ''; }
/* Account session token first (new login), legacy Google id token second. */
function cloudAccountToken() { return authToken() || cloudRawIdToken(); }
function cloudSignedInEmail() { return authEmail() || ((googleAuthUser && googleAuthUser.email) || ''); }
function cloudCfg() { return getGoogleSyncConfig(); }
function cloudBoundEmail() { return (cloudCfg().cloud || {}).email || ''; }
/* The backend URL: the login screen's saved URL wins, otherwise the old per-company config. */
function cloudEndpoint() { return authServerUrl() || cloudCfg().sheetUrl || ''; }

function setCloudBoundEmail(email) {
  const cfg = getGoogleSyncConfig();
  if (!cfg.cloud) cfg.cloud = {};
  cfg.cloud.email = (email || '').toLowerCase();
  setGoogleSyncConfig(cfg);
}

/* Is this workspace currently ONLINE? In Supabase mode it's online the moment
   a user session exists (no deployment URL needed). */
function cloudIsOnline() {
  if (SUPA.configured()) {
    return !!(SUPA.user && SUPA.user.id);
  }
  const email = cloudSignedInEmail();
  const token = cloudAccountToken();
  if (!token || !email || !cloudEndpoint()) return false;
  if (authEmail()) return true;
  const bound = cloudBoundEmail();
  return !bound || bound.toLowerCase() === email.toLowerCase();
}
/* Is a cloud deployment reachable at all? */
function cloudIsAvailable() {
  if (SUPA.configured()) return true;
  return !!cloudEndpoint() && !!cloudAccountToken();
}
/* Can sync / upload / download run RIGHT NOW?
   Supabase mode needs NO deployment URL — the logged-in session IS the
   connection. Legacy mode still requires the Apps Script URL + a token. */
function cloudReady() {
  if (SUPA.configured()) return !!(SUPA.user && SUPA.user.id);
  return !!cloudEndpoint() && !!cloudAccountToken();
}
function cloudNeedsUrl() {
  return !SUPA.configured();
}
/* Supabase-native push/get (primary path). */
async function supabasePush() {
  const uid = SUPA.user && SUPA.user.id;
  if (!uid) return { ok: false, error: 'Not signed in.' };
  return SUPA.saveLedger(uid, toGooglePayload());
}
async function supabaseGet() {
  const uid = SUPA.user && SUPA.user.id;
  if (!uid) return { ok: false, error: 'Not signed in.' };
  const row = await SUPA.getLedger(uid);
  // A row with `.error` means the READ FAILED — never mistake that for "the
  // cloud is empty" (an emptiness bug let devices overwrite a populated cloud
  // with a stale local copy). `null` means a clean, CONFIRMED empty ledger.
  if (row && row.error) return { ok: false, error: row.error };
  if (!row) return { ok: true, payload: null };
  return { ok: true, payload: row.payload, exportedAt: row.updatedAt, legacy: !!row.legacy };
}
/* True when two states are effectively identical. Ignores bookkeeping stamps
   (updatedAt/version), the draft's capture time, and — crucially — the DERIVED
   finished-good stock. Stock is recomputed from production/sales/waste on every
   render, so two devices holding the same ledger are frequently carrying
   different `stock` snapshots. Comparing the derived number instead of the
   stored field stops phantom "only stock changed" popups after every refresh. */
function statesEqual(a, b) {
  if (!a || !b) return false;
  try {
    return JSON.stringify(normalizeForCompare(a)) === JSON.stringify(normalizeForCompare(b));
  } catch (e) { return false; }
}

/* Count how many meaningful data records a ledger state holds. This is what
   "does this device/cloud have data?" means — the modern ledger uses
   production/sales/purchases/etc., NOT the legacy `entries` field. Using
   `entries` here is what made fresh devices look empty and skip the pull. */
function stateDataCount(s) {
  if (!s) return 0;
  var n = 0;
  if (s.entries) n += Object.keys(s.entries).length;
  if (Array.isArray(s.production)) n += s.production.length;
  if (Array.isArray(s.sales)) n += s.sales.length;
  if (Array.isArray(s.purchases)) n += s.purchases.length;
  if (Array.isArray(s.payments)) n += s.payments.length;
  if (Array.isArray(s.customerPayments)) n += s.customerPayments.length;
  if (Array.isArray(s.expenses)) n += s.expenses.length;
  if (Array.isArray(s.recurringExpenses)) n += s.recurringExpenses.length;
  if (Array.isArray(s.waste)) n += s.waste.length;
  if (Array.isArray(s.recipes)) n += s.recipes.length;
  if (Array.isArray(s.customers)) n += s.customers.length;
  if (Array.isArray(s.suppliers)) n += s.suppliers.length;
  if (s.deletions && typeof s.deletions === 'object') n += Object.keys(s.deletions).length;
  if (s.cash && Array.isArray(s.cash.adjustments)) n += s.cash.adjustments.length;
  if (s.inventory && typeof s.inventory === 'object') n += Object.keys(s.inventory).length;
  if (Array.isArray(s.inventoryMovements)) n += s.inventoryMovements.length;
  // A synced production-form draft is real data too — it must make a fresh
  // device pull it instead of overwriting the cloud with an empty local state.
  if (s.draft && s.draft.date && s.draft.usage && typeof draftHasRealContent === 'function' && draftHasRealContent(s.draft)) n += 1;
  return n;
}

/* Edits arriving from another device (realtime).
   Professional behaviour:
   - Ignore echoes of THIS tab's own writes (no re-render, no message).
     Content comparison alone races while typing: an echo of an earlier
     push arrives after newer local edits, looks "different", and popped
     the "Change From Another Device" modal on the very browser that made
     the change. The per-tab session id stamped on every push is the
     reliable signal — if WE pushed it, the change is already local.
   - NEVER silently replace a different local copy. Pop the sync-review modal so
     the user sees exactly what changed and chooses Accept / Decline.
   - No toast spam — the modal (or a quiet status line) is the notification. */
function supabaseUpdate(uid) {
  if (!uid) return;
  SUPA.subscribeRealtime(uid, function (row) {
    if (!row || !row.payload || !row.payload.state) return;
    const remoteTs = Date.parse(row.updated_at) || 0;
    const dev = row.payload.device || null;
    // Same-tab echo: this browser pushed this exact write a moment ago.
    if (dev && dev.sessionId && typeof getSessionId === 'function' && dev.sessionId === getSessionId()) return;
    // Anything genuinely different gets MERGED (additive — no data loss);
    // only true same-record conflicts open the review modal.
    handleRemoteCopy(row.payload.state, remoteTs, 'Your other device just saved changes', dev);
  });
}
function supabaseWatch(uid) { supabaseUpdate(uid); }
/* Background freshness poll (60s). Realtime is the fast path for other open
   devices, but a silently-failed channel / browser quirk must not leave a tab
   showing stale numbers for hours. Every minute we pull the cloud copy and,
   when it differs from what THIS device has, surface the sync-review modal so
   the user decides (never silently overwrite either copy). */
var cloudPollTimer = null;
function startCloudPolling() {
  if (cloudPollTimer || !SUPA.configured()) return;
  cloudPollTimer = setInterval(async function () {
    try {
      if (!cloudReady()) return;
      const res = await cloudGet();
      const remote = res && res.ok ? res.payload : null;
      if (!remote || !remote.state) return;
      const remoteTs = remote.exportedAt ? Date.parse(remote.exportedAt) : 0;
      // Differs -> merge additively (no data loss); true conflicts go to the
      // review modal. Already-decided copies are handled silently.
      handleRemoteCopy(remote.state, remoteTs || undefined, 'Background sync', (remote && remote.device) || null);
    } catch (e) { /* poll is best-effort */ }
  }, 60000);
}
/* ---------- Low-level: dispatch to Supabase or legacy Apps Script ---------- */
/* Offline-first: every push that cannot reach the cloud marks a persistent
   "pending sync" flag. The next successful online moment (reconnect, page
   load, manual sync) replays the CURRENT state — which contains every change
   made while offline — and clears the flag. When it later collides with a
   different cloud copy, the sync-review modal asks the user Accept/Decline. */
var SYNC_QUEUE_KEY = 'dailyCrispyRollLedger_syncQueue';
var CLOUD_LAST_SYNC_KEY = 'dailyCrispyRollLedger_lastCloudSync';
/* A ledger write is a complete JSON snapshot.  Never let two snapshots race:
   with overlapping requests an OLD request can finish after a NEW request and
   put stale data back into the one cloud row.  This was especially easy to
   trigger while typing because live-sync schedules a save for every edit.
   Calls made during a write request one additional pass; that pass creates its
   payload only after the earlier request finishes, so it always contains the
   newest complete state. */
var cloudPushInFlight = null;
var cloudPushRequested = false;
/* True while the most recent push did NOT reach the cloud (this session).
   Keeps the status pill in a visible "Sync failed — retrying" state instead
   of showing a lie ("Synced") for hours. */
var cloudSyncFailed = false;
function syncQueueMark() { try { localStorage.setItem(SYNC_QUEUE_KEY, JSON.stringify({ at: new Date().toISOString() })); } catch (e) {} }
function syncQueueClear() { try { localStorage.removeItem(SYNC_QUEUE_KEY); } catch (e) {} }
function syncQueueIsDirty() { try { return !!localStorage.getItem(SYNC_QUEUE_KEY); } catch (e) { return false; } }
/* When the cloud LAST confirmed a write. Persisted so the status line and the
   Online/Cloud card can show "Last cloud sync 16:58" honestly. */
function cloudLastSyncAt() { try { return localStorage.getItem(CLOUD_LAST_SYNC_KEY) || ''; } catch (e) { return ''; } }
function cloudMarkLastSync() { try { localStorage.setItem(CLOUD_LAST_SYNC_KEY, new Date().toISOString()); } catch (e) {} }

async function cloudPushOnce() {
  // A dead Supabase session is the #1 silent cause of "nothing has synced since
  // lunch". Refresh the cached session BEFORE pushing so an expired token is
  // either healed or reported instead of quietly returning a 401.
  if (SUPA.configured()) {
    try { await SUPA.sessionUser(); } catch (e) {}
  }
  const res = SUPA.configured() ? await supabasePush() : await cloudPost('save', { payload: toGooglePayload() });
  if (res && res.ok) {
    syncQueueClear();
    cloudMarkLastSync();
    cloudSyncFailed = false;
    if (window.__syncQueueWasDirty) { window.__syncQueueWasDirty = false; }
    try { updateAppStatus(); } catch (e) {}
  } else {
    // Endpoint offline / auth rejected -> queue the change and TELL the user.
    syncQueueMark();
    cloudSyncFailed = true;
    try { updateAppStatus(); } catch (e) {}
    if (typeof updateGoogleSyncStatus === 'function') {
      updateGoogleSyncStatus('Sync failed — changes are saved on this device and will keep retrying.', 'info');
    }
  }
  return res;
}
/* Serialize whole-ledger writes.  This is intentionally the public cloudPush
   entry point so manual upload, auto-save, retry, and merge reconciliation all
   share the same protection. */
function cloudPush() {
  cloudPushRequested = true;
  if (cloudPushInFlight) return cloudPushInFlight;
  cloudPushInFlight = (async function () {
    var lastResult = { ok: false, error: 'No cloud write was started.' };
    try {
      while (cloudPushRequested) {
        cloudPushRequested = false;
        lastResult = await cloudPushOnce();
      }
      return lastResult;
    } finally {
      cloudPushInFlight = null;
    }
  })();
  return cloudPushInFlight;
}
/* Try to send any queued changes now that we are (back) online. */
async function flushPendingSync() {
  if (!cloudReady()) return false;
  if (!syncQueueIsDirty() && !cloudSyncFailed) return true; // nothing pending
  window.__syncQueueWasDirty = true;
  const res = await cloudPush();
  if (res && res.ok) {
    if (typeof updateGoogleSyncStatus === 'function') updateGoogleSyncStatus('Reconnected — syncing changes made while offline.', 'success');
    return true;
  }
  return false;
}
function initSyncFlushers() {
  try {
    window.addEventListener('online', function () { flushPendingSync(); });
    // Auto-heal: while anything is queued (or the last push failed), retry on
    // a quiet 20s heartbeat so the user does not have to reopen the app or
    // press anything for hours of failed attempts to unstick themselves.
    if (!window.__syncRetryTimer) {
      window.__syncRetryTimer = setInterval(function () {
        try {
          if ((syncQueueIsDirty() || cloudSyncFailed) && cloudReady()) flushPendingSync();
        } catch (e) {}
      }, 20000);
    }
    window.addEventListener('beforeunload', function () {
      // A change saved in the last few hundred ms may still be awaiting its
      // debounced cloud push; an un-pushed draft counts too. Send the CURRENT
      // state now so closing the tab can't strand it on this device only.
      if ((syncQueueIsDirty() || pendingCloudPushQueued || (state.draft && state.draft.date)) && cloudReady()) {
        try { cloudPush(); } catch (e) {}
      }
    });
  } catch (e) { /* listeners are best-effort */ }
}
async function cloudGet() {
  if (SUPA.configured()) return supabaseGet();
  const url = cloudEndpoint();
  if (!url) return { ok: false, error: 'No Apps Script URL configured.' };
  if (!cloudAccountToken()) return { ok: false, error: 'Sign in first.' };
  try {
    const u = new URL(url);
    u.searchParams.set('action', 'get');
    u.searchParams.set('token', authToken());
    u.searchParams.set('idToken', cloudRawIdToken());
    const resp = await fetch(u.toString(), { method: 'GET' });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    return await resp.json();
  } catch (e) {
    console.error('cloud GET failed', e);
    return { ok: false, error: String(e) };
  }
}
/* ---------- Legacy Apps-Script helper (only used when not configured) ---------- */
async function cloudPost(action, extra) {
  const url = cloudEndpoint();
  if (!url) return { ok: false, message: 'No Apps Script URL configured.' };
  const authTokenValue = authToken();
  const idToken = cloudRawIdToken();
  if (!authTokenValue && !idToken) return { ok: false, message: 'Sign in first.' };
  const body = Object.assign({ action: action, token: authTokenValue, idToken: idToken }, extra || {});
  try {
    const resp = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body) });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    return await resp.json();
  } catch (e) {
    console.error('cloud POST ' + action + ' failed', e);
    return { ok: false, error: String(e) };
  }
}
async function cloudBackup() { return SUPA.configured() ? { ok: false, message: 'Use Download backup instead (Supabase).' } : cloudPost('backup', { payload: toGooglePayload() }); }
async function cloudList() { return SUPA.configured() ? { ok: true, backups: [] } : cloudPost('list'); }
async function cloudRestore() { return SUPA.configured() ? { ok: false, message: 'Use Download backup instead (Supabase).' } : cloudPost('restore', { fileName: '' }); }
async function cloudClear() { return SUPA.configured() ? { ok: true, message: 'Cleared.' } : cloudPost('clear'); }

/* ============================================================
   REMOTE-CHANGE REVIEW — safe merge + accept / decline
   ------------------------------------------------------------
   The app used to pick a "winner" silently (more records wins,
   timestamps tie-break) and overwrite the other copy. That is
   exactly how data appears to "disappear" between a phone and a
   laptop: the two devices legitimately diverged and one copy was
   clobbered.

   Now every divergence goes through an ADDITIVE MERGE first:
   - Records that exist on only ONE side are KEPT FROM BOTH (a phone
     edit and a laptop edit combine — nothing is deleted).
   - Only true conflicts (the same record edited differently on both
     sides) open the sync-review modal, where the user picks whose
     edit wins for those rows. Both buttons still converge the cloud
     (merge + push), so the question never repeats.
   - Accept / Decline answers are remembered per content copy, so a
     page refresh never re-asks the same question.
   ============================================================ */

var syncReview = { open: false, current: null, pending: null };
var SYNC_REVIEW_DECIDED_KEY = 'dailyCrispyRollLedger_syncReview';

/* Finished-good stock derived from production / sales / waste — mirrors the
   math in rebuildStockAndCogs() so "compare ledgers" and "render ledgers"
   agree on what stock SHOULD be. */
function computeStockSnapshot(o) {
  var events = [];
  (o.production || []).forEach(function (p) { events.push({ date: p.date, type: 0, p: p }); });
  (o.sales || []).forEach(function (s) { events.push({ date: s.date, type: 1, s: s }); });
  (o.waste || []).forEach(function (w) { events.push({ date: w.date, type: 2, w: w }); });
  events.sort(function (a, b) {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    return a.type - b.type;
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
      var costQty = Math.max(0, Math.min(qty, stock.pieces));
      var cost = Math.round(costQty * avg);
      stock.pieces = Math.max(0, stock.pieces - (qty || 0));
      stock.cost = Math.max(0, stock.cost - cost);
    }
  });
  return { pieces: Math.round(stock.pieces), cost: Math.round(stock.cost) };
}
/* Deep-clone a ledger and drop the fields that make TWO IDENTICAL ledgers
   look different: write timestamps, the draft's capture time, and the stored
   stock snapshot (the derived value above is compared instead). */
function normalizeForCompare(o) {
  var c = JSON.parse(JSON.stringify(o));
  delete c.updatedAt; delete c.version;
  if (c.draft && c.draft.capturedAt) delete c.draft.capturedAt;
  c.stock = computeStockSnapshot(c);
  return c;
}

function stateFingerprint(s) {
  if (!s) return '';
  try {
    var n = normalizeForCompare(s);
    return JSON.stringify(n, Object.keys(n).sort());
  } catch (e) { return ''; }
}
/* Accept/Decline answers survive page reloads so a copy the user already
   decided about never pops up again on refresh. */
function syncDecisions() {
  try {
    var raw = (typeof window !== 'undefined' && window.localStorage)
      ? window.localStorage.getItem(SYNC_REVIEW_DECIDED_KEY) : null;
    return raw ? JSON.parse(raw) : {};
  } catch (e) { return {}; }
}
function syncDecision(fp) { return fp ? (syncDecisions()[fp] || null) : null; }
function setSyncDecision(fp, val) {
  if (!fp) return;
  try {
    var m = syncDecisions();
    m[fp] = val;
    var keys = Object.keys(m);
    while (keys.length > 150) { delete m[keys.shift()]; }
    if (window.localStorage) window.localStorage.setItem(SYNC_REVIEW_DECIDED_KEY, JSON.stringify(m));
  } catch (e) { /* best-effort */ }
}
function wasSyncDeclined(fp) { return syncDecision(fp) === 'declined'; }
function wasSyncAccepted(fp) { return syncDecision(fp) === 'accepted'; }

/* Which top-level collections the diff shows, and their icon. */
var SYNC_DIFF_FIELDS = [
  { f: 'production', label: 'Production batches', icon: 'flame' },
  { f: 'sales', label: 'Sales', icon: 'shopping-cart' },
  { f: 'purchases', label: 'Stock purchases', icon: 'shopping-bag' },
  { f: 'payments', label: 'Supplier payments', icon: 'banknote' },
  { f: 'customerPayments', label: 'Customer payments', icon: 'hand-coins' },
  { f: 'suppliers', label: 'Suppliers (shops)', icon: 'store' },
  { f: 'customers', label: 'Customers', icon: 'users' },
  { f: 'expenses', label: 'Expenses', icon: 'receipt' },
  { f: 'recurringExpenses', label: 'Recurring fixed costs', icon: 'repeat' },
  { f: 'waste', label: 'Waste', icon: 'trash-2' },
  { f: 'recipes', label: 'Recipes', icon: 'book-open' },
  { f: 'inventoryMovements', label: 'Inventory movements', icon: 'boxes' }
];

function diffArrEq(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) return a === b;
  if (a.length !== b.length) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}
function diffRecordLabel(it) {
  if (!it) return '?';
  if (it.name) return String(it.name);
  if (it.date) return String(it.date);
  if (it.id) return String(it.id).slice(0, 8);
  return 'row';
}
function diffCollection(localArr, remoteArr) {
  localArr = Array.isArray(localArr) ? localArr : [];
  remoteArr = Array.isArray(remoteArr) ? remoteArr : [];
  if (diffArrEq(localArr, remoteArr)) return null;
  function keyOf(it) {
    if (!it) return JSON.stringify(it);
    return String(it.id || it.name || it.date || it.ingredientName || JSON.stringify(it));
  }
  var lk = {}, rk = {};
  localArr.forEach(function (it) { lk[keyOf(it)] = it; });
  remoteArr.forEach(function (it) { rk[keyOf(it)] = it; });
  var added = remoteArr.filter(function (it) { return !lk[keyOf(it)]; });
  var removed = localArr.filter(function (it) { return !rk[keyOf(it)]; });
  var changed = 0;
  remoteArr.forEach(function (it) {
    var k = keyOf(it);
    if (lk[k] && JSON.stringify(lk[k]) !== JSON.stringify(it)) changed++;
  });
  return {
    local: localArr.length,
    remote: remoteArr.length,
    added: added.map(diffRecordLabel).slice(0, 4),
    removed: removed.map(diffRecordLabel).slice(0, 4),
    changed: changed
  };
}

/* The single entry point for "another copy exists that differs from this
   device". ONE authoritative copy wins everywhere — decided by the user.
   `deviceInfo` (optional) names the browser/phone that saved the remote copy.
   Returns a status string for the caller. */
/* ============================================================
   AUTO-MERGE — hands-free sync (no popups, nothing to click).
   ------------------------------------------------------------
   When two devices both hold data that differs, the ledger rows are
   merged ADDITIVELY by record id: each device's records are different
   rows, so unioning them never loses anything. For the rare case where
   the SAME record was edited on both devices, the copy with the newest
   edit timestamp wins automatically. The result is pushed back to the
   cloud so every device converges. This is what makes sync feel like
   "it just works" — nothing ever pops up, nothing ever needs clicking. */
function recordUnionKey(it) {
  if (!it) return '';
  if (it.id) return 'id:' + it.id;

  if (it.name) return 'name:' + it.name;
  if (it.date) return 'date:' + it.date;
  if (it.ingredientName) return 'ing:' + it.ingredientName;

 return JSON.stringify(it);
}
/* True when the remote copy of a same-record clash should win (newest edit). */
function remoteWins(localIt, remoteIt) {
  var tl = localIt ? Date.parse(localIt.updatedAt) : NaN;
var tr = remoteIt ? Date.parse(remoteIt.updatedAt) : NaN;
if (!isNaN(tl) && !isNaN(tr)) return tr > tl;
if (!isNaN(tr)) return true;   // local is legacy (no stamp) → remote wins
return false;                       // neither stamped → keep local (don't disturb the view
}
function mergeRows(localArr, remoteArr) {
var localArr2 = Array.isArray(localArr) ? localArr : [];
var remoteArr2 = Array.isArray(remoteArr) ? remoteArr : [];
var out = localArr2.map(function (it) { return JSON.parse(JSON.stringify(it)); });
var indexMap = {};
out.forEach(function (it, i) { var k = recordUnionKey(it); if (k) indexMap[k] = i; });
remoteArr2.forEach(function (rit) {
  var k = recordUnionKey(rit);
  if (!k) { out.push(JSON.parse(JSON.stringify(rit))); return; }
  var i = indexMap[k];
  if (i === undefined) {
    out.push(JSON.parse(JSON.stringify(rit)));
    indexMap[k] = out.length - 1;
  } else if (JSON.stringify(out[i]) !== JSON.stringify(rit) && remoteWins(out[i], rit)) {
    out[i] = JSON.parse(JSON.stringify(rit));
  }
});
return out;
}
function mergeEntriesObj(localE, remoteE) {
var out = Object.assign({}, localE || {});
Object.keys(remoteE || {}).forEach(function (d) {
  if (!(d in out)) out[d] = remoteE[d];
  else if (JSON.stringify(out[d]) !== JSON.stringify(remoteE[d]) && remoteWins(out[d], remoteE[d])) out[d] = remoteE[d];
});
return out;
}
function mergeKeyedObj(localO, remoteO) {
var out = Object.assign({}, localO || {});
Object.keys(remoteO || {}).forEach(function (k) {
  if (out[k] === undefined) out[k] = remoteO[k];
  else if (JSON.stringify(out[k]) !== JSON.stringify(remoteO[k]) && remoteWins(out[k], remoteO[k])) out[k] = remoteO[k];
});
return out;
}

/* Merge a remote ledger into the CURRENT state,additively.
   Returns true when anything actually changed. */
function mergeRemoteIntoLocal(r) {
  if (!r) return false;
  var changed = false;

  // Deletion tombstones merge additively too — a delete made on ANY device
  // must reach every other device so removed sales/production never resurrect.
  if (r.deletions && typeof r.deletions === 'object') {
    if (!state.deletions) state.deletions = {};
    var anyNew = false;
    Object.keys(r.deletions).forEach(function (k) {
      if (!state.deletions[k]) { state.deletions[k] = r.deletions[k]; anyNew = true; }
    });
    if (anyNew) changed = true;
  }

  // Record collections — union by id (remote-only rows added; same-id
  // clashes → newest edit wins automatically).
  ['production', 'sales', 'customers', 'suppliers', 'purchases', 'payments',
    'customerPayments', 'expenses', 'recurringExpenses', 'waste', 'priceHistory', 'recipes'].forEach(function (f) {
    var merged = mergeRows(state[f] || [], r[f] || []);
    if (JSON.stringify(merged) !== JSON.stringify(state[f] || [])) { state[f] = merged; changed = true; }
  });

  // Customer debt is DERIVED — normalizeCustomerBalances() is the single source
  // of truth (sales credit minus payments received, plus a manual baseline).
  // The merge above can receive a NEW payment row while the remote customer
  // record is kept stale: customer rows carry no updatedAt stamp, so mergeRows()
  // treats the same-id customer as "not newer" and keeps the local copy. Without
  // this re-derive a phone-recorded repayment would SHOW UP in the statement /
  // cash on the computer while "Total Customer Debt" / "Customer debt owed to
  // you" never dropped. Recompute after the collections merge so both agree.
  if (typeof normalizeCustomerBalances === 'function') {
    var beforeCustomers = JSON.stringify(state.customers || []);
    normalizeCustomerBalances();
    if (JSON.stringify(state.customers || []) !== beforeCustomers) changed = true;
  }
  // Supplier payables are ALSO derived — the payments ledger is the merge-safe
  // truth (new rows always arrive), while the `paid` mutation on the purchase
  // can be dropped by same-timestamp clashes. Replay so the phone's payment
  // lowers "Total Payable (to shops)" and the per-supplier balance here too.
  if (typeof normalizeSupplierPayables === 'function') {
    var beforeSupplierPaid = JSON.stringify(state.purchases || []);
    normalizeSupplierPayables();
    if (JSON.stringify(state.purchases || []) !== beforeSupplierPaid) changed = true;
  }

  // Inventory movement ledger — reuse the existing id-dedupe merge.
  if (Array.isArray(r.inventoryMovements) && r.inventoryMovements.length) {

    var mm = (typeof mergeMovements === 'function')
      ? mergeMovements(state.inventoryMovements || [], r.inventoryMovements)
      : mergeRows(state.inventoryMovements || [], r.inventoryMovements);
    if (JSON.stringify(mm) !== JSON.stringify(state.inventoryMovements || [])) { state.inventoryMovements = mm; changed = true; }
  }
  if (r.inventoryMovementVersion) {
    var mv = Math.max(state.inventoryMovementVersion || 0, r.inventoryMovementVersion);
    if (mv !== (state.inventoryMovementVersion || 0)) { state.inventoryMovementVersion = mv; changed = true; }
  }

  // Purge any records either device has tombstoned (deleted) before the
  // derived balances (stock, customer debt, supplier payables) are rebuilt.
  if (typeof applyDeletionTombstones === 'function' && applyDeletionTombstones()) changed = true;

  // Legacy daily entries (date-keyed object).
  if (r.entries) {
    var me = mergeEntriesObj(state.entries || {}, r.entries);
    if (JSON.stringify(me) !== JSON.stringify(state.entries || {})) { state.entries = me; changed = true; }
  }
  // Price list (name-keyed array; union, new/edited prices win by the same rules).
  if (Array.isArray(r.prices) && r.prices.length) {

    var mp = mergeRows(state.prices || [], r.prices);
    if (JSON.stringify(mp) !== JSON.stringify(state.prices || [])) { state.prices = mp; changed = true; }
  }
  // Settings — remote overrides keys it carries (keeps local extras).
  if (r.settings && typeof r.settings === 'object') {
    var ms = Object.assign({}, state.settings || {}, r.settings);
    if (JSON.stringify(ms) !== JSON.stringify(state.settings || {})) { state.settings = ms; changed = true; }
  }
  // Inventory — union by ingredient (remote wins same-ingredient when newer/unknown).
  if (r.inventory && typeof r.inventory === 'object') {
    var mi = mergeKeyedObj(state.inventory || {}, r.inventory);
    if (JSON.stringify(mi) !== JSON.stringify(state.inventory || {})) { state.inventory = mi; changed = true; }
  }
  // Cash drawer — opening + additive adjustments union.
  if (r.cash) {
    var lc = state.cash || { opening: 0, adjustments: [] };
    var mc = {
      opening: (r.cash.opening !== undefined) ? r.cash.opening : lc.opening,
      adjustments: mergeRows(lc.adjustments || [], r.cash.adjustments || [])
    };
    if (JSON.stringify(mc) !== JSON.stringify(state.cash || {})) { state.cash = mc; changed = true; }
  }
  // Finished-good stock is DERIVED — recompute from the merged ledger.
  if (typeof rebuildStockAndCogs === 'function') {
    var beforeStock = JSON.stringify(state.stock || {});
    try { rebuildStockAndCogs(); } catch (e) { /* best-effort */ }
    if (JSON.stringify(state.stock || {}) !== beforeStock) changed = true;
  }
  // Synced production-form draft — keep the newest (or the only one).
  if (r.draft !== undefined) {
    var md;
    if (!state.draft) md = (r.draft && typeof r.draft === 'object' && r.draft.date) ? JSON.parse(JSON.stringify(r.draft)) : null;
    else if (!r.draft || typeof r.draft !== 'object' || !r.draft.date) md = JSON.parse(JSON.stringify(state.draft));
    else {
      var tdl = state.draft.capturedAt ? Date.parse(state.draft.capturedAt) : NaN;
      var tdr = r.draft.capturedAt ? Date.parse(r.draft.capturedAt) : NaN;
      md = (!isNaN(tdl) && !isNaN(tdr) && tdr > tdl) ? JSON.parse(JSON.stringify(r.draft)) : JSON.parse(JSON.stringify(state.draft));
    }
    if (JSON.stringify(md) !== JSON.stringify(state.draft || null)) { state.draft = md; changed = true; }
  }
  return changed;
}

function handleRemoteCopy(remoteState, remoteTs, source, deviceInfo) {
  if (!remoteState) return 'noop';
  if (statesEqual(state, remoteState)) return 'aligned';

  const localCount = stateDataCount(state);
  const remoteCount = stateDataCount(remoteState);

  // An EMPTY cloud never wipes a populated device -> this device's data is
  // official and is pushed up automatically.
  if (remoteCount === 0 && localCount > 0) {
    try { cloudPush(); } catch (e) {}
    if (typeof updateGoogleSyncStatus === 'function') updateGoogleSyncStatus(source + ': this device’s data uploaded to the cloud.', 'success');
    try { renderCloudStatus(); } catch (e) {}
    return 'pushed';
  }
  // An EMPTY device always adopts the cloud copy (a fresh browser must never
  // clobber the account's data).
  if (localCount === 0 && remoteCount > 0) {
    setCloudSyncSuppressed(true);
    try { applyCloudRemote({ state: remoteState }, remoteTs || undefined, true); }
    finally { setCloudSyncSuppressed(false); }
    renderAll();
    try { loadDraftIfNewer(); } catch (e) {}
    if (typeof updateGoogleSyncStatus === 'function') updateGoogleSyncStatus(source + ': loaded the latest cloud data onto this device.', 'success');
    try { renderCloudStatus(); } catch (e) {}
    return 'pulled';
  }

  // BOTH sides have data -> AUTO-MERGE additively. Hands-free — no modal,
  // nothing to click. Local extras (new sales, edits not yet pushed) are
  // always kept -> zero data loss, zero interruption..
  const changed = mergeRemoteIntoLocal(remoteState);
  if (changed) {
    setCloudSyncSuppressed(true);
    try { saveState(); } catch (e) {}
    try { cloudPush(); } catch (e) {}
    finally { setCloudSyncSuppressed(false); }
    renderAll();
    try { loadDraftIfNewer(); } catch (e) {}
    if (typeof updateGoogleSyncStatus === 'function') {
      const who = (typeof deviceLabelOf === 'function') ? deviceLabelOf(deviceInfo) : '';
      updateGoogleSyncStatus(who ? 'Merged changes from ' + who + '.' : 'Merged changes from another device.', 'info');
    }
    try { renderCloudStatus(); } catch (e) {}
    return 'merged';
  }
  return 'aligned';
}

/* Human-readable list of what a remote copy changes compared to local.
   `conflicts` (optional) lists records that were edited on BOTH sides. */
function buildSyncDiffHtml(local, remote, conflicts) {
  if (!local || !remote) return '<div class="text-gray-500">No data to compare.</div>';
  var lines = [];

  // True conflicts first, so the thing the user MUST decide is front and centre.
  var con = conflicts || [];
  if (con.length) {
    lines.push('<div class="rounded-lg bg-red-950/40 border border-red-800 px-2 py-1.5 mb-1">' +
      '<div class="flex items-center gap-1.5 text-red-300 text-[11px] font-bold mb-1"><i data-lucide="alert-triangle" class="w-3.5 h-3.5"></i> ' +
      con.length + ' record' + (con.length === 1 ? '' : 's') + ' edited on BOTH devices</div>' +
      con.slice(0, 6).map(function (c) {
        return '<div class="text-red-200/80 text-[11px] py-0.5">• ' + esc(c.label) + ' <span class="text-gray-500">(' + (c.field || '') + ')</span></div>';
      }).join('') +
      (con.length > 6 ? '<div class="text-gray-500 text-[10px] pt-0.5">and ' + (con.length - 6) + ' more…</div>' : '') +
      '</div>');
  }

  SYNC_DIFF_FIELDS.forEach(function (def) {
    var d = diffCollection(local[def.f], remote[def.f]);
    if (!d) return;
    var bits = [];
    if (d.remote !== d.local) bits.push(d.local + ' → ' + d.remote + ' records');
    if (d.added.length) bits.push('+' + d.added.length + ' new (' + d.added.join(', ') + ')');
    if (d.removed.length) bits.push(d.removed.length + ' only on this device (kept)');
    if (d.changed) bits.push(d.changed + ' edited');
    lines.push('<div class="flex items-start gap-2 py-2 border-b border-gray-800 last:border-0">' +
      '<i data-lucide="' + def.icon + '" class="w-4 h-4 mt-0.5 text-amber-400 shrink-0"></i>' +
      '<div class="min-w-0"><div class="font-semibold text-gray-200">' + def.label + '</div>' +
      '<div class="text-gray-500 text-[11px] leading-snug">' + bits.join(' · ') + '</div></div></div>');
  });

  // Finished-good stock (derived — not the stored snapshot).
  try {
    var ls = computeStockSnapshot(local), rs = computeStockSnapshot(remote);
    if (ls.pieces !== rs.pieces || ls.cost !== rs.cost) {
      lines.push('<div class="flex items-start gap-2 py-2 border-b border-gray-800 last:border-0">' +
        '<i data-lucide="package" class="w-4 h-4 mt-0.5 text-amber-400 shrink-0"></i>' +
        '<div class="min-w-0"><div class="font-semibold text-gray-200">Finished-good stock</div>' +
        '<div class="text-gray-500 text-[11px]">' + ls.pieces + ' → ' + rs.pieces + ' pieces, ' + fmtKs(ls.cost) + ' → ' + fmtKs(rs.cost) + '</div></div></div>');
    }
  } catch (e) {}
  // Inventory level snapshot (the movement ledger above is the detail view).
  try {
    var lInvKeys = local.inventory ? Object.keys(local.inventory) : [];
    var rInvKeys = remote.inventory ? Object.keys(remote.inventory) : [];
    if (lInvKeys.length !== rInvKeys.length) {
      lines.push('<div class="flex items-start gap-2 py-2 border-b border-gray-800 last:border-0">' +
        '<i data-lucide="boxes" class="w-4 h-4 mt-0.5 text-amber-400 shrink-0"></i>' +
        '<div class="min-w-0"><div class="font-semibold text-gray-200">Inventory items tracked</div>' +
        '<div class="text-gray-500 text-[11px]">' + lInvKeys.length + ' → ' + rInvKeys.length + ' ingredients</div></div></div>');
    }
  } catch (e) {}
  // Cash drawer adjustments.
  try {
    var lAdj = local.cash && local.cash.adjustments ? local.cash.adjustments.length : 0;
    var rAdj = remote.cash && remote.cash.adjustments ? remote.cash.adjustments.length : 0;
    if (lAdj !== rAdj) {
      lines.push('<div class="flex items-start gap-2 py-2 border-b border-gray-800 last:border-0">' +
        '<i data-lucide="coins" class="w-4 h-4 mt-0.5 text-amber-400 shrink-0"></i>' +
        '<div class="min-w-0"><div class="font-semibold text-gray-200">Cash adjustments</div>' +
        '<div class="text-gray-500 text-[11px]">' + lAdj + ' → ' + rAdj + ' items</div></div></div>');
    }
  } catch (e) {}
  // Production-form draft.
  try {
    var lDraft = local.draft ? (local.draft.date || 'saved') : 'empty';
    var rDraft = remote.draft ? (remote.draft.date || 'saved') : 'empty';
    if (String(lDraft) !== String(rDraft)) {
      lines.push('<div class="flex items-start gap-2 py-2 border-b border-gray-800 last:border-0">' +
        '<i data-lucide="file-text" class="w-4 h-4 mt-0.5 text-amber-400 shrink-0"></i>' +
        '<div class="min-w-0"><div class="font-semibold text-gray-200">Production draft</div>' +
        '<div class="text-gray-500 text-[11px]">' + lDraft + ' → ' + rDraft + '</div></div></div>');
    }
  } catch (e) {}

  if (!lines.length) return '<div class="text-gray-500 text-xs py-2">No meaningful difference — the two copies are effectively identical.</div>';
  return lines.join('');
}

function syncReviewTimeText(ts) {
  if (!ts) return '';
  try {
    return new Date(ts).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  } catch (e) { return ''; }
}
/* Open the accept / keep-mine decision modal. The user picks which copy is the
   OFFICIAL ledger: Accept → the other device's data replaces this one; Keep Mine
   → this device's data stays and is uploaded to the cloud. A copy the user
   already decided about (this session or a previous reload) never reopens.
   `deviceInfo` names the exact browser/phone that saved the remote copy. */
function openSyncReview(remoteState, remoteTs, source, deviceInfo) {
  if (!remoteState || typeof document === 'undefined') return false;
  var fp = stateFingerprint(remoteState);
  if (wasSyncDeclined(fp) || wasSyncAccepted(fp)) return false; // already answered
  var modal = document.getElementById('syncReviewModal');
  if (!modal) return false;
  if (syncReview.open) {
    syncReview.pending = { state: remoteState, ts: remoteTs || 0, source: source || '', device: deviceInfo || null };
    return false;
  }
  syncReview.open = true;
  syncReview.current = { state: remoteState, ts: remoteTs || 0, source: source || '', fp: fp, device: deviceInfo || null };
  try {
    var diffEl = document.getElementById('syncReviewDiff');
    if (diffEl) diffEl.innerHTML = buildSyncDiffHtml(state, remoteState);
    var tsEl = document.getElementById('syncReviewTs');
    if (tsEl) tsEl.textContent = syncReviewTimeText(remoteTs) || 'just now';
    // Name the exact device that saved this copy ("Chrome · Windows (PC)").
    var devEl = document.getElementById('syncReviewDevice');
    if (devEl) devEl.textContent = (typeof deviceLabelOf === 'function' ? deviceLabelOf(deviceInfo) : '') || 'unknown device';
    var devIcon = document.getElementById('syncReviewDeviceIcon');
    if (devIcon) devIcon.setAttribute('data-lucide', (deviceInfo && deviceInfo.kind === 'phone') ? 'smartphone' : 'laptop');
    modal.classList.remove('hidden');
  } catch (e) {
    syncReview.open = false;
    syncReview.current = null;
    return false;
  }
  try { if (typeof lucide !== 'undefined' && lucide.createIcons) safeIcons(); } catch (e) {}
  return true;
}

/* The user decided which copy is OFFICIAL:
   - Accept (true): this device adopts the other device's data, then it is
     pushed to the cloud so it is official for every device.
   - Keep Mine (false): this device's data stays untouched and is uploaded to
     the cloud — it becomes the official copy for everyone. Nothing is merged. */
async function resolveSyncReview(accepted) {
  var cur = syncReview.current;
  syncReview.open = false;
  syncReview.current = null;
  var modal = document.getElementById('syncReviewModal');
  if (modal) modal.classList.add('hidden');
  if (!cur) return;

  try {
    if (accepted) {
      if (cur.fp) setSyncDecision(cur.fp, 'accepted');
      setCloudSyncSuppressed(true);
      try {
        if (applyCloudRemote({ state: cur.state }, cur.ts || undefined, true)) {
          renderAll();
          try { loadDraftIfNewer(); } catch (e) {}
          syncQueueClear();
          cloudSyncFailed = false;
          try { await cloudPush(); } catch (e) {}
          if (typeof updateGoogleSyncStatus === 'function') {
            updateGoogleSyncStatus('Accepted — the other device’s data is now the official copy and is synced.', 'success');
          }
          if (typeof showToast === 'function') {
            showToast('Accepted — the other device’s data is now official for this device and the cloud.', 'success');
          }
        } else if (typeof updateGoogleSyncStatus === 'function') {
          updateGoogleSyncStatus('Could not apply the other device’s data.', 'error');
        }
      } finally {
        setCloudSyncSuppressed(false);
      }
    } else {
      // KEEP MINE → this device's data is official; sync it to the cloud NOW.
      if (cur.fp) setSyncDecision(cur.fp, 'declined');
      var up = { ok: false };
      try { up = await cloudPush(); } catch (e) {}
      if (up && up.ok) {
        syncQueueClear();
        cloudSyncFailed = false;
      }
      if (typeof updateGoogleSyncStatus === 'function') {
        updateGoogleSyncStatus(up && up.ok
          ? 'Kept mine — this device’s data is now the official copy and is synced to the cloud.'
          : 'Kept mine — this device’s data stays official; the upload will keep retrying.', up && up.ok ? 'success' : 'error');
      }
      if (typeof showToast === 'function') {
        showToast(up && up.ok
          ? 'Kept mine — this device’s data is now official for everyone.'
          : 'Kept mine — could not reach the cloud yet; retrying in the background.', up && up.ok ? 'success' : 'error');
      }
    }
  } catch (e) { console.warn('sync review resolve failed', e); }
  try { renderCloudStatus(); } catch (e) {}
  // If more updates arrived while the modal was open, process the newest one.
  if (syncReview.pending) {
    var p = syncReview.pending;
    syncReview.pending = null;
    setTimeout(function () { handleRemoteCopy(p.state, p.ts, p.source, p.device); }, 80);
  }
}

/* Wire the modal buttons once (called at the end of boot). */
function initSyncReview() {
  if (window.__syncReviewInit) return;
  window.__syncReviewInit = true;
  var modal = document.getElementById('syncReviewModal');
  if (!modal) return;
  var accept = document.getElementById('syncReviewAcceptBtn');
  var decline = document.getElementById('syncReviewDeclineBtn');
  if (accept) accept.addEventListener('click', function () { resolveSyncReview(true); });
  if (decline) decline.addEventListener('click', function () { resolveSyncReview(false); });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && syncReview.open) resolveSyncReview(false);
  });
}
/* ---------- Merge a remote cloud state into the current workspace ---------- */
/* Copy every listed array field from a remote payload onto state, but only when
   the remote actually carries that array (so a partial copy can never null or
   downgrade a populated local collection). */
function copyArrayFields(remote, fieldNames) {
  fieldNames.forEach(function (field) {
    if (Array.isArray(remote[field])) state[field] = remote[field];
  });
}

function applyCloudRemote(remote, remoteTs, force) {
  if (!remote || !remote.state) return false;
  const r = remote.state;
  // Older/partial cloud rows must not erase newer local history. This is
  // especially important for inventory, where the movement ledger is the
  // source of truth rather than the cached stock snapshot.
  // `force` = the user explicitly chose "Accept" in the sync-review modal,
  // so we honour that decision even if the remote happens to have fewer rows.
  if (!force && stateDataCount(r) < stateDataCount(state)) return false;

  // Scalar / object fields (guarded against empty/partial values).
  if (r.prices && Array.isArray(r.prices) && r.prices.length) state.prices = r.prices;
  if (r.entries) state.entries = r.entries;
  if (r.stock && typeof r.stock === 'object') state.stock = { pieces: parseFloat(r.stock.pieces) || 0, cost: parseFloat(r.stock.cost) || 0 };
  if (r.settings) state.settings = Object.assign({ hourlyWage: 1500 }, r.settings);
  if (r.inventory && typeof r.inventory === 'object') state.inventory = r.inventory;
  if (Array.isArray(r.inventoryMovements) && r.inventoryMovements.length) {
    // Movement ledger is the source of truth: merge, never blind-replace, so a
    // remote/older copy cannot drop local movements.
    state.inventoryMovements = mergeMovements(state.inventoryMovements || [], r.inventoryMovements);
  }
  if (r.inventoryMovementVersion) state.inventoryMovementVersion = r.inventoryMovementVersion;
  if (r.cash) state.cash = Object.assign({ opening: 0, adjustments: [] }, r.cash);

  // A synced production-form draft (auto-saved typing) is part of the ledger.
  if (r.draft !== undefined) {
    state.draft = (r.draft && typeof r.draft === 'object' && r.draft.date) ? Object.assign({}, r.draft) : null;
  }

  // Plain array collections share identical copy semantics.
  copyArrayFields(r, [
    'production', 'sales', 'customers', 'suppliers', 'purchases', 'payments',
    'customerPayments', 'expenses', 'recurringExpenses', 'waste', 'priceHistory', 'recipes'
  ]);

  // A fresh device pulling the cloud must also respect every tombstone.
  if (typeof applyDeletionTombstones === 'function') applyDeletionTombstones();

  // A pulled copy must NEVER render a stale/empty stock: recompute finished-goods
  // stock straight from the freshly pulled production/sales/waste ledger, so the
  // stock card and dashboard are correct the moment this pull lands — even if a
  // later render step is interrupted or the stored snapshot was outdated.
  if (typeof rebuildStockAndCogs === 'function') rebuildStockAndCogs();

  if (typeof normalizeCustomerBalances === 'function') normalizeCustomerBalances();
  if (typeof normalizeSupplierPayables === 'function') normalizeSupplierPayables();
  if (typeof migrateInventoryMovements === 'function') migrateInventoryMovements();
  // The first local render may have populated the form with local defaults; let
  // the cloud copy provide today's / previous production recipe instead.
  // NOTE: we deliberately do NOT wipe draftUsage here — the Production form is
  // only re-populated when the user actually changes the selected date, so a
  // remote pull can never erase quantities that are being typed (see usage.js).
  state.version = 2;
  /* Keep the workspace's "modified" stamp in sync with the remote copy so a
     duplicate/echo event for the same write is recognised as already applied. */
  state.updatedAt = remoteTs ? new Date(remoteTs).toISOString() : new Date().toISOString();
  saveState();
  return true;
}

/* ---------- Reconcile after sign-in ----------
   Pulls the newer copy (cloud -> device) or pushes local when the
   device holds data the cloud doesn't (or a fresh device with
   nothing on it). Works for account login (session token) and
   legacy Google sign-in.

   CONFLICTS ARE DECIDED BY THE USER: when both sides have real data
   and the copies differ, the sync-review modal lists exactly what
   changed and asks Accept (load the cloud copy) or Decline (keep
   this device's copy and push it back up). Nothing is overwritten
   silently anymore — that is what made data "disappear" between a
   phone and a laptop. A fresh device NEVER overwrites a populated
   cloud. */
async function cloudAfterSignIn() {
  const email = cloudSignedInEmail();
  if (!email || !cloudAccountToken()) return false;
  renderCloudStatus();
  if (!cloudReady()) {
    updateGoogleSyncStatus(cloudNeedsUrl()
      ? 'Signed in. Add your Apps Script URL in the Online/Cloud card to go online.'
      : 'Signed in. Syncing your account…', 'info');
    return false;
  }
  // Legacy Google-account binding only (not used in account mode).
  if (!authEmail()) {
    const bound = cloudBoundEmail();
    if (!bound) {
      setCloudBoundEmail(email); // first time -> bind this account to this workspace
      updateGoogleSyncStatus('Bound this workspace to ' + email + '. Syncing now…', 'info');
    } else if (bound.toLowerCase() !== email.toLowerCase()) {
      updateGoogleSyncStatus('This workspace is bound to ' + bound + '. Sign into that Google account to sync it.', 'info');
      renderCloudStatus();
      return false;
    }
  }
  const localCount = stateDataCount(state);
  const res = await cloudGet();
  const remote = res && res.ok ? res.payload : null;
  const remoteState = remote && remote.state ? remote.state : null;
  const remoteIsLegacy = !!(remote && remote.legacy);
  const remoteCount = remoteState ? stateDataCount(remoteState) : 0;
  const remoteTs = remote && remote.exportedAt ? Date.parse(remote.exportedAt) : 0;
  const localTs = state.updatedAt ? Date.parse(state.updatedAt) : 0;

  // Could not READ the cloud (network / RLS / expired session). Never treat this
  // as "cloud empty": showing the local copy is fine, but pushing local data
  // over an unreadable cloud is how synced records get lost. Keep the account
  // copy untouched and retry shortly.
  if (!res || res.ok === false || res.error) {
    updateGoogleSyncStatus('Online as ' + email + ' — could not reach the cloud yet. It will retry automatically.', 'info');
    renderCloudStatus();
    if (!window.__cloudReconcileRetry) {
      window.__cloudReconcileRetry = true;
      setTimeout(function () {
        window.__cloudReconcileRetry = false;
        try { cloudAfterSignIn(); } catch (e) { console.warn('cloud reconcile retry failed', e); }
      }, 8000);
    }
    return true;
  }

  // Same content both sides -> nothing to do.
  if (remoteState && statesEqual(state, remoteState)) {
    if (remoteIsLegacy) {
      const migrated = await cloudPush();
      if (!migrated || !migrated.ok) {
        updateGoogleSyncStatus('Could not create the shared workspace yet; retrying automatically.', 'info');
        return false;
      }
      updateGoogleSyncStatus('Created the shared workspace. All approved accounts now see this ledger.', 'success');
      renderCloudStatus();
      return true;
    }
    updateGoogleSyncStatus('Online as ' + email + '. Your ledger is up to date.', 'success');
    renderCloudStatus();
    return true;
  }

  // Cloud has data and this device has none -> PULL. A fresh browser must never
  // push its empty/default state over a populated cloud.
  if (remoteCount > 0 && localCount === 0) {
    if (applyCloudRemote(remote, remoteTs || undefined)) {
      renderAll();
      updateGoogleSyncStatus('Online as ' + email + '. Loaded your cloud data onto this device.', 'success');
      showToast('Loaded your ' + remoteCount + ' records from the cloud.', 'success');
      try { loadDraftIfNewer(); } catch (e) {}
    }
    if (remoteIsLegacy) await cloudPush();
    renderCloudStatus();
    return true;
  }

  // Cloud is empty (and local empty too) -> brand-new account, nothing to sync.
  if (remoteCount === 0 && localCount === 0) {
    showToast('Online as ' + email + '. Your entries will auto-save to your account.', 'success');
    updateGoogleSyncStatus('Online as ' + email + '. Auto-save is on.', 'success');
    renderCloudStatus();
    return true;
  }

  // Cloud empty, this device has data -> first sync: adopt local UP.
  if (remoteCount === 0) {
    const up = await cloudPush();
    if (up && up.ok) showToast('Uploaded this device’s ' + localCount + ' records to the cloud.', 'success');
    else showToast('Could not upload to cloud yet — it is queued and will retry.', 'error');
    updateGoogleSyncStatus('Online as ' + email + '. Uploaded local data to cloud.', 'success');
    renderCloudStatus();
    return true;
  }

  // Both sides have real data and the copies differ — merge additively (no data
  // loss). Only true same-record conflicts open the review modal, and a copy
  // the user already decided about is handled silently.
  const status = handleRemoteCopy(remoteState, remoteTs || undefined, 'Reconcile after sign-in', (remote && remote.device) || null);
  if (status === 'merged') {
    updateGoogleSyncStatus('Online as ' + email + '. Merged changes from another device.', 'success');
  } else if (status === 'pushed') {
    updateGoogleSyncStatus('Online as ' + email + '. Uploaded this device’s data to the cloud.', 'success');
  } else if (status === 'pulled') {
    updateGoogleSyncStatus('Online as ' + email + '. Loaded the cloud data onto this device.', 'success');
  } else if (status === 'aligned') {
    updateGoogleSyncStatus('Online as ' + email + '. Your ledger is up to date.', 'success');
  } else {
    updateGoogleSyncStatus('Online as ' + email + '.', 'success');
  }
  renderCloudStatus();
  return true;
}
