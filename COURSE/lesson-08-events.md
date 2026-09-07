# Lesson 08 — Events & user input

> Last lesson you saw the render side. Now the trigger side: clicks, typing,
> dropdown changes — and the handlers that read, validate, save, and render.

Open: **`js/sales.js`** (`saveSale`, `updateSaleLive`), **`js/usage.js`**,
**`js/suppliers.js`**.

---

## 1. The event = "something happened"; the handler = "react"

```js
$('addSaleBtn').addEventListener('click', saveSale);
```

Two parts:
- **Event name** (`'click'`) — which thing happened.
- **Handler** (`saveSale`) — a **function reference** (no parentheses!).

If you wrote `saveSale()` you'd call it immediately — not when clicked. With
no parens, you're saying: *browser, call this when the click happens*.

---

## 2. The most common events

| Event | Fires when | Example in app |
|--------|------------|----------------|
| `'click'` | Button tapped | `addSaleBtn`, `saveLogBtn` |
| `'input'` | Every keystroke | live cost calc in Production |
| `'change'` | Value committed (blur/select) | date pickers, dropdowns |
| `'keydown'` | Physical key pressed | pan shortcuts `1..9` |
| `'submit'` | Form submitted | (not used much here — buttons are) |

---

## 3. Reading input safely — `validate*` helpers

```js
function saveSale() {
  const date   = validateText($('saleDate'));
  const pieces = validateNum($('salePieces'));
  const price  = validateNum($('salePrice'));
  if (date === null || pieces === null || price === null) {
    showToast('Enter date, bags, pieces and price per bag.', 'error');
    return;                       // STOP — don't save bad data
  }
```

Notice the **guard-plus-early-return** pattern:
1. **Read** the fields.
2. **Validate** — any `null` → show a message → `return` (abort).
3. Only after validation passes do we mutate state.

This is the single most important habit in form handling: **never save
unvalidated input.**

---

## 4. Writing a record

```js
const record = {
  id: uid(),                    // unique
  date: date,
  pieces: Math.round(pieces),
  bags: Math.round(bags),
  amount: Math.round(bags * price),
  cogs: 0, avgCost: 0, net: 0
};
state.sales.push(record);       // append
saveState();                    // persist + cloud
renderAll();                    // re-project
triggerGoogleSync();            // push
```

Every handler ends the same way: **mutate → save → render → sync.**

---

## 5. Live updates while typing (the `input` event)

```js
['saleBags', 'salePieces', 'salePrice', ...].forEach(function (id) {
  $(id).addEventListener('input', updateSaleLive);
});
```

`updateSaleLive()` recomputes amount / pieces-per-bag / profit *as you type*,
without waiting for the Save button. This is "live calculation" — the UI
answers before you ask.

---

## 6. A tiny but crucial detail: DOM order = load order

The script at the bottom of `index.html`:

```html
<script src="js/config.js?v=..."></script>
<script src="js/storage.js?v=..."></script>
<script src="js/helpers.js?v=..."></script>
...
<script src="js/ledger.js?v=..."></script>
<script src="js/init.js?v=..."></script>
```

Because `ledger.js` does `$('saveLogBtn').addEventListener(...)` at the *top
level*, the element must already exist when the script runs. Browsers run
scripts in order they appear, and these are at the END of `<body>` — so all the
elements exist. That's why order matters: **functions can be defined anywhere,
but top-level code (like addEventListener) must run after the elements.**

---

## Exercises

1. In `sales.js`, find `saveSale`. List its guards (every `if (...) return`).
   What is each protecting against?
2. In the console: `$('addSaleBtn')` — you get the button. Then run
   `$('addSaleBtn').addEventListener('click', () => showToast('hi'))` and
   click the real button. Both handlers run. Then reload.
3. `dispatchEvent(new Event('input'))` on `$('salePrice')` after setting a
   value — watch the profit live update.
4. **Challenge:** add your own button handler: create a button in HTML with
   `id="pingBtn"` and `js`: `$('pingBtn').addEventListener('click', () => showToast('pong'))`.
5. Say out loud: "A handler is a function reference. Read-input → validate →
   mutate-state → save → render → sync. `input` fires as I type, `click`
   fires on tap. Scripts at the bottom of body see all elements."

---

## Remember forever

> **every interaction = an event + a handler that ends with save+render.
> Validate before you save. Pass the function (no parens). Put scripts where
> the elements exist. Live UI = `input` listeners.**

---

## Where to go next

[Lesson 09 — The daily flow: production, packing, sales](lesson-09-production-flow.md) — the actual business pipeline.