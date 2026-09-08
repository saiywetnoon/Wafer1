> 🧒 **New to coding?** The whole course explained like you're 10 lives in [lesson-00-plain-english.md](lesson-00-plain-english.md) — read it first (no quizzes, come back here after.
# Lesson 03 — JavaScript: variables, functions, scope

> This is the lesson that makes the app *alive*. Everything you'll ever read
> in `js/*.js` is built from the ideas here.

Open: **`js/helpers.js`** — 300 lines that power the whole app.

---

## 1. Variables: `const`, `let`, `var`

```js
const fmt = (n) => Number(n).toLocaleString('en-US');
const fmtKs = (n) => fmt(Math.round(n)) + ' Ks';
const today = () => { ... };
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
```

- `const` — a **constant binding**: you can't reassign it. (You CAN still
  mutate the object it points to — more on that in Lesson 05.)
- `let` — a **reassignable variable**, scoped to the block `{ }`.
- `var` — like `let` but **function-scoped** and hoisted. The old way. The
  codebase uses `var` in older places (`var supplier = ...`) and `const/let`
  in newer code — both work, but *you* should always use `const` or `let`.

Rule of thumb: **default to `const`. Only use `let` when you truly must
reassign. Never use `var` in new code.**

---

## 2. Functions: named, arrow, and "functions are just values"

Three ways to define a function:

```js
// 1. Arrow (const) — the modern way:
const fmt = (n) => Number(n).toLocaleString('en-US');

// 2. Function declaration — hoisted, can be called before its definition:
function renderProduction() { ... }

// 3. Arrow with a body:
const today = () => { const d = new Date(); return localDate(d); };
```

Key insight: **a function is a value**. You can store it, pass it, call it
later. `$(id)` is a function. `saveState` is a function. The app is basically
a box of functions that call each other.

---

## 3. Scope: where can a name be seen?

```js
let state = { ... };              // global (whole app)

function renderAll() {
  const formDate = $('logDate').value || today();   // local to renderAll
  renderProduction();                               // uses global state
}
```

- Variables declared at the top of a file are **global** — every later file
  can see them (that's why `state` is usable in all `js/*.js`).
- Variables declared inside a function belong to that function only.
- Nested blocks `{ }` create scope for `let`/`const`.

**This is exactly why the app works across files:** each `js/*.js` file can
call functions and read variables declared in earlier-loaded files.

---

## 4. `typeof`, truthiness, `==` vs `===`

`helpers.js` uses `typeof` to guard against missing things:

```js
const esc = (s) => String(s == null ? '' : s)...
```

And everywhere in the codebase:

```js
if (typeof window !== 'undefined' && window.showToast) ...
if (typeof bags === 'number' && isFinite(bags) && bags > 0) ...
```

- `typeof x` → a string: `'number'`, `'string'`, `'object'`, `'function'`,
  `'undefined'`.
- **Truthy / falsy**: `0`, `''`, `null`, `undefined`, `NaN`, `false` are
  falsy. Everything else is truthy. So `if (p.bags)` checks "is there a bag
  count?".
- **`===` (strict)** compares value AND type; `==` does type-coercing
  comparison. Always use `===` / `!==` unless you really know why not.

---

## 5. The tiny helpers that run your whole business

```js
const $  = (id) => document.getElementById(id);        // look up an element
const fmt  = (n) => Number(n).toLocaleString('en-US'); // 1,234
const fmtKs = (n) => fmt(Math.round(n)) + ' Ks';       // 1,234 Ks
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2,7);
```

- `$` is a **shortcut** — why write `document.getElementById` 200 times when
  you can write `$`? (A very old library made this famous; here it's yours.)
- `uid` creates a **unique id** for each record (sales, suppliers, pans) —
  that's how rows stay distinct. `Date.now()` = ms since 1970; `.toString(36)`
  = base-36, so the ids are short and sortable by time.
- `esc` **escapes HTML** so data you type can't break the page or trigger
  injection attacks. Whenever you put a user value into HTML, wrap it.

---

## Exercises

1. In `helpers.js`, find `today()`. Trace each line: what does `new Date()`
   give, why `getTimezoneOffset()`, why `slice(0, 10)`? (Answer: it returns
   today's date as `YYYY-MM-DD` in the LOCAL timezone — the date format every
   input uses.)
2. Write `const fmtKs = (n) => fmt(Math.round(n)) + ' Ks';` and predict:
   `fmtKs(1234.6)`. Check it in your head, then test in the browser console
   (F12).
3. Find three places the code uses `typeof x !== 'undefined'` and say why.
4. **Challenge:** in the browser console, type `$('logBagsProduced')` (Production
   tab open). It should return the element. Now `$(123)` returns... `null`.
   Why? Because `getElementById` expects a string id.
5. Say out loud: "A function is a value. `const` never rebinds. `typeof`
   tells me if something exists first."

---

## Remember forever

> **`const` + arrow functions + `$` + `typeof`-guards = how every file in this
> app is written. A function is a value you can pass. Scope decides who can
> see a name. Guard with `typeof` before you touch things that might not
> exist.**

---

## Where to go next

[Lesson 04 — The DOM API: talking to the page](lesson-04-dom-api.md) — the
actual `document.` calls that make the screen change.