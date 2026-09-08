> 🧒 **New to coding?** The whole course explained like you're 10 lives in [lesson-00-plain-english.md](lesson-00-plain-english.md) — read it first (no quizzes, come back here after.
# Lesson 06 — localStorage: making it survive refresh

> Close the tab and reopen it — where did all your data go? Into
> `localStorage`, as **JSON text**. This lesson is the exact mechanism.

Open: **`js/storage.js`** (`saveState`, `loadState`, `persistState`).

---

## 1. The two directions

```
saveState():
  state (JS object)
     │  JSON.stringify(state)
     ▼
  localStorage.setItem(KEY, "json text")

loadState():
  "json text"
     │  JSON.parse(text)
     ▼
  state (JS object)
```

- **`JSON.stringify(x)`** — object → string.
- **`JSON.parse(x)`** — string → object.

Why bother? Because localStorage can ONLY store **strings**. Not objects, not
arrays — strings. The JSON text is the "wire format" between your running app
and the browser's permanent storage.

---

## 2. The exact code

```js
function saveState() {
  state.updatedAt = new Date().toISOString();          // stamp when saved
  try {
    localStorage.setItem(companyStateKey(), JSON.stringify(state));
    if (cloudAutoSync && ...) triggerGoogleSync();       // also push to cloud
  } catch (e) {
    console.error('Failed to save state:', e);
  }
}
```

Three things worth pausing on:

1. **`state.updatedAt` is set *inside* saveState.** Every save records "this
   is how current this data is". The sync code uses it to know which copy is
   newer.
2. **A `try/catch` around storage writes.** Storage can fail (private-mode,
   full, blocked). If it does, we *log* and keep the app alive instead of
   crashing.
3. **Saving locally and pushing to the cloud happen together.** "Save" here
   really means *save everywhere* — device copy + account copy.

---

## 3. Debounce: don't write 40 times a second

```js
function persistState() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveState, 300);
}
```

If the user types fast, we don't want a disk+network write per keystroke. So:
**any change → `persistState()` → wait 300 ms → if nothing else happened,
`saveState()`**. This "wait then fire" pattern is called **debouncing**, and
it's everywhere in production apps.

---

## 4. Loading: JSON.parse + safe defaults

```js
function loadState() {
  try {
    const raw = localStorage.getItem(companyStateKey());
    if (!raw) return;                              // nothing saved yet
    const parsed = JSON.parse(raw);
    if (parsed.prices && Array.isArray(parsed.prices) && parsed.prices.length)
      state.prices = parsed.prices;
    if (Array.isArray(parsed.production)) state.production = parsed.production;
    ...
  } catch (e) { console.warn('Failed to load state', e); }
}
```

Notice the **guards**: before overwriting `state.prices`, check
`Array.isArray(...)`. Old/partial/corrupt data can't crash the load — it just
keeps the default. This is professional-grade defensive coding.

---

## 5. Multiple companies → different keys

```js
function companyStateKey() {
  return ACTIVE_COMPANY && ACTIVE_COMPANY.id !== 'default'
    ? STORAGE_KEY + '_' + ACTIVE_COMPANY.id
    : STORAGE_KEY;
}
```

Same app, same browser, different key per workspace = separate ledgers. This
is how "one shared computer, two businesses" works: **data separation via key
namespacing.**

---

## Exercises

1. In the console: `localStorage.getItem('dailyCrispyRollLedger_v2')` (or the
   per-account key). Look at the JSON. Find your production and sales inside
   the text.
2. Type a sale. Then: `localStorage.getItem(companyStateKey())`. Notice the
   `updatedAt` changed.
3. **Challenge (safe):** `const s = JSON.parse(localStorage.getItem(companyStateKey()))`
   then `s.suppliers.length`. Compare with `state.suppliers.length`. Same
   thing? Why? (One is a snapshot copy, one is live.)
4. Explain each word: "localStorage stores STRINGS. JSON.stringify makes an
   object a string. JSON.parse makes a string an object."
5. Why the `try/catch` around storage? — "Storage can fail; I must not let a
   storage error kill the whole app."

---

## Remember forever

> **`saveState()` = stringify + setItem. `loadState()` = getItem + parse +
> guard with defaults. Debounce writes (wait 300 ms). Wrap storage in
> try/catch. localStorage only speaks strings — JSON is the language.**

---

## Where to go next

[Lesson 07 — Rendering: turning data into screen](lesson-07-rendering.md) — how `state` becomes visible rows.