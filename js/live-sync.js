/* ============================================================
   LIVE SYNC — every keystroke / value change syncs in real time
   ------------------------------------------------------------
   Reads are already live (Supabase realtime + polling). This module
   makes WRITES live too: a document-level listener fires on every
   `input`/`change` inside the app and calls `persistState()`, which
   (a) writes the whole state to localStorage and
   (b) pushes it to the cloud ~0.3s later.
   So a single character "A" typed anywhere — a note, a price decimal,
   a date, a dropdown — reaches every other signed-in device within
   about a second. Cost is low because both the save and the cloud
   push are debounced/coalesced, and only data-entry controls inside
   the app (not the login/admin/sync-review screens) are watched.
   ============================================================ */
(function () {
  function isControl(t) {
    return t && t.tagName && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName);
  }
  function inIgnored(t) {
    return t.closest && t.closest('#authScreen, #adminModal, #companyScreen, #syncReviewModal, [data-nolive]');
  }
  function fire() {
    if (typeof persistState === 'function') {
      try { persistState(); } catch (e) { /* best-effort */ }
    }
  }
  if (typeof document === 'undefined') return;
  document.addEventListener('input', function (ev) {
    const t = ev && ev.target;
    if (!isControl(t) || inIgnored(t)) return;
    fire();
  }, true);
  document.addEventListener('change', function (ev) {
    const t = ev && ev.target;
    if (!isControl(t) || inIgnored(t)) return;
    fire();
  }, true);
})();