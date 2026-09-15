/* ============================================================
   VERIFY — ROLL/BAG COUNT CONSISTENCY (v1.9 report fix)
   Loads the REAL js/config.js + js/helpers.js + js/ledger.js and
   proves that every report (dashboard/CSV/printable/calendar/audit,
   which all go through entriesProdSales + financeTotalsAll) shows
   the SAME bag count as the Production panel for every batch —
   including legacy batches created before the `bagsAuto` flag, and
   auto-mode batches whose stored bag count went stale.
   Run: node _verify_report_counts.js
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const dir = path.join(__dirname, 'js');
const read = (f) => fs.readFileSync(path.join(dir, f), 'utf8');
// `state` normally lives in js/storage.js (evalled apps share this scope).
let state;

/* ---------- minimal DOM stubs (from _verify_pan_report.js) ---------- */
class ClassListStub {
  constructor(els) { this._e = els; this._set = new Set(); }
  add(...c) { c.forEach((x) => this._set.add(x)); this._sync(); }
  remove(...c) { c.forEach((x) => this._set.delete(x)); this._sync(); }
  toggle(c, force) { if (force === undefined) force = !this._set.has(c); force ? this._set.add(c) : this._set.delete(c); this._sync(); }
  contains(c) { return this._set.has(c); }
  _sync() { this._e._className = [...this._set].join(' '); }
}
class El {
  constructor(id) {
    this.id = id || ''; this.tagName = 'DIV'; this._className = '';
    this.classList = new ClassListStub(this);
    this.style = { width: '', setProperty() {} };
    this.textContent = ''; this._innerHTML = ''; this._attrs = {};
    this._listeners = {}; this.value = ''; this.checked = false; this.isContentEditable = false;
  }
  get className() { return this._className; }
  set className(v) { this._className = v; }
  get innerHTML() { return this._innerHTML; }
  set innerHTML(v) { this._innerHTML = v; }
  setAttribute(k, v) { this._attrs[k] = v; }
  getAttribute(k) { return k in this._attrs ? this._attrs[k] : null; }
  addEventListener(t, f) { (this._listeners[t] = this._listeners[t] || []).push(f); }
  querySelector() { return null; }
  querySelectorAll() { return []; }
}
const byId = {};
function el(id) { return (byId[id] = byId[id] || new El(id)); }
global.$ = (id) => el(id);
global.document = {
  title: 'Daily Crispy Roll Ledger', readyState: 'complete',
  getElementById(id) { return el(id); },
  querySelector() { return null; },
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
global.today = () => '2026-09-08';

/* ---------- load REAL modules ---------- */
// NOTE: one combined eval so function declarations share one scope
// (the same pattern _verify_profit_model.js uses).
eval(read('config.js') + '\n' + read('helpers.js') + '\n' + read('ledger.js') +
  '\n;global.__u = { deriveBagsFromPieces, normalizeProductionBags, productionRollsPerBag, productionBags, entriesProdSales, financeTotalsAll };');
const {
  deriveBagsFromPieces, normalizeProductionBags, productionRollsPerBag,
  productionBags, entriesProdSales, financeTotalsAll
} = global.__u;

let pass = 0, fail = 0;
function ok(cond, name) { console.log((cond ? 'PASS' : 'FAIL') + '  ' + name); if (cond) pass++; else fail++; }

/* ---------- state with all four batch flavours ---------- */
state = {
  version: 2,
  prices: [],
  production: [
    // LEGACY row recorded before the bagsAuto flag existed:
    // 228 pieces physically packed into 38 bags (6/bag) — stored 38, derived floor(228/5)=45.
    { id: 'legacy1', date: '2026-09-01', pieces: 228, bags: 38, capital: 1000 },
    // AUTO row whose stored bags are STALE (pieces went 100 -> 125 without a recompute).
    { id: 'auto1', date: '2026-09-02', pieces: 125, bags: 20, bagsAuto: true, capital: 900 },
    // MANUAL row: user physically packed 26 bags for 130 rolls (5/bag rule would say 26 — coincidentally same).
    { id: 'manual1', date: '2026-09-03', pieces: 130, bags: 26, bagsAuto: false, capital: 1100 },
    // AUTO row already consistent.
    { id: 'auto2', date: '2026-09-04', pieces: 100, bags: 20, bagsAuto: true, capital: 800 }
  ],
  sales: [],
  settings: { hourlyWage: 1500, rollsPerBag: 5 },
  entries: {}, stock: { pieces: 0, cost: 0 }
};

const before = JSON.stringify(state.production);
const migrated = normalizeProductionBags();
ok(migrated === true, 'normalizeProductionBags reports a change for legacy/stale rows');
ok(state.production[0].bagsAuto === false, 'legacy row (38 stored != 45 derived) becomes MANUAL — physical pack honoured');
ok(state.production[0].bags === 38, 'legacy manual row keeps its recorded 38 bags');
ok(state.production[1].bagsAuto === true, 'stale AUTO row keeps bagsAuto=true');
ok(state.production[1].bags === 25, 'stale AUTO row bags refreshed 20 -> 25 (floor(125/5))');
ok(state.production[2].bagsAuto === false && state.production[2].bags === 26, 'manual row untouched (26 bags / 130 pcs)');
ok(state.production[3].bags === 20 && state.production[3].bagsAuto === true, 'already-consistent AUTO row untouched');
ok(JSON.stringify(state.production) !== before, 'normalization actually mutated the rows');

/* The Production panel renders auto rows by deriving (bagsAuto!==false -> derive),
   manual rows from the stored field. Every report must match exactly that. */
const panelBags = (p) => (p.bagsAuto === false ? (p.bags || 0) : deriveBagsFromPieces(p.pieces));
state.production.forEach(function (p) {
  ok(productionBags(p) === panelBags(p), 'productionBags(p) == Production panel display for ' + p.id);
});

const entries = entriesProdSales();
const eTotal = entries.reduce(function (s, e) { return s + e.prodBags; }, 0);
const pTotal = state.production.reduce(function (s, p) { return s + productionBags(p); }, 0);
ok(eTotal === pTotal, 'entriesProdSales total (' + eTotal + ') == panel total (' + pTotal + ')');
ok(eTotal === 109, 'all-report total is the CONSISTENT 109 bags (38+25+26+20)');

const f = financeTotalsAll();
ok(f.productionBags === pTotal, 'financeTotalsAll().productionBags (' + f.productionBags + ') matches the panel');
ok(f.productionPieces === 583, 'pieces total 228+125+130+100 = 583');

/* Idempotent: running the migration again changes nothing. */
const after2 = JSON.stringify(state.production);
normalizeProductionBags();
ok(JSON.stringify(state.production) === after2, 'normalization is idempotent (safe to run every load)');

/* A pan merge on an auto row must keep stored == derived (regression guard). */
const mergeInto = state.production[3];
mergeInto.pieces = 100 + 12;                     // another pan finishes with 12 rolls
mergeInto.bags = deriveBagsFromPieces(mergeInto.pieces);
ok(mergeInto.bags === 22, 'after merge, stored bags follow the packing rule again (floor(112/5)=22)');
ok(entriesProdSales().reduce(function (s, e) { return s + e.prodBags; }, 0) === pTotal - 20 + 22, 'reports stay consistent after the merge');

console.log('\n' + (fail === 0 ? 'ALL REPORT-COUNT CHECKS PASSED' : (fail + ' FAILURE(S)')) + '  (' + pass + ' passed)');
process.exitCode = fail === 0 ? 0 : 1;