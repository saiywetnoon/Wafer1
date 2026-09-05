I now have a complete picture of the project. Let me compile the full review.

---

# 📋 Daily Crispy Roll Ledger — Full Project Review (v1.10.2)

## 1. What this project is

A **single-page business operating system for a crispy-roll food vendor in Myanmar (currency: Ks)** — `index.html` + 25 classic JS files (~6,000 lines) + 1 CSS file, backed by **Supabase** (email/password auth, RLS-gated accounts, whole-ledger JSON row + Realtime sync) with a legacy **Google Apps Script** fallback. It covers production (mix-first workflow), sales with weighted-average COGS, inventory movement history, customers/credit, suppliers/payables, a cash drawer, 3 frying-pan kitchen timers, business tools (recipes, break-even, forecast, purchase list), an AI root-cause analyser, and account approvals (first account = admin).

I verified syntax of all 25 JS files (all pass), reviewed all core modules, the SQL security setup, the Apps Script backend, README/ROADMAP, and git history.

---

## 2. What is genuinely good (keep — don't break this)

| Area | Why it's good |
|---|---|
| **Security model (SQL)** | RLS + `is_admin()`/`is_approved()` helpers, `protect_profile_fields` trigger, advisory-lock serialisation of the "first account becomes admin" race — genuinely well-thought-out (`_supabase-setup.sql`) |
| **Sync reconcile logic** | "The copy with MORE real records wins (ties → newest timestamp)" is the correct fix for the stale-partial-copy deadlock, and it's test-backed (`js/cloud.js`, `_verify_sync.js`) |
| **Mix-first production workflow** | Ingredients saved once, finished goods added only after packaging → no double inventory deduction; draft recovery + stale-draft prompt are excellent data-loss guards |
| **Pan timers** | Wall-clock `endAt` recompute means background-tab throttling can't drift timers; per-pan overrides + auto-report to Production (`js/pan-timers.js`) |
| **Diagnostics** | Build-mismatch toast (`__LEDGER_BUILD` vs `data-build`), honest CDN-failure reporting for Supabase, offline queue + retry — the author clearly battles stale-cache/offline issues pragmatically |
| **Honest roadmap** | ROADMAP marks features ✅/🟡/⬜ with acceptance gates instead of claiming done |

---

## 3. Developer side

### 3.1 ADD (dev tooling / architecture)

1. **A real build pipeline (`package.json`).** There is zero tooling — no linter, no test runner, no bundler. The 8 `_verify_*.js` scripts that *do* exist are manually distributed. Add:
   - `npm test` → runs every `_verify_*.js` + `node --check js/*.js`
   - ESLint + one formatting pass (the codebase mixes `var`/`const`, `function`/arrow, 2-space/4-space)
   - **Content-hashed filenames** to replace the manual `?v=20260903` cache-busting on all 25 scripts and the bespoke build-marker discordance checks

2. **Vendor the CDN libraries locally** (`lib/tailwind.min.css`, `lib/chart.umd.js`, `lib/lucide.min.js`, `lib/supabase.js`). This kills FOUC, works offline, and removes a top performance bottleneck (see 3.2). At minimum add **SRI integrity attributes** to every `<script src=…>` in `index.html:7-10,44`.

3. **Unit tests for the money math.** `rebuildStockAndCogs()`, `saleProfit()`, `financeTotals()`, `cashExpectedToday()` are the financial core and are only eyeball-tested. These are the highest-value tests to write.

4. **A migrations array.** `state.version = 2` exists but migrations are ad-hoc `if (old)` patches. A versioned `migrations` list keyed off `state.version` makes every future data-shape change safe.

5. **Central error boundary.** `renderAll()` (`js/init.js:4`) runs 15 renders in sequence — one exception in any of them silently kills the rest. Wrap each render and log to console + show a toast.

6. **Structured audit log** (`{ who, when, what, before, after, reason }`) for every edit/delete/approve/cash-close. ROADMAP asks for it; it's also what makes a multi-role team trustworthy (see roadmap item 7).

7. **GitHub Actions.** The repo is public at `github.com/saiywetnoon/Wafer1`; a tiny CI running `node --check` + the verify scripts + a SQL/lint sniffer would catch regressions immediately.

8. **`.gitignore` / secrets note.** The Supabase **anon key + project URL are committed to a public repo** (`js/config.js:60-61`; `GOOGLE_CLIENT_ID` empty at line 45). Anon keys are *meant* to be public (RLS is the protection), but the bigger risk is: **anyone on the internet can sign up to this project, and the FIRST sign-up ever becomes admin**. Add Supabase **CAPTCHA on signup**, and give the true owner a recovery path if someone else claims admin first.

### 3.2 UPDATE / UPGRADE

1. **Tailwind Play CDN → precompiled CSS (highest-impact change).** `cdn.tailwindcss.com` compiles classes *in the browser at runtime* (~350 KB parser, needs internet, blocks first paint, re-parses per element). For a business app targeting Myanmar phones with expensive/offline-prone connectivity, this is the #1 reliability risk — if that CDN is blocked, the entire UI loads unstyled. Upgrade to `@tailwindcss/cli` → `dist/tailwind.css` or a static build. (This also unblocks the PWA/offline roadmap item.)

2. **Classic scripts → ES modules.** 25 files share one global scope; correctness depends on load order (`init.js` last, `google.js` deliberately overridden by `init.js`). This is the most likely source of future "editing one file broke another" pain. ES modules give explicit imports, no ordering footgun, tree-shaking.

3. **Whole-ledger blob → row-level records** (roadmap item 7). Today all data lives in one `ledgers.payload` JSONB row with last-write-wins: two staff editing simultaneously = silent overwrite. This is the single biggest data-integrity risk as the business grows. Also swap localStorage (5 MB cap, sync API) for **IndexedDB** for offline-first persistence.

4. **Finish the two live backends→one.** Supabase is the real backend, but the UI and code still carry the whole legacy Google Apps Script path:
   - `js/auth.js` legacy branches (`AUTH_TOKEN_KEY`, `authPost`, `legacyStoreLogin`), `js/google.js`, `js/init.js` Sheets-API functions, `google-sync.gs`, and the entire "Google Apps Script URL / Drive folder" setup instruction block in the Sync tab (`index.html:1200-1211`).
   - Double the code = double the attack surface and maintenance. Either formally deprecate the legacy path (hide its UI; prune its code) or keep it clearly documented as maintenance-only.

5. **Fix the account-approval UX gaps.** No **password reset UI exists anywhere** (verified zero references). Add Supabase `resetPasswordForEmail` + a "Forgot password?" link on the login screen. Also: rejected/pending users get no explanation of *why* or how to reach the admin.

6. **Replace all 25+ native `confirm()`/`prompt()` calls** (see listing below) with in-app modal components. Native dialogs block the JS thread (pausing the timer UI tick on phones), are unstylable, and `prompt()` input can't be validated inline.

7. **Kill the UTC date drift in `getExpiringBatches()`** (`js/dashboard.js:27`): it compares local production dates against a **UTC**-computed `toISOString().slice(0,10)` — in Myanmar (UTC+6:30) the "expiring in 3 days" alert can fire/not-fire on the wrong day near midnight. Reuse the local `today()` helper.

8. **Receipt/report printing via `document.write()`** (`js/sales.js:226`, `js/tools.js:339`) — replace with a hidden print-area template + `@media print` CSS; popups can be blocked and this is unmaintainable HTML-in-strings.

9. **Fix `js/supabase.js:88`** duplicate assignment: `this.profile = this.profile = Object.assign(this.profile, data);`

10. **Adopt `toFinite`/`toMoney` consistently.** `helpers.js` already defines these guards, but `parseFloat(...)` still sits unchecked in many input paths (`cash.js:147-152`, `inventory.js:119`, `tools.js:60`) where `"1,200"` or `""` would silently produce NaN.

11. **Version-pin ALL dependencies.** Chart.js is pinned (`@4.4.1`) but lucide (`@1.34.0`), Tailwind, Google Fonts, and the GSI client `accounts.google.com/gsi/client` (`index.html:10`) are loaded unconditionally — even though `GOOGLE_CLIENT_ID == ''` means Google sign-in never actually appears. That's a wasted network dependency on every load.

### 3.3 REMOVE

1. **`_split.ps1` — dangerous dead tooling.** It reads `daily-ledger-1.1.html`, which **no longer exists in the repo or locally** (verified: deleted in commit `72d5834`). Any attempt to run it errors out (`-ErrorActionPreference Stop`), and — worse — if the file were ever restored, it would **overwrite `index.html`, `css/styles.css`, and 15 of `js/*` with the outdated v1.1 content**, destroying v1.10.2. Delete it and the README paragraphs referencing it and the "preserved byte-for-byte backup" claim (the README's statement "nothing is lost" is now **false**).

2. **The dead Multi-Company workspace feature.** For any logged-in user, `companyBootstrap()` forces `ACTIVE_COMPANY = 'acct-<email>'` (`js/companies.js:39-45`), so the "Switch workspace" topbar button (`index.html:67`) opens a screen where creating/opening a company can never take effect — it's misleading dead UI in Supabase mode. Either implement per-account real workspaces (roadmap item 7) or hide the button and delete `companies.js`.

3. **Legacy Google Sheets/Drive UI in the Sync tab** (`index.html:1186,1192-1211`) — a real user following those steps would paste a URL that does nothing in Supabase mode.

4. **Dead branches after cleanup:** `state.entries` + `migrateLecacyEntries()` once migrated; `gooogleSheetsId` legacy vars in `config.js`; the `?v=` query-string hand-maintenance.

### 3.4 Bugs & risks found (verfied in code)

- **First-sign-up-becomes-admin race for real:** the SQL serialises *simultaneous* signups, but if a stranger signs up before the owner does (pub repo!), they own the app. No owner-claim path exists.
- **`getExpiringBatches` UTC/local mismatch** (above).
- **Supply-chain:** NO SRI on any of the 6 CDNs; a compromised unpkg/jsdelivr/tailwind package would run with full app priviledges (the app holds customer & financial data).
- **No audit trail:** any approved user can edit/delete production, sales, cash adjustments, or restore a full backup with no trace — needed for multi-staff trust.
- **`escape` in inline onclick strings** is handled, but receiving-row HTML is built via `innerHTML` with `esc()` everywhere — *good*, keep it that way when refactoring.

---

## 4. User side

### 4.1 ADD (features users will actually ask for)

1. **Password reset / "forgot password"** — an absolute must; today if a staffer forgets their password they're locked out forever (admin can't even reset via UI).
2. **PWA / installable app (roadmap item 6):** the app already operates offline-ish; making it installable + adding `manifest.webmanifest`/serviceworker would put an app icon on the owner's home screen — the expected dielivery for a daily-use kitchen tool.
3. **WhatsApp receipts & debt reminders** — listed in their own "deferred decisions"; for Myanmar retail debt-chasing this is inst rejected; it's probably the #1 revenue-protection tool. Even a "share as text/WhatsApp" button on the receipt+statement screens.
4. **Ingedient + finished-good expiry/batch tracking** — roadmap item 4. Low-stock alerts exist (`dashboard.js` red cards), but items expiring are only partially covered and only for finished batches (`useBy`) — no ingredient best-before.
5. **Burmese language toggle + currency settings** (their dexferred decision). All 6,000 lines of UI strings are hardcoded English; a small i18n dictionar over the existing `showToast`/`innerHTML` seam is enough to start.
3. **Real daily cash close (roadmap item 3):** expected-vs-counted + variance *persisted per day*, closed-day lock with a reopen-reason — the current Cash tab has the count line but no close/reopen workflow or daily record.
7. **Sale returns/refunds:** restock returned pieces, reverse the credit/refund from cash, with a reason — today the only option is deleteing the sale and re-ровка everything.
8. **Excel/PDF eports** — merchants share ledgers with accountants who don't want CSVs; a simple `exportSalesCsvBtn`-adjacent `.xlsx` (SheetJS) and a prtable PDF report.
9. **WhatsApp/push notif for the pan timers when the tab is closed** — currently timers only work while the page is open; a service worker + push is the real fix for a kitchen tool.
10. **Onboarding warmup:** first run → set hourly wage, opening cash, review the 12 default ingredients, watch a 45-second demo.

### 4.2 UPDATE / UPGRADE

1. **Offine first paint.** Bundle all CSS/JS locally (3.2-1) so on a bad Wi-Fi morning the app still opens styled and usable.
2. **Speed at data grows.** Every save re-renders the whole app (`renderAll()`); with 2-3 years of data the dashboard/calendar/finance totals recalc is wasteful. Target-diff re-renders or memoize.
3. **Lists need search/sort/filter** — Sales, Customers, Supplier purchases, Inventory movements, Calendar/Audit only sort/aggregate; staf will scroll a lot.
4. **Mobile polish:** native dialogs → in-app modals; safe-area insets for notch phones; `role="tab"` already exists but add keyboard/focus- trap for modals and `aria-label`s for icon-only buttons (accessbility for older users with large-print needs).
5. **Charts:** currently only bags-produced vs date; add revenue/profit overlay + a comparison vs last week.
6. **Number entry helper:** on phones, `type="number"` keyboards + the live cost readout is good; add a large on-screen keypad mode for the Sales quick-entry (the `CashHooks` API already anticipates a hardware hook).
7. **Better backup UX:** today it's "download JSON / restore JSON" + an irrelevant Drive section. Make it one button: "Back up now" → timestamped, and "Restore" with a preview of what would be replaced (roadmap item 7: automatic server-side version history).

### 4.3 REMOVE (for users)

1. **The confusing "Setup instructions" block in Sync & Backup** — Apps Script URL / Drive folder ID steps that only apply to a backend the app no longer uses. Users who read it will conclude sync is broken.
2. **Sample Data / Clear All are already hidden in a labelled "Danger Zone"** — good. Go one step further: don't offer them at all once real data exists (or require typed confirmation).
3. **Multi-company "Switch workspace" for non-logged-in/local mode** — in Supabase mode it's non-functional (see 3.3-2); hide it to reduce confusion.

---

## 5. Suggested priority order

| Phase | Move |
|---|---|
| **P0 (safety, this week)** | Password reset UI · Supabase CAPTCHA + owner-recovery · fix `getExpiringBatches` UTC bug · fix `supabase.js:88` · remove/disable `_split.ps1` · correct README claims |
| **P1 (reliabity)** | Vendor/bundle Tailwind+Chart.js+lucide+Supabase locally (+SRI) → PWA shell → IndexedDB persistence → offline queue finish |
| **P2 (teams & data)** | Row-level records + workspaces/roles (roadmap 7) → audit log → daily cash close + reopen (roadmap 3) → automatic versioned backups |
| **P3 (grrowth)** | WhatsApp receipts/reminders · Burmese locale + currency settings · batch/expiry for ingredients (roadmap 4) · sale returns |
| **P4 (tech debt)** | ES-module migration · delete legacy Apps-Script path & company-screen dead UI · ESLint/prettier/CI · content-hash cache-busting |

---

## 6. What I runs against the code

- `node --check`/`new Function()` on all 25 `js/*.js` → all pass (incl `init.js`, `cloud.js`, `helpers.js`)
- Full read of `_supabase-setup.sql`, `google-sync.gs`, `README.md`, `ROADMAP.md`, `config.js`, `storage.js`, `init.js`, `supabase.js`, `auth.js`, `cloud.js`, `companies.js`, `sales.js`, `cash.js`, `dashboard.js`, `tools.js`, `sample-data.js`, `pan-timers.js` (header), key parts of `helpers.js`/`sync-ui.js`/`ledger.js`/`inventory.js`
- Git history — confirmed `daily-ledger-1.1.html` was deleted (`72d5834`) and is gone locally; verified no `package.json`, manifest, service worker, or CI exist
- Confirmed absent: password-reset code (zero matches); confirmed 25+ `confirm()`/`prompt()` usages; confirmed un-SRI'd CDNs

---

**Bottom line:** the app is functionally rich, unusually careful about data integrity for a no-build vanilla project, and its security base (RLS + account gating) is well done. The main risks are all "next step" problems: **runtime-CDN dependency for the entire UI**, **whole-ledger last-write-wins sync**, **a now-false README/backup claim**, **no password reset**, and **two backends living side-by-side**. Fixing the top 2 P0/P1 items would materially harden this app for real daily use.

Want me to start implementing any of these — e.g. the P0 safety fixes (password reset, `_split.ps1` removal, UTC bug, README corrections) or the vendor-local-assets/PWA build?