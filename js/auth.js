/* ============================================================
   ACCOUNTS — email + password with admin approval
   ============================================================
   The whole app is gated behind this screen:
     1. User signs up  → saved on the server as 'pending'
     2. Admin approves → the account can now log in
     3. Log in         → session token stored locally
   Every cloud request afterwards carries the session token and
   the server only serves that account's own row of data.
   ============================================================ */

const AUTH_SERVER_KEY = 'dailyCrispyRollLedger_authServer';
const AUTH_TOKEN_KEY = 'dailyCrispyRollLedger_authToken';
const AUTH_EMAIL_KEY = 'dailyCrispyRollLedger_authEmail';
const AUTH_ROLE_KEY = 'dailyCrispyRollLedger_authRole';
let authUser = null; // { email, role }

function authToken() { try { return localStorage.getItem(AUTH_TOKEN_KEY) || ''; } catch (e) { return ''; } }
function authEmail() { try { return localStorage.getItem(AUTH_EMAIL_KEY) || ''; } catch (e) { return ''; } }
function authRole() { try { return localStorage.getItem(AUTH_ROLE_KEY) || ''; } catch (e) { return ''; } }
function authIsAdmin() { return authRole() === 'admin'; }

/* The backend URL. Saved per-browser on the login screen; falls back to
   the Google Sync config (per-company) used by the old app. */
function authServerUrl() {
  try { const saved = localStorage.getItem(AUTH_SERVER_KEY); if (saved) return saved; } catch (e) {}
  const cfg = typeof getGoogleSyncConfig === 'function' ? getGoogleSyncConfig() : null;
  return (cfg && cfg.sheetUrl) || '';
}
function saveAuthServerUrl(url) {
  try { localStorage.setItem(AUTH_SERVER_KEY, String(url || '').trim()); } catch (e) {}
}

async function authPost(action, extra) {
  const url = authServerUrl();
  if (!url) {
    return { ok: false, error: 'No server URL configured. Paste your Apps Script Web App URL below.' };
  }
  const body = Object.assign({ action: action, token: authToken() }, extra || {});
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(body)
    });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    return await resp.json();
  } catch (e) {
    console.error('auth ' + action + ' failed', e);
    return { ok: false, error: String(e) };
  }
}

function moveAuthUser(r) {
  if (!r || !r.ok || !r.email) return false;
  authUser = { email: r.email, role: r.role || 'user' };
  try {
    localStorage.setItem(AUTH_TOKEN_KEY, r.token);
    localStorage.setItem(AUTH_EMAIL_KEY, r.email);
    localStorage.setItem(AUTH_ROLE_KEY, r.role || 'user');
  } catch (e) {}
  return true;
}
function clearAuthUser() {
  authUser = null;
  try {
    localStorage.removeItem(AUTH_TOKEN_KEY);
    localStorage.removeItem(AUTH_EMAIL_KEY);
    localStorage.removeItem(AUTH_ROLE_KEY);
  } catch (e) {}
}

async function authSignup(email, password) { return authPost('signup', { email: email, password: password }); }
async function authLogin(email, password) {
  const r = await authPost('login', { email: email, password: password });
  if (r && r.ok && r.token) moveAuthUser(r);
  return r;
}
async function authLogout() {
  await authPost('logout', {});
  clearAuthUser();
}

/* ============================================================
   BOOT GATE — only valid sessions reach the app
   ============================================================ */
async function authBootstrap() {
  const token = authToken();
  const email = authEmail();
  if (!token || !email) { showAuthScreen(); return false; }
  const r = await authPost('me', {});
  if (r && r.ok && r.email) {
    if (!authUser) authUser = { email: r.email, role: r.role || 'user' };
    try { localStorage.setItem(AUTH_EMAIL_KEY, r.email); localStorage.setItem(AUTH_ROLE_KEY, r.role || 'user'); } catch (e) {}
    renderAuthBadge();
    hideAuthScreen();
    return true;
  }
  clearAuthUser();
  renderAuthBadge();
  showAuthScreen();
  return false;
}

function showAuthScreen(msg) {
  const s = $('authScreen'); if (s) s.classList.remove('hidden');
  const app = $('appContainer'); if (app) app.classList.add('hidden');
  const serverInput = $('authServerUrl'); if (serverInput && !serverInput.value) serverInput.value = authServerUrl();
  if (msg) setAuthMsg(msg, 'info');
}
function hideAuthScreen() {
  const s = $('authScreen'); if (s) s.classList.add('hidden');
  const app = $('appContainer'); if (app) app.classList.remove('hidden');
  renderAuthBadge();
}
function setAuthMsg(text, type) {
  const el = $('authMsg'); if (!el) return;
  el.textContent = text || '';
  el.classList.remove('hidden');
  const colors = {
    error: 'bg-red-900/40 text-red-300',
    success: 'bg-emerald-900/40 text-emerald-300',
    info: 'bg-gray-800 text-gray-400'
  };
  el.className = 'text-xs font-semibold mt-4 px-3 py-2 rounded-lg ' + (colors[type] || colors.info);
  if (!text) el.classList.add('hidden');
}
function switchAuthTab(mode) {
  document.querySelectorAll('.auth-tab-btn').forEach(function (b) {
    const on = b.dataset.tab === mode;
    b.className = 'auth-tab-btn flex-1 py-2 rounded-lg text-sm font-bold transition ' +
      (on ? 'bg-amber-500 text-gray-900' : 'bg-gray-800 text-gray-400 hover:bg-gray-700');
  });
  const login = $('loginPane'); if (login) login.classList.toggle('hidden', mode !== 'login');
  const signup = $('signupPane'); if (signup) signup.classList.toggle('hidden', mode !== 'signup');
  setAuthMsg('');
}
/* ============================================================
   LOGIN / SIGNUP action handlers
   ============================================================ */
function authReadInputs() {
  const email = (($('authEmail') || {}).value || '').trim();
  const password = (($('authPassword') || {}).value || '');
  const server = (($('authServerUrl') || {}).value || '').trim();
  if (server) saveAuthServerUrl(server);
  return { email: email, password: password };
}

async function doAuthLogin() {
  setAuthMsg('Signing in…', 'info');
  const inp = authReadInputs();
  if (!inp.email || !inp.password) { setAuthMsg('Enter your email and password.', 'error'); return; }
  const r = await authLogin(inp.email, inp.password);
  if (r && r.ok) {
    setAuthMsg('Welcome back!', 'success');
    location.reload(); // boot path now validates the session and opens the ledger
  } else {
    setAuthMsg((r && (r.message || r.error)) || 'Login failed. Check the server URL.', 'error');
  }
}

async function doAuthSignup() {
  setAuthMsg('Creating account…', 'info');
  const inp = authReadInputs();
  if (!inp.email || !inp.password) { setAuthMsg('Enter your email and a password (at least 6 characters).', 'error'); return; }
  if (inp.password.length < 6) { setAuthMsg('Password must be at least 6 characters.', 'error'); return; }
  const r = await authSignup(inp.email, inp.password);
  if (r && r.ok) {
    if (r.status === 'approved') {
      const loginRes = await authLogin(inp.email, inp.password);
      if (loginRes && loginRes.ok) { location.reload(); return; }
      setAuthMsg('Account created — you can sign in now.', 'success');
      switchAuthTab('login');
    } else {
      setAuthMsg(r.message || 'Account created — awaiting admin approval.', 'success');
      $('authPassword').value = '';
      switchAuthTab('login');
    }
  } else {
    setAuthMsg((r && (r.message || r.error)) || 'Could not create the account. Check the server URL.', 'error');
  }
}

async function doAuthLogout() {
  await authLogout();
  location.reload();
}

function renderAuthBadge() {
  const lbl = $('authUserLabel'); if (lbl) lbl.textContent = (authEmail() || 'Sign out');
  const btn = $('authLogoutBtn'); if (btn) btn.classList.toggle('hidden', !authEmail());
  const admin = $('adminBtn'); if (admin) admin.classList.toggle('hidden', !authIsAdmin());
  const cb = $('companyNameBtn'); if (cb) cb.classList.toggle('hidden', !!authEmail());
}
/* ============================================================
   ADMIN CONSOLE — approve / reject pending accounts
   ============================================================ */
async function openAdminConsole() {
  const modal = $('adminModal'); if (modal) modal.classList.remove('hidden');
  const list = $('adminUserList'); if (!list) return;
  setAdminMsg('Loading users…', 'info');
  list.innerHTML = '<div class="text-xs text-gray-500">Loading…</div>';
  const r = await authPost('listUsers', {});
  if (!r || !r.ok) {
    setAdminMsg((r && r.message) || 'Could not load users.', 'error');
    list.innerHTML = '<div class="text-xs text-gray-500">No access.</div>';
    return;
  }
  setAdminMsg('');
  if (!r.users || !r.users.length) {
    list.innerHTML = '<div class="text-xs text-gray-500">No accounts yet. Share your app link and users can request an account.</div>';
    return;
  }
  list.innerHTML = r.users.map(adminUserRowHtml).join('');
  lucide.createIcons();
}
function adminUserRowHtml(u) {
  const st = u.status || 'pending';
  const badge = st === 'approved'
    ? '<span class="text-[9px] px-1.5 py-0.5 rounded bg-emerald-500 text-gray-900 font-bold">APPROVED</span>'
    : st === 'rejected'
    ? '<span class="text-[9px] px-1.5 py-0.5 rounded bg-red-500 text-white font-bold">REJECTED</span>'
    : '<span class="text-[9px] px-1.5 py-0.5 rounded bg-amber-500 text-gray-900 font-bold">PENDING</span>';
  const when = esc(String(u.createdAt || '').replace('T', ' ').slice(0, 16) || '—');
  const last = u.lastLogin ? ' · last login ' + String(u.lastLogin).replace('T', ' ').slice(0, 16) : '';
  const email = esc(u.email);
  const roleTag = u.role === 'admin' ? '<span class="text-[10px] text-amber-400 font-bold ml-1">ADMIN</span>' : '';
  let actions = '';
  if (st === 'pending' || st === 'rejected') {
    actions = '<button onclick="adminAct(\'approve\',\'' + email.replace(/'/g, "\\'") + '\')" class="px-2 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-[10px] font-bold">Approve</button> ';
  }
  if (st === 'pending') {
    actions += '<button onclick="adminAct(\'reject\',\'' + email.replace(/'/g, "\\'") + '\')" class="px-2 py-1 rounded bg-red-700/70 hover:bg-red-600 text-red-100 text-[10px] font-bold">Reject</button>';
  }
  return '<div class="flex items-center justify-between gap-2 py-2 border-b border-gray-700 last:border-0">' +
    '<div class="min-w-0"><div class="text-sm font-semibold truncate">' + email + roleTag + '</div>' +
    '<div class="text-[10px] text-gray-500">joined ' + when + last + '</div></div>' +
    '<div class="flex items-center gap-1.5 shrink-0">' + badge + actions + '</div></div>';
}
function setAdminMsg(text, type) {
  const el = $('adminMsg'); if (!el) return;
  el.textContent = text || '';
  const colors = { error: 'text-red-400', success: 'text-emerald-400', info: 'text-gray-400' };
  el.className = 'text-xs font-semibold mt-3 ' + (colors[type] || colors.info);
}
async function adminAct(action, email) {
  const r = await authPost(action, { email: email });
  const msg = r && r.ok ? r.message : ((r && r.message) || 'Action failed.');
  const good = !!(r && r.ok);
  await openAdminConsole(); // refresh the list, then show the result
  setAdminMsg(msg, good ? 'success' : 'error');
}

/* ============================================================
   LEGACY DATA IMPORT — bring the old browser ledger into the
   account the moment they log in (Confirms once).
   ============================================================ */
function maybeImportLegacy() {
  try {
    if (!authEmail()) return;
    const oldRaw = localStorage.getItem(STORAGE_KEY);
    if (!oldRaw) return;
    const newKey = companyStateKey();
    if (localStorage.getItem(newKey)) return;
    if (confirm('Found ledger data from before the account update on this device. Import it into your account now?')) {
      localStorage.setItem(newKey, oldRaw);
      showToast('Your previous data was imported into this account.', 'success');
    }
  } catch (e) { console.warn('Legacy import skipped', e); }
}
/* ============================================================
   BINDINGS
   ============================================================ */
document.querySelectorAll('.auth-tab-btn').forEach(function (b) {
  b.addEventListener('click', function () { switchAuthTab(b.dataset.tab); });
});
if ($('authLoginBtn')) $('authLoginBtn').addEventListener('click', function (e) { e.preventDefault(); doAuthLogin(); });
if ($('authSignupBtn')) $('authSignupBtn').addEventListener('click', function (e) { e.preventDefault(); doAuthSignup(); });
if ($('authLogoutBtn')) $('authLogoutBtn').addEventListener('click', doAuthLogout);
if ($('adminBtn')) $('adminBtn').addEventListener('click', openAdminConsole);
if ($('adminCloseBtn')) $('adminCloseBtn').addEventListener('click', function () { $('adminModal').classList.add('hidden'); });
if ($('authPassword')) $('authPassword').addEventListener('keydown', function (e) {
  if (e.key !== 'Enter') return;
  if ($('signupPane') && !$('signupPane').classList.contains('hidden')) doAuthSignup();
  else doAuthLogin();
});

/* Default the login/sign-up tab to "Log In". */
switchAuthTab('login');