> 🧒 **New to coding?** The whole course explained like you're 10 lives in [lesson-00-plain-english.md](lesson-00-plain-english.md) — read it first (no quizzes, come back here after.
# Lesson 10 — Numbers, money & formatting

> Your ledger is about money. Money is numbers. Numbers from forms are
> **strings**. This lesson = parsing, rounding, and making them beautiful.

Open: **`js/helpers.js`** (`fmt`, `fmtKs`, `validate*`), **`js/ledger.js`**
(`saveProduction`).

---

## 1. The form gives you strings; money wants numbers

```js
const bags   = validateOptionalNum($('logBagsProduced'));
const pieces = validateOptionalNum($('logPieces'));
```

`.value` is ALWAYS a string (`"40"`, `""`). You must convert:
- `parseFloat("40")` → `40`
- `parseInt("40")` → `40`
- `Number("40")` → `40`

Each has nuances:
| Call | Result |
|------|--------|
| `parseFloat("40.5")` | 40.5 |
| `parseInt("40.5")` | 40 (stops at the dot) |
| `Number("")` | 0 |
| `parseFloat("abc")` | `NaN` |
| `Number(null)` | 0 |

`NaN` = "Not a Number". Anything that becomes `NaN` must be treated as an
error, which is why `validate*` returns `null` on bad input.

---

## 2. `validateOptionalNum` — the safe reader

```js
function validateOptionalNum(input) {
  const raw = (input.value || '').trim();
  if (raw === '') { return 0; }                 // empty = 0 (allowed)
  const val = parseFloat(raw);
  if (isNaN(val) || val < 0) { return null; }   // bad → null
  return val;
}
```

- Empty string → `0` (for the "pack later" flow).
- Bad or negative → `null` → the handler shows an error and aborts.
- Otherwise → the number.

This one function prevents the thousands of "user typed garbage" bugs.

---

## 3. Rounding — money is integers (kyats)

```js
Math.round(1234.6)  // 1235
Math.round(1234.4)  // 1234
Math.floor(16 / 5)  // 3  (TRUNCATE toward zero)
Math.ceil(16 / 5)   // 4  (round up)
```

Your app uses:
- `Math.round(...)` for money (no fractions of kyat).
- `Math.floor(...)` for bags (full sets only — never round UP a bag).
- `Math.round(x * 100) / 100` for per-piece costs (2 decimals).

---

## 4. Formatting — `fmt` and `fmtKs`

```js
const fmt   = (n) => Number(n).toLocaleString('en-US');
const fmtKs = (n) => fmt(Math.round(n)) + ' Ks';
```

| Code | Output |
|------|--------|
| `fmt(1234)` | `1,234` |
| `fmt(1234567)` | `1,234,567` |
| `fmtKs(1540)` | `1,540 Ks` |
| `(1.5).toFixed(1)` | `"1.5"` |

- `toLocaleString('en-US')` adds thousands separators.
- `fmtKs` rounds first (money), then prettifies, then appends ` Ks`.
- `toFixed(2)` is for percentages / piece costs where you WANT decimals.

**Rule:** store raw numbers (`240`, `1540`), display formatted strings
(`1,540 Ks`). Never store the formatted string — you can't do math on
`"1,540 Ks"`.

---

## 5. The `|| 0` fallback idiom

```js
const w = parseFloat($('hourlyWage').value) || state.settings.hourlyWage || 0;
```

- `parseFloat('')` → `NaN` → falsy → falls through.
- `state.settings.hourlyWage` → number if set.
- `0` → final safety net.

`||` "falls forward to the next truthy value". It's the codebase's way of
saying "give me a usable number or 0".

---

## 6. Never trust a string; always guard

```js
const amount = bags * price;                 // both are numbers by now
record.amount = Math.round(amount);
```

The whole pipeline: **read string → validate → parse → compute → round →
store → format at render.**

---

## Exercises

1. In the console, run `fmt(1234567)`, `fmtKs(1540.6)`, `(1.5).toFixed(1)`,
   `parseFloat('abc')`, `isNaN(parseFloat('abc'))`.
2. Find `validateOptionalNum` and explain why empty → 0 but garbage → null.
3. `Math.floor(16/5)` vs `Math.ceil(16/5)` — which is "full bags only"? Why?
4. **Challenge:** write a one-liner `const ks = n => Math.round(n).toLocaleString('en-US') + ' Ks'`
   and compare with `fmtKs`.
5. Say out loud: "Forms give strings; money wants numbers. Validate → parse →
   round → store raw → format at display. `|| 0` is my safety net. `floor`
   for full bags, `round` for money."

---

## Remember forever

> **Store numbers, display strings. `parseFloat` + checks = safe input.
> `Math.round` for money, `Math.floor` for full bags. `fmtKs` is just
> round + group + " Ks". `|| 0` means "usable or nothing".**

---

## Where to go next

[Lesson 11 — Timers & real-time state](lesson-11-timers.md) — how the frying
pans tick.