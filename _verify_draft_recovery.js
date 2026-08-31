/* One-off Node harness for draft auto-sync logic (state.draft in the ledger).
   Loads config.js, storage.js, helpers.js, usage.js into one eval scope with
   DOM stubs and exercises loadDraftIfNewer / restoreDraftToForm /
   clearDraft / the hint. */
const fs = require('fs');
const path = require('path');

const dir = 'd:\\wafer\\Wafer_documentary\\dail-ledger v1.5\\js';
const read = (f) => fs.readFileSync(path.join(dir, f), 'utf8');

/* ---- browser stubs ---- */
const localStorageData = {};
global.localStorage = {
  getItem: (k) => (k in localStorageData ? localStorageData[k] : null),
  setItem: (k, v) => { localStorageData[k] = String(v); },
  removeItem: (k) => { delete localStorageData[k]; }
};
global.cloudIsAvailable = () => true;
global.cloudIsOnline = () => true;
global.syncQueueIsDirty = () => false;
global.cloudLastSyncAt = () => '2026-08-31T06:58:00.000Z';
global.cloudSyncFailed = false;
global.pendingCloudPushQueued = false;
const els = {};
function $makeEl() { return { value: '', textContent: '', className: '', classList: { add() {}, remove() {} }, addEventListener() {}, style: {}, appendChild() {}, remove() {}, setAttribute() {} }; }
global.document = { getElementById: (id) => { if (!els[id]) els[id] = $makeEl(); return els[id]; }, querySelectorAll: () => [], createElement: () => $makeEl() };
global.showToast = () => {};
global.lucide = { createIcons() {} };
global.uid = () => 'uid-' + Math.random().toString(36).slice(2, 9);
let confirmResult = true;
global.confirm = () => confirmResult;

/* ---- boot the app modules in load order (config → storage → helpers → usage) ---- */
const src = read('config.js') + '\n' + read('storage.js') + '\n' + read('helpers.js') + '\n' + read('usage.js') + '\n' + `
;(function runTests() {
  let pass = 0, fail = 0;
  function ok(cond, msg) { if (cond) { pass++; console.log('PASS ' + msg); } else { fail++; console.log('FAIL ' + msg); } }
  const DRAFT_KEY = 'dailyCrispyRollLedger_draft_v2';
  function daysAgo(n) { const d = new Date(); d.setDate(d.getDate() - n); const off = d.getTimezoneOffset(); return new Date(d.getTime() - off * 60000).toISOString().slice(0, 10); }
  const T = today(), Y = daysAgo(1);
  const stale = { date: Y,
    usage: { Flour: 120, Egg: 3, Sugar: 220 }, additionalCost: 500,
    bagsProduced: 60, pieces: 360, laborMinutes: 90, notes: 'good batch' };

  // 1) A SYNCED draft in state.draft (came from the cloud / previous save)
  //    is restored to the form for the same day.
  state.draft = Object.assign({ capturedAt: new Date().toISOString() }, Object.assign({ date: T }, stale, { date: T }));
  confirmResult = true; olderDraftPrompted = true; draftRestored = false; draftUsage = {};
  loadDraftIfNewer();
  ok(draftRestored && draftUsage.Flour === 120, 'same-day state.draft restores to form');
  ok(els.logDate.value === T, 'same-day draft sets form date = today');

  // 2) STALE (previous-day) synced draft is offered once and loaded on accept.
  state.draft = Object.assign({ capturedAt: new Date().toISOString() }, stale);
  confirmResult = true; olderDraftPrompted = false; draftRestored = false; draftUsage = {};
  els.logDate.value = ''; els.additionalCost.value = ''; els.logBagsProduced.value = ''; els.logPieces.value = '';
  loadDraftIfNewer();
  ok(draftRestored, 'stale synced draft restored after accept');
  ok(els.logDate.value === Y && els.logBagsProduced.value === 60, 'stale draft fills form with its date + values');

  // 3) Declining the stale prompt KEEPS the draft (nothing deleted, still synced).
  confirmResult = false; olderDraftPrompted = false; draftRestored = false; draftUsage = {};
  loadDraftIfNewer();
  ok(!draftRestored, 'declining stale prompt does not restore form');
  ok(!!state.draft && state.draft.date === Y, 'declining keeps the synced draft (will re-sync)');

  // 4) A committed batch for that date clears the stale draft instead of clobbering.
  state.production = [{ id: 'p1', date: Y, pieces: 360 }];
  olderDraftPrompted = false; draftRestored = false; draftUsage = {}; confirmResult = true;
  loadDraftIfNewer();
  ok(!draftRestored && !state.draft, 'committed batch clears conflicting draft (never clobber)');
  state.production = [];

  // 5) Legacy localStorage mirror is promoted into the synced state on restore.
  state.draft = null;
  delete localStorageData[DRAFT_KEY];
  localStorageData[DRAFT_KEY] = JSON.stringify(stale);
  confirmResult = true; olderDraftPrompted = false; draftRestored = false; draftUsage = {};
  loadDraftIfNewer();
  ok(draftRestored && !!state.draft && state.draft.date === Y, 'legacy mirror promoted into synced state');
  // 6) All-zero drafts are not restored (they are not real content).
  state.draft = null;
  localStorageData[DRAFT_KEY] = JSON.stringify({ date: T, usage: { Flour: 0 }, bagsProduced: 0, pieces: 0 });
  olderDraftPrompted = true; draftRestored = false; draftUsage = {};
  loadDraftIfNewer();
  ok(!draftRestored, 'all-zero draft ignored');

  // 7) clearDraft removes the synced draft + the mirror.
  state.draft = stale; localStorageData[DRAFT_KEY] = JSON.stringify(stale);
  clearDraft();
  ok(state.draft === null && !localStorageData[DRAFT_KEY], 'clearDraft nukes synced draft + mirror');

  // 8) draftHasRealContent + hint: committed date hides, edited uncommitted shows
  //    the auto-sync hint.
  draftTouched = true; draftUsage = { Flour: 120 }; els.draftHint = $makeEl();
  els.logBagsProduced = { value: '60' };
  state.production = [{ id: 'p1', date: Y, pieces: 360 }];
  els.logDate.value = Y; updateDraftHint();
  ok(els.draftHint.textContent === '', 'hint hidden for a committed date');
  state.production = [];
  els.logDate.value = T; updateDraftHint();
  ok(els.draftHint.textContent.indexOf('Save Production Work') >= 0, 'hint shows Save-to-stock nudge for edited uncommitted date');

  // 9) Push bookkeeping flags exist (used by the status pill + beforeunload).
  ok(typeof pendingCloudPushQueued === 'boolean', 'pendingCloudPushQueued flag defined');
  pendingCloudPushQueued = true; ok(pendingCloudPushQueued === true, 'pendingCloudPushQueued flips true');

  // 10) Honest status pill: shows last-cloud-sync time; shows failure state.
  const statusBar = $makeEl(); const statusText = $makeEl();
  els.appStatusBar = statusBar; els.appStatusText = statusText;
  pendingCloudPushQueued = false;
  cloudSyncFailed = false;
  const lastHM = pad2(new Date('2026-08-31T06:58:00.000Z').getHours()) + ':' + pad2(new Date('2026-08-31T06:58:00.000Z').getMinutes());
  updateAppStatus();
  ok(statusText.textContent.indexOf('Synced') >= 0 && statusText.textContent.indexOf('⇄ ' + lastHM) >= 0,
    'pill shows "Synced ⇄ ' + lastHM + '" (last sync time, not current clock) when healthy');
  cloudSyncFailed = true;
  updateAppStatus();
  ok(statusText.textContent.indexOf('Sync failed — retrying') >= 0,
    'pill shows "Sync failed — retrying" when a push failed');
  cloudSyncFailed = false; pendingCloudPushQueued = false;

  console.log(fail === 0 ? 'ALL DRAFT CHECKS PASSED' : (fail + ' FAILED'));
})();
`;
eval(src);