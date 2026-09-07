/* Verifies the review-based reconcile (cloudAfterSignIn): a fresh browser
   pulls, an empty cloud adopts local, and differing copies are offered to the
   user via the sync-review modal instead of being overwritten silently.
   Loads the real config/storage/helpers/cloud modules in ONE eval scope
   (matching the browser load order) and stubs only the network edge
   (cloudGet/cloudPush) plus UI side-effects. */
const fs = require('fs');
const path = require('path');
const dir = 'd:\\wafer\\Wafer_documentary\\dail-ledger v1.6\\js';
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
function resetReview() { syncReview.open = false; syncReview.current = null; syncReview.pending = null; applied = 0; pushes = 0; statuses = []; }

(async function run() {
  console.log('== winner-takes-all reconcile verifier ==');
  // Fresh empty device always PULLS the cloud ledger (never clobbers).
  state = mkState(0);
  cloudBody = { ok: true, payload: payloadFromState(mkState(5, '2026-08-31T10:00:00Z')) };
  resetReview();
  await cloudAfterSignIn();
  ok(state.production.length === 5, 'fresh browser pulls the cloud ledger (5 records)');
  ok(pushes === 0, 'fresh browser does NOT push its empty state over the cloud');
  ok(statuses.some(s => /Loaded your cloud data/.test(s)), 'status says cloud data loaded');

  // Both sides have data and differ -> auto-merge (tested below). No modal.

  // Differing copies AUTO-MERGE (no modal, nothing to click).
  state = mkState(3);
  cloudBody = { ok: true, payload: payloadFromState(mkState(5)) };
  resetReview();
  await cloudAfterSignIn();
  ok(syncReview.open===false,'no modal opens');
  ok(state.production.length===5,'remote-only records merged in');
  
  // Same-record clash: newest edit wins automatically.
  state = mkState(2);
  state.production[0].updatedAt='2026-08-31T10:00:00Z';
  state.production[1].updatedAt='2026-08-31T09:00:00Z';
  const clashRemote = mkState(2);
  clashRemote.production[0].updatedAt='2026-08-31T08:00:00Z';
  clashRemote.production[1].updatedAt='2026-08-31T14:00:00Z';
  cloudBody = { ok: true, payload: payloadFromState(clashRemote) };
  resetReview();
  await cloudAfterSignIn();
  const p0After = state.production.find(function (p) { return p.id === 'p0'; });
  const p1After = state.production.find(function (p) { return p.id === 'p1'; });
  ok(p0After.updatedAt==='2026-08-31T10:00:00Z','clash: local newer edit kept');
  ok(p1After.updatedAt==='2026-08-31T14:00:00Z','clash: remote newer edit adopted');

  // Phantom stock difference (stored snapshots differ but derived stock equal) -> aligned.
  state = mkState(5, '2026-08-31T12:00:00Z');
  state.stock = { pieces: 999, cost: 999 };
  const stockRemote = mkState(5, '2026-08-31T12:05:00Z');
  stockRemote.stock = { pieces: 1, cost: 1 };
  cloudBody = { ok: true, payload: payloadFromState(stockRemote) };
  resetReview();
  await cloudAfterSignIn();
  ok(syncReview.open === false, 'stale stock snapshots are NOT a real difference (no popup)');
  ok(pushes === 0 && applied === 0, 'stale-stock-only copies cause no churn');

  // Identical copies cause no sync churn.
  state = mkState(5, '2026-08-31T12:00:00Z');
  cloudBody = { ok: true, payload: payloadFromState(mkState(5, '2026-08-31T12:00:00Z')) };
  resetReview();
  await cloudAfterSignIn();
  ok(pushes === 0 && applied === 0 && syncReview.open === false, 'identical copies cause no sync churn and no modal');

  // Empty cloud + local data -> first sync pushes local.
  state = mkState(3, '2026-08-31T09:00:00Z');
  cloudBody = { ok: true, payload: payloadFromState(mkState(0, null)) };
  resetReview();
  await cloudAfterSignIn();
  ok(pushes === 1, 'empty cloud + local data -> first sync pushes local');

  console.log(fail === 0 ? 'ALL RECONCILE CHECKS PASSED' : (fail + ' FAILED'));
})();`;


const src = read('config.js') + '\n' + read('device.js') + '\n' + read('storage.js') + '\n' +
  read('helpers.js') + '\n' + read('cloud.js') + '\n' + TEST_BODY;

eval(src);
