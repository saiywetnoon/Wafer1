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

  // Both sides have data and differ -> ALWAYS ask (no silent merge).
  state = mkState(3, '2026-08-30T08:00:00Z');
  state.suppliers.push({ id: 's1', name: 'Sun Market' });
  const remote = mkState(5, '2026-08-31T12:00:00Z');
  cloudBody = { ok: true, payload: payloadFromState(remote) };
  resetReview();
  await cloudAfterSignIn();
  ok(syncReview.open === true, 'differing copies open the review modal (ask the user)');
  ok(pushes === 0 && applied === 0, 'nothing pushed/applied while the review is pending');
  ok(state.production.length === 3 && state.suppliers.length === 1, 'local copy untouched until the user decides');

  // ACCEPT -> the OTHER device's data fully replaces this device and is pushed to cloud.
  const acceptFp = stateFingerprint(remote);
  syncReview.current = { state: remote, ts: 0, fp: acceptFp };
  syncReview.open = true;
  await resolveSyncReview(true);
  ok(state.production.length === 5, 'ACCEPT replaces this device with the remote copy (5 records)');
  ok(state.suppliers.length === 0, 'ACCEPT removes this device’s local-only supplier (remote is official)');
  ok(pushes >= 1, 'ACCEPT pushes the accepted copy to the cloud');
  ok(syncDecision(acceptFp) === 'accepted', 'ACCEPT decision persisted');

  // RELOAD after ACCEPT -> never re-asks; later local edits survive.
  state.sales.push({ id: 'x1', date: '2026-09-02', bags: 1, pieces: 6, price: 600, amount: 600, cogs: 0, avgCost: 0, net: 600 });
  cloudBody = { ok: true, payload: payloadFromState(remote) };
  resetReview();
  await cloudAfterSignIn();
  ok(syncReview.open === false, 'an already-accepted copy never reopens the modal on refresh');
  ok(state.sales.some(s => s.id === 'x1'), 'new local sale untouched after reload');

  // KEEP MINE -> this device's data stays EXACTLY as-is and is uploaded to the cloud.
  state = mkState(3, '2026-08-29T00:00:00Z');
  state.suppliers.push({ id: 's1', name: 'Sun Market' });
  const mineRemote = mkState(5, '2026-08-31T11:59:00Z');
  mineRemote.suppliers.push({ id: 'r1', name: 'Fresh Mart' });
  const declineFp = stateFingerprint(mineRemote);
  cloudBody = { ok: true, payload: payloadFromState(mineRemote) };
  resetReview();
  await cloudAfterSignIn();
  ok(syncReview.open === true, 'differing copies open the review modal again');
  syncReview.current = { state: mineRemote, ts: 0, fp: declineFp };
  syncReview.open = true;
  await resolveSyncReview(false);
  ok(state.production.length === 3, 'KEEP MINE does NOT replace local with the remote copy');
  ok(state.suppliers.length === 1 && state.suppliers[0].name === 'Sun Market', 'KEEP MINE keeps local supplier and does NOT import remote-only supplier');
  ok(pushes >= 1, 'KEEP MINE uploads this device’s data to the cloud (official)');
  ok(syncDecision(declineFp) === 'declined', 'KEEP MINE decision persisted');

  // RELOAD after KEEP MINE -> never re-asks, pushes local again.
  cloudBody = { ok: true, payload: payloadFromState(mineRemote) };
  resetReview();
  await cloudAfterSignIn();
  ok(syncReview.open === false, 'a keep-mine copy never reopens the modal on refresh');
  ok(state.suppliers.length === 1, 'keep-mine official copy is preserved after reload');

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
