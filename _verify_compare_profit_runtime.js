/* ============================================================
   VERIFY — COMPARE PRICE & PACK — RUNTIME SMOKE TEST (v1.15.0)
   ----------------------------------------------------------------------------
   Loads the REAL modules (config, storage, helpers, usage, tools) in ONE eval
   scope with a DOM stub, then drives renderCompareProfit() — the new Business
   Tools what-if matrix — exactly as it runs in the browser:

     • ppb mode: trial packs change bags = floor(pieces ÷ pack)
     • gpr mode: trial packs change pieces = floor(mixGrams ÷ gpr), then
       bags = floor(pieces ÷ current pieces-per-bag)
     • best cell is highlighted, current settings get an amber ●.
     • typing in #cpPrices / #cpPacks re-renders via the wired listeners.

   Run:  node _verify_compare_profit_runtime.js
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const dir = path.join(__dirname, 'js');
const read = (f) => fs.readFileSync(path.join(dir, f), 'utf8');

let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) { pass++; console.log('  PASS  ' + msg); } else { fail++; console.log('  FAIL  ' + msg); } }
const has = (s, sub) => String(s || '').indexOf(sub) !== -1;

/* ---------- DOM stubs (style of _verify_bags_auto_output.js) ---------- */
class ClassListStub {
  constructor(e) { this._e = e; this._set = new Set(); }
  _sync() { this._e._className = [...this._set].join(' '); }
  add(...c) { c.forEach((x) => this._set.add(x)); this._sync(); }
  remove(...c) { c.forEach((x) => this._set.delete(x)); this._sync(); }
  toggle(c, force) { if (force === undefined) force = !this._set.has(c); force ? this._set.add(c) : this._set.delete(c); this._sync(); }
  contains(c) { return this._set.has(c); }
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
    this._value = '';
    this.checked = false;
    this.dataset = {};
  }
  get value() { return this._value; }
  set value(v) { this._value = (v === undefined || v === null) ? '' : String(v); }
  get className() { return this._className; }
  set className(v) { this._className = v; }
  get innerHTML() { return this._innerHTML; }
  set innerHTML(v) { this._innerHTML = v; }
  setAttribute(k, v) { this._attrs[k] = String(v); }
  getAttribute(k) { return k in this._attrs ? this._attrs[k] : null; }
  addEventListener(t, f) { (this._listeners[t] = this._listeners[t] || []).push(f); }
  dispatch(t, e) {
    const ev = Object.assign({ target: this, preventDefault() {}, stopPropagation() {} }, e || {});
    (this._listeners[t] || []).slice().forEach((f) => f(ev));
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
  querySelector() { return el('_q'); },
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

/* ---------- the REAL modules, one shared scope ---------- */
const src = read('config.js') + '\n' + read('storage.js') + '\n' + read('helpers.js') + '\n' + read('usage.js') + '\n' + read('tools.js') + '\n';
const testBody = [
'function field(id) { return el(id); }',
  'function set(id, v) { const e = field(id); e.value = String(v); return e; }',
  '// fresh, deterministic workspace (single flour item → mix = 4400 g exactly)',
  'state.prices = [{ name: "Flour", unit: "g", price: 4600, weightPerUnit: 1 }];',
  'state.production = [{ date: "2026-09-15", pieces: 220, bags: 44, weightPerRoll: 20, grams: 4400, usage: { Flour: 4400 }, capital: 1800 }];',
  'state.sales = [{ date: "2026-09-15", price: 100, pieces: 220, bags: 44, amount: 4400 }];',
  'state.settings = { hourlyWage: 1500, rollsPerBag: 5 };',
  'state.stock = { pieces: 220, cost: 1800 };',
  'draftUsage = { Flour: 4400 };',
  'set("additionalCost", "500"); set("logLabor", "30"); set("hourlyWage", "1500");',
  'set("logPieces", "220"); set("cpPackMode", "ppb"); set("cpPrices", ""); set("cpPacks", "");',
  '// --- ppb mode: baseline defaults (prices 80-120, packs 4/5/6) ---',
  'renderCompareProfit();',
  'ok(has(field("cpBaseline").innerHTML, "220"), "baseline shows the live piece count");',
  'let m = field("cpMatrix").innerHTML;',
  'ok(has(m, "pcs/bag"), "ppb table header shows the unit label");',
  'ok(has(m, "44 bags") && has(m, "55 bags") && has(m, "36 bags"), "ppb: pack 5/4/6 yields 44/55/36 bags");',
  'ok(has(m, "\\u2605"), "best-profit cell is flagged with a star");',
  'ok(has(m, "120 Ks \\u00d7 4 pcs/bag"), "footer names the best combination (120 Ks \\u00d7 4/bag)");',
  'ok(has(m, "\\u25cf"), "current price + pack are marked with an amber bullet");',
  '// --- input wiring: typing a new trial price re-renders ---',
  'set("cpPrices", "150"); field("cpPrices").dispatch("input");',
  'ok(has(field("cpMatrix").innerHTML, "150"), "typing #cpPrices re-renders the matrix (150 Ks row appears)");',
  '// --- gpr mode: rolling knob changes pieces -> bags; packs default to 18/20/22 ---',
  'set("cpPackMode", "gpr"); set("cpPacks", ""); field("cpPackMode").dispatch("change");',
  'let g = field("cpMatrix").innerHTML;',
  'ok(has(g, "g/roll"), "gpr table header shows the unit label");',
  'ok(has(g, "48 bags") && has(g, "44 bags") && has(g, "40 bags"), "gpr: 18/20/22 g/roll \\u2192 48/44/40 bags from 4400 g mix");',
  'ok(has(g, "\\u25cf"), "current 20 g/roll is marked as the baseline");',
  '// --- switch back to ppb via the mode change wiring ---',
  'set("cpPackMode", "ppb"); field("cpPackMode").dispatch("change");',
  'ok(has(field("cpMatrix").innerHTML, "\\u2605"), "switch back to ppb still renders a matrix with best cell");',
  '// --- empty workspace never crashes the card ---',
  'state.production = []; state.sales = [];',
  'set("cpPrices", ""); set("cpPacks", ""); renderCompareProfit();',
  'ok(field("cpMatrix").innerHTML.length > 0, "empty workspace renders without crashing");',
  ''
];
eval(src + '\n;(function () { ' + testBody.join('\n') + ' })();' + '\nconsole.log("\\n" + pass + " passed, " + fail + " failed");' + '\nprocess.exit(fail ? 1 : 0);');