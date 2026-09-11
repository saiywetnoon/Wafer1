/* Verifies the review-based reconcile (cloudAfterSignIn): a fresh browser
   pulls, an empty cloud adopts local, and differing copies are offered to the
   user via the sync-review modal instead of being overwritten silently.
   Loads the real config/storage/helpers/cloud modules in ONE eval scope
   (matching the browser load order) and stubs only the network edge
   (cloudGet/cloudPush) plus UI side-effects. */
const fs = require('fs');
const path = require('path');
const dir = 'd:\\wafer\\Wafer_documentary\\dail-ledger v1.7\\js';
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
function saleCreditAmount(sale) { return Math.max(0, (sale.amount || 0) - (sale.paidAmount === undefined ? (sale.amount || 0) : sale.paidAmount)); }
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

  // Phone-recorded customer repayment MUST lower the amount owed on the other
  // device. The payment row merges in by id, but the customer record has NO
  // updatedAt stamp so mergeRows keeps the stale local copy — the balance must
  // be re-derived from the merged movement ledger instead. This is the exact
  // "payment appears on the computer but the debt doesn't move" bug.
  function mkDebtState(withPayment) {
    const s = mkState(0, '2026-08-31T10:00:00Z');
    s.customers = [{ id: 'c1', name: 'Aung', standingOrder: 0, price: 1300, phone: '', extraDebt: 0, debt: withPayment ? 6000 : 10000 }];
    s.sales = [{ id: 's1', customerId: 'c1', date: '2026-08-30', bags: 8, pieces: 40, price: 1300, amount: 10000, paidAmount: 0, paymentStatus: 'credit' }];
    if (withPayment) s.customerPayments = [{ id: 'cp1', customerId: 'c1', date: '2026-08-31', amount: 4000, createdAt: '2026-08-31T10:05:00Z' }];
    return s;
  }
  state = mkDebtState(false);           // the computer BEFORE the phone payment
  cloudBody = { ok: true, payload: payloadFromState(mkDebtState(true)) };  // the phone's copy
  resetReview();
  await cloudAfterSignIn();
  const paymentSynced = (state.customerPayments || []).some(function (p) { return p.id === 'cp1'; });
  const custAfter = state.customers.find(function (c) { return c.id === 'c1'; });
  ok(paymentSynced, 'payment row from the phone appears on the computer after sync');
  ok(custAfter && custAfter.debt === 6000, 'customer debt drops to 6000 after the phone payment syncs (got ' + (custAfter && custAfter.debt) + ')');

  // Supplier payment recorded on the phone: the NEW payments row always merges
  // in (new id), but the purchase it MUTATED carries the SAME updatedAt on both
  // devices, so mergeRows drops the paid mutation. The payments-ledger replay
  // must lift the purchase's paid so Total Payable drops — the exact "payment
  // shows up but the amount I owe doesn't change" supplier-side bug.
  function mkPayableState(withPayment) {
    const s = mkState(0, '2026-08-31T10:00:00Z');
    s.suppliers = [{ id: 's1', name: 'Sun Market', createdAt: '2026-08-01T08:00:00Z' }];
    s.purchases = [{
      id: 'pu1', supplierId: 's1', date: '2026-08-30', items: [{ name: 'Flour', qty: 20, unit: 'kg', price: 500 }],
      itemTotal: 10000, paidNow: 0, paid: withPayment ? 4000 : 0, note: '',
      createdAt: '2026-08-30T09:00:00Z', updatedAt: '2026-08-30T09:00:00Z' // phone payment did NOT re-stamp
    }];
    if (withPayment) s.payments = [{ id: 'pay1', supplierId: 's1', date: '2026-08-31', amount: 4000, createdAt: '2026-08-31T10:05:00Z' }];
    return s;
  }
  state = mkPayableState(false);            // the computer BEFORE the phone payment
  cloudBody = { ok: true, payload: payloadFromState(mkPayableState(true)) };  // the phone's copy
  resetReview();
  await cloudAfterSignIn();
  const payRowSynced = (state.payments || []).some(function (p) { return p.id === 'pay1'; });
  const pu = state.purchases.find(function (p) { return p.id === 'pu1'; });
  ok(payRowSynced, 'supplier payment row from the phone appears on the computer after sync');
  ok(pu && pu.paid === 4000, 'purchase paid lifted to 4000 by replaying the payments ledger (got ' + (pu && pu.paid) + ')');
  ok(typeof totalPayable === 'function' && totalPayable() === 6000, 'Total Payable drops 10000 -> 6000 (got ' + (typeof totalPayable === 'function' ? totalPayable() : 'n/a') + ')');

  // ============ SUPABASE transport: a phone edit arrives via realtime ============
  // The user's backend is Supabase: a phone change comes in as a full ledger row on
  // the realtime channel (supabaseUpdate -> handleRemoteCopy -> mergeRemoteIntoLocal).
  // Prove the fix fires there too: payments merge in AND balances re-derive.
  let rtCallback = null;
  SUPA.subscribeRealtime = function (uid, cb) { rtCallback = cb; return {}; };
  supabaseUpdate('uid-test');

  function phoneStateWithPayments() {
    const s = mkState(0, '2026-08-31T10:06:00Z');
    s.customers = [{ id: 'c1', name: 'Aung', standingOrder: 0, price: 1300, phone: '', extraDebt: 0, debt: 6000 }];
    s.sales = [{ id: 's1', customerId: 'c1', date: '2026-08-30', bags: 8, pieces: 40, price: 1300, amount: 10000, paidAmount: 0, paymentStatus: 'credit' }];
    s.customerPayments = [{ id: 'cp1', customerId: 'c1', date: '2026-08-31', amount: 4000, createdAt: '2026-08-31T10:05:00Z' }];
    s.suppliers = [{ id: 's1', name: 'Sun Market', createdAt: '2026-08-01T08:00:00Z' }];
    s.purchases = [{ id: 'pu1', supplierId: 's1', date: '2026-08-30', items: [{ name: 'Flour', qty: 20, unit: 'kg', price: 500 }], itemTotal: 10000, paidNow: 0, paid: 4000, note: '', createdAt: '2026-08-30T09:00:00Z', updatedAt: '2026-08-30T09:00:00Z' }];
    s.payments = [{ id: 'pay1', supplierId: 's1', date: '2026-08-31', amount: 4000, createdAt: '2026-08-31T10:05:00Z' }];
    return s;
  }
  const phoneCopy = phoneStateWithPayments();
  // This computer BEFORE the phone's payments: same records, no payment rows, old balances.
  state = JSON.parse(JSON.stringify(phoneCopy));
  state.customerPayments = [];
  state.payments = [];
  state.customers[0].debt = 10000;
  state.purchases[0].paid = 0;

  // Fire the Supabase realtime event as supabase.js delivers it (payload.new row).
  rtCallback({ updated_at: '2026-08-31T10:07:00Z', payload: { device: { id: 'dev-phone', sessionId: 'sess-phone', label: 'Phone' }, state: phoneCopy } });

  const rtCust = state.customers.find(function (c) { return c.id === 'c1'; });
  const rtPu = state.purchases.find(function (p) { return p.id === 'pu1'; });
  ok((state.customerPayments || []).some(function (p) { return p.id === 'cp1'; }), 'SUPABASE realtime: customer payment row merged in');
  ok((state.payments || []).some(function (p) { return p.id === 'pay1'; }), 'SUPABASE realtime: supplier payment row merged in');
  ok(rtCust && rtCust.debt === 6000, 'SUPABASE realtime: customer debt drops to 6000 (got ' + (rtCust && rtCust.debt) + ')');
  ok(rtPu && rtPu.paid === 4000, 'SUPABASE realtime: purchase paid lifted to 4000 (got ' + (rtPu && rtPu.paid) + ')');
  ok(typeof totalPayable === 'function' && totalPayable() === 6000, 'SUPABASE realtime: Total Payable drops to 6000 (got ' + (typeof totalPayable === 'function' ? totalPayable() : 'n/a') + ')');

  console.log(fail === 0 ? 'ALL RECONCILE CHECKS PASSED' : (fail + ' FAILED'));
})();`;


const src = read('config.js') + '\n' + read('device.js') + '\n' + read('storage.js') + '\n' +
  read('helpers.js') + '\n' + read('cloud.js') + '\n' + read('suppliers.js') + '\n' + TEST_BODY;

eval(src);
