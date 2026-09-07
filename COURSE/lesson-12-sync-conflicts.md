# Lesson 12 — Sync: why data can diverge

> Your app runs on 4 devices. Each has a **local copy** (`localStorage`) and
> the account has a **cloud copy** (Supabase). When two devices edit at the
> same time, you have a *conflict*. This lesson = why, and what the app
> actually does about it.

Open: **`js/cloud.js`** (`statesEqual`, `handleRemoteCopy`) and
**`js/storage.js`** (`saveState`).

---

## 1. Two copies exist → they can disagree

```
Device A (phone)          Device B (laptop)
    │                          │
 local state              local state
    │  push                   │  push
    ▼                          ▼
        ┌──────────────────────────────┐
        │        CLOUD (Supabase)      │
        └──────────────────────────────┘
```

Each device writes its OWN copy up to the cloud. If both write, the cloud
contains **whichever was written last** (last-write-wins at the document
level — because the whole ledger is ONE JSON row).

That's the root of all sync trouble: **there is no lock; there are two authors
writing one file.**

---

## 2. The whole state = one JSON `row`

```js
// supabase.js
await sb.from('ledgers').upsert({
  user_id: u.id,
  payload: toGooglePayload(),   // the ENTIRE ledger as one blob
  updated_at: now
});
```

`payload` = the complete `state` object. When you change one number, you send
the WHOLE ledger. This is simple and reliable, but it means **two concurrent
edits overwrite each other entirely** unless the app intervenes.

---

## 3. "Are these the same?" → `statesEqual`

```js
function statesEqual(a, b) {
  if (!a || !b) return false;
  try {
    return JSON.stringify(normalizeForCompare(a))
        === JSON.stringify(normalizeForCompare(b));
  } catch (e) { return false; }
}
```

- Deep-compare two ledgers by serializing both to JSON and comparing strings.
- `normalizeForCompare` strips `updatedAt`/`version`/`stock` so two
  *logically identical* ledgers compare equal even if their invisible stamps
  differ (that's what killed phantom "stock changed" popups).

**If they're equal → nothing to do. If they differ → something must happen.**

---

## 4. When they differ, decide — never overwrite silently

```js
function handleRemoteCopy(remoteState, remoteTs, source) {
  if (!remoteState) return 'noop';
  if (statesEqual(state, remoteState)) return 'aligned';

  const localCount = stateDataCount(state);
  const remoteCount = stateDataCount(remoteState);

  // A device with nothing never wipes the cloud; a cloud with everything
  // fills an empty device:
  if (remoteCount === 0 && localCount > 0) { push; return 'pushed'; }
  if (localCount === 0 && remoteCount > 0) { pull; return 'pulled'; }

  // Both have data and they differ → ASK THE USER (next lesson).
  openSyncReview(remoteState, remoteTs, source);
}
```

Two safety rules stand out:
1. **An empty side never clobbers a populated side.** (A brand-new phone
   logging in must not erase the account.)
2. **Real divergence → ask.** No silent winner.

---

## 5. Why "the copy that looks bigger wins" is wrong

Your bigger/historically-richer ledger might be *older* or edited on the
*other* device's behalf. Timestamp ties, partial writes, clock skew — all of
them can make "more records wins" choose the wrong copy. That's why the final
design asks the USER: only a human knows which copy is actually right.

---

## 6. The cost you accept

Because the whole ledger is one row, the app cannot merge two edits
field-by-field on the server. So each divergence ends in ONE of:
- **aligned** (equal), **pushed** (empty cloud), **pulled** (empty device), or
- **review** (user decides — Lesson 13).

---

## Exercises

1. Open `statesEqual`. Why the `try/catch`?
2. In `handleRemoteCopy`, what happens when BOTH sides have data and they
   differ? (Answer: the review modal opens.)
3. Predict output: `JSON.stringify({a:1,b:2}) === JSON.stringify({b:2,a:1})`.
   → `true` or `false`? (Answer: **false** — key ORDER matters in a string;
   that's a footgun worth remembering.)
4. **Challenge:** run `state.updatedAt = new Date().toISOString()` then
   `statesEqual(state, JSON.parse(JSON.stringify(state)))` after deleting
   `updatedAt` on the copy. Why does normalizeForCompare matter?
5. Say out loud: "Every device has a copy; cloud holds one row. Equal content
   = no-op. Empty never clobbers. Real difference = ask."

---

## Remember forever

> **Two writers, one file → conflict. Deep-compare = JSON.stringify both.
> Never let an empty side overwrite a full one. When in doubt, ASK the user
> instead of guessing.**

---

## Where to go next

[Lesson 13 — The accept/decline machine](lesson-13-sync-review.md) — how the
user picks the official copy, remembered across refreshes.