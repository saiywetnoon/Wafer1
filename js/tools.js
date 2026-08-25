/* ============================================================
   BUSINESS TOOLS
   ============================================================ */
function renderTools() {
  renderRecipes();
  renderBreakEven();
  renderWaste();
  renderPriceHistory();
  renderExpenses();
  renderRecurring();
  renderForecast();
}

/* ---------- Recipes ---------- */
function renderRecipes() {
  const list = $('recipeList');
  const recipes = state.recipes || [];
  if (!recipes.length) { list.innerHTML = '<div class="text-xs text-gray-500">No recipes saved yet. Fill the usage form, then click "Save Current".</div>'; return; }
  list.innerHTML = recipes.map(function (r, i) {
    return '<div class="flex items-center justify-between gap-2 p-2 rounded-lg bg-gray-800/50 border border-gray-700">' +
      '<span class="text-sm font-semibold">' + esc(r.name) + '</span>' +
      '<div class="flex gap-1">' +
      '<button onclick="applyRecipe(' + i + ')" class="px-2 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-[10px] font-bold">Apply</button>' +
      '<button onclick="deleteRecipe(' + i + ')" class="px-2 py-1 rounded bg-red-600 hover:bg-red-500 text-white text-[10px] font-bold">Del</button>' +
      '</div></div>';
  }).join('');
}

$('saveRecipeBtn').addEventListener('click', function () {
  const name = $('recipeName').value.trim();
  if (!name) { showToast('Enter a recipe name.', 'error'); return; }
  if (!state.recipes) state.recipes = [];
  state.recipes.push({ name: name, usage: Object.assign({}, currentUsage()) });
  saveState();
  renderRecipes();
  $('recipeName').value = '';
  showToast('Recipe "' + name + '" saved.');
});

function applyRecipe(idx) {
  const r = (state.recipes || [])[idx];
  if (!r) return;
  draftUsage = Object.assign({}, r.usage);
  state.prices.forEach(function (ing) {
    const input = document.querySelector('.usage-input[data-name="' + ing.name + '"]');
    if (input) input.value = r.usage[ing.name] || 0;
  });
  updateUsageCosts();
  showToast('Recipe "' + r.name + '" applied to the form.');
}

function deleteRecipe(idx) {
  if (!confirm('Delete this recipe?')) return;
  state.recipes.splice(idx, 1);
  saveState();
  renderRecipes();
}

/* ---------- Break-even ---------- */
function renderBreakEven() {
  const usage = currentUsage();
  const capital = ingredientCostFor(usage) + (parseFloat($('additionalCost').value) || 0);
  const laborMin = parseFloat($('logLabor').value) || 0;
  const wage = parseFloat($('hourlyWage').value) || state.settings.hourlyWage || 0;
  const laborCost = (laborMin / 60) * wage;
  const price = parseFloat($('logPrice').value) || 1300;
  $('beCapital').textContent = fmtKs(capital);
  $('beLabor').textContent = fmtKs(laborCost);
  $('bePrice').textContent = fmtKs(price);
  $('beBags').textContent = price > 0 ? Math.ceil(capital / price) : 0;
  $('beBagsLabor').textContent = price > 0 ? Math.ceil((capital + laborCost) / price) : 0;
}

/* ---------- Waste / Scrap ---------- */
function renderWaste() {
  const list = $('wasteList');
  const waste = state.waste || [];
  if (!waste.length) { list.textContent = 'No waste logged yet.'; return; }
  list.innerHTML = waste.slice().reverse().map(function (w) {
    return '<div class="flex justify-between py-1 border-b border-gray-700 last:border-0"><span>' + esc(w.date) + '</span><span class="text-red-400 font-semibold">' + fmt(w.qty) + ' pcs</span></div>';
  }).join('');
}

$('addWasteBtn').addEventListener('click', function () {
  const date = $('wasteDate').value || today();
  const qty = parseFloat($('wasteQty').value);
  if (isNaN(qty) || qty < 0) { showToast('Enter a valid quantity.', 'error'); return; }
  if (!state.waste) state.waste = [];
  state.waste.push({ date: date, qty: qty });
  saveState();
  renderWaste();
  $('wasteQty').value = '';
  showToast('Waste logged for ' + date + '.');
});

/* ---------- Price History ---------- */
function renderPriceHistory() {
  const list = $('priceHistoryList');
  const history = state.priceHistory || [];
  if (!history.length) { list.textContent = 'Price changes will appear here as you edit the price list.'; return; }
  list.innerHTML = history.slice().reverse().map(function (h) {
    return '<div class="flex justify-between py-1 border-b border-gray-700 last:border-0"><span>' + esc(h.date) + ' · ' + esc(h.name) + '</span><span class="text-amber-400">' + fmtKs(h.old) + ' → ' + fmtKs(h.new) + '</span></div>';
  }).join('');
}

/* ---------- Expenses ---------- */
function renderExpenses() {
  const list = $('expenseList');
  const expenses = state.expenses || [];
  if (!expenses.length) { list.textContent = 'No one-time expenses recorded.'; return; }
  const total = expenses.reduce(function (s, e) { return s + (e.amount || 0); }, 0);
  list.innerHTML = expenses.slice().reverse().map(function (e) {
    return '<div class="flex justify-between py-1 border-b border-gray-700 last:border-0"><span>' + esc(e.date) + ' · ' + esc(e.desc) + '</span><span class="text-red-400 font-semibold">' + fmtKs(e.amount) + '</span></div>';
  }).join('') + '<div class="flex justify-between pt-2 font-bold"><span>Total</span><span class="text-red-400">' + fmtKs(total) + '</span></div>';
}

$('addExpenseBtn').addEventListener('click', function () {
  const date = $('expenseDate').value || today();
  const amount = parseFloat($('expenseAmount').value);
  const desc = $('expenseDesc').value.trim();
  if (isNaN(amount) || amount <= 0) { showToast('Enter a valid amount.', 'error'); return; }
  if (!desc) { showToast('Enter a description.', 'error'); return; }
  if (!state.expenses) state.expenses = [];
  state.expenses.push({ date: date, amount: amount, desc: desc });
  saveState();
  renderExpenses();
  $('expenseAmount').value = '';
  $('expenseDesc').value = '';
  showToast('Expense added.');
});

/* ---------- Recurring Monthly Expenses ---------- */
function renderRecurring() {
  const list = $('recurringList');
  if (!list) return;
  const fixed = state.recurringExpenses || [];
  const total = fixed.reduce(function (s, r) { return s + (r.amount || 0); }, 0);
  list.innerHTML = fixed.length ? fixed.map(function (r) {
    return '<div class="flex items-center justify-between gap-2 py-1.5 border-b border-gray-700 last:border-0">' +
      '<span class="truncate text-xs">' + esc(r.name) + '</span>' +
      '<span class="flex items-center gap-2 shrink-0"><span class="font-semibold text-red-400">' + fmtKs(r.amount) + '/mo</span>' +
      '<button onclick="removeRecurring(\'' + r.id + '\')" class="text-red-500 hover:text-red-400" title="Remove"><i data-lucide="trash-2" class="w-3.5 h-3.5"></i></button></span></div>';
  }).join('') + '<div class="flex justify-between pt-2 font-bold text-xs"><span>Total fixed / month</span><span class="text-red-400">' + fmtKs(total) + '</span></div>'
    : '<div class="text-gray-500">No recurring costs added. Add rent, internet, or other fixed monthly bills here.</div>';
  lucide.createIcons();
}

$('addRecurringBtn').addEventListener('click', function () {
  const name = $('recurringName').value.trim();
  const amount = parseFloat($('recurringAmount').value);
  if (!name) { showToast('Enter a name (e.g. Rent).', 'error'); return; }
  if (isNaN(amount) || amount <= 0) { showToast('Enter a valid monthly amount.', 'error'); return; }
  if (!state.recurringExpenses) state.recurringExpenses = [];
  state.recurringExpenses.push({ id: uid(), name: name, amount: Math.round(amount) });
  saveState();
  renderRecurring();
  $('recurringName').value = '';
  $('recurringAmount').value = '';
  showToast('Recurring expense "' + name + '" added.');
});

function removeRecurring(id) {
  if (!confirm('Remove this recurring expense?')) return;
  state.recurringExpenses = (state.recurringExpenses || []).filter(function (r) { return r.id !== id; });
  saveState();
  renderRecurring();
}

/* ---------- Forecast ---------- */
function renderForecast() {
  const box = $('forecastBox');
  const entries = entriesSorted();
  if (entries.length < 3) { box.innerHTML = '<span class="text-gray-500">Add at least 3 days of data to see a sales forecast.</span>'; return; }
  const recent = entries.slice(-7);
  const avgSold = recent.reduce(function (s, e) { return s + (e.bagsSold || 0); }, 0) / recent.length;
  const avgProd = recent.reduce(function (s, e) { return s + (e.bagsProduced || 0); }, 0) / recent.length;
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const off = tomorrow.getTimezoneOffset();
  const tStr = new Date(tomorrow.getTime() - off * 60000).toISOString().slice(0, 10);
  box.innerHTML =
    '<div class="flex justify-between"><span class="text-gray-400">Forecast for ' + tStr + '</span><span class="font-bold text-emerald-400">~' + Math.round(avgSold) + ' bags sold</span></div>' +
    '<div class="flex justify-between mt-1"><span class="text-gray-400">Suggested production</span><span class="font-bold text-amber-400">~' + Math.round(avgProd) + ' bags</span></div>' +
    '<div class="flex justify-between mt-1"><span class="text-gray-400">7-day avg sold</span><span class="font-bold">' + fmt(Math.round(avgSold)) + ' bags</span></div>';
}

/* ---------- Printable Report ---------- */
$('printReportBtn').addEventListener('click', function () {
  const entries = entriesSorted();
  if (!entries.length) { showToast('No data to print.', 'info'); return; }
  const w = window.open('', '_blank');
  w.document.write('<html><head><title>Crispy Roll Ledger Report</title><style>body{font-family:Arial,sans-serif;padding:20px;color:#111}h1{color:#B45309}table{width:100%;border-collapse:collapse;margin-top:10px}th,td{border:1px solid #ccc;padding:6px 8px;text-align:left;font-size:12px}th{background:#f5f5f5}.pos{color:#059669;font-weight:bold}.neg{color:#dc2626;font-weight:bold}</style></head><body>');
  w.document.write('<h1>Daily Crispy Roll Ledger Report</h1>');
  w.document.write('<p>Generated: ' + new Date().toLocaleString() + '</p>');
  w.document.write('<table><tr><th>Date</th><th>Capital</th><th>Bags</th><th>Pieces</th><th>Sold</th><th>Revenue</th><th>Labor Hrs</th><th>Net</th></tr>');
  entries.forEach(function (e) {
    w.document.write('<tr><td>' + e.date + '</td><td>' + fmtKs(e.capital) + '</td><td>' + fmt(e.bagsProduced) + '</td><td>' + fmt(e.pieces) + '</td><td>' + fmt(e.bagsSold) + '</td><td>' + fmtKs(e.revenue) + '</td><td>' + ((e.laborMinutes || 0) / 60).toFixed(2) + '</td><td class="' + (e.net >= 0 ? 'pos' : 'neg') + '">' + fmtKs(e.net) + '</td></tr>');
  });
  w.document.write('</table></body></html>');
  w.document.close();
  w.print();
});

$('exportMonthlyCsvBtn').addEventListener('click', function () {
  const entries = entriesSorted();
  if (!entries.length) { showToast('No data to export.', 'info'); return; }
  const header = ['Date', 'Capital (Ks)', 'Bags Produced', 'Pieces', 'Bags Sold', 'Revenue (Ks)', 'Labor Hrs', 'Net (Ks)'];
  const lines = [header.join(',')];
  entries.forEach(function (e) {
    lines.push([e.date, e.capital, e.bagsProduced, e.pieces, e.bagsSold, e.revenue, ((e.laborMinutes || 0) / 60).toFixed(2), e.net].join(','));
  });
  const blob = new Blob(['\uFEFF' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'crispy-roll-report-' + today() + '.csv';
  a.click();
  URL.revokeObjectURL(a.href);
  showToast('Report exported to CSV.');
});

