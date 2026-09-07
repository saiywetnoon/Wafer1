# Lesson 14 — Backend: Supabase & the realtime channel

> So far everything ran in the browser. This lesson is the **server**: a
> cloud database (Supabase) that stores both your *identity* and your
> *ledger*, and pushes changes to all open devices over a realtime channel.

Open: **`js/supabase.js`**, **`js/config.js`** (the URL + anon key),
**`_supabase-setup.sql`** (the schema you'd run once in the Supabase SQL
editor — or did).

---

## 1. What a database table is

Think of a table as an Excel sheet with strict columns:

```
profiles
  id (uuid)   email          role      status     created_at
  ───────     ─────          ────      ──────     ─────────
  <uuid>      a@b.c          admin     approved   ...

ledgers
  user_id (uuid)   payload (jsonb)        updated_at
  ───────          ───────               ─────────
  <uuid>           { "state": {...} }    ...
```

Two tables:
- `profiles` — one row per **account** (role, approval status).
- `ledgers` — one row per **user**, holding the **whole ledger** as JSON.

That's it. Everything else (production, sales, suppliers) is *inside* the
`payload` JSON column. Simple design = easy to reason about.

---

## 2. How the JS talks to it

```js
const sb = window.supabase.createClient(SUPABASE_URL_wafer, SUPABASE_ANON_KEY_wafer, {
  auth: { persistSession: true, autoRefreshToken: true }
});
```

- The **anon key** is public; it identifies the project, not the user.
- **Auth** (login/signup) is handled for you by Supabase.
- Once logged in, the SDK sends a **JWT session token** with every request,
  so the server knows *who* is asking.

---

## 3. Row-Level Security — the database protects itself

```sql
alter table public.ledgers enable row level security;
create policy ledgers_select on public.ledgers
  for select using (auth.uid() = user_id and public.is_approved());
```

This is the key security idea:

- **RLS (Row Level Security)**: every query is filtered by policy on the
  server. The client CANNOT ask to see another user's row — the server
  refuses.
- `auth.uid()` = the caller's id (from the JWT).
- `public.is_approved()` = helper that checks the `profiles` status.

**A user literally cannot read or write anyone else's ledger**, even from
DevTools, because the *database* rejects it — not just the app hiding the
button. Defense-in-depth = never trust the client.

---

## 4. Writing the ledger

```js
async function saveLedger(userId, payload) {
  ...
  const { error } = await sb.from('ledgers')
    .upsert({ user_id: userId, payload, updated_at: now }, { onConflict: 'user_id' });
  return error ? { error: msg } : { ok: true };
}
```

`.upsert(..., { onConflict: 'user_id' })` = INSERT, or if a row with that
`user_id` already exists, UPDATE it. One row per user, always current.

---

## 5. The realtime channel

```js
const chan = sb.channel('led-' + userId)
  .on('postgres_changes',
      { event: '*', schema: 'public', table: 'ledgers', filter: 'user_id=eq.' + userId },
      function (payload) { cb(payload.new); })
  .subscribe();
```

- The client **subscribes** to the `ledgers` table, filtered to its own
  `user_id`.
- Whenever ANY device writes that row, Supabase pushes `payload.new` to every
  subscribed browser **in real time** (~1–2 s later).
- That's the trigger for `handleRemoteCopy` (Lesson 12) — another device's
  save arrives *by itself*, no refresh needed.

**Realtime = "database changed" → "tell interested browsers".** This is a
pub/sub pattern.

---

## 6. The pieces wired together (your whole data flow)

```
Browser A (phone)           Supabase              Browser B (laptop)
  saveState() ──► saveLedger() ──► row changed ──► realtime event
                                                    │
                           handleRemoteCopy(payload) ◄┘
```

---

## Exercises

1. Open `_supabase-setup.sql`. Which table holds ALL ledger data? Which
   column is the payload?
2. What does `auth.uid()` represent in an RLS policy?
3. Why can't you open DevTools and read someone else's ledger? (RLS policy
   rejects it — the server enforces it.)
4. **Challenge:** describe in one sentence how a phone edit reaches the laptop
   without the laptop doing anything.
5. Say out loud: "Tables = profiles + ledgers. Anon key is public, JWT says
   who I am, RLS stops me touching other people's rows. Realtime = subscribe,
   get told when the DB row changes."

---

## Remember forever

> **The server owns the truth. The client asks politely with a JWT. RLS is
> the wall around each row. Realtime is pub/sub on a table. Your entire
> ledger is one JSON row — which is why sync is document-level, not
> field-level.**

---

## Where to go next

[Lesson 15 — Debugging: reading the machine's mind](lesson-15-debugging.md) —
turn errors into answers.