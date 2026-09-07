# Lesson 05 — The state object: one place for ALL data

> This is the single most important architecture decision in the app:
> **one `state` object holds everything**, and every screen is just a
> different way of *looking* at that object.

Open: **`js/storage.js`** (top — the `state` definition) and **`js/config.js`**
(the default values).

---

## 1. Meet `state`

```js
let state = {
  version: 2,
  prices: [...],                    // ingredient price list
  entries: {},                      // legacy (pre-accounts) data
  production: [],                   // batches you ROLLED
  sales: [],                        // what you SOLD
  stock: { pieces: 0, cost: 0 },    // finished goods ready to sell
  settings: { hourlyWage: 1500 },
  inventory: {},
  inventoryMovements: [],
  customers: [],
  suppliers: [],
  purchases: [],
  payments: [],
  expenses: [],
  ...
  updatedAt: null
};
```

Every list (`production`, `sales`, `suppliers`…) is an **array of objects**.
Every object describes one real-world thing:

```js
{ id: 'abc123', date: '2026-09-06', pieces: 240, bags: 48, ... }
```

---

## 2. The two container types

| Type | Shape | Used for |
|------|-------|----------|
| **Object** `{ key: value }` | named fields | one thing (a batch, a customer) OR a map keyed by name |
| **Array** `[ item, item ]` | ordered list | many things (all production, all sales) |

`sales` = array of sale-objects. `inventory` = object keyed by ingredient name.

---

## 3. Why ONE object? Because of the render loop.

Because every screen reads from the same `state`, you get:
- **Consistency**: the Production table, the Dashboard, the Calendar, and
  Stock ALL see the same numbers.
- **Persistence for free**: `saveState()` just writes `state` away.
- **Cloud sync for free**: the whole ledger = one JSON blob sent to Supabase.

Change `state` in one place on one device → re-render → every screen reflects
it.

---

## 4. Mutating vs replacing (the `const` subtlety)

```js
const record = { ... };
state.production.push(record);   // mutates the existing array — allowed

state = somethingElse;           // ERROR if state were const
```

`const` prevents **reassignment** (`state = ...`), not **mutation**
(`state.production.push(...)`). That's why the codebase pushes/pops inside
`state` freely.

---

## 5. Defaults live in `config.js`

```js
const DEFAULT_PRICES = [ { name: 'Flour', unit: 'g', price: 4600, ... } ];
const DEFAULT_USAGE = { 'Flour': 100, 'Egg': 2, ... };
```

`storage.js` copies them into `state` at load if nothing is saved yet:

```js
state = JSON.parse(localStorage.getItem(companyStateKey()))
        ?? Object.assign({}, state, { prices: JSON.parse(JSON.stringify(DEFAULT_PRICES)) })
```

Separating **defaults** (config) from **current state** (storage) is a clean
separation: you can change the defaults without touching anyone's data.

---

## Exercises

1. Open `state` in the browser console (F12, Production tab):
   `state` → you'll see the whole object. Type `state.prices.length` (12?),
   `state.production.length` (days rolled?).
2. Predict: if the Dashboard shows "Bags on hand", which state field does it
   derive from? (Answer: `state.stock.pieces` and `state.settings.rollsPerBag`.)
3. Add a new supplier in the Suppliers tab, then in the console run `state`
   again. Find the object you just created inside `state.suppliers`.
4. **Challenge:** `state.suppliers[0].name = 'Test Market'` then run
   `renderSuppliers()`. Watch the table change. Now you've done a "mutate
   state → render" by hand.
5. Say out loud: "Every screen is a lens on ONE state object. Arrays for
   lists, objects for records, one field per screen feeds back into the same
   object."

---

## Remember forever

> **One `state` object is the single source of truth. Every feature reads it,
> mutates it, saves it, renders it. Arrays of records (`[]`), objects per
> thing (`{}`), and every screen is just a view of the same data.**

---

## Where to go next

[Lesson 06 — localStorage: making it survive refresh](lesson-06-localstorage.md) — how state becomes JSON on disk.