/* ============================================================
   DAILY CRISPY ROLL LEDGER — Application Logic
   ============================================================ */

const STORAGE_KEY = 'dailyCrispyRollLedger_v2';
const DRAFT_STORAGE_KEY = 'dailyCrispyRollLedger_draft_v2';
const GOOGLE_SYNC_CONFIG_KEY = 'dailyCrispyRollLedger_googleSyncConfig';

/* ---------- Multi-company workspaces ----------
   Each user/company gets its own ledger namespace. The id 'default'
   is the pre-existing workspace: it uses the original keys (no
   suffix) so all current data is preserved untouched. New companies
   use suffixed keys. */
const COMPANIES_KEY = 'dailyCrispyRollLedger_companies';
const ACTIVE_COMPANY_KEY = 'dailyCrispyRollLedger_activeCompany';
let companies = [];          // [{ id, name }]  (list lives outside any one company)
let ACTIVE_COMPANY = null;   // { id, name }

function companyKeys() {
  const id = ACTIVE_COMPANY ? ACTIVE_COMPANY.id : 'default';
  if (id === 'default') {
    return { stateKey: STORAGE_KEY, draftKey: DRAFT_STORAGE_KEY, configKey: GOOGLE_SYNC_CONFIG_KEY };
  }
  return {
    stateKey: STORAGE_KEY + '_' + id,
    draftKey: DRAFT_STORAGE_KEY + '_' + id,
    configKey: GOOGLE_SYNC_CONFIG_KEY + '_' + id
  };
}
function companyStateKey() { return companyKeys().stateKey; }
function companyDraftKey() { return companyKeys().draftKey; }
function companyConfigKey() { return companyKeys().configKey; }

/* ============================================================
   GOOGLE ACCOUNT (OAuth) — PASTE YOUR CLIENT ID HERE
   ============================================================
   1. Go to https://console.cloud.google.com/apis/credentials
   2. Click "Create Credentials" → OAuth client ID
   3. Application type: Web application
   4. Authorized JavaScript origins: your site origin
      e.g. http://localhost:5500 or https://your-domain.com
   5. Enable "Google Sheets API" under the Library
   6. Copy the Client ID below.
============================================================ */
const GOOGLE_CLIENT_ID = '';  // ← PASTE YOUR GOOGLE OAuth CLIENT ID HERE
const GOOGLE_SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets';
let googleAuthUser = null;      // { email, name, accessToken }
let googleSheetsId = null;      // cached spreadsheet ID for this user
let googleAuthTokenClient = null;
const GOOGLE_SHEET_NAME = 'LedgerState';

/* ============================================================
   SUPABASE (OPTION B — the real backend)
   ============================================================
   Paste your project URL + anon key here once. After that, nobody
   sees or enters a deployment URL anywhere — sign-in and sync are
   handled by Supabase automatically, exactly like a real app.
   Leave empty to keep using the legacy Apps-Script backend.
============================================================ */
const SUPABASE_URL_wafer = 'https://yirdgfiklgsygwbafzgk.supabase.co';
const SUPABASE_ANON_KEY_wafer = 'sb_publishable_w7aR1Lrjd4ED3k5vPeXfIQ_rxSA8pMN';

/* ---------- Default Price List (persistent) ----------
   unit: 'g'  → price is Ks per KILOGRAM, qty entered in grams
   unit: 'unit' → price is Ks per UNIT, qty entered in units
   weightPerUnit: assumed grams per unit (for unit-based items, used in mix weight)
--------------------------------------------------------- */
const DEFAULT_PRICES = [
  { name: 'Flour', unit: 'g', price: 4600, weightPerUnit: null, remark: '' },
  { name: 'Tapioca Starch', unit: 'g', price: 3200, weightPerUnit: null, remark: '' },
  { name: 'Sugar', unit: 'g', price: 2800, weightPerUnit: null, remark: '' },
  { name: 'Local Sugar', unit: 'g', price: 6000, weightPerUnit: null, remark: '' },
  { name: 'Palm Sugar', unit: 'g', price: 6000, weightPerUnit: null, remark: '' },
  { name: 'Egg', unit: 'unit', price: 300, weightPerUnit: 50, remark: '1 egg ≈ 50g' },
  { name: 'Coconut Milk', unit: 'g', price: 5000, weightPerUnit: null, remark: '' },
  { name: 'Water', unit: 'g', price: 0, weightPerUnit: null, remark: '', stock: false },
  { name: 'Black Sesame', unit: 'g', price: 12000, weightPerUnit: null, remark: '' },
  { name: 'Additive Blend', unit: 'g', price: 4000, weightPerUnit: null, remark: '' },
  { name: 'Electricity', unit: 'unit', price: 250, weightPerUnit: null, remark: 'per unit', stock: false },
  { name: 'Packaging', unit: 'unit', price: 4, weightPerUnit: 17.14, remark: 'per bag' }
];

/* ---------- Default Daily Usage (Phase 10, 1x batch) ---------- */
const DEFAULT_USAGE = {
  'Flour': 100, 'Tapioca Starch': 280, 'Sugar': 220, 'Local Sugar': 100, 'Palm Sugar': 20,
  'Egg': 2, 'Coconut Milk': 50, 'Water': 580, 'Black Sesame': 16,
  'Additive Blend': 50, 'Electricity': 4, 'Packaging': 82
};

/* Current app build. `index.html` stamps the same id on <html data-build=…>.
   A mismatch (old HTML or old JS in the cache) makes the app warn loudly,
   because stale files are the #1 cause of "it says Synced but nothing uploads". */
const __LEDGER_BUILD = 'v1.10.0';
