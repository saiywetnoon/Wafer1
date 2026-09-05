const fs = require('fs');
const path = require('path');
// Scan for DYNAMICALLY-built Tailwind class strings (e.g. 'bg-' + color + '-400')
// which the static Tailwind scanner would miss. Reports hits so the author can
// either use literal strings or add the classes to a safelist.
const dir = path.join(__dirname, 'js');
const files = fs.readdirSync(dir).filter(f => f.endsWith('.js'));
const prefixes = ["'bg-", "'text-", "'border-", "'ring-", "'shadow-", "'from-", "'to-"];
const risky = [];
files.forEach(f => {
  const src = fs.readFileSync(path.join(dir, f), 'utf8');
  const lines = src.split('\n');
  lines.forEach((line, i) => {
    const hasLiteralCtor = prefixes.some(p => line.includes(p) && line.includes('+'));
    const hasConcat = /\+[^;]*'(bg|text|border|ring|shadow)-(?:[a-z]+-)?\d+/.test(line);
    if (hasLiteralCtor || hasConcat) risky.push(f + ':' + (i + 1) + ': ' + line.trim().slice(0, 140));
  });
});
console.log(risky.length ? 'DYNAMIC TAILWIND CLASSES (might need safelist):\n' + risky.join('\n') : 'No dynamic Tailwind class concatenation found.');