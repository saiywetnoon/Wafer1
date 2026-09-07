# Lesson 15 — Debugging: reading the machine's mind

> A feature is broken. Now what? Real programming is mostly this. This lesson
> teaches the method that every professional uses: **read the trace, find the
> file, shrink the problem**.

Open: **`_verify_sync.js`** (a small harness), **`_verify_inventory.js`**, and
run `node --check` mentally.

---

## 1. The two kinds of "it doesn't work"

| Symptom | Meaning | Where to look |
|---------|---------|----------------|
| Red error in console | JS threw an exception | The stack trace names a file + line |
| No error, wrong output | Logic bug (or bad guard) | The handler + the state it mutates |

You fix them differently. Exceptions → read the trace. Wrong output → inspect
state at render time.

---

## 2. Reading a stack trace (this is THE skill)

A trace is a list of "who called whom":

```
TypeError: Cannot read property 'length' of undefined
  at deriveBagsFromPieces (ledger.js:166)
  at saveProductionFromRun (ledger.js:200)
  at saveProduction (ledger.js:50)
```

Three things to read:
1. **Type of error** — `TypeError`, `ReferenceError`, `SyntaxError`.
   - `TypeError`: you called a method on something that isn't what you think.
   - `ReferenceError`: you used a variable that doesn't exist (scope!).
   - `SyntaxError`: the file can't even be parsed (missing `}`, etc.).
2. **The message** — *exactly* which thing was undefined.
3. **The stack** — the top frame is where it threw; the frames below are the
   call chain. Top = your bug; below = path.

**Always find where it happened (the line) BEFORE guessing why.**

---

## 3. `node --check` = instant syntax sanity

```bash
node --check js/ledger.js
```

This **parses** the file (no execution) and reports any `SyntaxError`. If a
whole feature died, run this first — a missing `}` in one file breaks that
script entirely.

---

## 4. The "printf debug" that everyone uses: `console.log`

```js
console.log('pieces=', pieces, 'bags=', bags);
```

Print the *inputs* and *outputs* at key points:
- Before the operation: what did I read?
- After: what did I compute?
- Compare with what you expected.

This is honest, immediate, and you can leave a `console.log` in dev forever.

---

## 5. The real power move: a minimal harness (like `_verify_*.js`)

The project has tiny scripts that **load only what's needed** and call one
function with a fixed input:

```js
const src = read('config.js') + '\n' + read('storage.js') + '\n' +
            read('helpers.js') + '\n' + read('ledger.js');

eval(src + `
  ;(function(){
    state.settings.rollsPerBag = 5;
    saveProductionFromRun('2026-09-06', 16, null);
    console.log('bags=', state.production[0].bags);   // expect 3
  })();
`);
```

Why harnesses beat clicking around:
- **Deterministic**: same input → same run, every time.
- **Headless**: no browser needed; runs in `node`.
- **Fast feedback**: fix → rerun → see.

The pattern: *stub the browser bits* (`localStorage`, `document`, `$`,
`showToast`), then call real functions. That's exactly what `_verify_sync.js`
does — fake the network, test the real merge logic.

---

## 6. The shrink loop (use it every single time)

1. **Reproduce**: get the exact failing input.
2. **Read the error** (or add a `console.log`) → find the line.
3. **Isolate**: comment out / reduce to the smallest call that breaks.
4. **Hypothesis** → change one line → **rerun**.
5. Repeat until green.

Never change 10 things at once. One change, one rerun.

---

## Exercises

1. Run `node --check js/ledger.js` in your terminal. It should print nothing
   (pass). Now introduce a bug — delete a `}` — and rerun. Read the error.
   Undo.
2. Run a real harness: `node _verify_inventory.js`. Read the last line. Why is
   this faster than reloading the app?
3. In the browser, open F12 → Console. Cause an error (e.g. `undefinedThing()`
   ) and read the trace. Which was it, a `ReferenceError`?
4. **Challenge:** write `/tmp` (or project root) a 6-line script that loads
   the modules and prints `deriveBagsFromPieces(17)` — expect `3`.
5. Say out loud: "Read the trace top-down. TypeError = wrong shape,
   ReferenceError = no such variable, SyntaxError = unparsable file. console.log
   the inputs and outputs. Isolate to the smallest failing call, change one
   thing, rerun."

---

## Remember forever

> **Errors are information, not enemies. Always find the LINE first. Use
> `node --check` for syntax, `console.log` for values, and a tiny harness to
> reproduce logic bugs headlessly. One change → one rerun.**

---

## Where to go next

[Lesson 16 — Version control with Git](lesson-16-git.md) — never lose a working
version again.