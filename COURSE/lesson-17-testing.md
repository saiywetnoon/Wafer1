# Lesson 17 — Testing: the safety net

> How do you know a fix is really fixed? You **test it automatically**. This
> repo has a whole folder of tiny programs that prove the app works — this
> lesson makes you able to read, run, and write them.

Open: **`_verify_inventory.js`**, **`_verify_sync.js`**, and run one.

---

## 1. A test = code that checks code

The shape is always:

```js
ok(condition, 'human-readable description');
```

```js
function ok(cond, msg) {
  if (cond) { pass++; console.log('PASS ' + msg); }
  else      { fail++; console.log('FAIL ' + msg); }
}
```

You *assert* something that SHOULD be true. If it isn't → `FAIL` → you know
exactly which expectation broke.

---

## 2. The test harness pattern (this repo's style)

A "harness" is code that **fakes the browser so real logic can run in Node**:

```js
global.localStorage = { getItem, setItem, removeItem };  // fake storage
global.document = { getElementById: () => fakeEl() };     // fake DOM
global.showToast = () => {};                              // fake toast

const src = read('config.js') + '\n' + read('storage.js') + '\n' +
            read('helpers.js') + '\n' + read('ledger.js');   // real code

eval(src + `
  ;(function(){
    state.settings.rollsPerBag = 5;
    saveProductionFromRun('2026-09-06', 16, null);
    ok(state.production[0].bags === 3, '16 rolls at 5/bag => 3 bags');
  })();
`);
```

Why this works: the app logic doesn't *inherently* need a browser — it needs a
`state` object. Give it a fake `document` + storage, and the same functions
run exactly as they would in Chrome. **Headless testing.**

---

## 3. What this repo's tests cover

| File | What it proves |
|------|----------------|
| `_verify_inventory.js` | Production save → ingredients deducted once, stock correct, bags derived |
| `_verify_sync.js` | Fresh device pulls; empty cloud adopts; conflicts open review; decisions persist |
| `_smoke_pan_timers.js` | Pan timers: start/stop/stages/settings round-trip |
| `_verify_ai.js` | AI root-cause analysis rules |
| `_verify_layout.js` | `index.html` structure (tabs/panels balanced) |
| `_verify_draft_recovery.js` | Draft save/restore across days |
| `_verify_pan_timers.js` / `_verify_refactor.js` | Pan stepping & helpers |

Each ends with either `ALL ... CHECKS PASSED` or a count of failures.

---

## 4. Test the rule, not the pixels

The most valuable tests here assert **business rules**, not UI:
- `16 rolls at 5/bag => exactly 3 bags`
- `17 rolls still = 3 bags (4th bag needs 5)`
- `two pan runs deduct the daily recipe exactly ONCE`
- `empty cloud + local data -> first sync pushes local`

These are called **regression tests**: if someone breaks that rule later, the
suite turns red and the exact line shows *where*.

---

## 5. The workflow when you change code

1. Make your change.
2. Run the relevant suite: `node _verify_inventory.js`.
3. See a `FAIL`? Read the message → find the real `ok(...)` that failed →
   follow the logic.
4. When green + you add a NEW rule, add a NEW `ok(...)` too.

---

## 6. Red → Green

Always see it **fail first** when adding a test for a new rule (prove the test
catches the bug), then make it pass. That confirmation is what makes tests
trustworthy.

---

## Exercises

1. Run `node _verify_inventory.js`. What's the final line?
2. Find the `ok(...)` that checks "16 rolls at 5/bag ⇒ exactly 3 bags". What
   line number? What would happen if you changed `rollsPerBag` to 6?
3. Run `node _verify_sync.js`. What's its last line?
4. **Challenge:** edit `deriveBagsFromPieces` temporarily to use `Math.ceil`
   instead of `Math.floor`, run `_verify_inventory.js`, read the FAILs, then
   change it back. (This is exactly how a regression test earns its keep.)
5. Say out loud: "A test asserts an expectation. A harness stubs the browser
   and runs the real logic headless. Green = rules hold. Red = I broke
   something. New rule → new test."

---

## Remember forever

> **`ok(condition, message)` is the whole language. Harness = fake the DOM,
> run the real functions. Test business rules, not pixels. See red before
> green. Suites make 'it worked before' provable, forever.**

---

## Where to go next

[Lesson 18 — Design patterns you already use](lesson-18-patterns.md) — name
the habits you've been learning, so you can reuse them in ANY project.