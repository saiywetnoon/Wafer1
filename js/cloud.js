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
/* Auto-apply edits arriving from another device (realtime). */
function supabaseWatch(uid) {
  if (!uid) return;
  SUPA.subscribeRealtime(uid, function (row) {
    if (!row || !row.payload || !row.payload.state) return;
    const remoteTs = Date.parse(row.updated_at) || 0;
    const localTs = state.updatedAt ? Date.parse(state.updatedAt) : 0;
    if (remoteTs && localTs && remoteTs <= localTs) return; // local is same/newer
    applyCloudRemote({ state: row.payload.state });
    renderAll();
    showToast('Synced from another device automatically.', 'success');
  });
}
/* ---------- Low-level: dispatch to Supabase or legacy Apps Script ---------- */
async function cloudPush() {
  if (SUPA.configured()) return supabasePush();
  return cloudPost('save', { payload: toGooglePayload() });
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
/* ---------- Merge a remote cloud state into the current workspace ---------- */
function applyCloudRemote(remote) {
  if (!remote || !remote.state) return false;
  const r = remote.state;
  if (r.prices && Array.isArray(r.prices) && r.prices.length) state.prices = r.prices;
  if (r.entries) state.entries = r.entries;
  if (r.production) state.production = Array.isArray(r.production) ? r.production : [];
  if (r.sales) state.sales = Array.isArray(r.sales) ? r.sales : [];
  if (r.stock && typeof r.stock === 'object') state.stock = { pieces: parseFloat(r.stock.pieces) || 0, cost: parseFloat(r.stock.cost) || 0 };
  if (r.settings) state.settings = Object.assign({ hourlyWage: 1500 }, r.settings);
  if (r.inventory) state.inventory = r.inventory;
  if (r.customers) state.customers = r.customers;
  if (r.suppliers) state.suppliers = r.suppliers;
  if (r.purchases) state.purchases = r.purchases;
  if (r.payments) state.payments = r.payments;
  if (r.customerPayments) state.customerPayments = r.customerPayments;
  if (r.expenses) state.expenses = r.expenses;
  if (r.recurringExpenses) state.recurringExpenses = r.recurringExpenses;
  if (r.waste) state.waste = r.waste;
  if (r.priceHistory) state.priceHistory = r.priceHistory;
  if (r.cash) state.cash = Object.assign({ opening: 0, adjustments: [] }, r.cash);
  state.version = 2;
  state.updatedAt = new Date().toISOString();
  saveState();
  return true;
}

/* ---------- Reconcile after sign-in ----------
   Pulls the newer copy (cloud -> device) or pushes local when the
   device holds newer data (or the cloud is empty for this account).
   Works for account login (session token) and legacy Google sign-in. */
async function cloudAfterSignIn() {
  const email = cloudSignedInEmail();
  if (!email || !cloudAccountToken()) return false;
  renderCloudStatus();
  if (!cloudEndpoint()) {
    updateGoogleSyncStatus('Signed in. Add your Apps Script URL in the Online/Cloud card to go online.', 'info');
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
  const localCount = Object.keys(state.entries || {}).length;
  const res = await cloudGet();
  const remote = res && res.ok ? res.payload : null;
  const remoteCount = remote && remote.state ? Object.keys(remote.state.entries || {}).length : 0;

  if (remoteCount === 0 && localCount === 0) {
    // Brand-new account: nothing anywhere yet.
    showToast('Online as ' + email + '. Your entries will auto-save to your account.', 'success');
    updateGoogleSyncStatus('Online as ' + email + '. Auto-save is on.', 'success');
    renderCloudStatus();
    return true;
  }
  if (remoteCount === 0) {
    const up = await cloudPush();
    if (up && up.ok) showToast('Uploaded this device’s ' + localCount + ' days to the cloud.', 'success');
    else showToast('Could not upload to cloud yet — check the Apps Script URL.', 'error');
    updateGoogleSyncStatus('Online as ' + email + '. Uploaded local data to cloud.', 'success');
    renderCloudStatus();
    return true;
  }
  const remoteTs = remote.exportedAt ? Date.parse(remote.exportedAt) : 0;
  const localTs = state.updatedAt ? Date.parse(state.updatedAt) : 0;
  if (remoteTs && localTs && remoteTs < localTs) {
    await cloudPush();
    updateGoogleSyncStatus('Online as ' + email + '. Local copy is newer — pushed to cloud.', 'success');
    renderCloudStatus();
    return true;
  }
  if (applyCloudRemote(remote)) {
    renderAll();
    updateGoogleSyncStatus('Online as ' + email + '. Loaded your cloud data onto this device.', 'success');
    showToast('Loaded your ' + remoteCount + ' days from the cloud.', 'success');
  }
  renderCloudStatus();
  return true;
}