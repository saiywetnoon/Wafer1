/* ============================================================
   PRODUCTION — SAVE A BATCH YOU ROLLED
   Adds pieces to your ready-to-sell stock. It does NOT record
   sales here — sales are logged separately (any day), so rolling
   today and selling tomorrow works correctly.
   ============================================================ */
function saveProduction() {
  const date = validateText($('logDate'));
  const bags = validateNum($('logBagsProduced'));
  const pieces = validateNum($('logPieces'));
  const laborMin = validateNum($('logLabor'));
  if (date === null || bags === null || pieces === null || laborMin === null) {
    showToast('Please complete date, bags, pieces and labor with valid numbers.', 'error');
    return;
  }
  const usage = currentUsage();
  const ingCost = ingredientCostFor(usage);
  const extra = parseFloat($('additionalCost').value) || 0;
  const capital = ingCost + extra;
  const laborHrs = laborMin / 60;
  const wage = parseFloat($('hourlyWage').value) || state.settings.hourlyWage || 0;
  const laborCost = laborHrs * wage;

  const editId = document.getElementById('editProdId').value;
  const isUpdate = !!editId;
  const costPerPiece = pieces > 0 ? Math.round(capital / pieces * 100) / 100 : 0;
  const wPerRoll = parseFloat($('logWeightPerRoll').value) || 0;
  const mixWeight = totalMixWeightFor(usage);
  const expectedRolls = wPerRoll > 0 ? Math.floor(mixWeight / wPerRoll) : 0;
  const notes = ($('logNotes').value || '').trim();
  const useBy = ($('logUseBy') ? ($('logUseBy').value || '').trim() : '');

  const record = {
    id: isUpdate ? editId : uid(),
    date: date,
    pieces: Math.round(pieces),
    bags: Math.round(bags),
    weightPerRoll: wPerRoll,
    mixWeight: Math.round(mixWeight),
    expectedRolls: expectedRolls,
    notes: notes,
    usage: Object.assign({}, usage),
    additionalCost: extra,
    capital: Math.round(capital),
    laborMinutes: laborMin,
    laborCost: Math.round(laborCost),
    costPerPiece: costPerPiece
  };
  if (useBy) record.useBy = useBy;

  const previous = isUpdate ? state.production.find(function (p) { return p.id === record.id; }) : null;
  const ingredientShortage = inventoryUsageShortage(previous ? previous.usage : {}, usage);
  if (ingredientShortage) {
    showToast('Not enough ' + ingredientShortage.name + '. Available: ' + fmt(ingredientShortage.available) + '; this batch needs ' + fmt(ingredientShortage.requested) + ' more.', 'error');
    return;
  }

  if (isUpdate) {
    const idx = state.production.findIndex(function (p) { return p.id === record.id; });
    if (idx >= 0) {
      var old = state.production[idx];
      replaceProductionInventory(old, usage, date, record.id);
      state.production[idx] = record;
    }
  } else {
    state.production.push(record);
    reconcileProductionInventory({}, usage, date, record.id);
  }

  rebuildStockAndCogs();
  saveState();
  renderAll();
  document.getElementById('editProdId').value = '';
  var saveBtn = $('saveLogBtn');
  saveBtn.innerHTML = '<i data-lucide="save" class="w-5 h-5"></i> Save Production Work';
  lucide.createIcons();
  showToast(isUpdate ? 'Production updated for ' + date : 'Production saved for ' + date + ' — ' + fmt(pieces) + ' pieces ready to sell.');
  pulseSuccess($('saveLogBtn'));
  triggerGoogleSync();
  clearDraft();
  draftUsage = Object.assign({}, usage);
  state.prices.forEach(function (ing) {
    const input = document.querySelector('.usage-input[data-name="' + ing.name + '"]');
    if (input) input.value = usage[ing.name] || 0;
  });
  $('additionalCost').value = extra || 0;
  $('logBagsProduced').value = bags || 0;
  $('logPieces').value = pieces || 0;
  $('logLabor').value = laborMin || 0;
  $('logWeightPerRoll').value = wPerRoll || 0;
  $('logNotes').value = '';
  if ($('logUseBy')) $('logUseBy').value = '';
  updateUsageCosts();
}

$('saveLogBtn').addEventListener('click', saveProduction);

/* One-click save of a pan batch's production (used by the run tracker and pan
   presets). Writes the same Production entry as the main form, then navigates
   to the Production tab so the totals are visible. */
function saveProductionFromRun(date, pieces, bags, usage, notes, useBy) {
  if (!date || !(pieces > 0)) { showToast('No finished batch to save.', 'error'); return; }
  const record = {
    id: uid(),
    date: date,
    pieces: Math.round(pieces),
    bags: Math.round(bags || Math.ceil(pieces / 6)),
    weightPerRoll: 0, mixWeight: 0, expectedRolls: 0,
    notes: notes || '',
    usage: Object.assign({}, usage || currentUsage()),
    additionalCost: 0,
    capital: 0, laborMinutes: 0, laborCost: 0, costPerPiece: 0
  };
  if (record.capital === 0) record.capital = Math.round(ingredientCostFor(record.usage));
  if (useBy) record.useBy = useBy;
  const shortage = inventoryUsageShortage({}, record.usage);
  if (shortage) {
    showToast('Not enough ' + shortage.name + '. Available: ' + fmt(shortage.available) + '; batch needs ' + fmt(shortage.requested) + ' more.', 'error');
    return;
  }
  state.production.push(record);
  reconcileProductionInventory({}, record.usage, record.date, record.id);
  rebuildStockAndCogs();
  saveState();
  renderAll();
  triggerGoogleSync();
  clearDraft();
  $('editProdId').value = '';
  $('saveLogBtn').innerHTML = '<i data-lucide="save" class="w-5 h-5"></i> Save Production Work';
  lucide.createIcons();
  showToast('Batch saved to production for ' + record.date + ' — ' + fmt(record.pieces) + ' pieces ready to sell.');
  pulseSuccess($('saveLogBtn'));
  document.querySelector('[data-tab="log"]').click();
}

/* ============================================================
   RECENT PRODUCTION
   ============================================================ */
function renderProduction() {
  const tbody = $('recentBody');
  const list = prodList().slice().reverse();
  if (!tbody) return;
  if (!list.length) {
    tbody.innerHTML = '<tr><td colspan="8" class="py-6 text-center text-gray-500">No production recorded yet. Rolls you make appear here as ready-to-sell stock.</td></tr>';
    return;
  }
  tbody.innerHTML = list.map(function (p) {
    const exp = p.expectedRolls > 0 ? fmt(p.expectedRolls) : '—';
    const diff = (p.expectedRolls > 0) ? ((p.pieces - p.expectedRolls >= 0 ? '+' : '') + fmt(p.pieces - p.expectedRolls)) : '—';
    const note = p.notes ? '<span class="text-[10px] text-gray-400" title="' + esc(p.notes).replace(/"/g, '&quot;') + '">' + esc(p.notes).slice(0, 30) + (p.notes.length > 30 ? '…' : '') + '</span>' : '<span class="text-gray-600">—</span>';
    const useBy = p.useBy ? '<span class="text-[10px] font-bold text-orange-400 ml-1" title="Sell / use by">exp ' + esc(p.useBy) + '</span>' : '';
    const wpr = p.weightPerRoll ? fmt(p.weightPerRoll) + 'g' : '—';
    return '<tr class="border-b border-gray-800">' +
      '<td class="py-2 pr-2 whitespace-nowrap">' + esc(p.date) + '</td>' +
      '<td class="py-2 pr-2 text-amber-400 font-semibold">' + fmtKs(p.capital) + '</td>' +
      '<td class="py-2 pr-2">' + fmt(p.bags) + '</td>' +
      '<td class="py-2 pr-2">' + fmt(p.pieces) + '</td>' +
      '<td class="py-2 pr-2">' + exp + ' / <span class="text-gray-500">' + (p.weightPerRoll ? fmt(p.weightPerRoll) + 'g' : '—') + '</span></td>' +
      '<td class="py-2 pr-2">' + diff + '</td>' +
      '<td class="py-2 pr-2">' + note + useBy + '</td>' +
      '<td class="py-2"><div class="flex gap-2">' +
      '<button onclick="editProduction(\'' + p.id + '\')" class="text-amber-400 hover:text-amber-300 transition" title="Edit"><i data-lucide="pencil" class="w-4 h-4"></i></button>' +
      '<button onclick="deleteProduction(\'' + p.id + '\')" class="text-red-400 hover:text-red-300 transition" title="Delete"><i data-lucide="trash-2" class="w-4 h-4"></i></button>' +
      '</div></td></tr>';
  }).join('');
  lucide.createIcons();
wireResponsiveTables();
}

function editProduction(id) {
  const p = state.production.find(function (x) { return x.id === id; });
  if (!p) return;
  document.getElementById('editProdId').value = id;
  $('logDate').value = p.date;
  draftUsage = Object.assign({}, p.usage || {});
  state.prices.forEach(function (ing) {
    const input = document.querySelector('.usage-input[data-name="' + ing.name + '"]');
    if (input) input.value = draftUsage[ing.name] || 0;
  });
  $('additionalCost').value = p.additionalCost || 0;
  $('logBagsProduced').value = p.bags || 0;
  $('logPieces').value = p.pieces || 0;
  $('logLabor').value = p.laborMinutes || 0;
  $('logWeightPerRoll').value = p.weightPerRoll || 0;
  $('logNotes').value = p.notes || '';
  if ($('logUseBy')) $('logUseBy').value = p.useBy || '';
  $('saveLogBtn').innerHTML = '<i data-lucide="save" class="w-5 h-5"></i> Update Production';
  lucide.createIcons();
  updateUsageCosts();
  document.querySelector('[data-tab="log"]').click();
  showToast('Editing production for ' + p.date + ' — adjust then click Update Production.', 'info');
}

function deleteProduction(id) {
  const p = state.production.find(function (x) { return x.id === id; });
  if (!p) return;
  if (!confirm('Delete this production batch?')) return;
  if (p.usage) reconcileProductionInventory(p.usage, {}, p.date, p.id);
  state.production = state.production.filter(function (x) { return x.id !== id; });
  rebuildStockAndCogs();
  saveState();
  renderAll();
  triggerGoogleSync();
  showToast('Production batch deleted. Stock and inventory restored.');
}

/* ============================================================
   STANDING ORDERS (prefill today's production target)
   ============================================================ */
$('standOrderBtn').addEventListener('click', function () {
  const total = totalStandingOrders();
  if (!total) { showToast('No standing orders defined yet. Add them in the Customers tab.', 'info'); return; }
  $('logBagsProduced').value = total;
  const avg = stockAvgPiecesPerBag() || 6;
  $('logPieces').value = Math.round(total * avg);
  showToast('Prefilled batch to cover ' + fmt(total) + ' bags for standing orders.', 'success');
});
