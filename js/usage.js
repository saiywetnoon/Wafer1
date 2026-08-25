/* ============================================================
   TODAY'S USAGE
   ============================================================ */
function currentUsage() {
  const usage = {};
  state.prices.forEach(function (ing) {
    usage[ing.name] = draftUsage[ing.name] !== undefined ? draftUsage[ing.name] : (DEFAULT_USAGE[ing.name] || 0);
  });
  return usage;
}

function renderUsageTable() {
  const tbody = $('usageTable');
  const usage = currentUsage();
  tbody.innerHTML = state.prices.map(function (ing) {
    const qty = usage[ing.name] !== undefined ? usage[ing.name] : (DEFAULT_USAGE[ing.name] || 0);
    const cost = ing.unit === 'g' ? (qty / 1000) * (parseFloat(ing.price) || 0) : qty * (parseFloat(ing.price) || 0);
    return '<tr class="border-b border-gray-800">' +
      '<td class="py-1.5 pr-2 font-medium">' + esc(ing.name) + '</td>' +
      '<td class="py-1.5 pr-2"><input type="number" min="0" step="0.01" value="' + esc(qty) + '" data-name="' + esc(ing.name) + '" class="usage-input w-20 px-1.5 py-1 rounded border border-gray-700 bg-gray-800 text-xs text-right focus:outline-none focus:ring-1 focus:ring-amber-500"></td>' +
      '<td class="py-1.5 pr-2 text-gray-500">' + (ing.unit === 'g' ? 'g' : 'units') + '</td>' +
      '<td class="py-1.5 text-amber-400 font-semibold">' + fmtKs(cost) + '</td>' +
      '</tr>';
  }).join('');
  document.querySelectorAll('.usage-input').forEach(function (inp) {
    inp.addEventListener('input', function () {
      const v = parseFloat(inp.value);
      draftUsage[inp.dataset.name] = !isNaN(v) && v >= 0 ? v : 0;
      updateUsageCosts();
      persistDraft();
    });
  });
  updateUsageCosts();
}

function updateUsageCosts() {
  const usage = currentUsage();
  const ingCost = ingredientCostFor(usage);
  const extra = parseFloat($('additionalCost').value) || 0;
  const total = ingCost + extra;
  $('ingredientCost').textContent = fmtKs(ingCost);
  $('totalCapital').textContent = fmtKs(total);
  state.prices.forEach(function (ing) {
    const qty = usage[ing.name] || 0;
    const cost = ing.unit === 'g' ? (qty / 1000) * (parseFloat(ing.price) || 0) : qty * (parseFloat(ing.price) || 0);
    const row = document.querySelector('.usage-input[data-name="' + ing.name + '"]');
    if (row) {
      const costCell = row.closest('tr').querySelector('td:last-child');
      if (costCell) costCell.textContent = fmtKs(cost);
    }
  });
  updateLive();
}

$('additionalCost').addEventListener('input', updateUsageCosts);

/* ---------- Copy Yesterday's Usage ---------- */
$('copyYesterdayBtn').addEventListener('click', function () {
  const d = new Date($('logDate').value + 'T00:00:00');
  d.setDate(d.getDate() - 1);
  const off = d.getTimezoneOffset();
  const yDate = new Date(d.getTime() - off * 60000).toISOString().slice(0, 10);
  const yEntry = state.entries[yDate];
  if (!yEntry || !yEntry.usage) {
    showToast('No entry found for yesterday (' + yDate + ').', 'info');
    return;
  }
  draftUsage = Object.assign({}, yEntry.usage);
  state.prices.forEach(function (ing) {
    const input = document.querySelector('.usage-input[data-name="' + ing.name + '"]');
    if (input) input.value = yEntry.usage[ing.name] || 0;
  });
  $('additionalCost').value = yEntry.additionalCost || 0;
  updateUsageCosts();
  showToast("Copied yesterday's (" + yDate + ') usage into today\'s form.');
});

/* ============================================================
   LIVE CALCULATION
   ============================================================ */
function updateLive() {
  const usage = currentUsage();
  const ingCost = ingredientCostFor(usage);
  const extra = parseFloat($('additionalCost').value) || 0;
  const capital = ingCost + extra;
  const bagsSold = parseFloat($('logBagsSold').value) || 0;
  const price = parseFloat($('logPrice').value) || 0;
  const laborMin = parseFloat($('logLabor').value) || 0;
  const wage = parseFloat($('hourlyWage').value) || state.settings.hourlyWage || 0;
  const laborHrs = laborMin / 60;
  const laborCost = laborHrs * wage;
  const revenue = bagsSold * price;
  const net = revenue - capital;
  const netAfterLabor = net - laborCost;
  $('liveRevenue').textContent = fmtKs(revenue);
  $('liveLaborHrs').textContent = laborHrs.toFixed(2) + ' hrs';
  $('liveLaborCost').textContent = fmtKs(laborCost);
  $('totalMixWeight').textContent = fmt(Math.round(totalMixWeightFor(usage))) + ' g';
  $('liveNet').textContent = fmtKs(net);
  $('liveNet').className = 'font-bold ' + (net >= 0 ? 'text-emerald-400' : 'text-red-400');
  $('liveNetAfterLabor').textContent = fmtKs(netAfterLabor);
  $('liveNetAfterLabor').className = 'font-bold ' + (netAfterLabor >= 0 ? 'text-emerald-400' : 'text-red-400');
}
['logBagsProduced', 'logPieces', 'logBagsSold', 'logPrice', 'logLabor', 'hourlyWage', 'additionalCost'].forEach(function (id) {
  $(id).addEventListener('input', function () {
    updateUsageCosts();
    persistDraft();
  });
});
$('logDate').addEventListener('change', persistDraft);
$('hourlyWage').addEventListener('change', function () {
  const w = parseFloat($('hourlyWage').value);
  if (!isNaN(w) && w >= 0) {
    state.settings.hourlyWage = w;
    persistState();
  }
  persistDraft();
});

