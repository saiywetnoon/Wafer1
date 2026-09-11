/* Supabase-only sync controls. */
function updateGoogleSyncStatus(message, type) {
  const el = $('googleSyncStatus'); if (!el) return;
  el.textContent = message || 'Supabase sync is active for every approved device.';
  el.className = 'text-[10px] mt-2 ' + (type === 'error' ? 'text-red-400' : type === 'success' ? 'text-emerald-400' : 'text-gray-400');
}
function toGooglePayload() {
  return { app: 'daily-crispy-roll-ledger', exportedAt: new Date().toISOString(), device: typeof getDeviceFact === 'function' ? getDeviceFact() : null, state: JSON.parse(JSON.stringify(state)) };
}
function downloadFullBackup() {
  const blob = new Blob(['\uFEFF' + JSON.stringify(toGooglePayload(), null, 2)], { type: 'application/json;charset=utf-8;' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'crispy-roll-supabase-backup-' + today() + '.json'; a.click(); URL.revokeObjectURL(a.href);
  showToast('Backup downloaded.', 'success');
}
function renderCloudStatus() {
  const pill = $('cloudStatusPill'), status = $('cloudStatus'); if (!pill || !status) return;
  const online = cloudIsOnline(), issue = cloudSyncFailed || syncQueueIsDirty();
  pill.textContent = online ? (issue ? 'SYNC ISSUE' : 'SYNCED') : 'OFFLINE';
  pill.className = 'px-2 py-0.5 rounded-full text-[10px] font-bold ' + (online && !issue ? 'bg-emerald-600 text-white' : issue ? 'bg-red-600 text-white' : 'bg-gray-700 text-gray-300');
  status.textContent = online ? (issue ? 'A change is saved on this device and is retrying to Supabase.' : 'Supabase shared workspace: changes appear on every approved device automatically.') : 'Sign in to Supabase to use the shared workspace.';
  const set = (id, value) => { const el = $(id); if (el) el.textContent = value || '—'; };
  set('deviceSyncEmail', cloudSignedInEmail() || 'Not signed in'); set('deviceSyncLabel', typeof getDeviceLabel === 'function' ? getDeviceLabel() : '');
  set('deviceSyncEngine', 'Supabase shared workspace'); set('deviceSyncRealtime', online ? 'Listening' : '—');
  set('deviceSyncBuild', typeof __LEDGER_BUILD !== 'undefined' ? __LEDGER_BUILD : ''); set('deviceSyncLast', cloudLastSyncAt() || '—');
}
async function cloudSyncNow() {
  // A Supabase session can silently fall out of the in-memory cache after a
  // refresh/session refresh while the user stays on the Sync tab. Restore it
  // BEFORE checking cloudReady(), otherwise the button silently does nothing.
  if (SUPA.configured()) { try { await SUPA.sessionUser(); } catch (e) {} }
  if (!cloudReady()) { showToast('Sign in first.', 'error'); return; }
  const res = await cloudGet();
  if (!res || !res.ok) { updateGoogleSyncStatus('Could not read Supabase. Retrying automatically.', 'error'); return; }
  if (res.payload && res.payload.state) handleRemoteCopy(res.payload.state, Date.parse(res.exportedAt) || undefined, 'Manual sync', res.payload.device || null); else await cloudPush();
  renderCloudStatus();
}
async function reconnectRealtime() {
  if (SUPA.configured()) { try { await SUPA.sessionUser(); } catch (e) {} }
  if (!cloudReady()) { showToast('Sign in first.', 'error'); return; }
  SUPA.unsubscribeRealtime();
  if (SUPA.user && SUPA.user.id) supabaseWatch(SUPA.user.id);
  await cloudSyncNow();
}
/* One-time FORCE copy: overwrite the whole CLOUD row with this device's real
   state, bypassing the merge. This is the recovery for "the numbers are right
   only on this device and every other device shows old data". Run it ONCE on
   the device with the real ledger; other devices then pull this copy on their
   next sync/reload (60s freshness poll). */
async function cloudForceOverwriteCloud() {
  if (SUPA.configured()) { try { await SUPA.sessionUser(); } catch (e) {} }
  if (!cloudReady()) { showToast('Sign in first.', 'error'); return; }
  const uid = SUPA.user && SUPA.user.id;
  if (!uid) { showToast('Sign in first.', 'error'); return; }
  if (!confirm('Replace the CLOUD ledger with this device\'s data?\n\nAll other devices will pull this exact copy at their next sync.\nAny changes that exist ONLY on the cloud right now will be replaced.')) return;
  const res = await SUPA.saveLedger(uid, toGooglePayload());
  if (res && res.ok) {
    syncQueueClear(); cloudSyncFailed = false; cloudMarkLastSync();
    updateGoogleSyncStatus('Cloud overwritten with this device\'s data. Other devices will pull it automatically within a minute.', 'success');
    showToast('Cloud now matches this device.', 'success');
  } else {
    updateGoogleSyncStatus('Could not overwrite the cloud: ' + ((res && res.error) || 'unknown error'), 'error');
  }
  renderCloudStatus();
}
/* One-time FORCE copy: replace THIS device's local ledger with the cloud copy,
   bypassing the merge. Use it on each device that shows stale numbers AFTER
   the cloud was overwritten from the real device. */
async function cloudForcePullFromCloud() {
  if (SUPA.configured()) { try { await SUPA.sessionUser(); } catch (e) {} }
  if (!cloudReady()) { showToast('Sign in first.', 'error'); return; }
  if (!confirm('Replace THIS device\'s data with the cloud copy?\n\nUse this on a device showing stale/old numbers after you overwrote the cloud.\nLocal-only changes that never reached the cloud will be replaced.')) return;
  const res = await cloudGet();
  if (!res || !res.ok) { updateGoogleSyncStatus('Could not read the cloud yet — retry in a moment.', 'error'); return; }
  if (!res.payload || !res.payload.state) { updateGoogleSyncStatus('The cloud is empty — nothing to load.', 'error'); return; }
  setCloudSyncSuppressed(true);
  try {
    if (applyCloudRemote(res.payload, Date.parse(res.exportedAt) || undefined, true)) {
      renderAll();
      try { loadDraftIfNewer(); } catch (e) {}
      syncQueueClear(); cloudSyncFailed = false; cloudMarkLastSync();
      updateGoogleSyncStatus('This device now matches the cloud.', 'success');
      showToast('Loaded the cloud ledger onto this device.', 'success');
    } else {
      updateGoogleSyncStatus('Could not load the cloud copy.', 'error');
    }
  } finally { setCloudSyncSuppressed(false); }
  renderCloudStatus();
}
function renderSyncTab() { renderCloudStatus(); }
if ($('exportFullBackupBtn')) $('exportFullBackupBtn').addEventListener('click', downloadFullBackup);
if ($('restoreFullBackupBtn')) $('restoreFullBackupBtn').addEventListener('click', () => $('restoreFileInput').click());
if ($('restoreFileInput')) $('restoreFileInput').addEventListener('change', function () {
  const file = this.files[0]; if (!file) return; const reader = new FileReader();
  reader.onload = function () { try { const parsed = JSON.parse(reader.result); const remote = parsed.state ? parsed : { state: parsed }; if (!confirm('Restore this backup and sync it to every device?')) return; applyCloudRemote(remote, Date.parse(remote.exportedAt) || undefined, true); renderAll(); cloudPush(); } catch (e) { showToast('Could not read backup file.', 'error'); } };
  reader.readAsText(file); this.value = '';
});
if ($('cloudSyncNowBtn')) $('cloudSyncNowBtn').addEventListener('click', cloudSyncNow);
if ($('cloudUploadBtn')) $('cloudUploadBtn').addEventListener('click', () => cloudPush());
if ($('cloudBackupBtn')) $('cloudBackupBtn').addEventListener('click', downloadFullBackup);
if ($('reconnectLiveBtn')) $('reconnectLiveBtn').addEventListener('click', reconnectRealtime);
if ($('forceOverwriteCloudBtn')) $('forceOverwriteCloudBtn').addEventListener('click', cloudForceOverwriteCloud);
if ($('forcePullCloudBtn')) $('forcePullCloudBtn').addEventListener('click', cloudForcePullFromCloud);
