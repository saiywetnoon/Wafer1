// Final smoke check after the v1.11 build: same build marker in HTML+JS,
// required Tailwind classes present, and new modules/files referenced.
const fs = require('fs');
const path = require('path');
let ok = 0, fail = 0;
function check(name, cond) { if (cond) { ok++; console.log('PASS ' + name); } else { fail++; console.log('FAIL ' + name); } }

const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const config = fs.readFileSync(path.join(__dirname, 'js', 'config.js'), 'utf8');

const htmlBuild = (html.match(/data-build="([^"]+)"/) || [])[1];
const jsBuild = (config.match(/__LEDGER_BUILD = '([^']+)'/) || [])[1];
check('HTML + JS build markers match', !!htmlBuild && htmlBuild === jsBuild);
check('modal.js loaded in HTML', html.includes('js/modal.js'));
check('manifest linked', html.includes('manifest.webmanifest'));
check('no Play CDN tailwind', !html.includes('cdn.tailwindcss.com'));
check('no inline tailwind.config', !html.includes('tailwind.config ='));
check('no gsi/client script', !html.includes('accounts.google.com/gsi/client'));
check('supabase SRI present', html.includes('integrity="sha384-EyR2P0'));

const css = fs.readFileSync(path.join(__dirname, 'css', 'tailwind.css'), 'utf8');
['sm:w-64', 'lg:grid-cols-5', 'max-h-32', 'text-sky-400', 'hover:text-sky-300', 'sm:col-span-3'].forEach(function (c) {
  check('css has .' + c, css.includes('.' + c.replace(/:/g, '\\:')));
});

['sw.js', 'manifest.webmanifest', 'css/tailwind.css', 'js/modal.js', 'package.json', '.github/workflows/ci.yml'].forEach(function (f) {
  check('exists ' + f, fs.existsSync(path.join(__dirname, f)));
});

console.log(fail === 0 ? '\nALL CHECKS PASSED (' + ok + ')' : '\n' + fail + ' FAILED');