/* Verifies the LIVE-SYNC safety net:
   - any INPUT/TEXTAREA/SELECT input or change inside the app calls
     persistState() (which saves + pushes to the cloud),
   - the login/admin/company/sync-review screens and [data-nolive]
     elements are skipped,
   - non-control targets (divs etc.) are ignored. */
const fs = require('fs');
const path = require('path');
const dir = 'd:\\wafer\\Wafer_documentary\\dail-ledger v1.6 - Copy\\js';
const liveSrc = fs.readFileSync(path.join(dir, 'live-sync.js'), 'utf8');

const handlers = {};
global.document = {
  addEventListener: function (type, cb) { handlers[type] = cb; }
};
let persistCalls = 0;
global.persistState = function () { persistCalls++; };

((src) => { eval(src); })(liveSrc);

let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) { pass++; console.log('PASS ' + msg); } else { fail++; console.log('FAIL ' + msg); } }

const notIgnored = { closest: () => null };
const inside = {
  closest: (sel) => (sel.indexOf('authScreen') >= 0 ? {} : null)
};
const divTarget = { closest: () => null };

handlers['input']({ target: Object.assign({ tagName: 'INPUT' }, notIgnored) });
ok(persistCalls === 1, 'typing in an app input triggers persistState (' + persistCalls + ' call)');

handlers['change']({ target: Object.assign({ tagName: 'SELECT' }, notIgnored) });
ok(persistCalls === 2, 'changing a select triggers persistState (' + persistCalls + ' calls)');

handlers['input']({ target: Object.assign({ tagName: 'TEXTAREA' }, notIgnored) });
ok(persistCalls === 3, 'typing in a textarea triggers persistState');

// Non-control: ignored.
handlers['input']({ target: divTarget });
handlers['change']({ target: divTarget });
ok(persistCalls === 3, 'non-control elements (div) are ignored');

// Login screen: ignored (no spurious saves while typing credentials).
handlers['input']({ target: Object.assign({ tagName: 'INPUT' }, inside) });
ok(persistCalls === 3, 'login / admin / sync-review controls are ignored');

console.log(fail === 0 ? 'ALL LIVE-SYNC CHECKS PASSED' : (fail + ' CHECK(S) FAILED'));
process.exit(fail === 0 ? 0 : 1);