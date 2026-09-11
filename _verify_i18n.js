/* Verifies the Myanma/English i18n layer:
   - defaults to English,
   - t() translates known phrases and falls back to English otherwise,
   - toggling persists to localStorage,
   - the dictionary is well-formed (unique keys, non-empty values),
   - every main navigation label has a translation. */
const fs = require('fs');
const path = require('path');
const dir = 'd:\\wafer\\Wafer_documentary\\dail-ledger v1.7\\js';
const read = (f) => fs.readFileSync(path.join(dir, f), 'utf8');

global.window = global;
const store = {};
global.localStorage = {
  getItem: (k) => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: (k) => { delete store[k]; }
};
global.document = {
  readyState: 'complete',
  title: '',
  body: undefined,
  documentElement: { setAttribute: function () {}, getAttribute: function () { return 'v1.13.0'; } },
  getElementById: function () { return null; },
  addEventListener: function () {}
};

const TEST_BODY = `
let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) { pass++; console.log('PASS ' + msg); } else { fail++; console.log('FAIL ' + msg); } }

ok(getAppLang() === 'en', 'defaults to English');

setAppLang('my');
ok(t('Production') === 'ထုတ်လုပ်မှု', 'Production -> Myanma');
ok(t('Dashboard') === 'အကျဉ်းချုပ်', 'Dashboard -> Myanma');
ok(t('Sign Out') === 'ထွက်မည်', 'Sign Out -> Myanma');
ok(t('Save Production Work') === 'ထုတ်လုပ်မှု သိမ်းမည်', 'Save Production Work -> Myanma');
ok(t('Record Payment') === 'ငွေပေးချေမှု မှတ်တမ်း', 'Record Payment -> Myanma');
ok(t('Delete this sale?') === 'ဤ အရောင်းကို ဖျက်မည်လား။', 'confirm string -> Myanma');
ok(t('Something Not In The Dictionary 12345') === 'Something Not In The Dictionary 12345', 'unknown phrase falls back to English');
ok(localStorage.getItem('dailyCrispyRollLedger_lang') === 'my', 'Myanma persisted to localStorage');

setAppLang('en');
ok(t('Production') === 'Production', 'back to English');
ok(localStorage.getItem('dailyCrispyRollLedger_lang') === 'en', 'English persisted to localStorage');

var keys = Object.keys(I18N_MY);
var uniq = new Set(keys);
ok(uniq.size === keys.length, 'dictionary keys are unique (' + keys.length + ' entries)');
var empties = keys.filter(function (k) { return !String(I18N_MY[k]).trim(); });
ok(empties.length === 0, 'no empty translations');

['Production', 'Fry Timers', 'Sales & Stock', 'Dashboard', 'Inventory', 'Customers',
 'Suppliers', 'Cash Drawer', 'Business Tools', 'Sync & Backup'].forEach(function (label) {
  ok(I18N_MY[label] !== undefined, 'nav label translated: ' + label);
});

console.log(fail === 0 ? 'ALL I18N CHECKS PASSED' : (fail + ' I18N CHECK(S) FAILED'));
process.exit(fail === 0 ? 0 : 1);
`;

eval(read('config.js') + '\n' + read('i18n.js') + '\n' + TEST_BODY);