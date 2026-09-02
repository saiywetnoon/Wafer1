# Daily Crispy Roll Ledger — Product Roadmap

This is the source of truth for product work. A feature is only marked
**complete** when its acceptance checks pass; an idea is not a completed
feature merely because a screen or button exists.

## Product goal

Give a small food business a dependable daily operating system for production,
sales, stock, cash, customers, suppliers, and profit—on any device, with each
approved account's data kept private.

## Current foundation

| Area | Status | What is complete |
|---|---|---|
| Email/password accounts | ✅ | Supabase Auth gate, approved/pending/rejected account states, first account becomes admin. |
| Database privacy | ✅ | RLS restricts profiles and ledger access; pending users cannot access ledgers. |
| Multi-device sync | ✅ with limitation | Supabase Realtime receives inserts and updates. Whole-ledger writes are last-save-wins during simultaneous edits. |
| Production and sales | ✅ | Production adds finished goods; sales use weighted-average COGS. |
| Finished-goods controls | ✅ | Sales and waste cannot consume unavailable stock for their date. |
| Ingredient inventory | 🟡 | Dated opening, purchase, production, reversal, and manual-adjustment movements now calculate stock; live acceptance testing remains. |
| Customers and debt | 🟡 | Customer records, standing orders, debt, and capped repayments exist; sales are not yet linked to customers. |
| Suppliers and purchases | 🟡 | Supplier records, purchases, and payments exist; inventory movements are not fully unified. |
| Cash drawer | ✅ | Opening cash, adjustments, debt repayments, expenses, and supplier payments feed cash reporting. |
| Production workflow | ✅ | Mix-first recording: ingredients saved before packaging, expected rolls estimated, actual bags/pieces updated in place after packing (no double deduction). |
| AI root cause | ✅ | On-device diagnostic engine (yield, weight, labor, cost, waste, recipe, notes) + optional ChatGPT/DeepSeek narrative. |
| Backups | 🟡 | Download/restore backup exists; automatic server-side version history does not. |
| Offline installable app | ⬜ | Not yet a PWA. |
| Team workspaces | ⬜ | Not yet supported; each account currently owns one private ledger. |

Legend: ✅ complete · 🟡 usable but incomplete · ⬜ not started

## Completed checks

### Security and account access

- [x] The first account becomes approved admin, even when sign-ups happen at
  nearly the same time.
- [x] An ordinary user cannot set their own role to `admin`.
- [x] An ordinary user cannot set their own status to `approved`.
- [x] Pending and rejected users cannot access their ledger through the API.
- [x] An admin can view and approve/reject account requests.
- [x] Realtime setup does not remove other tables from the shared Supabase
  publication.

### Ledger integrity

- [x] Production and sales remain separate transactions.
- [x] Finished goods are costed by weighted average when sold.
- [x] Waste reduces finished-goods quantity and value.
- [x] A past sale cannot be covered by stock produced in the future.
- [x] Customer repayments are capped at the outstanding balance before cash is
  recorded.
- [x] Recipes survive reload and cloud sync.
- [x] CSV exports quote text correctly and neutralize spreadsheet formulas.

## Next release — Inventory and customer sales

### 1. Inventory movement history

**Outcome:** every ingredient quantity has an explanation.

- [x] Add an `inventoryMovements` state collection.
- [x] Record a dated movement for purchase, production consumption, return,
  and manual adjustment.
- [x] Add a dedicated ingredient-waste workflow and movement type.
- [x] Derive ingredient stock from movements instead of changing a stored
  number directly.
- [x] Show an item-level stock card with its movement history and current
  value.
- [x] Preserve/migrate existing `state.inventory` values into opening-balance
  movements.

**Acceptance checks**

- [ ] Saving a purchase increases the correct ingredient stock once.
- [ ] Saving, editing, or deleting production adjusts ingredient usage exactly
  once.
- [ ] A manual adjustment has a required reason and appears in history.
- [ ] The calculated stock equals the sum of all movements for each item.

### 2. Customer-linked sales and receipts

**Outcome:** users know who bought what, what is owed, and what was paid.

- [x] Add an optional customer selector to every sale.
- [x] Add sale payment status: paid, partial, credit, or unpaid.
- [x] Automatically add credit sales to customer debt.
- [x] Create a printable/shareable receipt with number, date, items, customer,
  total, paid amount, and balance due.
- [x] Show customer statement: sales, payments, balance, and due date.

**Acceptance checks**

- [ ] A cash sale updates revenue and cash without creating debt.
- [ ] A credit sale increases exactly one customer's debt.
- [ ] A partial payment reduces debt and records only the money actually paid.
- [ ] A receipt can be printed without exposing another user's data.

## Completed this release — Production workflow + AI root cause

### 8. Mix-first production workflow

**Outcome:** record ingredients before packaging; update actuals afterward.

- [x] Saving a production day with empty bags/pieces records the **mix** and
  deducts inventory once.
- [x] Expected roll count is shown live from entered weight/roll **or** the
  recent weight/roll average when left blank.
- [x] Reopening the same date after packaging and entering actual bags/pieces
  **updates** the batch in place (no duplicate, no double deduction).
- [x] Packing-pending days show **⏳ PACKING** in the recent list.
- [x] Live **Pieces per Bag** readout appears once both bags and pieces exist.

**Acceptance checks**

- [ ] Mix-only save creates one batch/day, list shows ⏳ PACKING.
- [ ] Adding actuals after packaging keeps a single batch and does not deduct
  ingredients again.
- [ ] Finished-goods stock increases only after the packaging update.

### 9. AI root cause analysis

**Outcome:** find the root cause of a bad production day, on-device or via LLM.

- [x] New **AI Root Cause** tab (Insight) with date picker + Analyze.
- [x] Local diagnostic engine: yield, weight/roll drift, labor, cost, waste,
  recipe-mix and quality-note findings, each with evidence + fixes + impact.
- [x] Health score (0–100) and pending-pack (⏳) state handling.
- [x] Optional ChatGPT (OpenAI) / DeepSeek narrative via a device-only API key.
- [x] Node verification `_verify_ai.js` covers classifier, profile, rules,
  provider presets, prompt privacy, and mix-first save.

**Acceptance checks**

- [ ] A heavy-weight day reports the weight root cause; a normal-weight but
  short-yield day reports the yield-loss cause (not both).
- [ ] A healthy day reports no problems and scores 100.
- [ ] A mix-only (packing-pending) day reports no misleading findings.
- [ ] The LLM prompt contains aggregate numbers only (no customer data).
- [ ] Everything works offline with no API key.

## Following release — Daily operations

### 3. Cash close and exception control

- [ ] Add daily cash close: expected cash, counted cash, variance, note, and
  closing user.
- [ ] Prevent a closed day from being edited without an explicit reopen reason.
- [ ] Add supplier/customer payable and receivable aging reports.

### 4. Batch and expiry tracking

- [ ] Give each production batch a lot number and best-before date.
- [ ] Track remaining pieces per batch, returns, and expiry waste.
- [ ] Alert users to stock expiring soon and slow-moving batches.

### 5. Purchase planning

- [ ] Forecast ingredients from standing orders, selected recipes, and current
  ingredient stock.
- [ ] Generate a purchase list with target quantity and estimated cost.

## Platform release — reliability and scale

### 6. Installable offline app

- [ ] Add `manifest.webmanifest`, icons, and a service worker.
- [ ] Cache the app shell for offline use.
- [ ] Queue writes locally while offline and retry when online.
- [ ] Display Offline / Syncing / Synced / Error state clearly.

### 7. Database evolution and collaboration

- [ ] Replace whole-ledger JSON overwrite with workspace-scoped records.
- [ ] Add workspaces and member roles: owner, manager, production, cashier,
  viewer.
- [ ] Add optimistic versioning/conflict handling for edits.
- [ ] Add audit events for approvals, edits, deletes, restores, and cash close.
- [ ] Add scheduled encrypted database backups and owner-only restore points.

## Engineering quality gate

Apply these checks to every release:

- [ ] JavaScript syntax check passes for every `js/*.js` file.
- [ ] No Git whitespace errors.
- [ ] Test production, sale, waste, repayment, and backup/restore manually.
- [ ] Test the same account on two devices/tabs.
- [ ] Test pending, approved, rejected, and admin account paths.
- [ ] Update `README.md` and this roadmap with the actual completed behavior.
- [ ] Do not mark a feature complete until its acceptance checks are verified.

## Deferred decisions

These need an owner decision before implementation:

- Which languages should launch first: English, Burmese, or both?
- Do sales need named products/SKUs beyond the current crispy-roll product?
- Should a cashier be allowed to delete transactions, or only request a
manager reversal?
- Should customer receipts be sent by WhatsApp, printed, or both?
