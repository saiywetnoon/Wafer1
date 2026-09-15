# ALGORITHM REFERENCE — Daily Crispy Roll Ledger v1.7

> **Scope:** every section, feature and function in `js/` (29 modules) plus `sw.js`, mapped to the
> *type of algorithm* it implements, the exact mechanism used, and (where meaningful) its
> complexity in terms of `n` = records in a collection, `m` = collections, `k` = devices, and
> `c` = config/price-list entries.
>
> **Source of truth:** this document was derived by direct code inspection of the current
> `main` tree. Line references are stable function names, not line numbers, because the file
> layout evolves.
>
> **Related documents:** `PROJECT_STATUS_AND_ARCHITECTURE.md` (feature/behaviour report),
> `COURSE/` (plain-english teaching versions of the core algorithms).

---

## 0. How to read this document

### 0.1 Algorithm-family legend

| Tag | Family | Meaning |
|---|---|---|
| **AGG** | Aggregation / fold | `reduce`-style linear pass producing a scalar or bucket map |
| **GRP** | Group-by / bucketing | Hash-map bucketing by key (usually ISO date) |
| **SORT** | Ordering | Comparator sort (date-first, then secondary key) |
| **REPLAY** | Event sourcing replay | Sort events chronologically, fold balances/COGS through them |
| **AVGC** | Average-cost inventory | Weighted-average cost flow for COGS stamping |
| **LWW** | Last-write-wins | `updatedAt` timestamp comparison decides the winner |
| **UNION** | Set union / additive merge | Hash-indexed union of two record collections, nothing dropped |
| **TOMB** | Tombstone soft-delete | `collection|id` → ISO-time map filters live records |
| **DEDUPE** | Hash dedupe | `Map` keyed by record id/name, last duplicate kept |
| **DEBN** | Debounce (trailing) | `clearTimeout` + `setTimeout`, collapse bursts into one run |
| **POLL** | Polling | `setInterval` background refresh fallback |
| **SGLF** | Single-flight / coalescing queue (time-boxed) | In-flight promise + "requested" flag; never two concurrent writes; hung attempts fail via watchdog |
| **CFG** | Derived-state recompute | Store the raw ledger, always recompute derived values |
| **VAL** | Guarded validation | Coerce/validate input, reject on failure (no silent garbage) |
| **MSM** | Minimal state machine | Two-phase or staged states (e.g. PACKING→FINISHED) |
| **SCHED** | Wall-clock scheduling | `endAt` anchors recomputed on tick (immune to tab throttling) |
| **WALK** | Tree walk | DOM TreeWalker traversal with memoization |
| **STAT** | Statistical estimator | Median / average / percent-diff baselines |
| **RULE** | Rule engine | Threshold-triggered findings with severity/confidence scoring |
| **DIFF** | Structural diff | Canonical-form JSON comparison to detect real changes |
| **FP** | Fingerprint / canonical form | Normalized stringify used as an identity key |
| **REPL** | String/regex transform | Escaping, UA parsing, keyword classification |
| **AUTH** | Session / gate logic | Token persistence + approval state machine |

### 0.2 The one rule the whole system obeys

> **Store facts, compute views.** The ledger only stores *events and facts* (a batch was rolled,
> a sale happened, a payment arrived, an ingredient moved). Everything a screen shows — stock,
> COGS, profit, customer debt, supplier payables, inventory levels — is a **deterministic
> function of those facts**, recomputed on demand. This makes the whole app merge-friendly:
> two devices can hold slightly different *derived* values without that ever being a conflict.

---

## 1. System-wide data flow (where each algorithm family lives)

```
  UI event (input/click)
      │
      ▼
  [VAL] validate/coerce  ──►  mutate state facts (arrays / maps)
      │
      ├──► [CFG] re-derive: rebuildStockAndCogs(), normalizeCustomerBalances(),
      │        normalizeSupplierPayables(), syncInventorySnapshot()
      │
      ├──► [DEBN 300ms] persistState() ──► saveState()
      │        │ JSON.stringify → localStorage["dailyCrispyRollLedger_v2_acct-<email>"]
      │        └──► [DEBN 900ms] triggerGoogleSync() ──► cloudPush()
      │                 └──► [SGLF] single-flight whole-ledger write → Supabase row
      │                       on failure: [TOMB-safe] syncQueueMark() + retry [POLL 20s]
      │
      └──► renderAll()  = ordered [CFG] pipeline → [AGG]/[GRP]/[SORT] per tab → DOM
                                     └──► [WALK] i18n pass

  Remote copy arrives (realtime / poll / sign-in)
      │
      ▼
  [FP] echo suppression (device/session id) ──► [FP] decision cache (fingerprint)
      │                                            │ already decided → silent path
      ▼                                            ▼
  [UNION] additive merge by recordUnionKey (id→name→date→ing→JSON)
      │        same-record clash → [LWW] newest updatedAt wins
      │        production clash  → [MSM] FINISHED (pieces>0) always beats PACKING
      ▼
  [TOMB] applyDeletionTombstones() ──► [CFG] re-derive everything ──► renderAll()
      │
      └── unresolved divergence → sync-review modal (user picks the official copy)
```

---

## 2. `js/config.js` — workspace identity & key derivation

| Function | Algorithm | Mechanism | Complexity |
|---|---|---|---|
| `companyKeys()` | **Key derivation** | Builds the two storage keys (`dailyCrispyRollLedger_v2_<scope>` state, `..._draft_<scope>` draft) from the active workspace id. Account mode: scope = `acct-<email>` (deterministic, one namespace per login). Company mode: scope = company id; the pre-accounts `default` workspace keeps the *unsuffixed* legacy keys so old data keeps loading. | O(1) |
| `companyStateKey()` / `companyDraftKey()` | **Accessors** | Return one half of `companyKeys()`; all persistence funnels through them so every cache write below is implicitly workspace-scoped. | O(1) |
| `DEFAULT_PRICES`, `DEFAULT_USAGE`, `DEFAULT_ROLLS_PER_BAG` | **Seed data** | Static arrays/maps deep-cloned into a fresh state (`JSON.parse(JSON.stringify(...))`) so runtime mutation never aliases the defaults. | O(c) per clone |

## 3. `js/companies.js` — multi-workspace registry

| Function | Algorithm | Mechanism | Complexity |
|---|---|---|---|
| `persistCompanies()` / `readCompanies()` | **Serialize / parse with repair** | Whole-list JSON round-trip through `localStorage[COMPANIES_KEY]`; a parse failure or non-array result is repaired to `[]` (defensive, never throws). | O(w) workspaces |
| `getActiveCompanyId()` | **Registry lookup** | Reads the persisted "active" pointer. | O(1) |
| `companyEntryCount(id)` | **Probe** | Opens another workspace's state JSON and counts legacy `entries` keys — a size indicator for the workspace picker. | O(entries) |
| `companyBootstrap()` | **Decision tree** | (1) If an account email exists → deterministic workspace `acct-<email>`, done. (2) Else read companies; empty registry → create `{id:'default'}` (first-run). (3) If the active pointer names an existing company → open it. (4) First run with no pointer → auto-open `default` (zero clicks for single-company users). (5) Else show the workspace picker screen. | O(w) |
| `displayNameFromEmail()` | **String transform** | Local part of email, first char uppercased. | O(len) |
| `createCompany()` / `loginCompany(id)` / `deleteCompany(id)` | **Registry CRUD + reload-scoped switch** | Creating appends `{id: uid(), name}`; "login" writes the active pointer then `location.reload()` — a **full-reload namespace switch**, which is the simplest correct way to swap every in-memory cache at once. Deleting removes the workspace's state+draft keys (local only; cloud copy survives) and clears the pointer if it pointed at the deleted one. `default` is undeletable. | O(w) |

## 4. `js/storage.js` — state model, debounced persistence, draft recovery

**State shape (facts only — see §0.2):** `prices, priceHistory, production, sales, waste, customers,
suppliers, purchases, payments, customerPayments, expenses, recurringExpenses, recipes,
inventoryMovements, inventory{}, deletions{}, cash{opening,adjustments[]}, draft, stock{},
settings{}, inventoryMovementVersion, version, updatedAt`.

| Function | Algorithm | Mechanism | Complexity |
|---|---|---|---|
| `persistState()` | **DEBN (trailing 300 ms)** | `clearTimeout(saveTimer); saveTimer = setTimeout(saveState, 300)`. Every keystroke in the price/usage tables collapses into one write. | O(1) per trigger |
| `saveState()` | **Serialize + side-effect fan-out** | Stamps `state.updatedAt = now` (the LWW currency), `JSON.stringify(state)` into `companyStateKey()`, then — unless `cloudSyncSuppressed` (echo guard while applying a remote copy) — calls `triggerGoogleSync()` which is itself a 900 ms debounce. One user edit ⇒ exactly one local write ⇒ one coalesced cloud write. | O(n) serialize |
| `loadState()` | **Parse with repair** | Reads+`JSON.parse` the workspace key; any failure returns a pristine default state instead of throwing. Migrations (legacy `entries` → production/sales) run afterwards. | O(n) |
| `migrateLegacyEntries()` | **One-time schema migration** | Version-guarded: converts the old `{date → {bags, pieces, ...}}` day-map into today's event arrays. Guard flag prevents re-running (idempotence). | O(entries) once |
| `persistDraft()` | **DEBN (trailing 400 ms) + mirror** | Saves the live production-form draft into `state.draft` (synced like any other field) *and* a local mirror at `companyDraftKey()`. | O(usage c) |
| `draftHasRealContent(d)` | **Emptiness predicate** | Rejects all-zero/all-blank drafts so blank forms never sync as "data". | O(c) |
| `loadDraftIfNewer()` | **Version comparison + cleanup** | Picks the draft from `state.draft` (cloud-synced) else the local mirror; if none → nothing. If a committed production batch already covers the draft's date, **drop the draft** (stale). If the draft is blank → drop. If the draft is from an *earlier* day → `applyStaleDraftRecovery()` (offer once per session); else `restoreDraftToForm()` (field-map apply). | O(production) |
| `restoreDraftToForm(d)` | **Field-map binding** | Iterates a `{elementId: value}` map and writes each into the form; reselects the draft's date. | O(fields) |
| `applyStaleDraftRecovery(d)` | **Once-per-session prompt** | `olderDraftPrompted` latch; decline keeps the draft (never deletes unsaved work). | O(1) |
| `clearDraft()` | **Dual-erase + propagate** | Clears `state.draft` and the local mirror, then `saveState()` so other devices stop showing it. | O(1) |
| `setCloudSyncSuppressed(v)` | **Echo guard flag** | Set while applying a remote copy so `saveState()` inside that apply does not re-push the copy back (which would loop realtime events forever). | O(1) |

---

## 5. `js/helpers.js` — the algorithmic core (math, replay, tombstones, balances)

### 5.1 Micro-utilities

| Function | Algorithm | Mechanism | Complexity |
|---|---|---|---|
| `$` / `fmt` / `fmtKs` / `esc` | **DOM lookup / REPL** | `esc` is a single-pass `replace` over the five HTML-significant characters (`& < > " '`) — the standard XSS guard for every interpolated string. | O(len) |
| `today()` | **Timezone-anchored date** | `now − getTimezoneOffset·60000` → ISO slice. Produces the *local* calendar day regardless of the device's UTC offset. | O(1) |
| `uid()` | **Random identifier** | `Date.now().toString(36) + random(6)` — monotonic prefix + entropy suffix; collisions are practical-impossible and ids double as sort hints. | O(1) |
| `toFinite(v, fb)` / `toMoney(v)` / `clamp(v,min,max)` | **VAL guarded coercion** | Every ledger reads a number through `toFinite` (`Number.isFinite` check, fallback), money through `toMoney` (2-dp rounding). Eliminates the classic `NaN`-propagation bug class. | O(1) |
| `pad2` / `fmtDateTime` / `safeIcons()` | **Formatting + containment** | `safeIcons` wraps the icon CDN call in try/catch: icons are cosmetic and may never crash the ledger. | O(1) |

### 5.2 Ordering & day-bucketing

| Function | Algorithm | Mechanism | Complexity |
|---|---|---|---|
| `prodList()` / `salesList()` | **SORT (date asc)** | Stable copy (`slice().sort()`) so callers never mutate the stored arrays. | O(n log n) |
| `entriesSorted()` | **GRP + SORT** | Legacy day-map → array of `{...day, date}` then key sort. | O(n log n) |
| `entriesProdSales()` | **GRP (hash bucket by date) + AGG + SORT** | One pass over `production` and one over `sales` bucketing into `map[date]`, summing capital/labor/revenue/cogs per bucket; `net = revenue − cogs` folded per bucket; output sorted by ISO date (lexicographic = chronological). This is the backbone feeding the dashboard, calendar, audit table, CSV and printable report. | O(n log n) |

### 5.3 Finished-goods replay — the app's most important algorithm

| Function | Algorithm | Mechanism | Complexity |
|---|---|---|---|
| `replayStocksAndCogs(production, sales, waste)` | **REPLAY + AVGC** | (1) Flatten all three collections into events `{date, type: 0=prod, 1=sale, 2=waste}`. (2) **SORT** by date, ties broken `type` ascending — *production before sales/waste on the same day* (you can't sell what wasn't rolled that morning). (3) Fold: production adds `pieces` and `capital` to an implicit pool; each sale/waste takes `avg = poolCost / poolPieces` and is charged `costQty = min(qty, poolPieces)` × `avg` (rounded), then both pool counters decrease. (4) Stamps back onto the sale: `cogs`, `avgCost`, `net = amount − cogs`; onto waste: `cost`, `avgCost`. The `min(qty, available)` clamp is deliberate — surplus pieces (selling more than the ledger shows was produced) are charged **zero** extra COGS instead of silently inventing a loss. | O(n log n) |
| `rebuildStockAndCogs()` | **CFG re-derive** | Runs the replay over the live state and writes `state.stock = {pieces, cost}`. Called after every create/edit/delete of production, sales, waste — stock is *always* a function of the events. | O(n log n) |
| `projectedSaleCogs(record)` | **What-if simulation (pure fork)** | Clones production/sales/waste, **removes** the sale being edited (so it isn't double-charged), inserts the draft, runs the same replay, reads back the draft's `cogs/avgCost/net`. Powers the live COGS preview in the sale form. | O(n log n) |
| `finishedGoodsShortage(production, sales, waste)` | **Constraint scan over replay** | Same chronological event build/sort, but returns the **first** sale/waste event whose `qty > stock` — `{date, available, requested, type}` — or `null`. This is what prevents over-selling beyond stock *and* prevents a future batch from covering an earlier sale. | O(n log n) |
| `canRecordWaste(record)` | Guard wrapper | Same shortage scan, scoped to waste entry (tools.js uses it before appending). | O(n log n) |
| `saleProfit(s)` | **Formula** | `round(amount − cogs)`, with `cogs` accepted only when a finite ≥0 number (legacy rows without a stamp cost 0, never negative). | O(1) |

### 5.4 Money aggregation

| Function | Algorithm | Mechanism | Complexity |
|---|---|---|---|
| `financeTotalsAll()` | **AGG (multi-pass reduce)** | Totals over *all time*: capital, revenue, **cogs (only of sold goods)**, bags/pieces produced & sold, labor minutes/cost. Profit model: `net = Σ revenue − Σ sale.cogs`; unsold production cost stays in `stock.cost` and only hits profit when those pieces sell. | O(P + S) |
| `inventoryValue()` | **AGG + unit-aware pricing** | For each stock ingredient: `stock > 0` → `g`-unit items value `stock/1000 × price(per kg)`, unit items `stock × price`. | O(c) |
| `ingredientCostFor(usage)` | **AGG + unit-aware pricing** | Σ per ingredient: `g` → `qty/1000 × price`; unit → `qty × price`. The same formula powers production capital, break-even, target-profit and purchase-cost estimates. | O(c) |
| `totalMixWeightFor(usage)` / `ingredientWeightGrams()` | **AGG + unit conversion** | Grams for `g` items; `qty × weightPerUnit` for unit items — lets "total mix weight" stay meaningful when some ingredients are counted. | O(c) |
| `storageUsedKB()` | **Size probe** | `Blob([raw]).size / 1024` of the serialized state — honest quota indicator in the UI. | O(n) |
| `totalStandingOrders()` | **AGG** | Σ customer standing orders. | O(C) |

### 5.8 Notifications, badges & small UI folds (helpers.js tail)

| Function | Algorithm | Mechanism | Complexity |
|---|---|---|---|
| `csvCell(v)` / `csvRow(...)` | **REPL (RFC-4180 escaping) + injection guard** | Wrap in quotes, double the inner quotes; values starting with `= + - @` get a `'` prefix — blocks Excel/Sheets **formula injection** from ledger text. | O(len) |
| `showToast(msg, type)` | **Timed queue + i18n hook** | Toast text passes through `t()` when the Myanmar language is active; DOM node auto-removes after 3.2 s (+300 ms fade class). | O(1) |
| `flashEl` / `pulseSuccess` | **CSS-state timer** | Timed class add/remove (550 ms). `void el.offsetWidth` forces reflow so re-triggering restarts the animation. | O(1) |
| `wireResponsiveTables()` | **DOM walk + attribute lift** | For each `table.responsive-table`: reads `<th>` labels, stamps each `<td data-label>`; rows containing `td[colspan]` are flagged as friendly empty rows. | O(cells) |
| `refreshNotifications()` | **AGG + threshold scan** | Bell-menu items: low/out-of-stock ingredients (`stock ≤ lowAlert`), customers owing, expiring batches — each a filter pass. | O(c + C + P) |
| `refreshTabBadges()` | **AGG per tab** | Count badges: low-stock count (movement fold ≤ lowAlert), customers with `debt > 0`, drawer variance indicator, dirty-sync dot (`syncQueueIsDirty() ‖ cloudSyncFailed`). Display capped at `99+`. | O(c + C) |
| `wireSidebar()` | **Preference persistence** | Collapse state in `localStorage`, class toggle + tooltip sync. | O(1) |

---

## 6. `js/cloud.js` — the sync engine (merge, conflict, queue, reconcile)

### 6.1 Online-state & transport

| Function | Algorithm | Mechanism | Complexity |
|---|---|---|---|
| `cloudIsOnline()` / `cloudIsAvailable()` / `cloudReady()` / `cloudNeedsUrl()` | **Predicate gate** | Supabase mode: "online" = a session user exists — the login *is* the connection; no deployment URL is consulted. Legacy mode is retired (`cloudPost` always reports the backend was removed). | O(1) |
| `supabasePush()` | **Whole-row upsert** | `SUPA.saveLedger(uid, toGooglePayload())` — the entire ledger JSON is one payload written to the signed-in account's OWN private `ledgers` row (`user_id = auth.uid()`). Per-account privacy: a different account can never read or overwrite it. | O(n) serialize |
| `supabaseGet()` | **Read with error-vs-empty distinction** | A row with `.error` ⇒ read FAILED (never treat as "cloud empty" — that bug let stale devices overwrite a populated cloud); `null` ⇒ confirmed empty; otherwise payload + `exportedAt` + legacy flag. The read is `Promise.race`'d against `CLOUD_READ_TIMEOUT_MS` so a hung network request can never wedge the boot / poll / refresh path (a device would otherwise sit on its last-known snapshot with no pull and no error). | O(n) |

### 6.2 Write queue & single-flight serialization

| Function | Algorithm | Mechanism | Complexity |
|---|---|---|---|
| `cloudPush()` | **SGLF coalescing write queue** | Two vars: `cloudPushInFlight` (the live promise) and `cloudPushRequested` (a "one more pass" latch). A call while a write is in flight sets the flag and returns the *same* promise; the loop re-runs `cloudPushOnce()` while the flag is set, so the **last** pass always serializes the newest complete state — an older request can never finish after a newer one and resurrect stale data into the single cloud row. Every attempt is `Promise.race`'d against a `CLOUD_PUSH_TIMEOUT_MS` watchdog: a request that never resolves (dead network / wedged socket) becomes a normal failure — queue marked pending + honest status — so the 20s heartbeat retries instead of silently jamming every future save (that is what froze device B while device A kept cooking). | O(1) latch per call |
| `cloudPushOnce()` | **Session heal + transactional outcome** | Refreshes the Supabase session first (an expired token is healed or *reported*, never a silent 401), pushes, then: success ⇒ `syncQueueClear()` + `cloudMarkLastSync()` + clear `cloudSyncFailed`; failure ⇒ `syncQueueMark()` + `cloudSyncFailed = true` + honest status line. | O(n) |
| `syncQueueMark()` / `syncQueueClear()` / `syncQueueIsDirty()` | **Persistent dirty flag** | One-field JSON `{at}` in `localStorage` — survives reloads so "pending sync" stays visible until a push is confirmed. | O(1) |
| `cloudMarkLastSync()` / `cloudLastSyncAt()` | **Watermark** | Persisted ISO time of the last confirmed write; powers the honest "Last cloud sync" line. | O(1) |
| `flushPendingSync()` | **Event-triggered drain** | On `window online` (or manual): if dirty or last push failed → `cloudPush()` with a reconnect message. | O(n) |
| `initSyncFlushers()` | **Triple-trigger reliability net** | (1) `online` event → flush; (2) **20 s heartbeat** `setInterval` — while anything is queued/failed and cloud is ready, retry (self-healing without user action); (3) `beforeunload` → if a change is still debounced/queued (or a draft exists), fire `cloudPush()` now so closing the tab can't strand it. | O(1) per tick |
| `startCloudPolling()` | **POLL (60 s) fallback** | Realtime is the fast path, but a silently dead channel must not leave a tab stale for hours: every minute pull the cloud copy and hand it to `handleRemoteCopy()` (merge additively; never silently overwrite). | O(n) per poll |
| `supabaseUpdate(uid)` / `supabaseWatch(uid)` | **Realtime subscription + echo suppression** | On each realtime row: ignore when `!row.payload.state`; compare the row's `device.sessionId` with this tab's session — **an echo of our own write is recognized and ignored** (no re-render, no modal). Any *other* device's copy goes to `handleRemoteCopy()`. | O(1) gating |

### 6.3 Merge primitives — union + LWW (+ one domain rule)

| Function | Algorithm | Mechanism | Complexity |
|---|---|---|---|
| `recordUnionKey(it)` | **Composite identity cascade** | `id:<id>` → `name:<name>` → `date:<date>` → `ing:<ingredientName>` → `JSON(it)`. Id-keyed records (production, sales, payments…) merge by id; name-keyed price-list ingredients merge by name; legacy day entries by date. | O(key len) |
| `remoteWins(localIt, remoteIt)` | **LWW with legacy tie-breaks** | Parse both `updatedAt`; both parseable → `remote > local`; only remote stamped → remote wins (local is legacy); neither → keep local (don't disturb the visible copy). This single comparator is the entire conflict rule for same-record clashes. | O(1) |
| `productionRemoteWins(localIt, remoteIt)` | **Domain-priority override (MSM)** | If one side has `pieces > 0` (FINISHED batch) and the other `pieces == 0` (PACKING/mix), FINISHED wins **regardless of timestamps** — otherwise a device that merely typed on the mix form could downgrade every other device's finished batch back to "⏳ PACKING". Same-state clashes fall through to `remoteWins`. | O(1) |
| `mergeRows(localArr, remoteArr, winsFn)` | **UNION (hash-indexed additive merge)** | (1) Deep-clone local into `out`; build `indexMap: key → index`. (2) Per remote row: unknown key → push (additive; **nothing is ever dropped**); known key → replace only when `JSON differs && winsFn(local, remote)`. Every stored row is deep-cloned so local and merged copies never alias. | O(n + m) |
| `mergeEntriesObj(localE, remoteE)` / `mergeKeyedObj(localO, remoteO)` | **UNION over dict-shaped fields** | Same union/LWW semantics for the legacy `entries` day-map and keyed objects: missing keys added; present-but-different keys resolved by `remoteWins`. | O(n + m) |
| `mergeRemoteIntoLocal(remote)` | **Additive merge orchestration** | Sequence: (1) union the **deletions map** (a delete made on any device must reach every device); (2) `mergeRows` per collection, with `productionRemoteWins` applied only to `production`; (3) **re-derive** customer balances and supplier payables (row-level merge can keep a stale `debt`/`paid` when a new payment row arrived — the fold fixes it); (4) merge the inventory movement ledger via `mergeMovements`; `inventoryMovementVersion = max(local, remote)`; (5) purge tombstoned records; (6) recompute stock/COGS. Returns whether anything changed (drives re-render & re-push). | O(n + m + derive) |

### 6.4 Comparison, fingerprints & the derived-stock trick

| Function | Algorithm | Mechanism | Complexity |
|---|---|---|---|
| `computeStockSnapshot(o)` | **Pure REPLAY/AVGC** | The same replay as §5.3 but over an arbitrary state object and read-only. Used so "compare ledgers" and "render ledgers" **agree on what stock should be**. | O(n log n) |
| `normalizeForCompare(o)` | **Canonicalization** | Deep clone minus bookkeeping (`updatedAt`, `version`, `draft.capturedAt`) and with the **stored stock replaced by the derived replay** — two devices holding the same ledger usually carry different stock snapshots, and comparing the stored number caused phantom "only stock changed" popups after every refresh. | O(n) |
| `statesEqual(a, b)` | **DIFF by canonical JSON** | `JSON.stringify(normalizeForCompare(a)) === JSON.stringify(normalizeForCompare(b))`; any serialization failure reports "not equal" (safe direction). | O(n) |
| `stateFingerprint(s)` | **FP canonical form** | `JSON.stringify(normalized, keys sorted)` — a stable identity for "this exact ledger content", used as the sync-review decision-cache key. | O(n) |

### 6.5 Sync-review decision cache

| Function | Algorithm | Mechanism | Complexity |
|---|---|---|---|
| `syncDecisions()` / `syncDecision(fp)` / `setSyncDecision(fp, val)` | **Bounded decision cache** | A `localStorage` map `fingerprint → 'accepted' | 'declined'`, so a copy the user already decided about never re-asks (across reloads). Capacity control: when entries exceed **150**, oldest-inserted keys are evicted (FIFO via `keys.shift()`) — a simple bounded-cache policy that prevents unbounded growth of fingerprints. | O(entries) ≤ 150 |
| `buildSyncDiffHtml(local, remote)` | **DIFF sampler** | Human-readable change list for the modal: per-collection `added/removed/changed` counts with up to 4 sample labels, plus derived stock diff, inventory item counts, cash adjustments and draft date. | O(n + m) |

### 6.6 Remote-copy gate (the heart of "no silent data loss")

| Function | Algorithm | Mechanism | Complexity |
|---|---|---|---|
| `handleRemoteCopy(remoteState, remoteTs, source, deviceInfo)` | **Gate cascade / decision tree** | Each arriving remote copy flows through: (1) **echo gate** — the copy carries this tab's own `sessionId` ⇒ ignore (content comparison alone races while typing); (2) **identity gate** — `statesEqual()` ⇒ nothing to do; (3) **decision cache** — fingerprint already `accepted`/`declined` ⇒ replay that decision silently; (4) **additive merge attempt** — `mergeRemoteIntoLocal()` + tombstone purge; if the merge changed local data, push the union back so every device converges (self-healing); if the merge is a no-op **and** the remote is still different (true same-record conflicts), open the review modal; (5) **modal busy queue** — if the modal is already open, stash the newest copy in `syncReview.pending`. Returns a status string (`merged / pushed / pulled / aligned / modal`) that callers surface in the UI. | O(n + m) |
| `openSyncReview(remoteState, remoteTs, source, deviceInfo)` | **UI gate + dedupe** | Recomputes the fingerprint, checks the decision cache, fills the diff panel, labels the *exact* other device (`Chrome · Windows (PC)` via `deviceLabelOf`), never opens twice (queue instead). | O(n) |
| `resolveSyncReview(accepted)` | **User-arbitrated convergence** | **Accept** → suppress echo-guard, `applyCloudRemote()` (adopt the other copy), re-render, then `cloudPush()` so it becomes official for everyone; record decision. **Keep Mine** → record decision, `cloudPush()` this device's copy as official; nothing merged. Both branches converge the cloud so the question never repeats. Afterwards, if `syncReview.pending` holds a newer copy, reprocess it after an 80 ms `setTimeout` (modal-close ordering). | O(n) |
| `syncReviewTimeText(ts)` | **Formatting** | Locale "Mon D, h:mm AM". | O(1) |

### 6.7 Applying a whole remote copy (the "pull")

| Function | Algorithm | Mechanism | Complexity |
|---|---|---|---|
| `copyArrayFields(remote, fields)` | **Guarded copy** | Only assigns a collection when the remote actually carries a non-empty array — a partial copy can never null or downgrade a populated local collection. | O(fields) |
| `applyCloudRemote(remote, remoteTs, force)` | **Replace-with-guards + full re-derive chain** | (1) Optional data-count gate (`stateDataCount(remote) < local` ⇒ refuse unless forced — a fresh/empty copy must never overwrite a populated device). (2) Scalar/object fields copied only when the remote carries meaningful values (`prices` non-empty, `settings` present, …). (3) The **movement ledger is merged, never blind-replaced** (`mergeMovements`). (4) `applyDeletionTombstones()` — a pulled copy respects every tombstone. (5) **Re-derive chain:** `rebuildStockAndCogs()` (stock is never rendered stale after a pull), `normalizeCustomerBalances()`, `normalizeSupplierPayables()`, `migrateInventoryMovements()`. (6) Adopt the remote `updatedAt` as the local stamp so a duplicate/echo of the same write is recognized as already applied. (7) `saveState()` under the caller's echo-guard. | O(n + m + derive) |
| `stateDataCount(s)` | **Data-presence heuristic** | Counts *meaningful* records: all event collections, tombstones, inventory items **with** stock/lowAlert ≠ 0 (render-seeded zero placeholders don't count — that bug made fresh devices look "non-empty" and skip the pull), **customized** price entries only (vs `DEFAULT_PRICES`), price history, cash opening/adjustments, non-default settings, and a real draft. | O(n + c) |

### 6.8 Reconcile after sign-in

| Function | Algorithm | Mechanism | Complexity |
|---|---|---|---|
| `cloudAfterSignIn()` | **Decision tree with safe-fail retry** | Read fails (network/RLS/expired session) ⇒ **never** treat as "cloud empty"; show a retrying status and re-attempt once after **8 s** (`window.__cloudReconcileRetry` latch). Read ok: contents equal ⇒ done (legacy payload ⇒ push to migrate the workspace format). Cloud has data & local has none ⇒ **PULL** (`applyCloudRemote` + `loadDraftIfNewer`) — a fresh browser must never push its empty state over a populated cloud. Both empty ⇒ brand-new account, nothing to sync. Cloud empty & local has data ⇒ first sync: **PUSH**. Both have data & differ ⇒ `handleRemoteCopy()` (additive merge; only true conflicts open the modal). | O(n + m) |

### 6.9 Diagnostics & legacy shims

| Function | Algorithm | Mechanism | Complexity |
|---|---|---|---|
| `cloudRoundTripTest()` (sync-ui.js) | **Round-trip probe** | Write a unique token to the cloud, read it back, compare, restore the original payload — a self-test proving the transport works end-to-end. | O(n) restore |
| `cloudPost / cloudBackup / cloudList / cloudRestore / cloudClear` | **Stub layer** | The legacy Apps-Script endpoints were removed; each returns an explanatory `{ok:false}` so old call sites fail loudly and honestly. | O(1) |

---

## 7. `js/device.js` — device identity & attribution

| Function | Algorithm | Mechanism | Complexity |
|---|---|---|---|
| `getDeviceId()` | **Persistent random identity** | Lazy-create `'dev-<time36>-<rand>'` in `localStorage` (survives refresh; shared by all tabs of the browser profile). Storage failures degrade to a per-call ephemeral id (private-mode safe). | O(1) |
| `getSessionId()` | **Per-tab identity (lazy singleton)** | In-memory `'sess-<time36>-<rand>'` — two tabs of the same browser are separate editors; a tab's own realtime echo always carries its session id and is therefore recognized & ignored (the echo-suppression gate §6.2). | O(1) |
| `deviceBrowserName()` / `deviceOsName()` / `deviceFormFactor()` | **Fallback-chain UA parsing** | Prefer `navigator.userAgentData` (structured brands/platform/mobile), skipping placeholder brands (`Not A Brand`, `Chromium`) with a first-match find; fall back to ordered regex probes over `userAgent` (`Edge → Opera → Samsung → CriOS → Chrome → Firefox → Safari`). Same priority-chain for OS and form factor. | O(regex chain) |
| `getDeviceLabel()` / `deviceLabelOf(d)` | **Label composition** | `"Browser · OS (phone/PC)"` from parts, tolerant of partial remote facts. | O(1) |
| `getDeviceFact()` | **Push stamp** | `{id, sessionId, label, browser, os, kind}` embedded in every cloud payload — who wrote this copy, and the echo-suppression key. | O(1) |

## 8. `js/supabase.js` — transport adapter

| Function | Algorithm | Mechanism | Complexity |
|---|---|---|---|
| `SUPA.configured()` | **Capability probe** | True when URL/anon keys exist and `supabase-js` loaded (script loader has a jsDelivr → alternate-CDN fallback). | O(1) |
| `SUPA.saveLedger(uid, payload)` | **Upsert (snapshot storage)** | Writes ONLY the signed-in account's own `ledgers.user_id` row (RLS-enforced); the whole payload (`state` + `device` fact + `exportedAt`) is written in a single upsert. The legacy `shared_ledgers` row is never written for live data. | O(n) |
| `SUPA.getLedger(uid)` | **Select-single (own row only)** | Reads the account's own `ledgers` row; distinguishes "no row" (`null` ⇒ confirmed empty) from errors. No row yet ⇒ one-time adoption: the DB function `ledger_adopt_shared` copies the old shared `'main'` row into the FIRST opener's private row and deletes it, so later accounts start EMPTY. On an expired/invalid session it mirrors `saveLedger`'s heal: `getUser()` confirms the token server-side, and **one retry** follows a successful refresh — a device whose access token silently expired (a session supabase-js serves from cache) pulls the newest cloud copy on its very next refresh instead of freezing on the login-time snapshot. A dead refresh token surfaces as an honest \"session expired — sign in again\" while the 8s reconcile / 60s poll retry loops stay alive. | O(n) |
| `SUPA.subscribeRealtime(uid, cb)` | **Channel subscription (own row)** | Postgres-change channel on `ledgers` filtered to `user_id=eq.<uid>`; each change hands the row to the callback (→ `supabaseUpdate`). A different account's row never arrives. | O(1) setup |
| `SUPA.sessionUser()` | **Session refresh** | Re-reads the auth session (before every push and before reconcile) so expired tokens are healed or surfaced. | O(1) net |

## 9. `js/auth.js` — session, approval gate, admin

| Function | Algorithm | Mechanism | Complexity |
|---|---|---|---|
| `authEmail()` / `authToken()` / `authRole()` / `authIsAdmin()` | **Cached session accessors** | Read the Supabase session/user fields; `authIsAdmin` is a role comparison. | O(1) |
| `authSignup(email, pw)` | **State-machine entry** | Create user → server marks the account `pending`; an admin must `approve` (or `reject`). The **first account ever is auto-promoted** to `admin + approved` (bootstrap rule — someone must exist who can approve). | O(1) net |
| `authLogin()` / `authLogout()` | **Session lifecycle** | Sign-in stores identity (email+token+role); sign-out clears it. Unapproved users are refused at the gate. | O(1) |
| `authRequestPasswordReset()` / `authApplyPasswordReset()` | **Email-link flow** | Request sends the reset email; apply consumes the URL-hash tokens and updates the password. | O(1) |
| `maybeRecoveryFlow()` | **URL-hash detection + deferred apply** | Regex `/type=recovery/` on `location.hash`; matched ⇒ wait 1.5 s (`setTimeout`) for the auth library to finish booting, then apply. | O(1) |
| `authBootstrap()` | **Gate sequence** | Restore session → require an approved user → otherwise show the auth screen. The ledger never boots unauthenticated. | O(1) |
| `openAdminConsole()` / `adminAct(action, id, email)` | **Role-protected CRUD** | List accounts with status; `approve / reject / promote / demote` guarded by `authIsAdmin()`. | O(users) |
| `authPost(action, extra)` | **Endpoint abstraction** | All admin/signup HTTP calls funnel through one helper (transport swappable). | O(1) |
| `maybeImportLegacy()` | **One-shot migration hook** | Offers to import pre-account local data into the fresh workspace (flag-guarded). | O(n) |

## 10. `js/live-sync.js` & `js/sync-ui.js` — realtime glue & manual controls

| Function | Algorithm | Mechanism | Complexity |
|---|---|---|---|
| live-sync glue | **Subscription lifecycle** | Sign-in → `supabaseWatch(uid)`; sign-out → unsubscribe. | O(1) |
| `updateGoogleSyncStatus(msg, type)` | **Status publisher** | One status line all subsystems write through (ok / queued / failed / reviewing). | O(1) |
| `toGooglePayload()` | **Envelope builder** | `{app, exportedAt, device: getDeviceFact(), state}` — the versioned cloud payload. | O(n) |
| `downloadFullBackup()` | **File export** | Full state JSON → Blob download. | O(n) |
| `cloudForceOverwriteCloud()` | **Destructive push** | Local copy becomes official (explicit user intent, bypasses merge gates). | O(n) |
| `cloudForcePullFromCloud()` | **Destructive pull** | `applyCloudRemote(..., force=true)` + re-render + draft recovery. | O(n + m) |
| `cloudRoundTripTest()` | **Transport self-test** | Token write/read/compare/restore (§6.9). | O(n) |
| `compareCloudAndDevice()` / `cloudTruthRow()` | **Truth table** | Side-by-side per-collection counts (cloud vs device) for diagnosis. | O(n + m) |
| `renderCloudStatus()` | **Status derivation** | Composes online/queued/failed/last-sync into the pill + cloud card. | O(1) |
| `cloudSyncNow()` / `reconnectRealtime()` | **Manual triggers** | Immediate push; re-subscribe the realtime channel after a drop. | O(n) / O(1) |

## 11. `js/init.js` — boot orchestration & re-render pipeline

| Function | Algorithm | Mechanism | Complexity |
|---|---|---|---|
| `renderAll()` | **Ordered CFG pipeline** | Fixed order: `migrateLegacyEntries()` → `rebuildStockAndCogs()` → per-tab renderers (prices, usage, production, sales, dashboard, calendar, inventory, customers, suppliers, cash, tools) → `updateUsageCosts()` → status lines → storage size → badges/notifications → icons → `applyLanguageToDom()`. The order encodes data dependencies (derived stock before views that read it). | O(n log n + c + UI) |
| `triggerGoogleSync()` | **DEBN (900 ms) + pending latch + session heal** | Marks `pendingCloudPushQueued = true` **immediately** (so `beforeunload` knows a change is in flight even inside the debounce window); after 900 ms heals a silently-expired session and pushes when online-or-configured — never silently drops a save (failure queues instead). | O(1) per trigger |
| `reportBackendMode()` | **Capability diagnostic** | Console + status-line report of which backend is actually wired (keys present? library loaded? CDN fallback used?) — turns "sync silently dead" into a diagnosable state. | O(1) |
| `appStart()` | **Boot gate sequence** | Auth gate → `companyBootstrap()` (workspace) → `loadState()` → migrations → `loadDraftIfNewer()` → `cloudAfterSignIn()` (reconcile) → `startCloudPolling()` → `initSyncFlushers()` → `renderAll()` → tab/event wiring. | O(n) boot |

---

## 12. `js/ledger.js` — production (two-phase batch lifecycle)

| Function | Algorithm | Mechanism | Complexity |
|---|---|---|---|
| `validateOptionalNum(input)` / `validateText` / `validateNum` | **VAL guarded parsing** | Empty field ⇒ `0` (mix may be saved before packing counts exist); otherwise parse, reject negative/NaN by flagging `.field-error` and returning `null` (callers abort). | O(1) |
| `saveProduction()` | **MSM two-phase + idempotent upsert by date** | (1) Commit the form's rolls-per-bag into settings. (2) Derive: `capital = ingredientCostFor(usage) + additionalCost`, `laborCost = (laborMin/60) × wage`, `costPerPiece = round(capital/pieces)`, bags = user-typed **or** `floor(pieces / rollsPerBag)` (full sets only). (3) **One batch per day**: find the existing batch for that date and *edit it in place* — a second batch for a day would deduct ingredients twice. (4) Phase gate: a mix-only save (nothing packed) must still represent real work (some usage > 0, or pieces/bags/labor > 0, or a note). (5) On update: `replaceProductionInventory()` (delta ingredient movements) and `rebuildStockAndCogs()`. (6) `saveState()` + `triggerGoogleSync()` + `renderAll()`. | O(P + c + replay) |
| `editProduction(id)` | **Form materialization** | Load batch into form; re-seed each usage input from `draftUsage`; mark bags auto vs manual (`bagsAuto === false` locks the field). | O(c) |
| `deleteProduction(id)` | **Inverse-event delete** | `reconcileProductionInventory(usage, {}, date, id)` restores ingredients; remove + `markDeleted('production', id)`; `rebuildStockAndCogs()` so stock/COGS re-derive; full re-render. | O(P + c + replay) |
| `renderProduction()` | **SORT desc + template AGG** | Newest-first table; per row derives display bags (`bagsAuto ? floor(pieces/rpb) : typed`), expected-vs-actual roll diff coloring, cost/piece. | O(P) |
| Standing-orders prefill (`standOrderBtn`) | **Template arithmetic** | `bags = Σ standingOrder`; `pieces = round(bags × stockAvgPiecesPerBag() ‖ 6)` — production target from committed demand. | O(C) |

## 13. `js/usage.js` — usage costing, estimation & live derivation

| Function | Algorithm | Mechanism | Complexity |
|---|---|---|---|
| `currentUsage()` | **Merge (draft over defaults)** | `{name: draftUsage[name] ?? defaultUsageFor(name)}` — the live mix currently on the form. | O(c) |
| `defaultUsageFor(name)` | **Dictionary lookup** | `DEFAULT_USAGE[name]` else 0. | O(1) |
| `previousProductionUsage(date)` | **Recency search** | Filter batches with `date < given` that carry usage, sort date-desc, take `[0]` — the "standing-order prefill"/"repeat yesterday's mix" template. | O(P log P) |
| `recentWeightPerRoll(max=14)` | **STAT median over trailing window** | Last ≤14 batches with a measured weight/roll → sort ascending → median (odd: middle; even: mean of the two middles, 1-dp). Robust to outlier batches (a crazy 40 g/roll day doesn't move the estimate). | O(P log P) |
| `expectedRolls` derivation | **Floor division estimator** | `floor(mixWeight / wprUsed)` with `wprUsed = measured ‖ recentMedian`; flags when the estimate (not a measurement) was used. | O(1) |
| `deriveBagsFromPieces(pieces)` | **Fixed-ratio packing rule** | `max(0, floor(pieces / rollsPerBag))` — bags count only FULL sets; used identically in production and sale forms. | O(1) |
| `updateUsageCosts()` | **Live derivation chain (AGG per keystroke)** | From current form inputs: `capital` (ingredient + additional), `laborCost`, `mixWeight`, `expectedRolls`, `cost/piece`, `cost/bag`, pcs-per-bag, stock-after preview; renders each into its live element. | O(c) |
| `refreshSaveButton()` | **Context FSM labels** | Editing? `productionFormHasActuals()` ⇒ "Update Production" else "Update Mix — add real bags & pieces after packing"; new batch with mix ⇒ "Save Mix Now — Expected Rolls Ready". Two-phase workflow made visible in the button. | O(c) |
| draft persistence hooks | **DEBN + touch latch** | Every form input: `updateUsageCosts()` + `persistDraft()` (400 ms) + `draftTouched = true` (distinguishes "user typed" from "default recipe pre-filled"). | O(c) |
| `scaleRecipe` (tools.js interplay) | **Proportional scaling** | See §18. | O(c) |

---

## 14. `js/pricing.js` — price list & change-only stamping

| Function | Algorithm | Mechanism | Complexity |
|---|---|---|---|
| `renderPriceTable()` + input wiring | **Live-bind + 3-event editing model** | Each cell wires `focusin` (remember `__base` value), `input` (write through on every keystroke + `persistState()` + `updateUsageCosts()`), `change` (commit). **Change-only stamping**: `updatedAt` is rewritten only when the committed value differs from the focused base — retyping an unchanged price can never earn a newer timestamp and silently beat a real edit made on another device during LWW merges. | O(c) render |
| `addIngredientRow()` | **Case-insensitive dup guard + tombstone clear** | Reject a name already present (lowercased compare); new entries default unit via a confirm dialog (`unit` vs `g`); `unmarkDeleted('prices', name)` so re-adding a previously removed ingredient survives tombstones. | O(c) |
| `removeIngredientAt(idx)` | **Soft delete** | Splice + `markDeleted('prices', ing.name)`; past usage history keeps its historical data (price history is never rewritten). | O(c) |
| `resetPricesBtn` | **Seed restore** | Deep-clone `DEFAULT_PRICES` back over `state.prices`. | O(c) |
| JSON price export/import | **File round-trip** | `Blob` download; import parses, validates `Array.isArray`, replaces, re-renders. | O(c) |

## 15. `js/sales.js` — sales, credit, receipts

| Function | Algorithm | Mechanism | Complexity |
|---|---|---|---|
| `saleCreditAmount(sale)` | **Formula** | `max(0, amount − paidAmount)` (legacy rows without `paidAmount` are fully paid). The single definition of "how much does this sale still owe". | O(1) |
| `applySaleCreditChange(oldSale, newSale)` | **Symmetric delta application** | On edit: subtract the old sale's credit from its customer, add the new sale's credit to its customer (handles moving a sale between customers), then clamp each debt at 0. The authoritative value still comes from `normalizeCustomerBalances()`. | O(C) |
| `saveSale()` | **VAL + packing rule + payment FSM + stock gate** | (1) Bags may be empty ⇒ derive `floor(pieces / rollsPerBag)`. (2) `amount = bags × price`; `paidAmount` clamped to `[0, amount]`; `paymentStatus ∈ {paid, partial, credit}` with validation: partial/credit require a customer, and `paid ≥ amount` must be declared "paid". (3) Stock gate: `finishedGoodsShortage()` blocks over-selling (against stock *at the sale's date*). (4) `projectedSaleCogs()` previews/stamps COGS via the replay. (5) Edits keep the same `id` (replace, never double-charge). (6) `applySaleCreditChange()` + `rebuildStockAndCogs()` + save + sync. | O(P + S + C + replay) |
| `updateSaleLive()` | **Live derivation** | Amount/credit preview while typing, incl. bags auto-fill. | O(1) |
| `removeSale(id)` | **Inverse-event delete** | Remove + tombstone + restore customer credit (delta −old) + `rebuildStockAndCogs()` + render. | O(S + replay) |
| `renderSalesTab()` | **SORT desc + AGG** | Newest-first list with paid/credit split, COGS/net columns; day filter. | O(S) |
| `printSaleReceipt(id)` | **Document generation** | Opens a print window with a receipt built from the sale + customer (date/items/amount/paid/credit/due). | O(1) |

## 16. `js/customers.js` — customer directory, statements, debt ops

| Function | Algorithm | Mechanism | Complexity |
|---|---|---|---|
| `customerOptions()` / `refillCustomerSelect()` | **Template build + selection preservation** | Rebuild `<option>` list, keep the current selection. | O(C) |
| `renderCustomers()` | **AGG + conditional coloring** | Table; KPI folds: Σ standingOrder, Σ standingOrder×price, Σ debt (receivable). | O(C) |
| `deleteCustomer(id)` | **Referential-integrity guard** | Refuse deletion when the customer has any sale or outstanding debt (the ledger would lose meaning); then remove + tombstone. | O(S + C) |
| `renderCustomerStatement()` | **Chronological ledger + running balance** | Merge the customer's credit sales (+credit) and payments (−amount) into date-sorted rows; fold a **running balance** line-by-line; final line = authoritative `debt` from `normalizeCustomerBalances()`. | O(sales_c + pays_c) |
| `adjustCustomerDebt(direction)` | **Ledger-append vs baseline-charge** | Repayment (−): append a `customerPayments` row (real cash received) for `min(amount, outstanding)` — only the payment row lowers the ledger balance, `extraDebt` is left alone so the recompute stays exact. Debt added (+): raise `extraDebt` (the manual baseline) so the authoritative recompute preserves it. Then `normalizeCustomerBalances()` → save → render. | O(S + P + C) |

## 17. `js/suppliers.js` — suppliers, purchases, payables

| Function | Algorithm | Mechanism | Complexity |
|---|---|---|---|
| `totalPayable()` / `supplierBalance(id)` | **AGG + formula** | Per purchase: `max(0, itemTotal − (paid + paidNow))`, summed (globally or per supplier). | O(P) |
| `totalReceivable()` | **AGG** | Σ customer debt. | O(C) |
| `normalizeSupplierPayables()` | **Allocation replay (FIFO) + monotonic lift** | (1) Build per-purchase buckets `{bal = itemTotal − paidNow, allocated: 0}`. (2) Sort payments by `createdAt ‖ date`; sort each supplier's purchases by date. (3) Greedily allocate each payment to the **oldest unpaid purchases first** (same allocation the payment form uses). (4) Lift each purchase's `paid` to the allocated amount **only upward** (`if target > recorded`) — idempotent, never reduces a recorded `paid`, so legacy manual balances survive; `updatedAt` stamped when lifted. This replay exists because the `payments` ledger is merge-safe (new rows always survive sync) while a `paid` mutation can lose an LWW clash. | O(P log P + Pays log Pays) |
| Purchase save flow | **Inventory movements + price derivation** | Each purchased line becomes a `+qty` movement (`type:'purchase'`); per-line unit price derived from the purchase (`g`: amount/(qty/1000); unit: amount/qty). | O(items) |
| Purchase→price-list offer | **Threshold-triggered reconciliation** | When a derived price differs from the list price by > **0.5 Ks**, collect `{name, old, new}` and offer the update; on accept: append entries to `priceHistory` (system-authored audit trail), set `ing.price`, stamp `updatedAt`. | O(items + c) |
| Supplier payment handler | **FIFO allocation + double-entry + re-stamp** | Allocate across that supplier's oldest unpaid purchases (`apply = min(bal, remaining)`), update `paid`, **re-stamp `updatedAt`** on every touched purchase (so other devices' merges recognize the edit), append the `payments` row. | O(P log P) |
| Render set (`renderSuppliers` …) | **Self-heal + AGG renderers** | `normalizeSupplierPayables()` runs on every render (idempotent); dropdowns/list/purchase history/payment history render via sort-desc + folds. | O(P + Pays) |

---

## 18. `js/inventory.js` — movement-ledger UI, stock corrections, ingredient waste

| Function | Algorithm | Mechanism | Complexity |
|---|---|---|---|
| `renderInventory()` | **Snapshot + threshold coloring** | Per stock ingredient: `syncInventorySnapshot()` recompute → status `OUT` (≤0) / `LOW` (≤ lowAlert) / `OK`; low items collected for the alert strip; total `inventoryValue()`. Inline stock inputs feed **delta adjustments** through `recordInventoryMovement` (typed `adjustment`), never overwrite the snapshot directly. | O(c + M) |
| `renderInventoryMovements()` | **SORT desc (date, then createdAt) + slice(0,12)** | Latest 12 movements as an audit feed; signed qty coloring. | O(M log M) |
| `addStockFor(name)` | **Guarded prompt → movement** | Requires an existing price item; re-adds `stock:true` if previously opted out; positive qty + reason ⇒ `adjustment` movement. | O(M) |
| `removeStockItem(name)` | **Opt-out + purge + tombstones** | Deletes the snapshot entry, filters out all its movements, tombstones each removed movement (so the removal syncs), sets `stock:false` on the price entry — the item stays as daily usage, restorable via Add Stock. | O(M) |
| Ingredient-waste form | **Stock-gated negative movement** | Validates qty ≤ `inventoryStockFor(name)`, then records `−qty` (`type:'ingredient_waste'`) with reason. | O(M) |
| `inventoryMovementLabel(type)` | **Dictionary lookup** | Movement type → human label. | O(1) |

## 19. `js/moneyout.js` — money-out aggregation (pure domain, no DOM)

| Function | Algorithm | Mechanism | Complexity |
|---|---|---|---|
| `MONEY_OUT_TYPES` / `EXPENSE_CATEGORIES` | **Registry pattern** | Stable key→meta map; its key order defines display order and sort priority. | O(1) |
| `moneyOutForDay(dateStr)` | **Multi-source filter + typed-row projection + AGG + SORT** | (1) Filter 5 sources to the date: production (capital → "Ingredients & Materials"; laborCost → "Labor"), purchases (**only `paidNow`** — the cash that actually left that day), supplier payments, one-time expenses, negative cash adjustments (owner draw). (2) Project each into `{id: '<type>-<recordId>', type, amount, label, detail, deletable, ref}`. (3) Fold `byCategory[type] += amount` and `total`. (4) Sort by registry index then amount desc. | O(P + Pu + Pays + E + A) |
| `moneyOutForMonth(monthStr)` | **Prefix filter + category fold** | `date.slice(0,7) === 'YYYY-MM'` per source; per-category sums; total = Σ categories. Used by reports/monthly profit. | same sources |
| `moneyOutType(key)` / `supplierNameMoneyOut(id)` | **Lookup + fallback** | Unknown type → cashout meta; unknown supplier → "Unknown shop". | O(S) |

## 20. `js/cash.js` — cash drawer & daily close

| Function | Algorithm | Mechanism | Complexity |
|---|---|---|---|
| `financeTotals()` | **Cash-basis double classification (AGG)** | **Cash in** = sales `paidAmount` only (credit is *not* cash) + customer payments received + positive adjustments. **Cash out** = purchases `paidNow` only + supplier payments + one-time expenses + production labor + \|negative adjustments\|. `closing = opening + (in − out)`. Credit purchases and credit sales never touch the drawer until their payment rows exist — each payment row counted exactly once. | O(S + Pu + Pays + E + A + P) |
| `cashExpectedToday()` | **AGG (today filter)** | Expected drawer intake today = today's paid sales + today's customer payments; compared live against the counted drawer for the close-of-day variance. | O(S + Pays) |
| `renderCashCount()` | **Variance display** | Expected vs counted; sign/difference rendered. | O(1) |
| Opening / adjustments forms | **Append + tombstone delete** | `addCashAdjustment` (signed amount + label) appends; `removeCashAdjustment` filters + `markDeleted('cashAdjustments', id)`. | O(A) |
| `renderCash()` | **Composition** | `financeTotals()` + receivable + in/out breakdowns + adjustment feed + money-out panel + daily close. | O(all sources) |

## 21. `js/tools.js` — business tools (recipes, break-even, forecast, purchase planning)

| Function | Algorithm | Mechanism | Complexity |
|---|---|---|---|
| `renderTools()` | **Composition dispatcher** | Calls all ten tool renderers (recipes, break-even, waste, price history, expenses, recurring, forecast, target profit, purchase list, purchase days). | O(all tools) |
| Recipes: `renderRecipes` / save / apply / delete | **Named-template store** | Recipes are `{name, usage}` snapshots of the current mix; apply copies back into `draftUsage` + form inputs; delete tombstones. | O(c) |
| `recipeTotalPieces(usage)` | **Unit-aware AGG** | Σ grams-equivalent (§5.4 formula). | O(c) |
| `scaleRecipe(idx)` | **Proportional scaling** | `factor = targetPieces / baseMix`; every ingredient `round(qty × factor)`; pieces/bags fields filled; form switched to the log tab. | O(c) |
| `renderBreakEven()` | **Ceiling break-even formulas** | `bags = ceil(capital / price)`; with labor `ceil((capital + laborCost) / price)`; price = last sale's price (fallback 1300 Ks). | O(1) (+O(S) price) |
| `renderForecast()` | **Trailing-window mean (7 days)** | Requires ≥ 3 days of data; `avgSold = mean(soldBags of last 7)`, `avgProd = mean(prodBags of last 7)`; tomorrow's suggestion = those means. Deliberately simple and explainable. | O(D) |
| `targetProfitBags(...)` / `renderTargetProfit()` | **Inverse break-even** | `bags = ceil((capital + labor + targetProfit) / pricePerBag)`; `pieces = bags × avgPiecesPerBag` (stock history, default 6); standing orders shown separately ("you still need to sell N bags"). | O(1) + O(C) |
| `purchaseList()` | **Buffered replenishment planner** | Per stock ingredient: `want = max(0, ceil(used + used × (safetyDays − 1) − onHand))`; rows filtered to `want > 0`; estimated cost = Σ unit-aware price × want. | O(c + M) |
| Waste log (`addWasteBtn`) | **Stock-gated append + replay** | `canRecordWaste` (chronological constraint, §5.3) blocks impossible waste; append + `rebuildStockAndCogs()` (waste cost flows out of stock via the replay) + render. | O(n log n) |
| Price history / expenses / recurring renderers | **Sort-desc + AGG renderers** | Lists newest-first; totals folded; deletes tombstoned (`expenses`, `recurringExpenses`). | O(collection) |
| Printable report / monthly CSV | **Document / CSV generation** | `window.open` + HTML table; `csvRow` per entry via `entriesProdSales()`. | O(D) |

## 22. `js/dashboard.js` — KPIs, alerts, charts

| Function | Algorithm | Mechanism | Complexity |
|---|---|---|---|
| `renderDashboard()` | **AGG + ratio + change-flash** | Today's revenue/capital/COGS/net (filters on today + folds); lifetime `ratio = net/capital × 100`; payable KPI from `totalPayable()`. **Flash-on-change**: each KPI remembers its previous text in a `data-prev` attribute and pulses when it differs (skips first render). Then charts + summary + monthly report. | O(P + S + C) |
| `renderDashboardAlerts()` | **Threshold scan** | Low/out-of-stock items (`stock ≤ lowAlert` over stock ingredients) + `getExpiringBatches()` → alert boxes. | O(c + P) |
| `getExpiringBatches(days=3)` | **Date-window filter** | `useBy <= today + days` (ISO string compare works because ISO dates sort lexicographically). | O(P) |
| `renderCharts()` | **Dataset projection** | Chart.js line charts from `entriesProdSales()` within the selected range (gain = net, volume = bags/pieces). | O(D) |
| `renderSummary(entries)` | **AGG block** | All-time totals, profit-after-labor, profitable-days count (`net ≥ 0`), inventory value, standing orders. | O(D) |
| `renderMonthlyReport()` | **GRP by month + AGG** | Buckets `YYYY-MM` revenue/COGS/expenses → per-month profit table. | O(D) |

## 23. `js/calendar.js` — month grid, audit table, week windows

| Function | Algorithm | Mechanism | Complexity |
|---|---|---|---|
| `renderCalendar()` | **Grid generation + per-day classification** | Leading blanks (`firstDay`), then one cell per day: class chosen from `dayInfo(date)` — `profit`/`loss` when `net ≠ 0`, `neutral` when only production/sales activity, plus `today`/`selected` markers; sub-label (±k net or pcs); tooltip composes rolled/sold/money-out. Click loads that day's batch into the form. | O(days + moneyout) |
| `entryMap()` / `eventOf()` / `dayInfo()` | **Index build (memo per render)** | `entriesProdSales()` → `{date → day}` hash for O(1) lookups. | O(D) |
| `populateWeekSelect()` | **Week window enumeration** | For each recorded date, compute the containing Sun→Sat window (Date arithmetic + timezone offset correction), store as `"start|end"`; dedupe via `Set`, sort desc. | O(D log D) |
| `renderAuditTable()` | **Range filter + SORT desc + per-day AGG** | Applies week/from/to filters, sorts date-desc, renders per-day rows with cost-per-bag and margin % (each row also folds `moneyOutForDay`). | O(D × sources) |

## 24. `js/csv.js` — CSV export

| Function | Algorithm | Mechanism | Complexity |
|---|---|---|---|
| export handler | **Sectioned serialization** | Emptiness guard → header banner → overall totals (from `financeTotalsAll()`) → production table → sales table (with per-sale credit = `amount − paid`, COGS/net) → join → Blob with `\uFEFF` BOM → download. All cells pass through `csvCell` (§5.8 escaping + formula-injection guard). | O(P + S) |

---

## 25. `js/ai.js` — local diagnostic engine + optional LLM narrative

### 25.1 Statistical primitives

| Function | Algorithm | Mechanism | Complexity |
|---|---|---|---|
| `median(list)` / `average(list)` | **STAT estimators** | Median: filter finite → sort asc → middle element (odd) or mean of the two middles (even). Medians are chosen over means everywhere — robust to outlier days. | O(n log n) |
| `pctDiff(a, b)` / `safeDiv(a, b)` | **Guarded formulas** | Percent difference `((a−b)/b)×100` guarded against zero/NaN denominators. | O(1) |
| `addDays(dateStr, n)` | **Calendar arithmetic** | Date + n days re-anchored to the local timezone. | O(1) |

### 25.2 Feature extraction (profile building)

| Function | Algorithm | Mechanism | Complexity |
|---|---|---|---|
| `summarizeNotes(notes)` | **Regex keyword classifier with negation window** | 13 symptom flags (undercooked, overcooked, salty, sweet, heavy, light, breakable, oily, uneven, stale, hard, slow, good), each a word-boundary regex battery. **Negation guard**: `hasNoteKeyword` inspects the 12 characters before a match; a negator (`not|no|less|wont|doesnt|didnt|never`) cancels the signal — so "not crispy" is undercooked, not good. Negated-crispy is checked first explicitly. | O(notes len × rules) |
| `historyBatches(date, max=30)` | **Trailing-window selection** | Batches strictly before the analyzed date, date-desc, take ≤30. | O(P log P) |
| `dailyWasteSums(excludeDate)` | **GRP + AGG** | Σ waste per day (excluding the analyzed day) → the distribution the median is taken over. | O(W) |
| `ingredientAnomalies(batch, history)` | **Per-ingredient ratio outlier detection** | For each used ingredient: historical ratios `grams per 100 pieces` across history → **median** baseline; today's ratio vs median; `|diff| ≥ 20%` ⇒ anomaly; sorted by |diff| desc, top 3 reported. | O(c × H log H) |
| `buildProfileForDate(date)` | **Normalized profile builder (STAT)** | One object with: batch selection (latest batch that day by id), `yieldPct = pieces/expectedRolls`, weight-per-roll vs recent median (`wprPctDiff`), labor per 100 pieces vs median, cost per piece vs median, waste today vs typical-day median, ingredient anomalies, note symptom flags. Everything the rules can reason about, in normalized units. | O(P log P + c × H) |

### 25.3 Rule engine (deterministic, offline, free)

| Function | Algorithm | Mechanism | Complexity |
|---|---|---|---|
| `diagnose(profile)` → findings | **Threshold-triggered rules with confidence scoring** | Each rule fires when its metric crosses a threshold, emits `{id, category, phase, severity, confidence, title, summary, evidence[], fixes[], impact}`: • yield shortfall (`yieldPct` low ⇒ pieces lost = expected − actual); • weight-per-roll drift (high ⇒ rolls too heavy/thin); • labor slowdown (≥ +15 % vs median; severity high at ≥30 %; confidence `min(90, 50 + diff/2)`); • cost-per-piece jump (≥ +10 %; high at ≥20 %; impact = (today − median) × pieces); • waste spike (today > `median × 1.5 + 2`; high at ≥25 pcs); • ingredient mix drift (top-3 anomalies; high at ≥40 %); • quality notes (undercooked/burnt/salty/heavy/breakable… — each maps to a frying-phase root cause). Confidence is clamped (`min(cap, base + magnitude)`), severity scales with magnitude, and every finding carries its exact evidence trail + kitchen checks. | O(rules + anomalies) |
| `solve(date)` | **Pipeline composition** | `buildProfileForDate → summarizeNotes → ingredientAnomalies → diagnose` → `{profile, findings}` sorted by severity/confidence; also builds the LLM payload. | O(P log P + c × H) |

### 25.4 Optional LLM narrative (graceful degradation)

| Function | Algorithm | Mechanism | Complexity |
|---|---|---|---|
| `LLM_PROVIDERS` / `providerDefaults()` / `aiNormalizedConfig()` | **Provider abstraction** | OpenAI / DeepSeek / free Pollinations, each with default endpoint + model; per-company config stored **locally only** (`localStorage`), never synced, never in the ledger. | O(1) |
| `promptPayload(profile, findings)` | **Privacy-safe template** | Only daily *aggregates* and note keywords go to the model — never customer names, phones or balances. | O(findings) |
| `askLLM(profile, findings)` | **Timeout-guarded fetch** | `chat/completions` POST with `AbortController` + **30 s** `setTimeout` abort; on any failure the UI falls back to the local engine (the AI tab works fully offline). | O(1) net |

### 25.5 UI wiring

| Function | Algorithm | Mechanism | Complexity |
|---|---|---|---|
| `renderAiAnalysis()` / `bindAiUI()` / `askAi()` | **Tab glue** | Date picker → `solve` → findings cards; "Ask AI" disables the button, renders the narrative or an actionable error, restores state in `finally`. Public API exported on `window.AiAnalyzer` for `_verify_ai.js`. | O(findings) |

---

## 26. `js/pan-timers.js` — parallel frying-pan timers

| Function | Algorithm | Mechanism | Complexity |
|---|---|---|---|
| `panStorageKey()` | **Scoped key derivation** | `panTimers_v1_<workspaceId>` (legacy global key still read as fallback so a refresh upgrade keeps running timers); storage version constant guards schema. | O(1) |
| Pan state model | **SCHED wall-clock anchoring** | Each pan stores its own `duration`, `remaining`, **`endAt` (wall clock)** and `stage`. The tick loop recomputes `remaining = endAt − now`, so background-tab throttling, sleep and refreshes never drift the countdown — accuracy comes from `Date.now()`, not tick counts. | O(1) per pan |
| `ensureTick()` | **Single interval scheduler (200 ms)** | One `setInterval(tick, 200)` for all pans (TICK_MS is a UI refresh rate, not the time source). | O(1) |
| `stopTickIfIdle()` | **Idle shutdown** | When no pan is running, `clearInterval` — zero cost when idle. | O(pans) |
| `tick()` | **Broadcast scan + event dispatch** | Each tick: for every running pan, `stepPan(pan, now)` advances the **stage machine** (stage 0 heating → stage 1 fold checkpoint → stage 2 final-heat window → stage 3 done); a stage transition fires `triggerAlert(pan, stage)` exactly **once** (edge detection via the stage change); transition to stage 3 also `markRun(pan)` + `autoReportDone(pan)` (roll count → production, deduped). Then summary/banner repaint and idle check. | O(pans) per 200 ms |
| `stageMessage(pan)` | **Short-batch merge rule** | If `duration ≤ fold + final`, the fold and final-20 s checkpoints collapse into one combined instruction (a 70 s pan would otherwise fire two alerts 20 s apart). | O(1) |
| `triggerAlert(pan, stage)` | **Multi-channel alert pipeline** | Card paint + global banner + toast + **Web Audio beep sequence** (per-stage tone patterns, best-effort, `AudioContext` resumed when suspended) + `navigator.vibrate` pattern + tab-title flash + `save()`. | O(1) |
| `beepFor(stage)` | **Sequenced oscillator scheduling** | Per stage a note sequence `[[freq, dur]…]` scheduled on the audio timeline with exponential attack/decay gains. | O(notes) |
| `alertSummary()` / `updateGlobalBanner()` | **Max-severity aggregation** | Banner severity = max over pans with `stage > 0`; title prefix `⏰` (done) vs `⚠`. | O(pans) |
| `autoReportDone(pan)` / reset-cancel | **Once-only report + cancellation** | A finished pan reports its configured rolls into the production batch **in progress** — the date on the Production form (`activeProductionDate()`), never the finish-time calendar day, so a night batch that crosses 0:00 stays one row instead of spawning a new-day record (quiet merge); the pending run also persists the batch date it was finished on across a refresh. Manually resetting a finished pan cancels its pending count — nothing can ever be double-reported. Bags are never per-round: they derive from full sets (`rolls ÷ rollsPerBag`, floor) inside the ledger. | O(P + c) |
| Settings & per-pan overrides | **Override layering** | `settings.panOverrides[id]` wins over global duration/rolls; the duration dropdown is anchored on the pan's own total so selection and checkpoints never disagree. | O(1) |
| Input triggers | **Event dispatch table** | Click / right-click / middle-click on cards; keyboard `1–9` run-pause, `Shift+1–9` reset (ignored while typing in inputs). | O(1) |

## 27. `js/i18n.js` — bilingual EN/Myanma layer

| Function | Algorithm | Mechanism | Complexity |
|---|---|---|---|
| `t(text)` | **Exact-match dictionary lookup with fallback** | Trim the English phrase → `I18N_MY[phrase]` → translation or the original. Same hook wraps `confirm/prompt/alert` (dialog interception at module load) and toast messages. | O(1) hash |
| `applyLanguageToDom(root)` | **WALK (TreeWalker) + memoized reversible swap** | `document.createTreeWalker(root, SHOW_TEXT)` collects text nodes; each node's *original* English is memoized on `n.__enText` (first visit), so switching MY→EN restores exactly what was there (not a re-translation); `[data-noi18n]` subtrees are skipped (closest-ancestor test). | O(text nodes) |
| `translateAttributes(root)` | **Attribute lift with memoization** | `placeholder/title/aria-label` originals memoized in `data-i18n-<attr>`; swap in/out symmetrically. | O(elements) |
| `updateDocumentTitle()` / `updateLangToggleLabels()` | **Direct bindings** | Title and toggle labels per language. | O(1) |
| `readAppLang()` / language persistence | **Preference storage** | `localStorage['dailyCrispyRollLedger_lang']`, validated against the allowed set (`'my'` else `'en'`). | O(1) |
| Bootstrap IIFE | **Deferred application** | Applies on `DOMContentLoaded` if the document is still loading, immediately otherwise; re-applied after every `renderAll()` so freshly rendered DOM is translated too. | O(nodes) |

## 28. `js/pwa.js`, `sw.js`, `manifest.webmanifest` — install & offline shell

| Function | Algorithm | Mechanism | Complexity |
|---|---|---|---|
| `pwa.js` registration | **Capability-guarded SW install** | Register `sw.js` only where `serviceWorker` exists; errors contained. | O(1) |
| `sw.js` fetch strategy | **Stale-while-revalidate cache** | Versioned cache (`crp-shell-v3`): respond from cache immediately, refresh the cached copy in the background, network fallback for misses; cache-busting via `?v=` query stamps on shell assets. The app shell boots offline; data lives in localStorage. | O(assets) |
| manifest | **Installability metadata** | Icons, display mode, theme colors — makes the ledger installable as a home-screen app. | O(1) |

## 29. `js/sample-data.js` — demo seed & wipes

| Function | Algorithm | Mechanism | Complexity |
|---|---|---|---|
| seed generator | **Synthetic event generation** | Builds a few days of production/sales demo records (deterministic-ish demo content) for fresh installs. | O(seed) |
| `wipeLedgerCollection(name)` | **Targeted reset** | Clears one collection (used by "Clear All Data" tooling) — tombstones still apply on sync so deletions propagate. | O(collection) |

---

## 30. Cross-cutting algorithm catalog (family → where it is used)

| Algorithm family | Used by (functions) |
|---|---|
| **Event-sourcing replay (REPLAY/AVGC)** | `replayStocksAndCogs`, `rebuildStockAndCogs`, `projectedSaleCogs`, `finishedGoodsShortage`, `canRecordWaste`, `computeStockSnapshot` (cloud.js mirror) |
| **Derived-state recompute (CFG)** | `normalizeCustomerBalances`, `normalizeSupplierPayables`, `syncInventorySnapshot`, `applyCloudRemote` re-derive chain, `renderAll` pipeline |
| **Additive union merge (UNION)** | `mergeRows`, `mergeEntriesObj`, `mergeKeyedObj`, `mergeMovements`/`uniqueByKey`, deletions-map union in `mergeRemoteIntoLocal` |
| **Last-write-wins (LWW)** | `remoteWins` (all collections), `productionRemoteWins` (domain override) |
| **Tombstone soft-delete (TOMB)** | `markDeleted`/`unmarkDeleted`/`isMarkedDeleted`/`applyDeletionTombstones`; used at every delete site (production, sales, customers, suppliers, expenses, prices, movements, cash adjustments, recipes) |
| **Debounce (DEBN)** | `persistState` 300 ms · `persistDraft` 400 ms · `triggerGoogleSync` 900 ms |
| **Timers / polling (POLL/SCHED)** | cloud poll 60 s · sync retry heartbeat 20 s · reconcile retry 8 s · review-pending reprocess 80 ms · pan tick 200 ms · toast 3.2 s · flash 550 ms · LLM abort 30 s · recovery apply 1.5 s |
| **Single-flight write queue (SGLF)** | `cloudPush` in-flight promise + requested latch |
| **Canonical-form diff/fingerprint (DIFF/FP)** | `normalizeForCompare`, `statesEqual`, `stateFingerprint`, sync-review decision cache (FIFO-capped at 150) |
| **Echo suppression** | `getDeviceFact`/`getSessionId` stamps + `supabaseUpdate` session check + `cloudSyncSuppressed` guard |
| **Median statistics (STAT)** | `recentWeightPerRoll` (usage), ai.js `median` (weight/roll, labor, cost, waste, ingredient ratios) |
| **Rule engine (RULE)** | ai.js `diagnose` (thresholds → severity/confidence-scored findings) |
| **Regex classification (REPL)** | `esc` HTML escaping, `csvCell` CSV escaping + formula-injection guard, i18n dialog wrap, ai.js keyword/negation classifier, device UA parsers, recovery-link detector |
| **DOM tree walk (WALK)** | `applyLanguageToDom`, `translateAttributes`, `wireResponsiveTables`, notification/badge binding |
| **Group-by + fold (GRP/AGG)** | `entriesProdSales`, `moneyOutForDay/Month`, `financeTotals`, `financeTotalsAll`, `inventoryStockFor`, dashboard/calendar/audit renderers, `stateDataCount` |
| **Greedy allocation (FIFO)** | supplier payment → oldest purchases first (payment handler + `normalizeSupplierPayables` replay) |
| **Wall-clock scheduling (SCHED)** | pan timers `endAt` model; debounced saves survive reloads via persisted dirty flags |
| **Two-phase state machine (MSM)** | production PACKING→FINISHED; sale payment FSM (paid/partial/credit); sync-review accept/decline FSM |

## 31. Complexity summary (per full render cycle)

Let `P` = production batches, `S` = sales, `W` = waste, `C` = customers, `Pu` = purchases,
`Pays` = payments (supplier), `cp` = customer payments, `E` = expenses, `A` = cash adjustments,
`M` = inventory movements, `c` = price-list entries, `D` = distinct days (≤ P), `H` = history
window (≤ 30), `pans` ≤ 9.

| Phase | Dominant cost |
|---|---|
| Boot (`appStart`) | load O(n) + migrations O(n) + reconcile O(n + m) + `renderAll` |
| `renderAll` | replay O((P+S+W) log(P+S+W)) + balances O(S + cp + C) + payables O(Pu log Pu + Pays log Pays) + snapshot folds O(c × M) + per-tab renderers O(D × sources) |
| Every keystroke (price/usage) | derivation O(c) + debounced O(n) serialize + debounced O(n) cloud push |
| Realtime remote copy | gates O(1) + merge O(n + m) + re-derive (as above) + push O(n) |
| Pan timers idle | 0 (interval cleared); running: O(pans)/200 ms |

Everything stays comfortably interactive at the scale this ledger actually operates
(hundreds of records): the worst single operation is the whole-ledger replay at
O(n log n), executed only when events change or a remote copy lands.

---

## 32. Data-integrity invariants (each enforced by an algorithm above)

| # | Invariant | Enforced by |
|---|---|---|
| 1 | Stock & per-sale COGS are always consistent with the event history | `replayStocksAndCogs` (§5.3) — recomputed after every event mutation and after every pull |
| 2 | You can never sell/waste pieces that don't exist *as of that date* | `finishedGoodsShortage` / `canRecordWaste` chronological constraint scan |
| 3 | A day has at most one production batch (no double ingredient deduction) | date-find + edit-in-place in `saveProduction` |
| 4 | Customer debt = manual baseline + (Σ credit sales − Σ payments received) | `normalizeCustomerBalances` fold + `extraDebt` baseline capture |
| 5 | Supplier payable = purchases − paidNow − allocated payments, applied FIFO | `normalizeSupplierPayables` allocation replay (monotonic, idempotent) |
| 6 | Ingredient stock = Σ movements (snapshot may go negative truthfully) | movement ledger + `syncInventorySnapshot` |
| 7 | A deletion made anywhere removes the record everywhere, forever | tombstone write + union-merge of `deletions` + `applyDeletionTombstones` sweep |
| 8 | Two devices' identical ledgers compare equal despite differing stock snapshots & stamps | `normalizeForCompare` (drop bookkeeping, re-derive stock) + `statesEqual` |
| 9 | A remote copy can never erase local records it doesn't know about | additive `mergeRows` union + guarded `copyArrayFields` + movement merge instead of replace |
| 10 | A fresh/empty device never overwrites a populated cloud (and vice-versa) | `stateDataCount` gate in `applyCloudRemote` + PULL/PUSH decision tree in `cloudAfterSignIn` |
| 11 | The user is never surprised: no silent overwrites of conflicting same-record edits | gate cascade in `handleRemoteCopy` → review modal with exact diff + device label |
| 12 | Own echoes never re-enter the UI as "changes from another device" | device/session id stamps + echo gate + `cloudSyncSuppressed` |
| 13 | Whole-ledger writes never race (older snapshot finishing after a newer one) | single-flight `cloudPush` queue; last pass always carries the newest state |
| 14 | Offline work is never lost | persistent sync-queue flag + 20 s retry heartbeat + `online`/`beforeunload` flushes |
| 15 | Retyping an unchanged value can't win a timestamp race | change-only `updatedAt` stamping (price inputs, balance normalization) |
| 16 | Cash math counts each unit of money exactly once (credit ≠ cash until paid) | `financeTotals` cash-basis classification; `moneyOutForDay` uses `paidNow` only |
| 17 | A pan's roll count is reported at most once per run | `markRun` dedupe + reset-cancel in pan-timers |
| 18 | Translated UI restores the exact original English when toggled back | `__enText` / `data-i18n-*` memoization in i18n |

## 33. Verification harnesses (algorithm → test)

| Harness | Algorithms exercised |
|---|---|
| `_verify_sync.js` | `mergeRows`, `recordUnionKey`, `remoteWins` timestamp resolution |
| `_verify_heal_self.js` | stale-cloud self-healing push loop (11 checks) |
| `_verify_device_sync.js` | device/session identity, echo suppression, attribution labels |
| `_verify_price_supplier_sync.js` | price-list union merge; supplier payment row survival |
| `_verify_sale_stock_sync.js` | sale deletion propagation via tombstones; stock re-derive |
| `_verify_stock_pull.js` | `computeStockSnapshot` parity with `rebuildStockAndCogs`; fresh-device pull |
| `_verify_inventory.js` | movement ledger append/replay/snapshot; ingredient waste gating |
| `_verify_i18n.js` | dictionary lookup, DOM walk memoization |
| `_verify_ai.js` | profile builder, keyword classifier (incl. negation), rules, prompt payload |
| `_verify_draft_recovery.js` | draft version comparison, stale-draft recovery, cleanup |
| `_verify_money_out.js` / `_verify_money_out_ui.js` | `moneyOutForDay/Month` category folds; UI wiring |
| `_verify_supplier_timestamps.js` | `updatedAt` re-stamping on payment allocation |
| `_verify_cloud_read.js` | error-vs-empty read semantics |
| `_verify_cloud_write_queue.js` | single-flight queue: revision ordering under overlapping writes |
| `_verify_live_sync.js` | realtime subscribe/echo/merge flow |
| `_verify_pan_timers.js` / `_smoke_pan_timers.js` | wall-clock anchoring, staged checkpoints, short-batch merge, auto-report dedupe |
| `_check_ids.js` / `_verify_layout.js` | static cross-checks (tab↔panel ids, element ids referenced by js) |

Methodology: each harness stubs a minimal DOM (`global.window`, `localStorage`,
`document` shims) in Node, loads the real modules, builds isolated states with
deterministic ids/timestamps, and asserts the invariants — the same pure
functions the browser runs.

## 34. Known algorithmic limitations (deliberate trade-offs & future work)

| Area | Current algorithm | Limitation | Candidate upgrade |
|---|---|---|---|
| Sync granularity | whole-ledger JSON snapshot per write | O(n) bytes per save; large ledgers cost bandwidth | per-record tables or partitioned JSONB |
| Conflict resolution | `updatedAt` LWW + one domain override | clock skew between devices can mis-rank edits | monotonic `rev` counter per record |
| Multi-tab on one browser | last `saveState` wins per workspace key | two tabs can clobber each other between debounces | `storage`-event mediator / BroadcastChannel |
| Scalar-object merge | guarded replace (`settings`, `cash`) | simultaneous edits on two devices resolve whole-object, not per-field | field-level merge for scalars |
| AI key storage | plaintext in `localStorage` | readable by any script on the page | server-side proxy endpoint |
| Price history on merge/import | user-authored only | merge/import doesn't synthesize history rows | system-authored history entries |
| Forecast | 7-day trailing mean | ignores weekday seasonality/trend | weighted moving average / exponential smoothing |
| Backup scheduling | manual (`downloadFullBackup`) | relies on the user remembering | automatic periodic cloud backups |
| Attribution | device label per *copy*, not per record | "who changed this row" isn't tracked per field | per-change audit log table |

---

*End of ALGORITHM_REFERENCE.md — Daily Crispy Roll Ledger v1.7 (branch `main`,
commit `8d4c310`). Generated from direct code inspection; keep in sync with
`PROJECT_STATUS_AND_ARCHITECTURE.md`.*


















