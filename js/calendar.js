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
    const entry = state.entries[dateStr];
    let cls = 'cal-day none';
    if (entry) cls = entry.net >= 0 ? 'cal-day profit' : 'cal-day loss';
    if (dateStr === todayStr) cls += ' today';
    if (dateStr === selectedDate) cls += ' selected';
    const netLabel = entry ? (entry.net >= 0 ? '+' : '') + Math.round(entry.net / 1000) + 'k' : '';
    grid.innerHTML += '<div class="' + cls + '" data-date="' + dateStr + '" title="' + dateStr + (entry ? ' · Net ' + fmtKs(entry.net) : '') + '">' +
      '<span class="font-bold">' + d + '</span>' + (netLabel ? '<span class="text-[9px] opacity-80">' + netLabel + '</span>' : '') +
      '</div>';
  }
  grid.querySelectorAll('.cal-day[data-date]').forEach(function (el) {
    el.addEventListener('click', function () {
      selectedDate = el.dataset.date;
      renderCalendar();
      loadEntryIntoForm(selectedDate);
      showToast('Selected ' + selectedDate + ' — loaded into Daily Log.', 'info');
    });
  });
  renderAuditTable();
  populateWeekSelect();
}

function loadEntryIntoForm(date) {
  const entry = state.entries[date];
  $('logDate').value = date;
  draftUsage = {};
  state.prices.forEach(function (ing) {
    const qty = entry && entry.usage ? (entry.usage[ing.name] || 0) : (DEFAULT_USAGE[ing.name] || 0);
    draftUsage[ing.name] = qty;
    const input = document.querySelector('.usage-input[data-name="' + ing.name + '"]');
    if (input) input.value = qty;
  });
  $('additionalCost').value = entry ? (entry.additionalCost || 0) : '';
  $('logBagsProduced').value = entry ? entry.bagsProduced : '';
  $('logPieces').value = entry ? entry.pieces : '';
  $('logBagsSold').value = entry ? entry.bagsSold : '';
  $('logPrice').value = entry ? entry.price : 1300;
  $('logLabor').value = entry ? entry.laborMinutes : '';
  updateUsageCosts();
  document.querySelector('[data-tab="log"]').click();
}

$('prevMonth').addEventListener('click', function () { calMonth--; if (calMonth < 0) { calMonth = 11; calYear--; } renderCalendar(); });
$('nextMonth').addEventListener('click', function () { calMonth++; if (calMonth > 11) { calMonth = 0; calYear++; } renderCalendar(); });

function populateWeekSelect() {
  const select = $('weekSelect');
  const current = select.value;
  const entries = entriesSorted();
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
  let entries = entriesSorted();
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

