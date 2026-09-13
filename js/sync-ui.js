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
  try { compareCloudAndDevice().catch(function () {}); } catch (e) { /* best-effort */ }
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
/* DEFINITIVE cloud self-test: write a unique marker to the shared cloud row
   through the REAL push path, read it back, then restore the original data.
   Shows exactly where sync breaks:
     - write fails  -> sign-in / approval / RLS / session / network problem
     - read stuck   -> the cloud reads are hitting an old row (RLS/cache/project)
     - round-trip OK -> the cloud is fine; any other device showing old data is
                        running an OLD build or cannot reach Supabase. */
async function cloudRoundTripTest() {
  if (!SUPA.configured()) { showToast('Supabase is required.', 'error'); return; }
  try { await SUPA.sessionUser(); } catch (e) {}
  if (!cloudReady()) { showToast('Sign in first.', 'error'); return; }
  const uid = SUPA.user && SUPA.user.id;
  if (!uid) { showToast('Sign in first.', 'error'); return; }
  const out = $('cloudTruth');
  if (!out) return;
  if (!confirm('Run a cloud round-trip self-test?\n\nIt writes a tiny test marker to the SHARED cloud and restores your data right after. Use it to prove whether the cloud is actually updating.')) return;
  out.innerHTML = '<div class="text-[10px] text-gray-500">Round-trip test running…</div>';
  const token = 'rtest-' + Math.random().toString(36).slice(2, 10) + '-' + Date.now().toString(36);
  const lines = [];
  try {
    const before = await cloudGet();
    lines.push('1) Read cloud: ' + (before && before.ok ? 'OK — cloud ' + (before.payload && before.payload.state ? 'has data' : 'is EMPTY') : 'FAILED — ' + esc((before && before.error) || 'unknown')));
    if (before && before.ok) {
      const marker = JSON.parse(JSON.stringify(state));
      marker.__diag = { token: token, at: new Date().toISOString() };
      const payload = { app: 'daily-crispy-roll-ledger', exportedAt: new Date().toISOString(), device: typeof getDeviceFact === 'function' ? getDeviceFact() : null, state: marker };
      const up = await SUPA.saveLedger(uid, payload);
      lines.push('2) Write test marker: ' + (up && up.ok ? 'OK' : 'FAILED — ' + esc((up && up.error) || 'unknown')));
      if (up && up.ok) {
        const after = await cloudGet();
        const gotToken = after && after.ok && after.payload && after.payload.state && after.payload.state.__diag && after.payload.state.__diag.token;
        lines.push('3) Read back marker: ' + (gotToken === token ? 'MATCHED — the cloud row updates correctly ✓' : 'STALE — the cloud read still returns the OLD row (read/RLS/caching issue) ✗'));
        const restore = await SUPA.saveLedger(uid, toGooglePayload());
        lines.push('4) Restored original data: ' + (restore && restore.ok ? 'OK (the marker is gone)' : 'WRITE FAILED while restoring — press Upload Now / Overwrite Cloud on this device to restore your data.'));
      }
    }
  } catch (e) { lines.push('ERROR: ' + esc(String(e))); }
  out.innerHTML = '<div class="max-h-40 overflow-y-auto text-[10px] whitespace-pre-wrap">' + lines.join('<br>') + '</div>';
  if (typeof renderCloudStatus === 'function') { try { renderCloudStatus(); } catch (e) {} }
}
if ($('cloudRttBtn')) $('cloudRttBtn').addEventListener('click', cloudRoundTripTest);
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
if ($('cloudTruthBtn')) $('cloudTruthBtn').addEventListener('click', compareCloudAndDevice);

/* "Compare Cloud vs This Device" — shows what the CLOUD actually holds next to
   what THIS device holds, so a stale cloud is visible instead of a mystery. */
function cloudTruthRow(label, cloudVal, localVal) {
  var same = String(cloudVal) === String(localVal);
  return '<div class="flex justify-between items-center gap-2 py-1 border-b border-gray-800 last:border-0">' +
    '<span class="text-gray-300">' + esc(label) + '</span>' +
    '<span class="text-right ' + (same ? 'text-emerald-400' : 'text-red-400') + '">' +
    (same ? esc(cloudVal) : 'cloud: ' + esc(cloudVal) + ' · this device: ' + esc(localVal)) +
    '</span></div>';
}
async function compareCloudAndDevice() {
  if (SUPA.configured()) { try { await SUPA.sessionUser(); } catch (e) {} }
  const out = $('cloudTruth');
  if (!out) return;
  if (!cloudReady()) { out.innerHTML = '<div class="text-[10px] text-amber-400">Sign in first.</div>'; return; }
  out.innerHTML = '<div class="text-[10px] text-gray-500">Reading the cloud…</div>';
  const res = await cloudGet();
  if (!res || !res.ok) { out.innerHTML = '<div class="text-[10px] text-red-400">Could not read the cloud: ' + esc((res && res.error) || 'unknown error') + '</div>'; return; }
  const c = (res.payload && res.payload.state) || null;
  if (!c) { out.innerHTML = '<div class="text-[10px] text-amber-400">The cloud is EMPTY. On the device with the real data press "Overwrite Cloud With This Device" (or Upload Now), then Sync Now here.</div>'; return; }
  const cloudAt = res.payload && res.payload.exportedAt ? new Date(res.payload.exportedAt).toLocaleString() : '—';
  const eggC = (c.prices || []).find(function (p) { return p.name === 'Egg'; });
  const eggL = (state.prices || []).find(function (p) { return p.name === 'Egg'; });
  function prodSummary(a) {
    a = a || [];
    if (!a.length) return '—';
    return a.map(function (p) { return p.date + (p.pieces > 0 ? ' ✓' + p.pieces + 'pcs' : ' ⏳packing'); }).join(', ');
  }
  const lines = [];
  lines.push('<div class="text-[10px] text-gray-500 pb-1">Cloud last saved: ' + esc(cloudAt) + '</div>');
  lines.push(cloudTruthRow('Egg price', String(eggC ? eggC.price : '—'), String(eggL ? eggL.price : '—')));
  lines.push(cloudTruthRow('Production', prodSummary(c.production), prodSummary(state.production)));
  lines.push(cloudTruthRow('Price-history rows', String((c.priceHistory || []).length), String((state.priceHistory || []).length)));
  lines.push(cloudTruthRow('Sales rows', String((c.sales || []).length), String((state.sales || []).length)));
  lines.push(cloudTruthRow('Purchases rows', String((c.purchases || []).length), String((state.purchases || []).length)));
  lines.push(cloudTruthRow('Customers', String((c.customers || []).length), String((state.customers || []).length)));
  lines.push(cloudTruthRow('Suppliers', String((c.suppliers || []).length), String((state.suppliers || []).length)));
  out.innerHTML = '<div class="max-h-56 overflow-y-auto">' + lines.join('') + '</div>';
  try { if (typeof safeIcons === 'function') safeIcons(); } catch (e) {}
}
