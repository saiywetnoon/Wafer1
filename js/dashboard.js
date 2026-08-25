/* ============================================================
   DASHBOARD
   ============================================================ */
let gainChart = null;
let volumeChart = null;

function renderDashboard() {
  const entries = entriesSorted();
  const todayStr = today();
  const todayEntry = state.entries[todayStr];
  const totalRevenue = entries.reduce(function (s, e) { return s + (e.revenue || 0); }, 0);
  const totalCapital = entries.reduce(function (s, e) { return s + (e.capital || 0); }, 0);
  const totalNet = entries.reduce(function (s, e) { return s + (e.net || 0); }, 0);
  const ratio = totalCapital > 0 ? (totalNet / totalCapital) * 100 : 0;
  $('kpiRevenue').textContent = fmtKs(todayEntry ? todayEntry.revenue : 0);
  $('kpiCapital').textContent = fmtKs(todayEntry ? todayEntry.capital : 0);
  $('kpiNet').textContent = fmtKs(todayEntry ? todayEntry.net : 0);
  $('kpiNet').className = 'text-lg font-extrabold ' + ((todayEntry && todayEntry.net >= 0) ? 'text-emerald-400' : 'text-red-400');
  $('kpiRatio').textContent = ratio.toFixed(1) + '%';
  $('kpiPayable').textContent = fmtKs(totalPayable());
  $('kpiPayable').className = 'text-lg font-extrabold ' + (totalPayable() > 0 ? 'text-red-400' : 'text-emerald-400');
  renderCharts();
  renderSummary(entries, totalRevenue, totalCapital, totalNet);
  renderMonthlyReport();
}

function renderMonthlyReport() {
  const sel = $('reportMonth');
  const entries = entriesSorted();
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
  if (!monthEntries.length) { $('monthlyReport').textContent = 'No entries for this month.'; return; }
  const rev = monthEntries.reduce(function (s, e) { return s + (e.revenue || 0); }, 0);
  const cap = monthEntries.reduce(function (s, e) { return s + (e.capital || 0); }, 0);
  const net = monthEntries.reduce(function (s, e) { return s + (e.net || 0); }, 0);
  const netAL = monthEntries.reduce(function (s, e) { return s + (e.netAfterLabor || 0); }, 0);
  const laborHrs = monthEntries.reduce(function (s, e) { return s + ((e.laborMinutes || 0) / 60); }, 0);
  const laborCost = monthEntries.reduce(function (s, e) { return s + (e.laborCost || 0); }, 0);
  const bags = monthEntries.reduce(function (s, e) { return s + (e.bagsProduced || 0); }, 0);
  const pcs = monthEntries.reduce(function (s, e) { return s + (e.pieces || 0); }, 0);
  const sold = monthEntries.reduce(function (s, e) { return s + (e.bagsSold || 0); }, 0);
  const profitable = monthEntries.filter(function (e) { return e.net >= 0; }).length;
  let best = null, worst = null;
  monthEntries.forEach(function (e) {
    if (!best || e.net > best.net) best = e;
    if (!worst || e.net < worst.net) worst = e;
  });
  const [y, mo] = m.split('-');
  const label = new Date(y, mo - 1, 1).toLocaleString('en-US', { month: 'long', year: 'numeric' });
  // One-time expenses for this month
  const monthExpenses = (state.expenses || []).filter(function (e) { return (e.date || '').slice(0, 7) === m; })
    .reduce(function (s, e) { return s + (e.amount || 0); }, 0);
  // Waste for this month, valued at the month's average cost-per-piece
  const monthWastePcs = (state.waste || []).filter(function (w) { return (w.date || '').slice(0, 7) === m; })
    .reduce(function (s, w) { return s + (w.qty || 0); }, 0);
  const costPerPiece = pcs > 0 ? cap / pcs : 0;
  const wasteValue = monthWastePcs * costPerPiece;
  // Recurring monthly fixed costs (rent, internet, etc.)
  const recurringTotal = (state.recurringExpenses || []).reduce(function (s, r) { return s + (r.amount || 0); }, 0);
  const sellout = bags - sold;                     // over-production (+surplus) / under-sold
  const selloutValue = sellout * (rev > 0 ? rev / sold : 0);
  const netAfterAll = netAL - monthExpenses - wasteValue - recurringTotal;
  $('monthlyReport').innerHTML =
    '<div class="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">' +
    '<div class="p-3 rounded-lg bg-gray-800/60"><div class="text-xs text-gray-400">' + label + ' Revenue</div><div class="font-bold text-emerald-400 text-lg">' + fmtKs(rev) + '</div><div class="text-[10px] text-gray-500">' + fmt(sold) + ' bags sold</div></div>' +
    '<div class="p-3 rounded-lg bg-gray-800/60"><div class="text-xs text-gray-400">Capital Spent</div><div class="font-bold text-amber-400 text-lg">' + fmtKs(cap) + '</div><div class="text-[10px] text-gray-500">' + monthEntries.length + ' production days</div></div>' +
    '<div class="p-3 rounded-lg bg-gray-800/60"><div class="text-xs text-gray-400">Net Gain</div><div class="font-bold ' + (net >= 0 ? 'text-emerald-400' : 'text-red-400') + ' text-lg">' + fmtKs(net) + '</div><div class="text-[10px] text-gray-500">' + profitable + ' profitable / ' + monthEntries.length + ' days</div></div>' +
    '<div class="p-3 rounded-lg bg-gray-800/60"><div class="text-xs text-gray-400">After Labor</div><div class="font-bold ' + (netAL >= 0 ? 'text-emerald-400' : 'text-red-400') + ' text-lg">' + fmtKs(netAL) + '</div><div class="text-[10px] text-gray-500">' + laborHrs.toFixed(1) + ' hrs · ' + fmtKs(laborCost) + ' labor</div></div>' +
    '<div class="p-3 rounded-lg bg-gray-800/60"><div class="text-xs text-gray-400">Production</div><div class="font-bold text-lg">' + fmt(bags) + ' bags</div><div class="text-[10px] text-gray-500">' + fmt(pcs) + ' pieces rolled</div></div>' +
    '<div class="p-3 rounded-lg bg-gray-800/60"><div class="text-xs text-gray-400">Margin</div><div class="font-bold text-lg">' + (rev > 0 ? ((net / rev) * 100).toFixed(1) + '%' : '—') + '</div><div class="text-[10px] text-gray-500">net / revenue</div></div>' +
    '<div class="p-3 rounded-lg bg-gray-800/60"><div class="text-xs text-gray-400">Best Day</div><div class="font-bold text-emerald-400 text-sm truncate">' + (best ? best.date + ' · ' + fmtKs(best.net) : '—') + '</div></div>' +
    '<div class="p-3 rounded-lg bg-gray-800/60"><div class="text-xs text-gray-400">Worst Day</div><div class="font-bold text-red-400 text-sm truncate">' + (worst ? worst.date + ' · ' + fmtKs(worst.net) : '—') + '</div></div>' +
    '<div class="p-3 rounded-lg bg-gray-800/60"><div class="text-xs text-gray-400">Sell-out / Surplus</div><div class="font-bold text-lg">' + (sellout >= 0 ? fmt(sellout) + ' bags surplus' : fmt(Math.abs(sellout)) + ' bags short') + '</div><div class="text-[10px] text-gray-500">' + fmtKs(Math.round(selloutValue)) + ' tied in stock</div></div>' +
    '<div class="p-3 rounded-lg bg-gray-800/60"><div class="text-xs text-gray-400">Other Costs</div><div class="font-bold text-red-400 text-sm">Expenses ' + fmtKs(Math.round(monthExpenses)) + '</div><div class="text-[10px] text-gray-500">waste ' + fmtKs(Math.round(wasteValue)) + ' · fixed ' + fmtKs(Math.round(recurringTotal)) + '</div></div>' +
    '<div class="p-3 rounded-lg bg-emerald-600/20 border border-emerald-600/40 col-span-1 lg:col-span-2"><div class="text-xs text-gray-300">Net After ALL Costs (true monthly profit)</div><div class="font-bold ' + (netAfterAll >= 0 ? 'text-emerald-400' : 'text-red-400') + ' text-xl">' + fmtKs(Math.round(netAfterAll)) + '</div><div class="text-[10px] text-gray-400">revenue − capital − labor − expenses − waste − fixed costs</div></div>' +
    '</div>';
}
$('reportMonth').addEventListener('change', renderMonthlyReport);
$('chartRange').addEventListener('change', function () { renderDashboard(); });

function renderCharts() {
  const gridColor = 'rgba(255,255,255,0.08)';
  const tickColor = '#9CA3AF';
  const days = parseInt($('chartRange') ? $('chartRange').value : '30', 10) || 30;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - (days - 1));
  const off = cutoff.getTimezoneOffset();
  const cutoffStr = new Date(cutoff.getTime() - off * 60000).toISOString().slice(0, 10);
  const recent = entriesSorted().filter(function (e) { return e.date >= cutoffStr; });
  const labels = recent.map(function (e) { return e.date.slice(5); });
  const gains = recent.map(function (e) { return e.net; });
  const volumes = recent.map(function (e) { return e.bagsProduced; });
  if (gainChart) gainChart.destroy();
  gainChart = new Chart($('gainChart'), {
    type: 'line',
    data: { labels: labels, datasets: [{ label: 'Net Gain (Ks)', data: gains, borderColor: '#10B981', backgroundColor: 'rgba(16,185,129,0.15)', fill: true, tension: 0.4, pointRadius: 3 }] },
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
    data: { labels: labels, datasets: [{ label: 'Bags Produced', data: volumes, backgroundColor: volumes.map(function (v) { return v > 0 ? '#D97706' : 'rgba(75,85,99,0.4)'; }), borderRadius: 4 }] },
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

function renderSummary(entries, totalRevenue, totalCapital, totalNet) {
  const el = $('summaryText');
  if (!entries.length) { el.textContent = "No data recorded yet. Start by logging today's entry."; return; }
  const totalPieces = entries.reduce(function (s, e) { return s + (e.pieces || 0); }, 0);
  const totalBags = entries.reduce(function (s, e) { return s + (e.bagsProduced || 0); }, 0);
  const totalLaborHrs = entries.reduce(function (s, e) { return s + ((e.laborMinutes || 0) / 60); }, 0);
  const totalLaborCost = entries.reduce(function (s, e) { return s + (e.laborCost || 0); }, 0);
  const totalNetAfterLabor = entries.reduce(function (s, e) { return s + (e.netAfterLabor || 0); }, 0);
  const profitableDays = entries.filter(function (e) { return e.net >= 0; }).length;
  el.innerHTML = '<div class="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">' +
    '<div class="p-3 rounded-lg bg-gray-800/60"><div class="text-xs text-gray-400">Total Revenue (all time)</div><div class="font-bold text-emerald-400 text-lg">' + fmtKs(totalRevenue) + '</div></div>' +
    '<div class="p-3 rounded-lg bg-gray-800/60"><div class="text-xs text-gray-400">Total Capital (all time)</div><div class="font-bold text-amber-400 text-lg">' + fmtKs(totalCapital) + '</div></div>' +
    '<div class="p-3 rounded-lg bg-gray-800/60"><div class="text-xs text-gray-400">Total Net Gain</div><div class="font-bold text-emerald-400 text-lg">' + fmtKs(totalNet) + '</div></div>' +
    '<div class="p-3 rounded-lg bg-gray-800/60"><div class="text-xs text-gray-400">Total Net After Labor</div><div class="font-bold text-emerald-400 text-lg">' + fmtKs(totalNetAfterLabor) + '</div></div>' +
    '<div class="p-3 rounded-lg bg-gray-800/60"><div class="text-xs text-gray-400">Production Totals</div><div class="font-bold text-lg">' + fmt(totalBags) + ' bags · ' + fmt(totalPieces) + ' pcs</div></div>' +
    '<div class="p-3 rounded-lg bg-gray-800/60"><div class="text-xs text-gray-400">Cumulative Labor</div><div class="font-bold text-lg">' + totalLaborHrs.toFixed(1) + ' hrs (' + fmtKs(totalLaborCost) + ')</div></div>' +
    '<div class="p-3 rounded-lg bg-gray-800/60"><div class="text-xs text-gray-400">Profitable Days</div><div class="font-bold text-emerald-400 text-lg">' + profitableDays + ' / ' + entries.length + '</div></div>' +
    '<div class="p-3 rounded-lg bg-gray-800/60"><div class="text-xs text-gray-400">Avg Net / Day</div><div class="font-bold text-lg">' + fmtKs(totalNet / entries.length) + '</div></div>' +
    '<div class="p-3 rounded-lg bg-gray-800/60"><div class="text-xs text-gray-400">Inventory Value (stock cost)</div><div class="font-bold text-amber-400 text-lg">' + fmtKs(Math.round(inventoryValue())) + '</div></div>' +
    '<div class="p-3 rounded-lg bg-gray-800/60"><div class="text-xs text-gray-400">Standing Orders</div><div class="font-bold text-lg">' + fmt(totalStandingOrders()) + ' bags/day</div><div class="text-[10px] text-gray-500">customers commit to these</div></div>' +
    '</div>';
}

