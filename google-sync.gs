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
    const idToken = body.idToken || '';

    // Cloud (multi-tenant) mode: requests that carry a Google ID token are
    // verified server-side and scoped to that account's own data.
    const auth = resolveAccount_(idToken);
    if (auth.email) {
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
    }

    // ---- LEGACY single-sheet mode (no ID token). Kept for backward
    // compatibility with existing deployments that don't use accounts. ----
    if (action === 'save') {
      if (!payload) return json_({ ok: false, message: 'Missing payload.' });
      return json_(saveToSheet_(payload));
    }
    if (action === 'backup') {
      if (!payload) return json_({ ok: false, message: 'Missing payload.' });
      if (!DRIVE_FOLDER_ID) return json_({ ok: false, message: 'Drive backup is not enabled on this script.' });
      return json_(saveBackupToDrive_(payload));
    }
    if (action === 'list') {
      if (!DRIVE_FOLDER_ID) return json_({ ok: false, message: 'Drive backup is not enabled on this script.' });
      return json_(listDriveBackups_());
    }
    if (action === 'restore') {
      if (!body.fileName) return json_({ ok: false, message: 'Missing fileName.' });
      return json_(readDriveBackup_(body.fileName));
    }
    if (action === 'clear') return json_(clearSheet_());
    return json_({ ok: false, message: 'Unknown action: ' + action + ' (send an idToken to use cloud mode).' });
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
    const idToken = (e && e.parameter && e.parameter.idToken) || '';
    if (action === 'get') {
      // Cloud mode: fetch this account's own state (scoped, verified).
      if (idToken) {
        const auth = resolveAccount_(idToken);
        if (auth.email) {
          const p = getCloudState_(auth.email);
          if (!p) return json_({ ok: false, message: 'No cloud data for this account yet.', payload: null });
          return json_({ ok: true, payload: p });
        }
      }
      // Legacy single-sheet mode.
      const payload = readFromLedger_();
      if (!payload) return json_({ ok: false, message: 'No state found.' });
      return json_({ ok: true, payload: payload });
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

/**
 * Optional: an onOpen menu for manual operations in the Sheet editor.
 */
function onOpen() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu('Crispy Roll Ledger')
    .addItem('Clear ledger sheet', 'clearSheetAndLog_')
    .addToUi();
}

function clearSheetAndLog_() {
  const result = clearSheet_();
  Logger.log(result.message || 'Cleared.');
}