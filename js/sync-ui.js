/* ============================================================
   GOOGLE SYNC UI
   ============================================================ */
function renderSyncTab() {
  const cfg = getGoogleSyncConfig();
  if ($('googleSheetUrl')) $('googleSheetUrl').value = cfg.sheetUrl || '';
  if ($('backupFrequency')) $('backupFrequency').value = cfg.backupFrequency || 'daily';
  updateGoogleSyncStatus();
  renderCloudStatus();
}

$('saveGoogleConfigBtn').addEventListener('click', function () {
  const cfg = getGoogleSyncConfig();
  cfg.sheetUrl = $('googleSheetUrl').value.trim();
  cfg.backupFrequency = $('backupFrequency').value || 'daily';
  setGoogleSyncConfig(cfg);
  showToast('Google sync configuration saved.');
});

$('syncNowBtn').addEventListener('click', function () {
  pullFromGoogle({ silent: false });   // "Sync" = refresh from the authoritative Google Sheet
});

$('pullNowBtn').addEventListener('click', function () {
  syncToGoogle({ silent: false });     // "Upload" = push local changes up to the Google Sheet
});

$('backupToDriveBtn').addEventListener('click', function () {
  backupToDriveOnly({ silent: false });
});

$('exportFullBackupBtn').addEventListener('click', function () {
  const payload = toGooglePayload();
  const blob = new Blob(['\uFEFF' + JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'crispy-roll-full-backup-' + today() + '.json';
  a.click();
  URL.revokeObjectURL(a.href);
  showToast('Full backup downloaded.');
});

$('restoreFullBackupBtn').addEventListener('click', function () {
  $('restoreFileInput').click();
});

$('restoreFileInput').addEventListener('change', function () {
  const file = this.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function () {
    try {
      const parsed = JSON.parse(reader.result);
      const remoteState = parsed.state ? parsed.state : parsed;
      if (!remoteState || !remoteState.entries) { showToast('Invalid backup file.', 'error'); return; }
      if (!confirm('Restore full backup? This will REPLACE all local data.')) return;
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
      if (parsed.exportedAt) state.updatedAt = parsed.exportedAt;
      saveState();
      renderAll();
      showToast('Full backup restored successfully.');
    } catch (e) {
      console.error('Restore failed', e);
      showToast('Could not parse backup file.', 'error');
    }
  };
  reader.readAsText(file);
  this.value = '';
});

/* ---------- Drive Backup List & Restore ---------- */
async function listDriveBackups() {
  const config = getGoogleSyncConfig();
  const listEl = $('backupList');
  if (!config.sheetUrl) {
    listEl.textContent = 'Configure the Apps Script URL first to list Drive backups.';
    listEl.className = 'text-xs text-amber-400';
    return;
  }
  listEl.textContent = 'Loading backups...';
  listEl.className = 'text-xs text-gray-400';
  try {
    const response = await fetch(config.sheetUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: 'list' })
    });
    if (!response.ok) throw new Error('HTTP ' + response.status);
    const result = await response.json();
    if (!result.ok) {
      listEl.textContent = result.message || 'Could not list backups.';
      listEl.className = 'text-xs text-red-400';
      return;
    }
    const backups = result.backups || [];
    if (!backups.length) {
      listEl.textContent = 'No backups found in the Drive folder yet.';
      listEl.className = 'text-xs text-gray-400';
      return;
    }
    listEl.innerHTML = backups.map(function (b) {
      const size = b.size ? (b.size / 1024).toFixed(1) + ' KB' : '';
      return '<div class="flex items-center justify-between gap-2 py-1.5 border-b border-gray-700 last:border-0">' +
        '<span class="truncate" title="' + esc(b.fileName) + '">' + esc(b.fileName) + (size ? ' <span class="text-gray-500">(' + size + ')</span>' : '') + '</span>' +
        '<button onclick="restoreDriveBackup(\'' + esc(b.fileName).replace(/'/g, "\\'") + '\')" class="px-2 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-[10px] font-bold transition">Restore</button>' +
        '</div>';
    }).join('');
    listEl.className = 'text-xs text-gray-300';
  } catch (error) {
    console.error('List backups failed', error);
    listEl.textContent = 'Failed to list Drive backups.';
    listEl.className = 'text-xs text-red-400';
  }
}

async function restoreDriveBackup(fileName) {
  const config = getGoogleSyncConfig();
  if (!config.sheetUrl) { showToast('Apps Script URL not configured.', 'error'); return; }
  if (!confirm('Restore backup "' + fileName + '"? This will REPLACE all local data.')) return;
  try {
    const response = await fetch(config.sheetUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: 'restore', fileName: fileName })
    });
    if (!response.ok) throw new Error('HTTP ' + response.status);
    const result = await response.json();
    if (!result.ok || !result.payload) { showToast(result.message || 'Restore failed.', 'error'); return; }
    const remoteState = result.payload.state ? result.payload.state : result.payload;
    if (!remoteState || !remoteState.entries) { showToast('Backup contains no valid ledger data.', 'error'); return; }
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
    if (result.payload.exportedAt) state.updatedAt = result.payload.exportedAt;
    saveState();
    renderAll();
    showToast('Backup restored from Google Drive successfully.');
  } catch (error) {
    console.error('Restore from Drive failed', error);
    showToast('Failed to restore from Google Drive.', 'error');
  }
}

$('listBackupsBtn').addEventListener('click', listDriveBackups);

/* ============================================================
   ONLINE / CLOUD UI
   ============================================================ */
function renderCloudStatus() {
  const pill = $('cloudStatusPill');
  const status = $('cloudStatus');
  if (!pill || !status) return;
  const email = cloudSignedInEmail();
  const bound = cloudBoundEmail();
  const online = cloudIsOnline();

  if (online) {
    pill.textContent = 'ONLINE';
    pill.className = 'px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-600 text-white';
    status.textContent = 'This workspace is synced to ' + email + '. Any change auto-saves to the cloud and appears on any device that signs in with this account.';
  } else if (email) {
    if (bound && bound.toLowerCase() !== email.toLowerCase()) {
      pill.textContent = 'LOCKED';
      pill.className = 'px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-600 text-white';
      status.textContent = 'This workspace is bound to ' + bound + '. Sign out and sign in as that Google account to sync this workspace.';
    } else {
      pill.textContent = 'SIGNED IN';
      pill.className = 'px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500 text-gray-900';
      status.textContent = 'Signed in as ' + email + ' — but no Apps Script URL is configured yet. Add it below to go online.';
    }
  } else {
    pill.textContent = 'OFFLINE';
    pill.className = 'px-2 py-0.5 rounded-full text-[10px] font-bold bg-gray-700 text-gray-300';
    status.textContent = 'Not signed in. Sign in with Google (header button) to sync this workspace from any device.';
  }
}

async function cloudSyncNow() {
  if (!cloudSignedInEmail()) { showToast('Sign in with Google first.', 'error'); return; }
  if (!cloudEndpoint()) { showToast('Add your Apps Script URL below to go online.', 'error'); return; }
  const res = await cloudGet();
  const remote = res && res.ok ? res.payload : null;
  if (!remote || !remote.state) { showToast('No cloud data yet for this account.', 'info'); return; }
  if (applyCloudRemote(remote)) {
    renderAll();
    renderCloudStatus();
    updateGoogleSyncStatus('Synced — pulled the latest cloud copy.', 'success');
    showToast('Pulled the latest cloud data.', 'success');
  }
}

async function cloudUploadNow() {
  if (!cloudSignedInEmail()) { showToast('Sign in with Google first.', 'error'); return; }
  if (!cloudEndpoint()) { showToast('Add your Apps Script URL below to go online.', 'error'); return; }
  const res = await cloudPush();
  if (res && res.ok) { updateGoogleSyncStatus('Uploaded current data to the cloud.', 'success'); showToast('Cloud upload complete.', 'success'); }
  else showToast('Cloud upload failed — check the Apps Script URL.', 'error');
}

async function cloudBackupNow() {
  if (!cloudSignedInEmail()) { showToast('Sign in with Google first.', 'error'); return; }
  if (!cloudEndpoint()) { showToast('Add your Apps Script URL below to go online.', 'error'); return; }
  const res = await cloudBackup();
  if (res && res.ok) { showToast('Cloud backup saved to Drive.', 'success'); await cloudListBackups(); }
  else showToast('Cloud backup failed — is DRIVE_FOLDER_ID set in google-sync.gs?', 'error');
}

async function cloudListBackups() {
  const listEl = $('cloudBackupList');
  if (!listEl) return;
  if (!cloudSignedInEmail() || !cloudEndpoint()) { listEl.textContent = 'Sign in + set the Apps Script URL to list cloud backups.'; return; }
  listEl.textContent = 'Loading backups…';
  const res = await cloudList();
  const backups = res && res.ok ? (res.backups || []) : [];
  if (!backups.length) { listEl.textContent = 'No cloud backups yet — click "Cloud Backup" to create one.'; return; }
  listEl.innerHTML = backups.map(function (b) {
    const size = b.size ? (b.size / 1024).toFixed(1) + ' KB' : '';
    return '<div class="flex items-center justify-between gap-2 py-1.5 border-b border-gray-700 last:border-0">' +
      '<span class="truncate" title="' + esc(b.fileName) + '">' + esc(b.fileName) + (size ? ' <span class="text-gray-500">(' + size + ')</span>' : '') + '</span>' +
      '<button onclick="restoreCloudBackup(\'' + esc(b.fileName).replace(/'/g, "\\'") + '\')" class="px-2 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-[10px] font-bold">Restore</button>' +
      '</div>';
  }).join('');
}

async function restoreCloudBackup(fileName) {
  if (!confirm('Restore cloud backup "' + fileName + '"? This replaces ALL local data for this workspace.')) return;
  const res = await cloudRestore(fileName);
  const remote = res && res.ok ? res.payload : null;
  if (!remote || !remote.state) { showToast('Could not read that backup.', 'error'); return; }
  if (applyCloudRemote(remote)) {
    renderAll();
    renderCloudStatus();
    showToast('Cloud backup restored.', 'success');
  }
}

$('cloudSyncNowBtn').addEventListener('click', function () { cloudSyncNow(); lucide.createIcons(); });
$('cloudUploadBtn').addEventListener('click', function () { cloudUploadNow(); lucide.createIcons(); });
$('cloudBackupBtn').addEventListener('click', function () { cloudBackupNow(); lucide.createIcons(); });

