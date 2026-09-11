/* ============================================================
   SALES — RECORD WHAT YOU SOLD (any day)
   A sale can be the same day you rolled, or days later. You enter
   bags sold, pieces actually in those bags (quantity per bag
   varies) and price per bag. The sale deducts those pieces from
   ready-to-sell stock and records revenue + inventory cost (COGS).
   ============================================================ */
$('addSaleBtn').addEventListener('click', saveSale);

function saleCustomer(id) {
  return (state.customers || []).find(function (customer) { return customer.id === id; }) || null;
}
function saleCreditAmount(sale) {
  return Math.max(0, (sale.amount || 0) - (sale.paidAmount === undefined ? (sale.amount || 0) : sale.paidAmount));
}
function applySaleCreditChange(oldSale, newSale) {
  const changes = {};
  if (oldSale && oldSale.customerId) changes[oldSale.customerId] = (changes[oldSale.customerId] || 0) - saleCreditAmount(oldSale);
  if (newSale && newSale.customerId) changes[newSale.customerId] = (changes[newSale.customerId] || 0) + saleCreditAmount(newSale);
  Object.keys(changes).forEach(function (customerId) {
    const customer = saleCustomer(customerId);
    if (customer && changes[customerId]) customer.debt = Math.max(0, (customer.debt || 0) + changes[customerId]);
  });
}
function renderSaleCustomerOptions(selected) {
  const select = $('saleCustomer');
  if (!select) return;
  const current = selected === undefined ? select.value : selected;
  select.innerHTML = '<option value="">Walk-in / no customer</option>' + (state.customers || []).map(function (customer) {
    return '<option value="' + esc(customer.id) + '">' + esc(customer.name) + '</option>';
  }).join('');
  select.value = current || '';
}

function saveSale() {
  const date = validateText($('saleDate'));
  const pieces = validateNum($('salePieces'));
  const price = validateNum($('salePrice'));
  // Bags may be left empty: they are auto-counted from the pieces using the
  // full-set packing rule (floor ÷ rollsPerBag) — 16 pieces at 5/bag = 3 bags.
  const bagsRaw = String($('saleBags').value || '').trim();
  let bags;
  if (bagsRaw === '') {
    if (pieces === null) { showToast('Enter pieces (or bags) and price per bag.', 'error'); return; }
    const rpb = parseInt((state.settings && state.settings.rollsPerBag) != null ? state.settings.rollsPerBag : 0, 10);
    bags = Math.floor(pieces / (rpb > 0 ? rpb : (typeof DEFAULT_ROLLS_PER_BAG !== 'undefined' ? DEFAULT_ROLLS_PER_BAG : 5)));
  } else {
    const parsedBags = validateNum($('saleBags'));
    if (parsedBags === null) { showToast('Enter a valid bag count.', 'error'); return; }
    bags = parsedBags;
  }
  if (date === null || pieces === null || price === null) {
    showToast('Enter date, bags, pieces and price per bag.', 'error');
    return;
  }
  const editId = document.getElementById('editSaleId').value;
  const isUpdate = !!editId;
  const amount = bags * price;
  const customerId = $('saleCustomer').value || '';
  const paymentStatus = $('salePaymentStatus').value || 'paid';
  const dueDate = $('saleDueDate').value || '';
  let paidAmount = parseFloat($('salePaidNow').value);
  if (paymentStatus === 'paid' || isNaN(paidAmount)) paidAmount = paymentStatus === 'credit' ? 0 : amount;
  paidAmount = Math.max(0, Math.min(amount, paidAmount));
  if (paymentStatus !== 'paid' && !customerId) {
    showToast('Choose a customer for a partial or credit sale.', 'error');
    return;
  }
  if (paymentStatus !== 'paid' && paidAmount >= amount) {
    showToast('Choose Paid in full when the entire sale is paid now.', 'error');
    return;
  }
  const record = {
    id: isUpdate ? editId : uid(),
    date: date, bags: Math.round(bags), pieces: Math.round(pieces),
    price: price, amount: Math.round(amount), paidAmount: Math.round(paidAmount),
    customerId: customerId, paymentStatus: paymentStatus, dueDate: dueDate,
    receiptNo: isUpdate ? '' : 'CR-' + Date.now().toString(36).toUpperCase(),
    cogs: 0, avgCost: 0, net: 0
  };
  // Cross-device merge: every record carries a timestamp; the newest updatedAt wins.
  const nowStamp = new Date().toISOString();
  record.updatedAt = nowStamp;
  record.createdAt = nowStamp;
  if (isUpdate) {
    const prevSale = state.sales.find(function (x) { return x.id === record.id; });
    if (prevSale && prevSale.createdAt) record.createdAt = prevSale.createdAt;
  }

  const shortage = canSaveSale(record);
  if (shortage) {
    showToast('Not enough finished stock on ' + shortage.date + '. Available: ' + fmt(shortage.available) + ' pieces; sale needs ' + fmt(shortage.requested) + '.', 'error');
    return;
  }

  if (isUpdate) {
    const idx = state.sales.findIndex(function (s) { return s.id === record.id; });
    if (idx >= 0) {
      record.receiptNo = state.sales[idx].receiptNo || ('CR-' + record.id.toUpperCase());
      applySaleCreditChange(state.sales[idx], record);
      state.sales[idx] = record;
    }
  } else {
    applySaleCreditChange(null, record);
    state.sales.push(record);
  }
  rebuildStockAndCogs();
  saveState();
  renderAll();
  document.getElementById('editSaleId').value = '';
  var btn = $('addSaleBtn');
  btn.innerHTML = '<i data-lucide="badge-dollar-sign" class="w-4 h-4"></i> Log Sale';
  lucide.createIcons();
  showToast(isUpdate ? 'Sale updated for ' + date : 'Sale logged for ' + date + ' — ' + fmt(bags) + ' bags (' + fmtKs(amount) + ').');
  pulseSuccess(btn);
  triggerGoogleSync();
  $('saleDate').value = today();
  $('saleBags').value = '';
  $('salePieces').value = '';
  $('salePrice').value = '';
  $('saleCustomer').value = '';
  $('salePaymentStatus').value = 'paid';
  $('salePaidNow').value = '';
  $('saleDueDate').value = '';
  updateSaleLive();
}

/* Live mini-calc on the sale form. */
function updateSaleLive() {
  const bagsRaw = String($('saleBags').value || '');
  const bagsTyped = bagsRaw.trim() !== '';
  const bags = parseFloat(bagsRaw) || 0;
  const price = parseFloat($('salePrice').value) || 0;
  const pieces = parseFloat($('salePieces').value) || 0;
  // Auto-bags from pieces with the full-set packing rule (floor ÷ rollsPerBag).
  const rpb = parseInt((state.settings && state.settings.rollsPerBag) != null ? state.settings.rollsPerBag : 0, 10);
  const effectiveRpb = rpb > 0 ? rpb : (typeof DEFAULT_ROLLS_PER_BAG !== 'undefined' ? DEFAULT_ROLLS_PER_BAG : 5);
  const derivBags = (!bagsTyped && pieces > 0) ? Math.floor(pieces / effectiveRpb) : 0;
  const bagsShown = bagsTyped ? bags : derivBags;
  const hintEl = $('saleBagsHint');
  if (hintEl) {
    hintEl.textContent = derivBags > 0
      ? 'Auto: ' + fmt(pieces) + ' pieces ÷ ' + effectiveRpb + ' = <b class="text-emerald-400">' + derivBags + ' bag' + (derivBags === 1 ? '' : 's') + '</b> (full sets only)'
      : (pieces > 0 && !bagsTyped ? '' : '');
  }
  const amount = bagsShown * price;
  const status = $('salePaymentStatus') ? $('salePaymentStatus').value : 'paid';
  let paid = parseFloat($('salePaidNow') ? $('salePaidNow').value : '');
  if (status === 'paid' || isNaN(paid)) paid = status === 'credit' ? 0 : amount;
  paid = Math.max(0, Math.min(amount, paid));
  const onHand = (state.stock && state.stock.pieces) || 0;
  // Projected COGS: replay the ledger with this sale added and take the cost
  // those pieces actually carry (average cost of the stock on that date) — the
  // exact number the saved row receives from rebuildStockAndCogs. Selling from
  // stock made earlier (or splitting a batch across customers) never books the
  // whole batch's cost against a single sale.
  const costDate = $('saleDate') ? $('saleDate').value : (typeof today === 'function' ? today() : '');
  const editingId = document.getElementById('editSaleId') ? document.getElementById('editSaleId').value : '';
  const est = projectedSaleCogs({
    id: editingId || null,
    date: costDate, bags: bagsShown, pieces: pieces, price: price, amount: amount
  });
  const cogs = est.cogs;
  const profit = Math.round(amount - cogs);
  if ($('saleAmountLive')) $('saleAmountLive').textContent = fmtKs(amount);
  if ($('saleCogsLive')) $('saleCogsLive').textContent = fmtKs(cogs) + ' @ ' + (est.avgCost > 0 ? Math.round(est.avgCost) : 0) + '/pc';
  if ($('saleProfitLive')) { $('saleProfitLive').textContent = fmtKs(profit); $('saleProfitLive').className = 'font-bold ' + (profit >= 0 ? 'text-emerald-400' : 'text-red-400'); }
  if ($('saleStockLive')) $('saleStockLive').textContent = fmt(onHand) + ' pieces ready';
  if ($('salePiecesBag')) $('salePiecesBag').textContent = bagsShown > 0 ? (pieces / bagsShown).toFixed(1) : '—';
  if ($('saleCreditLive')) $('saleCreditLive').textContent = 'Credit: ' + fmtKs(Math.max(0, amount - paid));
}
['saleBags', 'salePieces', 'salePrice', 'salePaidNow', 'salePaymentStatus', 'saleRollsPerBag'].forEach(function (id) {
  $(id).addEventListener('input', updateSaleLive);
});
$('saleRollsPerBag').addEventListener('change', function () {
  const rpb = parseInt($('saleRollsPerBag').value, 10);
  if (rpb > 0 && rpb <= 100) {
    state.settings.rollsPerBag = rpb;
    persistState();
  }
  updateSaleLive();
});

function selectSaleToEdit(id) {
  const s = state.sales.find(function (x) { return x.id === id; });
  if (!s) return;
  document.getElementById('editSaleId').value = id;
  $('saleDate').value = s.date;
  $('saleBags').value = s.bags;
  $('salePieces').value = s.pieces;
  $('salePrice').value = s.price;
  renderSaleCustomerOptions(s.customerId || '');
  $('salePaymentStatus').value = s.paymentStatus || (saleCreditAmount(s) > 0 ? 'credit' : 'paid');
  $('salePaidNow').value = s.paidAmount === undefined ? s.amount : s.paidAmount;
  $('saleDueDate').value = s.dueDate || '';
  $('addSaleBtn').innerHTML = '<i data-lucide="save" class="w-4 h-4"></i> Update Sale';
  lucide.createIcons();
  updateSaleLive();
  document.querySelector('[data-tab="sales"]').click();
  showToast('Editing sale from ' + s.date + ' — adjust then click Update Sale.', 'info');
}

function removeSale(id) {
  if (!confirm('Delete this sale?')) return;
  const sale = state.sales.find(function (item) { return item.id === id; });
  if (sale) applySaleCreditChange(sale, null);
  state.sales = state.sales.filter(function (s) { return s.id !== id; });
  rebuildStockAndCogs();
  saveState();
  renderAll();
  triggerGoogleSync();
  showToast('Sale deleted — pieces returned to ready-to-sell stock.');
}
// @@SALES2@@

/* ============================================================
   RENDER SALES TAB + READY-TO-SELL STOCK CARD
   ============================================================ */
function renderSalesTab() {
  renderSaleCustomerOptions();
  // Keep the sales-form packing rule in sync with the shared setting.
  if ($('saleRollsPerBag')) {
    const curRpb = parseInt((state.settings && state.settings.rollsPerBag) != null ? state.settings.rollsPerBag : 0, 10);
    $('saleRollsPerBag').value = curRpb > 0 ? curRpb : (typeof DEFAULT_ROLLS_PER_BAG !== 'undefined' ? DEFAULT_ROLLS_PER_BAG : 5);
  }
  // Stock card
  const onHand = (state.stock && state.stock.pieces) || 0;
  const avgCost = stockAvgCostPerPiece();
  if ($('stockPieces')) $('stockPieces').textContent = fmt(onHand);
  if ($('stockBagsHint')) $('stockBagsHint').textContent = fmt(stockBagsHint());
  if ($('stockValue')) $('stockValue').textContent = fmtKs(Math.round((state.stock && state.stock.cost) || 0));
  if ($('stockAvgCost')) $('stockAvgCost').textContent = fmtKs(Math.round(avgCost)) + '/pc';

  // Summary strip
  var f = financeTotalsAll();
  if ($('salesTotalRev')) $('salesTotalRev').textContent = fmtKs(f.revenue);
  if ($('salesTotalCogs')) $('salesTotalCogs').textContent = fmtKs(f.cogs);
  if ($('salesTotalNet')) { $('salesTotalNet').textContent = fmtKs(f.net); $('salesTotalNet').className = 'font-bold ' + (f.net >= 0 ? 'text-emerald-400' : 'text-red-400'); }

  // Recent sales table
  const tbody = $('salesBody');
  if (!tbody) return;
  const list = salesList().slice().reverse();
  if (!list.length) {
    tbody.innerHTML = '<tr><td colspan="10" class="py-6 text-center text-gray-500">No sales logged yet. Record a bag sale here — it deducts from ready-to-sell stock.</td></tr>';
    return;
  }
  tbody.innerHTML = list.map(function (s) {
    const customer = saleCustomer(s.customerId);
    const credit = saleCreditAmount(s);
    const paid = s.paidAmount === undefined ? s.amount : s.paidAmount;
    const profit = saleProfit(s);
    const loss = profit < 0;
    const customerCell = customer
      ? '<span class="text-gray-200">' + esc(customer.name) + '</span>'
      : '<span class="text-gray-500">Walk-in</span>';
    const chip = '<span class="' + (loss ? 'chip-loss' : 'chip-profit') + '" title="Sale amount − cost of the pieces sold (COGS)">' + (loss ? '−' : '+') + fmtKs(Math.abs(profit)) + '</span>';
    return '<tr class="border-b border-gray-800 hover:bg-gray-800/40">' +
      '<td class="py-2 pr-3 whitespace-nowrap tabular-nums text-gray-200">' + esc(s.date) + '</td>' +
      '<td class="py-2 pr-3 text-xs">' + customerCell + '</td>' +
      '<td class="py-2 pr-3 tabular-nums text-right">' + fmt(s.bags) + '</td>' +
      '<td class="py-2 pr-3 tabular-nums text-right text-gray-400">' + fmt(s.pieces) + '</td>' +
      '<td class="py-2 pr-3 tabular-nums text-right text-gray-400">' + (s.bags > 0 ? (s.pieces / s.bags).toFixed(1) : '—') + '</td>' +
      '<td class="py-2 pr-3 tabular-nums text-right whitespace-nowrap text-gray-300">' + fmtKs(s.bags > 0 ? Math.round((s.amount || 0) / s.bags) : (s.price || 0)) + '</td>' +
      '<td class="py-2 pr-3 tabular-nums text-right whitespace-nowrap text-emerald-400 font-semibold">' + fmtKs(s.amount) + '</td>' +
      '<td class="py-2 pr-3 tabular-nums text-right whitespace-nowrap"><span class="text-emerald-500">' + fmtKs(paid) + '</span>' + (credit ? ' <span class="text-red-400">/ ' + fmtKs(credit) + '</span>' : '') + '</td>' +
      '<td class="py-2 pr-3 text-right whitespace-nowrap">' + chip + '</td>' +
      '<td class="py-2 text-right"><div class="flex gap-1 items-center justify-end">' +
      '<button onclick="printSaleReceipt(\'' + s.id + '\')" class="p-1.5 rounded-lg text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/10 transition" title="Print receipt"><i data-lucide="receipt" class="w-4 h-4"></i></button>' +
      '<button onclick="selectSaleToEdit(\'' + s.id + '\')" class="p-1.5 rounded-lg text-amber-400 hover:text-amber-300 hover:bg-amber-500/10 transition" title="Edit"><i data-lucide="pencil" class="w-4 h-4"></i></button>' +
      '<button onclick="removeSale(\'' + s.id + '\')" class="p-1.5 rounded-lg text-red-400 hover:text-red-300 hover:bg-red-500/10 transition" title="Delete"><i data-lucide="trash-2" class="w-4 h-4"></i></button>' +
      '</div></td></tr>';
  }).join('');
  lucide.createIcons();
wireResponsiveTables();
}

function printSaleReceipt(id) {
  const sale = state.sales.find(function (item) { return item.id === id; });
  if (!sale) return;
  const customer = saleCustomer(sale.customerId);
  const paid = sale.paidAmount === undefined ? sale.amount : sale.paidAmount;
  const credit = saleCreditAmount(sale);
  const win = window.open('', '_blank', 'width=480,height=700');
  if (!win) { showToast('Allow pop-ups to print this receipt.', 'error'); return; }
  win.document.write('<!doctype html><html><head><title>Receipt ' + esc(sale.receiptNo || sale.id) + '</title><style>body{font-family:Arial,sans-serif;max-width:360px;margin:24px auto;color:#111}h1{font-size:20px;margin-bottom:4px}.muted{color:#555;font-size:12px}.line{display:flex;justify-content:space-between;border-bottom:1px solid #ddd;padding:8px 0}.total{font-weight:bold;font-size:17px}@media print{body{margin:0}}</style></head><body>' +
    '<h1>Daily Crispy Roll Ledger</h1><div class="muted">Receipt ' + esc(sale.receiptNo || sale.id) + ' · ' + esc(sale.date) + '</div><div class="muted">Customer: ' + esc(customer ? customer.name : 'Walk-in') + '</div>' +
    '<div class="line"><span>' + fmt(sale.bags) + ' bag(s) · ' + fmt(sale.pieces) + ' pcs</span><span>' + fmtKs(sale.amount) + '</span></div>' +
    '<div class="line"><span>Paid now</span><span>' + fmtKs(paid) + '</span></div>' +
    '<div class="line total"><span>Balance due</span><span>' + fmtKs(credit) + '</span></div>' +
    (credit && sale.dueDate ? '<div class="line"><span>Due date</span><span>' + esc(sale.dueDate) + '</span></div>' : '') +
    '<p class="muted">Thank you.</p><script>window.onload=function(){window.print();}</script></body></html>');
  win.document.close();
}

/* Export sales to CSV */
$('exportSalesCsvBtn').addEventListener('click', function () {
  const list = salesList();
  if (!list.length) { showToast('No sales to export.', 'info'); return; }
  const lines = ['Date,Receipt,Customer,Due Date,Bags,Pieces,Pieces/Bag,Price/Bag (Ks),Amount (Ks),Paid (Ks),Credit (Ks),COGS (Ks),Net (Ks)'];
  list.forEach(function (s) {
    const customer = saleCustomer(s.customerId);
    lines.push(csvRow([s.date, s.receiptNo || s.id, customer ? customer.name : 'Walk-in', s.dueDate || '', s.bags, s.pieces, s.bags ? (s.pieces / s.bags).toFixed(1) : '', s.price, s.amount || 0, s.paidAmount === undefined ? s.amount : s.paidAmount, saleCreditAmount(s), s.cogs || 0, s.net || 0]));
  });
  const blob = new Blob(['\uFEFF' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'crispy-roll-sales-' + today() + '.csv';
  a.click();
  URL.revokeObjectURL(a.href);
  showToast('Sales exported to CSV successfully.');
});
