/* Structural sanity check for the reorganization: every MAIN nav tab has a
   matching panel id, the nav groups + badges are present once, and demo/clear
   buttons exist exactly once after being moved out of the header.
   (The auth screen's `login`/`signup` buttons are excluded — they use a
   different `auth-tab-btn` switcher, not the nav tabs.) */
const fs = require('fs');
const h = fs.readFileSync('d:\\wafer\\Wafer_documentary\\dail-ledger v1.5\\index.html', 'utf8');
let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) { pass++; console.log('PASS ' + msg); } else { fail++; console.log('FAIL ' + msg); } }

// Main nav tabs = buttons whose classes include `tab-btn` but NOT `auth-tab-btn`.
const block = [];
const re = /<button([^>]*data-tab="([a-z0-9-]+)"[^>]*)>/g;
let m;
while ((m = re.exec(h)) !== null) {
  if (m[1].includes('tab-btn') && !m[1].includes('auth-tab-btn')) block.push(m[2]);
}
const tabIds = [...new Set(block)];
const panels = (h.match(/<section id="tab-([a-z0-9-]+)"/g) || []).map(s => s.match(/<section id="tab-([a-z0-9-]+)"/)[1]);
const panelIds = new Set(panels);
ok(tabIds.length === panelIds.size && tabIds.every(id => panelIds.has(id)),
  'every nav tab has a matching panel (' + tabIds.join(', ') + ')');

const roleTabs = (h.match(/role="tab"/g) || []).length;
ok(roleTabs === tabIds.length, 'all ' + tabIds.length + ' nav tabs carry role="tab"');

// 3) Nav groups + badges present.
ok((h.match(/class="nav-group">/g) || []).length === 5, '5 nav section groups');
ok((h.match(/id="badge-/g) || []).length === 4, '4 live badges (inventory/customers/cash/sync)');

// 4) demoBtn + clearBtn exist exactly once each, and NOT in the <header>.
ok((h.match(/id="demoBtn"/g) || []).length === 1, 'demoBtn exists exactly once');
ok((h.match(/id="clearBtn"/g) || []).length === 1, 'clearBtn exists exactly once');
const headerEnd = h.indexOf('</header>');
const withinHeader = s => h.slice(0, headerEnd).includes(s);
ok(!withinHeader('id="demoBtn"') && !withinHeader('id="clearBtn"'), 'demo/clear buttons are OUT of the header');

// 5) Sections balanced.
const openSections = (h.match(/<section id="tab-/g) || []).length;
const closeSections = (h.match(/<\/section>/g) || []).length;
ok(openSections === closeSections && openSections === panelIds.size, 'sections balanced (' + openSections + ' open / ' + closeSections + ' close)');

console.log(fail === 0 ? 'ALL STRUCTURAL CHECKS PASSED' : (fail + ' FAILED'));