/* ---------- Google Sync Config ---------- */
function getGoogleSyncConfig() {
  try {
    const raw = localStorage.getItem(companyConfigKey());
    if (!raw) return { sheetUrl: '', backupFrequency: 'daily', lastDriveBackupDate: '' };
    return Object.assign({ sheetUrl: '', backupFrequency: 'daily', lastDriveBackupDate: '' }, JSON.parse(raw));
  } catch (e) {
    console.warn('Could not read Google sync config', e);
    return { sheetUrl: '', backupFrequency: 'daily', lastDriveBackupDate: '' };
  }
}
function setGoogleSyncConfig(next) {
  const config = Object.assign({ sheetUrl: '', backupFrequency: 'daily', lastDriveBackupDate: '' }, next || {});
  try {
    localStorage.setItem(companyConfigKey(), JSON.stringify(config));
  } catch (e) {
    console.warn('Could not store Google sync config', e);
  }
  if ($('googleSheetUrl')) $('googleSheetUrl').value = config.sheetUrl || '';
  if ($('backupFrequency')) $('backupFrequency').value = config.backupFrequency || 'daily';
  updateGoogleSyncStatus();
}
function updateGoogleSyncStatus(message, type) {
  const el = $('googleSyncStatus');
  if (!el) return;
  if (!message) {
    const cfg = getGoogleSyncConfig();
    if (cfg.sheetUrl) {
      el.textContent = 'Auto-save enabled: your entries and drafts sync to Google Sheets automatically.';
      el.className = 'text-xs text-emerald-400 mt-2';
    } else {
      el.textContent = 'Google sync ready. Add your Apps Script URL to enable Sheets sync + auto-save.';
      el.className = 'text-xs text-gray-400 mt-2';
    }
    return;
  }
  type = type || 'info';
  const colors = { success: 'text-emerald-400', error: 'text-red-400', info: 'text-amber-400' };
  el.textContent = message;
  el.className = 'text-xs ' + (colors[type] || 'text-gray-400') + ' mt-2';
}
function shouldDriveBackupNow() {
  const cfg = getGoogleSyncConfig();
  const freq = cfg.backupFrequency || 'daily';
  if (freq === 'manual') return false;
  if (freq === 'every-save') return true;
  const todayStr = today();
  const last = cfg.lastDriveBackupDate || '';
  return last !== todayStr;
}
function markDriveBackupDone() {
  const c = getGoogleSyncConfig();
  c.lastDriveBackupDate = today();
  setGoogleSyncConfig(c);
}
function toGooglePayload() {
  return {
    app: 'daily-crispy-roll-ledger',
    exportedAt: new Date().toISOString(),
    state
  };
}

/* ---------- Google Sync / Backup ---------- */
async function syncToGoogle(opts) {
  opts = opts || {};
  const silent = !!opts.silent;
  const config = getGoogleSyncConfig();
  if (!config.sheetUrl) {
    if (!silent) showToast('Google Apps Script URL is not configured yet.', 'info');
    return false;
  }
  try {
    // ---- DANGER GUARD: never let an empty/partial local ledger overwrite a
    // populated Google Sheet (the sheet is the authoritative history source).
    // Check how many days the sheet currently holds before pushing up.
    const localCount = Object.keys(state.entries || {}).length;
    let remoteCount = -1; // -1 = could not read remote; 0 = sheet empty
    if (localCount === 0) {
      try {
        const checkUrl = new URL(config.sheetUrl);
        checkUrl.searchParams.set('action', 'get');
        const checkRes = await fetch(checkUrl.toString(), { method: 'GET' });
        if (checkRes.ok) {
          const checkData = await checkRes.json();
          const remoteState = (checkData && checkData.payload && checkData.payload.state) ? checkData.payload.state : (checkData && checkData.state ? checkData.state : null);
          remoteCount = remoteState && remoteState.entries ? Object.keys(remoteState.entries).length : 0;
        }
      } catch (e) { /* if we can't read the sheet, fall through to the safe default below */ }
    }
    if (localCount === 0 && remoteCount > 0) {
      if (!silent) showToast('Refusing to overwrite the Google Sheet (' + remoteCount + ' day(s)) with an empty local ledger. Use "Sync From Google Sheet" to load your history first.', 'error');
      updateGoogleSyncStatus('Skipped upload: local ledger is empty but the Google Sheet has ' + remoteCount + ' day(s).', 'info');
      return false;
    }


    const response = await fetch(config.sheetUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: 'save', payload: toGooglePayload() })
    });
    if (!response.ok) throw new Error('HTTP ' + response.status);
    const result = await response.json();
    if (!silent) showToast(result && result.message ? result.message : 'Data synced to Google Sheets.', 'success');
    updateGoogleSyncStatus('Google Sheets synced successfully.', 'success');
    if (shouldDriveBackupNow()) {
      try {
        const bResp = await fetch(config.sheetUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify({ action: 'backup', payload: toGooglePayload() })
        });
        if (!bResp.ok) throw new Error('Backup HTTP ' + bResp.status);
        markDriveBackupDone();
        if (!silent) showToast('Backup stored to Google Drive successfully.', 'success');
      } catch (bErr) {
        console.warn('Backup failed', bErr);
        updateGoogleSyncStatus('Sheets synced, but Drive backup failed.', 'error');
      }
    }
    return true;
  } catch (error) {
    console.error('Google sync failed', error);
    updateGoogleSyncStatus('Google sync failed. Check the Apps Script URL and permissions.', 'error');
    if (!silent) showToast('Google sync failed. Check the script URL and permissions.', 'error');
    return false;
  }
}
async function backupToDriveOnly(opts) {
  opts = opts || {};
  const silent = !!opts.silent;
  const config = getGoogleSyncConfig();
  if (!config.sheetUrl) {
    if (!silent) showToast('Google Apps Script URL is not configured.', 'info');
    return false;
  }
  try {
    const response = await fetch(config.sheetUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: 'backup', payload: toGooglePayload() })
    });
    if (!response.ok) throw new Error('HTTP ' + response.status);
    markDriveBackupDone();
    if (!silent) showToast('Full backup stored to Google Drive.', 'success');
    updateGoogleSyncStatus('Backup to Google Drive complete.', 'success');
    return true;
  } catch (error) {
    console.error('Drive backup failed', error);
    if (!silent) showToast('Drive backup failed.', 'error');
    return false;
  }
}
async function pullFromGoogle(opts) {
  opts = opts || {};
  const silent = !!opts.silent;
  const config = getGoogleSyncConfig();
  if (!config.sheetUrl) {
    if (!silent) showToast('Google Apps Script URL is not configured yet.', 'info');
    return false;
  }
  try {
    const url = new URL(config.sheetUrl);
    url.searchParams.set('action', 'get');
    const response = await fetch(url.toString(), { method: 'GET' });
    if (!response.ok) throw new Error('HTTP ' + response.status);
    const result = await response.json();
    const remote = (result && result.payload && result.payload.state) ? result.payload.state : (result && result.state ? result.state : null);
    if (!remote || !remote.entries) {
      if (!silent) showToast('No remote data found in Google Sheets.', 'info');
      return false;
    }
    const remoteTs = result && result.payload && result.payload.exportedAt ? Date.parse(result.payload.exportedAt) : 0;
    const localTs = state.updatedAt ? Date.parse(state.updatedAt) : 0;
    if (remoteTs && localTs && remoteTs < localTs) {
      if (!silent) showToast('Google Sheets data is older than local; local copy kept.', 'info');
      return false;
    }
    if (remote.prices && Array.isArray(remote.prices) && remote.prices.length) state.prices = remote.prices;
    if (remote.entries) state.entries = remote.entries;
    if (remote.settings) state.settings = Object.assign({ hourlyWage: 1500 }, remote.settings);
    if (remote.inventory) state.inventory = remote.inventory;
    if (remote.customers) state.customers = remote.customers;
    if (remote.suppliers) state.suppliers = remote.suppliers;
    if (remote.purchases) state.purchases = remote.purchases;
    if (remote.payments) state.payments = remote.payments;
    if (remote.customerPayments) state.customerPayments = remote.customerPayments;
    if (remote.expenses) state.expenses = remote.expenses;
    if (remote.recurringExpenses) state.recurringExpenses = remote.recurringExpenses;
    if (remote.waste) state.waste = remote.waste;
    if (remote.priceHistory) state.priceHistory = remote.priceHistory;
    if (remote.cash) state.cash = Object.assign({ opening: 0, adjustments: [] }, remote.cash);
    state.version = 2;
    state.updatedAt = new Date().toISOString();
    saveState();
    renderAll();
    if (!silent) showToast('Ledger data pulled from Google Sheets successfully.', 'success');
    updateGoogleSyncStatus('Data refreshed from Google Sheets.', 'success');
    return true;
  } catch (error) {
    console.error('Google pull failed', error);
    if (!silent) showToast('Unable to pull data from Google Sheets.', 'error');
    return false;
  }
}
function triggerGoogleSync() {
  clearTimeout(googleSyncTimer);
  googleSyncTimer = setTimeout(function () { syncToGoogle({ silent: true }); }, 700);
}

