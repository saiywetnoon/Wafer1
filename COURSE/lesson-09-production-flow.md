> 🧒 **New to coding?** The whole course explained like you're 10 lives in [lesson-00-plain-english.md](lesson-00-plain-english.md) — read it first (no quizzes, come back here after.
# Lesson 09 — The daily flow: production, packing, sales

> Now we put it all together with the REAL business pipeline of your app:
> roll it, pack it, count it, sell it. This is the "why" behind the whole
> program.

Open: **`js/ledger.js`** (`saveProductionFromRun`, `deriveBagsFromPieces`,
`rebuildStockAndCogs`) and **`js/usage.js`** (`updateLive`).

---

## 1. The domain: one day, one batch

```js
// A production record is a DAY:
{ id, date, pieces, bags, usage, capital, ... }
```

- **one record per date** — the app deliberately keeps ONE batch per day.
- **pieces** = how many rolls you actually made.
- **bags** = how many *full* bags that packs into (derived!).
- **usage** = the ingredient recipe for that batch.

This single decision — "one row per day" — drives everything else (merging
pan runs, the sync merge, stock math).

---

## 2. Pan → Production: the merge

```js
function saveProductionFromRun(date, pieces, bags, usage, notes, useBy, quiet) {
  const existing = state.production.find(p => p.date === date);
  if (existing) {
    existing.pieces += Math.round(pieces);            // add to the day
    if (explicitBags) {
      existing.bags += Math.round(bags);              // manual count given
      existing.bagsAuto = false;
    } else if (existing.bagsAuto === false) {
      /* manual override stays as-is */
    } else {
      existing.bags = deriveBagsFromPieces(existing.pieces);  // auto
      existing.bagsAuto = true;
    }
  } else {
    state.production.push({ id: uid(), date, pieces, bags: ..., bagsAuto: true, ... });
  }
  rebuildStockAndCogs();
  saveState();
  renderAll();
}
```

Key ideas:
- **Merge, don't duplicate.** Three pans today = three calls that all add
  into ONE day's row.
- **`existing.bagsAuto`** is a flag that records *intent*: "is this bag count
  computed (auto) or physically counted (manual)?" That lets the renderer
  decide later whether a new piece count should recompute it.

---

## 3. The bag rule you fought for — now the core

```js
function productionRollsPerBag() {
  var v = parseInt((state.settings && state.settings.rollsPerBag) || 0, 10);
  return (v > 0) ? v : DEFAULT_ROLLS_PER_BAG;   // 5
}
function deriveBagsFromPieces(pieces) {
  return Math.max(0, Math.floor((parseFloat(pieces) || 0) / productionRollsPerBag()));
}
```

- `rollsPerBag` is a **setting** (also in the form and Sales).
- `deriveBagsFromPieces` = **floor division** — FULL SETS ONLY. 16 pieces ÷ 5
  = 3 bags; the 17th piece cannot start a 4th.
- Small, pure, testable. This is why your tests can lock it down.

---

## 4. `rebuildStockAndCogs` — replay history

```js
function rebuildStockAndCogs() {
  var events = [];
  state.production.forEach(p => events.push({ date: p.date, type: 0, p }));
  state.sales.forEach(s => events.push({ date: s.date, type: 1, s }));
  state.waste.forEach(w => events.push({ date: w.date, type: 2, w }));
  events.sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : a.type - b.type);

  var stock = { pieces: 0, cost: 0 };
  events.forEach(ev => {
    if (ev.type === 0) { stock.pieces += ev.p.pieces || 0; stock.cost += ev.p.capital || 0; }
    else { /* subtract consumed pieces at average cost */ }
  });
  state.stock = stock;
}
```

This is a **replay/event-sourcing** idea: instead of maintaining a running
stock counter, the app **recomputes stock from the full history** every time.
Rolled adds, sold subtracts — in date order.

- Because sales might sell yesterday's rolls, events are sorted by date, and
  *production (type 0) before sales (type 1) on the same day*.
- The beauty: **no counter can drift out of sync**, because it's re-derived
  from records every render.

---

## 5. Stock → Sales

```js
function saveSale() {
  // ... validate ...
  const record = { id: uid(), date, bags, pieces, price, amount, ... };
  const shortage = canSaveSale(record);      // "do we HAVE that many pieces?"
  if (shortage) { showToast('Not enough finished stock...', 'error'); return; }
  state.sales.push(record);
  rebuildStockAndCogs();      // now stock shrinks
  saveState(); renderAll(); triggerGoogleSync();
}
```

The app **blocks selling more than you have** (shortage check) — real
inventory discipline, enforced in code.

---

## 6. The whole pipeline in one picture

```
ROLL (pans) ──► Production (add pieces/day) ──► Bags (derived floor pieces÷rpb)
                                                    │
            STOCK (rebuilt from history) ◄──────────┘
                │
                ▼
            SALES (deduct pieces, validate stock)
```

---

## Exercises

1. In `saveProductionFromRun`, trace what happens when the SAME date is saved
   three times. Why is it one row? (Merge by date.)
2. In `deriveBagsFromPieces`, call it 3 ways in your head: 16→3, 17→3, 20→4 at
   rpb=5. Then in console: `deriveBagsFromPieces(17)`.
3. In `rebuildStockAndCogs`, explain the `type` sort: why production (0)
   before sales (1) on the same day?
4. **Challenge:** change `state.settings.rollsPerBag = 4`, open recent
   production, watch the bag column change live. That's derived data doing its
   job.
5. Say out loud: "Production is one row per day, merged by date. Bags are
   derived by floor division from pieces. Stock is rebuilt from history each
   time. Sales check stock before they save."

---

## Remember forever

> **One production row per day. Bags = floor(pieces ÷ rollsPerBag). Stock is
> recomputed from history, not counter-incremented. Sales are validated
> against stock. That's the whole business in five sentences.**

---

## Where to go next

[Lesson 10 — Numbers, money & formatting](lesson-10-math-money.md) — the
details of parsing and prettifying the numbers you just traced.