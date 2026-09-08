> 🧒 **New to coding?** The whole course explained like you're 10 lives in [lesson-00-plain-english.md](lesson-00-plain-english.md) — read it first (no quizzes, come back here after.
# Flashcards — remember forever

Tiny "say it out loud" cards for daily review. Cover the answer, try to say it,
then reveal.

---

**1. What is the DOM?**
> The tree of elements the browser builds from `index.html`. JS talks to it
> via `document`.

**2. What is `const $ = (id) => document.getElementById(id);`?**
> A one-line shortcut: "find the element with this id".

**3. What holds ALL the app's data?**
> The single `state` object (`js/storage.js`).

**4. What does `saveState()` do?**
> JSON.stringify(state) → localStorage.setItem(key). Also stamps `updatedAt`
> and schedules a cloud push.

**5. What is a renderer?**
> A function that reads state, builds an HTML string (`map().join('')`),
> assigns `innerHTML`. Pure-ish → same state, same screen.

**6. What are the 4 array workhorses?**
> `map` (transform), `filter` (keep), `reduce` (sum), `forEach` (action).

**7. What is the read→change→save→render loop?**
> Handler reads inputs → mutates state → saveState → renderAll. Every feature
> is this loop.

**8. Why store `endAt` not a countdown?**
> An absolute target survives refresh; a decrementing counter doesn't.

**9. What is "full bags only"?**
> `Math.floor(pieces ÷ rollsPerBag)`. 16 ÷ 5 = 3; the 17th starts no bag.

**10. Why do sync conflicts happen?**
> Two devices each keep a copy; the cloud holds one row. Two writers on one
> file.

**11. What is a fingerprint?**
> A stable string of a copy's content (`normalizeForCompare` + sorted JSON),
> used to recognise that exact copy later.

**12. How does the app avoid re-asking after refresh?**
> `setSyncDecision(fp, 'accepted'|'declined')` saved to localStorage. The
> fingerprint lookup short-circuits.

**13. What is RLS?**
> Row-Level Security: the DATABASE rejects reads/writes on other people's
> rows, regardless of what the client asks.

**14. What does Supabase realtime give you?**
> When the ledger row changes, subscribed browsers get told automatically
> (pub/sub), no refresh needed.

**15. First step of debugging?**
> Read the stack trace: top frame = where it threw. Type of error = what kind
> of bug.

**16. What does `node --check file.js` prove?**
> The file parses (no SyntaxError) — it doesn't run anything.

**17. Git: working → staged → committed?**
> `git add` stages, `git commit` snapshots, `git status` shows position,
> `git diff` shows change.

**18. What is a test harness?**
> Fake the browser (document/localStorage/showToast), load the REAL modules,
> call real functions headless, assert with `ok(cond, msg)`.

**19. What is debouncing?**
> clearTimeout + setTimeout(300ms): collapse rapid events into one save.

**20. What is event sourcing / replay?**
> Don't keep a running counter — recompute stock by replaying production +
> sales + waste in date order (`rebuildStockAndCogs`).

---

## Two-minute drill

Open a coin flip. For each card ask yourself:
- Can I say the answer WITHOUT looking?
- Can I point at the FILE/function in the codebase that proves it?

Repeat daily for a week. That's how it becomes permanent.