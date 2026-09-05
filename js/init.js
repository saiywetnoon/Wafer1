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
  lucide.createIcons();
}

// Override: every save pushes to the account's Supabase cloud copy.
function triggerGoogleSync() {
  clearTimeout(googleSyncTimer);
  googleSyncTimer = setTimeout(async function () {
    pendingCloudPushQueued = true;
    try {
      // 1) A Supabase session can silently expire after boot; restore it before
      //    deciding we are offline, so saves keep reaching the cloud.
      if (!(SUPA.user && SUPA.user.id)) {
        try { await SUPA.sessionUser(); } catch (e) { /* restore is best-effort */ }
      }
      // 2) NEVER silently drop a save. Push when online; when a cloud IS
      //    configured but we can't reach it right now, push anyway so the
      //    change is queued ("will sync when back online") instead of being
      //    lost.
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
  const mode = keys
    ? (lib ? 'SUPABASE (URL-free, auto-sync)' : 'SUPABASE-CONFIGURED BUT LIB MISSING')
    : 'NOT CONFIGURED';
  console.log('%c[Daily Crispy Roll] Backend mode: ' + mode +
    (keys && lib ? ' — ' + (window.__supaSrc || 'jsdelivr') + (window.__supaFallback ? ' (fallback CDN)' : '') : ''),
    'background:#10b981;color:#fff;padding:2px 6px;border-radius:4px;');

  const st = $('googleSyncStatus');
  if (!st) return;
  if (!keys) {
    st.textContent = 'Backend not configured: add your Supabase URL + anon key in js/config.js.';
    st.className = 'text-xs text-amber-400 mt-2';
  } else if (!lib) {
    st.textContent = 'Supabase is configured but its library failed to load (network/CDN blocked or ad-blocker). Check your internet and reload.';
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
  await maybeImportLegacy();

  // 4) Load, render, then reconcile with the account's cloud copy.
  loadState();
  loadDraftIfNewer();
  renderAll();
  // Offline-first installable app: register the service worker (caches the app
  // shell + CDN libraries so the next open works even with no connection).
  registerServiceWorker();
  // Supabase: subscribe to live updates so other devices appear automatically.
  if (SUPA.libReady() && SUPA.user && SUPA.user.id) {
    try { supabaseWatch(SUPA.user.id); } catch (e) { console.warn('realtime not available', e); }
  }
  try { await cloudAfterSignIn(); } catch (e) { console.warn('cloud reconcile failed', e); }
  // Background freshness: re-pull the account copy every 60s so an already-open
  // tab keeps showing the latest edits from other devices (realtime backstop).
  try { startCloudPolling(); } catch (e) { console.warn('cloud polling not available', e); }
  // From here on, EVERY save auto-pushes to the cloud (price, stock, anything).
  setCloudAutoSync(true);
  // Topbar notification bell + dropdown.
  try { initNotifications(); } catch (e) { console.warn('notifications unavailable', e); }
  // Offline-first: retry anything saved while offline when the connection is back.
  initSyncFlushers();
  try { await flushPendingSync(); } catch (e) { console.warn('pending sync flush failed', e); }
  // Keep the status pill honest when the network state changes.
  try {
    window.addEventListener('online', updateAppStatus);
    window.addEventListener('offline', updateAppStatus);
  } catch (e) { /* listeners are best-effort */ }
}

/* Offline-first installable app: cache the app shell + CDN libraries so the app
   opens even with no connection. The service worker only enhances loading — if
   SW registration fails for any reason the app keeps working exactly as before. */
function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', function () {
    navigator.serviceWorker.register('sw.js').catch(function (err) {
      console.warn('Service worker registration failed (offline caching disabled):', err);
    });
  });
}

appStart();
