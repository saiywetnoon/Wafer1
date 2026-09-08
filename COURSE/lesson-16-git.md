> 🧒 **New to coding?** The whole course explained like you're 10 lives in [lesson-00-plain-english.md](lesson-00-plain-english.md) — read it first (no quizzes, come back here after.
# Lesson 16 — Version control with Git

> You've been making changes to a real business app. Git is the machine that
> remembers *every version* of the code so you can compare, undo, and know
> exactly what you shipped. This repo is a git repository — this lesson is how
> to use it like a pro.

Open your terminal in the project folder (it's already a git repo). Run each
command as you read.

---

## 1. What Git tracks: a timeline of snapshots

Think of commits as **save points** in a game:

```
commit A  ←  commit B  ←  commit C  (HEAD = you are here)
  code         code         code
```

Each commit = a full snapshot of the files + a message saying what you
changed. You can:
- go back in time (`git checkout <old>`),
- compare any two (`git diff A B`),
- see *when* each line last changed (`git blame`).

---

## 2. The three areas (the mental model that unlocks everything)

```
 working dir     staging        repo (history)
 (your files) →  (marked) →  (committed)
     git add .     git commit
```

- **Working directory**: the files as they are now (dirty = changed).
- **Staging**: files you've told git "I want these in the next commit".
- **Repo**: the permanent history.

The commands map 1:1:
| Command | Effect |
|---------|--------|
| `git status` | What's dirty, staged, untracked? |
| `git diff` | Show my uncommitted changes |
| `git add --all` | Stage everything |
| `git commit -m "msg"` | Save the staged snapshot |
| `git log --oneline` | List history |
| `git --no-pager log` | Same, no pager (useful in Windows) |

---

## 3. `git status` tells you the state

```
 M README.md          ← modified (tracked, not staged)
 M js/ledger.js
A  _verify_inventory.js ← staged (A = added to next commit)
```

- `M` = Modified, `A` = Added, `??` = Untracked (new, never committed), `D` =
  Deleted.
- First column = staging status; second = working tree status.

---

## 4. `git diff` shows *exactly* what changed

Run `git diff js/ledger.js` and you'll see:

```
-  const bagsShown = p.bags;                            // removed
+  const bagsShown = (p.bagsAuto === false)
+    ? (p.bags || 0)
+    : deriveBagsFromPieces(p.pieces);                  // added
```

`-` = old lines (red), `+` = new lines (green). This is your superpower:
**before you commit anything, read the diff.** You'll catch typos and
accidents.

---

## 5. Committing: the smallest logical unit

Good commit messages answer "why":

```
git commit -m "v1.11.9 bags are fully automatic (no manual count)"
git commit -m "fix: keep manual bag override when new rolls merge"
```

- One feature (or one bug fix) per commit — not 10 things mixed together.
- If you commit in your own repo, fine; if you push to a shared repo branch,
  keep `main` stable (commit small, review the diff, then `git push`).

---

## 6. Undoing mistakes

- Accidentally changed a file and want it back?
  `git restore <file>` (discards working-tree changes since last commit).
- Committed too soon and want to move the HEAD?
  `git reset HEAD~1` (undoes commit, keeps your changes staged).
- Want to see history nicely?
  `git --no-pager log --oneline -10`

⚠️ `git restore` **deletes** your uncommitted changes. Be sure.

---

## 7. Commit often, ship deliberately

The cadence most pros use on a solo project:
1. Make ONE logical change.
2. `git status` + `git diff` — *read them*.
3. `git add --all && git commit -m "what and why"`.
4. Repeat. When you're ready to share: `git push`.

---

## Exercises

1. Run `git status`. Explain every line.
2. Run `git --no-pager log --oneline -8`. The most recent commit should be the
   v1.11.x "full automatic" work. Read the older messages — that's your whole
   project timeline.
3. Run `git diff --stat` — the summary of the current uncommitted work.
4. **Challenge:** pick one file, `git diff <file>`, and identify ONE old line
   and ONE new line. Say what changed.
5. Say out loud: "Working → staged → committed. status shows where I am,
   diff shows what changed, commit saves a snapshot, log shows history."

---

## Remember forever

> **Git is a timeline of snapshots you control. `status` = current position,
> `diff` = the change, `commit` = the save point, `log` = the map. Read your
> diff before committing — every time.**

---

## Where to go next

[Lesson 17 — Testing: the safety net](lesson-17-testing.md) — how this repo
proves its features work.