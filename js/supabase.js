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
    const us = data && data.session && data.session.user;
    if (us) { this.user = { id: us.sub || us.id, email: us.email || '' }; }
    return this.user;
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

  /* ---- ledger read/write ---- */
  async saveLedger(userId, payload) {
    const sb = this.init(); if (!sb) return { error: 'unconfigured' };
    const now = new Date().toISOString();
    const { error } = await sb
      .from('ledgers').upsert({ user_id: userId, payload: payload, updated_at: now }, { onConflict: 'user_id' });
    return error ? { error: error.message } : { ok: true };
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
          { event: 'UPDATE', schema: 'public', table: 'ledgers', filter: 'user_id=eq.' + userId },
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
  async setAccountStatus(email, status) {
    const sb = this.init(); if (!sb) return { error: 'unconfigured' };
    const { error } = await sb.from('profiles')
      .update({ status: status }).eq('email', email);
    return error ? { error: error.message } : { ok: true };
  }
};