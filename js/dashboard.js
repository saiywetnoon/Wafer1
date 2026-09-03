/* ============================================================
   DASHBOARD
   ============================================================ */
let gainChart = null;
let volumeChart = null;

/* ---------- Dashboard Alerts (feature 4) ---------- */
function renderDashboardAlerts() {
  const el = $('dashboardAlerts');
  if (!el) return;
  const lowItems = (state.prices || []).filter(isStockItem).map(function (ing) {
    const item = ensureInventoryItem(ing.name);
    const stock = syncInventorySnapshot(ing.name);
    return { name: ing.name, stock: stock, lowAlert: item.lowAlert };
  }).filter(function (x) { return x.lowAlert > 0 && x.stock <= x.lowAlert; });
  const expiring = getExpiringBatches();
  if (!lowItems.length && !expiring.length) { el.innerHTML = ''; return; }
  const html = [];
  if (lowItems.length) html.push('<div class="p-3 rounded-lg bg-red-900/30 border border-red-700/60 text-xs text-red-300"><b>Low / out of stock:</b> ' +
    lowItems.map(function (x) { return esc(x.name) + ' (' + fmt(x.stock) + ')'; }).join(', ') + '</div>');
  if (expiring.length) html.push('<div class="p-3 rounded-lg bg-orange-900/30 border border-orange-700/60 text-xs text-orange-300"><b>Expiring finished stock:</b> ' +
    expiring.map(function (p) { return esc(p.date) + ' · ' + fmt(p.pieces) + ' pcs · exp ' + esc(p.useBy); }).join(' | ') + '</div>');
  el.innerHTML = html.join('<div class="h-2"></div>');
}
function getExpiringBatches(days) {
  days = days || 3;
  const soonStr = new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
  return (state.production || []).filter(function (p) { return p.useBy && p.useBy <= soonStr; });
}

function renderDashboard() {
  const todayStr = today();
  const t = financeTotalsAll();
  const todayProduction = prodList().filter(function (p) { return p.date === todayStr; });
  const todaySales = salesList().filter(function (s) { return s.date === todayStr; });
  const revenueToday = todaySales.reduce(function (s, x) { return s + (x.amount || 0); }, 0);
  const capitalToday = todayProduction.reduce(function (s, p) { return s + (p.capital || 0); }, 0);
  const netToday = revenueToday - capitalToday;
  const ratio = t.capital > 0 ? (t.net / t.capital) * 100 : 0;
  $('kpiRevenue').textContent = fmtKs(revenueToday);
  $('kpiCapital').textContent = fmtKs(capitalToday);
  $('kpiNet').textContent = fmtKs(netToday);
  $('kpiNet').className = 'text-lg font-extrabold ' + (netToday >= 0 ? 'text-emerald-400' : 'text-red-400');
  $('kpiRatio').textContent = ratio.toFixed(1) + '%';
  $('kpiRatio').title = 'Profit (all sales revenue minus their goods cost) divided by all production cost';
  $('kpiPayable').textContent = fmtKs(totalPayable());
  $('kpiPayable').className = 'text-lg font-extrabold ' + (totalPayable() > 0 ? 'text-red-400' : 'text-emerald-400');
  // Flash KPIs when their value changes (skips the very first render).
  ['kpiRevenue', 'kpiCapital', 'kpiNet', 'kpiRatio', 'kpiPayable'].forEach(function (id) {
    const el = $(id);
    if (!el) return;
    if (el.getAttribute('data-prev') !== null && el.getAttribute('data-prev') !== el.textContent) flashEl(el);
    el.setAttribute('data-prev', el.textContent);
  });
  renderCharts();
  renderSummary(entriesProdSales());
  renderMonthlyReport();
  renderDashboardAlerts();
}
// @@DASH2@@

/* ============================================================
   MONTHLY REPORT — production & sales model
   ============================================================ */
function renderMonthlyReport() {
  const sel = $('reportMonth');
  const entries = entriesProdSales();
  const months = new Set();
  entries.forEach(function (e) { months.add(e.date.slice(0, 7)); });
  const current = sel.value;
  sel.innerHTML = '<option value="">Select month...</option>';
  Array.from(months).sort().reverse().forEach(function (m) {
    const [y, mo] = m.split('-');
    const label = new Date(y, mo - 1, 1).toLocaleString('en-US', { month: 'long', year: 'numeric' });
    sel.innerHTML += '<option value="' + m + '">' + label + '</option>';
  });
  if (current) sel.value = current;
  const m = sel.value;
  if (!m) { $('monthlyReport').textContent = 'Select a month to see its full profit report.'; return; }
  const monthEntries = entries.filter(function (e) { return e.date.slice(0, 7) === m; });
  if (!monthEntries.length) { $('monthlyReport').textContent = 'No activity for this month.'; return; }
  const rev = monthEntries.reduce(function (s, e) { return s + (e.revenue || 0); }, 0);
  const cogs = monthEntries.reduce(function (s, e) { return s + (e.cogs || 0); }, 0);
  const cap = monthEntries.reduce(function (s, e) { return s + (e.capital || 0); }, 0);
  const net = monthEntries.reduce(function (s, e) { return s + (e.net || 0); }, 0);
  const laborHrs = monthEntries.reduce(function (s, e) { return s + ((e.laborMin || 0) / 60); }, 0);
  const laborCost = monthEntries.reduce(function (s, e) { return s + (e.laborCost || 0); }, 0);
  const bags = monthEntries.reduce(function (s, e) { return s + (e.prodBags || 0); }, 0);
  const pcs = monthEntries.reduce(function (s, e) { return s + (e.prodPieces || 0); }, 0);
  const sold = monthEntries.reduce(function (s, e) { return s + (e.soldBags || 0); }, 0);
  const soldPcs = monthEntries.reduce(function (s, e) { return s + (e.soldPieces || 0); }, 0);
  let best = null, worst = null;
  monthEntries.forEach(function (e) {
    if (!best || e.net > best.net) best = e;
    if (!worst || e.net < worst.net) worst = e;
  });
  const [y, mo] = m.split('-');
  const label = new Date(y, mo - 1, 1).toLocaleString('en-US', { month: 'long', year: 'numeric' });
  const monthExpenses = (state.expenses || []).filter(function (e) { return (e.date || '').slice(0, 7) === m; })
    .reduce(function (s, e) { return s + (e.amount || 0); }, 0);
  const monthWaste = (state.waste || []).filter(function (w) { return (w.date || '').slice(0, 7) === m; });
  const costPerPiece = pcs > 0 ? cap / pcs : 0;
  const wasteValue = monthWaste.reduce(function (sum, w) {
    return sum + (typeof w.cost === 'number' ? w.cost : ((w.qty || 0) * costPerPiece));
  }, 0);
  const recurringTotal = (state.recurringExpenses || []).reduce(function (s, r) { return s + (r.amount || 0); }, 0);
  const surplusPcs = pcs - soldPcs;
  const surplusValue = surplusPcs * costPerPiece;
  const netAfterAll = net - laborCost - monthExpenses - wasteValue - recurringTotal;
  const soldDays = monthEntries.filter(function (e) { return e.soldBags > 0; }).length;
  const marginPct = rev > 0 ? ((net / rev) * 100).toFixed(1) + '%' : '';
  $('monthlyReport').innerHTML =
    '<div class="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">' +
    mtk(label + ' Sales Revenue', fmtKs(rev), fmt(sold) + ' bags on ' + soldDays + ' sale day(s)', 'text-emerald-400') +
    mtk('Goods Cost (COGS)', fmtKs(Math.round(cogs)), 'of what actually sold', 'text-amber-400') +
    mtk('Gross Profit', fmtKs(net), marginPct, net >= 0 ? 'text-emerald-400' : 'text-red-400') +
    mtk('Capital Spent Rolling', fmtKs(cap), monthEntries.length + ' production day(s)', 'text-amber-400') +
    mtk('Production', fmt(bags) + ' bags', fmt(pcs) + ' pieces rolled', 'text-gray-100') +
    mtk('Sold', fmt(sold) + ' bags', fmt(soldPcs) + ' pieces', 'text-gray-100') +
    mtk('Rolled-not-Sold (stock)', fmt(Math.abs(surplusPcs)) + ' pcs', fmtKs(Math.round(surplusValue)) + ' still in ready-to-sell stock', surplusPcs > 0 ? 'text-amber-400' : 'text-emerald-400') +
    mtk('Labor', laborHrs.toFixed(1) + ' hrs', fmtKs(Math.round(laborCost)), 'text-red-400') +
    mtk('Other Costs', 'Expenses ' + fmtKs(Math.round(monthExpenses)), 'waste ' + fmtKs(Math.round(wasteValue)) + ' · fixed ' + fmtKs(Math.round(recurringTotal)), 'text-red-400') +
    mtk('Best Day (sold)', best ? best.date : '—', best ? fmtKs(best.net) : '', 'text-emerald-400') +
    mtk('Worst Day (sold)', worst ? worst.date : '—', worst ? fmtKs(worst.net) : '', 'text-red-400') +
    '<div class="p-3 rounded-lg bg-emerald-600/20 border border-emerald-600/40 col-span-1 lg:col-span-2"><div class="text-xs text-gray-300">Net After ALL Costs (true monthly profit)</div><div class="font-bold ' + (netAfterAll >= 0 ? 'text-emerald-400' : 'text-red-400') + ' text-xl">' + fmtKs(Math.round(netAfterAll)) + '</div><div class="text-[10px] text-gray-400">sales − cost of what sold − labor − expenses − waste − fixed costs</div></div>' +
    '</div>';
}
$('reportMonth').addEventListener('change', renderMonthlyReport);
function mtk(title, value, sub, color) {
  return '<div class="p-3 rounded-lg bg-gray-800/60"><div class="text-xs text-gray-400">' + title + '</div><div class="font-bold ' + (color || 'text-gray-100') + ' text-lg">' + value + '</div>' + (sub ? '<div class="text-[10px] text-gray-500">' + sub + '</div>' : '') + '</div>';
}
// @@DASH3@@

/* ============================================================
   CHARTS — built only when the Dashboard tab is visible
   (avoids destroy/recreate churn on other tabs)
   ============================================================ */
function renderCharts() {
  const pane = $('tab-dashboard');
  if (pane && pane.classList.contains('hidden')) return; // not on today — skip
  const gridColor = 'rgba(255,255,255,0.08)';
  const tickColor = '#9CA3AF';
  const days = parseInt($('chartRange') ? $('chartRange').value : '30', 10) || 30;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - (days - 1));
  const off = cutoff.getTimezoneOffset();
  const cutoffStr = new Date(cutoff.getTime() - off * 60000).toISOString().slice(0, 10);
  const recent = entriesProdSales().filter(function (e) { return e.date >= cutoffStr; });
  const labels = recent.map(function (e) { return e.date.slice(5); });
  const gains = recent.map(function (e) { return e.net; });
  const volumes = recent.map(function (e) { return e.prodBags; });
  if (gainChart) gainChart.destroy();
  gainChart = new Chart($('gainChart'), {
    type: 'line',
    data: { labels: labels, datasets: [{ label: 'Daily Profit (Ks, on sold)', data: gains, borderColor: '#10B981', backgroundColor: 'rgba(16,185,129,0.15)', fill: true, tension: 0.4, pointRadius: 3 }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { labels: { color: tickColor } } },
      scales: {
        x: { ticks: { color: tickColor, maxRotation: 45 }, grid: { color: gridColor } },
        y: { ticks: { color: tickColor }, grid: { color: gridColor } }
      }
    }
  });
  if (volumeChart) volumeChart.destroy();
  volumeChart = new Chart($('volumeChart'), {
    type: 'bar',
    data: { labels: labels, datasets: [{ label: 'Bags Produced (rolled)', data: volumes, backgroundColor: volumes.map(function (v) { return v > 0 ? '#D97706' : 'rgba(75,85,99,0.4)'; }), borderRadius: 4 }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { labels: { color: tickColor } } },
      scales: {
        x: { ticks: { color: tickColor, maxRotation: 45 }, grid: { color: gridColor } },
        y: { ticks: { color: tickColor }, grid: { color: gridColor } }
      }
    }
  });
}
$('chartRange').addEventListener('change', function () { renderDashboard(); });

/* ============================================================
   SUMMARY — production & sales totals
   ============================================================ */
function renderSummary(entries) {
  const el = $('summaryText');
  if (!entries.length) { el.textContent = 'No data recorded yet. Start by logging a production batch (the rolls you make) and a sale.'; return; }
  const t = financeTotalsAll();
  const totalBags = entries.reduce(function (s, e) { return s + (e.prodBags || 0); }, 0);
  const totalPieces = entries.reduce(function (s, e) { return s + (e.prodPieces || 0); }, 0);
  const soldPieces = entries.reduce(function (s, e) { return s + (e.soldPieces || 0); }, 0);
  const onHand = (state.stock && state.stock.pieces) || 0;
  const profitableDays = entries.filter(function (e) { return e.net >= 0; }).length;
  const netAfterLabor = t.net - t.laborCost;
  el.innerHTML = '<div class="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">' +
    '<div class="p-3 rounded-lg bg-gray-800/60"><div class="text-xs text-gray-400">Total Sales Revenue (all time)</div><div class="font-bold text-emerald-400 text-lg">' + fmtKs(t.revenue) + '</div></div>' +
    '<div class="p-3 rounded-lg bg-gray-800/60"><div class="text-xs text-gray-400">Total Capital Spent Rolling</div><div class="font-bold text-amber-400 text-lg">' + fmtKs(t.capital) + '</div></div>' +
    '<div class="p-3 rounded-lg bg-gray-800/60"><div class="text-xs text-gray-400">Total Profit (on sold)</div><div class="font-bold text-emerald-400 text-lg">' + fmtKs(t.net) + '</div></div>' +
    '<div class="p-3 rounded-lg bg-gray-800/60"><div class="text-xs text-gray-400">Total Profit After Labor</div><div class="font-bold text-emerald-400 text-lg">' + fmtKs(netAfterLabor) + '</div></div>' +
    '<div class="p-3 rounded-lg bg-gray-800/60"><div class="text-xs text-gray-400">Rolled</div><div class="font-bold text-lg">' + fmt(totalBags) + ' bags · ' + fmt(totalPieces) + ' pcs</div></div>' +
    '<div class="p-3 rounded-lg bg-gray-800/60"><div class="text-xs text-gray-400">Sold</div><div class="font-bold text-lg">' + fmt(t.salesBags) + ' bags · ' + fmt(soldPieces) + ' pcs</div></div>' +
    '<div class="p-3 rounded-lg bg-emerald-600/20 border border-emerald-600/40"><div class="text-xs text-gray-300">Ready-to-sell stock</div><div class="font-bold text-emerald-400 text-lg">' + fmt(onHand) + ' pcs</div><div class="text-[10px] text-gray-500">≈ ' + fmt(stockBagsHint()) + ' bags on hand</div></div>' +
    '<div class="p-3 rounded-lg bg-gray-800/60"><div class="text-xs text-gray-400">Profitable Days (sold)</div><div class="font-bold text-emerald-400 text-lg">' + profitableDays + ' / ' + entries.length + '</div></div>' +
    '<div class="p-3 rounded-lg bg-gray-800/60"><div class="text-xs text-gray-400">Cumulative Labor</div><div class="font-bold text-lg">' + (t.laborMin / 60).toFixed(1) + ' hrs (' + fmtKs(t.laborCost) + ')</div></div>' +
    '<div class="p-3 rounded-lg bg-gray-800/60"><div class="text-xs text-gray-400">Inventory Value (ingredients)</div><div class="font-bold text-amber-400 text-lg">' + fmtKs(Math.round(inventoryValue())) + '</div></div>' +
    '<div class="p-3 rounded-lg bg-gray-800/60"><div class="text-xs text-gray-400">Standing Orders</div><div class="font-bold text-lg">' + fmt(totalStandingOrders()) + ' bags/day</div><div class="text-[10px] text-gray-500">customers commit to these</div></div>' +
    '</div>';
}
