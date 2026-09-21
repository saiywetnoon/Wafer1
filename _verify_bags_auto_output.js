/* ============================================================
   VERIFY — BAGS OUTPUT STAYS AUTOMATIC (v1.8.5.4 fix)
   ----------------------------------------------------------------------------
   Reproduces the reported regression with the REAL modules (config, storage,
   helpers, usage, ledger) in ONE eval scope:

     • The Production form auto-fills the Bags field with floor(pieces ÷
       rollsPerBag) as soon as you type pieces (tagged data-calc="1").
     • BUG: saveProduction() treated ANY non-empty Bags field as a typed
       MANUAL count — so the auto-filled value locked the batch to
       bagsAuto=false. From then on every pan report merged MORE pieces into
       the day but FROZE the bag count ("bags output isn't automatically
       calculated/reported").
     • FIX: an auto-filled value (data-calc="1") is NOT a manual override —
       the batch stays AUTO and keeps re-deriving bags on every later pan
       report. A genuinely typed count (data-calc="0") still wins.

   Also checks updateLive() recomputes the visible bag count in the SAME pass
   when pieces change (no one-keystroke-late blank field).

   Run:  node _verify_bags_auto_output.js
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const dir = path.join(__dirname, 'js');
const read = (f) => fs.readFileSync(path.join(dir, f), 'utf8');

/* ---------- DOM stubs (same style as _verify_report_counts.js) ---------- */
class ClassListStub {
  constructor(e) { this._e = e; this._s = new Set(); }
  _sync() { this._e._className = [...this._s].join(' '); }
  add(...c) { c.forEach((x) => this._s.add(x)); this._sync(); }
  remove(...c) { c.forEach((x) => this._s.delete(x)); this._sync(); }
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
  get value() { return this._value; }
  set value(v) { this._value = (v === undefined || v === null) ? '' : String(v); }  // HTMLInputElement semantics
  get className() { return this._className; }
  set className(v) { this._className = v; }
  get innerHTML() { return this._innerHTML; }
  set innerHTML(v) { this._innerHTML = v; }
  setAttribute(k, v) { this._attrs[k] = String(v); }
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
global.$ = (id) => el(id);
global.document = {
  title: 'Daily Crispy Roll Ledger',
  readyState: 'complete',
  getElementById(id) { return el(id); },
  querySelector() { return el('_q'); },      // saveProduction navigates tab + updateUsageCosts rows
  querySelectorAll() { return []; },
  createElement() { return new El(''); },
  addEventListener() {},
  body: { classList: { add() {}, remove() {}, contains() { return false; }, toggle() {} } }
};
global.window = global;
global.localStorage = { getItem() { return null; }, setItem() {}, removeItem() {} };
global.lucide = { createIcons() {} };
global.showToast = () => {};
global.safeIcons = () => {};
global.wireResponsiveTables = () => {};
global.updateAppStatus = () => {};
global.storageUsedKB = () => 0;
global.pulseSuccess = () => {};
global.flashEl = () => {};
global.today = () => '2026-09-15';
global.uid = () => 'u' + Math.random().toString(36).slice(2, 9);
global.triggerGoogleSync = () => {};
global.renderAll = () => {};
const src = read('config.js') + '\n' + read('storage.js') + '\n' + read('helpers.js') + '\n' + read('usage.js') + '\n' + read('ledger.js') + '\n' + `
;(function runTests() {
  let pass = 0, fail = 0;
  function ok(cond, msg) { if (cond) { pass++; console.log('PASS  ' + msg); } else { fail++; console.log('FAIL  ' + msg); } }
  const D = byId;
  function field(id) { return (D[id] = D[id] || new El(id)); }
  function set(id, v) { const e = field(id); e.value = String(v); return e; }
  function freshForm(date) {
    set('logDate', date || '2026-09-15');
    set('logBagsProduced', ''); field('logBagsProduced').setAttribute('data-calc', '1');  // fresh form = auto mode
    set('logPieces', '');
    set('logLabor', '0');
    set('additionalCost', '0');
    set('logWeightPerRoll', '0');
    set('logNotes', '');
    set('logUseBy', '');
    set('hourlyWage', '1500');
    set('logRollsPerBag', '5');
    field('editProdId').value = '';
    draftTouched = false;
  }

  state.production = []; state.sales = []; state.waste = [];
  state.prices = []; state.settings = { hourlyWage: 1500, rollsPerBag: 5 };
  state.stock = { pieces: 0, cost: 0 };
  state.draft = null; state.updatedAt = null;
  freshForm();

  console.log('== A) Production form: an AUTO-FILLED bag count must stay AUTO on save ==');
  set('logPieces', '16');
  updateLive();                                                        // exactly what typing 16 pieces does
  ok(String(field('logBagsProduced').value) === '3', 'A1: typing 16 pieces auto-fills Bags to "3"');
  ok(field('logBagsProduced').getAttribute('data-calc') === '1', 'A2: the field is tagged as AUTO');
  saveProduction();                                                    // plain Save — user never typed a bag count
  ok(state.production.length === 1, 'A3: saved the batch (one row)');
  ok(state.production[0].bags === 3, 'A4: batch recorded with 3 bags');
  ok(state.production[0].bagsAuto === true, 'A5: batch is AUTO, NOT locked manual  <-- the fix');

  console.log('== B) a pan auto-report into that batch keeps bags re-derived ==');
  saveProductionFromRun('2026-09-15', 4, null, undefined, undefined, undefined, true);
  ok(state.production.length === 1, 'B1: still ONE row (merged by date)');
  ok(state.production[0].pieces === 20, 'B2: pieces 16 -> 20');
  ok(state.production[0].bags === 4, 'B3: bags output re-derived 3 -> 4 (kept automatic)');
  ok(state.production[0].bagsAuto === true, 'B4: batch still AUTO');

  console.log('== C) live: changing pieces recomputes bags in the SAME pass ==');
  editProduction(state.production[0].id);                              // re-open the batch in the form
  ok(field('logBagsProduced').getAttribute('data-calc') === '1', 'C1: editing an auto batch keeps bags AUTO');
  set('logPieces', '21'); updateLive();
  ok(String(field('logBagsProduced').value) === '4', 'C2: 21 pieces -> 4 bags immediately');
  ok(field('logBagsProduced').getAttribute('data-calc') === '1', 'C3: field stays AUTO after the update');
  set('logPieces', '25'); updateLive();
  ok(String(field('logBagsProduced').value) === '5', 'C4: 25 pieces -> 5 bags');
  const hint = String(field('logBagsHint').textContent || '');
  ok(hint.indexOf('5 bag') > -1 && hint.indexOf('Auto:') > -1, 'C5: live hint shows the auto derivation');

  console.log('== D) a genuinely typed bag count still wins ==');
  freshForm('2026-09-16');
  set('logPieces', '16');
  set('logBagsProduced', '9');
  field('logBagsProduced').setAttribute('data-calc', '0');             // the user typed it
  updateLive();
  ok(String(field('logBagsProduced').value) === '9', 'D1: typed value is never overwritten by live calc');
  saveProduction();
  const b2 = (state.production || []).find(function (p) { return p.date === '2026-09-16'; });
  ok(!!b2 && b2.pieces === 16 && b2.bags === 9 && b2.bagsAuto === false,
    'D2: typed 9 bags saved as MANUAL 9 (typed counts always win)');

  console.log('-------------------------------------------');
  console.log('RESULT: ' + (fail ? fail + ' FAILED' : 'ALL PASSED') + '  (' + pass + ' passed)');
  process.exit(fail ? 1 : 0);
})();
`;

try {
  eval(src);
} catch (e) {
  console.error('CRASH: ' + e.message);
  console.error(e.stack);
  process.exit(2);
}