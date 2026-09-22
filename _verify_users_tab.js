/* ============================================================
   VERIFY — USERS & PERMISSIONS TAB (v1.14.0)
   ----------------------------------------------------------------------------
   Exercises the REAL modules (config, helpers, auth) with a DOM/Supa stub:
   - the Users tab button + panel exist in the markup and are admin-only,
   - renderUsersTab() renders the full user list and the Active (approved)
     list with correct stats and the right action buttons per status/role,
   - promote/demote go through SUPA.setUserRole and approve/reject go through
     SUPA.setAccountStatus, with messages on success/failure,
   - a non-admin is never shown the panel content.
   Run: node _verify_users_tab.js
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const dir = path.join(__dirname, 'js');
const read = (f) => fs.readFileSync(path.join(dir, f), 'utf8');

let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) { pass++; console.log('PASS ' + msg); } else { fail++; console.log('FAIL ' + msg); } }
const has = (s, sub) => String(s || '').indexOf(sub) !== -1;

(async function main() {

/* ---------- DOM stubs ---------- */
class ClassListStub {
  constructor(el) { this._e = el; this._set = new Set(); }
  add(...c) { c.forEach((x) => this._set.add(x)); this._e._cls = [...this._set].join(' '); }
  remove(...c) { c.forEach((x) => this._set.delete(x)); this._e._cls = [...this._set].join(' '); }
  toggle(c, f) { if (f === undefined) f = !this._set.has(c); f ? this._set.add(c) : this._set.delete(c); this._e._cls = [...this._set].join(' '); }
  contains(c) { return this._set.has(c); }
}
class El {
  constructor(id) { this.id = id; this._cls = 'hidden'; this.classList = new ClassListStub(this); this.value = ''; this.innerHTML = ''; this.textContent = ''; this._listeners = {}; this._attrs = {}; }
  setAttribute(k, v) { this._attrs[k] = v; }
  getAttribute(k) { return k in this._attrs ? this._attrs[k] : null; }
  addEventListener(t, f) { (this._listeners[t] = this._listeners[t] || []).push(f); }
}
const byId = {};
function el(id) { if (!byId[id]) byId[id] = new El(id); return byId[id]; }
function clearEls() { Object.keys(byId).forEach((k) => { byId[k].innerHTML = ''; byId[k].textContent = ''; byId[k]._cls = 'hidden'; }); }
global.document = {
  getElementById(id) { return el(id); },
  querySelector() { return null; },
  querySelectorAll() { return []; },
  createElement() { return new El(''); },
  addEventListener() {},
  body: { classList: { add() {}, remove() {}, contains() { return false; } } }
};
global.$ = (id) => el(id);
global.window = { location: { hash: '' } };
global.localStorage = { getItem() { return null; }, setItem() {}, removeItem() {} };
global.location = global.window.location;
global.prompt = () => null;
global.confirm = () => false;

/* ---- the REAL modules (one eval so their functions share one scope) ---- */
eval(read('config.js') + '\n' + read('helpers.js') + '\n' + read('auth.js') +
  '\n;global.__u = { renderUsersTab, usersAct, renderAuthBadge, authIsAdmin, esc };');
const { renderUsersTab, usersAct, renderAuthBadge, authIsAdmin, esc } = global.__u;

/* ---------- markup checks ---------- */
const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
ok(has(html, 'id="usersTabBtn"') && has(html, 'data-tab="users"'), 'Users tab button exists in the sidebar markup');
ok(has(html, '<section id="tab-users"'), 'Users tab panel exists in the markup');
ok(has(html, 'id="usersList"') && has(html, 'id="activeUsersList"') && has(html, 'id="usersMsg"'),
  'user list / active list / message containers present');
ok(has(html, 'id="usersStatTotal"') && has(html, 'id="usersStatActive"') && has(html, 'id="usersStatPending"'),
  'total / active / pending stat cards present');

/* ---------- fixture users ---------- */
const users = [
  { id: 'me', email: 'owner@x.com', role: 'admin', status: 'approved', created_at: '2026-01-01T10:00:00Z' },
  { id: 'u2', email: 'staff@y.com', role: 'user', status: 'approved', created_at: '2026-02-01T10:00:00Z' },
  { id: 'u3', email: "o'brien@z.com", role: 'admin', status: 'approved', created_at: '2026-02-02T10:00:00Z' },
  { id: 'u4', email: 'pending@z.com', role: 'user', status: 'pending', created_at: '2026-02-03T10:00:00Z' },
  { id: 'u5', email: 'rejected@z.com', role: 'user', status: 'rejected', created_at: '2026-02-04T10:00:00Z' }
];

/* ---------- Stub SUPA adapter (role = admin, session = 'me') ---------- */
const calls = { status: [], role: [] };
global.SUPA = {
  configured: () => true,
  user: { id: 'me', email: 'owner@x.com' },
  profile: { role: 'admin', status: 'approved' },
  sessionUser: async function () { global.SUPA.user = { id: 'me', email: 'owner@x.com' }; return global.SUPA.user; },
  getProfile: async () => null,
  signIn: async () => ({ error: { message: 'not called' } }),
  signUp: async () => ({ error: { message: 'not called' } }),
  signOut: async () => {},
  resetPassword: async () => ({ error: 'x' }),
  updatePassword: async () => ({ error: 'x' }),
  listUsers: async () => users.slice(),
  setAccountStatus: async (id, status) => { calls.status.push([id, status]); return { ok: true }; },
  setUserRole: async (id, role) => { calls.role.push([id, role]); return { ok: true }; }
};

/* ---------- checks: admin-only visibility ---------- */
clearEls();
global.SUPA.profile.role = 'admin';
renderAuthBadge();
ok(byId['usersTabBtn'] && !byId['usersTabBtn'].classList.contains('hidden'), 'admin: Users tab button is visible');
ok(byId['tab-users'] && !byId['tab-users'].classList.contains('hidden'), 'admin: Users tab panel is revealed');
global.SUPA.profile.role = 'user';
renderAuthBadge();
ok(byId['usersTabBtn'] && byId['usersTabBtn'].classList.contains('hidden'), 'ordinary user: Users tab button is hidden');
ok(byId['tab-users'] && byId['tab-users'].classList.contains('hidden'), 'ordinary user: Users tab panel is hidden');
global.SUPA.profile.role = 'admin';
renderAuthBadge();
ok(authIsAdmin(), 'authIsAdmin() reflects the admin profile');

/* ---------- checks: renderUsersTab builds both lists ---------- */
clearEls();
await renderUsersTab();
const listHtml = byId['usersList'].innerHTML;
const activeHtml = byId['activeUsersList'].innerHTML;
const wired = (listHtml.match(/onclick="usersAct/g) || []).length;
ok(wired >= 3, 'rendered rows carry usersAct() action buttons (found ' + wired + ')');
ok(byId['usersStatTotal'].textContent === '5', 'stat total = 5 (all accounts)');
ok(byId['usersStatActive'].textContent === '3', 'stat active = 3 (approved only)');
ok(byId['usersStatPending'].textContent === '1', 'stat pending = 1');
ok(has(listHtml, 'pending@z.com') && has(listHtml, 'rejected@z.com'), 'all accounts list includes pending AND rejected rows');
ok(has(listHtml, 'Approve') && has(listHtml, 'Reject'), 'pending row offers Approve + Reject');
ok(has(listHtml, 'Make Admin'), 'approved USER row offers Make Admin (promote to admin)');
ok((listHtml.match(/Remove Admin/g) || []).length === 1, 'other admins offer Remove Admin exactly once');
ok(has(listHtml, 'You'), 'own row shows a "You" tag instead of a demote button');
ok(!has(activeHtml, 'pending@z.com') && !has(activeHtml, 'rejected@z.com'), 'Active list excludes pending + rejected');
ok(has(activeHtml, 'staff@y.com') && has(activeHtml, 'o&#39;brien@z.com'), 'Active list includes every approved account');

/* ---------- checks: escaping ---------- */
ok(esc('<img src=x onerror=alert(1)>') === '&lt;img src=x onerror=alert(1)&gt;', 'esc() neutralises HTML injected in emails');

/* ---------- checks: action routing ---------- */
await usersAct('promote', 'u2', 'staff@y.com');
ok(calls.role.length === 1 && calls.role[0][0] === 'u2' && calls.role[0][1] === 'admin',
  'usersAct(promote) calls SUPA.setUserRole(u2, admin)');
ok(has(byId['usersMsg'].textContent, 'Made admin'), 'promote shows a success message');

await usersAct('demote', 'u3', "o'brien@z.com");
ok(calls.role.length === 2 && calls.role[1][0] === 'u3' && calls.role[1][1] === 'user',
  'usersAct(demote) calls SUPA.setUserRole(u3, user)');

await usersAct('approve', 'u4', 'pending@z.com');
ok(calls.status.length === 1 && calls.status[0][0] === 'u4' && calls.status[0][1] === 'approved',
  'usersAct(approve) calls SUPA.setAccountStatus(u4, approved)');

await usersAct('reject', 'u5', 'rejected@z.com');
ok(calls.status.length === 2 && calls.status[1][0] === 'u5' && calls.status[1][1] === 'rejected',
  'usersAct(reject) calls SUPA.setAccountStatus(u5, rejected)');

/* Failure path: the server refuses (e.g. last admin) -> honest error message. */
global.SUPA.setUserRole = async () => ({ error: 'Cannot demote the last admin' });
await usersAct('demote', 'u3', "o'brien@z.com");
ok(has(byId['usersMsg'].textContent, 'Cannot demote the last admin'),
  'SQL-side refusal surfaces as an error message instead of a silent fail');
global.SUPA.setUserRole = async (id, role) => { calls.role.push([id, role]); return { ok: true }; };

/* ---------- checks: non-admin cannot open the Users tab ---------- */
clearEls();
global.SUPA.profile.role = 'user';
await renderUsersTab();
ok(byId['tab-users'] && byId['tab-users'].classList.contains('hidden'),
  'renderUsersTab() keeps the panel hidden for ordinary users');
global.SUPA.profile.role = 'admin';

console.log('\n' + (fail === 0 ? 'ALL USERS-TAB CHECKS PASSED' : (fail + ' FAILURE(S)')) + '  (' + pass + ' passed)');
process.exitCode = fail === 0 ? 0 : 1;
})();
