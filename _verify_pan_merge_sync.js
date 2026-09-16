/* PAN REPORT → CROSS-DEVICE MERGE REGRESSION — "Device B stops updating".
   ----------------------------------------------------------------------------
   Reproduces the reported scenario with the REAL modules (config, storage,
   helpers, usage, ledger, cloud) in ONE eval scope:

     • Device A finishes a pan batch → saveProductionFromRun() creates a
       production row for the day and pushes the whole ledger to the cloud.
     • Device B signs in for the first time → it ADOPTS the cloud copy
       (applyCloudRemote) — this first update always works.
     • Device A finishes another pan → saveProductionFromRun() MERGES the new
       rolls into the SAME day's row and pushes again.
     • Device B receives the copy → handleRemoteCopy() must merge the newest
       rolls/bags in.

   BEFORE the fix this FAILS: saveProductionFromRun() did not stamp the row's
   updatedAt, so device B's LWW merge saw an identical timestamp, kept its
   stale row, and even re-pushed the stale copy to the cloud — the exact "after
   the frying pan finishes one roll, device B doesn't get updated report".

   Also checks the Production-form auto bag refresh (refreshProductionFormCounts):
   a pan report on the currently shown date must visibly update the Bags field.

   Run:  node _verify_pan_merge_sync.js
   ---------------------------------------------------------------------------- */
'use strict';
const fs = require('fs');
const path = require('path');
const dir = path.join(__dirname, 'js');
const read = (f) => fs.readFileSync(path.join(dir, f), 'utf8');

/* ---------- DOM stubs (same style as _verify_pan_report.js) ---------- */
class ClassListStub {
  constructor(e) { this._e = e; this._s = new Set(); }
  _sync() { this._e._className = [...this._s].join(' '); }
  add(...c) { c.forEach(x => this._s.add(x)); this._sync(); }
  remove(...c) { c.forEach(x => this._s.delete(x)); this._sync(); }
  toggle(c, force) { if (force === undefined) force = !this._s.has(c); force ? this._s.add(c) : this._s.delete(c); this._sync(); }
  contains(c) { return this._s.has(c); }
}
class El {
  constructor(id) {
    this.id = id || '';
    this.tagName = 'DIV';
    this._className = '';
    this.classList = new ClassListStub(this);
    this.style = { width: '', setProperty() {} };
    this.textContent = '';
    this._innerHTML = '';
    this._attrs = {};
    this._listeners = {};
    this.value = '';
    this.checked = false;
    this.dataset = {};
  }
  get className() { return this._className; }
  set className(v) { this._className = v; }
  get innerHTML() { return this._innerHTML; }
  set innerHTML(v) { this._innerHTML = v; }
  setAttribute(k, v) { this._attrs[k] = v; }
  getAttribute(k) { return k in this._attrs ? this._attrs[k] : null; }
  addEventListener(t, f) { (this._listeners[t] = this._listeners[t] || []).push(f); }
  dispatch(t, e) {
    const ev = Object.assign({ target: this, preventDefault() {}, stopPropagation() {} }, e || {});
    (this._listeners[t] || []).slice().forEach(f => f(ev));
  }
  querySelector() { return null; }
  querySelectorAll() { return []; }
  closest() { return null; }
  click() {}
  focus() {}
  remove() {}
  appendChild() {}
}
const byId = {};
function el(id) { return (byId[id] = byId[id] || new El(id)); }

const docListeners = {};
global.document = {
  title: 'Daily Crispy Roll Ledger',
  readyState: 'complete',
  addEventListener(t, f) { (docListeners[t] = docListeners[t] || []).push(f); },
  body: { classList: { add() {}, remove() {}, contains() { return false; }, toggle() {} } },
  getElementById(id) { return el(id); },
  querySelector(sel) {
    if (sel && sel.indexOf('data-tab') >= 0) return el('tabbtn');
    return null;
  },
  querySelectorAll() { return []; },
  createElement() { return new El(); }
};
global.window = global;
global.$ = (id) => document.getElementById(id);
global.showToast = () => {};
global.confirm = () => true;
global.lucide = { createIcons() {} };
try { Object.defineProperty(global, 'navigator', { value: { userAgent: 'Harness' }, configurable: true }); } catch (e) {}
global.pulseSuccess = () => {};
global.flashEl = () => {};
global.wireResponsiveTables = () => {};
global.updateAppStatus = () => {};
global.updateGoogleSyncStatus = () => {};
global.renderCloudStatus = () => {};
global.deviceLabelOf = () => 'Device A';
global.getSessionId = () => 'sess-test-tab';
global.SUPA = { configured: () => false, user: null, saveLedger: async () => ({ ok: true }), getLedger: async () => null };

const store = {};
global.localStorage = {
  getItem(k) { return k in store ? store[k] : null; },
  setItem(k, v) { store[k] = String(v); },
  removeItem(k) { delete store[k]; }
};

const src = read('config.js') + '\n' + read('storage.js') + '\n' + read('helpers.js') + '\n' +
  read('usage.js') + '\n' + read('ledger.js') + '\n' + read('cloud.js') + '\n' + `
;
// Eval-scope overrides: later top-level declarations shadow cloud.js / init.js in
// this ONE eval scope (same trick as _verify_sync.js), so handleRemoteCopy and
// saveProductionFromRun resolve to these instead of the real network writers.
let pushes = [];
function renderAll() {}                  // init.js is not loaded in this harness
function triggerGoogleSync() {}          // init.js debounce — network push is stubbed below
async function cloudPush() { pushes.push(JSON.parse(JSON.stringify(state))); return { ok: true }; }

;(function repro() {
  const out = { failures: 0 };
  function ok(cond, msg) { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) out.failures++; }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function freshState() {
    const s = clone(state);           // storage.js state template
    s.production = []; s.sales = []; s.inventoryMovements = []; s.inventoryMovementVersion = 1;
    s.stock = { pieces: 0, cost: 0 }; s.draft = null;
    s.settings = Object.assign({ hourlyWage: 1500, rollsPerBag: 5 }, s.settings);
    return s;
  }
  const D = global.document;
  function show(date) { D.getElementById('logDate').value = date; }

  console.log('== pan report cross-device merge ==');

  /* ---------- device A cooks ---------- */
  state = freshState();
  show('2026-09-15');
  const t1 = saveProductionFromRun('2026-09-15', 16, null, undefined, undefined, undefined, true);
  ok(t1 === true, 'A: first pan report (16 rolls) recorded');
  const A1 = clone(state);
  ok(A1.production.length === 1, 'A: first report created one production row');
  ok(A1.production[0].pieces === 16 && A1.production[0].bags === 3, 'A: 16 rolls -> 3 bags (full sets of 5)');
  ok(!!A1.production[0].updatedAt, 'A: new pan row now carries an updatedAt stamp');
  ok(!!A1.production[0].createdAt, 'A: new pan row now carries a createdAt stamp');

  /* ---------- device B signs in fresh and adopts the cloud ---------- */
  state = freshState();
  setCloudSyncSuppressed(true);
  try { applyCloudRemote({ state: clone(A1) }, Date.parse(A1.updatedAt) || undefined); }
  finally { setCloudSyncSuppressed(false); }
  ok(state.production.length === 1 && state.production[0].pieces === 16,
    'B: initial login pulls A\\'s ledger (16 rolls) — the "first update works" case');

  /* ---------- device A finishes another pan into the SAME day ---------- */
  state = clone(A1);
  show('2026-09-15');
  const t2 = saveProductionFromRun('2026-09-15', 4, null, undefined, undefined, undefined, true);
  ok(t2 === true, 'A: second pan report (4 more rolls) merged into the same day');
  const A2 = clone(state);
  ok(A2.production.length === 1 && A2.production[0].pieces === 20, 'A: day now holds 20 rolls in ONE row');
  ok(A2.production[0].bags === 4, 'A: auto bag count re-derived 20 rolls -> 4 bags');
  ok(Date.parse(A2.production[0].updatedAt) > Date.parse(A1.production[0].updatedAt),
    'A: the merged row bumped updatedAt so other devices can see it changed');

  /* ---------- device B receives A's newest copy (realtime / poll) ---------- */
  pushes = [];
  state = freshState();
  // B already holds the row it adopted at login; simulate that persisted local copy.
  state.production = clone(A1.production);
  state.settings = Object.assign({ hourlyWage: 1500, rollsPerBag: 5 }, A1.settings);
  state.stock = clone(A1.stock);
  const res = handleRemoteCopy(clone(A2), Date.parse(A2.updatedAt) || undefined, 'realtime', { label: 'Device A' });
  const p = (state.production || [])[0];
  ok(p && p.pieces === 20, 'B: second report merged — pieces 16 -> 20 (got ' + (p && p.pieces) + ')');
  ok(p && p.bags === 4, 'B: bags auto-updated 3 -> 4 (got ' + (p && p.bags) + ')');
  ok(res === 'merged', 'B: merge reported a real change (got "' + res + '")');
  ok(pushes.length === 1, 'B: pushed the merged union back so the cloud converges (got ' + pushes.length + ' push)');
  ok(pushes.length === 1 && pushes[0].production && pushes[0].production[0].pieces === 20
    && pushes[0].production[0].bags === 4,
    'B: the copy it pushed carries the NEWEST rolls/bags (20 rolls / 4 bags), never the stale 16/3');

  /* ---------- the Production form shows the auto bag update live ---------- */
  draftTouched = false;
  state = clone(A2);
  show('2026-09-15');
  const b4 = D.getElementById('logBagsProduced');
  const p4 = D.getElementById('logPieces');
  p4.value = '16'; b4.value = '3';
  state.production[0].pieces = 20; state.production[0].bags = 4;
  refreshProductionFormCounts('2026-09-15');
  ok(String(p4.value) === '20', 'form: Pieces field refreshed to 20 (got "' + p4.value + '")');
  ok(String(b4.value) === '4', 'form: Bags field auto-updated to 4 (got "' + b4.value + '")');
  ok(b4.getAttribute('data-calc') === '1', 'form: bag field stays in AUTO mode after the refresh');

  console.log('-------------------------------------------');
  console.log('RESULT: ' + (out.failures === 0 ? 'ALL PASSED' : out.failures + ' FAILED'));
  process.exit(out.failures ? 1 : 0);
})();
`;

try {
  eval(src);
} catch (e) {
  console.error('CRASH: ' + e.message);
  console.error(e.stack);
  process.exit(2);
}