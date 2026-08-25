/* ============================================================
   INVENTORY
   ============================================================ */
function renderInventory() {
  const tbody = $('inventoryBody');
  const inv = state.inventory || {};
  const lowItems = [];
  tbody.innerHTML = state.prices.map(function (ing) {
    const item = inv[ing.name] || { stock: 0, lowAlert: 0 };
    const unit = ing.unit === 'g' ? 'g' : 'units';
    const status = item.stock <= 0 ? '<span class="text-red-400 font-bold">OUT</span>'
      : item.stock <= item.lowAlert ? '<span class="text-amber-400 font-bold">LOW</span>'
      : '<span class="text-emerald-400">OK</span>';
    if (item.stock <= item.lowAlert) lowItems.push(ing.name + ' (' + fmt(item.stock) + ' ' + unit + ')');
    return '<tr class="border-b border-gray-800">' +
      '<td class="py-2 pr-2 font-medium">' + esc(ing.name) + '</td>' +
      '<td class="py-2 pr-2 text-gray-500">' + unit + '</td>' +
      '<td class="py-2 pr-2"><input type="number" min="0" step="1" value="' + esc(item.stock) + '" data-name="' + esc(ing.name) + '" class="stock-input w-24 px-1.5 py-1 rounded border border-gray-700 bg-gray-800 text-xs text-right focus:outline-none focus:ring-1 focus:ring-amber-500"></td>' +
      '<td class="py-2 pr-2"><input type="number" min="0" step="1" value="' + esc(item.lowAlert) + '" data-name="' + esc(ing.name) + '" class="low-input w-20 px-1.5 py-1 rounded border border-gray-700 bg-gray-800 text-xs text-right focus:outline-none focus:ring-1 focus:ring-amber-500"></td>' +
      '<td class="py-2 pr-2">' + status + '</td>' +
      '<td class="py-2"><button onclick="addStockFor(\'' + esc(ing.name).replace(/'/g, "\\'") + '\')" class="text-emerald-500 hover:text-emerald-400" title="Add stock"><i data-lucide="plus" class="w-3.5 h-3.5"></i></button></td>' +
      '</tr>';
  }).join('');
  document.querySelectorAll('.stock-input').forEach(function (inp) {
    inp.addEventListener('change', function () {
      const name = inp.dataset.name;
      if (!state.inventory[name]) state.inventory[name] = { stock: 0, lowAlert: 0 };
      state.inventory[name].stock = parseFloat(inp.value) || 0;
      saveState();
      renderInventory();
    });
  });
  document.querySelectorAll('.low-input').forEach(function (inp) {
    inp.addEventListener('change', function () {
      const name = inp.dataset.name;
      if (!state.inventory[name]) state.inventory[name] = { stock: 0, lowAlert: 0 };
      state.inventory[name].lowAlert = parseFloat(inp.value) || 0;
      saveState();
      renderInventory();
    });
  });
  const alertEl = $('lowStockAlert');
  if (lowItems.length) {
    alertEl.classList.remove('hidden');
    alertEl.textContent = '⚠ Low / Out of stock: ' + lowItems.join(', ') + '. Consider restocking before next production.';
  } else {
    alertEl.classList.add('hidden');
  }
  const ivEl = $('inventoryValue');
  if (ivEl) ivEl.textContent = fmtKs(Math.round(inventoryValue()));
  lucide.createIcons();
}

function addStockFor(name) {
  const qty = prompt('Add stock for "' + name + '":', '');
  if (qty === null || qty === '') return;
  const v = parseFloat(qty);
  if (isNaN(v) || v < 0) { showToast('Enter a valid positive number.', 'error'); return; }
  if (!state.inventory[name]) state.inventory[name] = { stock: 0, lowAlert: 0 };
  state.inventory[name].stock = (state.inventory[name].stock || 0) + v;
  saveState();
  renderInventory();
  showToast('Added ' + fmt(v) + ' to ' + name + ' stock.');
}

$('addStockBtn').addEventListener('click', function () {
  const name = prompt('Which ingredient to add stock for?', '');
  if (!name) return;
  addStockFor(name.trim());
});

