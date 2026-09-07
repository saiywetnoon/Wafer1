# Lesson 18 — Design patterns you already use

> You've now *used* professional patterns for 17 lessons. This final lesson
> gives them their proper names. Naming things matters: once you have the
> vocabulary, you can read any codebase and reuse the ideas anywhere.

---

## 1. Single Source of Truth (the state object)

**Pattern:** ONE place holds the real data; everything else is a projection.

You already know it: `state` holds production, sales, suppliers, etc. Every
screen reads from `state`. Change `state` once → re-render → consistent.

> "Multiple views of the same truth" — this is why the Dashboard, Calendar,
> and Production table never disagree.

---

## 2. Render from State (Unidirectional Data Flow)

**Pattern:** data flows ONE way.

```
state ──► render ──► screen
   ▲
   └────── handler (reads inputs, mutates state)
```

No screen writes to another screen. No random DOM mutation hiding data.
Compare with the opposite (buggy) pattern: each screen editing its own copy and
then trying to "sync the copies" — that's how data diverges.

---

## 3. Pure-ish functions (deriveBagsFromPieces)

**Pattern:** a function that maps input → output with no side effects.

```js
function deriveBagsFromPieces(pieces) { return Math.floor(pieces / rpb); }
```

Same input → same output → easy to test. That's why `deriveBagsFromPieces`
has a unit test. **Keep business math in pure functions and the bugs go down
enormously.**

---

## 4. Defensive programming (validate + guards)

**Pattern:** assume the input is wrong until proven otherwise.

```js
if (date === null || pieces === null || price === null) return;  // guard

if (typeof bags === 'number' && isFinite(bags) && bags > 0) ...   // shape check
```

- `typeof` + `isFinite` + range check = "is this a usable number?"
- Early `return` = "stop before touching state with bad data."

You'll see this everywhere (`validateOptionalNum`, `normalizeSettings`,
`stateDataCount`). Change the crash to a controlled message.

---

## 5. Debouncing (the 300-ms save)

**Pattern:** coalesce rapid events into one slower action.

```js
function persistState() {
  clearTimeout(saveTimer);                 // cancel previous
  saveTimer = setTimeout(saveState, 300);  // schedule fresh
}
```

Every keystroke calls `persistState`, but `saveState` runs only after 300 ms of
silence. Used for autosave, search boxes, resize handlers. Cheap + huge
efficiency win.

---

## 6. The State Machine (pan stages)

**Pattern:** a thing can be in one of N states; transitions are explicit.

```
READY → HEATING → FOLD → CLOSE → DONE → (reset → READY)
```

States are numbers (`pan.stage`), transitions are `if` conditions in `tick`.
This is the textbook "finite state machine" — great for anything that goes
through stages (checkout, cooking, workflow).

---

## 7. Event Sourcing / Replay (rebuildStockAndCogs)

**Pattern:** don't maintain a running total; RECOMPUTE from history.

```js
function rebuildStockAndCogs() {
  // replay every production + sale + waste, in date order, from scratch
}
```

You never trust a stored counter that could drift. You *derive* reality from
the log of events. (The `updatedAt` set on every save is a mini version of
this too — stamps on events.)

---

## 8. Pub/Sub (Supabase realtime)

**Pattern:** one writer publishes; many subscribed readers get told.

```
Device A saves → Supabase row changes → B and C get notified
```

No polling, no "is it done yet". The server pushes. Used in chat, dashboards,
multi-device apps. Your sync layer is literally this.

---

## 9. Fallbacks (`|| default`, `?? default`, `?? value`)

**Pattern:** give me a good value or a safe default.

```js
state.settings.rollsPerBag || DEFAULT_ROLLS_PER_BAG;
state.settings.hourlyWage || 1500;
typeof DEFAULT_ROLLS_PER_BAG !== 'undefined' ? DEFAULT_ROLLS_PER_BAG : 5;
```

Handle the "empty / new / corrupt" cases by falling back to a sensible
default, instead of crashing. You saw it in `loadState`, `productionRollsPerBag`,
`normalizeSettings`.

---

## 10. Test Harness / Mock (the `_verify_*.js` files)

**Pattern:** replace dependencies with fakes to test logic in isolation.

```js
global.document = { getElementById: () => fakeEl() };   // mock DOM
await cloudPush = () => { pushes++; return { ok: true }; };  // mock network
```

Fake the boundary (network, DOM, storage), test the pure logic. This is
exactly how serious teams test without a browser.

---

## The wrap-up

You now know:
- How a web app is **structured** (HTML tree → CSS → JS).
- How data **lives** (one `state`, persisted to localStorage as JSON).
- How the **screen updates** (read → mutate → save → render).
- How the **business runs** (one production row/day, derived bags, stock
  replay).
- How **time** works (store targets, derive countdowns).
- How **sync** really works (two copies, conflict, fingerprint, review).
- How the **server** stores data (RLS + JSON row + realtime).
- How you **stay safe** while programming (debug, git, tests).

Congratulations — you're no longer "using" the app. You *understand* its
architecture, and that's the difference between someone who types code and a
programmer.

---

## Final challenge

Take one feature (e.g. "Add Supplier") and, in your own words:
1. Trace the HTML for the form.
2. Trace the JS handler `addSupplierBtn`.
3. Say which pattern each step exemplifies.

Then go build something of your own. The patterns you now know are transferable
to ANY app.