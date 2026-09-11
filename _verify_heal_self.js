/* VERIFY: a stale cloud can never stay stuck behind a device that holds the
   NEWER rows.
   Scenario that made real data appear missing on other devices:
     - Device A holds the REAL ledger: Egg=560 (edited 10:00), production rows
       p1..p5 -> 125 pieces ready to sell.
     - The CLOUD was overwritten earlier by a partly-synced device and now
       holds Egg=550 (09:00) and only p1..p3.
     - A pulls the cloud and auto-merges: the merge keeps A's newer rows and
       unions the smaller cloud. Fix: when the copies differed but the merge
       changed nothing, push the newer local copy so the cloud converges.
   Also guarded: identical copies never churn; a genuinely NEWER remote edit
   still wins (last-write-wins) and is then pushed exactly once; a fresh
   device pulls without pushing. */
const fs = require('fs');
const path = require('path');
const dir = 'd:\\wafer\\Wafer_documentary\\dail-ledger v1.7\\js';
const read = (f) => fs.readFileSync(path.join(dir, f), 'utf8');

/* ---- DOM / env stubs (matching the other _verify_*.js harnesses) ---- */
const els = {};
function mkEl() { return { value: '', textContent: '', className: '', innerHTML: '', classList: { add() {}, remove() {}, contains() { return false; } }, addEventListener() {}, appendChild() {}, remove() {}, setAttribute() {}, style: {} }; }
global.document = {
  body: { classList: { add() {}, remove() {}, contains() { return false; }, toggle() {}, setAttribute() {} } },
  getElementById(id) { if (!els[id]) els[id] = mkEl(); return els[id]; },
  querySelector() { return mkEl(); },
  querySelectorAll() { return []; },
  createElement() { return mkEl(); }
};
global.$ = (id) => document.getElementById(id);
global.window = global;
global.navigator = { onLine: true };
global.location = { reload() {} };
global.showToast = () => {};
global.lucide = { createIcons() {} };
global.uid = () => 'uid-' + Math.random().toString(36).slice(2, 9);
global.pulseSuccess = () => {};
global.flashEl = () => {};
global.wireResponsiveTables = () => {};
global.updateGoogleSyncStatus = () => {};
global.updateAppStatus = () => {};
global.triggerGoogleSync = () => {};
global.safeIcons = () => {};
const localStorageData = {};
global.localStorage = { getItem: (k) => (k in localStorageData ? localStorageData[k] : null), setItem: (k, v) => { localStorageData[k] = String(v); }, removeItem: (k) => { delete localStorageData[k]; } };
global.SUPA = { configured: () => false, user: null };
global.supabase = null;

const src = read('config.js') + '\n' + read('storage.js') + '\n' + read('helpers.js') + '\n' + read('cloud.js') + '\n';
const testBody = `
/* --- late bindings at the TOP of this eval scope so cloud.js sees them --- */
let pushes = 0, applied = 0;
function cloudReady() { return true; }
function cloudSignedInEmail() { return 'real@owner.com'; }
function cloudAccountToken() { return 'tok'; }
function renderCloudStatus() {}
function renderAll() { applied++; }
function loadDraftIfNewer() {}
async function cloudGet() { return { ok: true, payload: null }; }
async function cloudPush() { pushes++; return { ok: true }; }

;(function run() {
  let pass = 0, fail = 0;
  function ok(cond, msg) { if (cond) { pass++; console.log('PASS ' + msg); } else { fail++; console.log('FAIL ' + msg); } }

  function baseState() {
    const s = { version: 2, prices: JSON.parse(JSON.stringify(DEFAULT_PRICES)),
      entries: {}, production: [], sales: [], stock: { pieces: 0, cost: 0 },
      settings: { hourlyWage: 1500 }, inventory: {}, inventoryMovements: [], inventoryMovementVersion: 1,
      customers: [], suppliers: [], purchases: [], payments: [], customerPayments: [],
      expenses: [], recurringExpenses: [], waste: [], priceHistory: [], recipes: [],
      deletions: {}, cash: { opening: 0, adjustments: [] }, draft: null, updatedAt: null };
    return s;
  }
  function clone(s) { return JSON.parse(JSON.stringify(s)); }
  function pushFive(s) {
    for (let i = 1; i <= 5; i++) s.production.push({ id: 'p' + i, date: '2026-09-1' + i, pieces: 25, bags: 5, usage: { Egg: 2 }, capital: 5000, createdAt: '2026-09-12T09:00:00Z', updatedAt: '2026-09-12T09:00:00Z' });
  }
  function reset() { state = baseState(); pushes = 0; applied = 0; }

  console.log('== stale-cloud heal verifier ==');
// ---- 1) The exact user report: local REAL ledger vs stale smaller cloud.
  reset();
  state.prices.find(function (p) { return p.name === 'Egg'; }).price = 560;
  state.prices.find(function (p) { return p.name === 'Egg'; }).updatedAt = '2026-09-12T10:00:00.000Z';
  pushFive(state);
  state.stock = computeStockSnapshot(state); // consistent snapshot, like a live device
  const localSnapshot = clone(state);

  const staleRemote = baseState();
  staleRemote.prices.find(function (p) { return p.name === 'Egg'; }).price = 550;
  staleRemote.prices.find(function (p) { return p.name === 'Egg'; }).updatedAt = '2026-09-12T09:00:00.000Z';
  for (let i = 1; i <= 3; i++) staleRemote.production.push({ id: 'p' + i, date: '2026-09-1' + i, pieces: 25, bags: 5, usage: { Egg: 2 }, capital: 5000, createdAt: '2026-09-12T09:00:00Z', updatedAt: '2026-09-12T09:00:00Z' });

  const status1 = handleRemoteCopy(staleRemote, Date.parse('2026-09-12T09:30:00.000Z'), 'Reconcile after sign-in', null);
  ok(state.prices.find(function (p) { return p.name === 'Egg'; }).price === 560, 'local NEWER Egg price (560) survives the merge');
  ok(state.production.length === 5, 'all local production rows kept (got ' + state.production.length + ')');
  ok(pushes === 1, 'stale cloud was REPAIRED by pushing the newer local copy (got ' + pushes + ' pushes)');

  // ---- 2) Idempotent: an identical copy causes zero churn.
  reset();
  state = clone(localSnapshot);
  const idStatus = handleRemoteCopy(clone(localSnapshot), Date.parse('2026-09-12T10:05:00.000Z'), 'Background sync', null);
  ok(idStatus === 'aligned' && pushes === 0, 'identical copies cause no push churn');
// ---- 3) A genuinely NEWER remote edit (later last-write) still wins, once.
  reset();
  state.prices.find(function (p) { return p.name === 'Egg'; }).price = 560;
  state.prices.find(function (p) { return p.name === 'Egg'; }).updatedAt = '2026-09-12T10:00:00.000Z';
  const newerRemote = baseState();
  newerRemote.prices.find(function (p) { return p.name === 'Egg'; }).price = 555;
  newerRemote.prices.find(function (p) { return p.name === 'Egg'; }).updatedAt = '2026-09-12T11:00:00.000Z';
  handleRemoteCopy(newerRemote, Date.parse('2026-09-12T11:00:00.000Z'), 'Realtime', null);
  ok(state.prices.find(function (p) { return p.name === 'Egg'; }).price === 555, 'newest last-write wins across devices (555)');
  ok(pushes === 1, 'adopting a remote edit pushes the result exactly once (got ' + pushes + ')');

  // ---- 4) A fresh device with NO local data pulls the cloud and does not re-push.
  reset();
  const freshRemote = baseState();
  freshRemote.production.push({ id: 'x1', date: '2026-09-12', pieces: 50, bags: 10, usage: { Flour: 100 }, capital: 8000 });
  const st = handleRemoteCopy(freshRemote, Date.parse('2026-09-12T10:00:00.000Z'), 'Reconcile after sign-in', null);
  ok(st === 'pulled', 'fresh device pulls the cloud copy (status=' + st + ')');
  ok(state.production.length === 1 && pushes === 0, 'fresh device adopted 1 cloud record, no push');

  // ---- 5) Empty cloud with a populated local device pushes exactly once.
  reset();
  state.production.push({ id: 'y1', date: '2026-09-12', pieces: 20, bags: 4, usage: { Flour: 50 }, capital: 2000 });
  const st2 = handleRemoteCopy(baseState(), Date.parse('2026-09-12T08:00:00.000Z'), 'Reconcile after sign-in', null);
  ok(st2 === 'pushed' && pushes === 1, 'empty cloud + local data pushes local once');

  console.log(fail ? 'HEAL-SELF CHECKS: ' + fail + ' FAILED' : 'ALL HEAL-SELF CHECKS PASSED (' + pass + ')');
  process.exit(fail ? 1 : 0);
})();
`;
eval(src + testBody);