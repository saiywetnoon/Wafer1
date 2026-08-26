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

  const record = {
    id: isUpdate ? editId : uid(),
    date: date,
    pieces: Math.round(pieces),
    bags: Math.round(bags),
    usage: Object.assign({}, usage),
    additionalCost: extra,
    capital: Math.round(capital),
    laborMinutes: laborMin,
    laborCost: Math.round(laborCost),
    costPerPiece: costPerPiece
  };

  if (isUpdate) {
    const idx = state.production.findIndex(function (p) { return p.id === record.id; });
    if (idx >= 0) {
      // Return the old batch's ingredients to stock, then deduct the new usage.
      var old = state.production[idx];
      state.prices.forEach(function (ing) {
        var oldU = parseFloat((old.usage || {})[ing.name]) || 0;
        var newU = parseFloat(usage[ing.name]) || 0;
        var diff = newU - oldU;
        if (diff !== 0 && state.inventory[ing.name]) {
          state.inventory[ing.name].stock = Math.max(0, (state.inventory[ing.name].stock || 0) - diff);
        }
      });
      state.production[idx] = record;
    }
  } else {
    state.production.push(record);
    state.prices.forEach(function (ing) {
      var used = parseFloat(usage[ing.name]) || 0;
      if (used > 0 && state.inventory[ing.name]) {
        state.inventory[ing.name].stock = Math.max(0, (state.inventory[ing.name].stock || 0) - used);
      }
    });
  }

  rebuildStockAndCogs();
  saveState();
  renderAll();
  document.getElementById('editProdId').value = '';
  var saveBtn = $('saveLogBtn');
  saveBtn.innerHTML = '<i data-lucide="save" class="w-5 h-5"></i> Save Production Work';
  lucide.createIcons();
  showToast(isUpdate ? 'Production updated for ' + date : 'Production saved for ' + date + ' — ' + fmt(pieces) + ' pieces ready to sell.');
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
  updateUsageCosts();
}

$('saveLogBtn').addEventListener('click', saveProduction);

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
    return '<tr class="border-b border-gray-800">' +
      '<td class="py-2 pr-2 whitespace-nowrap">' + esc(p.date) + '</td>' +
      '<td class="py-2 pr-2 text-amber-400 font-semibold">' + fmtKs(p.capital) + '</td>' +
      '<td class="py-2 pr-2">' + fmt(p.bags) + '</td>' +
      '<td class="py-2 pr-2">' + fmt(p.pieces) + '</td>' +
      '<td class="py-2 pr-2">' + (p.bags > 0 ? (p.pieces / p.bags).toFixed(1) : '—') + '</td>' +
      '<td class="py-2 pr-2">' + ((p.laborMinutes || 0) / 60).toFixed(2) + '</td>' +
      '<td class="py-2 pr-2 text-gray-400">' + fmtKs(p.costPerPiece || 0) + '/pc</td>' +
      '<td class="py-2"><div class="flex gap-2">' +
      '<button onclick="editProduction(\'' + p.id + '\')" class="text-amber-400 hover:text-amber-300 transition" title="Edit"><i data-lucide="pencil" class="w-4 h-4"></i></button>' +
      '<button onclick="deleteProduction(\'' + p.id + '\')" class="text-red-400 hover:text-red-300 transition" title="Delete"><i data-lucide="trash-2" class="w-4 h-4"></i></button>' +
      '</div></td></tr>';
  }).join('');
  lucide.createIcons();
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
  if (p.usage) {
    state.prices.forEach(function (ing) {
      var used = parseFloat(p.usage[ing.name]) || 0;
      if (used > 0 && state.inventory[ing.name]) {
        state.inventory[ing.name].stock = (state.inventory[ing.name].stock || 0) + used;
      }
    });
  }
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