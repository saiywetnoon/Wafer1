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
  renderTargetProfit();
  renderPurchaseList();
  renderPurchaseDays();
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
      '<button onclick="scaleRecipe(' + i + ')" class="px-2 py-1 rounded bg-amber-500 hover:bg-amber-400 text-gray-900 text-[10px] font-bold" title="Scale to a target batch size">Scale</button>' +
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

/* ---------- Scale a recipe to a target batch ---------- */
function recipeTotalPieces(usage) {
  return (state.prices || []).reduce(function (sum, ing) {
    const qty = parseFloat(usage[ing.name]) || 0;
    return sum + (ing.unit === 'g' ? qty : qty * (parseFloat(ing.weightPerUnit) || 0));
  }, 0);
}
function scaleRecipe(idx) {
  const r = (state.recipes || [])[idx];
  if (!r) return;
  const baseMix = recipeTotalPieces(r.usage);
  if (baseMix <= 0) { showToast('Recipe has no measurable ingredients.', 'error'); return; }
  const target = prompt('Target finished pieces for "' + r.name + '"?', String(Math.round(baseMix / 6) * 6));
  if (target === null) return;
  const pieces = parseFloat(target);
  if (isNaN(pieces) || pieces <= 0) { showToast('Enter a valid number of pieces.', 'error'); return; }
  const factor = pieces / baseMix;
  const scaled = {};
  (state.prices || []).forEach(function (ing) {
    scaled[ing.name] = Math.round((parseFloat(r.usage[ing.name]) || 0) * factor);
  });
  draftUsage = scaled;
  state.prices.forEach(function (ing) {
    const input = document.querySelector('.usage-input[data-name="' + ing.name + '"]');
    if (input) input.value = scaled[ing.name] || 0;
  });
  $('logPieces').value = Math.round(pieces);
  $('logBagsProduced').value = Math.round(pieces / 6) || '';
  updateUsageCosts();
  document.querySelector('[data-tab="log"]').click();
  showToast('Scaled "' + r.name + '" to ' + fmt(pieces) + ' pcs → Production form updated.');
}

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
  const sales = salesList();
  const price = (sales.length ? (sales[sales.length - 1].price || 1300) : 1300);
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
    return '<div class="flex justify-between py-1 border-b border-gray-700 last:border-0"><span>' + esc(w.date) + '</span><span class="text-red-400 font-semibold">' + fmt(w.qty) + ' pcs · ' + fmtKs(w.cost || 0) + '</span></div>';
  }).join('');
}

$('addWasteBtn').addEventListener('click', function () {
  const date = $('wasteDate').value || today();
  const qty = parseFloat($('wasteQty').value);
  if (isNaN(qty) || qty <= 0) { showToast('Enter a valid quantity.', 'error'); return; }
  const record = { id: uid(), date: date, qty: Math.round(qty) };
  const shortage = canRecordWaste(record);
  if (shortage) {
    showToast('Not enough finished stock on ' + shortage.date + '. Available: ' + fmt(shortage.available) + ' pieces; waste is ' + fmt(shortage.requested) + '.', 'error');
    return;
  }
  if (!state.waste) state.waste = [];
  state.waste.push(record);
  rebuildStockAndCogs();
  saveState();
  renderAll();
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
  const entries = entriesProdSales();
  if (entries.length < 3) { box.innerHTML = '<span class="text-gray-500">Add at least 3 days of data to see a sales forecast.</span>'; return; }
  const recent = entries.slice(-7);
  const avgSold = recent.reduce(function (s, e) { return s + (e.soldBags || 0); }, 0) / recent.length;
  const avgProd = recent.reduce(function (s, e) { return s + (e.prodBags || 0); }, 0) / recent.length;
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const off = tomorrow.getTimezoneOffset();
  const tStr = new Date(tomorrow.getTime() - off * 60000).toISOString().slice(0, 10);
  box.innerHTML =
    '<div class="flex justify-between"><span class="text-gray-400">Forecast for ' + tStr + '</span><span class="font-bold text-emerald-400">~' + Math.round(avgSold) + ' bags sold</span></div>' +
    '<div class="flex justify-between mt-1"><span class="text-gray-400">Suggested production</span><span class="font-bold text-amber-400">~' + Math.round(avgProd) + ' bags</span></div>' +
    '<div class="flex justify-between mt-1"><span class="text-gray-400">7-day avg sold</span><span class="font-bold">' + fmt(Math.round(avgSold)) + ' bags</span></div>';
}

/* ---------- Target-Profit Calculator ----------
   Answers: to make a desired profit, how many rolls / bags must I produce
   (and sell) today? Works backwards from the live production cost:
     bags = ceil((capital + labor + targetProfit) / pricePerBag)
     pieces = bags × piecesPerBag (from actual production history, default 6)
   Also factors standing orders so the number is realistic. */
function targetProfitBags(target, capital, laborCost, priceBag, perBag) {
  if (!(priceBag > 0)) return { bags: 0, pieces: 0 };
  const bags = Math.ceil((capital + laborCost + target) / priceBag);
  return { bags: bags, pieces: bags * perBag };
}

function renderTargetProfit() {
  const usage = currentUsage();
  const capital = ingredientCostFor(usage) + (parseFloat($('additionalCost').value) || 0);
  const wage = parseFloat($('hourlyWage').value) || state.settings.hourlyWage || 0;
  const laborMin = parseFloat($('logLabor').value) || 0;
  const laborCost = (laborMin / 60) * wage;
  const priceBag = lastSalePrice();
  const perBag = stockAvgPiecesPerBag() || 6;

  const target = parseFloat(($('targetProfitGoal') || {}).value) || 0;
  const breakEven = capital + laborCost;
  const goalTotal = breakEven + target;
  const r = targetProfitBags(target, capital, laborCost, priceBag, perBag);
  const bagsForProfit = r.bags, piecesForProfit = r.pieces;
  const standing = totalStandingOrders();
  const afterStanding = Math.max(0, bagsForProfit - standing);

  const el = $('targetProfitResult');
  if (!el) return;
  el.innerHTML =
    '<div class="grid grid-cols-2 sm:grid-cols-3 gap-2 text-sm">' +
      '<div><div class="text-[10px] text-gray-500">Cover costs (break-even)</div><div class="font-bold text-amber-400">' + fmtKs(breakEven) + '</div></div>' +
      '<div><div class="text-[10px] text-gray-500">Bag price</div><div class="font-bold text-emerald-400">' + fmtKs(priceBag) + '</div></div>' +
      '<div><div class="text-[10px] text-gray-500">Same-day labor</div><div class="font-bold">' + fmtKs(laborCost) + '</div></div>' +
      '<div class="col-span-2 sm:col-span-3 border-t border-gray-800 pt-2"><div class="text-[10px] text-gray-500">To make <b>' + fmtKs(target) + '</b> profit today</div>' +
        '<div class="font-extrabold text-emerald-400 text-lg">' + fmt(bagsForProfit) + ' bags · ' + fmt(piecesForProfit) + ' rolls</div></div>' +
      (standing > 0
        ? '<div class="col-span-2 sm:col-span-3"><div class="text-[10px] text-gray-500">Standing orders already cover ' + fmt(standing) + ' bags — you still need to sell</div><div class="font-bold text-amber-400">' + fmt(afterStanding) + ' bags</div></div>'
        : '') +
    '</div>';
}
function lastSalePrice() {
  const sales = salesList();
  return sales.length ? (sales[sales.length - 1].price || 0) : 0;
}
$('targetProfitGoal').addEventListener('input', renderTargetProfit);
$('purchaseSafetyDays').addEventListener('change', renderPurchaseList);

/* ============================================================
   PURCHASE-LIST GENERATOR (Group B)
   From today's production usage + current stock, produce a
   shopping list: for each stock ingredient, how much to buy so
   the stock ends at a target (default: today's usage + a safety
   buffer, rounded up, minus what is already on hand).
   ============================================================ */
function purchaseList() {
  const safetyDays = parseFloat(($('purchaseSafetyDays') || {}).value) || 1;
  const usage = currentUsage();
  const rows = (state.prices || []).filter(isStockItem).map(function (ing) {
    const used = parseFloat(usage[ing.name]) || 0;
    const onHand = inventoryStockFor(ing.name);
    const buffer = used * Math.max(0, safetyDays - 1);
    const want = Math.max(0, Math.ceil(used + buffer - onHand));
    return { name: ing.name, unit: ing.unit, used: used, onHand: onHand, want: want, price: parseFloat(ing.price) || 0 };
  }).filter(function (r) { return r.want > 0; });
  return rows;
}

function renderPurchaseList() {
  const box = $('purchaseListBox');
  if (!box) return;
  const rows = purchaseList();
  if (!rows.length) { box.innerHTML = '<span class="text-gray-500">Nothing to buy right now — on-hand stock covers the next batch.</span>'; return; }
  const total = rows.reduce(function (s, r) {
    return s + (r.unit === 'g' ? (r.want / 1000) * r.price : r.want * r.price);
  }, 0);
  box.innerHTML =
    '<div class="space-y-1 max-h-72 overflow-y-auto scrollbar-thin">' +
    rows.map(function (r) {
      return '<div class="flex justify-between items-center gap-2 py-1 border-b border-gray-800 last:border-0">' +
        '<div class="min-w-0"><span class="font-semibold text-xs">' + esc(r.name) + '</span>' +
        '<div class="text-[10px] text-gray-500">use ' + fmt(r.used) + ' · on hand ' + fmt(r.onHand) + ' ' + esc(r.unit) + '</div></div>' +
        '<span class="font-bold text-amber-400">buy ' + fmt(r.want) + '</span></div>';
    }).join('') +
    '</div>' +
    '<div class="flex justify-between items-center mt-2 pt-2 border-t border-gray-700"><span class="text-xs text-gray-400">Estimated cost</span><span class="font-bold text-emerald-400">' + fmtKs(total) + '</span></div>';
}
function renderPurchaseDays() {
  const sel = $('purchaseSafetyDays');
  if (!sel) return;
  ['1', '2', '3', '7'].forEach(function (d) {
    const o = document.createElement('option');
    o.value = d; o.textContent = d + (d === '1' ? ' day' : ' days');
    sel.appendChild(o);
  });
}

/* ---------- Printable Report ---------- */
$('printReportBtn').addEventListener('click', function () {
  const f = financeTotalsAll();
  const entries = entriesProdSales();
  if (!f.revenue && !f.capital && !entries.length) { showToast('No data to print.', 'info'); return; }
  const w = window.open('', '_blank');
  w.document.write('<html><head><title>Crispy Roll Ledger Report</title><style>body{font-family:Arial,sans-serif;padding:20px;color:#111}h1{color:#B45309}table{width:100%;border-collapse:collapse;margin-top:10px}th,td{border:1px solid #ccc;padding:6px 8px;text-align:left;font-size:12px}th{background:#f5f5f5}.pos{color:#059669;font-weight:bold}.neg{color:#dc2626;font-weight:bold}</style></head><body>');
  w.document.write('<h1>Daily Crispy Roll Ledger Report</h1>');
  w.document.write('<p>Generated: ' + new Date().toLocaleString() + '</p>');
  w.document.write('<table><tr><th>Date</th><th>Capital</th><th>Rolled (bags)</th><th>Rolled (pcs)</th><th>Expected</th><th>Sold (bags)</th><th>Revenue</th><th>Net (sold)</th><th>Notes</th></tr>');
  entries.forEach(function (e) {
    w.document.write('<tr><td>' + e.date + '</td><td>' + fmtKs(e.capital) + '</td><td>' + fmt(e.prodBags) + '</td><td>' + fmt(e.prodPieces) + '</td>' + (e.expectedRolls ? '<td>' + fmt(e.expectedRolls) + '</td>' : '<td>—</td>') + '<td>' + fmt(e.soldBags) + '</td><td>' + fmtKs(e.revenue) + '</td><td class="' + (e.net >= 0 ? 'pos' : 'neg') + '">' + fmtKs(e.net) + '</td>' + (e.notes ? '<td>' + esc(e.notes) + '</td>' : '<td>—</td>') + '</tr>');
  });
  w.document.write('</table></body></html>');
  w.document.close();
  w.print();
});

$('exportMonthlyCsvBtn').addEventListener('click', function () {
  const entries = entriesProdSales();
  if (!entries.length) { showToast('No data to export.', 'info'); return; }
  const header = ['Date', 'Capital (Ks)', 'Bags Rolled', 'Pieces Rolled', 'Bags Sold', 'Revenue (Ks)', 'Labor Hrs', 'Net (Ks)'];
  const lines = [csvRow(header)];
  entries.forEach(function (e) {
    lines.push(csvRow([e.date, e.capital, e.prodBags, e.prodPieces, e.soldBags, e.revenue, ((e.laborMin || 0) / 60).toFixed(2), e.net]));
  });
  const blob = new Blob(['\uFEFF' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'crispy-roll-report-' + today() + '.csv';
  a.click();
  URL.revokeObjectURL(a.href);
  showToast('Report exported to CSV.');
});

