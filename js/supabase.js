/* ============================================================
   SUPABASE ADAPTER — real backend (Option B)
   ------------------------------------------------------------
   All Supabase calls are wrapped here. If SUPABASE_URL_wafer is empty
   (not configured yet) we return null/false so the app falls back
   to the legacy Apps-Script backend instead of crashing.

   Tables (see _supabase-setup.sql):
     profiles(id uuid pk, email text, role text, status text, created_at)
     ledgers(user_id uuid pk, payload jsonb, updated_at timestamptz)   <- ACTIVE store
     shared_ledgers(workspace_id text pk, ...)                         <- LEGACY only

   >>> v1.9 PRIVACY: each account owns its OWN private ledger row
   (`ledgers.user_id = auth.uid()`, enforced by RLS in the database).
   `shared_ledgers` is no longer read/written for live data — it is kept
   ONLY as a one-time migration source for the old shared data.
   This is what stops "a new account sees someone else's data".
   ============================================================ */

const SUPA = {
  client: null,
  user: null,      // { id, email }
  profile: { role: 'user', status: 'pending' },
  _hl: null,       // realtime listener handle
  _onAuth: null,   // auth-state-change callback
  workspaceId: 'main', // legacy shared row id (migration source only)

  /* True only when the dev has pasted URL + anon key in config.js. */
  configured() {
    const ready = !!(SUPABASE_URL_wafer && SUPABASE_ANON_KEY_wafer && window.supabase);
    return ready;
  },

  /* Lazy-initialise the Supabase client + reflect auth state. */
  init() {
    if (this.client) return this.client;
    if (!this.configured()) return null;
    const sb = window.supabase.createClient(SUPABASE_URL_wafer, SUPABASE_ANON_KEY_wafer, {
      auth: { persistSession: true, autoRefreshToken: true }
    });
    this.client = sb;
    const self = this;
    sb.auth.onAuthStateChange(function (event, session) {
      const u = session && session.user
        ? { id: session.user.sub || session.user.id, email: session.user.email || '' }
        : null;
      self.user = u;
      if (!u) { self.profile = { role: 'user', status: 'pending' }; }
      if (self._onAuth) {
        try { self._onAuth(event, u); } catch (e) { console.warn(e); }
      }
    });
    return sb;
  },

  async sessionUser() {
    const sb = this.init();
    if (!sb) return null;
    const { data, error } = await sb.auth.getSession();
    if (error) { console.warn('supabase session error', error); return null; }
    const us = data && data.session && data.session.user
      ? { id: data.session.user.sub || data.session.user.id, email: data.session.user.email || '' }
      : null;
    // When no session exists, CLEAR the cached user — returning a stale cached
    // id here is what silently turned "no session" into hours of 401 rejects.
    this.user = us;
    return us;
  },

  /* Keep me in sync when auth changes (login/logout). */
  onAuthState(cb) { this._onAuth = cb; },
  updateProfile(p) { this.profile = Object.assign(this.profile, p); },

  /* ---- auth actions ---- */
  async signUp(email, password) {
    const sb = this.init(); if (!sb) return { error: 'SUPABASE_NOT_CONFIGURED' };
    return sb.auth.signUp({ email: email, password: password });
  },
  async signIn(email, password) {
    const sb = this.init(); if (!sb) return { error: 'SUPABASE_NOT_CONFIGURED' };
    return sb.auth.signInWithPassword({ email: email, password: password });
  },
  async signOut() {
    const sb = this.init(); if (!sb) return;
    try { await sb.auth.signOut(); } catch (e) { console.warn(e); }
  },

  /* ---- password recovery ---- */
  async resetPassword(email) {
    const sb = this.init(); if (!sb) return { error: 'SUPABASE_NOT_CONFIGURED' };
    const r = await sb.auth.resetPasswordForEmail(String(email || '').trim());
    return (r && r.error) ? { error: r.error.message || 'reset failed' } : { ok: true };
  },
  async updatePassword(password) {
    const sb = this.init(); if (!sb) return { error: 'SUPABASE_NOT_CONFIGURED' };
    const r = await sb.auth.updateUser({ password: String(password || '') });
    return (r && r.error) ? { error: r.error.message || 'update failed' } : { ok: true };
  },

  /* ---- profile row (role + approval status) ---- */
  async getProfile() {
    const sb = this.init();
    const u = await this.sessionUser();
    if (!sb || !u) return null;
    const { data, error } = await sb
      .from('profiles').select('role,status').eq('id', u.id).maybeSingle();
    if (!error && data) this.profile = this.profile = Object.assign(this.profile, data);
    return data && !error ? data : null;
  },
  /* On first sign-up the auth trigger creates a pending profile; here we
     read it. (Admin approvals are listed below.) */

  /* ---- ledger read/write: PRIVATE per account (v1.9 privacy fix) ---- */
  async saveLedger(userId, payload) {
    const sb = this.init(); if (!sb) return { error: 'unconfigured' };
    // Never write with a stale/expired session: refresh the cached session and
    // bail loudly if it is gone, so a dead token surfaces as "sync failed —
    // retrying" instead of an invisible 401 that leaves data stuck on-device.
    let u = this.user;
    try { u = await this.sessionUser() || u; } catch (e) {}
    if (!u || !u.id) return { error: 'session expired — sign in again to sync' };
    const now = new Date().toISOString();
    // v1.9: each user writes ONLY their own `ledgers` row (RLS also enforces
    // auth.uid() = user_id). The old shared_ledgers row is never written now —
    // that per-account separation is what stops account A from clobbering a
    // different account B's business data.
    const { error } = await sb
      .from('ledgers').upsert({ user_id: userId, payload: payload, updated_at: now }, { onConflict: 'user_id' });
    if (error) {
      const msg = String((error && (error.message || error.code)) || 'write failed');
      // If the backend says our token is bad, confirm it server-side and drop
      // the cached session so the app stops pretending to be logged in.
      if (/jwt|401|403|unauthor|expired|token/i.test(msg)) {
        try {
          const g = await sb.auth.getUser();
          if (g && (g.error || !g.data || !g.data.user)) this.user = null;
        } catch (e) { this.user = null; }
      }
      return { error: msg };
    }
    return { ok: true };
  },
  async getLedger(userId) {
    const sb = this.init(); if (!sb) return { error: 'unconfigured' };
    // Read ONLY this account's own row. A row with `.error` means the READ
    // FAILED — never mistake that for "cloud is empty" (an old bug let a
    // device push its local copy OVER a populated cloud it couldn't read).
    const readOwn = async function () {
      return await sb
        .from('ledgers').select('payload,updated_at').eq('user_id', userId).maybeSingle();
    };
    const first = await readOwn();
    if (first && first.error) {
      const msg = String((first.error && (first.error.message || first.error.code)) || 'read failed');
      if (/no rows|PGRST116|406|not found/i.test(msg)) return null;
      // Expired/invalid session: heal the token via getUser() and retry ONCE.
      if (/jwt|401|403|unauthor|expired|token/i.test(msg)) {
        try {
          const g = await sb.auth.getUser();
          if (g && !g.error && g.data && g.data.user) {
            const retried = await readOwn();
            if (retried && !retried.error) {
              const row = retried.data;
              if (row) return { payload: row.payload, updatedAt: row.updated_at };
              return null; // confirmed empty AFTER the token was healed
            }
            return { error: msg };
          }
          // Refresh token dead: keep `this.user` so cloudAfterSignIn keeps
          // retrying and surfaces "sign in again" honestly.
          return { error: 'session expired — sign in again to sync' };
        } catch (e) {
          return { error: 'session expired — sign in again to sync' };
        }
      }
      return { error: msg };
    }
    if (first && first.data) return { payload: first.data.payload, updatedAt: first.data.updated_at };

    // v1.9 ONE-TIME ADOPTION — the account has no row yet. If the OLD shared
    // workspace row still exists, the DB function `ledger_adopt_shared` copies
    // it into THIS account's private row AND deletes the shared row (atomic,
    // security-definer). So the FIRST account to open after the upgrade gets
    // the legacy data; every account after that starts EMPTY — this is what
    // stops a newly registered account from loading someone else's data.
    try {
      const rpc = await sb.rpc('ledger_adopt_shared', { p_workspace_id: this.workspaceId });
      if (rpc && rpc.data && rpc.data.payload) {
        return { payload: rpc.data.payload, updatedAt: rpc.data.updated_at || null, legacy: true };
      }
      if (rpc && rpc.error && !/PGRST202|function.*not.*found/i.test(String(rpc.error.message || rpc.error.code || ''))) {
        return { error: String(rpc.error.message || rpc.error.code || 'adopt failed') };
      }
    } catch (e) { /* RPC unavailable — fall through to the safe copy below */ }

    // Fallback for databases where the v1.9 adoption RPC has not been created
    // yet: copy the shared payload into this account's row (no delete). Once
    // the owner runs the upgrade SQL and opens the app again, the RPC path
    // takes over and removes the shared row.
    const shared = await sb.from('shared_ledgers')
      .select('payload,updated_at').eq('workspace_id', this.workspaceId).maybeSingle();
    if (shared && !shared.error && shared.data && shared.data.payload) {
      const adopt = await sb.from('ledgers').upsert(
        { user_id: userId, payload: shared.data.payload, updated_at: new Date().toISOString() },
        { onConflict: 'user_id' }
      );
      if (!adopt || !adopt.error) {
        return { payload: shared.data.payload, updatedAt: shared.data.updated_at, legacy: true };
      }
      return { error: String((adopt.error && (adopt.error.message || adopt.error.code)) || 'adopt failed') };
    }
    if (shared && shared.error) {
      const msg = String((shared.error && (shared.error.message || shared.error.code)) || 'read failed');
      if (/no rows|PGRST116|406|not found/i.test(msg)) return null;
      return { error: msg };
    }
    return null; // confirmed empty — this account has no ledger yet
  },

  /* ---- realtime: OTHER DEVICES of THE SAME ACCOUNT appear by themselves ----
     v1.9: watch only THIS user's private row (`ledgers`), so an edit by a
     different account NEVER arrives here. */
  subscribeRealtime(userId, cb) {
    const sb = this.init(); if (!sb) return null;
    if (this._hl) { try { sb.removeChannel(this._hl); } catch (e) {} }
    const chan = sb.channel('my-led-' + userId)
      .on('postgres_changes',
          { event: '*', schema: 'public', table: 'ledgers', filter: 'user_id=eq.' + userId },
          function (payload) { if (cb) { try { cb(payload.new); } catch (e) {} } })
      .subscribe();
    this._hl = chan;
    return chan;
  },
  unsubscribeRealtime() {
    const sb = this.init();
    if (sb && this._hl) { try { sb.removeChannel(this._hl); } catch (e) {} this._hl = null; }
  },

  /* ---- admin (owner) — list/approve pending accounts ---- */
  async isAdmin() { const p = await this.getProfile(); return !!(p && p.role === 'admin'); },
  async listUsers() {
    const sb = this.init(); if (!sb) return [];
    const { data, error } = await sb.from('profiles')
      .select('id,email,status,role,created_at').order('created_at', { ascending: false });
    return error ? [] : (data || []);
  },
  async setAccountStatus(id, status) {
    const sb = this.init(); if (!sb) return { error: 'unconfigured' };
    if (!['approved', 'rejected'].includes(status)) return { error: 'Invalid account status.' };
    const { error } = await sb.from('profiles')
      .update({ status: status }).eq('id', id);
    return error ? { error: error.message } : { ok: true };
  }
};
