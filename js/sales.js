/* ============================================================
   SALES — RECORD WHAT YOU SOLD (any day)
   A sale can be the same day you rolled, or days later. You enter
   bags sold, pieces actually in those bags (quantity per bag
   varies) and price per bag. The sale deducts those pieces from
   ready-to-sell stock and records revenue + inventory cost (COGS).
   ============================================================ */
$('addSaleBtn').addEventListener('click', saveSale);

function saveSale() {
  const date = validateText($('saleDate'));
  const bags = validateNum($('saleBags'));
  const pieces = validateNum($('salePieces'));
  const price = validateNum($('salePrice'));
  if (date === null || bags === null || pieces === null || price === null) {
    showToast('Enter date, bags, pieces and price per bag.', 'error');
    return;
  }
  const editId = document.getElementById('editSaleId').value;
  const isUpdate = !!editId;
  const amount = bags * price;
  const record = {
    id: isUpdate ? editId : uid(),
    date: date, bags: Math.round(bags), pieces: Math.round(pieces),
    price: price, amount: Math.round(amount), cogs: 0, avgCost: 0, net: 0
  };

  if (isUpdate) {
    const idx = state.sales.findIndex(function (s) { return s.id === record.id; });
    if (idx >= 0) state.sales[idx] = record;
  } else {
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
  triggerGoogleSync();
  $('saleDate').value = today();
  $('saleBags').value = '';
  $('salePieces').value = '';
  $('salePrice').value = '';
  updateSaleLive();
}

/* Live mini-calc on the sale form. */
function updateSaleLive() {
  const bags = parseFloat($('saleBags').value) || 0;
  const price = parseFloat($('salePrice').value) || 0;
  const pieces = parseFloat($('salePieces').value) || 0;
  const amount = bags * price;
  const onHand = (state.stock && state.stock.pieces) || 0;
  if ($('saleAmountLive')) $('saleAmountLive').textContent = fmtKs(amount);
  if ($('saleStockLive')) $('saleStockLive').textContent = fmt(onHand) + ' pieces ready';
  if ($('salePiecesBag')) $('salePiecesBag').textContent = bags > 0 ? (pieces / bags).toFixed(1) : '—';
}
['saleBags', 'salePieces', 'salePrice'].forEach(function (id) {
  $(id).addEventListener('input', updateSaleLive);
});

function selectSaleToEdit(id) {
  const s = state.sales.find(function (x) { return x.id === id; });
  if (!s) return;
  document.getElementById('editSaleId').value = id;
  $('saleDate').value = s.date;
  $('saleBags').value = s.bags;
  $('salePieces').value = s.pieces;
  $('salePrice').value = s.price;
  $('addSaleBtn').innerHTML = '<i data-lucide="save" class="w-4 h-4"></i> Update Sale';
  lucide.createIcons();
  updateSaleLive();
  document.querySelector('[data-tab="sales"]').click();
  showToast('Editing sale from ' + s.date + ' — adjust then click Update Sale.', 'info');
}

function removeSale(id) {
  if (!confirm('Delete this sale?')) return;
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
    tbody.innerHTML = '<tr><td colspan="7" class="py-6 text-center text-gray-500">No sales logged yet. Record a bag sale here — it deducts from ready-to-sell stock.</td></tr>';
    return;
  }
  tbody.innerHTML = list.map(function (s) {
    return '<tr class="border-b border-gray-800">' +
      '<td class="py-2 pr-2 whitespace-nowrap">' + esc(s.date) + '</td>' +
      '<td class="py-2 pr-2">' + fmt(s.bags) + '</td>' +
      '<td class="py-2 pr-2">' + fmt(s.pieces) + '</td>' +
      '<td class="py-2 pr-2">' + (s.bags > 0 ? (s.pieces / s.bags).toFixed(1) : '—') + '</td>' +
      '<td class="py-2 pr-2 text-emerald-400 font-semibold">' + fmtKs(s.amount) + '</td>' +
      '<td class="py-2 pr-2 ' + (s.net >= 0 ? 'text-emerald-400' : 'text-red-400') + ' font-bold">' + fmtKs(s.net) + '</td>' +
      '<td class="py-2"><div class="flex gap-2">' +
      '<button onclick="selectSaleToEdit(\'' + s.id + '\')" class="text-amber-400 hover:text-amber-300 transition" title="Edit"><i data-lucide="pencil" class="w-4 h-4"></i></button>' +
      '<button onclick="removeSale(\'' + s.id + '\')" class="text-red-400 hover:text-red-300 transition" title="Delete"><i data-lucide="trash-2" class="w-4 h-4"></i></button>' +
      '</div></td></tr>';
  }).join('');
  lucide.createIcons();
}

/* Export sales to CSV */
$('exportSalesCsvBtn').addEventListener('click', function () {
  const list = salesList();
  if (!list.length) { showToast('No sales to export.', 'info'); return; }
  const lines = ['Date,Bags,Pieces,Pieces/Bag,Price/Bag (Ks),Amount (Ks),COGS (Ks),Net (Ks)'];
  list.forEach(function (s) {
    lines.push([s.date, s.bags, s.pieces, s.bags ? (s.pieces / s.bags).toFixed(1) : '', s.price, s.amount || 0, s.cogs || 0, s.net || 0].join(','));
  });
  const blob = new Blob(['\uFEFF' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'crispy-roll-sales-' + today() + '.csv';
  a.click();
  URL.revokeObjectURL(a.href);
  showToast('Sales exported to CSV successfully.');
});