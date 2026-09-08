# Daily Crispy Roll Ledger — University-style Course

> Built from the **actual source code** in this repository (v1.11.x).
> Every lesson teaches a real concept by pointing at a real file, explains the
> "why", then gives you exercises + a "remember forever" checkpoint.

## How to use this course

Each lesson is **1 hour-ish**. Do them in order. For each:

0. **Just starting out?** Read [Lesson 00 — Plain English overview](lesson-00-plain-english.md) first — the whole course in everyday words, the characters (assistant, guard, packer…), no quizzes. Come back here after.

1. **Read** the lesson, opening each referenced file as you go.
2. **Open the snippets** and trace them yourself in VS Code (Ctrl+Click the
   function name to jump to its definition).
3. **Do the exercises** — they're designed to make you *write code*, not read.
4. **Say the checkpoint out loud** (teaching = remembering).

---

## Curriculum

### Part I — Foundations (how a web app is built from files)

| # | Lesson | File | Concepts |
|---|--------|------|----------|
| 1 | [HTML structure & the DOM tree](lesson-01-html-structure.md) | `index.html` | `<!DOCTYPE>`, `<html>`, `<head>`, elements, attributes, the DOM |
| 2 | [CSS — making it look right](lesson-02-css-styling.md) | `css/styles.css` | Selectors, cascade, specificity, flexbox, utility classes |
| 3 | [JavaScript — variables, functions, scope](lesson-03-javascript-basics.md) | `js/helpers.js` | `const`/`let`/`var`, functions, arrow functions, `typeof` |
| 4 | [The DOM API — talking to the page](lesson-04-dom-api.md) | `js/helpers.js`, `js/ledger.js` | `getElementById`, events, `innerHTML`, `querySelectorAll` |

### Part II — The app's core (state, persistence, rendering)

| # | Lesson | File | Concepts |
|---|--------|------|----------|
| 5 | [The state object — one place for ALL data](lesson-05-state-object.md) | `js/storage.js`, `js/config.js` | objects, arrays, nested data, default state |
| 6 | [LocalStorage — making it survive refresh](lesson-06-localstorage.md) | `js/storage.js` | `localStorage`, `JSON.stringify`, `JSON.parse`, persistence |
| 7 | [Rendering — turning data into screen](lesson-07-rendering.md) | `js/ledger.js`, `js/init.js` | `renderProduction`, `renderAll`, template literals, `map().join('')` |
| 8 | [Events & user input](lesson-08-events.md) | `js/sales.js`, `js/usage.js` | `addEventListener`, `change`/`input`, handlers |
| 9 | [The daily flow — production, packing, sales](lesson-09-production-flow.md) | `js/ledger.js`, `js/usage.js` | pipelines, derived data, the bag-count rule |
| 10 | [Numbers, money & formatting](lesson-10-math-money.md) | `js/helpers.js` | `parseFloat`, rounding, `toLocaleString`, `toFixed`, grouping |

### Part III — Timers, sync & the cloud

| # | Lesson | File | Concepts |
|---|--------|------|----------|
| 11 | [Timers & real-time state](lesson-11-timers.md) | `js/pan-timers.js` | intervals, `Date.now`, `setInterval`, wall-clock vs countdown |
| 12 | [Sync — why data can diverge](lesson-12-sync-conflicts.md) | `js/cloud.js` | `localStorage` vs cloud, conflict, last-write-wins, merge |
| 13 | [The accept/decline machine](lesson-13-sync-review.md) | `js/cloud.js` | fingerprints, `openSyncReview`, `resolveSyncReview`, decisions |
| 14 | [Backend — Supabase & the realtime channel](lesson-14-supabase.md) | `js/supabase.js`, `_supabase-setup.sql` | tables, RLS, JWT, realtime subscriptions |

### Part IV — Hard skills that make you a real programmer

| # | Lesson | File | Concepts |
|---|--------|------|----------|
| 15 | [Debugging — reading the machine's mind](lesson-15-debugging.md) | `_verify_*.js`, `console.log` | stack traces, `node --check`, writing a test harness |
| 16 | [Version control with Git](lesson-16-git.md) | `.git`, commits | `status`, `add`, `commit`, `diff`, `log`, working tree |
| 17 | [Testing — the safety net](lesson-17-testing.md) | `_verify_*.js` | assertions, `ok()`, running suites, unit vs integration |
| 18 | [Design patterns you already use](lesson-18-patterns.md) | whole repo | pure functions, single source of truth, fallbacks |

---

## Remember-forever summary (the 10 ideas that make this app tick)

1. **A web page is just text → a tree → things on screen.** Browser reads
   `index.html`, builds the DOM, applies CSS, runs JS.
2. **`const $ = (id) => document.getElementById(id);`** — a tiny function that
   means "give me the thing with this id" everywhere.
3. **One state object holds ALL data** (`state`), and every render reads from
   it. Change the state → re-render → the screen updates.
4. **`saveState()` = copy `state` to `localStorage` as JSON.** `String` in,
   `JSON.parse` out.
5. **`renderX()` functions are pure-ish:** read `state`, build HTML string,
   shove into `innerHTML`. Same data → same screen, every time.
6. **Events are functions that run when something happens.** `input` fires as
   you type; `change` fires when you blur/select.
7. **Derived vs stored.** Bags are *derived* from pieces by
   `floor(pieces ÷ rollsPerBag)` — the app never asks you to type them.
8. **Sync is hard because there are two copies.** `localStorage` (device) and
   the cloud (account). They diverge; the app must pick or ask.
9. **A fingerprint of data tells you "is this the same change?".** Then
   Accept/Decline is remembered so refresh never re-asks.
10. **Debug by reading the trace, then shrinking the problem.** Write tiny
    scripts that load only the files you need and print exactly what happened.

---

## Need help?

If a lesson mentions a function you can't find, use VS Code:
`Ctrl+Shift+F` (search) or `Ctrl+Click` a function name. All code is in this
repo — it's all real and it all runs.