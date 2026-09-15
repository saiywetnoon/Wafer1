/* ============================================================
   VERIFY — ACCOUNT DATA ISOLATION (v1.9.1 privacy fix)
   Loads the REAL js/supabase.js in Node (stubbed supabase client)
   and proves: writes go ONLY to the caller's ledgers row, reads
   come ONLY from the caller's own row, B can never see A, realtime
   is user-scoped, and old shared data is adopted exactly ONCE.
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
  SUPA.profile = { role: 'user', status: 'approved' };
  return currentFake.state;
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

async function t2_adoption() {
  const SHARED = { state: { production: [{ id: 'legacy1', pieces: 7 }] } };
  setupFake({
    authId: 'user-A', seedShared: SHARED,
    rpc: async function (name, args, st) {
      if (name !== 'ledger_adopt_shared') return { data: null, error: { message: 'unknown' } };
      const uid = String((SUPA.user && SUPA.user.id) || '');
      const own = st.ledgers.get(uid);
      const sr = st.shared.get(String(args.p_workspace_id));
      if (own) return { data: { payload: own.payload, updated_at: own.updated_at }, error: null };
      if (!sr) return { data: { payload: null, updated_at: null }, error: null };
      st.ledgers.set(uid, { payload: sr.payload, updated_at: sr.updated_at });
      st.shared.delete(String(args.p_workspace_id));
      return { data: { payload: sr.payload, updated_at: sr.updated_at }, error: null };
    }
  });
  const adoptee = await SUPA.getLedger('user-A');
  ok(adoptee && adoptee.legacy === true && adoptee.payload.state.production[0].pieces === 7, 'T10: first opener ADOPTS old shared data into their private row');
  ok(currentFake.state.shared.size === 0, 'T11: shared row DELETED after adoption');
  SUPA.user = { id: 'user-C', email: 'c@x' };
  const c = await SUPA.getLedger('user-C');
  ok(c === null, 'T12: a LATER account starts EMPTY — original bug is gone');

  setupFake({ authId: 'user-B', seedShared: SHARED });
  const bAdopt = await SUPA.getLedger('user-B');
  ok(bAdopt && bAdopt.legacy === true, 'T13: fallback adoption copies shared data (RPC missing)');
  ok(currentFake.state.ledgers.get('user-B') !== undefined && currentFake.state.shared.size === 1, 'T14: fallback writes own row, leaves shared row intact (safe)');
}

(async function main() {
  await t1_isolation();
  await t2_adoption();
  console.log('\n' + (fail === 0 ? 'ALL CHECKS PASS' : fail + ' FAILURES') + '  (' + pass + ' passed)');
  process.exitCode = fail === 0 ? 0 : 1;
})();