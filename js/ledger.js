/* ============================================================
   PRODUCTION — SAVE A BATCH YOU ROLLED
   Adds pieces to your ready-to-sell stock. It does NOT record
   sales here — sales are logged separately (any day), so rolling
   today and selling tomorrow works correctly.
   ============================================================ */
/* Same as validateNum but treats an EMPTY field as 0 — so the mix can be saved
   before the actual bags/pieces are known after packaging. */
function validateOptionalNum(input) {
  const raw = (input.value || '').trim();
  if (raw === '') { input.classList.remove('field-error'); return 0; }
  const val = parseFloat(raw);
  if (isNaN(val) || val < 0) { input.classList.add('field-error'); return null; }
  input.classList.remove('field-error');
  return val;
}

function saveProduction() {
  const date = validateText($('logDate'));
  if (date === null) {
    showToast('Please pick a production date.', 'error');
    return;
  }
  const bags = validateOptionalNum($('logBagsProduced'));
  const pieces = validateOptionalNum($('logPieces'));
  const laborMin = validateOptionalNum($('logLabor'));
  if (bags === null || pieces === null || laborMin === null) {
    showToast('Bags, pieces and labor must be zero or valid numbers.', 'error');
    return;
  }
  const usage = currentUsage();
  const ingCost = ingredientCostFor(usage);
  const extra = parseFloat($('additionalCost').value) || 0;
  const capital = ingCost + extra;
  const laborHrs = laborMin / 60;
  const wage = parseFloat($('hourlyWage').value) || state.settings.hourlyWage || 0;
  const laborCost = laborHrs * wage;

  // A mix-only save (nothing packed yet) must still represent REAL work: at
  // least some ingredients measured, or a finished count, or a quality note.
  const usageAny = Object.keys(usage).some(function (k) { return (parseFloat(usage[k]) || 0) > 0; });
  const notesRaw = ($('logNotes').value || '').trim();
  if (!usageAny && pieces <= 0 && bags <= 0 && laborMin <= 0 && !notesRaw) {
    showToast('Nothing to save yet — enter the ingredient quantities first (expected rolls will appear below).', 'error');
    return;
  }

  const requestedEditId = document.getElementById('editProdId').value;
  // Never create a SECOND batch for a day that already has one — that would
  // deduct the ingredients twice. Re-opening a saved day pre-fills its batch,
  // so pressing Save must EDIT that batch in place, not duplicate it.
  const dayBatch = (state.production || []).find(function (p) { return p.date === date; });
  const editId = requestedEditId || (dayBatch ? dayBatch.id : '');
  const isUpdate = !!editId;
  const costPerPiece = pieces > 0 ? Math.round(capital / pieces * 100) / 100 : 0;
  const wPerRoll = parseFloat($('logWeightPerRoll').value) || 0;
  // At MIX time the real weight per roll is unknown — use the recent average
  // so "expected rolls" is still meaningful for planning. The record keeps the
  // entered value (0 = not measured yet); the true expected count is refined
  // when the day is updated after packaging.
  const wprEstimate = recentWeightPerRoll() || 0;
  const wprForExpected = wPerRoll || wprEstimate || 0;
  const mixWeight = totalMixWeightFor(usage);
  const expectedRolls = wprForExpected > 0 ? Math.floor(mixWeight / wprForExpected) : 0;
  const notes = notesRaw;
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
  // Keep the form locked to this batch so clicking Save again UPDATES it instead
  // of creating a duplicate (which would deduct the ingredients a second time).
  document.getElementById('editProdId').value = record.id;
  refreshSaveButton();
  showToast(isUpdate
    ? (pieces > 0 ? 'Production updated for ' + date + ' — ' + fmt(pieces) + ' pieces ready to sell.' : 'Mix updated for ' + date + '. Add actual bags & pieces after packing.')
    : (pieces > 0 ? 'Production saved for ' + date + ' — ' + fmt(pieces) + ' pieces ready to sell.' : 'Mix recorded for ' + date + ' — expected ~' + fmt(expectedRolls) + ' rolls. Update actual counts after packing.'));
  const over = overConsumedStockItems().filter(function (label) {
    const itemName = label.split(' ')[0];
    return (usage[itemName] || 0) > 0;   // only warn about items THIS batch used
  });
  if (over.length) {
    showToast('⚠ Stock went below zero: ' + over.join(', ') + ' — record a purchase or Add Stock to restore.', 'info');
  }
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
  draftTouched = false;
  updateDraftHint();
}

$('saveLogBtn').addEventListener('click', saveProduction);

/* One-click save of a pan batch's production (used by the run tracker and pan
   presets). Writes the same Production entry as the main form, then navigates
   to the Production tab so the totals are visible. Multiple runs in one day
   (e.g. three pans) MERGE into that day's batch so the daily recipe is only
   ever deducted from inventory ONCE — not once per pan. */
function saveProductionFromRun(date, pieces, bags, usage, notes, useBy) {
  if (!date || !(pieces > 0)) { showToast('No finished batch to save.', 'error'); return; }
  const runUsage = usage || currentUsage();
  const existing = (state.production || []).find(function (p) { return p.date === date; });

  // -------- Merge into an existing batch for the same day (no double deduct) --------
  if (existing) {
    existing.pieces = (existing.pieces || 0) + Math.round(pieces);
    existing.bags = (existing.bags || 0) + Math.round(bags || Math.ceil(pieces / 6));
    existing.notes = (existing.notes || '') + (notes ? (existing.notes ? ' · ' : '') + notes : '');
    if (useBy && !existing.useBy) existing.useBy = useBy;
    if (!existing.usage || !Object.keys(existing.usage).length) existing.usage = Object.assign({}, runUsage);
    if (!existing.capital) existing.capital = Math.round(ingredientCostFor(existing.usage));
    rebuildStockAndCogs();
    saveState();
    renderAll();
    triggerGoogleSync();
    clearDraft();
    $('editProdId').value = existing.id;
    refreshSaveButton();
    showToast('Added to today’s production — ' + fmt(existing.pieces) + ' pieces total.', 'success');
    pulseSuccess($('saveLogBtn'));
    document.querySelector('[data-tab="log"]').click();
    draftTouched = false;
    updateDraftHint();
    return;
  }

  const record = {
    id: uid(),
    date: date,
    pieces: Math.round(pieces),
    bags: Math.round(bags || Math.ceil(pieces / 6)),
    weightPerRoll: 0, mixWeight: 0, expectedRolls: 0,
    notes: notes || '',
    usage: Object.assign({}, runUsage),
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
  refreshSaveButton();
  showToast('Batch saved to production for ' + record.date + ' — ' + fmt(record.pieces) + ' pieces ready to sell.');
  const mergedOver = overConsumedStockItems().filter(function (label) {
    const itemName = label.split(' ')[0];
    return (record.usage[itemName] || 0) > 0;  // only warn about items THIS batch used
  });
  if (mergedOver.length) {
    showToast('⚠ Stock went below zero: ' + mergedOver.join(', ') + ' — record a purchase or Add Stock to restore.', 'info');
  }
  pulseSuccess($('saveLogBtn'));
  document.querySelector('[data-tab="log"]').click();
  draftTouched = false;
  updateDraftHint();
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
    const pendingPack = !(p.pieces > 0);
    const exp = p.expectedRolls > 0 ? fmt(p.expectedRolls) : '—';
    const diff = (p.pieces > 0 && p.expectedRolls > 0)
      ? ((p.pieces - p.expectedRolls >= 0 ? '+' : '') + fmt(p.pieces - p.expectedRolls))
      : (pendingPack && p.expectedRolls > 0 ? '<span class="text-[10px] font-bold text-amber-400 whitespace-nowrap">⏳ PACKING</span>' : '—');
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
  updateUsageCosts();
  draftTouched = false;
  updateDraftHint();
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
