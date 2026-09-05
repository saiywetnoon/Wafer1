/* ============================================================
   INVENTORY — movement-ledger based
   ============================================================ */
function inventoryMovementLabel(type) {
  return {
    opening: 'Opening balance', purchase: 'Purchase', production: 'Production used',
    production_reversal: 'Production returned', adjustment: 'Manual adjustment',
    ingredient_waste: 'Ingredient waste'
  }[type] || 'Adjustment';
}

function renderIngredientWasteOptions() {
  const select = $('ingredientWasteItem');
  if (!select) return;
  const selected = select.value;
  select.innerHTML = '<option value="">Choose ingredient…</option>' + state.prices.filter(isStockItem).map(function (ing) {
    return '<option value="' + esc(ing.name) + '">' + esc(ing.name) + ' (' + (ing.unit === 'g' ? 'g' : 'units') + ')</option>';
  }).join('');
  select.value = selected || '';
  if ($('ingredientWasteDate') && !$('ingredientWasteDate').value) $('ingredientWasteDate').value = today();
}

function renderInventoryMovements() {
  const list = $('inventoryMovementList');
  if (!list) return;
  const movements = (state.inventoryMovements || []).slice().sort(function (a, b) {
    const byDate = String(b.date || '').localeCompare(String(a.date || ''));
    return byDate || String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
  }).slice(0, 12);
  if (!movements.length) {
    list.textContent = 'No movements yet. Purchases, production use, and manual adjustments will appear here.';
    return;
  }
  list.innerHTML = movements.map(function (m) {
    const plus = (m.qty || 0) >= 0;
    const ingredient = priceItemByName(m.ingredientName);
    const unit = ingredient && ingredient.unit === 'g' ? 'g' : 'units';
    return '<div class="flex items-center justify-between gap-3 py-2 border-b border-gray-800 last:border-0">' +
      '<div class="min-w-0"><div class="text-xs font-semibold text-gray-200">' + esc(m.ingredientName) +
      ' <span class="text-gray-500 font-normal">· ' + esc(inventoryMovementLabel(m.type)) + '</span></div>' +
      '<div class="text-[10px] text-gray-500">' + esc(m.date || '') + (m.reason ? ' · ' + esc(m.reason) : '') + '</div></div>' +
      '<div class="shrink-0 text-xs font-bold ' + (plus ? 'text-emerald-400' : 'text-red-400') + '">' +
      (plus ? '+' : '') + fmt(m.qty) + ' ' + unit + '</div></div>';
  }).join('');
wireResponsiveTables();
}

function renderInventory() {
  const tbody = $('inventoryBody');
  const lowItems = [];
  tbody.innerHTML = state.prices.filter(isStockItem).map(function (ing) {
    const item = ensureInventoryItem(ing.name);
    const stock = syncInventorySnapshot(ing.name);
    const unit = ing.unit === 'g' ? 'g' : 'units';
    const status = stock <= 0 ? '<span class="text-red-400 font-bold">OUT</span>'
      : stock <= item.lowAlert ? '<span class="text-amber-400 font-bold">LOW</span>'
      : '<span class="text-emerald-400">OK</span>';
    if (stock <= item.lowAlert) lowItems.push(ing.name + ' (' + fmt(stock) + ' ' + unit + ')');
    return '<tr class="border-b border-gray-800">' +
      '<td class="py-2 pr-2 font-medium">' + esc(ing.name) + '</td>' +
      '<td class="py-2 pr-2 text-gray-500">' + unit + '</td>' +
      '<td class="py-2 pr-2"><input type="number" min="0" step="0.01" value="' + esc(stock) + '" data-name="' + esc(ing.name) + '" class="stock-input w-24 px-1.5 py-1 rounded border border-gray-700 bg-gray-800 text-xs text-right focus:outline-none focus:ring-1 focus:ring-amber-500"></td>' +
      '<td class="py-2 pr-2"><input type="number" min="0" step="0.01" value="' + esc(item.lowAlert) + '" data-name="' + esc(ing.name) + '" class="low-input w-20 px-1.5 py-1 rounded border border-gray-700 bg-gray-800 text-xs text-right focus:outline-none focus:ring-1 focus:ring-amber-500"></td>' +
      '<td class="py-2 pr-2">' + status + '</td>' +
      '<td class="py-2"><div class="flex gap-2">' +
      '<button data-add-stock="' + esc(ing.name) + '" class="add-stock-btn text-emerald-500 hover:text-emerald-400" title="Add stock"><i data-lucide="plus" class="w-3.5 h-3.5"></i></button>' +
      '<button data-remove-stock="' + esc(ing.name) + '" class="remove-stock-btn text-red-500 hover:text-red-400" title="Remove from stock"><i data-lucide="trash-2" class="w-3.5 h-3.5"></i></button>' +
      '</div></td>' +
      '</tr>';
  }).join('');
  document.querySelectorAll('.stock-input').forEach(function (inp) {
    inp.addEventListener('change', async function () {
      const name = inp.dataset.name;
      const target = parseFloat(inp.value);
      if (isNaN(target) || target < 0) { renderInventory(); return; }
      const current = inventoryStockFor(name);
      const difference = target - current;
      if (!difference) return;
      const reason = await Modal.prompt({
        title: 'Stock adjustment',
        message: 'Reason for changing ' + name + ' stock?',
        value: 'Stock count correction',
        validate: function (v) { return (v || '').trim() ? '' : 'A reason is required.'; }
      });
      if (reason === null || !reason.trim()) { renderInventory(); return; }
      recordInventoryMovement({ ingredientName: name, qty: difference, type: 'adjustment', reason: reason.trim() });
      saveState();
      renderInventory();
    });
  });
  document.querySelectorAll('.low-input').forEach(function (inp) {
    inp.addEventListener('change', function () {
      const item = ensureInventoryItem(inp.dataset.name);
      item.lowAlert = Math.max(0, parseFloat(inp.value) || 0);
      saveState();
      renderInventory();
    });
  });
  document.querySelectorAll('.add-stock-btn').forEach(function (btn) {
    btn.addEventListener('click', function () { addStockFor(btn.dataset.addStock); });
  });
  document.querySelectorAll('.remove-stock-btn').forEach(function (btn) {
    btn.addEventListener('click', function () { removeStockItem(btn.dataset.removeStock); });
  });
  const alertEl = $('lowStockAlert');
  if (lowItems.length) {
    alertEl.classList.remove('hidden');
    alertEl.textContent = '⚠ Low / Out of stock: ' + lowItems.join(', ') + '. Consider restocking before next production.';
  } else alertEl.classList.add('hidden');
  const ivEl = $('inventoryValue');
  if (ivEl) ivEl.textContent = fmtKs(Math.round(inventoryValue()));
  renderIngredientWasteOptions();
  renderInventoryMovements();
  lucide.createIcons();
}

async function addStockFor(name) {
  if (!priceItemByName(name)) { showToast('Choose an ingredient from the Price List first.', 'error'); return; }
  // Re-adding stock brings an item (previously removed) back into stock tracking.
  const ing = priceItemByName(name);
  if (ing && ing.stock === false) ing.stock = true;
  const qty = await Modal.prompt({
    title: 'Add stock',
    message: 'Add stock for "' + name + '":',
    inputType: 'number',
    validate: function (v) { return toFinite(v) > 0 ? '' : 'Enter a valid positive number.'; }
  });
  if (qty === null || qty === '') return;
  const value = toFinite(qty);
  if (value <= 0) { showToast('Enter a valid positive number.', 'error'); return; }
  const reason = await Modal.prompt({
    title: 'Reason',
    message: 'Reason for this stock addition:',
    value: 'Manual stock addition',
    validate: function (v) { return (v || '').trim() ? '' : 'A reason is required.'; }
  });
  if (reason === null || !reason.trim()) return;
  recordInventoryMovement({ ingredientName: name, qty: value, type: 'adjustment', reason: reason.trim() });
  saveState();
  renderInventory();
  showToast('Added ' + fmt(value) + ' to ' + name + ' stock.');
}

async function removeStockItem(name) {
  const ing = priceItemByName(name);
  const label = ing ? ing.name : name;
  const ok = await Modal.confirm({
    title: 'Remove from stock?',
    message: 'Remove "' + label + '" from stock?\n\nIts stock history (movements) will be cleared and it will be treated as a daily-usage item (like water / electricity). It stays in your Price List and Usage table, and you can bring it back later with "Add Stock".',
    danger: true,
    okLabel: 'Remove'
  });
  if (!ok) return;
  if (state.inventory) delete state.inventory[name];
  state.inventoryMovements = (state.inventoryMovements || []).filter(function (m) { return m.ingredientName !== name; });
  if (ing) ing.stock = false;
  saveState();
  renderInventory();
  showToast('"' + label + '" removed from stock (kept as daily usage). Use Add Stock to restore it.');
}

$('addStockBtn').addEventListener('click', async function () {
  const name = await Modal.prompt({ title: 'Add stock', message: 'Which ingredient to add stock for?' });
  if (!name) return;
  addStockFor(name.trim());
});

$('addIngredientWasteBtn').addEventListener('click', function () {
  const name = $('ingredientWasteItem').value;
  const qty = parseFloat($('ingredientWasteQty').value);
  const date = $('ingredientWasteDate').value || today();
  const reason = $('ingredientWasteReason').value.trim();
  if (!name) { showToast('Choose the wasted ingredient.', 'error'); return; }
  if (isNaN(qty) || qty <= 0) { showToast('Enter a valid waste quantity.', 'error'); return; }
  if (!reason) { showToast('Enter the reason for this ingredient waste.', 'error'); return; }
  const available = inventoryStockFor(name);
  if (qty > available) {
    showToast('Not enough ' + name + ' in stock. Available: ' + fmt(available) + '.', 'error');
    return;
  }
  recordInventoryMovement({ date: date, ingredientName: name, qty: -qty,
    type: 'ingredient_waste', reason: reason });
  saveState();
  $('ingredientWasteQty').value = '';
  $('ingredientWasteReason').value = '';
  renderInventory();
  showToast('Ingredient waste recorded.');
});
