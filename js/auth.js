/* ============================================================
   ACCOUNTS — email + password with owner approval
   ------------------------------------------------------------
   Backend: Supabase (auth + sessions + realtime). There is NO
   legacy Apps-Script path anymore — this app is Supabase-only.
   ============================================================ */

let authUser = null; // { email, role }

/* ---------- active session getters (Supabase) ---------- */
async function sbAuthUser() {
  if (!SUPA.libReady()) return null;
  const u = await SUPA.sessionUser();
  await SUPA.getProfile();
  return {
    email: (u && u.email) || '',
    id: (u && u.id) || '',
    role: SUPA.profile.role || 'user',
    status: SUPA.profile.status || 'pending'
  };
}
function authEmail() { return (SUPA.user && SUPA.user.email) || ''; }
function authToken() { return (SUPA.user && SUPA.user.id) || ''; }
function authRole() { return (SUPA.profile && SUPA.profile.role) || 'user'; }
function authIsAdmin() { return authRole() === 'admin'; }
function clearAuthUser() {
  authUser = null;
  // Clear any stale legacy key that earlier builds may have left behind.
  try {
    ['dailyCrispyRollLedger_authServer', 'dailyCrispyRollLedger_authToken',
     'dailyCrispyRollLedger_authEmail', 'dailyCrispyRollLedger_authRole'].forEach(function (k) { localStorage.removeItem(k); });
  } catch (e) {}
}

/* ---------- Sign up / In / Out ---------- */
async function authSignup(email, password) {
  if (!SUPA.libReady()) return { ok: false, message: SUPA.connectionError() };
  const r = await SUPA.signUp(email, password);
  if (r.error || !r.data) return { ok: false, message: (r.error && r.error.message) || 'Sign-up failed.' };
  // Supabase's DB trigger creates a pending profile row automatically.
  return { ok: true, status: 'pending', role: 'user', message: 'Account created — awaiting admin approval.' };
}
async function authLogin(email, password) {
  if (!SUPA.libReady()) return { ok: false, message: SUPA.connectionError() };
  const r = await SUPA.signIn(email, password);
  if (r.error) return { ok: false, message: (r.error && r.error.message) || 'Login failed.' };
  await SUPA.sessionUser();
  await SUPA.getProfile();
  if (SUPA.profile.status !== 'approved') {
    return { ok: false, message: SUPA.profile.status === 'pending'
      ? 'Your account is awaiting admin approval.'
      : 'This account was not approved. Contact the owner.' };
  }
  return { ok: true, email: SUPA.user.email, role: SUPA.profile.role, id: SUPA.user.id };
}
async function authLogout() {
  if (SUPA.libReady()) await SUPA.signOut();
  clearAuthUser();
}
// @@AUTH2@@

/* ============================================================
   BOOT GATE — only approved sessions reach the app
   ============================================================ */
async function authBootstrap() {
  if (!SUPA.libReady()) {
    // Supabase is configured but the library didn't load (CDN blocked/offline).
    // Show the login screen with the honest backend warning.
    showAuthScreen();
    return false;
  }
  const u = await sbAuthUser();
  if (u && u.email) {
    if (u.status === 'approved') {
      renderAuthBadge();
      // Coming from a password-reset link (recovery session): keep the auth
      // screen in front so the "set new password" pane is actually visible.
      if (__authRecovery) {
        showAuthScreen('Set a new password to continue.');
        showNewPasswordPane();
        return false;
      }
      hideAuthScreen();
      return true;
    }
    showAuthScreen(u.status === 'pending'
      ? 'Your account is awaiting admin approval.'
      : 'This account was not approved. Contact the owner.');
    return false;
  }
  showAuthScreen();
  return false;
}

function showAuthScreen(msg) {
  const s = $('authScreen'); if (s) s.classList.remove('hidden');
  const app = $('appContainer'); if (app) app.classList.add('hidden');
  // There is no legacy backend anymore — the "Server settings" field is gone.
  // If Supabase failed to load, say so honestly instead of offering it.
  const warn = $('authBackendWarn');
  if (warn) {
    if (!window.supabase) {
      warn.textContent = '⚠ The Supabase connection couldn\u2019t load (network or ad-blocker?). Check your internet and reload. You won\u2019t be able to sign in until it loads.';
      warn.classList.remove('hidden');
    } else {
      warn.classList.add('hidden');
    }
  }
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
  const colors = { error: 'bg-red-900/40 text-red-300', success: 'bg-emerald-900/40 text-emerald-300', info: 'bg-gray-800 text-gray-400' };
  el.className = 'text-xs font-semibold mt-4 px-3 py-2 rounded-lg ' + (colors[type] || colors.info) + (text ? '' : ' hidden');
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
  const reset = $('resetPane'); if (reset) reset.classList.add('hidden');
  const newPw = $('newPasswordPane'); if (newPw) newPw.classList.add('hidden');
  setAuthMsg('');
}

/* ============================================================
   LOGIN / SIGNUP actions
   ============================================================ */
function authReadInputs() {
  const email = (($('authEmail') || {}).value || '').trim();
  const password = (($('authPassword') || {}).value || '');
  return { email: email, password: password };
}
async function doAuthLogin() {
  setAuthMsg('Signing in…', 'info');
  const inp = authReadInputs();
  if (!inp.email || !inp.password) { setAuthMsg('Enter your email and password.', 'error'); return; }
  const r = await authLogin(inp.email, inp.password);
  if (r && r.ok) { location.reload(); return; }
  setAuthMsg((r && (r.message || r.error)) || 'Login failed.', 'error');
}

/* ---------- Password reset ---------- */
function hidePanes(except) {
  ['loginPane', 'signupPane', 'resetPane', 'newPasswordPane'].forEach(function (id) {
    if (id === except) return;
    const el = $(id);
    if (el) el.classList.add('hidden');
  });
}
function showResetPane() {
  hidePanes('resetPane');
  const p = $('resetPane'); if (p) p.classList.remove('hidden');
  setAuthMsg('');
  const email = $('resetEmail'); if (email) setTimeout(function () { email.focus(); }, 20);
}
function showNewPasswordPane() {
  hidePanes('newPasswordPane');
  const p = $('newPasswordPane'); if (p) p.classList.remove('hidden');
  setAuthMsg('');
  const pw = $('newPassword'); if (pw) setTimeout(function () { pw.focus(); }, 20);
}
async function doAuthReset() {
  if (!SUPA.libReady()) { setAuthMsg(SUPA.connectionError(), 'error'); return; }
  const email = (($('resetEmail') || {}).value || '').trim();
  if (!email) { setAuthMsg('Enter your email address.', 'error'); return; }
  setAuthMsg('Sending reset link…', 'info');
  const r = await SUPA.resetPassword(email);
  if (r && r.ok) {
    setAuthMsg('Reset link sent. Check your email inbox (and spam) and click the link to set a new password.', 'success');
    $('resetEmail').value = '';
  } else {
    setAuthMsg((r && r.error) || 'Could not send the reset link — try again.', 'error');
  }
}
async function doUpdatePassword() {
  const pw = (($('newPassword') || {}).value || '');
  if (pw.length < 6) { setAuthMsg('Password must be at least 6 characters.', 'error'); return; }
  setAuthMsg('Updating…', 'info');
  const r = await SUPA.updatePassword(pw);
  if (r && r.ok) {
    setAuthMsg('Password updated. Log in with your new password.', 'success');
    await SUPA.signOut();          // clear the recovery session
    switchAuthTab('login');
    $('newPassword').value = '';
    const s = $('authScreen'); if (s) s.classList.remove('hidden');
  } else {
    setAuthMsg((r && r.error) || 'Could not update the password — the reset link may have expired.', 'error');
  }
}
async function doAuthSignup() {
  setAuthMsg('Creating account…', 'info');
  const inp = authReadInputs();
  if (!inp.email) { setAuthMsg('Enter your email.', 'error'); return; }
  if (inp.password.length < 6) { setAuthMsg('Password must be at least 6 characters.', 'error'); return; }
  const r = await authSignup(inp.email, inp.password);
  if (r && r.ok) {
    setAuthMsg(r.message || 'Account created — awaiting approval.', 'success');
    $('authPassword').value = '';
    switchAuthTab('login');
  } else {
    setAuthMsg((r && (r.message || r.error)) || 'Could not create the account.', 'error');
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
// @@AUTH3@@

/* ============================================================
   ADMIN CONSOLE — approve / reject pending accounts
   ============================================================ */
async function openAdminConsole() {
  const modal = $('adminModal'); if (modal) modal.classList.remove('hidden');
  const list = $('adminUserList'); if (!list) return;
  setAdminMsg('Loading accounts…', 'info');
  list.innerHTML = '<div class="text-xs text-gray-500">Loading…</div>';
  let users = [];
  if (!SUPA.libReady()) { setAdminMsg(SUPA.connectionError(), 'error'); return; }
  users = await SUPA.listUsers();
  setAdminMsg(users.length ? '' : 'No accounts yet. Share your app link so members can request an account.');
  if (!users.length) { list.innerHTML = '<div class="text-xs text-gray-500">No accounts yet. Share your app link and users can request an account.</div>'; return; }
  list.innerHTML = users.map(function (u) { return adminRow(u); }).join('');
  lucide.createIcons();
}
function adminRow(u) {
  const st = u.status || 'pending';
  const badge = st === 'approved'
    ? '<span class="text-[9px] px-1.5 py-0.5 rounded bg-emerald-500 text-gray-900 font-bold">APPROVED</span>'
    : st === 'rejected'
    ? '<span class="text-[9px] px-1.5 py-0.5 rounded bg-red-500 text-white font-bold">REJECTED</span>'
    : '<span class="text-[9px] px-1.5 py-0.5 rounded bg-amber-500 text-gray-900 font-bold">PENDING</span>';
  const email = esc(u.email || '');
  const roleTag = u.role === 'admin' ? '<span class="text-[10px] text-amber-400 font-bold ml-1">ADMIN</span>' : '';
  const when = esc(String(u.created_at || u.createdAt || '').replace('T', ' ').slice(0, 16) || '—');
  let actions = '';
  if (st !== 'approved') {
    actions = '<button onclick="adminAct(\'approve\',\'' + esc(u.id || '').replace(/'/g, "\\'") + '\',\'' + email.replace(/'/g, "\\'") + '\')" class="px-2 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-[10px] font-bold">Approve</button> ';
  }
  if (st === 'pending') {
    actions += '<button onclick="adminAct(\'reject\',\'' + esc(u.id || '').replace(/'/g, "\\'") + '\',\'' + email.replace(/'/g, "\\'") + '\')" class="px-2 py-1 rounded bg-red-700/70 hover:bg-red-600 text-red-100 text-[10px] font-bold">Reject</button>';
  }
  return '<div class="flex items-center justify-between gap-2 py-2 border-b border-gray-700 last:border-0">' +
    '<div class="min-w-0"><div class="text-sm font-semibold truncate">' + email + roleTag + '</div>' +
    '<div class="text-[10px] text-gray-500">joined ' + when + '</div></div>' +
    '<div class="flex items-center gap-1.5 shrink-0">' + badge + actions + '</div></div>';
}
function setAdminMsg(text, type) {
  const el = $('adminMsg'); if (!el) return;
  el.textContent = text || '';
  const colors = { error: 'text-red-400', success: 'text-emerald-400', info: 'text-gray-400' };
  el.className = 'text-xs font-semibold mt-3 ' + (colors[type] || colors.info);
}
async function adminAct(action, id, email) {
  if (!id) { setAdminMsg('This account has no valid ID.', 'error'); return; }
  if (!SUPA.libReady()) { setAdminMsg(SUPA.connectionError(), 'error'); return; }
  const res = await SUPA.setAccountStatus(id, action === 'approve' ? 'approved' : 'rejected');
  const ok = !!(res && res.ok);
  setAdminMsg((res && (res.message || res.error)) || (ok ? (action === 'approve' ? 'Approved ' + email : 'Rejected ' + email) : 'Action failed.'), ok ? 'success' : 'error');
  await openAdminConsole();
}

/* ============================================================
   LEGACY DATA IMPORT — bring old browser ledger into the account
   ============================================================ */
async function maybeImportLegacy() {
  try {
    if (!authEmail()) return;
    const oldRaw = localStorage.getItem(STORAGE_KEY);
    if (!oldRaw) return;
    const newKey = companyStateKey();
    if (localStorage.getItem(newKey)) return;
    const ok = await Modal.confirm({ title: 'Import old data?', message: 'Found old browser ledger data. Import it into this account now?', okLabel: 'Import' });
    if (ok) {
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
/* Password reset UI */
if ($('forgotPwLink')) $('forgotPwLink').addEventListener('click', showResetPane);
if ($('authResetBtn')) $('authResetBtn').addEventListener('click', doAuthReset);
if ($('resetBackLink')) $('resetBackLink').addEventListener('click', function () { switchAuthTab('login'); });
if ($('resetEmail')) $('resetEmail').addEventListener('keydown', function (e) { if (e.key === 'Enter') doAuthReset(); });
if ($('authUpdatePwBtn')) $('authUpdatePwBtn').addEventListener('click', doUpdatePassword);
if ($('newPassword')) $('newPassword').addEventListener('keydown', function (e) { if (e.key === 'Enter') doUpdatePassword(); });
/* When the user follows a password-reset email, Supabase starts a "recovery"
   session; this app's copy opens showing a "set new password" pane — and keeps
   the auth screen in front of the app until the new password is saved. */
let __authRecovery = false;
if (SUPA.libReady()) {
  SUPA.onAuthState(function (event) {
    if (event === 'PASSWORD_RECOVERY') __authRecovery = true;
  });
}
switchAuthTab('login');
