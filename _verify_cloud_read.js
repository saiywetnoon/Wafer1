/* Verifies the cloud-read fix:
   - getLedger READ FAILURES report as ok:false (never mistaken for "cloud
     is empty"),
   - a confirmed missing row reports ok:true with an empty payload (so a brand
     new account still follows the normal first-sync path),
   - a successful read returns the payload + exportedAt.
   This used to be the path where a transient network/RLS failure let a device
   push its local copy over a populated cloud => "data failed to sync". */
const fs = require('fs');
const path = require('path');
const dir = 'd:\\wafer\\Wafer_documentary\\dail-ledger v1.7\\js';
const read = (f) => fs.readFileSync(path.join(dir, f), 'utf8');

global.window = global;
global.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
global.document = {
  body: { classList: { add() {}, remove() {}, contains() { return false; }, toggle() {} } },
  getElementById: () => ({ classList: { add() {}, remove() {} }, addEventListener() {}, setAttribute() {}, innerHTML: '', textContent: '', value: '' }),
  querySelectorAll: () => [],
  createElement: () => ({ classList: { add() {}, remove() {} }, addEventListener() {}, appendChild() {}, innerHTML: '' })
};

const TEST_BODY = `
let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) { pass++; console.log('PASS ' + msg); } else { fail++; console.log('FAIL ' + msg); } }

SUPA.user = { id: 'u1', email: 'a@b.c' };

(async function () {
  // 1) Read FAILS -> ok:false + error (must NOT look like an empty cloud).
  SUPA.getLedger = async function () { return { error: 'read failed' }; };
  var r1 = await supabaseGet();
  ok(r1.ok === false && !!r1.error, 'failed cloud read reports ok:false with error (got ' + JSON.stringify(r1) + ')');

  // 2) Confirmed no row -> ok:true, empty payload (brand-new account path).
  SUPA.getLedger = async function () { return null; };
  var r2 = await supabaseGet();
  ok(r2.ok === true && !r2.payload, 'confirmed-empty cloud reports ok:true with empty payload');

  // 3) Successful read -> payload + exportedAt survive.
  SUPA.getLedger = async function () { return { payload: { state: { production: [] } }, updatedAt: '2026-01-01T00:00:00Z' }; };
  var r3 = await supabaseGet();
  ok(r3.ok === true && r3.payload && r3.exportedAt === '2026-01-01T00:00:00Z', 'successful cloud read returns payload + exportedAt');

  console.log(fail === 0 ? 'ALL CLOUD-READ CHECKS PASSED' : (fail + ' CHECK(S) FAILED'));
  process.exit(fail === 0 ? 0 : 1);
})();
`;

eval(read('config.js') + '\n' + read('supabase.js') + '\n' + read('cloud.js') + '\n' + TEST_BODY);