# Daily Crispy Roll Ledger — Project Status & Architecture Report

| | |
|---|---|
| **Workspace** | `d:\wafer\Wafer_documentary\dail-ledger v1.7` |
| **Branch** | `main` (remote: `github.com/saiywetnoon/Wafer1`) |
| **Build marker** | `v1.13.9` (`__LEDGER_BUILD` in `js/config.js`) |
| **App type** | Static, client-rendered PWA + cloud backend (Supabase) |
| **Report date** | 2026-09-13 |

> **Companion document:** `ALGORITHM_REFERENCE.md` — a function-by-function map of the
> *type of algorithm* used in every module (merge/LWW semantics, event-sourcing replay,
> tombstone deletion, debounces, rule engine, scheduling, i18n walk, …), with
> complexity notes, data-integrity invariants, and the test-harness mapping.

---

## 1. Project Overview & Objectives

**What the project does**

Daily Crispy Roll Ledger is a single-business ERP for a crispy-roll production kitchen. It records:

- Ingredient price lists (`state.prices`) and price-change history (`state.priceHistory`)
- Production batches (`state.production`), including a "mix saved → packaging finished" two-phase workflow
- Sales by bag/piece (`state.sales`) with credit/partial-payment handling
- Derived ready-to-sell stock (recomputed from history, never the stored source of truth)
- Inventory movement ledgers (`state.inventoryMovements`) with low-stock alerts, waste, and stock corrections
- Customers (receivable debt, statements, standing orders) and suppliers (payables, purchases, payments)
- Cash-drawer flows, one-time and recurring expenses, money-out aggregation
- Frying-pan timers (3–9 independent pans) and an optional AI root-cause analysis module

**Primary goal**

Give a working, low-literacy, multi-device shop owner one ledger that:

1. Survives browser refreshes (offline-first localStorage)
2. Synchronizes across phone/PC/tablet through a shared cloud row
3. Is installable as a PWA with English/Myanmar (Burmese) language support
4. Requires no technical skill to operate (approve → log in → type)

**Target audience (from code evidence)**

- The owner/operator of the business (currency `Ks`, English/Myanmar toggles in `js/i18n.js`)
- Kitchen staff using separate logins that deliberately **share one workspace** (see `js/supabase.js` header comment)
- Admin-only account approval model (`_supabase-setup.sql` `handle_new_user`; the first account becomes owner)

**Observed operational issue (context for this report)**

"Every device uses its own data" is **inherent to the architecture**: the app keeps a full local copy per account under `localStorage["dailyCrispyRollLedger_v2_acct-<email>"]` (`js/config.js` `companyKeys()`, `js/companies.js` `companyBootstrap()`) and reconciles with the cloud by **timestamp conflict resolution** (`js/cloud.js` `remoteWins()`), not by continuously mirroring server state. Devices that cannot reach Supabase — or that hold records stamped newer than the real edit — will display their own cached (older) data. Sections 4–6 explain the mechanism and mitigations.

---

## 2. Technical Architecture & Stack

### Frontend

- **Language / paradigm:** Vanilla JavaScript (classic scripts, shared global scope, no modules). Load order is definitional and enforced by `index.html` tags, e.g. `<script src="js/config.js?v=20261017c"> … <script src="js/init.js?v=20261017c">`.
- **Markup / styling:** a single `index.html` (~1,540 lines) using Tailwind-style utility classes; custom stylesheet `css/styles.css`; Tailwind loaded from CDN with a runtime `tailwind.config` block (`index.html` lines 31–47).
- **Libraries (from `index.html`):**
  - `chart.js@4.4.1` — dashboard charts (with `unpkg` fallback)
  - `lucide@1.34.0` — icon set (with `jsdelivr`/`cloudflare` fallbacks)
  - `@supabase/supabase-js@2` (UMD, `window.supabase`) — auth, DB, Realtime (jsdelivr → unpkg fallback)
  - Google Fonts `Inter` and `JetBrains Mono`
- **PWA:** `manifest.webmanifest`, `js/pwa.js`, `sw.js` (service worker; cache namespace `crp-shell-v3`; network-first navigations; stale-while-revalidate for static assets; `?v=` query stamps for cache busting).

### Backend

- **Supabase project** `yirdgfiklgsygwbafzgk.supabase.co`, configured in `js/config.js` (`SUPABASE_URL_wafer`, `SUPABASE_ANON_KEY_wafer`):
  - **Auth**: email/password, session persistence, owner approval, password reset (`SUPA.resetPasswordForEmail`, `SUPA.updateUser` in `js/supabase.js`)
  - **Postgres**: the ledger is stored as **one JSONB row** (whole-ledger snapshot)
  - **Realtime**: Postgres changes on `shared_ledgers` broadcast to all signed-in devices
- The legacy Google Apps Script backend (`google-sync.gs`) and all Google OAuth/Sheets code were removed (commit `e5729f3`); legacy hooks in `js/cloud.js` were stubbed out during the audit.

### Database (`_supabase-setup.sql`)

| Table | Purpose | RLS |
|---|---|---|
| `profiles(id, email, role, status, created_at)` | Account approval gate (`pending/approved/rejected`) | self-read; admin-only updates; identity/role immutable |
| `ledgers(user_id, payload, updated_at)` | ACTIVE per-account store (v1.8.5) — one whole-ledger JSON row per account | owner + approved (`auth.uid() = user_id`) |
| `shared_ledgers(workspace_id PK, payload, updated_at)` | LEGACY migration source only — locked to the owner; only the ADMIN may read/write it and only the ADMIN's first login adopts its payload into the admin's private `ledgers` row (then it is deleted) | admin only (select/insert/update) |

Key server-side functions: `handle_new_user()`, `touch_ledger()`, `is_approved()`, `is_admin()`, `protect_profile_fields()`, `profile_set_role()` (admin-only role changes, last-admin guard).
---

## 3. Core Module Breakdown

| Module | Responsibility | Key functions / variables |
|---|---|---|
| `js/config.js` | Constants, storage keys, Supabase creds, defaults | `STORAGE_KEY`, `companyKeys()`, `DEFAULT_PRICES`, `DEFAULT_USAGE`, `DEFAULT_ROLLS_PER_BAG`, `__LEDGER_BUILD` |
| `js/storage.js` | The `state` object, persistence, debounce, drafts | `state`, `saveState()`, `persistState()`, `loadState()`, `loadDraftIfNewer()` |
| `js/helpers.js` | Pure/derived finance, inventory, tombstones | `rebuildStockAndCogs()`, `replayStocksAndCogs()`, `finishedGoodsShortage()`, `recordInventoryMovement()`, `mergeMovements()`, `markDeleted()`/`applyDeletionTombstones()`, `normalizeCustomerBalances()` |
| `js/ledger.js` | Production CRUD, standing-order prefill | `saveProduction()`, `saveProductionFromRun()`, `deleteProduction()`, `editProduction()` |
| `js/usage.js` | Usage form, live costing, packing rule, save-button labels | `currentUsage()`, `updateUsageCosts()`, `deriveBagsFromPieces()` |
| `js/sales.js` | Sales CRUD, stock validation, credit, receipts, CSV | `saveSale()`, `removeSale()`, `saleCreditAmount()`, `printSaleReceipt()` |
| `js/pricing.js` | Price list + price-history capture (change-only stamping) | `renderPriceTable()`, live `input`/`change` handlers |
| `js/inventory.js` | Ingredient stock tab, correction, low-alert, waste | `renderInventory()`, `addStockFor()`, `.stock-input` vs `.low-input` editors |
| `js/customers.js` | Customers, statements, debt, payments | `renderCustomerStatement()`, `adjustCustomerDebt()` |
| `js/suppliers.js` | Shops, purchases, payables, payments, purchase→price offer | `renderSuppliers()`, `normalizeSupplierPayables()` |
| `js/cash.js` | Cash drawer | `financeTotals()` — counts only `paidNow` on purchases; payment rows counted once |
| `js/tools.js` | Business tools (recipes, break-even, forecast, target profit, purchase list, print, CSV) | `renderTools()`, `renderPriceHistory()`, `purchaseList()` |
| `js/moneyout.js` | Pure "money out" aggregation (daily/monthly) | `MONEY_OUT_TYPES`, `moneyOutForDay()`, `moneyOutForMonth()` |
| `js/pan-timers.js` | Frying-pan timers (3–9 pans, staged alerts) | `PanTimers`, `panStorageKey()` (per-workspace, legacy fallback) |
| `js/dashboard.js` | KPIs, charts, alerts, monthly report | `renderDashboard()`, `renderCharts()`, `getExpiringBatches()` |
| `js/calendar.js` | Calendar + audit table | `renderCalendar()`, `renderAuditTable()` |
| `js/csv.js` | Ledger CSV export | `exportCsvBtn` handler |
| `js/ai.js` | Rule-engine root cause + optional LLM summary | `LLM_PROVIDERS`, `askLLM()`, `analyzeProfile()` |
| `js/companies.js` | Workspaces & account scoping | `companyBootstrap()`, `deleteCompany()` |
| `js/auth.js` | Auth gate, sign-up/in/out, admin, password reset | `authBootstrap()`, `doAuthLogin()`, `maybeRecoveryFlow()` |
| `js/supabase.js` | Supabase adapter | `SUPA.init/sessionUser/saveLedger/getLedger/subscribeRealtime/resetPassword/updatePassword/getProfile` |
| `js/cloud.js` | Sync engine | `cloudPush()`, `cloudGet()`, `handleRemoteCopy()`, `mergeRemoteIntoLocal()`, `mergeRows()`, `remoteWins()`/`productionRemoteWins()`, `applyCloudRemote()`, `cloudAfterSignIn()`, `stateDataCount()` |
| `js/sync-ui.js` | Sync-tab bindings + diagnostics | `cloudSyncNow()`, `reconnectRealtime()`, `cloudForceOverwriteCloud()`, `cloudForcePullFromCloud()`, `compareCloudAndDevice()`, `cloudRoundTripTest()` |
| `js/live-sync.js` | Every keystroke → `persistState()` | document-level `input`/`change` listeners |
| `js/device.js` | Device identity & echo suppression | `getDeviceId()`, `getSessionId()`, `getDeviceFact()` |
| `js/i18n.js` | EN/MY dictionary + DOM walker | `t()`, `applyLanguageToDom()`, `I18N_MY` |
| `js/sample-data.js` | Demo data + Clear All (full wipe + tombstones) | `demoBtn`/`clearBtn` handlers, `wipeLedgerCollection()` |
| `js/init.js` | Bootstrap, render orchestration, auto-push | `appStart()`, `renderAll()`, `triggerGoogleSync()`, `reportBackendMode()` |
---

## 4. Data Flow & Key Workflows

### 4.1 Boot / login reconcile

1. `index.html` loads scripts in order (`config → i18n → pwa → device → supabase → storage → helpers → … → auth → cloud → live-sync → ai → init`).
2. `init.js appStart()` → `reportBackendMode()` → `authBootstrap()` (Supabase session) → `companyBootstrap()` (sets `ACTIVE_COMPANY = { id: 'acct-<email>' }`) → `maybeImportLegacy()` → `loadState()` → `renderAll()`.
3. `cloudAfterSignIn()` (`js/cloud.js`) compares `stateDataCount()` locally vs the cloud row:
   - local 0 + cloud > 0 → **pull** via `applyCloudRemote()` (fresh device)
   - cloud 0 + local > 0 → **push** (first sync)
   - both > 0 → `handleRemoteCopy()` → **additive merge** (`mergeRemoteIntoLocal()`) → push the merged result
4. `supabaseWatch(uid)` subscribes to Realtime; `startCloudPolling()` re-pulls every 60 s; a tab-focus handler re-pulls immediately; `setCloudAutoSync(true)` enables auto-push on every `saveState()`.

### 4.2 Edit → cloud

1. User input → `live-sync.js` → `persistState()` (300 ms debounce) → `saveState()`:
   - writes `JSON.stringify(state)` to `localStorage[companyStateKey()]`
   - calls `triggerGoogleSync()` (900 ms debounce) → `cloudPush()`
2. `cloudPush()` → serialized `cloudPushOnce()` → `supabasePush()` → `SUPA.saveLedger(uid, toGooglePayload())` → **upsert** of the whole row into `ledgers(user_id = auth.uid())` — THIS account's private row only.
3. Realtime broadcasts the new row to the SAME account's devices → `supabaseUpdate()` (own-tab echo skipped via `getSessionId()`) → `handleRemoteCopy()` → merge → `renderAll()`. A different account never receives the event (its Realtime filter points at its own `user_id` row).

### 4.3 Merge rules (conflict resolution)

- Collections are unioned by record key (`recordUnionKey`: `id` > `name` > `date` > `ingredientName`).
- Same-key clashes: `remoteWins()` → **newest `updatedAt` wins**; un-stamped legacy rows always lose to stamped rows.
- **Production-specific rule** (`productionRemoteWins()`): a batch with `pieces > 0` (finished) always beats a `pieces = 0` PACKING mix, regardless of timestamps.
- Deletions propagate via tombstones (`state.deletions`, filtered by `applyDeletionTombstones()` across all collections, including `priceHistory` after the latest fix).
- Derived values (stock, customer debt, supplier payables) are recomputed after every merge — never trusted from stored state.
- If two copies differ but the merge produces no change, the device pushes its own (newest) copy to the cloud, self-healing a stale cloud row.

### 4.4 Price history

- A committed price edit (`pricing.js` `change` handler) appends `{id, date, name, old, new, updatedAt}` to `state.priceHistory`; purchase→price sync appends only after user confirmation (`suppliers.js`). Price changes that arrive via merge or file import do **not** create history rows — a documented gap.

---

## 5. Current Implementation Status

### Fully implemented and regression-tested

- Production ↔ sales ↔ stock replay (`rebuildStockAndCogs`, `finishedGoodsShortage` validation, two-phase mix/packaging workflow)
- Inventory movement ledger, low alerts, ingredient waste, stock correction
- Customers (debt/statements/payments) and suppliers (purchases/payables/payments) with derived-balance normalization
- Cash drawer, money-out aggregation, monthly profit report, CSV/print exports
- Business tools (recipes, break-even, forecast, target profit, purchase list), PWA install, EN/MY i18n, pan timers (per-workspace state), AI analysis (on-device rules + optional LLM)
- Cloud sync: 60 s poll, Realtime, tab-focus catch-up, tombstone deletes, force one-way copy buttons, **cloud-vs-device truth checker**, and **cloud round-trip self-test** (build v1.13.9)
- 17 verification harnesses passing against the real v1.7 code; static ID and div-balance checks green

### Partial / conditional features

- **Password reset** (`authRequestPasswordReset`): requires Supabase SMTP/sender and Site-URL configuration to actually deliver emails; otherwise the confirmation message is misleading.
- **Account provisioning**: accounts created before `handle_new_user` was installed have no profile row and are locked out until the backfill SQL (documented in `_supabase-setup.sql`) is run.
- **Admin console**: functional, but only lists accounts that already have a profiles row.
- **Per-account privacy**: since v1.8.5 each account stores its ledger in its own `ledgers.user_id` row (RLS-enforced). The old "one shared `shared_ledgers` row belongs to every approved account" model is gone; the legacy `'main'` row is ADMIN-ONLY (old non-admin clients are denied reads) and is adopted exactly once into the admin's private row.

### Known gaps / technical debt

- **Whole-ledger JSON row**: no per-record server storage, Realtime payload-size ceiling for large ledgers, full-row writes on every save.
- **Per-device local-first model** is the root cause of "each device shows its own data": stale local copies with newer timestamps, or devices without Supabase reach, will keep old numbers. Mitigations exist (truth checker, round-trip test, force-copy buttons, finished-over-packing rule, change-only price stamping), but devices must run build v1.13.9 and be hard-refreshed.
- Dead-UI remnants (legacy "Server settings" auth block), stale README references (pan-timer key wording), and `demoBtn` guard only checking production/entries.
- Multi-tab same-browser editing can clobber (no storage-event mediator yet).

### Recently fixed — "device B stops updating" (session-expiry freeze)

A follow-up symptom after the work above: **device A kept cooking fine, but device B — which had pulled the same data at login — showed a frozen snapshot no matter how many times the browser was refreshed.** The sync engine itself (merge/LWW/tombstones) was healthy; the freeze lived in the transport layer:

1. **Reads never healed an expired session.** Supabase-js serves the *cached* session (`getSession()`), so a device whose access token silently expired still booted as "signed in" (the cached profile stays approved, so the boot gate passes), but **every** `getLedger()` read returned 401. `saveLedger()` already healed a dead token via `getUser()` and a retry; `getLedger()` did not — so every refresh pulled the same failure, and the single 8s reconcile retry died quietly. B looked "synced" while never pulling again: the reported symptom exactly.
2. **The single-flight write queue had no watchdog.** A cloud write request that never resolves left `cloudPushInFlight` set forever — every later save returned the stuck promise, pushed nothing, and (crucially) never marked the pending-sync flag or showed a failure. The cloud row froze, so B's refreshes were telling the truth: the cloud never changed.

**Fixes (all in `js/cloud.js` + `js/supabase.js`):**
- `getLedger()` now mirrors `saveLedger()`'s heal: on a JWT/401 error it calls `getUser()` (which refreshes the access token server-side) and **retries the read once** — a refreshable expired session converges on the very next refresh. A dead refresh token keeps `this.user` (so the 8s reconcile / 60s poll loops stay alive) and surfaces an honest "session expired — sign in again".
- `cloudPush()` time-boxes every attempt (`CLOUD_PUSH_TIMEOUT_MS`, 30 s default) and `supabaseGet()` time-boxes reads (20 s default) via `Promise.race` — a hung request becomes a normal queued/retrying failure instead of a permanent jam.
- `cloudAfterSignIn()`'s reconcile retry re-arms on failure so a device sitting on a dead session keeps retrying instead of giving up after one attempt.

**Verification:** new `_verify_two_device_sync.js` runs the real sync pipeline (config → helpers → suppliers → cloud → supabase) against a supabase-js-v2-faithful fake (cached `getSession`, network `getUser`, 401s while the access token is expired) and proves 21/21 checks: fresh-pull, healthy refresh, A's expired-token push self-heal → B converges, **B's own expired session healing on a single refresh (read-side)**, A's dead-refresh-token (zero loss, drains after re-login), and hung reads/writes timing out honestly. All 20 pre-existing `_verify_*.js` suites still exit 0.
---

## 6. Future Recommendations

### Architecture

1. **Add a monotonic write stamp (`rev`) to `shared_ledgers`** so a device holding an old snapshot cannot silently overwrite a newer cloud row; reject stale pushes and force pull-then-merge.
2. **Consider record-level or partitioned storage** (one row per month, or a `LedgerEntry` table) once the ledger exceeds ~1–2 MB, removing the single-row bottleneck and the Realtime payload ceiling.
3. **Add a storage-event mediator** for multiple tabs on one device, so tabs converge on a single in-memory `state`.

### Product / UX

4. **Make staleness visible on every boot**: a non-blocking banner ("Cloud last saved HH:MM", "this device differs from cloud") driven by `compareCloudAndDevice()` so divergence is never invisible.
5. **Deployment runbook**: the most common cause of "nothing changed" is stale cached JS. Add an automatic build-marker check against `index.html` and document the hard-refresh requirement prominently.

### Security

6. Harden AI API-key storage (currently plaintext in localStorage); consider obfuscation, a server-side proxy, or input restrictions for custom LLM endpoints.
7. Add role-based policies on `shared_ledgers` (e.g., read-only "viewer" role) so junior-approved accounts cannot wipe the business ledger.
8. Enable Supabase email confirmation, add login rate-limit guidance, and run the profile backfill SQL for pre-existing accounts.

### Engineering hygiene

9. Re-point all `_verify_*.js` scripts and README to the current build; move `_split.ps1`/`_gen_icons.js` to a `tools/` directory; enforce that `?v=` stamps and `sw.js` `CACHE_VERSION` are bumped together on every release (a small pre-commit check).
10. **Close the price-history merge gap**: when a price value is changed by a merge, optionally append a system-authored `priceHistory` row so "no update history" is never a mystery on any device.

---

### Closing note

The recent symptom — "every device shows its own data; new logins show old values" — is consistent with the **local-cache + timestamp-reconcile** architecture rather than a single code defect. The correct operational sequence is:

1. Deploy build **v1.13.9** and **hard-refresh every device** (verify the "App build" line in Sync & Backup).
2. On the device with the real data: run **Cloud Round-Trip Self-Test**, then **Overwrite Cloud With This Device**.
3. On each stale device: **Compare Cloud vs This Device**, then **Sync Now** (or **Load Cloud Onto This Device**).

Recommendations 1–3 in Section 6 would eliminate this class of behaviour at the architecture level.