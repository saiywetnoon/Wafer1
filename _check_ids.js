/* Static cross-check: every element id referenced by JS must exist in index.html,
   otherwise that code path throws at runtime (worst case: a whole module dies at load). */
const fs = require('fs');
const html = fs.readFileSync('index.html', 'utf8');
const ids = new Set();
for (const m of html.matchAll(/id="([^"]+)"/g)) ids.add(m[1]);

const missing = new Map();
function note(id, where) {
  if (!ids.has(id)) {
    if (!missing.has(id)) missing.set(id, []);
    const files = missing.get(id);
    if (!files.includes(where)) files.push(where);
  }
}
for (const f of fs.readdirSync('js')) {
  const src = fs.readFileSync('js/' + f, 'utf8');
  for (const m of src.matchAll(/\$\("([^"]+)"\)/g)) note(m[1], f);
  for (const m of src.matchAll(/\$\('([^']+)'\)/g)) note(m[1], f);
  for (const m of src.matchAll(/getElementById\(["']([^"']+)["']\)/g)) note(m[1], f + ' [getElementById]');
}
console.log('=== ids referenced in JS but NOT defined in index.html ===');
if (missing.size === 0) console.log('none — all good');
else for (const [id, files] of missing) console.log(id + '  <-  ' + files.join(', '));
console.log('total distinct missing: ' + missing.size);

// Also check DUPLICATE ids in index.html
const seen = new Map();
for (const m of html.matchAll(/id="([^"]+)"/g)) {
  const id = m[1];
  if (!seen.has(id)) seen.set(id, 0);
  seen.set(id, seen.get(id) + 1);
}
console.log('\n=== duplicate ids in index.html ===');
let dup = 0;
for (const [id, n] of seen) if (n > 1) { console.log(id + ' x' + n); dup++; }
if (!dup) console.log('none');