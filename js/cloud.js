/* ============================================================
   CLOUD — online / access-from-anywhere layer
   ============================================================
   A single provider-agnostic interface the app uses to go online.
   Backend: Supabase. There is NO legacy Apps-Script upstream
   anymore — this app is Supabase-only.
   ============================================================ */

function cloudSignedInEmail() { return authEmail(); }
function cloudEndpoint() { return ''; }   // legacy Apps-Script concept — always empty now

/* Is this workspace currently ONLINE? Yes the moment a Supabase session exists. */
function cloudIsOnline() {
  return !!(SUPA.user && SUPA.user.id);
}
/* Is a cloud backend reachable at all? */
function cloudIsAvailable() {
  return true;
}
/* Can sync / upload / download run RIGHT NOW? The logged-in Supabase session
   IS the connection — there is no deployment URL to configure. */
function cloudReady() {
  return !!(SUPA.user && SUPA.user.id);
}
function cloudNeedsUrl() {
  return false;
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

/* Auto-apply edits arriving from another device (realtime).
   Professional behaviour:
   - Ignore echoes of THIS device's own writes (no re-render, no message).
   - Apply genuine remote changes and persist them locally WITHOUT pushing them
     back (push-backs re-broadcast an event and create an endless sync loop).
   - No toast spam — a quiet status line is enough for an auto-sync. */
function supabaseUpdate(uid) {
  if (!uid) return;
  SUPA.subscribeRealtime(uid, function (row) {
    if (!row || !row.payload || !row.payload.state) return;
    const remoteTs = Date.parse(row.updated_at) || 0;
    const localTs = state.updatedAt ? Date.parse(state.updatedAt) : 0;
    if (remoteTs && localTs && remoteTs <= localTs) return; // local is same/newer
    if (statesEqual(state, row.payload.state)) return;       // echo of our own write
    /* Apply + persist locally, but suppress the echo push to break the loop. */
    setCloudSyncSuppressed(true);
    try {
      applyCloudRemote({ state: row.payload.state }, remoteTs);
    } finally {
      setCloudSyncSuppressed(false);
    }
    renderAll();
    // A draft that just arrived from another device belongs in the form too.
    try { loadDraftIfNewer(); } catch (e) {}
    updateGoogleSyncStatus('Last update from another device just now.', 'info');
  });
}
function supabaseWatch(uid) { supabaseUpdate(uid); }
/* Background freshness poll (60s). Realtime is the fast path for other open
   devices, but a silently-failed channel / browser quirk must not leave a tab
   showing stale numbers for hours. Every minute we pull the cloud copy and
   apply it when it is genuinely newer — same guards as realtime (no echo, no
   overwriting a richer local copy). */
var cloudPollTimer = null;
function startCloudPolling() {
  if (cloudPollTimer || !SUPA.libReady()) return;
  cloudPollTimer = setInterval(async function () {
    try {
      if (!cloudReady()) return;
      const res = await cloudGet();
      const remote = res && res.ok ? res.payload : null;
      if (!remote || !remote.state) return;
      const remoteTs = remote.exportedAt ? Date.parse(remote.exportedAt) : 0;
      const localTs = state.updatedAt ? Date.parse(state.updatedAt) : 0;
      if (remoteTs && localTs && remoteTs <= localTs) return;
      if (statesEqual(state, remote.state)) return;
      // Guard: never downgrade a richer local copy just because it's older.
      if (stateDataCount(remote.state) < stateDataCount(state)) return;
      setCloudSyncSuppressed(true);
      try { applyCloudRemote(remote, remoteTs || undefined); } finally { setCloudSyncSuppressed(false); }
      renderAll();
      try { loadDraftIfNewer(); } catch (e) {}
      updateGoogleSyncStatus('Auto-refreshed latest from your account.', 'info');
      renderCloudStatus();
    } catch (e) { /* poll is best-effort */ }
  }, 60000);
}
/* ---------- Low-level offline-first queue ---------- */
/* Offline-first: every push that cannot reach the cloud marks a persistent
   "pending sync" flag. The next successful online moment (reconnect, page
   load, manual sync) replays the CURRENT state — which contains every change
   made while offline — and clears the flag. Last-write-wins by timestamp is
   applied during the boot reconcile (cloudAfterSignIn). */
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
  try { await SUPA.sessionUser(); } catch (e) {}
  const res = await supabasePush();
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
  return supabaseGet();
}
/* Supabase-only backup helpers. There is no Google Drive upstream anymore:
   a downloadable JSON snapshot IS the backup (see cloudBackupNow in sync-ui). */
async function cloudBackup() { return { ok: false, message: 'Use Download backup instead (Supabase).' }; }
async function cloudList() { return { ok: true, backups: [] }; }
async function cloudRestore() { return { ok: false, message: 'Use Download backup instead (Supabase).' }; }
async function cloudClear() { return { ok: true, message: 'Cleared.' }; }
/* ---------- Merge a remote cloud state into the current workspace ---------- */
/* Copy every listed array field from a remote payload onto state, but only when
   the remote actually carries that array (so a partial copy can never null or
   downgrade a populated local collection). */
function copyArrayFields(remote, fieldNames) {
  fieldNames.forEach(function (field) {
    if (Array.isArray(remote[field])) state[field] = remote[field];
  });
}

function applyCloudRemote(remote, remoteTs) {
  if (!remote || !remote.state) return false;
  const r = remote.state;
  // Older/partial cloud rows must not erase newer local history. This is
  // especially important for inventory, where the movement ledger is the
  // source of truth rather than the cached stock snapshot.
  if (stateDataCount(r) < stateDataCount(state)) return false;

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
   device holds newer data (or the cloud is empty for this account).
   Works for account login (session token) and legacy Google sign-in.

   LATEST-WINS-BY-CONTENT: the decision is made on REAL RECORDS first and
   timestamps only as a tie-breaker. Comparing timestamps alone caused the
   classic deadlock: a device whose rich history was never pushed has an OLD
   updatedAt, while the cloud row is timestamped NEWER but contains FEWER
   records — so the app refused to push (remote newer) AND refused to pull
   (count guard). Result: every other browser kept seeing the stale cloud.
   Rule: the copy with MORE real records wins; on equal counts, the newest
   write wins. A fresh device NEVER overwrites a populated cloud. */
async function cloudAfterSignIn() {
  const email = cloudSignedInEmail();
  if (!email || !authToken()) return false;
  renderCloudStatus();
  if (!cloudReady()) {
    updateGoogleSyncStatus('Signed in. Syncing your account…', 'info');
    return false;
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

  // Both have data -> the copy with MORE real records is the authoritative one
  // (it contains history the other is missing). Ties break by newest write.
  if (localCount > remoteCount || (localCount === remoteCount && localTs > remoteTs)) {
    const up = await cloudPush();
    if (up && up.ok) updateGoogleSyncStatus('Online as ' + email + '. Your copy is richer/newer — pushed to cloud.', 'success');
    else updateGoogleSyncStatus('Could not push local copy to cloud yet — it is queued and will retry.', 'info');
    renderCloudStatus();
    return true;
  }

  if (applyCloudRemote(remote, remoteTs || undefined)) {
    renderAll();
    updateGoogleSyncStatus('Online as ' + email + '. Loaded latest from your account.', 'success');
    showToast('Loaded the latest ' + remoteCount + ' records from the cloud.', 'success');
    // A draft pulled from the cloud (typed on another device) goes in the form.
    try { loadDraftIfNewer(); } catch (e) {}
  }
  renderCloudStatus();
  return true;
}
