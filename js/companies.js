/* ============================================================
   COMPANIES / WORKSPACES
   Lets each business (user/company) keep its own ledgers,
   inventory, pricing, customers and Google sync config.
   Every data API is scoped to the ACTIVE_COMPANY via
   companyStateKey() / companyDraftKey() / companyConfigKey().
   ------------------------------------------------------------
   'default' is the pre-existing workspace. It intentionally uses
   the original (unsuffixed) storage keys so existing local data
   keeps working untouched.
   ============================================================ */

function persistCompanies() {
  try { localStorage.setItem(COMPANIES_KEY, JSON.stringify(companies)); } catch (e) { console.warn('Could not save companies', e); }
}
function readCompanies() {
  try {
    const raw = localStorage.getItem(COMPANIES_KEY);
    companies = raw ? JSON.parse(raw) : [];
  } catch (e) { companies = []; }
  if (!Array.isArray(companies)) companies = [];
}
function getActiveCompanyId() {
  try { return localStorage.getItem(ACTIVE_COMPANY_KEY); } catch (e) { return null; }
}
function companyEntryCount(id) {
  try {
    const key = (id === 'default') ? STORAGE_KEY : STORAGE_KEY + '_' + id;
    const p = JSON.parse(localStorage.getItem(key) || 'null');
    return p && p.entries ? Object.keys(p.entries).length : 0;
  } catch (e) { return 0; }
}

/* ---------- Boot ---------- */
/* Called once by init.js. Returns TRUE when a workspace is active
   (app may start) or FALSE when the login/workspace screen shows. */
function companyBootstrap() {
  readCompanies();
  const firstRun = companies.length === 0;
  if (firstRun) { companies = [{ id: 'default', name: 'My Business' }]; persistCompanies(); }
  const activeId = getActiveCompanyId();
  const c = companies.find(function (x) { return x.id === activeId; });
  if (c) { ACTIVE_COMPANY = c; updateCompanyBadge(); return true; }
  if (firstRun) {
    // No workspaces yet -> auto-open the main workspace so single-company
    // users keep working with zero clicks and existing data intact.
    try { localStorage.setItem(ACTIVE_COMPANY_KEY, 'default'); } catch (e) {}
    ACTIVE_COMPANY = companies[0];
    updateCompanyBadge();
    return true;
  }
  showCompanyScreen();
  return false;
}

function updateCompanyBadge() {
  const el = $('companyName');
  if (el) el.textContent = ACTIVE_COMPANY ? ACTIVE_COMPANY.name : '—';
}

/* ---------- Workspace screen ---------- */
function renderCompanyScreen() {
  const list = $('companyList');
  if (!list) return;
  list.innerHTML = companies.map(function (c) {
    const active = ACTIVE_COMPANY && ACTIVE_COMPANY.id === c.id;
    const cnt = companyEntryCount(c.id);
    return '<div class="flex items-center justify-between gap-2 p-3 rounded-xl border ' +
      (active ? 'border-amber-500/50 bg-amber-500/10' : 'border-gray-700 bg-gray-800/50') + '">' +
      '<div class="min-w-0"><div class="flex items-center gap-2"><span class="font-bold text-sm truncate">' + esc(c.name) + '</span>' +
      (active ? '<span class="text-[9px] px-1.5 py-0.5 rounded bg-amber-500 text-gray-900 font-bold">OPEN</span>' : '') + '</div>' +
      '<div class="text-[11px] text-gray-500 mt-0.5">' + cnt + ' day(s) of entries' + (c.id === 'default' ? ' · main workspace' : '') + '</div></div>' +
      '<div class="flex gap-1.5 shrink-0">' +
      (active
        ? '<button onclick="openCompanySwitch()" class="px-2 py-1 rounded bg-gray-700 hover:bg-gray-600 text-white text-[10px] font-bold">Switch</button>'
        : '<button onclick="loginCompany(\'' + c.id + '\')" class="px-2 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-[10px] font-bold">Open</button>') +
      (c.id !== 'default' ? '<button onclick="deleteCompany(\'' + c.id + '\')" class="px-2 py-1 rounded bg-red-700/60 hover:bg-red-600 text-red-100 text-[10px] font-bold">Delete</button>' : '') +
      '</div></div>';
  }).join('') || '<div class="text-gray-500 text-xs">No workspaces yet — create one below.</div>';
  lucide.createIcons();
}

function showCompanyScreen(opts) {
  opts = opts || {};
  const sc = $('companyScreen');
  if (!sc) return;
  if (opts.title) { const t = $('companyScreenTitle'); if (t) t.textContent = opts.title; }
  renderCompanyScreen();
  sc.classList.remove('hidden');
  const cancel = $('companyCancelBtn');
  if (cancel) cancel.classList.toggle('hidden', !opts.cancellable);
}
function hideCompanyScreen() {
  const sc = $('companyScreen');
  if (sc) sc.classList.add('hidden');
}
/* ---------- Create / Login / Delete ---------- */
function createCompany() {
  const inp = $('companyNameInput');
  const name = inp ? inp.value.trim() : '';
  if (!name) { showToast('Enter a company / business name.', 'error'); return; }
  companies.push({ id: uid(), name: name });
  persistCompanies();
  loginCompany(companies[companies.length - 1].id);
}
function loginCompany(id) {
  const c = companies.find(function (x) { return x.id === id; });
  if (!c) return;
  try { localStorage.setItem(ACTIVE_COMPANY_KEY, id); } catch (e) {}
  location.reload();
}
function deleteCompany(id) {
  if (id === 'default') { showToast('The main workspace cannot be deleted.', 'info'); return; }
  const c = companies.find(function (x) { return x.id === id; });
  if (!c) return;
  if (!confirm('Delete "' + c.name + '" and ALL its data from this browser? This cannot be undone.')) return;
  const wasActive = getActiveCompanyId() === id;
  try { localStorage.removeItem(STORAGE_KEY + '_' + id); } catch (e) {}
  try { localStorage.removeItem(DRAFT_STORAGE_KEY + '_' + id); } catch (e) {}
  try { localStorage.removeItem(GOOGLE_SYNC_CONFIG_KEY + '_' + id); } catch (e) {}
  companies = companies.filter(function (x) { return x.id !== id; });
  persistCompanies();
  if (wasActive) {
    try { localStorage.removeItem(ACTIVE_COMPANY_KEY); } catch (e) {}
    ACTIVE_COMPANY = null;
  }
  updateCompanyBadge();
  showCompanyScreen();
  showToast('Deleted "' + c.name + '".');
}

$('companyCreateBtn').addEventListener('click', createCompany);
$('companyCancelBtn').addEventListener('click', hideCompanyScreen);
const companyNameInputEl = $('companyNameInput');
if (companyNameInputEl) companyNameInputEl.addEventListener('keydown', function (e) { if (e.key === 'Enter') createCompany(); });
function openCompanySwitch() {
  showCompanyScreen({ title: 'Switch workspace', cancellable: true });
}