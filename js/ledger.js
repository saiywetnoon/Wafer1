/* ============================================================
   SAVE DAILY ENTRY
   ============================================================ */
$('saveLogBtn').addEventListener('click', function () {
  const date = validateText($('logDate'));
  const bagsProduced = validateNum($('logBagsProduced'));
  const pieces = validateNum($('logPieces'));
  const bagsSold = validateNum($('logBagsSold'));
  const price = validateNum($('logPrice'));
  const laborMin = validateNum($('logLabor'));
  if (date === null || bagsProduced === null || pieces === null || bagsSold === null || price === null || laborMin === null) {
    showToast('Please complete all production and earnings fields with valid numbers.', 'error');
    return;
  }
  const usage = currentUsage();
  const ingCost = ingredientCostFor(usage);
  const extra = parseFloat($('additionalCost').value) || 0;
  const capital = ingCost + extra;
  const revenue = bagsSold * price;
  const net = revenue - capital;
  const laborHrs = laborMin / 60;
  const wage = parseFloat($('hourlyWage').value) || state.settings.hourlyWage || 0;
  const laborCost = laborHrs * wage;
  const netAfterLabor = net - laborCost;
  const isUpdate = !!state.entries[date];
  if (isUpdate && !confirm('An entry already exists for ' + date + '. Overwrite it?')) return;
  const costPerBag = bagsProduced > 0 ? Math.round(capital / bagsProduced) : 0;
  const marginPct = revenue > 0 ? Math.round((net / revenue) * 1000) / 10 : 0;
  state.entries[date] = {
    id: state.entries[date] ? state.entries[date].id : uid(),
    usage: Object.assign({}, usage),
    additionalCost: extra,
    capital: Math.round(capital),
    bagsProduced: bagsProduced,
    pieces: pieces,
    bagsSold: bagsSold,
    price: price,
    revenue: Math.round(revenue),
    net: Math.round(net),
    laborMinutes: laborMin,
    laborCost: Math.round(laborCost),
    netAfterLabor: Math.round(netAfterLabor),
    mixWeight: Math.round(totalMixWeightFor(usage)),
    costPerBag: costPerBag,
    marginPct: marginPct
  };
  // Inventory update on each production:
  // New entry  → deduct today's ingredient usage from stock
  // Edit entry  → first return the old day's usage to stock, then deduct the new usage
  var prevUsage = isUpdate && state.entries[date] ? state.entries[date].usage : null;
  state.prices.forEach(function (ing) {
    var used = parseFloat(usage[ing.name]) || 0;
    var prev = prevUsage && prevUsage[ing.name] ? (parseFloat(prevUsage[ing.name]) || 0) : 0;
    var net = used - prev;
    if (net !== 0 && state.inventory[ing.name]) {
      var current = state.inventory[ing.name].stock || 0;
      state.inventory[ing.name].stock = Math.max(0, current - net);
    }
  });
  saveState();
  renderAll();
  showToast(isUpdate ? 'Entry updated for ' + date + ' — Net ' + fmtKs(net) : 'Daily entry saved for ' + date + ' — Net gain ' + fmtKs(net));
  triggerGoogleSync();
  clearDraft();
  // Keep the form populated with the values just saved,
  // so the next entry's defaults are the previous values.
  draftUsage = Object.assign({}, usage);
  state.prices.forEach(function (ing) {
    const input = document.querySelector('.usage-input[data-name="' + ing.name + '"]');
    if (input) input.value = usage[ing.name] || 0;
  });
  $('additionalCost').value = extra || 0;
  $('logBagsProduced').value = bagsProduced || 0;
  $('logPieces').value = pieces || 0;
  $('logBagsSold').value = bagsSold || 0;
  $('logLabor').value = laborMin || 0;
  updateUsageCosts();
});

/* ============================================================
   RECENT ENTRIES
   ============================================================ */
/* Pre-fill today's batch from the sum of all customer standing
   orders. Saves time when your customers order the same amount
   every day. */
$('standOrderBtn').addEventListener('click', function () {
  const total = totalStandingOrders();
  if (!total) { showToast('No standing orders defined yet. Add them in the Customers tab.', 'info'); return; }
  if ($('logBagsProduced').value) $('logBagsProduced').value = total;
  if ($('logBagsSold').value) $('logBagsSold').value = total;
  updateUsageCosts();
  persistDraft();
  showToast('Prefilled batch with ' + fmt(total) + ' bags from standing orders.', 'success');
});

function renderRecent() {
  const tbody = $('recentBody');
  const entries = entriesSorted().reverse().slice(0, 10);
  if (!entries.length) {
    tbody.innerHTML = '<tr><td colspan="11" class="py-6 text-center text-gray-500">No daily entries recorded yet.</td></tr>';
    return;
  }
  tbody.innerHTML = entries.map(function (e) {
    return '<tr class="border-b border-gray-800">' +
      '<td class="py-2 pr-2 whitespace-nowrap">' + esc(e.date) + '</td>' +
      '<td class="py-2 pr-2 text-amber-400 font-semibold">' + fmtKs(e.capital) + '</td>' +
      '<td class="py-2 pr-2">' + fmt(e.bagsProduced) + '</td>' +
      '<td class="py-2 pr-2">' + fmt(e.pieces) + '</td>' +
      '<td class="py-2 pr-2">' + fmt(e.bagsSold) + '</td>' +
      '<td class="py-2 pr-2 text-emerald-400 font-semibold">' + fmtKs(e.revenue) + '</td>' +
      '<td class="py-2 pr-2">' + ((e.laborMinutes || 0) / 60).toFixed(2) + '</td>' +
      '<td class="py-2 pr-2 ' + (e.net >= 0 ? 'text-emerald-400' : 'text-red-400') + ' font-bold">' + fmtKs(e.net) + '</td>' +
      '<td class="py-2 pr-2 text-gray-400">' + fmtKs(e.costPerBag || 0) + '</td>' +
      '<td class="py-2 pr-2 ' + ((e.marginPct || 0) >= 0 ? 'text-emerald-400' : 'text-red-400') + '">' + (e.marginPct || 0) + '%</td>' +
      '<td class="py-2"><div class="flex gap-2">' +
      '<button onclick="editEntry(\'' + e.date + '\')" class="text-amber-400 hover:text-amber-300 transition" title="Edit entry"><i data-lucide="pencil" class="w-4 h-4"></i></button>' +
      '<button onclick="deleteEntry(\'' + e.date + '\')" class="text-red-400 hover:text-red-300 transition" title="Delete entry"><i data-lucide="trash-2" class="w-4 h-4"></i></button>' +
      '</div></td>' +
      '</tr>';
  }).join('');
  lucide.createIcons();
}

function editEntry(date) {
  loadEntryIntoForm(date);
  showToast('Editing entry for ' + date + ' — adjust values then click Save Daily Entry.', 'info');
}

function deleteEntry(date) {
  // Return that day's used ingredients back to inventory before deleting
  var entry = state.entries[date];
  if (entry && entry.usage) {
    state.prices.forEach(function (ing) {
      var used = parseFloat(entry.usage[ing.name]) || 0;
      if (used > 0 && state.inventory[ing.name]) {
        state.inventory[ing.name].stock = (state.inventory[ing.name].stock || 0) + used;
      }
    });
  }
  delete state.entries[date];
  saveState();
  renderAll();
  triggerGoogleSync();
  showToast('Entry for ' + date + ' deleted. Inventory restored.');
}

