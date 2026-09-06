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
  if (!row) return { ok: false, payload: null };
  return { ok: true, payload: row.payload, exportedAt: row.updatedAt };
}
/* True when two states are effectively identical (ignores bookkeeping stamps
   such as updatedAt/version). Used to ignore echoes of our own writes. */
function statesEqual(a, b) {
  if (!a || !b) return false;
  function pure(o) {
    const c = JSON.parse(JSON.stringify(o));
    delete c.updatedAt; delete c.version;
    return JSON.stringify(c);
  }
  return pure(a) === pure(b);
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
   - Ignore echoes of THIS device's own writes (no re-render, no message).
   - NEVER silently replace a different local copy. Pop the sync-review modal so
     the user sees exactly what changed and chooses Accept / Decline.
   - No toast spam — the modal (or a quiet status line) is the notification. */
function supabaseUpdate(uid) {
  if (!uid) return;
  SUPA.subscribeRealtime(uid, function (row) {
    if (!row || !row.payload || !row.payload.state) return;
    if (statesEqual(state, row.payload.state)) return;       // echo of our own write
    const remoteTs = Date.parse(row.updated_at) || 0;
    // Ask the user to review/accept/decline instead of overwriting either copy.
    openSyncReview(row.payload.state, remoteTs, 'Your other device just saved changes');
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
      if (statesEqual(state, remote.state)) return; // aligned already
      const remoteTs = remote.exportedAt ? Date.parse(remote.exportedAt) : 0;
      // Never auto-downgrade a richer local copy and never auto-replace a
      // different local copy — ask the user which version to keep.
      openSyncReview(remote.state, remoteTs || undefined, 'Background sync');
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

async function cloudPush() {
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
   REMOTE-CHANGE REVIEW — accept / decline conflict resolution
   ------------------------------------------------------------
   The app used to pick a "winner" silently (more records wins,
   timestamps tie-break) and overwrite the other copy. That is
   exactly how data appears to "disappear" between a phone and a
   laptop: the two devices legitimately diverged and one copy was
   clobbered. From now on, when a remote copy differs from what a
   device has, the sync-review modal shows WHAT changed and asks the
   user to Accept (load the remote copy) or Decline (keep this
   device's copy and push it back up). Nothing is overwritten until
   the user decides.
   ============================================================ */

var syncReview = { open: false, current: null, pending: null };
var syncReviewDeclined = {}; // content-fingerprint -> true (this session)

function stateFingerprint(s) {
  if (!s) return '';
  try {
    var c = JSON.parse(JSON.stringify(s));
    delete c.updatedAt; delete c.version;
    return JSON.stringify(c, Object.keys(c).sort());
  } catch (e) { return ''; }
}
function wasSyncDeclined(fp) { return !!(fp && syncReviewDeclined[fp]); }
function markSyncDeclined(fp) {
  if (!fp) return;
  syncReviewDeclined[fp] = true;
  var keys = Object.keys(syncReviewDeclined);
  while (keys.length > 60) { delete syncReviewDeclined[keys.shift()]; }
}

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
/* Human-readable list of what a remote copy changes compared to local. */
function buildSyncDiffHtml(local, remote) {
  if (!local || !remote) return '<div class="text-gray-500">No data to compare.</div>';
  var lines = [];

  SYNC_DIFF_FIELDS.forEach(function (def) {
    var d = diffCollection(local[def.f], remote[def.f]);
    if (!d) return;
    var bits = [];
    if (d.remote !== d.local) bits.push(d.local + ' → ' + d.remote + ' record' + (d.remote === 1 ? '' : 's'));
    if (d.added.length) bits.push('+' + d.added.length + ' new (' + d.added.join(', ') + ')');
    if (d.removed.length) bits.push('−' + d.removed.length + ' removed (' + d.removed.join(', ') + ')');
    if (d.changed) bits.push(d.changed + ' edited');
    lines.push('<div class="flex items-start gap-2 py-2 border-b border-gray-800 last:border-0">' +
      '<i data-lucide="' + def.icon + '" class="w-4 h-4 mt-0.5 text-amber-400 shrink-0"></i>' +
      '<div class="min-w-0"><div class="font-semibold text-gray-200">' + def.label + '</div>' +
      '<div class="text-gray-500 text-[11px] leading-snug">' + bits.join(' · ') + '</div></div></div>');
  });

  // Finished-good stock.
  try {
    if (JSON.stringify(local.stock || null) !== JSON.stringify(remote.stock || null)) {
      lines.push('<div class="flex items-start gap-2 py-2 border-b border-gray-800 last:border-0">' +
        '<i data-lucide="package" class="w-4 h-4 mt-0.5 text-amber-400 shrink-0"></i>' +
        '<div class="min-w-0"><div class="font-semibold text-gray-200">Finished-good stock</div>' +
        '<div class="text-gray-500 text-[11px]">' + (local.stock && local.stock.pieces || 0) + ' → ' + (remote.stock && remote.stock.pieces || 0) + ' pieces</div></div></div>');
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
/* Open the accept/decline modal for a remote copy. Returns true when a modal
   was opened; false when the copy was already declined this session or another
   review is showing (in which case it is remembered and offered next). */
function openSyncReview(remoteState, remoteTs, source) {
  if (!remoteState || typeof document === 'undefined') return false;
  var fp = stateFingerprint(remoteState);
  if (wasSyncDeclined(fp)) return false; // user already answered this exact copy
  var modal = document.getElementById('syncReviewModal');
  if (!modal) return false;
  if (syncReview.open) {
    syncReview.pending = { state: remoteState, ts: remoteTs || 0, source: source || '' };
    return false;
  }
  syncReview.open = true;
  syncReview.current = { state: remoteState, ts: remoteTs || 0, source: source || '', fp: fp };
  try {
    var diffEl = document.getElementById('syncReviewDiff');
    if (diffEl) diffEl.innerHTML = buildSyncDiffHtml(state, remoteState);
    var tsEl = document.getElementById('syncReviewTs');
    if (tsEl) tsEl.textContent = syncReviewTimeText(remoteTs) || 'just now';
    modal.classList.remove('hidden');
  } catch (e) {
    syncReview.open = false;
    syncReview.current = null;
    return false;
  }
  try { if (typeof lucide !== 'undefined' && lucide.createIcons) lucide.createIcons(); } catch (e) {}
  return true;
}

/* The user answered. true = Accept (load remote), false = Decline (keep this
   device's copy and push it back to the cloud so both sides agree). */
function resolveSyncReview(accepted) {
  var cur = syncReview.current;
  syncReview.open = false;
  syncReview.current = null;
  var modal = document.getElementById('syncReviewModal');
  if (modal) modal.classList.add('hidden');
  if (!cur) return;

  try {
    if (accepted) {
      setCloudSyncSuppressed(true);
      try {
        if (applyCloudRemote({ state: cur.state }, cur.ts || undefined, true)) {
          renderAll();
          try { loadDraftIfNewer(); } catch (e) {}
          syncQueueClear();
          cloudSyncFailed = false;
          if (typeof updateGoogleSyncStatus === 'function') updateGoogleSyncStatus('Change from your other device accepted and applied.', 'success');
          if (typeof showToast === 'function') showToast('Change accepted and applied on this device.', 'success');
        } else if (typeof updateGoogleSyncStatus === 'function') {
          updateGoogleSyncStatus('Could not apply the remote change.', 'error');
        }
      } finally {
        setCloudSyncSuppressed(false);
      }
    } else {
      if (cur.fp) markSyncDeclined(cur.fp);
      // Keep this device's version — push it up so the cloud matches us.
      syncQueueMark();
      try { cloudPush(); } catch (e) {}
      if (typeof updateGoogleSyncStatus === 'function') updateGoogleSyncStatus('Declined — keeping this device’s copy.', 'info');
      if (typeof showToast === 'function') showToast('Declined the change — this device’s data stays as-is.', 'info');
    }
  } catch (e) { console.warn('sync review resolve failed', e); }
  try { renderCloudStatus(); } catch (e) {}
  // If more updates arrived while the modal was open, offer the newest one.
  if (syncReview.pending) {
    var p = syncReview.pending;
    syncReview.pending = null;
    setTimeout(function () { openSyncReview(p.state, p.ts, p.source); }, 80);
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

  if (typeof normalizeCustomerBalances === 'function') normalizeCustomerBalances();
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
  const remoteCount = remoteState ? stateDataCount(remoteState) : 0;
  const remoteTs = remote && remote.exportedAt ? Date.parse(remote.exportedAt) : 0;
  const localTs = state.updatedAt ? Date.parse(state.updatedAt) : 0;

  // Same content both sides -> nothing to do.
  if (remoteState && statesEqual(state, remoteState)) {
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

  // Both sides have real data and the copies differ — NEVER silently pick a
  // winner. Show what changed and let the user Accept (load the cloud copy)
  // or Decline (keep this device's copy and push it back up).
  if (openSyncReview(remoteState, remoteTs || undefined, 'Reconcile after sign-in')) {
    updateGoogleSyncStatus('Online as ' + email + '. There are changes from your other device — review them above.', 'info');
  } else {
    updateGoogleSyncStatus(statesEqual(state, remoteState)
      ? 'Online as ' + email + '. Your ledger is up to date.'
      : 'Online as ' + email + '. Kept this device’s version.', 'success');
  }
  renderCloudStatus();
  return true;
}
