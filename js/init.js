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
  if (typeof refreshNotifications === 'function') { try { refreshNotifications(); } catch (e) { /* best-effort */ } }
  safeIcons();
  // Keep the active language applied to freshly rendered content.
  if (typeof applyLanguageToDom === 'function') { try { applyLanguageToDom(); } catch (e) { /* best-effort */ } }
}

// Push every save to the Supabase cloud copy (debounced so heavy typing sends
// one coalesced write instead of one per keystroke).
function triggerGoogleSync() {
  clearTimeout(googleSyncTimer);
  // Mark this as pending as soon as the edit is queued, not 300ms later in
  // the callback.  Closing/reloading in that small gap used to leave a change
  // only in localStorage until the user happened to open this device again.
  pendingCloudPushQueued = true;
  googleSyncTimer = setTimeout(async function () {
    try {
      // A Supabase session can silently expire after boot; restore it before
      // deciding we are offline, so saves keep reaching the cloud.
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
  }, 900);
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
  // Supabase: subscribe to live updates so other devices appear automatically.
  if (SUPA.configured() && SUPA.user && SUPA.user.id) {
    try { supabaseWatch(SUPA.user.id); } catch (e) { console.warn('realtime not available', e); }
  }
  try { await cloudAfterSignIn(); } catch (e) { console.warn('cloud reconcile failed', e); }
  // Background freshness: re-pull the account copy every 60s so an already-open
  // tab keeps showing the latest edits from other devices (realtime backstop).
  try { startCloudPolling(); } catch (e) { console.warn('cloud polling not available', e); }
  // Catch-up on tab focus: when the user switches back to this tab (or phone
  // app), pull + merge immediately instead of waiting up to 60s / realtime.
  if (!window.__cloudVisibilityHandler) {
    window.__cloudVisibilityHandler = true;
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible' && cloudReady()) {
        try {
          cloudGet().then(function (res) {
            const remote = (res && res.ok) ? res.payload : null;
            if (remote && remote.state) {
              handleRemoteCopy(remote.state, remote.exportedAt ? Date.parse(remote.exportedAt) : undefined, 'Tab revived', (remote && remote.device) || null);
            }
          }).catch(function () {});
        } catch (e) { /* best-effort */ }
      }
    });
  }
  // From here on, EVERY save auto-pushes to the cloud (price, stock, anything).
  setCloudAutoSync(true);
  // Topbar notification bell + dropdown.
  try { initNotifications(); } catch (e) { console.warn('notifications unavailable', e); }
  // Wire the accept/decline sync-review modal (changes from other devices).
  try { initSyncReview(); } catch (e) { console.warn('sync review unavailable', e); }
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
