# Lesson 13 — The accept/decline machine

> When two copies of the ledger differ, the app opens a modal asking you to
> choose the **official** copy. This lesson = the fingerprint, the modal, and
> how the app remembers your choice so a refresh never re-asks.

Open: **`js/cloud.js`** (`stateFingerprint`, `openSyncReview`,
`resolveSyncReview`, `handleRemoteCopy`) and **`index.html`** (`#syncReviewModal`).

---

## 1. Fingerprint = "does this exact copy still exist?"

```js
function stateFingerprint(s) {
  try {
    var n = normalizeForCompare(s);
    return JSON.stringify(n, Object.keys(n).sort());
  } catch (e) { return ''; }
}
```

A **fingerprint** is a hash-like string of the ledger's *content* (with the
noisy stamps removed, keys sorted). Two ledgers that are logically the same →
same fingerprint. Different content → different fingerprint.

Why does it matter? **The app needs to recognise "this exact remote copy"**
next time it arrives — from a refresh, a poll, or realtime — so it can say
*"I already asked you about THIS one"*.

---

## 2. The recursive trap: ask → refresh → ask again

Without the fingerprint + decision memory, every page refresh would re-fetch
the same old remote copy and immediately re-open the same modal — forever.
That's the bug you hit early on.

The fix:
```js
if (wasSyncDeclined(fp) || wasSyncAccepted(fp)) return false;  // already decided
```

---

## 3. Decisions survive refreshes (localStorage)

```js
var SYNC_REVIEW_DECIDED_KEY = 'dailyCrispyRollLedger_syncReview';
function syncDecisions() {
  try {
    var raw = window.localStorage.getItem(SYNC_REVIEW_DECIDED_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (e) { return {}; }
}
function setSyncDecision(fp, val) {   // 'accepted' | 'declined'
  var m = syncDecisions(); m[fp] = val; ...
  window.localStorage.setItem(SYNC_REVIEW_DECIDED_KEY, JSON.stringify(m));
}
```

- Map of `fingerprint → decision`.
- Written to localStorage → **survives reload**.
- Capped at 150 entries so it doesn't grow forever.

Now the flow is:
```
remote copy arrives → fingerprint → already decided? → skip silently
                 ↓ (no)
                 open modal → user clicks
                 → resolve → setSyncDecision(fp, result) → push chosen copy
```

---

## 4. Resolving the choice

```js
async function resolveSyncReview(accepted) {
  ...
  if (accepted) {
    // make the REMOTE the official copy on THIS device + cloud:
    applyCloudRemote({ state: cur.state }, cur.ts, true);
    renderAll();
    await cloudPush();
  } else {
    // KEEP MINE → this device's data is official → push it to the cloud:
    setSyncDecision(cur.fp, 'declined');
    const up = await cloudPush();
  }
}
```

- **Accept**: replace local with the remote copy, then push (so everyone now
  shares it).
- **Keep Mine**: keep local, push it (so the cloud now shares the device's
  data).

Both end with the cloud having ONE copy = convergence.

---

## 5. Why convergence matters ("asked twice" gone)

After either choice, the device AND the cloud contain the same data. The next
time `handleRemoteCopy` compares them, `statesEqual` returns `true` → `'aligned'`
→ no modal. If the remote somehow comes again (stale cache), the fingerprint
decision short-circuits it.

---

## Exercises

1. Open the modal markup in `index.html`. Which two buttons exist and what
   does each say?
2. In `openSyncReview`, find the two "already decided" returns.
3. Predict: `setSyncDecision('abc', 'declined')` then `syncDecisions()['abc']`
   → `'declined'`. Verify in console.
4. **Challenge:** simulate: `stateFingerprint(state)` — then change one
   supplier's name, call it again. Different strings? Why?
5. Say out loud: "Fingerprint = stable id of a copy's content. Decision map
   saved to localStorage = remember forever. Accept = adopt remote + push;
   Keep Mine = keep local + push. Both converge → question never repeats."

---

## Remember forever

> **Fingerprint lets the app recognise a copy across refreshes. The decisions
> map (localStorage) is the memory. Accept/Keep-Mine both end with one shared
> copy. The modal is a tool for convergence, not a nuisance — it exists to
> never silently delete data.**

---

## Where to go next

[Lesson 14 — Backend: Supabase & the realtime channel](lesson-14-supabase.md) —
what actually stores your data in the cloud.