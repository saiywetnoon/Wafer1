/* ============================================================
   PRICE LIST
   ============================================================ */
function renderPriceTable() {
  const tbody = $('priceTable');
  tbody.innerHTML = state.prices.map(function (ing, idx) {
    const per = ing.unit === 'g' ? 'per kg' : 'per unit';
    const wpu = ing.unit === 'unit'
      ? '<input type="number" min="0" step="0.01" value="' + esc(ing.weightPerUnit != null ? ing.weightPerUnit : '') + '" data-idx="' + idx + '" data-field="weightPerUnit" placeholder="" class="price-input w-16 px-1.5 py-1 rounded border border-gray-700 bg-gray-800 text-xs text-right focus:outline-none focus:ring-1 focus:ring-amber-500">'
      : '<span class="text-gray-600">—</span>';
    const delBtn = '<button onclick="removeIngredientAt(' + idx + ')" class="text-red-500 hover:text-red-400 ml-1 opacity-0 group-hover:opacity-100 transition" title="Remove ingredient"><i data-lucide="trash-2" class="w-3.5 h-3.5"></i></button>';
    return '<tr class="border-b border-gray-800 group">' +
      '<td class="py-1.5 pr-2 font-medium">' + esc(ing.name) + ' ' + delBtn + '</td>' +
      '<td class="py-1.5 pr-2 text-gray-500">' + per + '</td>' +
      '<td class="py-1.5 pr-2"><input type="number" min="0" step="10" value="' + esc(ing.price) + '" data-idx="' + idx + '" data-field="price" class="price-input w-24 px-1.5 py-1 rounded border border-gray-700 bg-gray-800 text-xs text-right focus:outline-none focus:ring-1 focus:ring-amber-500"></td>' +
      '<td class="py-1.5 pr-2">' + wpu + '</td>' +
      '<td class="py-1.5"><input type="text" value="' + esc(ing.remark) + '" data-idx="' + idx + '" data-field="remark" placeholder="note..." class="price-input w-full min-w-[70px] px-1.5 py-1 rounded border border-gray-700 bg-gray-800 text-xs focus:outline-none focus:ring-1 focus:ring-amber-500"></td>' +
      '</tr>';
  }).join('');
  document.querySelectorAll('.price-input').forEach(function (inp) {
    inp.addEventListener('change', function () {
      const idx = parseInt(inp.dataset.idx, 10);
      const field = inp.dataset.field;
      const oldVal = state.prices[idx][field];
      if (field === 'price' || field === 'weightPerUnit') {
        const v = parseFloat(inp.value);
        const newVal = (!isNaN(v) && v >= 0) ? v : (inp.value === '' ? null : oldVal);
        if (newVal !== oldVal) {
          // Record price change into history (only for price field)
          if (field === 'price' && oldVal !== null && newVal !== null) {
            if (!state.priceHistory) state.priceHistory = [];
            state.priceHistory.push({
              date: today(),
              name: state.prices[idx].name,
              old: oldVal,
              new: newVal
            });
          }
          state.prices[idx][field] = newVal;
          inp.value = newVal === null ? '' : newVal;
          persistState();
          updateUsageCosts();
        }
      } else {
        state.prices[idx].remark = inp.value;
        persistState();
      }
    });
  });
wireResponsiveTables();
}

/* ---------- Add / Remove Ingredient ---------- */
function addIngredientRow() {
  const name = prompt('New ingredient name:', '');
  if (!name || !name.trim()) return;
  const trimmed = name.trim();
  if (state.prices.some(function (p) { return p.name.toLowerCase() === trimmed.toLowerCase(); })) {
    showToast('Ingredient "' + trimmed + '" already exists.', 'error');
    return;
  }
  const unitPrompt = confirm('Is "' + trimmed + '" counted by unit (e.g. eggs, bags)? Click OK for unit-based. Cancel for gram-based (per kg).');
  const ing = {
    name: trimmed,
    unit: unitPrompt ? 'unit' : 'g',
    price: 0,
    weightPerUnit: unitPrompt ? 1 : null,
    remark: unitPrompt ? 'per unit' : ''
  };
  state.prices.push(ing);
  saveState();
  renderPriceTable();
  renderUsageTable();
  updateUsageCosts();
  triggerGoogleSync();
  showToast('Added ingredient "' + trimmed + '".');
}
function removeIngredientAt(idx) {
  const ing = state.prices[idx];
  if (!ing) return;
  if (!confirm('Remove ingredient "' + ing.name + '"? Past entries keep their historical usage data.')) return;
  state.prices.splice(idx, 1);
  saveState();
  renderPriceTable();
  renderUsageTable();
  updateUsageCosts();
  triggerGoogleSync();
  showToast('Removed "' + ing.name + '".');
}

$('addIngredientBtn').addEventListener('click', addIngredientRow);

$('resetPricesBtn').addEventListener('click', function () {
  if (!confirm('Reset all ingredient prices to Phase 10 defaults?')) return;
  state.prices = JSON.parse(JSON.stringify(DEFAULT_PRICES));
  saveState();
  renderPriceTable();
  updateUsageCosts();
  showToast('Prices reset to defaults.');
});

$('exportPricesBtn').addEventListener('click', function () {
  const blob = new Blob(['\uFEFF' + JSON.stringify(state.prices, null, 2)], { type: 'application/json;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'crispy-roll-prices-' + today() + '.json';
  a.click();
  URL.revokeObjectURL(a.href);
  showToast('Price list exported.');
});

$('importPricesBtn').addEventListener('click', function () {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json';
  input.onchange = function () {
    const file = input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function () {
      try {
        const parsed = JSON.parse(reader.result);
        if (!Array.isArray(parsed)) { showToast('Invalid price backup file.', 'error'); return; }
        state.prices = parsed;
        saveState();
        renderPriceTable();
        updateUsageCosts();
        showToast('Price list imported.');
      } catch (e) {
        showToast('Could not parse backup file.', 'error');
      }
    };
    reader.readAsText(file);
  };
  input.click();
});

