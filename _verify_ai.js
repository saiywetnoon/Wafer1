/* Node harness that loads the REAL app modules (config/storage/helpers/usage/ledger/ai)
   with DOM stubs and exercises:
     1. The AI keyword classifier (summarizeNotes)
     2. The production-profile builder + rules engine (diagnose / solve)
     3. The LLM provider presets + prompt (ChatGPT / DeepSeek)
     4. The mix-first production save (ingredients recorded before packing)
   Run with: node _verify_ai.js */
const fs = require('fs');
const path = require('path');
const dir = 'd:\\wafer\\Wafer_documentary\\dail-ledger v1.6\\js';
const read = (f) => fs.readFileSync(path.join(dir, f), 'utf8');

/* ---- DOM stubs ---- */
const els = {};
function mkEl() { return { value: '', textContent: '', className: '', innerHTML: '', classList: { add() {}, remove() {}, contains() { return false; } }, addEventListener() {}, appendChild() {}, remove() {}, setAttribute() {}, style: {} }; }
global.document = {
  body: { classList: { add() {}, remove() {}, contains() { return false; } } },
  getElementById(id) { if (!els[id]) els[id] = mkEl(); return els[id]; },
  querySelector() {
    const el = mkEl();
    el.click = function () {};
    el.closest = function () { return { querySelectorAll: function () { return [{ textContent: '' }, { textContent: '' }, { textContent: '' }, { textContent: '' }, { textContent: '' }]; } }; };
    return el;
  },
  querySelectorAll() { return []; },
  createElement() { return mkEl(); }
};
global.$ = (id) => document.getElementById(id);
function storeEl(id, overrides) { els[id] = Object.assign(mkEl(), overrides || {}); return els[id]; }
global.window = global;                       // ai.js exports window.AiAnalyzer
global.showToast = () => {};
global.lucide = { createIcons() {} };
global.uid = () => 'uid-' + Math.random().toString(36).slice(2, 9);
global.pulseSuccess = () => {};
global.flashEl = () => {};
global.wireResponsiveTables = () => {};
global.updateGoogleSyncStatus = () => {};
global.updateAppStatus = () => {};
global.triggerGoogleSync = () => {};
global.renderAll = () => {};
global.setCloudSyncSuppressed = () => {};
global.setCloudAutoSync = () => {};
const localStorageData = {};
global.localStorage = { getItem: (k) => (k in localStorageData ? localStorageData[k] : null), setItem: (k, v) => { localStorageData[k] = String(v); }, removeItem: (k) => { delete localStorageData[k]; } };

const src = read('config.js') + '\n' + read('storage.js') + '\n' + read('helpers.js') + '\n' + read('usage.js') + '\n' + read('ledger.js') + '\n' + read('ai.js') + '\n' + `
;(function runTests() {
  let pass = 0, fail = 0;
  function ok(cond, msg) { if (cond) { pass++; console.log('PASS ' + msg); } else { fail++; console.log('FAIL ' + msg); } }
  const A = window.AiAnalyzer;
  if (!A) { console.log('FAIL AiAnalyzer module not exported'); process.exit(1); }
  function stock(name) { return state.inventoryMovements.filter(m => m.ingredientName === name).reduce((s, m) => s + (parseFloat(m.qty) || 0), 0); }
  function reset() {
    state.production = []; state.sales = []; state.inventoryMovements = [];
    state.inventoryMovementVersion = 1; state.draft = null; state.stock = { pieces: 0, cost: 0 };
    draftUsage = {}; draftTouched = false;
    if (!els.editProdId) storeEl('editProdId', { value: '' });
    els.editProdId.value = '';
    Object.keys(localStorageData).forEach(k => delete localStorageData[k]); // clear AI config between tests
  }
  function refreshInputs(bag, pcs, labor, add, wpr) {
    storeEl('logDate', { value: '2026-08-31' });
    storeEl('logBagsProduced', { value: bag === null ? '' : String(bag) });
    storeEl('logPieces', { value: pcs === null ? '' : String(pcs) });
    storeEl('logLabor', { value: labor === null ? '' : String(labor) });
    storeEl('additionalCost', { value: String(add) });
    storeEl('logWeightPerRoll', { value: String(wpr) });
    storeEl('logNotes', { value: '' });
    storeEl('logUseBy', { value: '' });
    storeEl('hourlyWage', { value: '1500' });
  }
  const dayStr = function (n) {
    const d = new Date(2026, 7, 31 + n); // Aug 31 2026 + n days
    const off = d.getTimezoneOffset();
    return new Date(d.getTime() - off * 60000).toISOString().slice(0, 10);
  };
  /* ---- 1) keyword classifier ---- */
  console.log('== 1) quality-note keyword classifier ==');
  ok(A.summarizeNotes('good and crispy').good === true, 'notes "good and crispy" → good');
  ok(A.summarizeNotes('good and crispy').undercooked === false, 'notes "good and crispy" → NOT undercooked');
  ok(A.summarizeNotes('not crispy this time').undercooked === true, 'notes "not crispy this time" → undercooked');
  ok(A.summarizeNotes('a bit salty').salty === true, 'notes "a bit salty" → salty');
  ok(A.summarizeNotes('burnt, too dark').overcooked === true, 'notes "burnt, too dark" → overcooked');
  ok(A.summarizeNotes('broke in packing').breakable === true, 'notes "broke in packing" → breakable');
  ok(A.summarizeNotes('').good === false && A.summarizeNotes(null).good === false, 'empty/null notes produce no flags');

  /* ---- 2) provider presets ---- */
  console.log('== 2) LLM provider presets ==');
  const dOpen = A.providerDefaults('openai');
  const dDeep = A.providerDefaults('deepseek');
  ok(A.providers && A.providers.openai && A.providers.deepseek, 'providers registry lists OpenAI + DeepSeek');
  ok(dDeep.provider === 'deepseek' && /deepseek/.test(dDeep.endpoint) && dDeep.model === 'deepseek-chat', 'DeepSeek preset has its endpoint + model');
  ok(dOpen.provider === 'openai' && dOpen.model === 'gpt-4o-mini', 'OpenAI preset has its endpoint + model');
/* ---- 3) profile builder + rules engine ---- */
  console.log('== 3) profile + rules engine ==');
  function seedHistory() {
    // 10 normal batches at ~11 g/roll, 100% yield
    for (let i = 10; i >= 1; i--) {
      state.production.push({
        id: 'h' + i, date: dayStr(-i), pieces: 240, bags: 40,
        weightPerRoll: 11, mixWeight: 2640, expectedRolls: 240,
        notes: 'good & crispy', usage: Object.assign({}, DEFAULT_USAGE),
        additionalCost: 0, capital: 30000, laborMinutes: 240, laborCost: 6000, costPerPiece: 125
      });
    }
  }
  reset();
  seedHistory();
  // Bad day: weight/roll 13 g (way heavy) → expected 203 rolls, only 200 rolled
  state.production.push({
    id: 'today1', date: '2026-08-31', pieces: 200, bags: 33,
    weightPerRoll: 13, mixWeight: 2640, expectedRolls: 203,
    notes: '', usage: Object.assign({}, DEFAULT_USAGE),
    additionalCost: 0, capital: 30000, laborMinutes: 240, laborCost: 6000, costPerPiece: 150
  });
  let prof = A.buildProfileForDate('2026-08-31');
  ok(prof.hasBatch === true, 'profile finds the day batch');
  ok(prof.wprMedian === 11, 'weight/roll median from history is 11g');
  ok(Math.round(prof.wprPctDiff) === 18, 'heavy day is ~18% over the usual weight/roll');
  ok(prof.yieldShortfallPcs === 3, 'yield shortfall computed as expected 203 - actual 200');
  let findings = A.diagnose(prof);
  ok(findings.some(function (f) { return f.id === 'weight-high'; }), 'heavy rolls produce a weight-high root-cause finding');
  ok(findings.every(function (f) { return f.id !== 'yield-loss'; }), 'when over-weight is the cause, yield-loss is NOT double-reported');
  ok(findings.every(function (f) { return f.fixes && f.fixes.length >= 1 && f.confidence > 0; }), 'every finding has fixes + confidence');
  const health = A.solve('2026-08-31').health;
  ok(health < 100, 'bad day health score drops below 100');

  // Normal weight but low yield → the yield-loss finding fires (batter lost)
  reset(); seedHistory();
  state.production.push({
    id: 'today2', date: '2026-08-31', pieces: 180, bags: 30,
    weightPerRoll: 11, mixWeight: 2640, expectedRolls: 240,
    notes: '', usage: Object.assign({}, DEFAULT_USAGE),
    additionalCost: 0, capital: 30000, laborMinutes: 240, laborCost: 6000, costPerPiece: 167
  });
  const lostYield = A.solve('2026-08-31');
  ok(lostYield.findings.some(function (f) { return f.id === 'yield-loss'; }), 'normal weight + big shortfall → yield-loss finding fires');

  // Healthy day → no findings
  reset(); seedHistory();
  state.production.push({
    id: 'today3', date: '2026-08-31', pieces: 240, bags: 40,
    weightPerRoll: 11, mixWeight: 2640, expectedRolls: 240,
    notes: 'good & crispy', usage: Object.assign({}, DEFAULT_USAGE),
    additionalCost: 0, capital: 30000, laborMinutes: 240, laborCost: 6000, costPerPiece: 125
  });
  const healthy = A.solve('2026-08-31');
  ok(healthy.findings.length === 0, 'healthy batch produces no findings');
  ok(healthy.health === 100, 'healthy day scores 100');

  // Mix-only day (packaging pending) → NO misleading findings
  reset(); seedHistory();
  state.production.push({
    id: 'today4', date: '2026-08-31', pieces: 0, bags: 0,
    weightPerRoll: 0, mixWeight: 2640, expectedRolls: 240,
    notes: '', usage: Object.assign({}, DEFAULT_USAGE),
    additionalCost: 0, capital: 30000, laborMinutes: 0, laborCost: 0, costPerPiece: 0
  });
  const pending = A.solve('2026-08-31');
  ok(pending.profile.hasBatch === true, 'mix-only batch is present in profile');
  ok(pending.findings.length === 0, 'mix-only (packing pending) day produces no false findings');

  /* ---- 4) LLM prompt is aggregate + private ---- */
  console.log('== 4) LLM prompt payload ==');
  const payload = A.promptPayload(prof, findings, 'deepseek-chat');
  ok(payload.model === 'deepseek-chat', 'prompt uses the configured model');
  const userContent = payload.messages[1].content;
  ok(userContent.indexOf('2026-08-31') >= 0, 'prompt carries the analyzed date');
  const parsed = JSON.parse(userContent.slice(userContent.indexOf('{')));
  ok(parsed.topFindings.length > 0, 'prompt includes the top local findings');
  const jsonKeys = JSON.stringify(parsed);
  ok(jsonKeys.indexOf('"phone"') < 0 && jsonKeys.indexOf('"customerName"') < 0 &&
     jsonKeys.indexOf('"debt"') < 0 && jsonKeys.indexOf('"email"') < 0,
     'prompt JSON contains NO customer/phone/debt/email fields');
/* ---- 5) mix-first production save ---- */
  console.log('== 5) mix-first production save ==');
  reset();
  seedHistory(); // recent batches at 11 g/roll → recentWeightPerRoll() ≈ 11
  recordInventoryMovement({ ingredientName: 'Flour', qty: 5000, type: 'opening' });
  recordInventoryMovement({ ingredientName: 'Egg', qty: 24, type: 'opening' });
  rebuildStockAndCogs(); // make stock consistent with the seeded history
  const baselines = { pieces: state.stock.pieces, flour: stock('Flour') };
  storeEl('editProdId', { value: '' });
  const dayCount = function () { return state.production.filter(function (p) { return p.date === '2026-08-31'; }).length; };
  // MIX time: ingredients known, bags/pieces/labor + weight/roll all empty
  refreshInputs(null, null, null, 0, 0);
  draftUsage = Object.assign({}, DEFAULT_USAGE); draftUsage.Flour = 120; draftUsage.Egg = 2;
  saveProduction();
  ok(dayCount() === 1, 'mix-only save creates the batch (one per day)');
  const mixBatch = state.production.filter(function (p) { return p.date === '2026-08-31'; })[0];
  ok(mixBatch && mixBatch.pieces === 0 && mixBatch.bags === 0, 'mix batch has no finished counts yet');
  ok(mixBatch && mixBatch.expectedRolls > 0, 'mix batch estimates expected rolls from recent weight/roll history');
  ok(stock('Flour') === baselines.flour - 120, 'ingredients are deducted once at MIX time');
  ok(state.stock.pieces === baselines.pieces, 'no ready-to-sell stock added until packaging finishes');

  // PACKING done: same date, enter actuals → updates in place, no double-deduct
  storeEl('editProdId', { value: mixBatch.id });
  refreshInputs(40, 236, 240, 0, 11);
  draftUsage = Object.assign({}, DEFAULT_USAGE); draftUsage.Flour = 120; draftUsage.Egg = 2;
  saveProduction();
  ok(dayCount() === 1, 'packing update keeps ONE batch (no duplicate)');
  const packed = state.production.filter(function (p) { return p.date === '2026-08-31'; })[0];
  ok(packed.pieces === 236 && packed.bags === 40, 'actual pieces + bags saved after packaging');
  ok(stock('Flour') === baselines.flour - 120, 'packing update does NOT deduct ingredients again');
  ok(state.stock.pieces === baselines.pieces + 236, 'finished stock now reflects the packed pieces');

  /* ---- 6) dynamic save-button label ---- */
  console.log('== 6) context-aware save button ==');
  reset();
  seedHistory();
  storeEl('editProdId', { value: '' });
  storeEl('logBagsProduced', { value: '' });
  storeEl('logPieces', { value: '' });
  storeEl('saveLogBtn', { innerHTML: '', dataset: {} });
  draftUsage = Object.assign({}, DEFAULT_USAGE); draftUsage.Flour = 120;
  refreshSaveButton();
  ok(els.saveLogBtn.innerHTML.indexOf('Save Mix Now') >= 0, 'ingredients entered + no actuals → button says "Save Mix Now"');
  storeEl('logPieces', { value: '236' });
  storeEl('logBagsProduced', { value: '40' });
  refreshSaveButton();
  ok(els.saveLogBtn.innerHTML.indexOf('Save Production Work') >= 0, 'actuals entered → button says "Save Production Work"');
  storeEl('editProdId', { value: 'batch-1' });
  refreshSaveButton();
  ok(els.saveLogBtn.innerHTML.indexOf('Update Production') >= 0, 'editing a packed batch → button says "Update Production"');
  storeEl('logPieces', { value: '' });
  storeEl('logBagsProduced', { value: '' });
  refreshSaveButton();
  ok(els.saveLogBtn.innerHTML.indexOf('Update Mix') >= 0, 'editing a mix-only batch → button says "Update Mix…"');

  console.log(fail === 0 ? 'ALL AI + MIX-FIRST CHECKS PASSED' : (fail + ' FAILED'));
})();
`;
eval(src);