/* ============================================================
   INIT
   ============================================================ */
function renderAll() {
  migrateLegacyEntries();
  rebuildStockAndCogs();
  const formDate = $('logDate').value || today();
  populateProductionForm(formDate);
  $('logDate').value = formDate;
  $('saleDate').value = today();
  $('hourlyWage').value = state.settings.hourlyWage || 1500;
  renderPriceTable();
  renderUsageTable();
  renderProduction();
  renderSalesTab();
  renderDashboard();
  renderCalendar();
  renderInventory();
  renderCustomers();
  renderSuppliers();
  renderCash();
  updateUsageCosts();
  updateGoogleSyncStatus();
  const stEl = $('storageUsed');
  if (stEl) stEl.textContent = storageUsedKB().toFixed(1) + ' KB';
  wireResponsiveTables();
  updateAppStatus();
  if (typeof refreshTabBadges === 'function') { try { refreshTabBadges(); } catch (e) { /* best-effort */ } }
  lucide.createIcons();
}

/* ============================================================
   GOOGLE ACCOUNT INIT — Sign in with Google
   ============================================================ */
let googleSignInInitialized = false;
let googleTokenClient = null;

function initGoogleSignIn() {
  if (!GOOGLE_CLIENT_ID || !window.google || googleSignInInitialized) return;
  googleSignInInitialized = true;
  const btn = $('googleSignInDiv');
  btn.classList.remove('hidden');

  google.accounts.id.initialize({
    client_id: GOOGLE_CLIENT_ID,
    callback: handleGoogleCredential,
    auto_select: false
  });
  google.accounts.id.renderButton(btn, { theme: 'outline', size: 'medium', width: 220, text: 'signin_with', shape: 'pill' });
}

function handleGoogleCredential(response) {
  try {
    const payload = JSON.parse(atob(response.credential.split('.')[1]));
    googleAuthUser = {
      email: payload.email,
      name: payload.name,
      picture: payload.picture,
      sub: payload.sub,
      accessToken: null,
      rawCredential: response.credential || ''  // JWT id token → multi-tenant cloud auth
    };
    // Request an OAuth access token so we can call the Sheets API
    googleTokenClient = google.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: GOOGLE_SHEETS_SCOPE,
      callback: function (tokenResponse) {
        if (tokenResponse && tokenResponse.access_token) {
          googleAuthUser.accessToken = tokenResponse.access_token;
          $('googleUserLabel').textContent = 'Logout: ' + (googleAuthUser.email || googleAuthUser.name || 'User');
          $('googleSignOutBtn').classList.remove('hidden');
          $('googleSignInDiv').classList.add('hidden');
          showToast('Signed in as ' + (googleAuthUser.name || googleAuthUser.email), 'success');
          updateGoogleSyncStatus('Signed in with Google. Your ledger will auto-save to your Google account.', 'success');
          // Cloud-first: reconcile this workspace with the account's cloud copy
          // (mobile/full-screen scope). Falls back to legacy single-sheet mode.
          const legacySheetId = getGoogleSyncConfig().sheetId;
          if (legacySheetId && !cloudEndpoint()) {
            googleSheetsId = legacySheetId;
            loadFromSheetsApi();
          } else {
            cloudAfterSignIn();
          }
        } else {
          showToast('Google auth token could not be obtained.', 'error');
        }
      },
      error_callback: function (err) {
        console.error('Google token error', err);
        showToast('Google auth failed. Check that the Sheets API is enabled.', 'error');
      }
    });
    googleTokenClient.requestAccessToken();
  } catch (e) {
    console.error('Google sign-in parsing failed', e);
    showToast('Google sign-in failed.', 'error');
  }
}

$('googleSignOutBtn').addEventListener('click', function () {
  googleAuthUser = null;
  googleSheetsId = null;
  this.classList.add('hidden');
  $('googleSignInDiv').classList.remove('hidden');
  if (window.google && google.accounts && google.accounts.id) {
    google.accounts.id.disableAutoSelect();
  }
  showToast('Signed out of Google.');
  updateGoogleSyncStatus('Signed out. Local-only mode.', 'info');
  renderSyncTab();
});

/* ---------- Google Sheets API v4 direct save/load ---------- */
async function loadFromGoogleAccount() {
  if (!googleAuthUser) return;
  // If we already have a sheet ID configured, load from it; otherwise ask the user.
  const cfg = getGoogleSyncConfig();
  if (cfg.sheetId) {
    googleSheetsId = cfg.sheetId;
    await loadFromSheetsApi();
  } else {
    setupGSheetIdInput();
  }
}

function setupGSheetIdInput() {
  const sheetId = prompt(
    'Paste your Google Sheet ID (the long string from your sheet URL) to sync this ledger to your Google account.\n' +
    'Open your Google Sheet → look at the URL: docs.google.com/spreadsheets/d/YOUR_SHEET_ID/edit\n\n' +
    'Leave empty to skip and use local-only mode for now.',
    ''
  );
  if (!sheetId) return;
  googleSheetsId = sheetId;
  const cfg = getGoogleSyncConfig();
  cfg.sheetId = sheetId;
  cfg.sheetUrl = 'https://sheets.googleapis.com/v4/spreadsheets/' + sheetId;
  setGoogleSyncConfig(cfg);
  syncToSheetsApi();
}

async function syncToSheetsApi() {
  if (!googleAuthUser || !googleSheetsId) return false;
  try {
    const payload = toGooglePayload();
    // Values: [exportedAt, app, stateJSON]
    const values = [[payload.exportedAt, payload.app, JSON.stringify(payload.state)]];
    const sheetUrl = 'https://sheets.googleapis.com/v4/spreadsheets/' + googleSheetsId + '/values/' + GOOGLE_SHEET_NAME + '!A1:C1?valueInputOption=RAW';
    const resp = await fetch(sheetUrl, {
      method: 'PUT',
      headers: { 'Authorization': 'Bearer ' + googleAuthUser.accessToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({ values: values })
    });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    updateGoogleSyncStatus('Synced to Google Sheets (OAuth).', 'success');
    return true;
  } catch (e) {
    console.warn('Google Sheets API save failed', e);
    updateGoogleSyncStatus('Google Sheets API save failed.', 'error');
    return false;
  }
}

async function loadFromSheetsApi() {
  if (!googleAuthUser || !googleSheetsId) return false;
  try {
    const sheetUrl = 'https://sheets.googleapis.com/v4/spreadsheets/' + googleSheetsId + '/values/' + GOOGLE_SHEET_NAME + '!A1:C1';
    const resp = await fetch(sheetUrl, {
      headers: { 'Authorization': 'Bearer ' + googleAuthUser.accessToken }
    });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const data = await resp.json();
    const row = data && data.values && data.values[0];
    if (!row || !row[2]) {
      showToast('No data found in this Google Sheet yet.', 'info');
      return false;
    }
    const remoteState = JSON.parse(row[2]);
    if (!remoteState || !remoteState.entries) { showToast('Sheet contains no valid ledger data.', 'error'); return false; }
    const remoteTs = row[0] ? Date.parse(row[0]) : 0;
    const localTs = state.updatedAt ? Date.parse(state.updatedAt) : 0;
    if (remoteTs && localTs && remoteTs < localTs) {
      showToast('Google Sheet data is older than local; local copy kept.', 'info');
      return false;
    }
    if (remoteState.prices && Array.isArray(remoteState.prices)) state.prices = remoteState.prices;
    if (remoteState.entries) state.entries = remoteState.entries;
    if (Array.isArray(remoteState.production)) state.production = remoteState.production;
    if (Array.isArray(remoteState.sales)) state.sales = remoteState.sales;
    if (remoteState.stock) state.stock = remoteState.stock;
    if (remoteState.settings) state.settings = Object.assign({ hourlyWage: 1500 }, remoteState.settings);
    if (remoteState.inventory) state.inventory = remoteState.inventory;
    if (Array.isArray(remoteState.inventoryMovements)) state.inventoryMovements = remoteState.inventoryMovements;
    if (remoteState.inventoryMovementVersion) state.inventoryMovementVersion = remoteState.inventoryMovementVersion;
    if (remoteState.customers) state.customers = remoteState.customers;
    if (remoteState.suppliers) state.suppliers = remoteState.suppliers;
    if (remoteState.purchases) state.purchases = remoteState.purchases;
    if (remoteState.payments) state.payments = remoteState.payments;
    if (remoteState.customerPayments) state.customerPayments = remoteState.customerPayments;
    if (remoteState.expenses) state.expenses = remoteState.expenses;
    if (remoteState.recurringExpenses) state.recurringExpenses = remoteState.recurringExpenses;
    if (remoteState.waste) state.waste = remoteState.waste;
    if (remoteState.priceHistory) state.priceHistory = remoteState.priceHistory;
    if (Array.isArray(remoteState.recipes)) state.recipes = remoteState.recipes;
    if (remoteState.cash) state.cash = Object.assign({ opening: 0, adjustments: [] }, remoteState.cash);
    if (typeof migrateInventoryMovements === 'function') migrateInventoryMovements();
    state.version = 2;
    state.updatedAt = new Date().toISOString();
    saveState();
    renderAll();
    showToast('Ledger data loaded from Google Sheets.', 'success');
    updateGoogleSyncStatus('Data loaded from Google Sheets (OAuth).', 'success');
    return true;
  } catch (e) {
    console.error('Google Sheets API load failed', e);
    showToast('Failed to load from Google Sheets.', 'error');
    return false;
  }
}

// Override: if a Google sheet ID is configured, also push to Sheets API on save.
// When the workspace is ONLINE (cloud mode), push to the account's cloud copy.
function triggerGoogleSync() {
  clearTimeout(googleSyncTimer);
  googleSyncTimer = setTimeout(async function () {
    pendingCloudPushQueued = true;
    try {
      if (googleAuthUser && googleSheetsId) syncToSheetsApi();
      // 1) A Supabase session can silently expire after boot; restore it before
      //    deciding we are offline, so saves keep reaching the cloud.
      if (SUPA.configured() && !(SUPA.user && SUPA.user.id)) {
        try { await SUPA.sessionUser(); } catch (e) { /* restore is best-effort */ }
      }
      // 2) NEVER silently drop a save. Push when online; when a cloud IS
      //    configured but we can't reach it right now, push anyway so the
      //    change is queued ("will sync when back online") instead of being
      //    lost. Only a truly local setup (legacy mode with no account and no
      //    server URL) stays silent — there is nothing to queue then.
      pendingCloudPushQueued = false; // push is starting; beforeunload may flush on its own
      if (cloudIsOnline() || cloudIsAvailable()) await cloudPush();
    } catch (e) {
      console.warn('auto cloud push failed', e);
      pendingCloudPushQueued = false;
    }
  }, 700);
}

/* ---------- Backend-mode diagnostic (visible + console) ----------
   Makes it obvious which backend this build is really wired to and whether the
   sync engine (Supabase) actually loaded. A stale build or blocked CDN is then
   trivially diagnosable instead of a baffling "script URL" prompt. */
function reportBackendMode() {
  const keys = !!(SUPABASE_URL_wafer && SUPABASE_ANON_KEY_wafer);
  const lib = !!window.supabase;
  const mode = SUPA.configured()
    ? 'SUPABASE (URL-free, auto-sync)'
    : (keys ? 'SUPABASE-CONFIGURED BUT LIB MISSING' : 'LEGACY APPS-SCRIPT');
  console.log('%c[Daily Crispy Roll] Backend mode: ' + mode +
    (keys && lib ? ' — ' + (window.__supaSrc || 'jsdelivr') + (window.__supaFallback ? ' (fallback CDN)' : '') : ''),
    'background:#10b981;color:#fff;padding:2px 6px;border-radius:4px;');

  const st = $('googleSyncStatus');
  if (!st) return;
  if (!keys && !lib) {
    st.textContent = 'Backend: legacy Apps-Script mode. Configure a server URL, or add Supabase keys to enable one-click sync.';
    st.className = 'text-xs text-amber-400 mt-2';
  } else if (keys && !lib) {
    st.textContent = 'Sync engine failed to load (network/CDN blocked). You are being shown the old mode — check your internet or blocker, then reload.';
    st.className = 'text-xs text-red-400 mt-2';
  }
}

/* ============================================================
   BOOT — the account gate comes first, then the ledger starts.
   ============================================================ */
async function appStart() {
  // 0) Diagnostic: show which backend this build is actually using so a stale
  //    build / failed CDN is obvious instead of a confusing "script URL" prompt.
  reportBackendMode();
  // Build marker so a stale cached bundle is instantly visible: open DevTools →
  // console after a hard refresh. If you DO NOT see this line, your browser is
  // running an old cached copy of the JS (do a hard refresh / clear site data).
  console.log('%c[Daily Crispy Roll] BUILD ' + __LEDGER_BUILD + ' (auto-sync + honor-status + inventory dedupe) loaded',
    'background:#10b981;color:#fff;padding:2px 6px;border-radius:4px;');
  // If the HTML and JS disagree on the build id, the browser is serving a
  // mixture of old and new cached files — the #1 cause of "it says Synced but
  // nothing actually uploads". Make it visible instead of subtle.
  try {
    var htmlBuild = (document.documentElement && document.documentElement.getAttribute)
      ? document.documentElement.getAttribute('data-build') : '';
    if (htmlBuild && htmlBuild !== __LEDGER_BUILD) {
      console.warn('[Daily Crispy Roll] BUILD MISMATCH html=' + htmlBuild + ' js=' + __LEDGER_BUILD + ' — hard refresh needed.');
      showToast('⚠ Mixed old/new app files (' + htmlBuild + ' ↔ ' + __LEDGER_BUILD + '). Hard refresh (Ctrl+Shift+R) so sync works correctly.', 'error');
    }
  } catch (e) {}

  // 1) Account gate: without a valid session nobody reaches the app.
  const authed = await authBootstrap();
  if (!authed) return; // login / sign-up screen is showing

  // 2) Establish this account's workspace namespace.
  const companyBooted = companyBootstrap();
  if (!companyBooted) { showAuthScreen('Please sign in to use this app.'); return; }

  // 3) One-time import of pre-account browser data (owner's device).
  maybeImportLegacy();

  // 4) Load, render, then reconcile with the account's cloud copy.
  loadState();
  loadDraftIfNewer();
  renderAll();
  initGoogleSignIn();
  // Supabase: subscribe to live updates so other devices appear automatically.
  if (SUPA.configured() && SUPA.user && SUPA.user.id) {
    try { supabaseWatch(SUPA.user.id); } catch (e) { console.warn('realtime not available', e); }
  }
  try { await cloudAfterSignIn(); } catch (e) { console.warn('cloud reconcile failed', e); }
  // Background freshness: re-pull the account copy every 60s so an already-open
  // tab keeps showing the latest edits from other devices (realtime backstop).
  try { startCloudPolling(); } catch (e) { console.warn('cloud polling not available', e); }
  // From here on, EVERY save auto-pushes to the cloud (price, stock, anything).
  setCloudAutoSync(true);
  // Offline-first: retry anything saved while offline when the connection is back.
  initSyncFlushers();
  try { await flushPendingSync(); } catch (e) { console.warn('pending sync flush failed', e); }
  // Keep the status pill honest when the network state changes.
  try {
    window.addEventListener('online', updateAppStatus);
    window.addEventListener('offline', updateAppStatus);
  } catch (e) { /* listeners are best-effort */ }
}

appStart();
