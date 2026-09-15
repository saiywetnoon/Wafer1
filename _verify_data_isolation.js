/* ============================================================
   VERIFY — ACCOUNT DATA ISOLATION (v1.8.5 privacy fix)
   Loads the REAL js/supabase.js in Node (stubbed supabase client)
   and proves: writes go ONLY to the caller's ledgers row, reads
   come ONLY from the caller's own row, B can never see A, realtime
   is user-scoped, and the legacy shared row is adopted ONLY by the
   ADMIN (a new/staff account that opens first NEVER receives it).
   Run: node _verify_data_isolation.js
   ============================================================ */
const fs = require('fs');
const path = require('path');
let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) { pass++; console.log('PASS ' + msg); } else { fail++; console.log('FAIL ' + msg); } }

function makeFake(opts) {
  const st = { ledgers: new Map(), shared: new Map(), rpcImpl: opts.rpc || null, lastChannel: null, authId: opts.authId || 'auth-x' };
  if (opts.seedShared) st.shared.set('main', { payload: opts.seedShared, updated_at: 'u' });
  if (opts.seedLedger) st.ledgers.set(opts.seedLedger[0], { payload: opts.seedLedger[1], updated_at: 'u' });
  const client = {
    auth: {
      onAuthStateChange: function () {},
      getSession: async () => ({ data: { session: { user: { sub: st.authId, email: 'u@x' } } }, error: null }),
      getUser: async () => ({ data: { user: { id: st.authId } }, error: null })
    },
    channel: function (name) { st.lastChannel = name; return { on: function () { return this; }, subscribe: function () { return this; } }; },
    rpc: async function (name, args) {
      if (!st.rpcImpl) return { data: null, error: { message: 'function not found', code: 'PGRST202' } };
      return await st.rpcImpl(name, args, st);
    },
    from: function (table) {
      let eqVal = null;
      return {
        select: function () { return this; },
        eq: function (col, v) { eqVal = v; return this; },
        maybeSingle: async function () {
          const row = (table === 'ledgers') ? st.ledgers.get(String(eqVal))
            : (table === 'shared_ledgers') ? st.shared.get(String(eqVal)) : null;
          return { data: row ? { payload: row.payload, updated_at: row.updated_at } : null, error: null };
        },
        upsert: async function (row, o) {
          if (table === 'ledgers') { st.ledgers.set(String(row.user_id), { payload: row.payload, updated_at: row.updated_at }); return { error: null }; }
          return { error: { message: 'nope', code: 'PGRST202' } };
        }
      };
    }
  };
  return { client: client, state: st };
}

global.SUPABASE_URL_wafer = 'https://example.supabase.co';
global.SUPABASE_ANON_KEY_wafer = 'anon';
let currentFake = null;
global.window = { supabase: { createClient: function () { return currentFake.client; } }, addEventListener: function () {}, localStorage: undefined };
const src = fs.readFileSync(path.join(__dirname, 'js', 'supabase.js'), 'utf8');
const SUPA = new Function(src + '\nreturn typeof SUPA !== "undefined" ? SUPA : null;')();

function setupFake(opts) {
  currentFake = makeFake(opts || {});
  SUPA.client = null; SUPA._hl = null;
  SUPA.user = { id: currentFake.state.authId, email: 'u@x' };
  SUPA.profile = { role: opts.role || 'user', status: 'approved' };
  return currentFake.state;
}

/* Default adoption RPC — mirrors the v1.8.5 SQL function: ADMIN ONLY, and the
   legacy shared 'main' row WINS over an older private row (it is the newest
   copy — everything since the shared era). A non-admin caller is answered with
   a null payload (never the shared data) and the shared row is left untouched. */
function adoptRpc(name, args, st) {
  if (name !== 'ledger_adopt_shared') return { data: null, error: { message: 'unknown' } };
  const uid = String((SUPA.user && SUPA.user.id) || '');
  if (SUPA.profile.role !== 'admin') return { data: { payload: null, updated_at: null }, error: null };
  const sr = st.shared.get(String(args.p_workspace_id));
  if (sr) {
    // Admin + shared row present: adopt it over any older private row.
    st.ledgers.set(uid, { payload: sr.payload, updated_at: sr.updated_at });
    st.shared.delete(String(args.p_workspace_id));
    return { data: { payload: sr.payload, updated_at: sr.updated_at }, error: null };
  }
  const own = st.ledgers.get(uid);
  if (own) return { data: { payload: own.payload, updated_at: own.updated_at }, error: null };
  return { data: { payload: null, updated_at: null }, error: null };
}

async function t1_isolation() {
  const st = setupFake({ authId: 'user-A' });
  await SUPA.saveLedger('user-A', { state: { production: [{ id: 'p1', pieces: 100 }] } });
  const own = st.ledgers.get('user-A');
  ok(own && own.payload && own.payload.state && own.payload.state.production.length === 1, 'T1: saveLedger wrote user-A\'s OWN ledgers row');
  ok(st.shared.size === 0, 'T2: saveLedger NEVER touched shared_ledgers');
  const got = await SUPA.getLedger('user-A');
  ok(got && got.payload && got.payload.state.production[0].pieces === 100, 'T3: getLedger reads back user-A\'s own row');

  setupFake({ authId: 'user-A', seedLedger: ['user-A', { state: { production: [{ id: 'p1' }] } }] });
  const b = await SUPA.getLedger('user-B');
  ok(b === null, 'T4: user-B -> null (zero data of user-A leaked)');
  const a = await SUPA.getLedger('user-A');
  ok(a && a.payload, 'T5: user-A still reads only user-A\'s row');

  const st2 = setupFake({ authId: 'user-A', seedLedger: ['user-A', { state: { note: 'A-data' } }] });
  await SUPA.saveLedger('user-B', { state: { note: 'B-data' } });
  const aAfter = await SUPA.getLedger('user-A');
  const bAfter = await SUPA.getLedger('user-B');
  ok(aAfter.payload.state.note === 'A-data', 'T6: A still has A-data after B saved');
  ok(bAfter.payload.state.note === 'B-data', 'T7: B has B-data — fully separated');
  ok(st2.ledgers.size === 2 && st2.shared.size === 0, 'T8: two private rows, no shared row');

  setupFake({ authId: 'user-A' });
  SUPA.subscribeRealtime('user-A', function () {});
  ok(SUPA._hl && currentFake.state.lastChannel === 'my-led-user-A', 'T9: realtime channel is user-scoped (my-led-user-A)');
}

async function t2_admin_only_adoption_rpc() {
  const SHARED = { state: { production: [{ id: 'legacy1', pieces: 7 }] } };
  // ADMIN opens first with the RPC present -> adopts + deletes shared.
  setupFake({ authId: 'admin-A', role: 'admin', seedShared: SHARED, rpc: adoptRpc });
  const adoptee = await SUPA.getLedger('admin-A');
  ok(adoptee && adoptee.legacy === true && adoptee.payload.state.production[0].pieces === 7, 'T10: ADMIN first opener ADOPTS old shared data into their private row');
  ok(currentFake.state.shared.size === 0, 'T11: shared row DELETED after admin adoption');
  SUPA.user = { id: 'user-B', email: 'b@x' };
  SUPA.profile = { role: 'user', status: 'approved' };
  const b = await SUPA.getLedger('user-B');
  ok(b === null, 'T12: a later account starts EMPTY — original bug is gone');

  // NON-ADMIN opens first while 'main' still exists -> must NOT receive it.
  setupFake({ authId: 'staff-C', role: 'user', seedShared: SHARED, rpc: adoptRpc });
  const c = await SUPA.getLedger('staff-C');
  ok(c === null, 'T13: NON-ADMIN first opener is answered EMPTY — never receives the shared data');
  ok(currentFake.state.shared.size === 1, 'T14: the shared row is NOT deleted, NOT copied for a non-admin');
}

async function t3_fallback_without_rpc() {
  const SHARED = { state: { production: [{ id: 'legacy1', pieces: 9 }] } };
  // ADMIN, RPC missing (PGRST202) -> fallback copy is allowed (admin only).
  setupFake({ authId: 'admin-A', role: 'admin', seedShared: SHARED });
  const a = await SUPA.getLedger('admin-A');
  ok(a && a.legacy === true && currentFake.state.ledgers.get('admin-A') !== undefined, 'T15: fallback (RPC missing): ADMIN copy lands in own row');
  ok(currentFake.state.shared.size === 1, 'T16: fallback leaves the shared row intact (safe)');

  // NON-ADMIN, RPC missing -> the client REFUSES the fallback copy entirely.
  setupFake({ authId: 'staff-C', role: 'user', seedShared: SHARED });
  const c = await SUPA.getLedger('staff-C');
  ok(c === null && currentFake.state.ledgers.get('staff-C') === undefined, 'T17: fallback (RPC missing): NON-ADMIN starts EMPTY — zero copy');
  ok(currentFake.state.shared.size === 1, 'T18: shared row untouched after a non-admin read attempt');
}

async function t4_admin_with_older_private_row() {
  const SHARED = { state: { production: [{ id: 'legacy1', pieces: 500, note: 'shared-era' }] } };
  const STALE_OWN = { state: { production: [{ id: 'old1', pieces: 2, note: 'pre-shared-era' }] } };
  // Admin had an old per-user row from before the shared era, and 'main' has
  // everything since. The RPC must adopt 'main' OVER the stale own row.
  setupFake({ authId: 'admin-A', role: 'admin', seedShared: SHARED, seedLedger: ['admin-A', STALE_OWN], rpc: adoptRpc });
  const got = await SUPA.getLedger('admin-A');
  ok(got && got.payload.state.production[0].pieces === 500, 'T19: ADMIN with an old private row STILL adopts the newer shared data');
  ok(currentFake.state.shared.size === 0, 'T20: shared row deleted after the admin adoption');

  // Admin with an own row and NO shared row -> returns OWN row (nothing newer exists).
  setupFake({ authId: 'admin-A', role: 'admin', seedLedger: ['admin-A', STALE_OWN], rpc: adoptRpc });
  const got2 = await SUPA.getLedger('admin-A');
  ok(got2 && !got2.legacy && got2.payload.state.production[0].pieces === 2, 'T21: ADMIN with only an own row keeps it (no shared legacy)');

  // RPC missing: admin with an old own row + 'main' -> fallback copies 'main' OVER own.
  setupFake({ authId: 'admin-A', role: 'admin', seedShared: SHARED, seedLedger: ['admin-A', STALE_OWN] });
  const got3 = await SUPA.getLedger('admin-A');
  ok(got3 && got3.legacy === true && got3.payload.state.production[0].pieces === 500, 'T22: fallback (RPC missing): ADMIN copy overwrites the older private row');
  ok(currentFake.state.shared.size === 1, 'T23: fallback leaves the shared row intact (safe)');

  // NON-ADMIN with their own (stale) per-user row NEVER sees 'main' even when it exists.
  setupFake({ authId: 'staff-C', role: 'user', seedShared: SHARED, seedLedger: ['staff-C', STALE_OWN], rpc: adoptRpc });
  const gotC = await SUPA.getLedger('staff-C');
  ok(gotC && gotC.payload.state.production[0].pieces === 2 && !gotC.legacy, 'T24: NON-ADMIN reads ONLY their own old row — never the shared one');
  ok(currentFake.state.shared.size === 1, 'T25: shared row untouched by a non-admin read');
}

(async function main() {
  await t1_isolation();
  await t2_admin_only_adoption_rpc();
  await t3_fallback_without_rpc();
  await t4_admin_with_older_private_row();
  console.log('\n' + (fail === 0 ? 'ALL CHECKS PASS' : fail + ' FAILURES') + '  (' + pass + ' passed)');
  process.exitCode = fail === 0 ? 0 : 1;
})();