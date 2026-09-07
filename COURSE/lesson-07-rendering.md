# Lesson 07 — Rendering: turning data into screen

> You've seen the loop: read → change → save → **render**. This lesson is the
> render step. How does a list of records become HTML rows?

Open: **`js/ledger.js`** (`renderProduction`), **`js/init.js`** (`renderAll`),
**`js/sales.js`** (`renderSalesTab`).

---

## 1. The golden pattern: `list.map(fn).join('')` → `innerHTML`

```js
function renderProduction() {
  const tbody = $('recentBody');                  // find the <tbody>
  const list = prodList().slice().reverse();      // newest first
  if (!tbody) return;

  tbody.innerHTML = list.map(function (p) {
    return '<tr class="border-b border-gray-800">' +
      '<td>' + esc(p.date) + '</td>' +
      '<td>' + fmt(p.pieces) + '</td>' +
      ...
      '</tr>';
  }).join('');                                    // array → one big string
}
```

Every cell in the table comes from ONE record `p`. The function is a
"record → HTML row" factory. `.join('')` makes `['<tr>..','<tr>..']` into
`'<tr>..<tr>..'`, and `innerHTML` displays it.

**Same shape everywhere:** Sales renders `sales`, Suppliers renders
`suppliers`, Calendar renders production. Learn this one pattern and you can
read the whole codebase.

---

## 2. Why does `renderAll()` exist?

```js
// init.js
function renderAll() {
  migrateLegacyEntries();
  rebuildStockAndCogs();      // derive stock from history
  renderPriceTable();
  renderUsageTable();
  renderProduction();
  renderSalesTab();
  renderDashboard();
  renderCalendar();
  renderInventory();
  renderCustomers();
  renderSuppliers();
  renderCash();
  updateUsageCosts();
  ...
}
```

After ANY change (save a sale, delete a supplier, type a price), the app calls
`renderAll()` — re-run every renderer with the new `state`. That's how the
whole UI stays in sync with the data.

Think of it as: **the data is the source of truth, the screen is a projection
of the data. Any change re-projects.**

---

## 3. `map`, `filter`, `reduce`, `forEach` — the four workhorses

| Method | What it does | Used in |
|--------|--------------|---------|
| `arr.map(fn)` | transform each item → new array | rows (`list.map(...)`) |
| `arr.filter(fn)` | keep items that pass the test | `state.suppliers.filter(s => s.id !== id)` |
| `arr.reduce(fn, start)` | boil array down to ONE value | totals, sums |
| `arr.forEach(fn)` | do something for each (no new array) | `pans.forEach(p => ...)` |

```js
// filter example — delete a supplier:
state.suppliers = state.suppliers.filter(function (s) { return s.id !== id; });

// reduce example — total payable:
const total = state.purchases.reduce((sum, p) => sum + (p.itemTotal || 0), 0);

// forEach example — reset all pans:
pans.forEach(p => { p.running = false; });
```

**If you master these four, you master 80% of the business logic in this
codebase.**

---

## 4. Derived data = computed each render (not stored)

```js
// Bags are NOT typed — they're derived live:
const bagsShown = (p.bagsAuto === false)
  ? (p.bags || 0)
  : deriveBagsFromPieces(p.pieces);   // floor(pieces / rollsPerBag)
```

Notice the design decision: instead of trusting a stored `bags` field blindly,
the renderer recomputes it from pieces unless the user explicitly typed a
manual count. **Derived values keep data honest** — one source of truth
(pieces), many views (bags, stock, expected).

---

## 5. Escaping = the habit that saves you

```js
'<td>' + esc(p.notes) + '</td>'
```

Always wrap anything the *user* could type. `esc()` converts `<`, `>`, `&`,
`"`, `'` into safe entities so the browser treats them as text, not HTML.

---

## Exercises

1. Open `renderProduction()`. Count how many columns the `<tr>` builds, and
   match each `<td>` to a header in `index.html`.
2. Predict the output of `[1,2,3].map(n => n * 10).join('-')`.
   Then verify in the console.
3. `state.prices.filter(p => p.unit === 'g')` — what do you expect? Run it.
4. **Challenge:** edit `renderProduction` so each row ALSO shows
   `pieces ÷ bags` ("pieces per bag") in the last cell. Refresh. Undo after.
5. Say out loud: "Each renderer turns records into HTML via map+join. After
   any change, renderAll re-projects state onto the whole screen. Derived
   numbers like bags are computed fresh, not stored."

---

## Remember forever

> **`list.map(record => '<tr>' + fields + '</tr>').join('')` IS this app's
> UI. Four array methods (map/filter/reduce/forEach) run the business.
> RenderAll keeps the screen a clean projection of state. Escape user text —
> always.**

---

## Where to go next

[Lesson 08 — Events & user input](lesson-08-events.md) — what happens between
the click and the render.