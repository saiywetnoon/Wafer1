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
  if (!cloudReady()) { showToast('Sign in first.', 'error'); return; }
  const res = await cloudGet();
  if (!res || !res.ok) { updateGoogleSyncStatus('Could not read Supabase. Retrying automatically.', 'error'); return; }
  if (res.payload && res.payload.state) handleRemoteCopy(res.payload.state, Date.parse(res.exportedAt) || undefined, 'Manual sync', res.payload.device || null); else await cloudPush();
  renderCloudStatus();
}
async function reconnectRealtime() { if (!cloudReady()) return; SUPA.unsubscribeRealtime(); supabaseWatch(SUPA.user.id); await cloudSyncNow(); }
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
