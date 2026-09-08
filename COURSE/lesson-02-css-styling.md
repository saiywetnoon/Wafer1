> 🧒 **New to coding?** The whole course explained like you're 10 lives in [lesson-00-plain-english.md](lesson-00-plain-english.md) — read it first (no quizzes, come back here after.
# Lesson 02 — CSS: making it look right

> Last lesson you saw `class="mt-1 w-full px-3 py-2"` on an input. This lesson
> is about how *that one line* becomes a beautiful, dark, professional card.

Open: **`css/styles.css`** and **`index.html`** (find `.card`, `.pan-msg`,
`.tab-panel`).

---

## 1. The big idea

HTML = **structure**. CSS = **look** (colors, spacing, fonts, layout).
JavaScript = **behavior** (what happens when you click).

```
<div class="card bg-gray-900 rounded-xl p-5 border border-gray-800">
```

That one `<div>` gets styled by classes the browser looks up in the CSS.
`card` is a *custom* class you'll find in `styles.css`:

```css
.card { background: #111827; border-radius: 1rem; padding: 1.25rem; ... }
```

`bg-gray-900`, `rounded-xl`, `p-5`, `border border-gray-800` come from
**Tailwind CSS** (loaded as a CDN in `index.html`): utility classes that set
one property each.

| class        | meaning            |
|--------------|--------------------|
| `bg-gray-900` | background `#111827` |
| `rounded-xl`  | border-radius 12px  |
| `p-5`        | padding 1.25rem     |
| `border` + `border-gray-800` | 1px border, gray color |

---

## 2. How CSS actually decides (selectors, cascade, specificity)

A **selector** says *which* elements a rule applies to:

```css
.tab-panel { display: none; }          /* every element with class=tab-panel */
#appStatusBar { position: fixed; }     /* the ONE element with that id */
button:hover { ... }                   /* state: when hovered */
.pan-stage-3 .pan-msg { color: red; }  /* descendant combinator */
```

**Cascade** = later rules can override earlier ones of equal importance.
**Specificity** = how "targeted" a selector is. Roughly:

```
inline style  >  #id  >  .class  >  element
```

So `#appStatusBar` beats `.something`. When two are *equal*, the **last one
written wins**. That's why order in `styles.css` matters.

---

## 3. Real example from your app — the status pill

```css
#appStatusBar { position: fixed; left: 12px; bottom: 12px; z-index: 80; }
#appStatusBar .dot { width: 7px; height: 7px; border-radius: 9999px; ... }
#appStatusBar.synced .dot { background: #10B981; }   /* green when synced */
#appStatusBar.offline .dot { background: #EF4444; }  /* red when offline */
```

Notice: the SAME element (`.dot`) gets different colors depending on a class
added to its parent by JS (`synced`, `offline`). This is the CSS+JS handshake:
**JS changes a class, CSS changes the look.** No `innerHTML` needed.

---

## 4. Layout: flexbox (the one you can't live without)

Almost every tight row in your app uses `flex`:

```html
<div class="flex items-center gap-2">
  <span class="pan-dot"></span>
  <span class="pan-name">Pan 1</span>
</div>
```

```css
.flex { display: flex; }                    /* side-by-side by default */
.items-center { align-items: center; }      /* vertical centering */
.gap-2 { gap: 0.5rem; }                     /* space between children */
```

- `flex-direction: row` → left to right.
- `justify-content: space-between` → push items to the far edges.
- `flex-1` → this child takes all leftover space.

---

## 5. The hidden secret: your app is a "Tailwind + custom" hybrid

Some classes (`bg-gray-900`) come from Tailwind (loaded live from the CDN).
Others (`card`, `.pan-msg`, `.pan-out-num`) are **your custom CSS** in
`styles.css`. Both are just CSS — the browser doesn't care where a class was
defined.

**This is why you'll sometimes see spelling that looks like a utility class
(`text-[10px]`)** — that's Tailwind's arbitrary-value syntax, meaning
`font-size: 10px`.

---

## Exercises

1. In `styles.css`, find `.card` and write down its 3 most important
   properties. What would happen if you removed `background`?
2. Find the `.pan-out-num` rule (it colors the "1 round → 3 rolls" numbers).
   Change its color to `#22D3EE` and refresh the Fry Timers tab. What happens?
3. Find `.pan-msg`. Change `font-size` from `12px` to `14px`. What changed on
   the pan cards?
4. **Challenge:** add one new CSS rule of your own: make `.my-note`
   (`#myNote` from lesson 1) `color: #FBBF24`. Refresh. Works?
5. Explain out loud: "The browser applies CSS by matching selectors; when two
   rules tie, the last one wins."

---

## Remember forever

> **JS changes classes. CSS changes looks. Same element, different class,
> different appearance. Flexbox is the layout tool of this decade. You write
> structure in HTML, style in CSS, behavior in JS — the three never mix
> files, but they cooperate through `class`.**

---

## Where to go next

[Lesson 03 — JavaScript: variables, functions, scope](lesson-03-javascript-basics.md) — the actual brain of the app.