# Lesson 00 — The Whole Course in Plain English (read this first)

> This is the friendly version of lessons 01–18. If any lesson makes your head spin, come back here. Everything uses everyday words — no jargon-guessing.
>
> **No quizzes in this lesson.** It's just the map. The quizzes live in the other lessons.


## The story of the whole course in one sentence

> It's the story of ONE app — a digital notebook for a crispy-roll (snack) business. Each of the 18 lessons teaches one small piece of HOW that notebook is built, runs, and stays safe. One app — 18 angles.


## The 5 chapters (what each group is really about

| Part | Lessons | Question it answers | Real-world picture |
|---|---|---|---|
| I. Foundations |  ️1–4 | How is a webpage built, and how does code touch the page? | A shop sign: HTML =the words on it, CSS =the colors/design, JS =what happens when a customer presses it. |
| II. Core |  ️5–10 | Where does the data live, and how does it become the screen? | One notebook (`state`). Every screen is a different window looking into it. |
| III. Time & Cloud |  ️11–14 | How do timers survive a refresh? How do your devices agree? | A kitchen clock that stores WHEN it finishes, and a cloud box only YOU can open. |
| IV. Pro skills |  ️15–18 | How do pros stay calm and not break things? | Debugging, a time machine (Git), tiny safety tests,(tests), and names for habits (patterns). |


## The characters in our story (learn these five and everything clicks

| Character | Code name | Job (in one line |
|---|---|---|---|
| 🏃 The Shop Assistant | `$` | "Fetch me the element with THIS name." |
| 🚪 The Door Guard | `validateOptionalNum` | "Real number? Pass. Empty? Zero. Garbage/negative? Red mark + stop." |
| 🎒 The Packer | `deriveBagsFromPieces` | "Count FULL bags only — never round up." |
| 📠 The Photocopier | `saveState()` | "Copy the notebook as text → safe + head office." |
| 👩💼 The Boss | `renderAll()` | "Redraw EVERY wall from the notebook." |


## 1. The Shop Assistant — `$` (helpers.js, line 2

```js
const $ = (id) => document.getElementById(id);
```

Line by line:
- `const $` — "Make a short name: `$`." (A lazy writer's shortcut.)
- `= (id) =>` — "`$` takes ONE thing: an `id` — a name like `'logDate'`."
- `document.getElementById(id)` — "Go into the page and grab the element with that name."

The whole line means:**"Fetch! Hand me the thing named `id`."** Real world: you shout to the shop assistant "hand me the jar labeled *Flour*" — and she brings the jar.


## 2. The Door Guard — `validateOptionalNum` (ledger.js, lines  ️9–16

```js
function validateOptionalNum(input) {
  const raw = (input.value || '' .trim();
  if (raw === '') { input.classList.remove('field-error'); return 0; }
  const val = parseFloat(raw);
  if (isNaN(val) || val < 0) { input.classList.add('field-error'); return null; }
  input.classList.remove('field-error');
  return val;
}
```

Line by line:
- `const raw = (input.value || '' .trim();` — read what was typed, cut off extra spaces. (`' 40 '` → `'40'`.)
- `if (raw === '') … return 0;` — typed nothing? OK, that counts as **zero**.
- `const val = parseFloat(raw);` — turn the **text** `'40'` into a **number** `40`. (Forms always give text; math wants numbers.)*
- `if (isNaN(val) || val < 0) … return null;` — not a number or negative? Mark the box **red** and return `null` (="invalid" → the app stops with an error toast).
- `return val;` — all good? Hand back the number. ✅

**One sentence:** real number → pass it. Nothing → zero. Garbage/negative → red + stop.


## 3. The Packer — `deriveBagsFromPieces` (ledger.js, lines  ️166–169

```js
function deriveBagsFromPieces(pieces) {
  var rpb = productionRollsPerBag();
  return Math.max(0, Math.floor((parseFloat(pieces) || 0) / rpb));
}
```

Line by line:
- `var rpb = productionRollsPerBag();` — ask the settings: **how many rolls go in ONE bag?** (Usually `5`.)
- `Math.floor(pieces / rpb)` — divide, then **chop off the remainder** — FULL bags ONLY.
. `Math.max(0, …)` — never go below zero.

**Example:** 16 rolls ÷  ️⃣5 =  ️3.2 → chop → **3 bags**. The 17th roll starts no 4th bag yet. No rounding up — you can't sell half a bag. 🎒


## 4. The Photocopier — `saveState()` (storage.js, lines  ️56–67

```js
function saveState() {
  state.updatedAt = new Date().toISOString();
  try {
    localStorage.setItem(companyStateKey(), JSON.stringify(state));
    if (cloudAutoSync && !cloudSyncSuppressed && typeof triggerGoogleSync === 'function') {
      triggerGoogleSync();
    }
  } catch (e) {
    console.error('Failed to save', e);
  }
}
```

Line by line:
- `state.updatedAt = new Date().toISOString();` — stamp the notebook:"saved at this exact minute".
- `localStorage.setItem(key, JSON.stringify(state))` — **photocopy the whole notebook as TEXT** and lock it in the **safe** (the browser's storage. Refresh can't erase it!
- `if (cloudAutoSync …) triggerGoogleSync();` — and **mail a copy to head office** (the cloud), so all your devices agree.
. `catch (e) { console.error(...); }` — safe jammed (private mode, full disk? Don't crash — scribble a note and keep going.


## 5. The Boss — `renderAll()` (init.js, lines  ️4–30

Every time data changes, the boss shouts:**"Redraw EVERYTHING from the notebook!"**

```js
function renderAll() {
  migrateLegacyEntries();      // clean up old-format data
  rebuildStockAndCogs();       // recalculate stock from the whole history
  renderPriceTable();          // redraw Price wall
  renderUsageTable();          // redraw Usage wall
  renderProduction();          // redraw Production wall
  renderSalesTab();            // redraw Sales wall
  renderDashboard();          // redraw Dashboard wall
  renderCalendar();           // redraw Calendar wall
  renderInventory();          // redraw Inventory wall
  ...
}
```

Why does the Dashboard never disagree with the Production table? Because both walls are drawn from **the same notebook**, moments apart. 👩💼


## 6. Drawing one wall — `renderProduction()` (ledger.js, lines  ️276–308

```js
tbody.innerHTML = list.map(function (p) {
  return '<tr>' + …cells… + '</tr>';
}).join('');
```

- `.map(fn)` — for **EACH** record, build ONE table row (a piece of HTML text).
- `.join('')` — glue all the rows into **ONE big string**.
- `tbody.innerHTML = …` — hand the whole picture to the browser: **"draw this!"**

Real world: like redrawing one whiteboard cleanly from the notebook — you never paste messy one-off notes; you draw the whole wall fresh. 🎨


## 7. The Magic Trio (ends every save

```js
rebuildStockAndCogs();   // recalculate stock from history
saveState();              // photocopy the notebook (safe + cloud)
renderAll();              // boss redraws every wall
```

You'll see this 3-line pattern everywhere: sales, suppliers, timers… It's how the screen always stays honest with the data.


## 8. The big one — `saveProduction()` (watch slow-motion; ledger.js, lines  18–135

| Step | Tiny snippet | Plain words |
|---|---|---|---|
| 1. Read | `validateText($('logDate'))`, `validateOptionalNum($('logBagsProduced'))` … | Assistant fetches the boxes; guard checks them. Bad? Toast + stop. |
| 2. Save the rule | `state.settings.rollsPerBag = localRpb;` | If you changed "rolls per bag", write it into the notebook settings. |
| 3. Think bags | `deriveBagsFromPieces(pieces` | Bags box empty? Packer counts full bags automatically. Typed a number? Respect it. |
| 4. Money math | `capital = ingCost + extra`; `laborCost = hours × wage` | Ingredients + extra; labor hours × wage. |
| 5. Nothing there? | `if (!usageAny && pieces <= 0 && …) return;` | Nothing typed? Stop nicely:"Nothing to save yet." |
| 6. Find the day | `state.production.find(p => p.date === date` | Date already has a page? **EDIT it** — never write a second page (that would deduct ingredients TWICE!` |
| 7. Build record | `const record = { id: uid(), … };` | Write one small card: id, date, pieces, bags, costs… |
| 8. Check pantry | `inventoryUsageShortage(…` | Have the flour/eggs? No → toast + stop. Yes → continue. |
| 9. Write it down | `state.production.push(record);` | Put the card into the notebook (and update pantry counts. |
| 10. Magic trio | `rebuildStockAndCogs(); saveState(); renderAll();` | Stock recalculated → photocopy → boss redraws → your row appears. |


## The data flow in one picture

```
 YOU (type / click)
   │  1. FETCH    $('logDate')        — shop assistant grabs the box
   │  2. GUARD    validateOptionalNum() — door guard checks the number
   │  3. THINK    deriveBagsFromPieces() — packer counts full bags
   │  4. WRITE    state.production.push(…) — card goes INTO THE NOTEBOOK
   │  5. SAVE     saveState()           — photocopy → safe + head office
   │  6️⃣. REDRAW   renderAll()           — boss redraws every whiteboard
   ▼
 SCREEN SHOWS YOUR NEW ROW ✅
```

Where the data lives:

```
        ┌────────────────────────────────────────────┐
        │    📒 THE NOTEBOOK  (state)                 │
        │    production[]  sales[]  suppliers[]  … │
        └───────────────┬────────────────────────────┘
      saveState() │  JSON.stringify (="photocopy as text")
                     ▼
        ┌────────────────────────────────────────────┐
        │    🔒 THE SAFE (localStorage — in your browser)   │
        └────────────────────────────────────────────┘
        also mailed to ☁️ the cloud (Supabase)

  renderAll()  reads the notebook → redraws all the walls
```


## Remember forever

> **Fetch → guard → think → write → save → redraw. That's the whole app.** One notebook (`state`) holds everything; every screen is a view of it; `saveState()` photocopies it (safe + cloud); `renderAll()` redraws from it. Every feature is the same six steps in a trench coat. 🧥


## Where to go next

This lesson is the **map**. Now go take a real lesson — each of `01`–`18` is just ONE of these ideas, deeper, with exercises and code to trace. When one feels hard, come back here and re-read the little story first. There are **no quizzes in this lesson** — the other lessons hold them. When you feel ready, try the exercises at the end of the lesson you picked. You've got this. 💪