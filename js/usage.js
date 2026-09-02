/* ============================================================
   TODAY'S USAGE
   ============================================================ */
function currentUsage() {
  const usage = {};
  state.prices.forEach(function (ing) {
    usage[ing.name] = draftUsage[ing.name] !== undefined ? draftUsage[ing.name] : defaultUsageFor(ing.name);
  });
  return usage;
}

function defaultUsageFor(name) {
  if (DEFAULT_USAGE[name] !== undefined) return DEFAULT_USAGE[name];
  return 0;
}

/* Weight (grams) of one ingredient in a batch. Gram-based items weigh their
   qty directly; unit-based items (egg, electricity) weigh qty × weightPerUnit
   (assumed grams per unit), so the "total weight of ingredients" is meaningful
   even when some things are counted. */
function ingredientWeightGrams(ing, qty) {
  qty = parseFloat(qty) || 0;
  if (ing.unit === 'g') return qty;
  return qty * (parseFloat(ing.weightPerUnit) || 0);
}
/* Sum of all ingredient weights in grams, for a usage map. */
function totalUsageWeightGrams(usage, prices) {
  prices = prices || state.prices || [];
  return prices.reduce(function (sum, ing) {
    return sum + ingredientWeightGrams(ing, (usage && usage[ing.name]));
  }, 0);
}

function previousProductionUsage(date) {
  return (state.production || []).filter(function (production) {
    return production.date < date && production.usage;
  }).sort(function (a, b) {
    return String(b.date).localeCompare(String(a.date));
  })[0];
}

/* Median grams-per-roll from recent batches. Used to estimate the expected
   roll count at MIX time, when the actual weight per roll is not known yet
   (it is only measured while rolling). Falls back to 0 when there is no
   history. */
function recentWeightPerRoll(max) {
  max = max || 14;
  const wprs = (state.production || [])
    .filter(function (p) { return p && parseFloat(p.weightPerRoll) > 0; })
    .sort(function (a, b) { return String(b.date).localeCompare(String(a.date)); })
    .slice(0, max)
    .map(function (p) { return parseFloat(p.weightPerRoll); });
  if (!wprs.length) return 0;
  const sorted = wprs.slice().sort(function (a, b) { return a - b; });
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2 * 10) / 10;
}

/* ---------- Production form population (never fights the user) ----------
   Repeated renderAll() calls (cloud sync, other tabs redrawing) must never
   silently overwrite quantities the user is currently typing. So the form is
   only (re)populated when the selected production DATE actually changes:
      • New/other date with a saved batch → load that batch (usage + totals).
      • No saved batch for that date  → keep whatever the user has typed.
   Changing the date input forces a repopulate for the newly selected date. */
let populatedProductionDate = null;
function populateProductionForm(date) {
  if (populatedProductionDate === date) return false;
  populatedProductionDate = date;
  const batch = (state.production || []).find(function (production) { return production.date === date; }) || null;
  if (batch) {
    draftUsage = Object.assign({}, batch.usage || {});
    $('additionalCost').value = batch.additionalCost || 0;
    $('logBagsProduced').value = batch.bags || 0;
    $('logPieces').value = batch.pieces || 0;
    $('logLabor').value = batch.laborMinutes || 0;
    $('logWeightPerRoll').value = batch.weightPerRoll || 0;
    $('logNotes').value = batch.notes || '';
    if ($('logUseBy')) $('logUseBy').value = batch.useBy || '';
  } else {
    // No saved batch: use the default/previous usage but NEVER touch the
    // quantities/labor/notes the user is editing.
    setDefaultProductionUsage(date);
  }
  renderUsageTable(true);   // rebuild usage rows (this IS the date change)
  updateUsageCosts();
  updateDraftHint();
  return true;
}
$('logDate').addEventListener('change', function () {
  const curD = $('logDate').value || today();
  populateProductionForm(curD);
  // Picking a day that already has a batch makes the Save button UPDATE it;
  // a fresh day resets it back to a new batch.
  const batch = (state.production || []).find(function (p) { return p.date === curD; }) || null;
  $('editProdId').value = batch ? batch.id : '';
  const sb = $('saveLogBtn');
  if (sb) sb.innerHTML = batch
    ? '<i data-lucide="save" class="w-5 h-5"></i> Update Production'
    : '<i data-lucide="save" class="w-5 h-5"></i> Save Production Work';
  persistDraft();
  updateDraftHint();
});

function setDefaultProductionUsage(date) {
  if (Object.keys(draftUsage).length) return;
  const batch = (state.production || []).find(function (production) { return production.date === date; }) || previousProductionUsage(date);
  draftUsage = Object.assign({}, batch && batch.usage ? batch.usage : DEFAULT_USAGE);
}

function renderUsageTable(force) {
  // NEVER rebuild the usage <input> elements while the user is editing the
  // current production date — re-renders from cloud sync, inventory changes,
  // purchases, waste, etc. must not wipe quantities being typed. A forced
  // rebuild happens only on an actual date change (populateProductionForm).
  const curDate = $('logDate') ? $('logDate').value : today();
  if (!force && populatedProductionDate === curDate) {
    updateUsageCosts();
    return;
  }
  const tbody = $('usageTable');
  const usage = currentUsage();
  tbody.innerHTML = state.prices.map(function (ing) {
    const qty = usage[ing.name] !== undefined ? usage[ing.name] : (DEFAULT_USAGE[ing.name] || 0);
    const cost = ing.unit === 'g' ? (qty / 1000) * (parseFloat(ing.price) || 0) : qty * (parseFloat(ing.price) || 0);
    const weight = Math.round(ingredientWeightGrams(ing, qty));
    return '<tr class="border-b border-gray-800">' +
      '<td class="py-1.5 pr-2 font-medium">' + esc(ing.name) + '</td>' +
      '<td class="py-1.5 pr-2"><input type="number" min="0" step="0.01" value="' + esc(qty) + '" data-name="' + esc(ing.name) + '" class="usage-input w-20 px-1.5 py-1 rounded border border-gray-700 bg-gray-800 text-xs text-right focus:outline-none focus:ring-1 focus:ring-amber-500"></td>' +
      '<td class="py-1.5 pr-2 text-gray-500">' + (ing.unit === 'g' ? 'g' : 'units') + '</td>' +
      '<td class="py-1.5 pr-2 text-gray-400 tabular-nums">' + fmt(weight) + ' g</td>' +
      '<td class="py-1.5 text-amber-400 font-semibold">' + fmtKs(cost) + '</td>' +
      '</tr>';
  }).join('');
  document.querySelectorAll('.usage-input').forEach(function (inp) {
    inp.addEventListener('input', function () {
      const v = parseFloat(inp.value);
      draftUsage[inp.dataset.name] = !isNaN(v) && v >= 0 ? v : 0;
      updateUsageCosts();
      persistDraft();
      draftTouched = true;
      updateDraftHint();
    });
  });
  updateUsageCosts();
wireResponsiveTables();
}

/* ---------- "Draft is auto-synced" hint ----------
   Numbers you type are captured as a draft that auto-saves on this device and
   auto-syncs to the cloud. The hint clarifies the boundary: the numbers are
   SAFE (synced), but a batch only enters stock/inventory when "Save Production
   Work" is pressed — so nobody assumes typing alone moved goods into stock. */
function updateDraftHint() {
  const el = $('draftHint'); if (!el) return;
  const date = $('logDate') ? $('logDate').value : today();
  const committed = (state.production || []).some(function (p) { return p.date === date; });
  let real = false;
  try { real = draftHasRealContent(captureDraft()); } catch (e) {}
  if (draftTouched && real && !committed) {
    el.textContent = 'Auto-saving to your account · press “Save Production Work” to add this batch to stock & inventory.';
    el.className = 'text-[11px] text-amber-400 mt-1.5 font-semibold';
  } else {
    el.textContent = '';
    el.className = 'text-[11px] mt-1.5';
  }
}

function updateUsageCosts() {
  const usage = currentUsage();
  const ingCost = ingredientCostFor(usage);
  const extra = parseFloat($('additionalCost').value) || 0;
  const total = ingCost + extra;
  $('ingredientCost').textContent = fmtKs(ingCost);
  $('totalCapital').textContent = fmtKs(total);
  const totalWeightEl = $('usageTotalWeight');
  if (totalWeightEl) totalWeightEl.textContent = fmt(Math.round(totalUsageWeightGrams(usage))) + ' g';
  state.prices.forEach(function (ing) {
    const qty = usage[ing.name] || 0;
    const cost = ing.unit === 'g' ? (qty / 1000) * (parseFloat(ing.price) || 0) : qty * (parseFloat(ing.price) || 0);
    const row = document.querySelector('.usage-input[data-name="' + ing.name + '"]');
    if (row) {
      const cells = row.closest('tr').querySelectorAll('td');
      if (cells && cells.length >= 5) {
        cells[cells.length - 2].textContent = fmt(Math.round(ingredientWeightGrams(ing, qty))) + ' g';  // weight cell
        cells[cells.length - 1].textContent = fmtKs(cost);                                            // cost cell
      }
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
  const yEntry = prodList().filter(function (p) { return p.date === yDate; }).pop();
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
  draftTouched = true;
  updateDraftHint();
  showToast("Copied yesterday's (" + yDate + ') usage into today\'s form.');
});

/* ============================================================
   LIVE CALCULATION (production form — your cost to roll today)
   ============================================================ */
function updateLive() {
  const usage = currentUsage();
  const ingCost = ingredientCostFor(usage);
  const extra = parseFloat($('additionalCost').value) || 0;
  const capital = ingCost + extra;
  const parts = parseFloat($('logPieces').value) || 0;
  const bags = parseFloat($('logBagsProduced').value) || 0;
  const laborMin = parseFloat($('logLabor').value) || 0;
  const wage = parseFloat($('hourlyWage').value) || state.settings.hourlyWage || 0;
  const laborHrs = laborMin / 60;
  const laborCost = laborHrs * wage;
  const mixWeight = totalMixWeightFor(usage);
  const wPerRoll = parseFloat($('logWeightPerRoll').value) || 0;
  // At MIX time the actual weight/roll is not known yet — fall back to the
  // recent average so "expected rolls" is still useful for planning.
  const wprUsed = wPerRoll || recentWeightPerRoll() || 0;
  const wprEstimated = wprUsed > 0 && !wPerRoll;
  const expectedRolls = (wprUsed > 0) ? Math.floor(mixWeight / wprUsed) : 0;
  $('liveCapital').textContent = fmtKs(capital);
  $('liveLaborHrs').textContent = laborHrs.toFixed(2) + ' hrs';
  $('liveLaborCost').textContent = fmtKs(laborCost);
  $('totalMixWeight').textContent = fmt(Math.round(mixWeight)) + ' g';
  $('liveExpectedRolls').textContent = expectedRolls > 0
    ? fmt(expectedRolls) + ' rolls' + (wprEstimated ? ' (est. ' + fmt(wprUsed) + ' g/roll)' : ' (~' + fmt(Math.round(mixWeight % wprUsed)) + ' g left)')
    : '—';
  $('liveRollDiff').textContent = (expectedRolls > 0 && parts > 0) ? (parts - expectedRolls >= 0 ? '+' : '') + fmt(parts - expectedRolls) : (expectedRolls > 0 ? 'add after packing' : '—');
  $('liveRollDiff').className = 'font-bold text-[11px] ' + (expectedRolls > 0 ? (parts > 0 ? (parts >= expectedRolls ? 'text-emerald-400' : 'text-amber-400') : 'text-gray-500') : 'text-gray-500');
  $('liveCostPiece').textContent = parts > 0 ? fmtKs(Math.round((capital / parts) * 100) / 100) : '—';
  $('liveCostBag').textContent = bags > 0 ? fmtKs(Math.round((capital / bags) * 100) / 100) : '—';
  const pcsBagEl = $('livePcsBag');
  if (pcsBagEl) {
    pcsBagEl.textContent = (parts > 0 && bags > 0) ? fmt(Math.round(parts / bags * 10) / 10) + ' pcs/bag' : '—';
    pcsBagEl.className = 'font-bold ' + (parts > 0 && bags > 0 ? 'text-emerald-400' : 'text-gray-500');
  }
  const onHand = (state.stock && state.stock.pieces) || 0;
  $('liveStockAfter').textContent = fmt(onHand + parts) + ' ready';
}
['logBagsProduced', 'logPieces', 'logWeightPerRoll', 'logNotes', 'logLabor', 'hourlyWage', 'additionalCost'].forEach(function (id) {
  const el = $(id);
  if (el) el.addEventListener('input', function () {
    updateUsageCosts();
    persistDraft();
    draftTouched = true;
    updateDraftHint();
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

