# Lesson 01 — HTML structure & the DOM tree

> Everything in your app starts here: `index.html` is the *only* file the
> browser loads. Every other file is pulled in BY this file.

Open: **`index.html`** (top of your project).

---

## 1. What a browser does when you open the app

```
index.html  ──►  browser reads top-to-bottom
                  │
                  ├── builds the DOM (a tree of elements)
                  ├── sees <style> links  → loads css/styles.css
                  ├── sees <script> tags  → loads js/*.js
                  └── runs the JS        → which fills the page with data
```

The DOM (Document Object Model) is exactly what the name says: **a tree of
objects**. Every HTML tag becomes a node. `document` is the root.

---

## 2. The skeleton every HTML file has

```html
<!DOCTYPE html>          <!-- "this is a modern HTML file" -->
<html lang="en">          <!-- root element: the whole page -->
  <head>                  <!-- meta-information, NOT shown on screen -->
    <meta charset="UTF-8">
    <title>Daily Crispy Roll Ledger</title>
    <link rel="stylesheet" href="css/styles.css">   <!-- pull in CSS -->
  </head>
  <body>                  <!-- everything VISIBLE lives here -->
    ...
  </body>
</html>
```

Compare with your real `index.html` lines 1–3 — you'll see the same shape.

---

## 3. Elements and attributes

An **element** is a tag pair: `<section> ... </section>`.
An **attribute** is a name/value on the opening tag that configures it:

```html
<input id="logBagsProduced" type="number" min="0" step="1"
       placeholder="e.g. 40" class="mt-1 w-full px-3 py-2 ...">
```

What each attribute does:
| Attribute | Meaning |
|-----------|---------|
| `id`      | A unique label. JS finds it with `$('logBagsProduced')`. |
| `type`    | What kind of input (number / date / text / checkbox). |
| `min`/`step` | Browser-enforced constraints for number inputs. |
| `placeholder` | Grey hint text shown when the field is empty. |
| `class`   | CSS hooks. Multiple classes = multiple styles applied. |
| `data-*`  | Custom "storage" attributes JS can read (e.g. `data-pan`). |

---

## 4. Your app's big structure

Your `index.html` organizes the whole business into **`<section>` panels**, one
per tab:

```html
<section id="tab-log"       class="tab-panel hidden"> ... </section>
<section id="tab-timers"    class="tab-panel hidden"> ... </section>
<section id="tab-sales"     class="tab-panel hidden"> ... </section>
<section id="tab-customers" class="tab-panel hidden"> ... </section>
```

- `id="tab-..."` → JS switches tabs by toggling the `.hidden` class.
- `class="tab-panel hidden"` → hidden by default; the active one gets
  `.hidden` removed (see Lesson 04 for how).

---

## 5. Do yourself the favor: the comments inside

`index.html` is full of section markers like this:

```html
<!-- ===================== SUPPLIERS / PURCHASES & PAYABLES ===================== -->
<section id="tab-suppliers" class="tab-panel hidden">
```

These "signposts" are how a large file stays navigable. **Whenever you make a
big change, add a similar comment.** Future-you will thank present-you.

---

## Exercises

1. Open `index.html`. Find **three** `<section>` elements, and write down what
   tab content each one holds.
2. Find the supplier "Shop Name" input (`id="supplierName"`). What `type` is
   it? Where is it on the page (which section)?
3. Count how many `<script src="js/...">` tags are at the bottom. That's how
   many JS files the app loads. (Answer: about 25.)
4. Change the `<title>` to `My Crispy Roll Ledger` and refresh. What changed?
5. **Challenge:** add a new `<p>` element inside the Suppliers section with
   `id="myNote"` and some text, then see it appear. (Leave it there — you'll
   use it again.)

---

## Remember forever

> **The DOM is a tree of elements. `id` is a label JS uses to find an element.
> Classes are labels CSS uses to style them. `index.html` is the entry point —
> every other file is loaded because this file says so.**

---

## Where to go next

[Lesson 02 — CSS: making it look right](lesson-02-css-styling.md) — how
`class="mt-1 w-full ..."` on *one* line becomes a beautiful card.