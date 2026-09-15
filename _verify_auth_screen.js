/* ============================================================
   VERIFY — LOGIN SCREEN NO LONGER SHOWS LEGACY "SERVER SETTINGS"
   (v1.8.5 auth-screen fix)
   Previously the dead Apps-Script "Server settings" block on the
   login screen was hidden only while SUPA.configured() was true —
   which requires the CDN supabase-js library (window.supabase) to be
   loaded. On a slow CDN moment it was false, so the block flashed on
   the login page ("sometimes"). This verifies the block is hidden
   unconditionally and login never falls into the dead legacy path.
   Run: node _verify_auth_screen.js
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const dir = path.join(__dirname, 'js');
const read = (f) => fs.readFileSync(path.join(dir, f), 'utf8');

let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) { pass++; console.log('PASS ' + msg); } else { fail++; console.log('FAIL ' + msg); } }

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
  constructor(id) { this.id = id; this._cls = ''; this.classList = new ClassListStub(this); this.value = ''; this._listeners = {}; this._attrs = {}; }
  setAttribute(k, v) { this._attrs[k] = v; }
  getAttribute(k) { return k in this._attrs ? this._attrs[k] : null; }
  addEventListener(t, f) { (this._listeners[t] = this._listeners[t] || []).push(f); }
}
const byId = {};
function el(id) { return (byId[id] = byId[id] || new El(id)); }
const detailsEl = new El('authDetails');
function querySelector(sel) { return (sel === '#authScreen details') ? detailsEl : el(sel); }
global.document = {
  getElementById(id) { return el(id); },
  querySelector,
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

/* ---- the REAL modules (one eval so their functions share one scope) ---- */
eval(read('config.js') + '\n' + read('auth.js') +
  '\n;global.__a = { authLogin, authSignup, showAuthScreen, authBootstrap };');
const { authLogin, authSignup, showAuthScreen } = global.__a;

/* Stub SUPA adapter — simulates the real adapter before/without the CDN lib. */
global.SUPA = {
  configured: () => !!(global.window && global.window.supabase),
  user: null, profile: { role: 'user', status: 'pending' },
  sessionUser: async function () {
    const u = (global.window && global.window.supabase) ? { id: 'u', email: 'a@b.c' } : null;
    global.SUPA.user = u;                     // the real adapter caches the session too
    return u;
  },
  getProfile: async () => null,
  signIn: async () => ({ error: { message: 'not called when lib missing' } }),
  signUp: async () => ({ error: { message: 'not called when lib missing' } }),
  signOut: async () => {},
  resetPassword: async () => ({ error: 'x' }),
  updatePassword: async () => ({ error: 'x' }),
  listUsers: async () => [],
};

/* ---------- checks ---------- */
// 1) The markup itself starts hidden (no FOUC even before any JS runs).
const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const detailsBlock = html.match(/<details[^>]*>[\s\S]*?<\/details>/);
ok(detailsBlock && detailsBlock[0].indexOf('Server settings') > -1, 'auth screen still has the legacy Server settings block in markup');
ok(detailsBlock && /\bhidden\b/.test(detailsBlock[0]), 'the Server settings block starts with hidden in the markup (never flashes)');

// 2) showAuthScreen hides the block UNCONDITIONALLY — even while the
//    supabase-js CDN library is still loading (SUPA.configured() false).
global.window.supabase = undefined;                       // library still loading
ok(global.SUPA.configured() === false, 'precondition: configured() is false while lib is loading');
detailsEl.classList.add('hidden');
showAuthScreen();
ok(detailsEl.classList.contains('hidden'), 'showAuthScreen hides Server settings even when SUPA.configured() is false');

// 3) The lib later arrives -> still hidden.
global.window.supabase = { createClient: function () { return null; } };
showAuthScreen();
ok(detailsEl.classList.contains('hidden'), 'showAuthScreen keeps it hidden once the lib is loaded');

// 4) Login while the lib is again missing returns a friendly "still loading"
//    message, NOT the dead legacy "No server URL configured" path.
global.window.supabase = undefined;
const r = await authLogin('a@b.c', 'secret1');
ok(r && r.ok === false && typeof r.message === 'string' && /still loading/i.test(r.message),
  'login returns an honest "still loading" message when the lib is late (got: ' + (r && r.message) + ')');

// 5) With the lib loaded, login actually reaches Supabase (legacy never used).
global.window.supabase = { createClient: function () { return null; } };
global.SUPA.signIn = async () => ({ data: {}, error: null });
global.SUPA.sessionUser = async function () { global.SUPA.user = { id: 'u', email: 'a@b.c' }; return global.SUPA.user; };
global.SUPA.getProfile = async () => { global.SUPA.profile = { role: 'admin', status: 'approved' }; return true; };
const okLogin = await authLogin('a@b.c', 'secret1');
ok(okLogin && okLogin.ok === true, 'login reaches the Supabase path when the lib is ready');

console.log('\n' + (fail === 0 ? 'ALL AUTH-SCREEN CHECKS PASSED' : (fail + ' FAILURE(S)')) + '  (' + pass + ' passed)');
process.exitCode = fail === 0 ? 0 : 1;

})();