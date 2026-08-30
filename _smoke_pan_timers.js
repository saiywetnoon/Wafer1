/* Smoke-test the real js/pan-timers.js module in Node with a minimal DOM stub.
   Run with: node _smoke_pan_timers.js */
'use strict';
(global).window = global; // module references window.* (best-effort toasts/audio)

/* ---------- tiny DOM stubs ---------- */
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
  _resetFromString(s) { this._set = new Set(String(s || '').split(/\s+/).filter(Boolean)); }
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
  set className(v) { this._className = v; this.classList._resetFromString(v); }
  get innerHTML() { return this._innerHTML; }
  set innerHTML(v) { this._innerHTML = v; }
  setAttribute(k, v) { this._attrs[k] = v; }
  getAttribute(k) { return k in this._attrs ? this._attrs[k] : null; }
  addEventListener(t, f) { (this._listeners[t] = this._listeners[t] || []).push(f); }
  dispatch(t, e) {
    const ev = Object.assign({ target: this, button: 0, shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, repeat: false, preventDefault() {}, stopPropagation() { this._bubbles = false; }, _bubbles: true }, e || {});
    let node = this;
    while (node && ev._bubbles) {
      (node._listeners[t] || []).slice().forEach(f => f(ev));
      node = node._parent;
    }
  }
  querySelector() { return null; } // overridden in subclasses
  querySelectorAll() { return []; } // run-summary inputs
  closest() { return null; }
  get parentNode() { return this._parent || null; }
  set _setParent(p) { this._parent = p; }
}

class GridEl extends El {
  constructor(id) { super(id); this._cards = {}; }
  querySelector(sel) {
    const m = sel && sel.match(/data-pan="([^"]+)"/);
    if (m) {
      if (!this._cards[m[1]]) { const c = new CardEl(); c.setAttribute('data-pan', m[1]); c._setParent = this; this._cards[m[1]] = c; }
      return this._cards[m[1]];
    }
    return null;
  }
}
class CardEl extends El {
  constructor() { super(); this._kids = {}; }
  querySelector(sel) {
    if (!this._kids[sel]) {
      const k = new El();
      if (sel === '[data-act="toggle"]') { k.tagName = 'BUTTON'; k.setAttribute('data-act', 'toggle'); }
      else if (sel === '[data-act="reset"]') { k.tagName = 'BUTTON'; k.setAttribute('data-act', 'reset'); }
      else if (sel === '.pan-dur') { k.tagName = 'SELECT'; k.setAttribute('data-act', 'duration'); }
      k._setParent = this;
      k.closest = (s) => (s === '[data-act]' || s === 'select[data-act="duration"]') ? k : null; // button/select target resolves its own action
      this._kids[sel] = k;
    }
    return this._kids[sel];
  }
}

const byId = {};
function el(id) { return (byId[id] = byId[id] || new El(id)); }

const grid = new GridEl('panTimersGrid');
const banner = el('panAlertBanner');
const soundBtn = el('panSoundBtn');
const resetAllBtn = el('panResetAllBtn');
const timersNav = new El(); timersNav.setAttribute('data-tab', 'timers');
const tabLog = new El(); tabLog.setAttribute('data-tab', 'log');
const tabTools = new El(); tabTools.setAttribute('data-tab', 'tools');
byId['panTimersGrid'] = grid;
byId['panAlertBanner'] = banner;
byId['panSoundBtn'] = soundBtn;
byId['panResetAllBtn'] = resetAllBtn;
/* settings panel elements (pre-registered so module init binds them) */
const settingsBtn = el('panSettingsBtn');
const settingsModal = el('panSettingsModal');
const settingsSave = el('panSettingsSave');
const settingsCancel = el('panSettingsCancel');
const settingsReset = el('panSettingsReset');
const settingsX = el('panSettingsX');
const panRunSummary = el('panRunSummary');
const panSaveRunBtn = el('panSaveRunBtn');
const logNotes = el('logNotes');
const panFoldSec = el('panFoldSec');
const panFinalSec = el('panFinalSec');
const panVolume = el('panVolume');
const panPanCount = el('panPanCount');
const panVolumeReadout = el('panVolumeReadout');
const panTotalReadout = el('panTotalReadout');
const panOptBeep = el('panOptBeep');
const panOptToast = el('panOptToast');
const panOptTitle = el('panOptTitle');
const panOptNav = el('panOptNav');
const panOptVibrate = el('panOptVibrate');
byId['panSettingsBtn'] = settingsBtn;
byId['panSettingsModal'] = settingsModal;
byId['panSettingsSave'] = settingsSave;
byId['panSettingsCancel'] = settingsCancel;
byId['panSettingsReset'] = settingsReset;
byId['panSettingsX'] = settingsX;
byId['panRunSummary'] = panRunSummary;
byId['panSaveRunBtn'] = panSaveRunBtn;
byId['logNotes'] = logNotes;
byId['panFoldSec'] = panFoldSec;
byId['panFinalSec'] = panFinalSec;
byId['panVolume'] = panVolume;
byId['panPanCount'] = panPanCount;
byId['panVolumeReadout'] = panVolumeReadout;
byId['panTotalReadout'] = panTotalReadout;
byId['panOptBeep'] = panOptBeep;
byId['panOptToast'] = panOptToast;
byId['panOptTitle'] = panOptTitle;
byId['panOptNav'] = panOptNav;
byId['panOptVibrate'] = panOptVibrate;

const docListeners = {};
global.document = {
  title: 'Daily Crispy Roll Ledger',
  readyState: 'complete',
  getElementById(id) { return byId[id] || null; },
  querySelector(sel) { return sel === '[data-tab="timers"]' ? timersNav : null; },
  querySelectorAll(sel) { return sel === '.tab-btn' ? [timersNav, tabLog, tabTools] : []; },
  addEventListener(t, f) { (docListeners[t] = docListeners[t] || []).push(f); },
  dispatch(t, e) {
    const ev = Object.assign({ preventDefault() {}, stopPropagation() {} }, e || {});
    (docListeners[t] || []).forEach(f => f(ev));
  }
};

const store = {};
store['today'] = '2026-08-30';
global.today = () => store['today'];
global.saveProductionFromRun = function () { global.savedRuns = (global.savedRuns || 0) + 1; };
global.renderAll = function () {};
global.ingredientCostFor = function () { return 1000; };
global.reconcileProductionInventory = function () {};
global.rebuildStockAndCogs = function () {};
global.clearDraft = function () {};
global.localStorage = {
  getItem(k) { return k in store ? store[k] : null; },
  setItem(k, v) { store[k] = String(v); },
  removeItem(k) { delete store[k]; }
};

/* Deterministic clock + manual interval pump (no real timers). */
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

/* ---------- load the module under test ---------- */
require('./js/pan-timers.js');
const PanTimers = global.PanTimers;
if (!PanTimers) { console.error('FAIL  PanTimers not exported'); process.exit(1); }

let pass = 0, fail = 0;
function check(name, cond) { console.log((cond ? 'PASS' : 'FAIL') + '  ' + name); cond ? pass++ : fail++; }
function panCard(i) { return grid._cards['pan' + i]; }

/* == rendered initial state == */
check('module rendered 3 pan cards', grid._innerHTML.includes('data-pan="pan1"') && grid._innerHTML.includes('data-pan="pan2"') && grid._innerHTML.includes('data-pan="pan3"'));
check('initial time is 1:10 on all pans', panCard(1).querySelector('.pan-time').textContent === '1:10' && panCard(3).querySelector('.pan-time').textContent === '1:10');
check('banner hidden initially', banner.className.includes('hidden'));
check('nav has no alert initially', !timersNav.classList.contains('pan-nav-alert'));

/* == keyboard start (pan 1) == */
document.dispatch('keydown', { code: 'Digit1', key: '1', shiftKey: false, target: { tagName: 'BODY', isContentEditable: false } });
check('key 1 started pan 1', panCard(1).classList.contains('pan-running'));
check('pan 2 and 3 untouched by pan 1 start', !panCard(2).classList.contains('pan-running') && !panCard(3).classList.contains('pan-running'));
check('toggle button became Pause', panCard(1).querySelector('[data-act="toggle"]').textContent === 'Pause');
check('sound button bound to Sound On label', soundBtn.textContent === '🔊 Sound On');

/* == heating phase: 0:00–0:50 must be silent (no alerts) == */
pump(40_000);
check('pan 1 still heating at 0:40 — no alert yet', PanTimers.getPans()[0].stage === 0 && PanTimers.getPans()[0].remaining === 30);
check('badge shows HEATING during first 50 s', panCard(1).querySelector('.pan-badge').textContent === 'HEATING');
check('banner still hidden during heating', banner.className.includes('hidden'));

/* == fold checkpoint at 0:50 elapsed == */
pump(11_000);   // elapsed 51 s → fold fired at 0:50
check('pan 1 hit fold+close stage at 0:50 elapsed', PanTimers.getPans()[0].stage === 2);
check('badge shows FOLD MARGINS', panCard(1).querySelector('.pan-badge').textContent === 'FOLD MARGINS');
check('card flashes pan-stage-2 (orange)', panCard(1).classList.contains('pan-stage-2'));
check('global banner shows fold + close/prep instruction', banner.className.includes('pan-banner-2') && banner.textContent.includes('Open lid & fold margins (3/4 temp)') && banner.textContent.includes('Close back / prep next roll'));
check('nav pulsing while alert active', timersNav.classList.contains('pan-nav-alert'));

/* == done at 1:10 (0:00 remaining) — lift lid & roll == */
pump(21_000);   // elapsed 72 s
check('pan 1 finished — lift lid & roll (stage 3)', PanTimers.getPans()[0].stage === 3);
check('tab title flagged with done glyph', document.title.includes('⏰'));
check('time reads 0:00 when done', panCard(1).querySelector('.pan-time').textContent === '0:00');

/* == shift+1 resets == */
document.dispatch('keydown', { code: 'Digit1', key: '!', shiftKey: true, target: { tagName: 'BODY', isContentEditable: false } });
check('Shift+1 reset pan 1 back to READY', PanTimers.getPans()[0].stage === 0 && !PanTimers.getPans()[0].running);
check('banner cleared after reset', banner.className.includes('hidden'));
check('tab title restored after reset', document.title === 'Daily Crispy Roll Ledger');
check('ticker stopped when idle', intervals.length === 0);

/* == pause/resume mid-run == */
document.dispatch('keydown', { code: 'Digit2', key: '2', shiftKey: false, target: { tagName: 'BODY', isContentEditable: false } });
pump(40_000); // elapsed 40 — still heating
document.dispatch('keydown', { code: 'Digit2', key: '2', shiftKey: false, target: { tagName: 'BODY', isContentEditable: false } });
check('key 2 paused pan 2 while heating', !PanTimers.getPans()[1].running && PanTimers.getPans()[1].stage === 0 && PanTimers.getPans()[1].remaining === 30);
const frozen = PanTimers.getPans()[1].remaining;
pump(10_000);
check('paused pan 2 did not advance', PanTimers.getPans()[1].remaining === frozen && PanTimers.getPans()[1].stage === 0);
document.dispatch('keydown', { code: 'Digit2', key: '2', shiftKey: false, target: { tagName: 'BODY', isContentEditable: false } });
pump(21_000); // 50 s elapsed after resume → fold fires
check('pan 2 fold fired after resume (at 0:50 elapsed)', PanTimers.getPans()[1].stage === 2);
pump(21_000); // finished
check('pan 2 resumed and finished — lift lid & roll', PanTimers.getPans()[1].stage === 3);
check('pan 1 stayed isolated while pan 2 ran', PanTimers.getPans()[0].stage === 0 && !PanTimers.getPans()[0].running);

/* == persistence round-trip == */
const saved = JSON.parse(store['panTimers_v1']);
check('persistence saved all 3 pans', saved.pans.length === 3);
check('persistence reflected final states (pan1 reset, pan2 done)', saved.pans[0].stage === 0 && saved.pans[0].running === false && saved.pans[1].stage === 3);

/* == mouse clicks (pan 3 — card surface, buttons, right/middle click) == */
const card3 = panCard(3);
card3.dispatch('click', { target: card3 });
check('mouse click on card surface starts pan 3', PanTimers.getPans()[2].running && card3.classList.contains('pan-running'));
card3.dispatch('click', { target: card3 });
check('mouse click on card surface pauses pan 3', !PanTimers.getPans()[2].running);
const startBtn = card3.querySelector('[data-act="toggle"]');
card3.dispatch('click', { target: startBtn });
check('Start button starts pan 3', PanTimers.getPans()[2].running);
const resetBtn = card3.querySelector('[data-act="reset"]');
card3.dispatch('click', { target: resetBtn });
check('Reset button resets pan 3 to READY', !PanTimers.getPans()[2].running && PanTimers.getPans()[2].stage === 0);
card3.dispatch('click', { target: card3 });
card3.dispatch('contextmenu', { target: card3 });
check('right-click resets pan 3', !PanTimers.getPans()[2].running && PanTimers.getPans()[2].stage === 0);
card3.dispatch('click', { target: card3 });
card3.dispatch('auxclick', { target: card3, button: 1 });
check('middle-click resets pan 3', !PanTimers.getPans()[2].running && PanTimers.getPans()[2].stage === 0);
check('pan 1 still isolated after pan 3 mouse activity', PanTimers.getPans()[0].stage === 0 && !PanTimers.getPans()[0].running);

/* == duration select, sound toggle, reset all == */
const durSel3 = card3.querySelector('.pan-dur');
durSel3.value = '120';
card3.dispatch('change', { target: durSel3 });
check('duration select applied 120s to pan 3', PanTimers.getPans()[2].duration === 120 && PanTimers.getPans()[2].remaining === 120 && PanTimers.getPans()[2].stage === 0);
check('pan 1/2 durations untouched (default 70)', PanTimers.getPans()[0].duration === 70 && PanTimers.getPans()[1].duration === 70);

soundBtn.dispatch('click');
check('sound toggle switched off', soundBtn.textContent === '🔇 Sound Off');
soundBtn.dispatch('click');
check('sound toggle switched back on', soundBtn.textContent === '🔊 Sound On');

resetAllBtn.dispatch('click');
check('Reset All clears every pan to READY', PanTimers.getPans().every(p => !p.running && p.stage === 0 && p.remaining === p.duration));
check('banner hidden and title restored after Reset All', banner.className.includes('hidden') && document.title === 'Daily Crispy Roll Ledger');

/* == settings panel == */
settingsBtn.dispatch('click');
check('settings modal opens', !settingsModal.classList.contains('hidden'));
check('settings form pre-filled with defaults', String(panFoldSec.value) === '50' && String(panFinalSec.value) === '20' && String(panVolume.value) === '75' && panOptBeep.checked === true && panOptToast.checked === true);
check('total readout shows standard batch', panTotalReadout.textContent === '1:10');

panFoldSec.value = '40';
panFinalSec.value = '15';
panVolume.value = '30';
panOptToast.checked = false;
panOptTitle.checked = false;
panVolume.dispatch('input');
check('volume readout updates live', panVolumeReadout.textContent === '30%');
panFoldSec.dispatch('input');
check('total readout updates live to 0:55', panTotalReadout.textContent === '0:55');

settingsSave.dispatch('click');
check('saving closes the modal', settingsModal.classList.contains('hidden'));
check('settings persisted via API', PanTimers.getSettings().fold === 40 && PanTimers.getSettings().final === 15 && PanTimers.getSettings().volume === 30);
check('alert toggles respected', PanTimers.getSettings().toast === false && PanTimers.getSettings().title === false && PanTimers.getSettings().beep === true);
check('ready pans adopted the new 55 s batch', PanTimers.getPans()[0].duration === 55 && PanTimers.getPans()[1].duration === 55);
check('customized pan 3 kept its 120 s duration', PanTimers.getPans()[2].duration === 120);
check('stored payload is v2 with settings', JSON.parse(store['panTimers_v1']).v === 2 && !!JSON.parse(store['panTimers_v1']).settings);

/* fold now fires at 40 s elapsed on the new 55 s batch */
document.dispatch('keydown', { code: 'Digit1', key: '1', shiftKey: false, target: { tagName: 'BODY', isContentEditable: false } });
pump(41_000);
check('fold fires at 40 s elapsed after settings change', PanTimers.getPans()[0].stage === 2 && PanTimers.getPans()[0].remaining === 14);
pump(16_000);
check('55 s batch finishes (lift lid & roll)', PanTimers.getPans()[0].stage === 3);
document.dispatch('keydown', { code: 'Digit1', key: '1', shiftKey: false, target: { tagName: 'BODY', isContentEditable: false } });
resetAllBtn.dispatch('click');

/* defaults restore */
settingsBtn.dispatch('click');
settingsReset.dispatch('click');
check('Defaults restore 50/20 fold/final', PanTimers.getSettings().fold === 50 && PanTimers.getSettings().final === 20 && PanTimers.getSettings().toast === true);
settingsCancel.dispatch('click');
check('Cancel closes the settings modal', settingsModal.classList.contains('hidden'));
check('Escape also closes the modal', (function () {
  settingsBtn.dispatch('click');
  document.dispatch('keydown', { key: 'Escape', code: 'Escape', target: { tagName: 'BODY', isContentEditable: false } });
  return settingsModal.classList.contains('hidden');
})());

/* modal still works after defaults (settings survived) */
check('final isolation intact after settings round-trip', PanTimers.getPans().every(p => !p.running && p.stage === 0));

/* == dynamic/scalable pan count (1–9) == */
settingsBtn.dispatch('click');
panPanCount.value = '5';
settingsSave.dispatch('click');
check('setting 5 pans renders 5 cards', PanTimers.getPans().length === 5);
check('pan 4 & 5 have their own themes/keys', PanTimers.getPans()[3].key === '4' && PanTimers.getPans()[4].key === '5' && PanTimers.getPans()[4].accent);
document.dispatch('keydown', { code: 'Digit4', key: '4', shiftKey: false, target: { tagName: 'BODY', isContentEditable: false } });
check('key 4 starts pan 4', PanTimers.getPans()[3].running && panCard(4).classList.contains('pan-running'));
document.dispatch('keydown', { code: 'Digit4', key: '4', shiftKey: false, target: { tagName: 'BODY', isContentEditable: false } });
check('key 4 pauses pan 4', !PanTimers.getPans()[3].running);
// scale back down to 3 for cleanliness
settingsBtn.dispatch('click');
panPanCount.value = '3';
settingsSave.dispatch('click');
check('down-scaled back to 3 pans', PanTimers.getPans().length === 3);

console.log(fail === 0 ? 'SMOKE TEST PASSED' : fail + ' CHECK(S) FAILED');
process.exit(fail === 0 ? 0 : 1);