> 🧒 **New to coding?** The whole course explained like you're 10 lives in [lesson-00-plain-english.md](lesson-00-plain-english.md) — read it first (no quizzes, come back here after.
# Lesson 11 — Timers & real-time state

> The frying-pan timers are one of the coolest parts of this app — and the
> place where "time" becomes a value you can compute with. This lesson is the
> clock mechanics + why the app works even after a refresh.

Open: **`js/pan-timers.js`** (`tick`, `startPan`, `pausePan`, `load`, `save`)
and **`js/styles.css`** `.pan-card`.

---

## 1. Time is just a number

```js
Date.now()             // ms since 1970-01-01 (a big integer)
new Date(1725800000000)  // a Date object
new Date().toISOString() // "2026-09-06T..."
```

- `Date.now()` → **milliseconds since the Unix epoch** (Jan 1, 1970).
- That number is comparable: newer = bigger.
- `(endAt - Date.now()) / 1000` → seconds remaining (possibly fractional).

Everything about "now" and "then" in this app is just **integer math on
milliseconds**.

---

## 2. A ticking pan = `setInterval` + a `tick` function

```js
function ensureTick() { if (!ticker) ticker = setInterval(tick, TICK_MS); }

function tick() {
  var now = Date.now();
  pans.forEach(function (pan) {
    if (stepPan(pan, now)) triggerAlert(pan, pan.stage);
  });
  renderRunSummary();
  stopTickIfIdle();          // no running pans? clearInterval
}
```

- `setInterval(fn, ms)` → browser calls `fn` every `ms` (here every 250 ms).
- Each tick recomputes `pan.remaining` from `pan.endAt - now`.
- `stopTickIfIdle` → if every pan is done/paused, stop the interval
  (efficiency).

---

## 3. Why endAt (wall clock), not decrement?

```js
function startPan(pan) {
  pan.running = true;
  pan.endAt = Date.now() + pan.remaining * 1000;   // ← store the TARGET
  ensureTick();
  save();
}
function stepPan(pan, now) {
  pan.remaining = Math.max(0, Math.ceil((pan.endAt - now) / 1000));
  ...
}
```

Notice: the app stores **when the pan should finish** (`endAt`), NOT a
countdown. That's the refresh-safe design:

- If you reload the page, `endAt` is still in localStorage.
- The loaded pan computes `remaining = endAt - now` → **a paused/ready/almost
  done pan just continues**, even across a refresh.

If instead the app subtracted 1 every second, reloading would reset the count.
**Store absolute targets, derive countdowns.** This is a timeless lesson.

---

## 4. Saving timers = saving the target, not the countdown

```js
function save() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    v: STORAGE_VERSION,
    settings: settings,
    pans: pans.map(p => ({ id: p.id, duration: p.duration,
      remaining: p.remaining, running: p.running, endAt: p.endAt, stage: p.stage }))
  }));
}
```

`endAt` + `running` is all you need to reconstruct reality after a reload.

---

## 5. Stage machine: the timer as a state machine

```js
// stages: 0 = ready, 1 = fold margins, 2 = close & prep, 3 = done
function stepPan(pan, now) {
  ...
  if (pan.stage === 0 && pan.remaining <= t.fold) { pan.stage = 1; return true; }
  if (pan.stage === 1 && pan.remaining <= t.final) { pan.stage = 2; return true; }
  if (pan.remaining <= 0) { pan.stage = 3; pan.running = false; return true; }
  ...
}
```

A **state machine**: each tick, if a condition is met, move to the next state
and "return true" (which fires the alert). States are just numbers; transitions
are `if` statements.

This is how "Fold margins!" then "Close back!" then "Rolls ready!" all happen
from one shared `tick`.

---

## 6. The alert chain

```js
if (stepPan(pan, now)) triggerAlert(pan, pan.stage);
```
→ beep, toast, banner, title flash — all driven by the one state change.

---

## Exercises

1. In the console: `Date.now()`, then `new Date(Date.now()).toISOString()`.
2. A pan has `endAt = 1725800000000` and `now = 1725799000000`. What is
   `remaining` in seconds? (Hint: `(endAt - now) / 1000`.)
3. Why store `endAt` and not a decrementing counter? — "Reload would reset a
   counter; an absolute target survives refresh."
4. **Challenge:** in `pan-timers.js`, find `stopTickIfIdle` and explain when
   the interval is cleared.
5. Say out loud: "Time is a number (ms). setInterval ticks me. I store the
   endTarget, not a countdown. Each tick I derive remaining and maybe move a
   stage. Refresh-safe."

---

## Remember forever

> **`Date.now()` = ms since epoch. `setInterval` = tick the clock. Store
> `endAt`, derive `remaining`. Stages are numbers; transitions are ifs.
> Save targets, not countdowns — then refresh can't break the timer.**

---

## Where to go next

[Lesson 12 — Sync: why data can diverge](lesson-12-sync-conflicts.md) — the
hardest part of your app, explained.