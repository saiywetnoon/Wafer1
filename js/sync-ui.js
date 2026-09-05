/* ============================================================
   SYNC & BACKUP UI
   ============================================================ */
function renderSyncTab() {
  updateGoogleSyncStatus();
  renderCloudStatus();
}

function downloadFullBackup() {
  const payload = toGooglePayload();
  const blob = new Blob(['\uFEFF' + JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'crispy-roll-full-backup-' + today() + '.json';
  a.click();
  URL.revokeObjectURL(a.href);
  showToast('Full backup downloaded.');
}

$('exportFullBackupBtn').addEventListener('click', function () {
  downloadFullBackup();
});

$('restoreFullBackupBtn').addEventListener('click', function () {
  $('restoreFileInput').click();
});

$('restoreFileInput').addEventListener('change', function () {
  const file = this.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async function () {
    try {
      const parsed = JSON.parse(reader.result);
      const remoteState = parsed.state ? parsed.state : parsed;
      if (!remoteState || !remoteState.entries) { showToast('Invalid backup file.', 'error'); return; }
      const ok = await Modal.confirm({ title: 'Restore full backup?', message: 'This will REPLACE all local data.', danger: true, okLabel: 'Restore' });
      if (!ok) return;
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

/* ============================================================
   ONLINE / CLOUD UI
   ============================================================ */
function renderCloudStatus() {
  const pill = $('cloudStatusPill');
  const status = $('cloudStatus');
  if (!pill || !status) return;
  const email = cloudSignedInEmail();
  const online = cloudIsOnline();

  if (online) {
    var lastSync = (typeof cloudLastSyncAt === 'function') ? cloudLastSyncAt() : '';
    var lastHM = '';
    if (lastSync) {
      try { var ld = new Date(lastSync); lastHM = pad2(ld.getHours()) + ':' + pad2(ld.getMinutes()); } catch (e) {}
    }
    var issue = (typeof cloudSyncFailed === 'boolean' ? cloudSyncFailed : false)
      || (typeof syncQueueIsDirty === 'function' ? syncQueueIsDirty() : false);
    if (issue) {
      pill.textContent = 'SYNC ISSUE';
      pill.className = 'px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-600 text-white';
      status.textContent = 'Last cloud sync: ' + (lastHM || '—') + '. ⚠ A recent change has NOT reached the cloud yet — it is saved on this device and auto-retrying. Check your internet / sign-in.';
    } else {
      pill.textContent = 'ONLINE';
      pill.className = 'px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-600 text-white';
      status.textContent = 'Synced to ' + email + (lastHM ? '. Last cloud sync: ' + lastHM + '.' : '') + ' Any change auto-saves to the cloud and appears on any device that signs in with this account.';
    }
  } else if (email) {
    pill.textContent = 'SYNCING';
    pill.className = 'px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500 text-gray-900';
    status.textContent = 'Signed in as ' + email + '. Preparing your workspace…';
  } else {
    pill.textContent = 'OFFLINE';
    pill.className = 'px-2 py-0.5 rounded-full text-[10px] font-bold bg-gray-700 text-gray-300';
    status.textContent = 'Not signed in. Log in to sync your ledger to any device.';
  }
}

async function cloudSyncNow() {
  if (!cloudSignedInEmail()) { showToast('Sign in first.', 'error'); return; }
  if (!cloudReady()) { showToast('Sign in first.', 'error'); return; }
  updateGoogleSyncStatus('Syncing…', 'info');
  const res = await cloudGet();
  const remote = (res && res.ok) ? res.payload : null;
  const remoteState = (remote && remote.state) ? remote.state : null;
  const localCount = stateDataCount(state);
  const remoteCount = remoteState ? stateDataCount(remoteState) : 0;

  // Nothing anywhere yet -> nothing to sync.
  if (remoteCount === 0 && localCount === 0) { updateGoogleSyncStatus('Online — nothing to sync yet.', 'success'); renderCloudStatus(); return; }
  // Cloud empty, we have local data -> push it up.
  if (remoteCount === 0 && localCount > 0) {
    const up = await cloudPush();
    if (up && up.ok) { updateGoogleSyncStatus('Synced — uploaded ' + localCount + ' day(s) to your account.', 'success'); showToast('Uploaded ' + localCount + ' day(s) to the cloud.', 'success'); }
    else showToast('Sync failed.', 'error');
    renderCloudStatus(); return;
  }
  // Both have data -> keep whichever is newer.
  const remoteTs = (remote && remote.exportedAt) ? Date.parse(remote.exportedAt) : 0;
  const localTs = state.updatedAt ? Date.parse(state.updatedAt) : 0;
  if (remoteTs && localTs && remoteTs < localTs) {
    const up = await cloudPush();
    if (up && up.ok) updateGoogleSyncStatus('Synced — your local copy was newer, pushed to cloud.', 'success');
    else showToast('Sync failed.', 'error');
    renderCloudStatus(); return;
  }
  if (applyCloudRemote(remote)) {
    renderAll();
    updateGoogleSyncStatus('Synced — pulled the latest cloud copy.', 'success');
    showToast('Pulled the latest cloud data.', 'success');
    // A draft pulled from the cloud (typed on another device) goes in the form.
    try { loadDraftIfNewer(); } catch (e) {}
  } else {
    updateGoogleSyncStatus('Already up to date.', 'success');
  }
  renderCloudStatus();
}

async function cloudUploadNow() {
  if (!cloudSignedInEmail()) { showToast('Sign in first.', 'error'); return; }
  if (!cloudReady()) { showToast('Sign in first.', 'error'); return; }
  const res = await cloudPush();
  if (res && res.ok) { updateGoogleSyncStatus('Uploaded current data to the cloud.', 'success'); showToast('Cloud upload complete.', 'success'); }
  else showToast('Cloud upload failed.', 'error');
}

async function cloudBackupNow() {
  if (!cloudSignedInEmail()) { showToast('Sign in first.', 'error'); return; }
  if (!cloudReady()) { showToast('Sign in first.', 'error'); return; }
  // Supabase has no Drive folder; a downloadable snapshot IS the backup.
  downloadFullBackup();
}

async function cloudListBackups() {
  const listEl = $('cloudBackupList');
  if (!listEl) return;
  if (!cloudReady()) { listEl.textContent = 'Sign in to see your backups.'; return; }
  listEl.textContent = 'Your data is stored securely in your account. Use "Download Backup" to keep a copy.';
}

async function restoreCloudBackup(fileName) {
  const ok = await Modal.confirm({ title: 'Restore cloud backup?', message: 'Restore cloud backup "' + fileName + '"? This replaces ALL local data for this workspace.', danger: true, okLabel: 'Restore' });
  if (!ok) return;
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

