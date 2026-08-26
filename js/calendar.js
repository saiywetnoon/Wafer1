/* ============================================================
   CALENDAR & AUDIT
   ============================================================ */
let calYear;
let calMonth;
let selectedDate = null;

function renderCalendar() {
  const now = new Date();
  if (calYear === undefined) { calYear = now.getFullYear(); calMonth = now.getMonth(); }
  $('calTitle').textContent = new Date(calYear, calMonth, 1).toLocaleString('en-US', { month: 'long', year: 'numeric' });
  const firstDay = new Date(calYear, calMonth, 1).getDay();
  const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
  const todayStr = today();
  const grid = $('calendarGrid');
  grid.innerHTML = '';
  for (let i = 0; i < firstDay; i++) {
    grid.innerHTML += '<div class="cal-day empty"></div>';
  }
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = calYear + '-' + String(calMonth + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0');
    const day = dayInfo(dateStr);
    let cls = 'cal-day none';
    if (day && (day.net !== 0)) cls = day.net > 0 ? 'cal-day profit' : 'cal-day loss';
    else if (day && (day.prodPieces > 0 || day.soldPieces > 0)) cls = 'cal-day neutral';
    if (dateStr === todayStr) cls += ' today';
    if (dateStr === selectedDate) cls += ' selected';
    let sub = '';
    if (day) {
      if (day.soldBags > 0) sub = (day.net >= 0 ? '+' : '-') + Math.abs(Math.round(day.net / 1000)) + 'k';
      else if (day.prodPieces > 0) sub = '↔ ' + fmt(day.prodPieces) + 'pcs';
    }
    const tip = dateStr +
      (day && day.prodPieces > 0 ? ' · rolled ' + fmt(day.prodPieces) + ' pcs' : '') +
      (day && day.soldBags > 0 ? ' · sold ' + fmt(day.soldBags) + ' bags / ' + fmtKs(day.net) : '');
    grid.innerHTML += '<div class="' + cls + '" data-date="' + dateStr + '" title="' + tip + '">' +
      '<span class="font-bold">' + d + '</span>' + (sub ? '<span class="text-[9px] opacity-80">' + sub + '</span>' : '') +
      '</div>';
  }
  grid.querySelectorAll('.cal-day[data-date]').forEach(function (el) {
    el.addEventListener('click', function () {
      selectedDate = el.dataset.date;
      renderCalendar();
      loadEntryIntoForm(selectedDate);
      showToast('Selected ' + selectedDate + ' — loaded into Production.', 'info');
    });
  });
  renderAuditTable();
  populateWeekSelect();
}

function events() { return entriesProdSales(); }
function entryMap() {
  var m = {};
  events().forEach(function (e) { m[e.date] = e; });
  return m;
}
function eventOf(date) { return entryMap()[date]; }
function dayInfo(date) { return eventOf(date) || null; }

function loadEntryIntoForm(date) {
  const batch = (state.production || []).filter(function (x) { return x.date === date; })[0];
  $('logDate').value = date;
  draftUsage = {};
  if (batch) {
    document.getElementById('editProdId').value = batch.id;
    draftUsage = Object.assign({}, batch.usage || {});
    $('additionalCost').value = batch.additionalCost || 0;
    $('logBagsProduced').value = batch.bags || 0;
    $('logPieces').value = batch.pieces || 0;
    $('logLabor').value = batch.laborMinutes || 0;
    var sb = $('saveLogBtn'); sb.innerHTML = '<i data-lucide="save" class="w-5 h-5"></i> Update Production';
  } else {
    document.getElementById('editProdId').value = '';
    $('additionalCost').value = 0;
    $('logBagsProduced').value = 0;
    $('logPieces').value = 0;
    $('logLabor').value = 0;
    $('saveLogBtn').innerHTML = '<i data-lucide="save" class="w-5 h-5"></i> Save Production Work';
  }
  lucide.createIcons();
  state.prices.forEach(function (ing) {
    const qty = draftUsage[ing.name] !== undefined ? draftUsage[ing.name] : (DEFAULT_USAGE[ing.name] || 0);
    const input = document.querySelector('.usage-input[data-name="' + ing.name + '"]');
    if (input) input.value = qty;
  });
  updateUsageCosts();
  document.querySelector('[data-tab="log"]').click();
}

$('prevMonth').addEventListener('click', function () { calMonth--; if (calMonth < 0) { calMonth = 11; calYear--; } renderCalendar(); });
$('nextMonth').addEventListener('click', function () { calMonth++; if (calMonth > 11) { calMonth = 0; calYear++; } renderCalendar(); });

function populateWeekSelect() {
  const select = $('weekSelect');
  const current = select.value;
  const entries = entriesProdSales();
  const weeks = new Set();
  entries.forEach(function (e) {
    const d = new Date(e.date + 'T00:00:00');
    const start = new Date(d); start.setDate(d.getDate() - d.getDay());
    const end = new Date(start); end.setDate(start.getDate() + 6);
    const off = start.getTimezoneOffset();
    const sStr = new Date(start.getTime() - off * 60000).toISOString().slice(0, 10);
    const eStr = new Date(end.getTime() - off * 60000).toISOString().slice(0, 10);
    weeks.add(sStr + '|' + eStr);
  });
  select.innerHTML = '<option value="">All time</option>';
  Array.from(weeks).sort().reverse().forEach(function (w) {
    const parts = w.split('|');
    select.innerHTML += '<option value="' + w + '">Week of ' + parts[0] + ' → ' + parts[1] + '</option>';
  });
  select.value = current;
}

function renderAuditTable() {
  const from = $('filterFrom').value;
  const to = $('filterTo').value;
  const week = $('weekSelect').value;
  let entries = entriesProdSales();
  if (week) {
    const parts = week.split('|');
    entries = entries.filter(function (x) { return x.date >= parts[0] && x.date <= parts[1]; });
  }
  if (from) entries = entries.filter(function (x) { return x.date >= from; });
  if (to) entries = entries.filter(function (x) { return x.date <= to; });
  const tbody = $('auditBody');
  $('auditEmpty').classList.toggle('hidden', entries.length > 0);
  if (!entries.length) { tbody.innerHTML = ''; return; }
  tbody.innerHTML = entries.map(function (e) {
    const details = buildIngredientBreakdown(e);
    return '<tr class="border-b border-gray-800">' +
      '<td class="py-2 pr-2 whitespace-nowrap">' + esc(e.date) + '</td>' +
      '<td class="py-2 pr-2 text-amber-400 font-semibold">' + fmtKs(e.capital) + '</td>' +
      '<td class="py-2 pr-2">' + fmt(e.bagsProduced) + '</td>' +
      '<td class="py-2 pr-2">' + fmt(e.pieces) + '</td>' +
      '<td class="py-2 pr-2">' + fmt(e.bagsSold) + '</td>' +
      '<td class="py-2 pr-2 text-emerald-400 font-semibold">' + fmtKs(e.revenue) + '</td>' +
      '<td class="py-2 pr-2">' + ((e.laborMinutes || 0) / 60).toFixed(2) + '</td>' +
      '<td class="py-2 pr-2 ' + (e.net >= 0 ? 'text-emerald-400' : 'text-red-400') + ' font-bold">' + fmtKs(e.net) + '</td>' +
      '<td class="py-2 pr-2 text-gray-300">' + fmtKs(e.costPerBag || 0) + '</td>' +
      '<td class="py-2 pr-2 ' + ((e.marginPct || 0) >= 0 ? 'text-emerald-400' : 'text-red-400') + '">' + (e.marginPct || 0) + '%</td>' +
      '<td class="py-2">' + details + '</td>' +
      '</tr>';
  }).join('');
}

function buildIngredientBreakdown(e) {
  if (!e.usage) return '<span class="text-gray-600">—</span>';
  const parts = state.prices.map(function (ing) {
    const qty = e.usage[ing.name];
    if (!qty) return null;
    return esc(ing.name) + ': ' + fmt(qty) + (ing.unit === 'g' ? 'g' : 'u');
  }).filter(Boolean);
  return '<span class="text-[10px] text-gray-500" title="' + parts.join(' | ').replace(/"/g, '') + '">' + (parts.length ? parts.slice(0, 4).join(', ') + (parts.length > 4 ? ' +' + (parts.length - 4) : '') : '—') + '</span>';
}

$('filterFrom').addEventListener('change', renderAuditTable);
$('filterTo').addEventListener('change', renderAuditTable);
$('weekSelect').addEventListener('change', renderAuditTable);

/* ---- v1.6 override: audit rows show rolled vs sold ---- */
function renderAuditTable() {
  const from = $('filterFrom').value;
  const to = $('filterTo').value;
  const week = $('weekSelect').value;
  let entries = entriesProdSales();
  if (week) {
    const parts = week.split('|');
    entries = entries.filter(function (x) { return x.date >= parts[0] && x.date <= parts[1]; });
  }
  if (from) entries = entries.filter(function (x) { return x.date >= from; });
  if (to) entries = entries.filter(function (x) { return x.date <= to; });
  const tbody = $('auditBody');
  $('auditEmpty').classList.toggle('hidden', entries.length > 0);
  if (!entries.length) { tbody.innerHTML = ''; return; }
  tbody.innerHTML = entries.map(function (e) {
    return '<tr class="border-b border-gray-800">' +
      '<td class="py-2 pr-2 whitespace-nowrap">' + esc(e.date) + '</td>' +
      '<td class="py-2 pr-2 text-amber-400 font-semibold">' + fmtKs(e.capital) + '</td>' +
      '<td class="py-2 pr-2">' + fmt(e.prodBags) + '</td>' +
      '<td class="py-2 pr-2">' + fmt(e.prodPieces) + '</td>' +
      '<td class="py-2 pr-2">' + fmt(e.soldBags) + '</td>' +
      '<td class="py-2 pr-2 text-emerald-400 font-semibold">' + fmtKs(e.revenue) + '</td>' +
      '<td class="py-2 pr-2">' + ((e.laborMin || 0) / 60).toFixed(2) + '</td>' +
      '<td class="py-2 pr-2 ' + (e.net >= 0 ? 'text-emerald-400' : 'text-red-400') + ' font-bold">' + fmtKs(e.net) + '</td>' +
      '<td class="py-2 pr-2 ' + (e.soldPieces > 0 ? 'text-emerald-400' : 'text-gray-600') + '">' + fmt(e.soldPieces) + ' sold</td>' +
      '<td class="py-2">' + auditDayDetail(e) + '</td>' +
      '</tr>';
  }).join('');
}
function auditDayDetail(e) {
  const parts = [];
  if (e.prodPieces > 0) parts.push('rolled ' + fmt(e.prodPieces) + ' pcs');
  if (e.soldBags > 0) parts.push('sold ' + fmt(e.soldBags) + ' bags');
  if (!parts.length) return '<span class="text-gray-600">—</span>';
  return '<span class="text-[10px] text-gray-500">' + parts.join(', ') + '</span>';
}
