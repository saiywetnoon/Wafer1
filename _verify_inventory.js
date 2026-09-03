/* Node harness that loads the REAL app modules (config/storage/helpers/usage/ledger)
   with DOM stubs and exercises saveProduction() + the inventory deduction chain. */
const fs = require('fs');
const path = require('path');
const dir = 'd:\\wafer\\Wafer_documentary\\dail-ledger v1.5\\js';
const read = (f) => fs.readFileSync(path.join(dir, f), 'utf8');

/* ---- DOM stubs ---- */
const els = {};
function mkEl() { return { value: '', textContent: '', className: '', innerHTML: '', classList: { add() {}, remove() {}, contains() { return false; } }, addEventListener() {}, appendChild() {}, remove() {}, setAttribute() {}, style: {} }; }
global.document = {
  body: { classList: { add() {}, remove() {}, contains() { return false; }, toggle() {}, setAttribute() {} } },
  getElementById(id) { if (!els[id]) els[id] = mkEl(); return els[id]; },
  querySelector() {
    // A fake table row: enough <td> cells for updateUsageCosts, plus click() for
    // tab-navigation in saveProductionFromRun.
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

const src = read('config.js') + '\n' + read('storage.js') + '\n' + read('helpers.js') + '\n' + read('usage.js') + '\n' + read('ledger.js') + '\n' + `
;(function runTests() {
  let pass = 0, fail = 0;
  function ok(cond, msg) { if (cond) { pass++; console.log('PASS ' + msg); } else { fail++; console.log('FAIL ' + msg); } }
  function stock(name) { return state.inventoryMovements.filter(m => m.ingredientName === name).reduce((s, m) => s + (parseFloat(m.qty) || 0), 0); }
  function prodCount() { return state.production.length; }
  function reset() {
    state.production = []; state.sales = []; state.inventoryMovements = [];
    state.inventoryMovementVersion = 1; state.draft = null; state.stock = { pieces: 0, cost: 0 };
    draftUsage = {}; draftTouched = false;
    els.editProdId.value = '';
  }
  // saveProduction() writes numbers back into the inputs; restore them as strings.
  function refreshInputs(bag, pcs, labor, add, wpr) {
    storeEl('logDate', { value: '2026-08-31' });
    storeEl('logBagsProduced', { value: String(bag) });
    storeEl('logPieces', { value: String(pcs) });
    storeEl('logLabor', { value: String(labor) });
    storeEl('additionalCost', { value: String(add) });
    storeEl('logWeightPerRoll', { value: String(wpr) });
    storeEl('logNotes', { value: '' });
    storeEl('logUseBy', { value: '' });
    storeEl('hourlyWage', { value: '1500' });
  }
  function seedRecipes() {
    ['Flour','Tapioca Starch','Sugar','Local Sugar','Palm Sugar','Egg','Coconut Milk','Black Sesame','Additive Blend','Packaging'].forEach(function (name) {
      recordInventoryMovement({ ingredientName: name, qty: 50000, type: 'opening' });
    });
  }

  console.log('== inventory deduction trace v2 (fixed) ==');
  storeEl('editProdId', { value: '' });
  reset();

  // ---- A) Phantom defaults must NOT block the save ----
  // Only Flour & Egg have any stock. The default recipe also mentions Sugar,
  // Palm Sugar, Coconut Milk, Sesame, Additive, Packaging (zero stock).
  recordInventoryMovement({ ingredientName: 'Flour', qty: 5000, type: 'opening' });
  recordInventoryMovement({ ingredientName: 'Egg', qty: 24, type: 'opening' });
  refreshInputs(60, 360, 90, 0, 40);
  draftUsage = Object.assign({}, DEFAULT_USAGE); draftUsage.Flour = 120; draftUsage.Egg = 2;
  saveProduction();
  ok(prodCount() === 1, 'save succeeds even though Sugar/Palm/etc. have ZERO stock (no silent block)');
  ok(stock('Flour') === 5000 - 120, 'Flour deducted exactly -120');
  ok(stock('Egg') === 24 - 2, 'Egg deducted exactly -2');
  ok(stock('Sugar') === 0 - 220, 'unstocked default Sugar honestly goes to -220');
  const moveCountAfterFirst = state.inventoryMovements.length;

  // ---- B) Re-saving the same day must UPDATE, never duplicate/double-deduct ----
  refreshInputs(60, 360, 90, 0, 40);
  draftUsage = Object.assign({}, DEFAULT_USAGE); draftUsage.Flour = 120; draftUsage.Egg = 2;
  saveProduction();
  ok(prodCount() === 1, 'second identical save does NOT add a batch (no duplicate)');
  ok(state.inventoryMovements.length === moveCountAfterFirst, 'second identical save adds NO extra deductions');
  ok(stock('Flour') === 5000 - 120 && stock('Egg') === 24 - 2, 'stock unchanged after duplicate save');

  // ---- C) Editing the batch deducts only the DELTA ----
  refreshInputs(60, 360, 90, 0, 40);
  draftUsage = Object.assign({}, DEFAULT_USAGE); draftUsage.Flour = 150; draftUsage.Egg = 2;
  saveProduction();
  ok(prodCount() === 1, 'edit keeps a single batch');
  ok(stock('Flour') === 5000 - 150, 'raising Flour 120→150 deducts just +30 more (net -150)');
  ok(stock('Egg') === 24 - 2, 'Egg unchanged by the flour-only edit');

  // ---- D) A REAL shortage (positive stock, batch needs more) still blocks ----
  state.production = []; // treat this as a fresh day so the guard lets D run
  els.editProdId.value = '';
  // force stock low: remove all flour movements, then add just 10g flour.
  state.inventoryMovements = state.inventoryMovements.filter(m => m.ingredientName !== 'Flour');
  recordInventoryMovement({ ingredientName: 'Flour', qty: 10, type: 'opening' });
  refreshInputs(60, 360, 90, 0, 40);
  draftUsage = Object.assign({}, DEFAULT_USAGE); draftUsage.Flour = 120; draftUsage.Egg = 0;
  saveProduction();
  ok(prodCount() === 0, 'REAL shortage (10g on hand, 120g needed) still BLOCKS the save (no batch created)');
  ok(stock('Flour') === 10, 'blocked save leaves flour stock untouched at 10');
  console.log('  flour balance at block:', stock('Flour'));

  // ---- E) Multiple pan runs in one day deduct the recipe ONCE (merge) ----
  reset();
  recordInventoryMovement({ ingredientName: 'Flour', qty: 5000, type: 'opening' });
  state.prices.forEach(function (ing) {
    if (isStockItem(ing.name) && ing.name !== 'Flour') recordInventoryMovement({ ingredientName: ing.name, qty: 50000, type: 'opening' });
  });
  refreshInputs(60, 360, 90, 0, 40);
  draftUsage = Object.assign({}, DEFAULT_USAGE); draftUsage.Flour = 120; draftUsage.Egg = 2;
  // pan A: 60 pcs, pan B: 120 pcs, both saved via the run tracker
  saveProductionFromRun('2026-08-31', 60, 10);
  saveProductionFromRun('2026-08-31', 120, 20);
  const flourMoves = state.inventoryMovements.filter(m => m.ingredientName === 'Flour' && m.type !== 'opening');
  ok(state.production.length === 1, 'two pan runs merge into ONE batch for the day');
  ok(state.production[0].pieces === 180 && state.production[0].bags === 30, 'merged batch totals pieces + bags (60 + 120)');
  ok(flourMoves.length === 1 && flourMoves[0].qty === -120, 'pan runs deduct the daily recipe exactly ONCE');
  ok(stock('Flour') === 5000 - 120, 'flour stock correct after both pan runs');

  console.log(fail === 0 ? 'ALL INVENTORY TRACE CHECKS PASSED' : (fail + ' FAILED'));
})();
`;
eval(src);