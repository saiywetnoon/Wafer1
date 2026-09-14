/* End-to-end regression: REAL ledger modules + REAL js/pan-timers.js.
   Verifies the pan → Production report chain:
     A. out-of-box defaults auto-report and the batch log counts day rolls → bags
     B. partial stock no longer blocks the pan report (record + negative balance + warn)
     C. pending roll counts persist across a refresh and log via the batch button
     D. a failed report attempt is auto-retried on a later tick
   Run: node _verify_pan_report.js */
'use strict';
const fs = require('fs');
const path = require('path');
const dir = path.join(__dirname, 'js');
const read = (f) => fs.readFileSync(path.join(dir, f), 'utf8');

/* ---------- DOM stubs (smoke-test style, extended for ledger.js/usage.js) ---------- */
class ClassListStub {
  constructor(els) { this._e = els; this._set = new Set(); }
  _sync() { this._e._className = [...this._set].join(' '); }
  add(...c) { c.forEach(x => this._set.add(x)); this._sync(); }
  remove(...c) { c.forEach(x => this._set.delete(x)); this._sync(); }
  toggle(c, force) {
    if (force === undefined) force = !this._set.has(c);
    force ? this._set.add(c) : this._set.delete(c);
    this._sync();
  }
  contains(c) { return this._set.has(c); }
}
class El {
  constructor(id) {
    this.id = id || '';
    this.tagName = 'DIV';
    this._className = '';
    this.classList = new ClassListStub(this);
    this.style = { width: '', setProperty(k, v) { this[k] = v; } };
    this.textContent = '';
    this._innerHTML = '';
    this._attrs = {};
    this._listeners = {};
    this.value = '';
    this.checked = false;
    this.isContentEditable = false;
  }
  get className() { return this._className; }
  set className(v) { this._className = v; }
  get innerHTML() { return this._innerHTML; }
  set innerHTML(v) { this._innerHTML = v; }
  setAttribute(k, v) { this._attrs[k] = v; }
  getAttribute(k) { return k in this._attrs ? this._attrs[k] : null; }
  addEventListener(t, f) { (this._listeners[t] = this._listeners[t] || []).push(f); }
  dispatch(t, e) {
    const ev = Object.assign({ target: this, button: 0, shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, repeat: false, preventDefault() {}, stopPropagation() { this._bubbles = false; }, _bubbles: true }, e || {});
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

const timersNav = new El(); timersNav.setAttribute('data-tab', 'timers');
const tabLog = new El(); tabLog.setAttribute('data-tab', 'log');
const tabTools = new El(); tabTools.setAttribute('data-tab', 'tools');

const docListeners = {};
function makeDocument() {
  return {
    title: 'Daily Crispy Roll Ledger',
    readyState: 'complete',
    addEventListener(t, f) { (docListeners[t] = docListeners[t] || []).push(f); },
    dispatch(t, e) {
      if (!e) e = {};
      if (e.preventDefault && e.preventDefault.name !== 'preventDefault') {
        e.preventDefault = e.preventDefault || (() => {});
      }
      const ev = Object.assign({ preventDefault() {}, stopPropagation() {} }, e || {});
      (docListeners[t] || []).slice().forEach(f => f(ev));
    },
    body: { classList: { add() {}, remove() {}, contains() { return false; }, toggle() {}, setAttribute() {} } },
    getElementById(id) { if (!byId[id]) byId[id] = new El(id); return byId[id]; },
    querySelector(sel) {
      if (sel === '[data-tab="timers"]') return timersNav;
      const elm = new El();
      elm.closest = function () { return { querySelectorAll: () => [{ textContent: '' }, { textContent: '' }, { textContent: '' }, { textContent: '' }, { textContent: '' }] }; };
      return elm;
    },
    querySelectorAll(sel) { return sel === '.tab-btn' ? [timersNav, tabLog, tabTools] : []; },
    createElement() { return new El(); }
  };
}

const panIds = ['panTimersGrid', 'panAlertBanner', 'panSoundBtn', 'panResetAllBtn', 'panSettingsBtn', 'panSettingsModal',
  'panSettingsSave', 'panSettingsCancel', 'panSettingsReset', 'panSettingsX', 'panRunSummary', 'panSaveRunBtn',
  'panFoldSec', 'panFinalSec', 'panVolume', 'panPanCount', 'panVolumeReadout', 'panTotalReadout',
  'panOptBeep', 'panOptToast', 'panOptTitle', 'panOptNav', 'panOptVibrate', 'panRollsDefault', 'panRollsPerBag',
  'panOptAutoReport', 'panPerPanRows', 'panUseGlobalBtn'];
panIds.forEach(el);
const grid = el('panTimersGrid');
grid.querySelector = function (sel) {
  const m = sel && sel.match(/data-pan="([^"]+)"/);
  if (m) { if (!byId['card_' + m[1]]) { byId['card_' + m[1]] = new El(); byId['card_' + m[1]].setAttribute('data-pan', m[1]); } return byId['card_' + m[1]]; }
  return null;
};
el('panRunSummary').querySelectorAll = function () { return []; };
const store = {};
global.localStorage = {
  getItem(k) { return k in store ? store[k] : null; },
  setItem(k, v) { store[k] = String(v); },
  removeItem(k) { delete store[k]; }
};
global.window = global;
global.today = () => '2026-09-14';
global.$ = (id) => document.getElementById(id);
global.document = makeDocument();
/* stubs for the parts of the app that are NOT loaded here */
global.showToast = (m) => { console.log('  [toast] ' + m); };
global.confirm = () => true;
global.uid = () => 'uid-' + Math.random().toString(36).slice(2, 9);
global.pulseSuccess = () => {};
global.flashEl = () => {};
global.wireResponsiveTables = () => {};
global.updateAppStatus = () => {};
global.updateGoogleSyncStatus = () => {};
global.triggerGoogleSync = () => {};
global.renderAll = () => {};
global.setCloudSyncSuppressed = () => {};
global.setCloudAutoSync = () => {};
global.lucide = { createIcons() {} };

/* deterministic clock + interval pump */
let fakeNow = 1_000_000_000_000;
Date.now = () => fakeNow;
const intervals = [];
global.setInterval = (fn) => { const o = { fn }; intervals.push(o); return o; };
global.clearInterval = (o) => { const i = intervals.indexOf(o); if (i >= 0) intervals.splice(i, 1); };
function pump(ms) {
  const target = fakeNow + ms;
  let guard = 0;
  while (fakeNow < target && guard++ < 20000) {
    const step = Math.min(250, target - fakeNow);
    fakeNow += step;
    intervals.slice().forEach(o => o.fn());
  }
}

const src = read('config.js') + '\n' + read('storage.js') + '\n' + read('helpers.js') + '\n' + read('usage.js') + '\n' + read('ledger.js') + '\n' + read('pan-timers.js') + '\n' + `
;(function repro() {
  const out = { failures: 0 };
  function ok(cond, msg) { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) out.failures++; }
  function reset() {
    state.production = []; state.sales = []; state.inventoryMovements = []; state.inventoryMovementVersion = 1;
    state.stock = { pieces: 0, cost: 0 }; state.draft = null; draftUsage = {}; draftTouched = false;
    state.settings = Object.assign({ hourlyWage: 1500, rollsPerBag: 5 }, state.settings);
    D.getElementById('logDate').value = '';
  }
  const D = global.document;
  function keyDown(key, code, shift, target) {
    D.dispatch('keydown', { code: code, key: key, shiftKey: shift, target: target || { tagName: 'BODY', isContentEditable: false } });
  }
  function resetPan() { keyDown('!', 'Digit1', true); }
  function finishRun() { keyDown('1', 'Digit1', false); pump(71_000); }
  function setPanSettings(rpb, rollsPerBatch, autoReport, panCount) {
    PanTimers.setSettings(Object.assign(PanTimers.getDefaults(), {
      fold: 50, final: 20, panCount: panCount || 1, rollsPerBatch: rollsPerBatch, rollsPerBag: rpb, autoReport: autoReport
    }));
  }
  function summary() { return D.getElementById('panRunSummary').innerHTML; }
  function text() { return summary().replace(/<[^>]*>/g, ' ').split(' ').filter(Boolean).join(' ').trim(); }

  /* ============ A) OUT-OF-THE-BOX defaults (1 roll/round, 5 rolls/bag, auto-report ON) ============ */
  console.log('== A) default settings, no inventory stock ==');
  reset();
  setPanSettings(5, 1, true);
  resetPan(); finishRun();
  ok(state.production.length === 1, 'A1: auto-report still writes a production record on fresh defaults');
  ok(state.production[0].pieces === 1 && state.production[0].bags === 0, 'A2: 1 roll -> 0 bags (got ' + state.production[0].pieces + '/' + state.production[0].bags + ')');
  ok(text().indexOf('Today: 1 roll → 0 bags') >= 0, "A3: batch log day-header counts today's rolls -> bags");
  resetPan();
  [2,3,4,5].forEach(function () { finishRun(); });
  ok(state.production[0].pieces === 5 && state.production[0].bags === 1, 'A4: after 5 rounds -> 5 rolls / 1 bag (got ' + state.production[0].pieces + '/' + state.production[0].bags + ')');
  ok(text().indexOf('5 rolls → 1 bag') >= 0 && text().indexOf('5 already in Production') >= 0, 'A5: batch log shows 5 rolls -> 1 bag with Production total');

  /* ============ B) PARTIAL STOCK NO LONGER BLOCKS (old "no report" bug) ============ */
  console.log('== B) partial stock (Flour 50g on hand; recipe needs 100g) ==');
  reset();
  recordInventoryMovement({ ingredientName: 'Flour', qty: 50, type: 'opening', date: '2026-09-13', reason: 'test' });
  resetPan(); finishRun();
  ok(state.production.length === 1, 'B1: partial stock no longer blocks — the report LANDS');
  ok(state.production[0].pieces === 1 && state.production[0].bags === 0, 'B2: recorded 1 roll / 0 bags (got ' + state.production[0].pieces + '/' + state.production[0].bags + ')');
  const flourBal = state.inventoryMovements.filter(function (m) { return m.ingredientName === 'Flour'; }).reduce(function (s, m) { return s + (parseFloat(m.qty) || 0); }, 0);
  ok(flourBal === -50, 'B3: Flour balance went negative (-50) so restock is visible (got ' + flourBal + ')');
  pump(5_000);
  ok(state.production.length === 1, 'B4: stays recorded (no double report) on later ticks');

  /* ============ C) autoReport OFF: pending run persisted + manual log ============ */
  console.log('== C) autoReport disabled -> pending run persists, logs via button ==');
  reset();
  setPanSettings(5, 1, false);
  resetPan(); finishRun();
  ok(state.production.length === 0, 'C1: auto-report OFF leaves run pending (no production yet)');
  const panStoreKey = Object.keys(store).find(function (k) { return k.indexOf('panTimers_v1') === 0; }) || 'panTimers_v1_default';
  const stored = JSON.parse(localStorage.getItem(panStoreKey) || 'null');
  ok(stored && stored.runs && stored.runs.pan1 === 1, 'C2: pending roll count PERSISTED across a refresh (got ' + (stored && stored.runs && stored.runs.pan1) + ')');
  const sC = text();
  ok(sC.indexOf('1 pending to log') >= 0, 'C3: batch log flags the pending run');
  D.getElementById('panSaveRunBtn').dispatch('click');
  ok(state.production.length === 1, 'C4: manual "Log finished batch" creates the production record');
  ok(state.production[0].pieces === 1 && state.production[0].bags === 0, 'C5: logged record 1 piece / 0 bags');

  /* ============ D) transient failure is retried while the tick loop is alive ============ */
  console.log('== D) a blocked attempt is retried on a later tick ==');
  reset();
  setPanSettings(5, 1, true, 2);
  const origRunSave = saveProductionFromRun;
  let failNext = true, failCount = 0;
  saveProductionFromRun = function (date, pcs, bags, usage, notes, useBy, quiet) {
    if (failNext) { failNext = false; failCount++; return false; }   // one transient blip
    return origRunSave(date, pcs, bags, usage, notes, useBy, quiet);
  };
  resetPan(); finishRun();
  ok(failCount === 1, 'D1: the first report attempt failed once (transient)');
  keyDown('2', 'Digit2', false);   // start pan 2 → keeps the tick loop alive
  pump(700);
  ok(state.production.length === 1, 'D2: auto-retry on a later tick landed the report');
  ok(state.production[0].pieces === 1, 'D3: the pending roll reached Production');
  keyDown('!', 'Digit2', true);
  saveProductionFromRun = origRunSave;

  /* ============ E) 0:00 MIDNIGHT CROSSING — pans keep counting into the batch in progress ============ */
  console.log('== E) pans finishing after midnight do NOT open a new day row — they merge into the in-progress batch ==');
  reset();
  setPanSettings(5, 1, true);
  // The user has been producing batch 2026-09-13 all evening; the Production
  // form still shows that date even though the clock has now crossed 0:00
  // (today() returns a different calendar day). Old behaviour: this second pan
  // opened a brand-new row for the new date and abandoned the previous batch.
  D.getElementById('logDate').value = '2026-09-13';
  resetPan(); finishRun();
  ok(state.production.length === 1, 'E1: post-midnight pan still merges into the in-progress batch (1 row, got ' + state.production.length + ')');
  ok(state.production[0].date === '2026-09-13', 'E2: rolls count on the batch date being produced, not the new calendar day (got ' + state.production[0].date + ')');
  ok(state.production[0].pieces === 1, 'E3: the roll landed in that batch (1 piece)');
  resetPan(); finishRun();
  ok(state.production.length === 1, 'E4: second post-midnight pan still merges — no split row appears in Recent Production');
  ok(state.production[0].pieces === 2 && state.production[0].date === '2026-09-13', 'E5: 2 rolls on 2026-09-13 — previous production process was never abandoned (got ' + state.production[0].pieces + '/' + state.production[0].date + ')');
  ok(text().indexOf('2026-09-13:') >= 0, 'E6: timers day-header names the batch being produced (2026-09-13)');

  /* ============ F) a pending run keeps ITS batch date across a refresh + later manual log ============ */
  console.log('== F) pending run (auto-report OFF) is logged to the batch it was rolled for, not to "today" ==');
  reset();
  D.getElementById('logDate').value = '2026-09-12';
  setPanSettings(5, 1, false);          // auto-report OFF → the roll count stays pending
  resetPan(); finishRun();
  ok(state.production.length === 0, 'F1: run stays pending (not reported) while auto-report is off');
  const panStoreKeyF = Object.keys(store).find(function (k) { return k.indexOf('panTimers_v1') === 0; }) || 'panTimers_v1_default';
  const storedF = JSON.parse(localStorage.getItem(panStoreKeyF) || 'null');
  ok(storedF && storedF.runDates && storedF.runDates.pan1 === '2026-09-12', 'F2: pending run persists the batch date it was finished on (got ' + (storedF && storedF.runDates && storedF.runDates.pan1) + ')');
  // Next morning the user has moved the Production form to the new day.
  D.getElementById('logDate').value = '2026-09-13';
  D.getElementById('panSaveRunBtn').dispatch('click');
  ok(state.production.length === 1, 'F3: manual "Log finished batch" writes ONE row');
  ok(state.production[0].date === '2026-09-12', 'F4: the log lands on its own batch (2026-09-12), not the new day (got ' + state.production[0].date + ')');
  ok(state.production[0].pieces === 1, 'F5: 1 roll logged');

  console.log(out.failures === 0 ? 'REPRO CHECK: ALL SCENARIOS EXPLORED' : ('REPRO CHECK: ' + out.failures + ' FAILURE(S)'));
})();
`;
try {
  eval(src);
} catch (e) {
  console.error('CRASH: ' + e.message);
  console.error(e.stack ? e.stack.split('\n').slice(0, 8).join('\n') : '');
  process.exit(1);
}