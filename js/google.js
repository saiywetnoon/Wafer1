/* ============================================================
   SYNC CONFIG + PAYLOAD + STATUS — shared helpers
   ------------------------------------------------------------
   The legacy Google Sheets / Apps-Script upstream was removed in
   v1.11 — the app is Supabase-only. This module now only provides
   the small config/payload/status/queue helpers that the other
   modules still share. `triggerGoogleSync` is redefined in init.js
   with the real Supabase-backed implementation.
   ============================================================ */

/* ---------- Sync config (each workspace) ---------- */
/* The config object still carries legacy keys from older builds
   (sheetUrl, backupFrequency, lastDriveBackupDate). Nothing reads
   them anymore, but we keep the shape so old data is never lost. */
function getGoogleSyncConfig() {
  try {
    const raw = localStorage.getItem(companyConfigKey());
    if (!raw) return { sheetUrl: '', backupFrequency: 'daily', lastDriveBackupDate: '' };
    return Object.assign({ sheetUrl: '', backupFrequency: 'daily', lastDriveBackupDate: '' }, JSON.parse(raw));
  } catch (e) {
    console.warn('Could not read sync config', e);
    return { sheetUrl: '', backupFrequency: 'daily', lastDriveBackupDate: '' };
  }
}
function setGoogleSyncConfig(next) {
  const config = Object.assign({ sheetUrl: '', backupFrequency: 'daily', lastDriveBackupDate: '' }, next || {});
  try {
    localStorage.setItem(companyConfigKey(), JSON.stringify(config));
  } catch (e) {
    console.warn('Could not store sync config', e);
  }
  updateGoogleSyncStatus();
}

/* ---------- Status line in the Sync & Backup tab ---------- */
function updateGoogleSyncStatus(message, type) {
  const el = $('googleSyncStatus');
  if (!el) return;
  if (!message) {
    // No explicit message: derive from the actual backend state.
    if (SUPA.libReady() && SUPA.user && SUPA.user.id) {
      el.textContent = 'Connected — your ledger auto-saves to your account on every change.';
      el.className = 'text-xs text-emerald-400 mt-2';
    } else if (SUPA.libReady()) {
      el.textContent = 'Ready. Sign in to sync your ledger across devices.';
      el.className = 'text-xs text-gray-400 mt-2';
    } else {
      el.textContent = 'Supabase library is not loaded yet — connecting…';
      el.className = 'text-xs text-gray-400 mt-2';
    }
    return;
  }
  type = type || 'info';
  const colors = { success: 'text-emerald-400', error: 'text-red-400', info: 'text-amber-400' };
  el.textContent = message;
  el.className = 'text-xs ' + (colors[type] || 'text-gray-400') + ' mt-2';
}

/* ---------- Cloud payload ---------- */
function toGooglePayload() {
  return {
    app: 'daily-crispy-roll-ledger',
    exportedAt: new Date().toISOString(),
    state
  };
}

/* ---------- Base queue trigger (overridden in init.js) ----------
   Storage calls triggerGoogleSync() on every save; init.js replaces this
   with the Supabase push. This fallback is a safe no-op so a stray call can
   never touch the legacy backend. */
function triggerGoogleSync() {
  if (typeof cloudPush === 'function' && typeof cloudIsOnline === 'function' && cloudIsOnline()) {
    clearTimeout(googleSyncTimer);
    googleSyncTimer = setTimeout(function () {
      try { cloudPush(); } catch (e) { /* best-effort */ }
    }, 700);
  }
}