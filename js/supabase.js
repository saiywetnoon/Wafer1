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

   >>> v1.8.5 PRIVACY: each account owns its OWN private ledger row
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

  /* ---- ledger read/write: PRIVATE per account (v1.8.5 privacy fix) ---- */
  async saveLedger(userId, payload) {
    const sb = this.init(); if (!sb) return { error: 'unconfigured' };
    // Never write with a stale/expired session: refresh the cached session and
    // bail loudly if it is gone, so a dead token surfaces as "sync failed —
    // retrying" instead of an invisible 401 that leaves data stuck on-device.
    let u = this.user;
    try { u = await this.sessionUser() || u; } catch (e) {}
    if (!u || !u.id) return { error: 'session expired — sign in again to sync' };
    const now = new Date().toISOString();
    // v1.8.5: each user writes ONLY their own `ledgers` row (RLS also enforces
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
    // A NON-ADMIN always reads ONLY their own row — never the legacy shared
    // one. (A non-admin WITHOUT a row falls through to _adoptOrOwn, which the
    // DB answers with "empty"; it can never receive the owner's data.)
    const isAdminProfile = !!(this.profile && this.profile.role === 'admin');
    if (first && first.data && !isAdminProfile) {
      return { payload: first.data.payload, updatedAt: first.data.updated_at };
    }
    // Admin, or an account with no row yet: the DB decides. `ledger_adopt_shared`
    // is ADMIN-ONLY and prefers the legacy shared 'main' row when it exists
    // (it is the newest full copy — everything since the shared era), copying
    // it into the admin's own row and deleting 'main'.
    return await this._adoptOrOwn(userId, !!(first && first.data));
  },

  /* Decide the account's cloud copy after the own-row read:
       1. RPC `ledger_adopt_shared` present -> it ANSWERS authoritatively.
          A payload is delivered ONLY to the admin; a null payload means "this
          account has no data" (non-admin, or admin with nothing anywhere) —
          never fall through in that case.
       2. RPC missing (older database) -> fallback: ONLY the admin may read
          `shared_ledgers`; the admin copies 'main' over their own row when it
          exists, otherwise keeps their own row. A non-admin is never allowed
          to read/copy the shared row. */
  async _adoptOrOwn(userId, hasOwnRow) {
    const sb = this.init(); if (!sb) return { error: 'unconfigured' };
    const isAdminProfile = !!(this.profile && this.profile.role === 'admin');
    try {
      const rpc = await sb.rpc('ledger_adopt_shared', { p_workspace_id: this.workspaceId });
      if (rpc) {
        if (rpc.error) {
          if (/PGRST202|function.*not.*found/i.test(String(rpc.error.message || rpc.error.code || ''))) {
            /* RPC not deployed yet — fall through to the admin-only copy below */
          } else {
            return { error: String(rpc.error.message || rpc.error.code || 'adopt failed') };
          }
        } else {
          // Authoritative answer. Even a null payload is final — do NOT fall
          // through, because falling through would re-read the shared row.
          if (rpc.data && rpc.data.payload) {
            // A payload from the RPC is a legacy adoption only when this account
            // had NO own row before (a fresh account taking 'main', or a plain
            // own row for an admin with nothing newer in the shared row).
            return { payload: rpc.data.payload, updatedAt: rpc.data.updated_at || null, legacy: !hasOwnRow };
          }
          return null;
        }
      }
    } catch (e) { /* RPC unavailable — fall through to the safe copy below */ }

    // Fallback (RPC missing): ADMIN ONLY. Non-admins may never touch it.
    if (!isAdminProfile) return null;
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
      if (!/no rows|PGRST116|406|not found/i.test(msg)) return { error: msg };
    }
    // Nothing left in the legacy shared row -> keep the admin's own row.
    const own = await sb.from('ledgers')
      .select('payload,updated_at').eq('user_id', userId).maybeSingle();
    if (own && !own.error && own.data) return { payload: own.data.payload, updatedAt: own.data.updated_at };
    if (own && own.error) {
      const msg2 = String((own.error && (own.error.message || own.error.code)) || 'read failed');
      if (!/no rows|PGRST116|406|not found/i.test(msg2)) return { error: msg2 };
    }
    return null; // confirmed empty — this account has no ledger yet
  },

  /* ---- realtime: OTHER DEVICES of THE SAME ACCOUNT appear by themselves ----
     v1.8.5: watch only THIS user's private row (`ledgers`), so an edit by a
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
  },
  /* Role / permission change (v1.14.0): promote a user to admin, or demote an
     admin back to user. Goes through the `profile_set_role` RPC because the
     profiles table is deliberately write-locked — the function re-checks the
     caller is an admin and refuses to demote the LAST admin. */
  async setUserRole(id, role) {
    const sb = this.init(); if (!sb) return { error: 'unconfigured' };
    if (role !== 'admin' && role !== 'user') return { error: 'Invalid role.' };
    const { data, error } = await sb.rpc('profile_set_role', { p_user_id: id, p_role: role });
    if (error) return { error: String((error && (error.message || error.code)) || 'role update failed') };
    return { ok: true, data: data };
  }
};
