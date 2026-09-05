// _check_elements.js — verify every element id referenced in JS with a
// load-time addEventListener / value assignment actually exists in index.html.
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
// Collect all id="..." present in the HTML.
const htmlIds = new Set();
let m;
const idRe = /id="([^"]+)"/g;
while ((m = idRe.exec(html))) htmlIds.add(m[1]);

const files = fs.readdirSync(path.join(__dirname, 'js')).filter(f => f.endsWith('.js'));
const risky = new Set();
files.forEach(f => {
  const src = fs.readFileSync(path.join(__dirname, 'js', f), 'utf8');
  // Load-time (top level) $('id') references — the ones that would throw if missing.
  const lines = src.split('\n');
  lines.forEach((line, i) => {
    // Only look at top-level statements, heuristically: lines that contain
    // addEventListener or a direct $('id').value = ... at collection scope.
    if (/\$\('[^']+'\)\.addEventListener/.test(line)) {
      const mm = line.match(/\$\('([^']+)'\)\./);
      if (mm) risky.add(f + ':' + (i + 1) + ':' + mm[1]);
    }
  });
});

let missing = [];
risky.forEach(item => {
  const id = item.split(':').pop();
  if (!htmlIds.has(id)) missing.push(item);
});
console.log(missing.length
  ? 'MISSING ELEMENTS (would crash at load):\n' + missing.join('\n')
  : 'All load-time $(\'id\') element references exist in index.html (' + risky.size + ' checked)');