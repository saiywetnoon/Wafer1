/* ============================================================
   SUPABASE ADAPTER — real backend (Option B)
   ------------------------------------------------------------
   All Supabase calls are wrapped here. If SUPABASE_URL_wafer is empty
   (not configured yet) we return null/false so the app falls back
   to the legacy Apps-Script backend instead of crashing.

   Tables (see _supabase-setup.sql):
     profiles(id uuid pk, email text, role text, status text, created_at)
     ledgers  (user_id uuid pk, payload jsonb, updated_at timestamptz)
   Row-Level Security keeps each user's profile + ledger private.
   ============================================================ */

const SUPA = {
  client: null,
  user: null,      // { id, email }
  profile: { role: 'user', status: 'pending' },
  _hl: null,       // realtime listener handle
  _onAuth: null,   // auth-state-change callback

  /* True only when the dev has pasted URL + anon key in config.js. */
  configured() {
    const ready = !!(SUPABASE_URL_wafer && SUPABASE_ANON_KEY_wafer && window.supabase);
    return ready;
  },

  /* True when Supabase is configured AND its library actually loaded.
     Used everywhere the old code asked "is the Supabase backend active?" —
     the app is Supabase-only, so if the library is missing we must say so. */
  libReady() {
    return !!(SUPABASE_URL_wafer && SUPABASE_ANON_KEY_wafer && window.supabase);
  },

  /* Human-readable reason when the Supabase backend can't be used right now. */
  connectionError() {
    if (!SUPABASE_URL_wafer || !SUPABASE_ANON_KEY_wafer) {
      return 'This build is missing its Supabase URL/anon key (see js/config.js).';
    }
    if (!window.supabase) {
      return 'The Supabase connection couldn\u2019t load (network or ad-blocker?). Check your internet and reload.';
    }
    return 'Not connected to Supabase.';
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
  async resetPassword(email) {
    const sb = this.init(); if (!sb) return { error: 'Not configured' };
    // Sends a "Reset Your Password" email (requires the Supabase email template
    // to point back at this app's URL, e.g. http://localhost:5500/index.html).
    const { error } = await sb.auth.resetPasswordForEmail(email);
    return error ? { error: error.message } : { ok: true };
  },
  async updatePassword(newPassword) {
    const sb = this.init(); if (!sb) return { error: 'Not configured' };
    // Called after the user follows the reset link: the recovery session is
    // already active, so we can set the new password immediately.
    const { error } = await sb.auth.updateUser({ password: newPassword });
    return error ? { error: error.message } : { ok: true };
  },
  async signOut() {
    const sb = this.init(); if (!sb) return;
    try { await sb.auth.signOut(); } catch (e) { console.warn(e); }
  },

  /* ---- profile row (role + approval status) ---- */
  async getProfile() {
    const sb = this.init();
    const u = await this.sessionUser();
    if (!sb || !u) return null;
    const { data, error } = await sb
      .from('profiles').select('role,status').eq('id', u.id).maybeSingle();
    if (!error && data) this.profile = Object.assign(this.profile, data);
    return data && !error ? data : null;
  },
  /* On first sign-up the auth trigger creates a pending profile; here we
     read it. (Admin approvals are listed below.) */

  /* ---- ledger read/write ---- */
  async saveLedger(userId, payload) {
    const sb = this.init(); if (!sb) return { error: 'unconfigured' };
    // Never write with a stale/expired session: refresh the cached session and
    // bail loudly if it is gone, so a dead token surfaces as "sync failed —
    // retrying" instead of an invisible 401 that leaves data stuck on-device.
    let u = this.user;
    try { u = await this.sessionUser() || u; } catch (e) {}
    if (!u || !u.id) return { error: 'session expired — sign in again to sync' };
    const now = new Date().toISOString();
    const { error } = await sb
      .from('ledgers').upsert({ user_id: u.id, payload: payload, updated_at: now }, { onConflict: 'user_id' });
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
    const sb = this.init(); if (!sb) return null;
    const { data, error } = await sb
      .from('ledgers').select('payload,updated_at').eq('user_id', userId).maybeSingle();
    if (error || !data) return null;
    return { payload: data.payload, updatedAt: data.updated_at };
  },

  /* ---- realtime: other devices' edits arrive by themselves ---- */
  subscribeRealtime(userId, cb) {
    const sb = this.init(); if (!sb) return null;
    if (this._hl) { try { sb.removeChannel(this._hl); } catch (e) {} }
    const chan = sb.channel('led-' + userId)
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
