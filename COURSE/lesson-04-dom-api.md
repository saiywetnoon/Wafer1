# Lesson 04 — The DOM API: talking to the page

> Now you know HTML, CSS, and JS. This lesson connects them: how JS reaches
> INTO the page, reads what the user typed, and writes new HTML back.

Open: **`js/helpers.js`** (`$`, `showToast`) and **`js/ledger.js`**
(`saveProduction`, `renderProduction`).

---

## 1. Reading from the page (input)

```js
const date = validateText($('logDate'));
const bags = validateOptionalNum($('logBagsProduced'));
const pieces = validateOptionalNum($('logPieces'));
```

- `$('logBagsProduced')` → the `<input>` element.
- `.value` → the string the user typed (or empty).
- `validateOptionalNum(...)` → checks it, trims, returns a number or `null`.

**The most common bug in beginner JS:** comparing `.value` (a string!) to a
number using `==`. `'40' == 40` is `true` (truthy coercion) but `'40' === 40`
is `false`. That's why the app parses and validates everything.

---

## 2. Writing to the page (output): `innerHTML`

`renderProduction()` builds a **big HTML string** and assigns it:

```js
tbody.innerHTML = list.map(function (p) { return '<tr>...</tr>'; }).join('');
```

Break it down:
- `list` → array of production records.
- `.map(fn)` → new array, one string per record.
- `.join('')` → glue them into ONE string.
- `tbody.innerHTML = ...` → the browser re-parses it and displays the rows.

**You are generating HTML with code.** This is the core trick of this app
(and of many old-school dynamic UIs).

⚠️ **Never** put user text into innerHTML without escaping it →
`esc(p.notes)` (see Lesson 03). That's how you avoid breaking the page *and*
XSS attacks.

---

## 3. Events: "when something happens, run this function"

```js
$('addSaleBtn').addEventListener('click', saveSale);
```

When the user clicks the "Log Sale" button, the browser calls `saveSale()`.

Other events you'll see:
| Event | When it fires |
|-------|----------------|
| `click` | Button pressed |
| `input` | As you type (every keystroke) |
| `change` | User commits a value (blurs, or selects) |

Example from `usage.js`:

```js
['logBagsProduced', 'logPieces', ...].forEach(function (id) {
  $(id).addEventListener('input', function () {
    updateUsageCosts();  // recompute costs as you type
    persistDraft();      // save what you've typed
    draftTouched = true;
    updateDraftHint();
  });
});
```

Watch what that does: **typing in Pieces → recompute + save automatically.**
Live calculation = many `input` listeners.

---

## 4. Changing appearance through classes (not innerHTML)

The tab system toggles a class:

```js
// somewhere in helpers.js / init / tab handling
panel.classList.remove('hidden');   // show
panel.classList.add('hidden');      // hide
```

Better than rewriting HTML — fast, and CSS does the styling.

---

## 5. The read-render cycle (the heart of the app)

```
User types / clicks
   │
   ▼
handler function  (e.g. saveProduction, addSale)
   │  1. read .value of the inputs
   │  2. mutate the state object
   │  3. saveState()  → localStorage + cloud
   │  4. renderAll()  → re-render the page from state
   ▼
screen updates
```

That's the whole app in one loop. Every feature is just a variant:
**read → change state → save → render**.

---

## Exercises

1. In `renderProduction()`, find the line that builds one `<tr>` string. Add
   a small `<span>` with the word `PACKED` inside the "Bags" cell, then
   refresh. It should appear on every production row.
2. In `saveProduction()`, list the order of: read inputs → validate → mutate
   state → save → render. Write it out in one sentence.
3. In the browser console (Production tab), run:
   `$('logPieces').value = '100'` then trigger the input event manually:
   `$('logPieces').dispatchEvent(new Event('input'))` — watch the costs
   update. (That's your live calc at work.)
4. **Challenge:** add `classList.toggle('hidden')` on `$('supplierName')`
   from the console and watch it disappear/reappear. Explain what happened.
5. Say out loud: "JS reads `.value`, builds HTML via `.map().join('')`,
   assigns `innerHTML`, and listens for events with `addEventListener`. The
   app is a loop: read → change state → save → render."

---

## Remember forever

> **`$` reads and writes elements. `innerHTML` is the output channel.
> `addEventListener` is the input channel. `classList.toggle` is the
> cheap way to show/hide. The whole app is the read→change→save→render loop.**

---

## Where to go next

[Lesson 05 — The state object: one place for all data](lesson-05-state-object.md) — the data model that everything reads from.