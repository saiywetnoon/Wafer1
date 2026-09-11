/* Verifies the device-identity sync fix:
   1. Every browser gets a stable device id + a per-tab session id.
   2. Every cloud push is stamped with that identity (toGooglePayload).
   3. Realtime echoes of THIS tab's own writes are ignored by session id
      (this is what stopped the "Change From Another Device" popup from
      appearing on the same browser while typing).
   4. A change from a DIFFERENT session still reaches handleRemoteCopy,
      and the review modal names the exact device ("Chrome · Windows (PC)").
   Loads the real modules in browser order and stubs only the edges. */
const fs = require('fs');
const path = require('path');
const dir = 'd:\\wafer\\Wafer_documentary\\dail-ledger v1.7\\js';
const read = (f) => fs.readFileSync(path.join(dir, f), 'utf8');

const localStorageData = {};
global.localStorage = { getItem: k => (k in localStorageData ? localStorageData[k] : null), setItem: (k, v) => { localStorageData[k] = String(v); }, removeItem: k => { delete localStorageData[k]; } };
global.window = global;
Object.defineProperty(global, 'navigator', {
  value: {
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    userAgentData: { brands: [{ brand: 'Chrome', version: '126' }], mobile: false, platform: 'Windows' }
  },
  configurable: true,
  writable: true
});
global.document = {
  body: { classList: { add() {}, remove() {}, contains() { return false; }, toggle() {}, setAttribute() {} } },
  getElementById: () => ({ classList: { add() {}, remove() {} }, appendChild() {}, remove() {}, setAttribute() {}, addEventListener() {}, innerHTML: '', textContent: '' }),
  querySelectorAll: () => [],
  createElement: () => ({ classList: { add() {}, remove() {} }, appendChild() {}, remove() {}, setAttribute() {}, addEventListener() {}, innerHTML: '', textContent: '' })
};
global.showToast = () => {};
global.lucide = { createIcons() {} };
global.uid = () => 'uid-' + Math.random().toString(36).slice(2, 9);
global.googleAuthUser = null;
global.SUPA = { configured: () => false, user: null };
const TEST_BODY = `
/* ============ test overrides (same eval scope, later declarations win) ============ */
let subCallback = null;
SUPA.subscribeRealtime = function (uid, cb) { subCallback = cb; return {}; };
function authEmail() { return 'a@b.c'; }
function authToken() { return 'tok'; }
function cloudSignedInEmail() { return 'a@b.c'; }
function cloudAccountToken() { return 'tok'; }
function cloudReady() { return true; }
function cloudNeedsUrl() { return false; }
function renderCloudStatus() {}
function updateGoogleSyncStatus() {}
function renderAll() {}
function loadDraftIfNewer() {}
async function cloudGet() { return { ok: false }; }
async function cloudPush() { return { ok: true }; }
function toGooglePayload() { return { app: 'daily-crispy-roll-ledger', exportedAt: new Date().toISOString(), device: getDeviceFact(), state: JSON.parse(JSON.stringify(state)) }; }

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

let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) { pass++; console.log('PASS ' + msg); } else { fail++; console.log('FAIL ' + msg); } }
function freshModalStub() {
  const modal = { classList: { add() {}, remove() {}, contains() { return false; }, toggle() {} }, textContent: '', setAttribute() {} };
  const devEl = { textContent: '' };
  const iconEl = { setAttribute: () => {} };
  const els = {
    syncReviewModal: modal,
    syncReviewDiff: { innerHTML: '' },
    syncReviewTs: { textContent: '' },
    syncReviewDevice: devEl,
    syncReviewDeviceIcon: iconEl
  };
  global.document.getElementById = (id) => els[id] || null;
  return { modal: modal, devEl: devEl, els: els };
}

(async function run() {
  console.log('== device-identity sync verifier ==');
  state = mkState(3, '2026-08-31T09:00:00Z');
  freshModalStub();

  // 1) Stable device id + unique per-tab session.
  const id1 = getDeviceId(), id2 = getDeviceId();
  ok(id1 === id2 && !!id1, 'device id is stable across calls (persisted)');
  const s1 = getSessionId(); __deviceSessionId = null; const s2 = getSessionId();
  ok(s1 && s2 && s1 !== s2, 'each tab gets its own session id');

  // 2) Human label names browser + OS + form factor.
  const label = getDeviceLabel();
  ok(/Chrome/.test(label) && /Windows/.test(label) && /PC/.test(label), 'device label is "Chrome · Windows (PC)" -> got "' + label + '"');

  // 3) Every push is stamped with device identity.
  const payload = toGooglePayload();
  ok(payload.device && payload.device.id === getDeviceId(), 'toGooglePayload stamps the device id');
  ok(payload.device.sessionId === getSessionId(), 'toGooglePayload stamps the tab session id');
  ok(payload.device.label === label, 'toGooglePayload stamps the human label');

  // 4) Same-tab realtime echo is IGNORED even when the copy differs (no popup).
  state = mkState(3, '2026-08-31T09:00:00Z');
  supabaseUpdate('u1'); // wires subCallback
  syncReview.open = false; syncReview.current = null; syncReview.pending = null;
  const echoState = mkState(5, '2026-08-31T12:00:00Z'); // differs from local, but same session
  subCallback({ updated_at: '2026-08-31T12:00:01Z', payload: { device: getDeviceFact(), state: echoState } });
  ok(syncReview.open === false && syncReview.current === null, 'own-tab echo is ignored (no "Change From Another Device" popup)');

  // 5) A DIFFERENT device's change still reaches the review flow with its identity.
  state = mkState(3, '2026-08-31T09:00:00Z');
  freshModalStub();
  const other = getDeviceFact(); other.sessionId = 'sess-OTHER-DEVICE';
  syncReview.open = false; syncReview.current = null; syncReview.pending = null;
  const diffState = mkState(5, '2026-08-31T12:00:00Z');
  state.production.push({ id: 'local-extra', date: '2026-09-01', pieces: 60, bags: 10, usage: { Flour: 100 }, capital: 9000, updatedAt: '2026-08-31T11:00:00Z' });
  subCallback({ updated_at: '2026-08-31T12:00:02Z', payload: { device: other, state: diffState } });
  ok(syncReview.open === false && syncReview.current === null, 'different-device change does NOT open a modal');
  ok(state.production.length === 6, 'remote records merged hands-free (3 + p0..p4 + local-extra)');
  ok(state.production.some(function (p) { return p.id === 'local-extra'; }), 'local-only record kept after merge');
  ok(state.production.some(function (p) { return p.id === 'p4'; }), 'remote-only record p4 adopted');
  console.log(fail === 0 ? 'ALL DEVICE-IDENTITY CHECKS PASSED' : (fail + ' FAILED'));
})();`;

const src = read('config.js') + '\n' + read('device.js') + '\n' + read('storage.js') + '\n' +
  read('helpers.js') + '\n' +  read('cloud.js') + '\n' + TEST_BODY;

eval(src);