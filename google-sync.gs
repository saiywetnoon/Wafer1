/**
 * Daily Crispy Roll Ledger — Google Apps Script
 * =============================================
 * Deploy this script as a Web App:
 *   1. Create a Google Sheet → Extensions → Apps Script
 *   2. Paste this entire file
 *   3. Set the CONFIG constants below
 *   4. Deploy → New deployment → Web app
 *      - Execute as: Me
 *      - Who has access: Anyone (or Anyone with a Google account)
 *   5. Copy the Web App URL into the Daily Crispy Roll Ledger app:
 *      - "Google Sheets Apps Script URL" field
 *
 * Actions supported (POST body JSON):
 *   { action: 'save',    payload: { app, exportedAt, state } }  → write to Sheet + state sheet
 *   { action: 'backup',  payload: { app, exportedAt, state } }  → store JSON snapshot to Drive
 *   { action: 'list' }                                          → list Drive backups
 *   { action: 'restore', fileName: '...' }                      → read a Drive backup
 *   { action: 'clear' }                                         → clear the LEDGER sheet
 *
 * GET:
 *   ?action=get  → read full state from the state sheet
 */

/* ============================================================
   CONFIG — EDIT THESE
   ============================================================ */

// ID of a Google Drive folder to store JSON backups.
// Leave string empty ('') to disable Drive backup on this deployment.
const DRIVE_FOLDER_ID = '';

// Hidden sheet name used for JSON state storage (created automatically).
const STATE_SHEET_NAME = 'LedgerState';

// Range cap enforced on the sheet append to avoid blowing A1 limits.
const MAX_ROWS_PER_SYNC = 10000;

// Keep only the most recent N backups in the Drive folder (rotation).
const MAX_BACKUPS_KEPT = 10;

// Prefix used to identify this app's backup files in the Drive folder.
const BACKUP_PREFIX = 'crispy-roll-ledger-backup-';

// Hidden sheet name used for the multi-tenant cloud registry.
// One row per verified Google account (email | exportedAt | payload).
const ACCOUNTS_SHEET_NAME = 'CloudAccounts';

// OPTIONAL strict check: when non-empty, the Google ID token's "aud" claim
// must equal this (your Google OAuth client ID) before the request is
// accepted. Safer to set it; the app works either way.
const APP_CLIENT_ID = '';

/* ============================================================
   ACCOUNTS (email + password) — sign up with admin approval
   ============================================================
   Every account is saved in a hidden "Users" sheet on this server:
     email | salt | hash | token | status | role | createdAt |
     lastLogin | failed | lockUntil
   - status: pending → approved → rejected (admin decides)
   - role:   'user' or 'admin'
   - passwords are NEVER stored; only a salted SHA-256 hash.
   - Set ADMIN_EMAILS below to make those accounts auto-approved
     with the admin role (that's you — do this BEFORE first use).
   - All ledger data actions are scoped to the signed-in account,
     so user A can never read or write user B's ledger.
   ============================================================ */
const USERS_SHEET_NAME = 'Users';

// Accounts you own. On signing up, these are auto-approved as
// admins. Add YOUR email here before you (or anyone) signs up.
// Example: const ADMIN_EMAILS = ['owner@gmail.com'];
const ADMIN_EMAILS = [];

// OPTIONAL sign-up restrictions (leave empty to allow anyone to
// request an account). Example:
//   ALLOWED_DOMAINS = ['gmail.com'];   // only @gmail.com
//   ALLOWED_EMAILS  = ['a@x.com','b@x.com']; // only these exact emails
const ALLOWED_DOMAINS = [];
const ALLOWED_EMAILS = [];

const MIN_PASSWORD_LEN = 6;
const MAX_LOGIN_FAILS = 5;          // 5 wrong passwords…
const LOCK_MINUTES = 15;            // …locks the account for 15 minutes
const SESSION_TTL_DAYS = 60;        // force re-login after 60 days

/* ============================================================
   WEB APP ENTRY — doPost / doGet
   ============================================================ */

/**
 * Receives JSON POSTs from the ledger.
 * NOTE: The browser sends Content-Type: text/plain to avoid CORS
 * preflight; the body is still valid JSON in e.postData.contents.
 */
function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    const action = body.action || 'save';
    const payload = body.payload || null;
    const token = body.token || '';
    const idToken = body.idToken || '';

    // ---- ACCOUNT ACTIONS (no session required) ---------------------------
    if (action === 'signup') return json_(signupAccount_(body));
    if (action === 'login')  return json_(loginAccount_(body));
    if (action === 'logout') return json_(logoutAccount_(token));
    if (action === 'me')     return json_(me_(token));

    // ---- ADMIN ACTIONS (admin session required) --------------------------
    if (action === 'listUsers' || action === 'approve' || action === 'reject') {
      return json_(adminAction_(action, token, body));
    }

    // ---- DATA ACTIONS (session or legacy Google id token required) -------
    // The account that owns the session token is the ONLY account the
    // request may read or write. User A can never reach user B's row.
    const auth = resolveAnyAuth_(token, idToken);
    if (!auth.email) {
      return json_({ ok: false, message: 'Please sign in to access your data.' });
    }

    if (action === 'save') {
      if (!payload) return json_({ ok: false, message: 'Missing payload.' });
      return json_(setCloudState_(auth.email, payload));
    }
    if (action === 'backup') {
      if (!payload) return json_({ ok: false, message: 'Missing payload.' });
      return json_(saveBackupToCloud_(auth.email, payload));
    }
    if (action === 'list') return json_(listCloudBackups_(auth.email));
    if (action === 'restore') {
      if (!body.fileName) return json_({ ok: false, message: 'Missing fileName.' });
      return json_(readCloudBackup_(auth.email, body.fileName));
    }
    if (action === 'clear') return json_(clearCloudState_(auth.email));
    return json_({ ok: false, message: 'Unknown action: ' + action });
  } catch (err) {
    console.error('doPost error: ' + err);
    return json_({ ok: false, message: 'Error: ' + err });
  }
}

/**
 * Receives GET requests:
 *   ?action=get
 */
function doGet(e) {
  try {
    const action = e && e.parameter && e.parameter.action ? e.parameter.action : '';
    const token = (e && e.parameter && e.parameter.token) || '';
    const idToken = (e && e.parameter && e.parameter.idToken) || '';
    if (action === 'get') {
      // Read the signed-in account's OWN stored state (scoped + verified).
      const auth = resolveAnyAuth_(token, idToken);
      if (!auth.email) {
        return json_({ ok: false, message: 'Please sign in to access your data.' });
      }
      const p = getCloudState_(auth.email);
      if (!p) return json_({ ok: false, message: 'No data for this account yet.', payload: null });
      return json_({ ok: true, payload: p });
    }
    return json_({ ok: false, message: 'Unknown action.' });
  } catch (err) {
    console.error('doGet error: ' + err);
    return json_({ ok: false, message: 'Error: ' + err });
  }
}

/* ============================================================
   CORE — Google Sheets persistence
   ============================================================ */

function getDataSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName('LEDGER');
  if (!sheet) sheet = ss.insertSheet('LEDGER');
  return sheet;
}

function getStateSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(STATE_SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(STATE_SHEET_NAME);
  return sheet;
}

function ensureHeaders_(sheet) {
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(['Date', 'Ingredient Cost (Ks)', 'Additional Cost (Ks)', 'Capital (Ks)', 'Bags Produced', 'Pieces', 'Bags Sold', 'Price/Bag', 'Revenue (Ks)', 'Labor Min', 'Labor Cost', 'Net Gain', 'Net After Labor', 'Mix Weight (g)', 'UsageJSON']);
  }
}

/**
 * Saves every entry as one row in the LEDGER sheet,
 * and stores the full state JSON in the LedgerState sheet.
 */
function saveToSheet_(payload) {
  const state = payload.state || {};
  const entries = state.entries || {};

  const sheet = getDataSheet_();
  ensureHeaders_(sheet);

  // Clear existing data rows (preserve header)
  if (sheet.getLastRow() > 1) {
    sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).clearContent();
  }

  const dates = Object.keys(entries).sort();
  const rows = [];

  dates.forEach(function (d) {
    const e = entries[d] || {};
    const ingCost = (Number(e.capital) || 0) - (Number(e.additionalCost) || 0);
    rows.push([
      d,
      Math.round(ingCost),
      Number(e.additionalCost) || 0,
      Number(e.capital) || 0,
      Number(e.bagsProduced) || 0,
      Number(e.pieces) || 0,
      Number(e.bagsSold) || 0,
      Number(e.price) || 0,
      Number(e.revenue) || 0,
      Number(e.laborMinutes) || 0,
      Number(e.laborCost) || 0,
      Number(e.net) || 0,
      Number(e.netAfterLabor) || 0,
      Number(e.mixWeight) || 0,
      JSON.stringify(e.usage || {})
    ]);
  });

  // Cap the rows for the sheet write
  const capped = rows.length > MAX_ROWS_PER_SYNC ? rows.slice(0, MAX_ROWS_PER_SYNC) : rows;
  if (capped.length > 0) {
    sheet.getRange(2, 1, capped.length, 15).setValues(capped);
  }

  // Persist the full payload (state + optional draft) on the hidden state sheet
  const stateSheet = getStateSheet_();
  stateSheet.getRange('A1').setValue('exportedAt');
  stateSheet.getRange('B1').setValue(payload.exportedAt || new Date().toISOString());
  stateSheet.getRange('A2').setValue('app');
  stateSheet.getRange('B2').setValue(payload.app || '');
  stateSheet.getRange('A4').setValue('payload');
  stateSheet.getRange('B4').setValue(JSON.stringify({
    app: payload.app || 'daily-crispy-roll-ledger',
    exportedAt: payload.exportedAt || new Date().toISOString(),
    state: state,
    draft: payload.draft || null
  }));

  return {
    ok: true,
    message: 'Synced ' + capped.length + ' day(s) to the Google Sheet.',
    rowCount: capped.length,
    exportedAt: payload.exportedAt
  };
}

function readFromLedger_() {
  const stateSheet = getStateSheet_();
  const stateJson = stateSheet.getRange('B4').getValue();

  // Prefer the full JSON payload if it exists (newer format stores {state, draft})
  if (stateJson) {
    const parsed = JSON.parse(stateJson);
    if (parsed && parsed.state) {
      return {
        app: parsed.app || 'daily-crispy-roll-ledger',
        exportedAt: parsed.exportedAt || stateSheet.getRange('B1').getValue(),
        state: parsed.state,
        draft: parsed.draft ? parsed.draft : null
      };
    }
    // Legacy: B4 was the full state object itself
    return { app: 'daily-crispy-roll-ledger', exportedAt: stateSheet.getRange('B1').getValue(), state: parsed, draft: null };
  }

  // Fallback: if the JSON state sheet is empty, parse sheet rows.
  // Column order (0-indexed):
  // 0 Date, 1 Ingredient Cost, 2 Additional Cost, 3 Capital, 4 Bags Produced,
  // 5 Pieces, 6 Bags Sold, 7 Price/Bag, 8 Revenue, 9 Labor Min, 10 Labor Cost,
  // 11 Net Gain, 12 Net After Labor, 13 Mix Weight, 14 UsageJSON
  const sheet = getDataSheet_();
  ensureHeaders_(sheet);
  if (sheet.getLastRow() < 2) return null;
  const last = sheet.getLastRow();
  const values = sheet.getRange(2, 1, last - 1, 15).getValues();
  const entries = {};
  values.forEach(function (r) {
    if (!r[0]) return;
    let usage = {};
    try { usage = JSON.parse(r[14] || '{}'); } catch (err) { usage = {}; }
    entries[r[0]] = {
      id: 'sheet-' + r[0],
      date: r[0],
      additionalCost: Number(r[2]) || 0,
      capital: Number(r[3]) || 0,
      bagsProduced: Number(r[4]) || 0,
      pieces: Number(r[5]) || 0,
      bagsSold: Number(r[6]) || 0,
      price: Number(r[7]) || 0,
      revenue: Number(r[8]) || 0,
      laborMinutes: Number(r[9]) || 0,
      laborCost: Number(r[10]) || 0,
      net: Number(r[11]) || 0,
      netAfterLabor: Number(r[12]) || 0,
      mixWeight: Number(r[13]) || 0,
      usage: usage
    };
  });
  return {
    app: 'daily-crispy-roll-ledger',
    exportedAt: new Date().toISOString(),
    state: { entries: entries }
  };
}

function clearSheet_() {
  const sheet = getDataSheet_();
  if (sheet.getLastRow() > 1) {
    sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).clearContent();
  }
  return { ok: true, message: 'Ledger sheet cleared.' };
}

/* ============================================================
   CORE — Google Drive backup (Google storage)
   ============================================================ */

function saveBackupToDrive_(payload) {
  if (!DRIVE_FOLDER_ID) throw new Error('DRIVE_FOLDER_ID is not set.');

  const folder = DriveApp.getFolderById(DRIVE_FOLDER_ID);
  const stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd_HH-mm-ss');
  const title = BACKUP_PREFIX + stamp + '.json';
  const file = folder.createFile(title, JSON.stringify(payload, null, 2), MimeType.PLAIN_TEXT);

  // Rotate: delete oldest backups beyond MAX_BACKUPS_KEPT
  try {
    const files = folder.getFiles();
    const all = [];
    while (files.hasNext()) {
      const f = files.next();
      if (f.getName().indexOf(BACKUP_PREFIX) === 0) all.push(f);
    }
    if (all.length > MAX_BACKUPS_KEPT) {
      all.sort(function (a, b) {
        const na = parseInt(a.getName().replace(new RegExp(BACKUP_PREFIX + '|\\.json', 'g'), '').replace(/[-_]/g, ''), 10);
        const nb = parseInt(b.getName().replace(new RegExp(BACKUP_PREFIX + '|\\.json', 'g'), '').replace(/[-_]/g, ''), 10);
        return na - nb; // oldest first
      });
      const toDelete = all.length - MAX_BACKUPS_KEPT;
      for (let i = 0; i < toDelete; i++) {
        try { all[i].setTrashed(true); } catch (e) { console.warn('Failed to trash backup: ' + e); }
      }
    }
  } catch (err) {
    console.warn('Backup rotation skipped: ' + err);
  }

  return {
    ok: true,
    message: 'Backup stored to Google Drive: ' + title,
    fileId: file.getId(),
    fileName: title
  };
}

function listDriveBackups_() {
  if (!DRIVE_FOLDER_ID) throw new Error('DRIVE_FOLDER_ID is not set.');
  const folder = DriveApp.getFolderById(DRIVE_FOLDER_ID);
  const files = folder.getFiles();
  const list = [];
  while (files.hasNext()) {
    const f = files.next();
    if (f.getName().indexOf(BACKUP_PREFIX) === 0) {
      list.push({ fileName: f.getName(), id: f.getId(), size: f.getSize(), created: f.getDateCreated().toISOString() });
    }
  }
  list.sort(function (a, b) { return b.fileName.localeCompare(a.fileName); }); // newest first
  return { ok: true, backups: list };
}

function readDriveBackup_(fileName) {
  if (!DRIVE_FOLDER_ID) throw new Error('DRIVE_FOLDER_ID is not set.');
  const folder = DriveApp.getFolderById(DRIVE_FOLDER_ID);
  const files = folder.getFilesByName(fileName);
  if (!files.hasNext()) return { ok: false, message: 'Backup not found: ' + fileName };
  const file = files.next();
  const content = file.getBlob().getDataAsString();
  let parsed;
  try { parsed = JSON.parse(content); } catch (err) { return { ok: false, message: 'Backup file is not valid JSON.' }; }
  return { ok: true, payload: parsed };
}

/* ============================================================
   Helpers
   ============================================================ */

/* ============================================================
   CLOUD — multi-tenant (per Google account)
   ============================================================ */

/** Verify a Google ID token server-side. Returns { email } or { email: '' }. */
function resolveAccount_(idToken) {
  if (!idToken) return { email: '' };
  try {
    const url = 'https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(idToken);
    const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) return { email: '' };
    const j = JSON.parse(res.getContentText());
    if (!j || !j.email || j.email_verified !== true) return { email: '' };
    if (APP_CLIENT_ID && j.aud && j.aud !== APP_CLIENT_ID) return { email: '' };
    return { email: String(j.email).toLowerCase() };
  } catch (err) {
    console.warn('resolveAccount_ failed: ' + err);
    return { email: '' };
  }
}

function getCloudSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let s = ss.getSheetByName(ACCOUNTS_SHEET_NAME);
  if (!s) {
    s = ss.insertSheet(ACCOUNTS_SHEET_NAME);
    s.appendRow(['email', 'exportedAt', 'payload']);
  }
  return s;
}

function cloudRowEmail_(email) {
  const s = getCloudSheet_();
  const last = s.getLastRow();
  if (last < 1) return -1;
  const vals = s.getRange(2, 1, last, 1).getValues();
  for (let i = 0; i < last; i++) {
    if (String(vals[i][0] || '').toLowerCase() === email) return i + 2;
  }
  return -1;
}

function setCloudState_(email, payload) {
  const s = getCloudSheet_();
  const idx = cloudRowEmail_(email);
  const exportedAt = payload && payload.exportedAt ? payload.exportedAt : new Date().toISOString();
  const data = [email, exportedAt, JSON.stringify(payload)];
  if (idx > 0) s.getRange(idx, 1, 1, 3).setValues([data]);
  else s.appendRow(data);
  return { ok: true, message: 'Cloud state saved for ' + email + '.' };
}

function getCloudState_(email) {
  const s = getCloudSheet_();
  const idx = cloudRowEmail_(email);
  if (idx < 0) return null;
  const row = s.getRange(idx, 1, 1, 3).getValues()[0];
  try {
    const p = JSON.parse(row[2]);
    return {
      app: p.app || 'daily-crispy-roll-ledger',
      exportedAt: row[1] || p.exportedAt || new Date().toISOString(),
      state: p.state,
      draft: p.draft ? p.draft : null
    };
  } catch (err) {
    return null;
  }
}

function clearCloudState_(email) {
  const s = getCloudSheet_();
  const idx = cloudRowEmail_(email);
  if (idx > 0) s.getRange(idx, 1, 1, 3).clearContent();
  return { ok: true, message: 'Cloud state cleared for ' + email + '.' };
}

/* ============================================================
   ACCOUNTS — sign up / log in / sessions / admin approval
   ============================================================ */

function getUsersSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let s = ss.getSheetByName(USERS_SHEET_NAME);
  if (!s) {
    s = ss.insertSheet(USERS_SHEET_NAME);
    s.appendRow(['email', 'salt', 'hash', 'token', 'status', 'role', 'createdAt', 'lastLogin', 'failed', 'lockUntil']);
  }
  return s;
}

function userRow_(email) {
  const s = getUsersSheet_();
  const last = s.getLastRow();
  if (last < 1) return -1;
  const vals = s.getRange(2, 1, last, 1).getValues();
  for (let i = 0; i < last; i++) {
    if (String(vals[i][0] || '').toLowerCase() === String(email).toLowerCase()) return i + 2;
  }
  return -1;
}

function sha256Hex_(str) {
  const digest = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    String(str),
    Utilities.Charset.UTF_8
  );
  return digest.map(function (b) {
    const v = b < 0 ? b + 256 : b;
    return ('0' + v.toString(16)).slice(-2);
  }).join('');
}
function hashPassword_(salt, password) { return sha256Hex_(salt + '::' + password); }
function makeSalt_() { return Utilities.getUuid(); }
function makeToken_() { return (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, ''); }

/** Validate an account session token. Returns { email, role } or { email: '' }. */
function resolveAccountByToken_(token) {
  if (!token) return { email: '' };
  const s = getUsersSheet_();
  const last = s.getLastRow();
  if (last < 1) return { email: '' };
  const vals = s.getRange(2, 1, last, 10).getValues();
  for (let i = 0; i < last; i++) {
    if (String(vals[i][3] || '') === String(token)) {
      const status = String(vals[i][4] || 'pending');
      if (status !== 'approved') return { email: '' };
      const lastLogin = vals[i][7] ? Date.parse(vals[i][7]) : 0;
      if (SESSION_TTL_DAYS > 0 && lastLogin && (Date.now() - lastLogin > SESSION_TTL_DAYS * 86400000)) {
        s.getRange(i + 2, 4).setValue(''); // expired -> revoke
        return { email: '' };
      }
      return { email: String(vals[i][0]).toLowerCase(), role: String(vals[i][5] || 'user') };
    }
  }
  return { email: '' };
}

/** Session token first (new accounts), legacy Google id token second. */
function resolveAnyAuth_(token, idToken) {
  if (token) {
    const a = resolveAccountByToken_(token);
    if (a.email) return a;
  }
  if (idToken) {
    const b = resolveAccount_(idToken);
    if (b.email) return b;
  }
  return { email: '' };
}

function signupAccount_(body) {
  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, message: 'Enter a valid email address.' };
  if (password.length < MIN_PASSWORD_LEN) {
    return { ok: false, message: 'Password must be at least ' + MIN_PASSWORD_LEN + ' characters.' };
  }
  if (ALLOWED_EMAILS.length && ALLOWED_EMAILS.indexOf(email) === -1) {
    return { ok: false, message: 'Sign-ups are restricted to approved emails. Contact the app owner.' };
  }
  if (ALLOWED_DOMAINS.length) {
    const dom = String(email.split('@')[1] || '').toLowerCase();
    const allowed = ALLOWED_DOMAINS.map(function (d) { return String(d).toLowerCase(); });
    if (allowed.indexOf(dom) === -1) {
      return { ok: false, message: 'Sign-ups are restricted to allowed email domains. Contact the app owner.' };
    }
  }
  const s = getUsersSheet_();
  if (userRow_(email) > 0) {
    return { ok: false, message: 'An account with this email already exists. Sign in instead.' };
  }
  const salt = makeSalt_();
  const hash = hashPassword_(salt, password);
  const admins = ADMIN_EMAILS.map(function (a) { return String(a).toLowerCase(); });
  // First account ever created = the owner (auto admin). Otherwise admins
  // come from ADMIN_EMAILS. Everyone else starts as 'pending'.
  const isFirst = s.getLastRow() <= 1;
  const isAdmin = admins.indexOf(email) !== -1 || isFirst;
  s.appendRow([email, salt, hash, '', isAdmin ? 'approved' : 'pending', isAdmin ? 'admin' : 'user',
    new Date().toISOString(), '', '0', '']);
  return {
    ok: true,
    status: isAdmin ? 'approved' : 'pending',
    role: isAdmin ? 'admin' : 'user',
    message: isAdmin
      ? 'Admin account created. You can sign in now.'
      : 'Account created — it is awaiting admin approval. You will be able to sign in once the owner approves it.'
  };
}

/* ---------- Per-account Drive backups ---------- */
function cloudFolder_(email) {
  const parent = DriveApp.getFolderById(DRIVE_FOLDER_ID);
  const name = 'acct-' + String(email).replace(/[^a-zA-Z0-9]+/g, '-').toLowerCase();
  const it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}

function saveBackupToCloud_(email, payload) {
  if (!DRIVE_FOLDER_ID) throw new Error('DRIVE_FOLDER_ID is not set.');
  const folder = cloudFolder_(email);
  const stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd_HH-mm-ss');
  const title = BACKUP_PREFIX + stamp + '.json';
  folder.createFile(title, JSON.stringify(payload, null, 2), MimeType.PLAIN_TEXT);
  rotateCloud_(folder);
  return { ok: true, message: 'Backup stored to Google Drive for ' + email + '.', fileName: title };
}

function listCloudBackups_(email) {
  if (!DRIVE_FOLDER_ID) throw new Error('DRIVE_FOLDER_ID is not set.');
  const folder = cloudFolder_(email);
  const fs = folder.getFiles();
  const list = [];
  while (fs.hasNext()) {
    const f = fs.next();
    if (f.getName().indexOf(BACKUP_PREFIX) === 0) {
      list.push({ fileName: f.getName(), id: f.getId(), size: f.getSize() });
    }
  }
  list.sort(function (a, b) { return b.fileName.localeCompare(a.fileName); });
  return { ok: true, backups: list };
}

function readCloudBackup_(email, fileName) {
  if (!DRIVE_FOLDER_ID) throw new Error('DRIVE_FOLDER_ID is not set.');
  const folder = cloudFolder_(email);
  const fs = folder.getFilesByName(fileName);
  if (!fs.hasNext()) return { ok: false, message: 'Backup not found: ' + fileName };
  const file = fs.next();
  let parsed;
  try { parsed = JSON.parse(file.getBlob().getDataAsString()); }
  catch (err) { return { ok: false, message: 'Backup file is not valid JSON.' }; }
  return { ok: true, payload: parsed };
}

function rotateCloud_(folder) {
  try {
    const fs = folder.getFiles();
    const all = [];
    while (fs.hasNext()) {
      const f = fs.next();
      if (f.getName().indexOf(BACKUP_PREFIX) === 0) all.push(f);
    }
    if (all.length > MAX_BACKUPS_KEPT) {
      all.sort(function (a, b) {
        const na = parseInt(a.getName().replace(new RegExp(BACKUP_PREFIX + '|\\.json', 'g'), '').replace(/[-_]/g, ''), 10);
        const nb = parseInt(b.getName().replace(new RegExp(BACKUP_PREFIX + '|\\.json', 'g'), '').replace(/[-_]/g, ''), 10);
        return na - nb;
      });
      for (let i = 0; i < all.length - MAX_BACKUPS_KEPT; i++) {
        try { all[i].setTrashed(true); } catch (err2) { console.warn('trash failed: ' + err2); }
      }
    }
  } catch (err) { console.warn('Cloud rotation skipped: ' + err); }
}

function json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function loginAccount_(body) {
  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');
  const idx = userRow_(email);
  if (idx < 0) return { ok: false, message: 'Incorrect email or password.' };
  const s = getUsersSheet_();
  const row = s.getRange(idx, 1, 1, 10).getValues()[0];
  const status = String(row[4] || 'pending');
  const lockUntil = row[9] ? Date.parse(row[9]) : 0;
  const now = new Date().getTime();
  if (lockUntil && now < lockUntil) {
    const mins = Math.max(1, Math.ceil((lockUntil - now) / 60000));
    return { ok: false, message: 'Too many failed attempts. Try again in about ' + mins + ' minute(s).' };
  }
  let failed = parseInt(row[8] || '0', 10) || 0;
  const actual = hashPassword_(String(row[1]), password);
  if (actual !== String(row[2])) {
    failed += 1;
    let lock = '';
    if (failed >= MAX_LOGIN_FAILS) {
      lock = new Date(now + LOCK_MINUTES * 60000).toISOString();
      failed = 0;
    }
    s.getRange(idx, 9, 1, 2).setValues([[failed, lock]]);
    return { ok: false, message: 'Incorrect email or password.' };
  }
  if (status === 'pending') {
    return { ok: false, message: 'Your account is awaiting admin approval. Please wait.' };
  }
  if (status === 'rejected') {
    return { ok: false, message: 'This account was not approved. Contact the app owner.' };
  }
  const token = makeToken_();
  // token(4), status(5), role(6), createdAt(7) unchanged, lastLogin(8), failed(9), lockUntil(10)
  s.getRange(idx, 4, 1, 7).setValues([[token, status, row[5], row[6], new Date().toISOString(), '0', '']]);
  return {
    ok: true,
    token: token,
    email: email,
    role: String(row[5] || 'user'),
    name: email.split('@')[0]
  };
}

function logoutAccount_(token) {
  if (!token) return { ok: true };
  const s = getUsersSheet_();
  const last = s.getLastRow();
  if (last < 1) return { ok: true };
  const vals = s.getRange(2, 4, last, 1).getValues();
  for (let i = 0; i < last; i++) {
    if (vals[i][0] === token) { s.getRange(i + 2, 4).setValue(''); break; }
  }
  return { ok: true, message: 'Signed out.' };
}

function me_(token) {
  const a = resolveAccountByToken_(token);
  if (!a.email) return { ok: false, message: 'Session expired or invalid. Sign in again.' };
  return { ok: true, email: a.email, role: a.role };
}

function adminAction_(action, token, body) {
  const a = resolveAccountByToken_(token);
  if (a.role !== 'admin') return { ok: false, message: 'Admin access required.' };
  const s = getUsersSheet_();

  if (action === 'listUsers') {
    const last = s.getLastRow();
    const out = [];
    if (last >= 1) {
      const vals = s.getRange(2, 1, last, 8).getValues();
      for (let i = 0; i < last; i++) {
        out.push({
          email: vals[i][0],
          status: vals[i][4],
          role: vals[i][5],
          createdAt: vals[i][6],
          lastLogin: vals[i][7]
        });
      }
    }
    return { ok: true, users: out };
  }

  const email = String(body.email || '').trim().toLowerCase();
  const idx = userRow_(email);
  if (idx < 0) return { ok: false, message: 'No account with that email.' };

  if (action === 'approve') {
    s.getRange(idx, 5, 1, 1).setValue('approved');
    s.getRange(idx, 9, 1, 2).setValues([['0', '']]); // clear lockout
    return { ok: true, message: 'Approved ' + email + '. They can sign in now.' };
  }
  if (action === 'reject') {
    s.getRange(idx, 5, 1, 1).setValue('rejected');
    s.getRange(idx, 4, 1, 1).setValue(''); // revoke any live session
    return { ok: true, message: 'Rejected ' + email + '.' };
  }
  return { ok: false, message: 'Unknown admin action.' };
}

/**
 * Optional: an onOpen menu for manual operations in the Sheet editor.
 */
function onOpen() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu('Crispy Roll Ledger')
    .addItem('Open Users sheet (approve accounts)', 'openUsersSheet_')
    .addItem('Clear ledger sheet', 'clearSheetAndLog_')
    .addToUi();
}

function openUsersSheet_() {
  const s = getUsersSheet_();
  SpreadsheetApp.getActiveSpreadsheet().setActiveSheet(s);
}

function clearSheetAndLog_() {
  const result = clearSheet_();
  Logger.log(result.message || 'Cleared.');
}