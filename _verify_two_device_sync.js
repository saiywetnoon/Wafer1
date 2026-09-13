/* TWO-DEVICE SYNC REPRODUCTION — the "Device B stops updating" bug.
   ----------------------------------------------------------------------------
   Reproduces the reported scenario end-to-end with the REAL sync pipeline
   (config.js + cloud.js + supabase.js — real cloudAfterSignIn, real
   handleRemoteCopy/merge, real SUPA.getLedger/saveLedger, real single-flight
   cloudPush) against a fake Supabase client that models supabase-js v2
   session semantics faithfully:
     - getSession() returns the CACHED session without any network call, even
       when the access token is already expired (the v2 gotcha this app's own
       comments mention).
     - getUser() is a NETWORK call that validates the token server-side and
       auto-refreshes it while the refresh token is still valid.
     - REST reads/writes fail with "JWT expired" while the access token is
       expired.
   Devices A and B have separate localStorage bags; one shared cloud row plays
   the shared_ledgers table.

   Scenarios:
     S1  fresh device B pulls A's ledger at login            (must PASS)
     S2  healthy transport: A cooks -> B refresh -> converge (must PASS)
     S3  A's access token expires mid-cooking: A keeps cooking, its pushes
         fail; B must still converge (heartbeat flush heals + pushes)
     S4  B's access token expires: B refresh must heal the session and pull
     S5  A's refresh token is DEAD: pushes can never succeed — A must keep
         its data queued locally (nothing lost) and the status must say so;
         after a re-login the queued work must reach the cloud and B converge
     S6  a hung cloud read must not wedge the boot chain (timeout backstop)
   ----------------------------------------------------------------------------
   Run:  node _verify_two_device_sync.js
*/
const fs = require('fs');
const path = require('path');
const dir = 'd:\\wafer\\Wafer_documentary\\dail-ledger v1.7\\js';
const read = (f) => fs.readFileSync(path.join(dir, f), 'utf8');

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------- browser-ish globals ---------- */
let LS = {}; // backing store of the ACTIVE device's localStorage (switched per device)
global.localStorage = {
  getItem: (k) => (k in LS ? LS[k] : null),
  setItem: (k, v) => { LS[k] = String(v); },
  removeItem: (k) => { delete LS[k]; }
};
global.window = global;
global.document = {
  body: { classList: { add() {}, remove() {}, contains() { return false; } } },
  getElementById: () => ({ classList: { add() {}, remove() {} }, addEventListener() {}, innerHTML: '', textContent: '', value: '', setAttribute() {} }),
  querySelectorAll: () => [],
  createElement: () => ({ classList: { add() {}, remove() {} }, addEventListener() {}, innerHTML: '', setAttribute() {} })
};
global.showToast = () => {};
global.lucide = { createIcons() {} };
global.navigator = { userAgent: 'Harness' };

/* ---------- network failure-injection knobs (shared by the fake client) ---- */
const net = {
  signedIn: true,      // a cached Supabase session exists on THIS device
  uid: 'user-A',
  email: 'a@x.com',
  deadFor: null,        // uid whose ACCESS token is expired (refresh token alive)
  refreshDeadFor: null, // uid whose REFRESH token is dead (re-login required)
  hangMs: 0,            // fake network hang for the timeout backstop test
  writes401: 0,         // how many write attempts hit an expired-token 401
  reads401: 0           // how many read attempts hit an expired-token 401
};

/* ---------- the fake shared_ledgers row ---------- */
const cloudTable = { row: null, writes: [] };

/* ---------- fake supabase-js v2 client ---------- */
global.__makeFakeSupabaseClient = function () {
  async function readOnce(table) {
    if (net.hangMs) await delay(net.hangMs);
    if (net.deadFor === net.uid) { net.reads401++; return { data: null, error: { message: 'JWT expired (401)' } }; }
    if (table === 'shared_ledgers') {
      return { data: cloudTable.row ? { payload: cloudTable.row.payload, updated_at: cloudTable.row.updated_at } : null, error: null };
    }
    return { data: null, error: null }; // legacy per-user ledgers table: empty
  }
  async function writeOnce(table, row) {
    if (net.deadFor === net.uid) { net.writes401++; return { error: { message: 'JWT expired (401)' } } };
    if (table === 'shared_ledgers') {
      const prodLen = (row.payload && row.payload.state && row.payload.state.production) ? row.payload.state.production.length : 'no-state';
      cloudTable.row = JSON.parse(JSON.stringify(row));
      cloudTable.row.updated_at = new Date().toISOString();
      cloudTable.writes.push(cloudTable.row.updated_at);
      console.log('    [write] prod=' + prodLen + ' writesNow=' + cloudTable.writes.length + ' dev=' + String((row.payload && row.payload.device && row.payload.device.email) || '?'));
      return { error: null };
    }
    return { error: null };
  }
  return {
    auth: {
      async getSession() {
        if (!net.signedIn) return { data: { session: null }, error: null };
        // v2: cached session, NO network, NO expiry check.
        return { data: { session: { user: { sub: net.uid, email: net.email } } }, error: null };
      },
      async getUser() {
        await delay(5);
        if (!net.signedIn || net.refreshDeadFor === net.uid) {
          return { data: { user: null }, error: { message: net.refreshDeadFor === net.uid ? 'refresh_token_not_found' : 'invalid claim: no session' } };
        }
        net.deadFor = null; // access token refreshed; the device heals
        return { data: { user: { sub: net.uid, email: net.email } }, error: null };
      },
      onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } }; }
    },
    from(table) {
      return {
        select() {
          return {
            eq() {
              return {
                maybeSingle: () => readOnce(table),
                limit: () => ({ maybeSingle: () => readOnce(table) })
              };
            }
          };
        },
        upsert(row) { return writeOnce(table, row); }
      };
    }
  };
};
global.supabase = { createClient: () => global.__makeFakeSupabaseClient() };

/* ---------- load the REAL sync modules in browser order ---------- */
const src = 'window.__supaTimeoutMs = 400;\n'
  + read('config.js') + '\n'
  + read('helpers.js') + '\n'    // real replay / normalize / merge / tombstones
  + read('suppliers.js') + '\n'  // real payable replay
  + read('cloud.js') + '\n'
  + read('supabase.js') + '\n';

const TEST_BODY = `
/* ============ harness wiring (same eval scope) ============ */
let statuses = [];
function showToast() {}
function authEmail() { return (SUPA.user && SUPA.user.email) || net.email; }
function authToken() { return (SUPA.user && SUPA.user.id) || net.uid; }
function getSessionId() { return 'sess-' + net.uid; }
let cloudSyncSuppressed = false;
function setCloudSyncSuppressed(v) { cloudSyncSuppressed = !!v; }
function updateGoogleSyncStatus(m) { statuses.push(String(m)); }
function renderCloudStatus() {}
function renderAll() {}
function loadDraftIfNewer() {}
function updateAppStatus() {}
function loadState() {}

/* the app-global ledger (normally declared in storage.js) */
let state = null;

/* faithful saveState: stamp + persist (the cloud push is driven explicitly) */
function saveState() {
  state.updatedAt = new Date().toISOString();
  try { localStorage.setItem(companyStateKey(), JSON.stringify(state)); } catch (e) {}
}

/* device identity + cloud payload builder (mirrors device.js / sync-ui.js) */
function getDeviceFact() { return { label: net.email, deviceId: 'dev-' + net.uid, sessionId: 'sess-' + net.uid }; }
function toGooglePayload() { return { app: 'daily-crispy-roll-ledger', exportedAt: new Date().toISOString(), device: getDeviceFact(), state: JSON.parse(JSON.stringify(state)) }; }

/* ---------- two devices ---------- */
function freshState() {
  return { version: 2, prices: JSON.parse(JSON.stringify(DEFAULT_PRICES)), entries: {},
    production: [], sales: [], stock: { pieces: 0, cost: 0 }, settings: { hourlyWage: 1500, rollsPerBag: DEFAULT_ROLLS_PER_BAG },
    inventory: {}, inventoryMovements: [], inventoryMovementVersion: 0,
    customers: [], suppliers: [], purchases: [], payments: [], customerPayments: [],
    expenses: [], recurringExpenses: [], waste: [], priceHistory: [], recipes: [],
    deletions: {}, cash: { opening: 0, adjustments: [] }, draft: null, updatedAt: null };
}
function makeDevice(id) { return { id, uid: 'user-' + id, email: id.toLowerCase() + '@x.com', ls: {}, state: null }; }
const A = makeDevice('A'), B = makeDevice('B');
function switchDevice(dev) {
  LS = dev.ls;
  net.uid = dev.uid; net.email = dev.email;
  SUPA.user = { id: dev.uid, email: dev.email };
  state = dev.state || null;
}
function bootDevice(dev) {
  switchDevice(dev);
  const raw = localStorage.getItem(companyStateKey());
  state = raw ? JSON.parse(raw) : freshState();
  dev.state = state;
  return cloudAfterSignIn();
}
let prodSeq = 0;
async function cook(dev, n) {
  switchDevice(dev);
  if (!state || !Array.isArray(state.production)) {
    const raw = localStorage.getItem(companyStateKey());
    state = raw ? JSON.parse(raw) : freshState();
    dev.state = state;
  }
  for (let i = 0; i < n; i++) {
    const t = new Date().toISOString();
    state.production.push({ id: 'prod-' + (++prodSeq), date: '2026-09-13', pieces: 60, bags: 12,
      usage: { Flour: 100 }, capital: 5000, updatedAt: t, createdAt: t });
  }
  saveState();
  statuses = [];
  return cloudPush();
}
/* one heartbeat tick (what initSyncFlushers' 20s timer does) */
async function heartbeat() { statuses = []; return flushPendingSync(); }

let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) { pass++; console.log('PASS ' + msg); } else { fail++; console.log('FAIL ' + msg); } }
function prodCount(dev) { return (dev.state && dev.state.production ? dev.state.production.length : 0); }
function lastStatus() { return statuses.length ? statuses[statuses.length - 1] : ''; }
function diag(label) {
  console.log('  [diag] ' + label
    + ' rowProd=' + (cloudTable.row ? cloudTable.row.payload.state.production.length : '-')
    + ' queueDirty=' + syncQueueIsDirty()
    + ' cloudSyncFailed=' + cloudSyncFailed
    + ' deadFor=' + net.deadFor
    + ' lastStatus=' + JSON.stringify(lastStatus()));
}

(async function run() {
  console.log('== two-device sync reproduction ==');

  /* S1 - fresh device B signs in and pulls A's ledger. */
  await cook(A, 2);
  ok(cloudTable.row && prodCount(A) === 2, 'S1 setup: A cooked 2 batches and pushed them');
  await bootDevice(B);
  ok(prodCount(B) === 2, 'S1: fresh device B pulls the cloud ledger at sign-in');
  diag('S1 after B pull');
  ok(/Loaded your .*cloud data/.test(lastStatus()), 'S1: status announces the pull');

  /* S2 - healthy transport: A cooks more, B refreshes, must converge. */
  await cook(A, 1);
  await bootDevice(B);
  ok(prodCount(B) === 3, 'S2: B refresh converges while the transport is healthy');

  /* S3 - A's access token expires (refresh still valid): A keeps cooking,
     pushes fail; the queue + heartbeat must heal the session and drain;
     B must then converge. This is the reported "B stops updating". */
  net.deadFor = A.uid;
  net.refreshDeadFor = null;
  await cook(A, 2);           // batches 4 and 5 - push FAILS (401), queued
  diag('S3 after failed pushes');
  ok(prodCount(A) === 5, 'S3 setup: A locally holds 5 batches');
  ok(net.writes401 >= 1, 'S3 setup: the expired-token push genuinely failed with 401 before healing');
  ok(cloudTable.row.payload.state.production.length === 5, 'S3 setup: the healed coalesced push reached the cloud');
  ok(net.deadFor === null, "S3: saveLedger's 401 handler healed the expired session via getUser()");
  await heartbeat();          // the app's 20s retry heartbeat
  diag('S3 after drain heartbeat');
  ok(cloudTable.row.payload.state.production.length === 5, 'S3: the queued batches drained to the cloud after the heal');
  await bootDevice(B);
  ok(prodCount(B) === 5, 'S3: device B converges after A recovered (no more freeze)');

  /* S4 - B's OWN access token expires (refresh alive): A keeps pushing fine;
     B must heal its session ON THE VERY NEXT REFRESH (read-side heal) and pull
     the newest cloud copy in one boot. */
  net.deadFor = B.uid;
  net.reads401 = 0;
  await cook(A, 1);           // batch 6 - A pushes fine (only B's token is dead)
  ok(cloudTable.row.payload.state.production.length === 6, 'S4 setup: A pushed batch 6');
  await bootDevice(B);
  ok(net.deadFor === null, "S4: B's refresh healed its own expired token via the read path");
  ok(net.reads401 >= 1, "S4: B's read genuinely hit the expired-token 401 before healing");
  ok(prodCount(B) === 6, 'S4: B pulls the newest cloud copy on refresh (heal + retry inside getLedger)');

  /* S5 - A's refresh token is DEAD: pushes can never succeed. Data must stay
     queued on A (nothing lost) and the cloud must stay untouched; after a
     re-login the queued work must drain and B must converge. */
  net.deadFor = A.uid;
  net.refreshDeadFor = A.uid;
  net.writes401 = 0;
  await cook(A, 1);           // batch 7 - push fails, queued
  await heartbeat();          // heal impossible now
  diag('S5 after dead-refresh push attempts');
  ok(prodCount(A) === 7, 'S5 setup: A still holds all 7 batches locally (nothing lost)');
  ok(net.writes401 >= 1, 'S5: the failed push genuinely 401s and cannot heal (refresh token dead)');
  ok(cloudTable.row.payload.state.production.length === 6, 'S5: the cloud row is untouched by the failed push');
  net.signedIn = true;        // ...the user signs in again
  net.deadFor = null;         // fresh login issues fresh tokens
  net.refreshDeadFor = null;
  SUPA.user = { id: A.uid, email: A.email };
  await heartbeat();
  await heartbeat();
  diag('S5 after re-login drain');
  ok(cloudTable.row.payload.state.production.length === 7, 'S5: after re-login the queued batch drains to the cloud');
  await bootDevice(B);
  ok(prodCount(B) === 7, 'S5: B converges once A is signed in again');

  /* S6 - a hung cloud read must not wedge the boot chain forever. */
  net.hangMs = 1000; // > the 400ms test timeout
  const t0 = Date.now();
  await bootDevice(B);
  const dt = Date.now() - t0;
  net.hangMs = 0;
  ok(dt < 2500, 'S6: a hung cloud read times out instead of wedging the boot (' + dt + 'ms)');
  ok(/timed out|could not reach/i.test(statuses.join(' | ')), 'S6: the timeout is reported, not silent');

  console.log('-------------------------------------------');
  console.log('RESULT: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('HARNESS ERROR', e); process.exit(2); });
`;

eval(src + TEST_BODY);
