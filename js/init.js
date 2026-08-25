/* ============================================================
   INIT
   ============================================================ */
function renderAll() {
  $('logDate').value = today();
  $('hourlyWage').value = state.settings.hourlyWage || 1500;
  const todayEntry = state.entries[today()];
  $('logPrice').value = todayEntry && todayEntry.price ? todayEntry.price : 1300;
  renderPriceTable();
  renderUsageTable();
  if (todayEntry) {
    draftUsage = Object.assign({}, todayEntry.usage || {});
    state.prices.forEach(function (ing) {
      const input = document.querySelector('.usage-input[data-name="' + ing.name + '"]');
      if (input) input.value = draftUsage[ing.name] || 0;
    });
    $('additionalCost').value = todayEntry.additionalCost || 0;
    $('logBagsProduced').value = todayEntry.bagsProduced || 0;
    $('logPieces').value = todayEntry.pieces || 0;
    $('logBagsSold').value = todayEntry.bagsSold || 0;
    $('logPrice').value = todayEntry.price || 1300;
    $('logLabor').value = todayEntry.laborMinutes || 0;
  }
  renderRecent();
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
    if (remoteState.settings) state.settings = Object.assign({ hourlyWage: 1500 }, remoteState.settings);
    if (remoteState.inventory) state.inventory = remoteState.inventory;
    if (remoteState.customers) state.customers = remoteState.customers;
    if (remoteState.suppliers) state.suppliers = remoteState.suppliers;
    if (remoteState.purchases) state.purchases = remoteState.purchases;
    if (remoteState.payments) state.payments = remoteState.payments;
    if (remoteState.customerPayments) state.customerPayments = remoteState.customerPayments;
    if (remoteState.expenses) state.expenses = remoteState.expenses;
    if (remoteState.recurringExpenses) state.recurringExpenses = remoteState.recurringExpenses;
    if (remoteState.waste) state.waste = remoteState.waste;
    if (remoteState.priceHistory) state.priceHistory = remoteState.priceHistory;
    if (remoteState.cash) state.cash = Object.assign({ opening: 0, adjustments: [] }, remoteState.cash);
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
  googleSyncTimer = setTimeout(function () {
    if (googleAuthUser && googleSheetsId) syncToSheetsApi();
    if (cloudIsOnline()) cloudPush();
    else syncToGoogle({ silent: true });
  }, 700);
}

/* ============================================================
   BOOT — the account gate comes first, then the ledger starts.
   ============================================================ */
async function appStart() {
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
  renderAll();
  initGoogleSignIn();
  cloudAfterSignIn();
}

appStart();
