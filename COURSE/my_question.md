questions from lesson -00
## 2. The Door Guard — `validateOptionalNum` (ledger.js, lines  ️9–16  
#my question  - i want to know why use it ...for what ? a user input what and ..from what i understand .. it only convert into number ,right? in which part user need to use this? i mean which scene... 

Line by line:
- `var rpb = productionRollsPerBag();` — ask the settings: **how many rolls go in ONE bag?** (Usually `5`.)
- `Math.floor(pieces / rpb)` — divide, then **chop off the remainder** — FULL bags ONLY.
. `Math.max(0, …)` — never go below zero.
##mq - not quit understand how does it works 

- `localStorage.setItem(key, JSON.stringify(state))` — **photocopy the whole notebook as TEXT** and lock it in the **safe** (the browser's storage. Refresh can't erase it!
store key into json ? what 

## 4. The Photocopier — `saveState()` (storage.js, lines  ️56–67
save what and detail 

Why does the Dashboard never disagree with the Production table? Because both walls are drawn from **the same notebook**, moments apart. 👩💼

I dont understand this .. 

## 6. Drawing one wall — `renderProduction()` (ledger.js, lines  ️276–308
i dotn get it 
mainly this code 
```js
tbody.innerHTML = list.map(function (p) {
  return '<tr>' + …cells… + '</tr>';
}).join('');
```
how does it work? map the function p? the structure and syntax ...return what " <tr>"

lesson 01 question
## 5. Do yourself the favor: the comments inside

`index.html` is full of section markers like this:

```html
<!-- ===================== SUPPLIERS / PURCHASES & PAYABLES ===================== -->
<section id="tab-suppliers" class="tab-panel hidden"> 
# is tab-panel hidden defined? like if using that class , what is that function