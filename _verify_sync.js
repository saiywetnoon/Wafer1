/* Verifies the LATEST-WINS-BY-CONTENT reconcile (cloudAfterSignIn).
   Loads the real config/storage/helpers/cloud modules in ONE eval scope
   (matching the browser load order) and stubs only the network edge
   (cloudGet/cloudPush) plus UI side-effects. */
const fs = require('fs');
const path = require('path');
const dir = 'd:\\wafer\\Wafer_documentary\\dail-ledger v1.5\\js';
const read = (f) => fs.readFileSync(path.join(dir, f), 'utf8');

const localStorageData = {};
global.localStorage = { getItem: k => (k in localStorageData ? localStorageData[k] : null), setItem: (k, v) => { localStorageData[k] = String(v); }, removeItem: k => { delete localStorageData[k]; } };
global.window = global;
global.document = {
  body: { classList: { add() {}, remove() {}, contains() { return false; }, toggle() {}, setAttribute() {} } },
  getElementById: () => ({ classList: { add() {}, remove() {} }, appendChild() {}, remove() {}, setAttribute() {}, addEventListener() {}, innerHTML: '' }),
  querySelectorAll: () => [],
  createElement: () => ({ classList: { add() {}, remove() {} }, appendChild() {}, remove() {}, setAttribute() {}, addEventListener() {}, innerHTML: '' })
};
global.showToast = () => {};
global.lucide = { createIcons() {} };
global.uid = () => 'uid-' + Math.random().toString(36).slice(2, 9);
global.googleAuthUser = null;
global.SUPA = { configured: () => false, user: null };

const TEST_BODY = `
/* ============ test overrides (same eval scope, later declarations win) ============ */
let cloudBody = null, pushes = 0, applied = 0;
let statuses = [];
function authEmail() { return 'a@b.c'; }        // account mode -> no legacy binding
function authToken() { return 'tok'; }
function cloudSignedInEmail() { return 'a@b.c'; }
function cloudAccountToken() { return 'tok'; }
function cloudReady() { return true; }
function cloudNeedsUrl() { return false; }
function renderCloudStatus() {}
function updateGoogleSyncStatus(m) { statuses.push(m); }
function renderAll() { applied++; }
function loadDraftIfNewer() {}
async function cloudGet() { return cloudBody; }
async function cloudPush() { pushes++; return { ok: true }; }

function mkState(prodCount, updatedAt) {
  const s = { version: 2, prices: JSON.parse(JSON.stringify(DEFAULT_PRICES)), entries: {},
    production: [], sales: [], stock: { pieces: 0, cost: 0 }, settings: { hourlyWage: 1500 },
    inventory: {}, inventoryMovements: [], inventoryMovementVersion: 1,
    customers: [], suppliers: [], purchases: [], payments: [], customerPayments: [],
    expenses: [], recurringExpenses: [], waste: [], priceHistory: [], recipes: [],
    cash: { opening: 0, adjustments: [] }, draft: null, updatedAt: updatedAt || null };
  for (let i = 0; i < prodCount; i++) s.production.push({ id: 'p' + i, date: '2026-08-0' + (((i % 9) + 1)), pieces: 100, bags: 16, usage: { Flour: 100 }, capital: 10000 });
  return s;
}
function payloadFromState(s) { return { app: 'x', exportedAt: s.updatedAt || new Date().toISOString(), state: s }; }

let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) { pass++; console.log('PASS ' + msg); } else { fail++; console.log('FAIL ' + msg); } }

(async function run() {
  console.log('== reconcile (cloudAfterSignIn) verifier ==');
  state = mkState(0);
  cloudBody = { ok: true, payload: payloadFromState(mkState(5, '2026-08-31T10:00:00Z')) };
  pushes = 0; statuses = [];
  await cloudAfterSignIn();
  ok(state.production.length === 5, 'fresh browser pulls the cloud ledger (5 records)');
  ok(pushes === 0, 'fresh browser does NOT push its empty state over the cloud');
  ok(statuses.some(s => /Loaded your cloud data/.test(s)), 'status says cloud data loaded');

  state = mkState(20, '2026-08-30T08:00:00Z');
  cloudBody = { ok: true, payload: payloadFromState(mkState(5, '2026-08-31T12:00:00Z')) };
  pushes = 0; applied = 0;
  await cloudAfterSignIn();
  ok(pushes === 1, 'richer local copy (20 > 5) pushed up despite older timestamp');
  ok(state.production.length === 20, 'local richer history preserved (not downgraded)');
  ok(statuses.some(s => /richer|pushed/.test(s)), 'status says local pushed');

  state = mkState(5, '2026-08-30T08:00:00Z');
  const remoteNewer = mkState(5, '2026-08-31T12:00:00Z');
  remoteNewer.production[2].notes = 'edited on device B';
  cloudBody = { ok: true, payload: payloadFromState(remoteNewer) };
  pushes = 0; applied = 0;
  await cloudAfterSignIn();
  ok(pushes === 0, 'equal counts + cloud newer -> no push');
  ok(applied === 1 && state.production[2].notes === 'edited on device B', 'equal counts + cloud newer -> pulls newer edit');

  state = mkState(5, '2026-08-31T12:00:00Z');
  cloudBody = { ok: true, payload: payloadFromState(mkState(5, '2026-08-31T12:00:00Z')) };
  pushes = 0; applied = 0;
  await cloudAfterSignIn();
  ok(pushes === 0 && applied === 0, 'identical copies cause no sync churn');

  state = mkState(3, '2026-08-31T09:00:00Z');
  cloudBody = { ok: true, payload: payloadFromState(mkState(0, null)) };
  pushes = 0;
  await cloudAfterSignIn();
  ok(pushes === 1, 'empty cloud + local data -> first sync pushes local');

  state = mkState(20, '2026-08-29T00:00:00Z');
  cloudBody = { ok: true, payload: payloadFromState(mkState(3, '2026-08-31T11:59:00Z')) };
  pushes = 0; applied = 0;
  await cloudAfterSignIn();
  ok(pushes === 1 && applied === 0, 'subset-cloud cannot overwrite richer local ledger');

  console.log(fail === 0 ? 'ALL RECONCILE CHECKS PASSED' : (fail + ' FAILED'));
})();`;

const src = read('config.js') + '\n' + read('storage.js') + '\n' +
  read('helpers.js') + '\n' + read('cloud.js') + '\n' + TEST_BODY;

eval(src);