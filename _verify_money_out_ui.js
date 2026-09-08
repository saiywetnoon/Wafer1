/* Node smoke harness for the Calendar + Money-Out wiring.
   Loads the REAL js/moneyout.js and js/calendar.js with DOM stubs and
   verifies the audit-table Money Out column, the day-cell tooltip, the
   day "out" detail, and the spending-only-day ↓k chip. */
const fs = require('fs');
const path = require('path');
const dir = 'd:\\wafer\\Wafer_documentary\\dail-ledger v1.6\\js';
const read = (f) => fs.readFileSync(path.join(dir, f), 'utf8');

/* ---- DOM stubs ---- */
const els = {};
function mkEl() {
  return {
    value: '', textContent: '', innerHTML: '', className: '',
    classList: { add() {}, remove() {}, contains() { return false; }, toggle() {} },
    addEventListener() {}, appendChild() {}, remove() {}, setAttribute() {}, getAttribute() { return null; },
    querySelectorAll() { return []; }, style: {}
  };
}
global.document = {
  body: { classList: { add() {}, remove() {}, contains() { return false; }, toggle() {} } },
  getElementById(id) { if (!els[id]) els[id] = mkEl(); return els[id]; },
  querySelector() { return null; },
  querySelectorAll() { return []; },
  createElement() { return mkEl(); }
};
global.$ = (id) => document.getElementById(id);
global.window = global;
global.lucide = { createIcons() {} };
global.wireResponsiveTables = () => {};
global.today = () => '2026-09-08';
global.fmt = (n) => Number(n).toLocaleString('en-US');
global.fmtKs = (n) => fmt(Math.round(n)) + ' Ks';
global.esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
  return c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;';
});

/* ---- state ---- */
const state = {
  suppliers: [{ id: 's1', name: 'Aung Shop' }],
  production: [{ id: 'p1', date: '2026-09-08', capital: 50000, laborMinutes: 120, laborCost: 3000, bags: 12, pieces: 72, notes: '' }],
  sales: [{ id: 's1', date: '2026-09-08', amount: 150000, bags: 12, pieces: 72 }],
  purchases: [{ id: 'b1', supplierId: 's1', date: '2026-09-09', items: [{ name: 'Flour' }], itemTotal: 9000, paidNow: 9000, paid: 0, note: '' }],
  payments: [{ id: 'w1', supplierId: 's1', date: '2026-09-08', amount: 10000 }],
  expenses: [{ id: 'e1', date: '2026-09-08', amount: 20000, desc: 'Fryer screen', category: 'Equipment' }],
  cash: { opening: 0, adjustments: [{ id: 'c1', date: '2026-09-08', amount: -5000, label: 'Owner draw' }] }
};
global.state = state;

/* Real same-day entry builder (mirrors js/helpers.js entriesProdSales). */
function entriesProdSales() {
  var map = {};
  (state.production || []).forEach(function (p) {
    if (!map[p.date]) map[p.date] = { date: p.date, prodBags: 0, prodPieces: 0, capital: 0, laborMin: 0, laborCost: 0, soldBags: 0, soldPieces: 0, revenue: 0, cogs: 0, net: 0 };
    var d = map[p.date];
    d.prodBags += (p.bags || 0); d.prodPieces += (p.pieces || 0); d.capital += (p.capital || 0);
    d.laborMin += (p.laborMinutes || 0); d.laborCost += (p.laborCost || 0);
  });
  (state.sales || []).forEach(function (s) {
    if (!map[s.date]) map[s.date] = { date: s.date, prodBags: 0, prodPieces: 0, capital: 0, laborMin: 0, laborCost: 0, soldBags: 0, soldPieces: 0, revenue: 0, cogs: 0, net: 0 };
    var d = map[s.date];
    d.soldBags += (s.bags || 0); d.soldPieces += (s.pieces || 0); d.revenue += (s.amount || 0);
  });
  Object.keys(map).forEach(function (k) {
    map[k].cogs = map[k].capital || 0;
    map[k].net = (map[k].revenue || 0) - (map[k].capital || 0);
  });
  return Object.keys(map).sort().map(function (k) { return map[k]; });
}
global.entriesProdSales = entriesProdSales;

/* Load the real modules in one shared scope. */
eval(read('moneyout.js') + '\n' + read('calendar.js'));

/* Pin the calendar to September 2026 so the sample days are in view. */
calYear = 2026; calMonth = 8; // 8 = September (0-based)

let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) { pass++; console.log('PASS ' + msg); } else { fail++; console.log('FAIL ' + msg); } }

/* ---- 1) Audit table shows the day's Money Out total ---- */
renderAuditTable();
ok(els.auditBody.innerHTML.indexOf('88,000 Ks') > -1,
  'audit table Money Out cell shows 88,000 Ks for 2026-09-08');

/* ---- 2) Day detail includes the "out" reason ---- */
const entry = entriesProdSales().find(function (e) { return e.date === '2026-09-08'; });
ok(auditDayDetail(entry).indexOf('out 88,000 Ks') > -1,
  'day detail appends "out 88,000 Ks"');

/* ---- 3) Calendar day-cell tooltip includes money out ---- */
renderCalendar();
ok(els.calendarGrid.innerHTML.indexOf('· out 88,000 Ks') > -1,
  'day-cell tooltip for 2026-09-08 shows money out');

/* ---- 4) Spending-only day shows a ↓k chip on the grid ---- */
ok(els.calendarGrid.innerHTML.indexOf('↓9k') > -1,
  'spending-only day 2026-09-09 shows ↓9k chip');

/* ---- 5) Monthly Profit Report shows money-out total + category breakdown ---- */
eval(read('dashboard.js'));
$('reportMonth').value = '2026-09';
renderMonthlyReport();
ok(els.monthlyReport.innerHTML.indexOf('97,000 Ks') > -1,
  'monthly Total Money Out tile shows 97,000 Ks for Sep 2026');
ok(els.monthlyReport.innerHTML.indexOf('Where the money went') > -1,
  'monthly report renders "Where the money went" block');
ok(els.monthlyReport.innerHTML.indexOf('Ingredients & Materials · 50,000 Ks') > -1,
  'monthly category breakdown lists materials 50,000 Ks');

console.log('');
console.log(fail === 0 ? 'ALL CALENDAR MONEY-OUT UI CHECKS PASSED' : (fail + ' FAILED'));
process.exit(fail === 0 ? 0 : 1);