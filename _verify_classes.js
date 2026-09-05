// Dev tool: verify the compiled Tailwind CSS contains every utility class
// referenced in index.html and js/*.js (literal class strings).
// Usage: node _verify_classes.js [path-to-compiled-css]
const fs = require('fs');
const path = require('path');

const root = process.cwd();
const CSS_PATH = process.argv[2] || path.join(root, 'css', 'tailwind.css');

const FILES = ['index.html'].concat(fs.readdirSync(path.join(root, 'js')).map(f => path.join('js', f)));

function extractClasses(src) {
  const out = new Set();
  // class="..." in HTML
  let re = /class="([^"]+)"/g, m;
  while ((m = re.exec(src))) m[1].split(/\s+/).forEach(c => c && out.add(c));
  // class names inside JS string literals (single-quoted and template backticks)
  re = /['`]([a-z][a-z0-9:_\-\[\]\/\\.% ]*)['`]/gi;
  while ((m = re.exec(src))) {
    m[1].split(/\s+/).forEach(c => {
      if (c && /^[a-z]/.test(c) && /[-:\[\]]/.test(c)) out.add(c);
    });
  }
  // quoted class attributes built in JS like class="' + 'bg-red-600 x'
  re = /\+ *'([a-z][a-z0-9:_\-\[\]\/\\.% ]*)' *\+/gi;
  while ((m = re.exec(src))) {
    m[1].split(/\s+/).forEach(c => { if (c && /^[a-z]/.test(c) && /[-]/.test(c)) out.add(c); });
  }
  return out;
}

const css = fs.readFileSync(CSS_PATH, 'utf8');
// Custom classes defined in styles.css are expected to be absent from tailwind.css
const customCss = fs.readFileSync(path.join(root, 'css', 'styles.css'), 'utf8');
const customSelectors = new Set();
let cm;
const cre = /([.#][A-Za-z][A-Za-z0-9_-]*)/g;
while ((cm = cre.exec(customCss))) customSelectors.add(cm[1].replace(/^\./, '').replace(/^#/, ''));
const all = new Set();
FILES.forEach(f => { try { extractClasses(fs.readFileSync(path.join(root, f), 'utf8')).forEach(c => all.add(c)); } catch (e) {} });

const UTIL = /^(sm|md|lg|xl|max-md|max-lg|hover|focus|active|disabled|first|last|odd|even|group-hover|focus-within|focus-visible|motion-safe|motion-reduce|dark):/;
function tokUsable(bare) {
  return /^(flex|grid|text|bg|border|border-t|border-b|border-l|border-r|p|px|py|pt|pr|pb|pl|m|mx|my|mt|mr|mb|ml|w|h|min-w|min-h|max-w|max-h|gap|space|rounded|shadow|ring|outline|outline|tracking|leading|font|opacity|blur|backdrop|transition|duration|ease|animate|cursor|select|pointer|content|items|justify|self|order|col|row|place|overflow|object|block|inline|table|hidden|visible|absolute|fixed|relative|sticky|z|top|right|bottom|left|rotate|translate|scale|skew|origin|fill|stroke|list|divide|whitespace|break|italic|underline|uppercase|lowercase|capitalize|truncate|truncate|tracking|decoration|placeholder|sr-only)/.test(bare);
}
const missing = [];
all.forEach(c => {
  if (c.startsWith('lucide') || c.includes('data-lucide') || c.startsWith('scrollbar')) return;
  if (customSelectors.has(c.split(':')[0])) return;
  if (c.startsWith('pan-') || c.startsWith('notif-') || c.startsWith('field-') || c.startsWith('brand-') || c.startsWith('topbar') || c.startsWith('sidearb') || c.startsWith('nav-') || c.startsWith('card') || c.startsWith('app-') || c.startsWith('toast') || c.startsWith('modal-')) return;
  if (/[(){}.,"']/.test(c)) return;
  const bare = c.replace(UTIL, '');
  if (bare.includes('[')) return;
  const tok = bare.split('/')[0];
  if (!tokUsable(bare)) return;
  const escTok = tok.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const found = new RegExp('\\.' + escTok + '([^a-z0-9_-]|$)|\\\\.' + escTok.replace(/\\:/g, '\\\\:') + ':').test(css);
  if (!found) missing.push(c);
});

console.log('Extracted literal classes:', all.size);
console.log('Missing in compiled css:', missing.length);
missing.slice(0, 150).forEach(c => console.log('  MISS', c));