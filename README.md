# Daily Crispy Roll Ledger — Modular Layout

This project was split from the original single-file `daily-ledger-1.1.html`
into a modular HTML/CSS/JS structure. The **original file is preserved** as
`daily-ledger-1.1.html` (a full backup) so nothing is lost.

## Entry point

Open **`index.html`** in a browser (or serve the folder with a local server,
e.g. `npx serve` or VS Code Live Server). Google OAuth/Sync requires the app to
run from a real origin (e.g. `http://localhost:5500`), and you must paste your
Google Client ID in `js/config.js`.

## File layout

```
dail-ledger v1.1/
├── index.html              HTML markup (head + body) — links css + js
├── css/
│   └── styles.css          Custom styles (moved out of the old <style> block)
├── js/                     Modular classic scripts (shared globals), loaded in order:
│   ├── config.js           Storage keys, Google OAuth constants, default price/usage data
│   ├── storage.js          App state object, draft state, persistence (load/save/draft)
│   ├── google.js           Google Sync core + global render orchestration (syncToGoogle,
│   │                       toGooglePayload, backups, renderAll, triggerGoogleSync)
│   ├── helpers.js          Utilities ($, fmt, today, uid, esc), cost/weight calc,
│   │                       toast, validation, tab switching
│   ├── pricing.js          Price List tab
│   ├── usage.js            Today's Usage + Live Calculation
│   ├── ledger.js           Save Daily Entry + Recent Entries
│   ├── dashboard.js        Dashboard
│   ├── calendar.js         Calendar & Audit
│   ├── csv.js              CSV export
│   ├── sync-ui.js          Google Sync tab UI bindings
│   ├── sample-data.js      Sample data + Clear All
│   ├── inventory.js        Inventory
│   ├── customers.js        Customers (what customers owe you)
│   ├── suppliers.js        Suppliers (shops), stock purchases, payables/debt you owe
│   ├── tools.js            Business Tools
│   ├── cash.js             Cash Drawer / cash-flow + manual adjustments
│   ├── companies.js        Multi-company workspaces, login/switch screen + boot gating
│   ├── cloud.js            Online / cloud abstraction layer (provider-agnostic)
│   └── init.js             INIT + Google account sign-in + app bootstrap (loads last)
└── google-sync.gs          Google Apps Script backend (deploy to a Sheet)
```

## Important

- The modules are **classic scripts** (not ES modules), so they share one global
  scope. Top-level `const`/`let` and `function` declarations are visible across
  all files. **Load order matters**: `init.js` must load last because it runs
  `loadState(); renderAll(); initGoogleSignIn();` at the top level, and it
  re-defines `triggerGoogleSync` to also push to the Sheets API.
- `js/google.js` defines the base `triggerGoogleSync`; `js/init.js` overrides it
  with the OAuth-aware version — this ordering is intentional.
- The split was validated to be byte-for-byte identical (JS + CSS) to the
  original content.

To regenerate the split from the original, run `_split.ps1` (PowerShell).

## Current production stack

See [ROADMAP.md](ROADMAP.md) for completed feature checks, upcoming work, and
the release acceptance criteria.

The recommended live setup is **Netlify + Supabase**:

- Netlify hosts this static app (`index.html`, `css/`, and `js/`).
- Supabase Auth provides email/password accounts and sessions.
- Supabase Postgres stores each approved user's private ledger.
- Supabase Realtime updates a signed-in user's other devices after a save.

The Google Apps Script modules remain in the repository as a legacy fallback
and for existing installations. When the Supabase URL and publishable key are
configured in `js/config.js`, Supabase is the active backend.

### Production checklist

1. Deploy this folder to Netlify and use the HTTPS site URL everywhere.
2. In Supabase Auth, enable email confirmation and add the Netlify URL to the
   allowed redirect URLs.
3. Run the **complete current** `_supabase-setup.sql` once in Supabase SQL
   Editor. It is safe to re-run: it upgrades the policies, triggers, and
   Realtime membership without dropping existing ledger data.
4. Configure only the project URL and **publishable/anon** key in
   `js/config.js`. Never put a `service_role` key in frontend code.
5. Create the owner account first, then use **Admin** in the app to approve
   every other account.
6. Keep a downloaded full backup before doing a large import, restore, or
   deployment change.

> Approval is enforced by Row Level Security, not merely hidden in the UI:
> pending and rejected accounts cannot read or write ledger data through the
> Supabase API.

## v1.2 upgrades (this build adds to the original)

- **Cash Drawer tab** (`js/cash.js`): opening balance + running cash position
  (sales + customer payments + manual adjustments in, minus stock paid, supplier
  payments, one-time expenses, labor, withdrawals out). Manual cash in/out for
  loans, owner draws, bank deposits, etc.
- **Recurring monthly costs** (Business Tools): fixed bills (rent, internet)
  auto-deducted from the monthly profit report.
- **Monthly report now shows true profit**: subtracts one-time expenses, waste
  value and recurring fixed costs from net — plus a sell-out/surplus readout.
- **Cost per bag + margin %** stored per entry and shown in Recent Entries, the
  Audit table and CSV export.
- **Inventory value on hand** KPI (stock × current price) in the Inventory tab
  and Dashboard.
- **Chart date-range selector** on the Dashboard (14/30/60 days / all time).
- **"Use Standing Orders" button**: pre-fill today's batch from the sum of all
  customer standing orders.
- **Purchase → Price List sync**: when you buy stock, you're offered to update
  the Price List to the actual paid price (logged to price history).
- **Customer payments feed the Cash Drawer** (cash received on debt repayment).
- **State versioning + migration** (`state.version`, new fields backfilled on
  load and on Google/backup restore) and a **storage-used** indicator.

## v1.3 upgrade — multi-company workspaces

Each company/business now logs in to its **own workspace** and sees only its
own ledgers, inventory, pricing, customers, and Google sync settings.

- **Login / switch screen** (`js/companies.js`): on load, if no workspace is
  active the app shows a "Select your workspace" screen — pick an existing
  company, create a new one (e.g. "Shop A", "Shop B"), or delete one (removes
  that company's local data).
- **Header button**: the current company name is shown in the header; click it
  to switch workspaces anytime.
- **Isolated storage**: each workspace gets its own keys in `localStorage`
  (`…_<companyId>` suffixes for state, draft, and Google sync config), so no
  data leaks between companies.
- **Per-company Google sync**: each workspace keeps its own Apps Script URL /
  sheet ID, backup frequency and Drive backups. Log into Google once per
  browser; the sheet you connect under Company A only syncs Company A.
- **Backward compatible**: your existing data automatically becomes the
  **"My Business"** workspace (id `default`) and keeps using the original
  storage keys — nothing is migrated, moved, or lost on first load.

> Note: workspaces live in this browser and are *not* account authentication.
> Anyone who opens the app on this computer can switch workspaces — it's
> designed to separate data by company on a shared device, not to be a secure
> login. For real per-user login you'd need a backend; the current Google OAuth
> is used for Sheets sync, and each company's sheet is its own boundary.

## v1.4 upgrade — Online / access from any device

The app now has a **cloud layer**: each workspace can be *bound* to a Google
account, and then its ledger lives in the cloud and follows it to any device.

- **`js/cloud.js`** — a provider-agnostic abstraction (`cloudPush`, `cloudGet`,
  `cloudBackup`, `cloudList`, `cloudRestore`, `cloudAfterSignIn`). Today it's
  backed by Google; to switch to a real database (e.g. Supabase) later, only
  this module changes.
- **`google-sync.gs` is multi-tenant** — the *same* Web App URL now serves many
  accounts. Requests carry your Google ID token, verified server-side; each
  account reads/writes **only its own row** in a hidden `CloudAccounts` sheet
  and its own per-account Drive backup folder. Requests without a token fall
  back to the legacy single-sheet mode, so existing deployments keep working.
- **Online/Cloud card in the Google Sync tab** — shows ONLINE / SIGNED IN /
  LOCKED / OFFLINE state, "Sync Now" (pull the latest), "Upload Now" (push
  local), "Cloud Backup" (snapshot to Drive) and per-backup restore.
- **Auto behavior**:
  - Sign in with Google → the workspace is bound to that account (first time)
    or reconciled (cloud pulls onto this device, or this device uploads if its
    copy is newer / cloud is empty).
  - Every save auto-pushes to the cloud when online (`init.js`
    `triggerGoogleSync`).
  - Per-company: each workspace binds independently, so Shop A and Shop B stay
    separate even on the same shared computer.

### Go online (one-time, ~10 min)
1. **Host the app** so any device can open it — drag the `dail-ledger v1.2`
   folder to **Netlify Drop** (https://app.netlify.com/drop) or push it to a
   GitHub repo → **GitHub Pages**. Free either way.
2. **Deploy the cloud backend** exactly once:
   - Create a Google Sheet → **Extensions → Apps Script** → paste
     `google-sync.gs`.
   - Set **`DRIVE_FOLDER_ID`** (a Drive folder where per-account backups land)
     and optionally **`APP_CLIENT_ID`** = your Google OAuth Client ID (stricter
     verification).
   - Deploy → New deployment → Web app → *Execute as: Me* → *Who has access:
     Anyone with a Google account*.
3. In the app: **Google Sync tab** → paste the deployment URL → Save Config.
4. Click **Sign in with Google** (header). The first time it binds this
   workspace to your account and reconciles; after that your data is online.

### The upgrade path to a real database (later)
Because everything routes through `js/cloud.js`, swapping Google for Supabase
(Portable Postgres, real auth, row-level security) is a matter of writing one
new provider module — no other file needs to change. That keeps today's
free/quick setup from boxing you in.

## v1.5 upgrade — Private accounts with admin approval 🛡️

The app is now **locked behind a real email + password account system**, like
Gmail / TikTok: nobody can use the ledger until the **owner approves** their
account.

```
Open app  →  Login / Create Account screen
                ├─ "Create Account" (email + password) → saved on the server as ⏳ PENDING
                ├─ Owner clicks Admin → Approve         → status = ✅ approved
                └─ User logs in → only then is the ledger unlocked
```

- **Accounts live on your server** — a hidden `Users` sheet in the same Google
  Sheet as your Apps Script (`email | salt | hash | token | status | role |
  createdAt | lastLogin | failed | lockUntil`).
- **Passwords are never stored** — only a salted SHA-256 hash, computed
  server-side.
- **Per-user isolation** — every ledger read/write is scoped to the logged-in
  account's own session token. User A can never see or write User B's data
  (also enforced per-account in the `CloudAccounts` sheet + per-account Drive
  folder from v1.4).
- **Admin console** — when you (role `admin`) log in, an **Admin** button
  appears in the header. It lists every account with PENDING / APPROVED /
  REJECTED status and one-click **Approve** / **Reject**.
- **Brute-force guard** — 5 failed logins locks the account for 15 minutes.
- **First account = owner** — the very first account created on a fresh
  backend becomes the admin automatically, so you can't lock yourself out.
- **Optional sign-up restrictions** in `google-sync.gs`:
  `ALLOWED_EMAILS` (exact emails) and `ALLOWED_DOMAINS` (e.g. `['gmail.com']`)
  stop strangers from requesting accounts.
- **Legacy data is safe** — on first login the app offers to import the old
  "My Business" browser ledger into your new account.

### Setup (you already have a deployment — just upgrade it)
1. **Back up** the current `google-sync.gs`, then paste the new one into your
   Apps Script project (**replace the whole file**) and save.
2. Optional: set `ADMIN_EMAILS = ['you@gmail.com']` in the script (not
   required — the first sign-up becomes admin anyway).
3. **Deploy → Manage deployments → Edit → New version** → same settings as
   before (*Execute as: Me*, *Who has access: Anyone with a Google account*).
   Copy the updated `/exec` URL.
4. Open your hosted app → on the login screen click **Server settings** and
   paste the `/exec` URL (it's also still shown in the Google Sync tab).
5. Create YOUR account first — it becomes the **admin** automatically.
6. Share your app link. Users request an account → you approve them in the
   **Admin** console (or directly in the `Users` sheet). Approved users can
   then log in and each has their own private ledger on any device.

## v1.6 upgrade — Production ≠ Sales (roll today, sell tomorrow) 🥖

The single "Daily entry" assumed you sold everything the day you rolled it.
The app now treats **production** (rolling) and **sales** (selling) as
two separate things, with a **ready-to-sell stock** between them.

- **Production tab** — what you ROLLED: date, bags packed, actual pieces
  rolled, ingredient usage, labor, and capital cost. Adds those pieces to
  stock. No sale is recorded here.
- **Sales & Stock tab** — what you SOLD, on the actual day you sold it (today,
  tomorrow, next week). You enter **bags sold**, **pieces actually in those
  bags** (because the per-bag count varies), and price per bag. The sale
  deducts pieces from stock and records the true profit.
- **Ready-to-sell stock** — a running balance of pieces on hand with a cost
  basis, plus approximate bags, and the cash invested in unsold goods.
- **Correct profit** — a sale is matched to the *cost of the pieces actually
  sold* (average cost, COGS), not "today's production cost". So rolling 100
  today and selling 40 today no longer shows a bogus loss — the unsold 60
  stay as stock and their profit is booked when they're actually sold.
- **Exports / reports** — full CSV, sales-only CSV, printable report, monthly
  report, Dashboard, calendar and audit all use the new model (rolled vs sold).
- **Existing data migrates automatically** — your old "daily entries" are
  split into a production batch + a same-day sale on first load (one time),
  and old `My Business` browser data still imports into your account.
- **Weight per roll → expected rolls** — on the Production form you enter the
  weight of one roll (e.g. 11 g). The app computes **Expected Rolls = total
  mix weight ÷ weight per roll** (e.g. 1120 g ÷ 11 ≈ 101) live, shows how much
  mix is left over, and the **"vs Actual"** difference (did you make more or
  fewer than expected). This is stored per batch and shown in the recent list,
  the full CSV, and the printable report, so you can spot waste/tight rolling.
- **Outcome / quality notes** — a per-batch notes box to record how each batch
  turned out (⭐ good, a bit salty, not crispy, over/under weight, etc.), so
  you can look back and improve consistency. These appear in the recent list,
  the printable report, and the CSV export.

## v1.7 — Real backend with Supabase (no deployment-ID, automatic sync) 🚀

Use this if you're tired of pasting the Apps-Script URL on every device and
want true "like a real app" behavior:

- **Real email/password sign-in** via Supabase Auth (no deployment URL to paste).
- **Automatic sync** — every save pushes instantly; other devices update by
  themselves (realtime), like Google/Xiaomi sync.
- **Account + approval system preserved** — first account is owner/admin;
  you still approve new members in the Admin console.
- **Per-user privacy is enforced by the database** (Row-Level Security).

### One-time setup (you do this once, ~10 min)
1. Sign up at **https://supabase.com** → **New project** (free). Copy the
   project **URL** and the **anon key** from *Settings → API*.
2. In Supabase, open **SQL Editor → New query → paste the whole
   `_supabase-setup.sql` → Run**.
3. In this app, open **`js/config.js`** and paste the two values:
   ```js
   const SUPABASE_URL_wafer = 'https://YOUR-PROJECT.supabase.co';
   const SUPABASE_ANON_KEY_wafer = 'YOUR-ANON-KEY';
   ```
4. Reload. The app now uses Supabase (the old Apps-Script URL field is hidden).
   Create **your own account first** — you become the owner/admin automatically.

The app keeps working in the legacy Apps-Script mode until you add the keys,
so nothing breaks while you get it set up.

## v1.8 — Ledger integrity and safer exports ✅

- **Recipes persist everywhere** — saved recipes now survive reloads and cloud
  sync, instead of existing only until the next refresh.
- **Waste is real stock movement** — recording spoiled pieces deducts them
  from ready-to-sell stock and values the loss using the average cost at the
  time of the waste. Monthly profit reports use that actual waste value.
- **No silent overselling** — a sale or waste record is rejected when the
  finished-goods stock available on that date is insufficient. Future batches
  cannot incorrectly cover a past sale.
- **Accurate customer repayments** — repayments are capped at the outstanding
  debt, so the Cash Drawer cannot be inflated by an accidental overpayment.
- **Safer CSV files** — exports quote fields correctly and neutralize values
  that spreadsheet apps could otherwise interpret as formulas.
- **Working “Copy Yesterday”** — the production form now copies the most
  recent modern production batch from yesterday, rather than the retired
  pre-v1.6 daily-entry format.

### Important behavior

- Finished-goods stock uses the **weighted-average cost** method.
- Production, sales, and waste are replayed in date order. On a single date,
  production is available first, then sales, then recorded waste.
- A waste value is calculated from the stock cost available at that date. Old
  waste records receive a value automatically the next time the ledger is
  rebuilt and saved.
- Supabase sync currently saves a whole user ledger as one JSON document. Do
  not make unrelated edits on two devices at exactly the same time: the latest
  save wins. A future normalized database upgrade will add conflict-safe,
  record-level collaboration.

## v1.9 — Dated ingredient inventory movements 📦

Ingredient stock is now derived from an append-only movement history instead
of being silently overwritten:

- Existing on-hand stock migrates once into an **Opening balance** movement.
- Supplier purchases add a dated **Purchase** movement.
- Saving, editing, or deleting production records matching ingredient-use or
  return movements.
- Manual stock changes require a reason and are saved as **Manual adjustment**
  movements.
- The Inventory tab shows the latest movements, providing an explanation for
  every on-hand quantity.

When upgrading an existing ledger, open the app once while online and let it
finish syncing so the opening-balance migration is saved to Supabase.

## Current in-progress release — ingredient waste and customer sales

- **Ingredient waste** is recorded from the Inventory tab with the ingredient,
  quantity, date, and a required reason. It becomes a dated negative inventory
  movement; stock remains derived from the movement history.
- **Customer sales** can be linked to an optional customer and marked paid,
  partial, or credit. Only the amount paid now enters the Cash Drawer; the
  unpaid balance is added to that customer's debt.
- **Receipts and statements**: each new sale gets a receipt number and can be
  printed. Customer statements list customer-linked sales, repayments, running
  balance, and the optional credit due date.

The acceptance checks in `ROADMAP.md` remain the completion gate: run the
listed manual workflows before treating this release as complete.

> ⚠️ `daily-ledger-1.1.html` is a byte-for-byte backup of the ORIGINAL app and
> does **not** contain these upgrades. Always open **index.html**. `_split.ps1`
> regenerates only the original content — the new `auth.js` module and HTML
> upgrades are additive and not part of that script.

## Changelog

### v1.2 fixes
- **Environment keys renamed** — `SUPABASE_URL` → `SUPABASE_URL_wafer` and
  `SUPABASE_ANON_KEY` → `SUPABASE_ANON_KEY_wafer` throughout
  (`js/config.js`, `js/supabase.js`, README). If you rely on environment
  variables, update them to the new names too.
- **Fixed login crash (`moveStoreLogin is not defined`)** — `js/auth.js`
  called a non-existent function in the legacy fallback path; the correct
  `legacyStoreLogin` is now called.
- **Fixed admin approval (RLS policies)** — `_supabase-setup.sql` section 4
  policies previously used `role = 'admin'` inside a policy, which refers to
  the *target* row (never true for pending users), so the admin could neither
  list nor approve accounts. Replaced with an `is_admin()` SECURITY DEFINER
  helper that checks the current signed-in user. **Re-run the updated SQL**
  (or at least the section-4 block) in Supabase SQL Editor.
- **Fixed realtime sync spamming + infinite loop** — `js/cloud.js` +
  `js/storage.js`: real-time events reflecting a device's *own* write are now
  ignored (no toast, no re-render), applied remote changes no longer echo back
  to the server (breaks a self-perpetuating push loop that hammered the
  database and spammed "Synced from another device" notifications). Auto-sync
  now shows a single quiet status line instead of a pop-up toast.

### v1.8 fixes
- **Closed profile privilege escalation** — profile changes are admin-only;
  clients cannot approve themselves or assign themselves the admin role.
- **Protected unapproved data access** — ledger policies require an approved
  account, including for direct API calls.
- **Fixed first-save Realtime delivery** — subscriptions listen for both
  inserts and updates, so another open device receives the first ledger save.
- **Preserved existing Realtime configuration** — setup no longer drops and
  recreates Supabase's shared publication.

After deploying these JS changes, **hard-refresh** the browser (Ctrl+Shift+R)
so Netlify's cache doesn't serve stale files.
