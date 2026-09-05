/* ============================================================
   SALES — RECORD WHAT YOU SOLD (any day)
   A sale can be the same day you rolled, or days later. You enter
   bags sold, pieces actually in those bags (quantity per bag
   varies) and price per bag. The sale deducts those pieces from
   ready-to-sell stock and records revenue + inventory cost (COGS).
   ============================================================ */
$('addSaleBtn').addEventListener('click', saveSale);
if ($('salesFilter')) $('salesFilter').addEventListener('input', function () { renderSalesTab(); });

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
  const bags = parseFloat($('saleBags').value) || 0;
  const price = parseFloat($('salePrice').value) || 0;
  const pieces = parseFloat($('salePieces').value) || 0;
  const amount = bags * price;
  const status = $('salePaymentStatus') ? $('salePaymentStatus').value : 'paid';
  let paid = parseFloat($('salePaidNow') ? $('salePaidNow').value : '');
  if (status === 'paid' || isNaN(paid)) paid = status === 'credit' ? 0 : amount;
  paid = Math.max(0, Math.min(amount, paid));
  const onHand = (state.stock && state.stock.pieces) || 0;
  // Same-day cost basis: price this sale from the rolls made on ITS own date.
  const costDate = $('saleDate') ? $('saleDate').value : (typeof today === 'function' ? today() : '');
  const dayProd = productionCostOn(costDate);
  const costQty = dayProd.pieces > 0 ? Math.min(pieces, dayProd.pieces) : 0;
  const cogs = dayProd.pieces > 0 ? Math.round(costQty * (dayProd.capital / dayProd.pieces)) : 0;
  const profit = Math.round(amount - cogs);
  if ($('saleAmountLive')) $('saleAmountLive').textContent = fmtKs(amount);
  if ($('saleCogsLive')) $('saleCogsLive').textContent = fmtKs(cogs) + ' @ ' + (dayProd.pieces > 0 ? Math.round(dayProd.capital / dayProd.pieces) : 0) + '/pc';
  if ($('saleProfitLive')) { $('saleProfitLive').textContent = fmtKs(profit); $('saleProfitLive').className = 'font-bold ' + (profit >= 0 ? 'text-emerald-400' : 'text-red-400'); }
  if ($('saleStockLive')) $('saleStockLive').textContent = fmt(onHand) + ' pieces ready';
  if ($('salePiecesBag')) $('salePiecesBag').textContent = bags > 0 ? (pieces / bags).toFixed(1) : '—';
  if ($('saleCreditLive')) $('saleCreditLive').textContent = 'Credit: ' + fmtKs(Math.max(0, amount - paid));
}
['saleBags', 'salePieces', 'salePrice', 'salePaidNow', 'salePaymentStatus'].forEach(function (id) {
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

async function removeSale(id) {
  const ok = await Modal.confirm({ title: 'Delete this sale?', message: 'The sale is removed and its pieces return to ready-to-sell stock.', danger: true, okLabel: 'Delete' });
  if (!ok) return;
  const sale = state.sales.find(function (item) { return item.id === id; });
  if (sale) applySaleCreditChange(sale, null);
  state.sales = state.sales.filter(function (s) { return s.id !== id; });
  rebuildStockAndCogs();
  saveState();
  renderAll();
  triggerGoogleSync();
  showToast('Sale deleted — pieces returned to ready-to-sell stock.');
}

/* ---------- Share a receipt on WhatsApp ---------- */
function shareSaleWhatsApp(id) {
  const sale = (state.sales || []).find(function (item) { return item.id === id; });
  if (!sale) return;
  const customer = saleCustomer(sale.customerId);
  const paid = sale.paidAmount === undefined ? sale.amount : sale.paidAmount;
  const credit = saleCreditAmount(sale);
  const text = [
    'Daily Crispy Roll — Receipt ' + (sale.receiptNo || sale.id),
    'Date: ' + sale.date,
    'Customer: ' + (customer ? customer.name : 'Walk-in'),
    sale.bags + ' bag(s) · ' + sale.pieces + ' pcs',
    'Amount: ' + fmtKs(sale.amount),
    'Paid: ' + fmtKs(paid),
    'Balance due: ' + fmtKs(credit),
    'Thank you!'
  ].join('\n');
  const phone = customer && customer.phone ? String(customer.phone).replace(/[^\d]/g, '') : '';
  const url = 'https://wa.me/' + (phone || '') + '?text=' + encodeURIComponent(text);
  window.open(url, '_blank', 'noopener');
}
/* ---------- Return / refund a sale ----------
   The returned pieces go back into ready-to-sell stock (the sale is shrunk in
   place and rebuildStockAndCogs() recomputes what remains unsold); the refunded
   amount reduces the customer's paid/credit and is NOT put back into Cash, so
   the drawer reflects the actual money in it. */
async function returnSale(id) {
  const sale = (state.sales || []).find(function (item) { return item.id === id; });
  if (!sale) return;
  if (!(sale.pieces > 0)) { showToast('This sale has no pieces to return.', 'info'); return; }
  const piecesStr = await Modal.prompt({
    title: 'Return / refund',
    message: 'How many pieces are being returned? (max ' + fmt(sale.pieces) + ')',
    inputType: 'number',
    validate: function (v) {
      const n = Math.floor(toFinite(v));
      return (n >= 1 && n <= sale.pieces) ? '' : 'Enter between 1 and ' + fmt(sale.pieces) + ' pieces.';
    }
  });
  if (piecesStr === null) return;
  const returnPieces = Math.floor(toFinite(piecesStr));
  const paidMax = isNaN(sale.paidAmount) ? sale.amount : sale.paidAmount;
  const defaultRefund = Math.round((returnPieces / sale.pieces) * (sale.amount || 0));
  const refundStr = await Modal.prompt({
    title: 'Refund amount',
    message: 'How much cash is being refunded? (max ' + fmtKs(paidMax) + ')',
    value: String(defaultRefund),
    inputType: 'number',
    validate: function (v) {
      const n = toFinite(v);
      return (n >= 0 && n <= paidMax + 0.01) ? '' : 'Refund cannot exceed ' + fmtKs(paidMax) + '.';
    }
  });
  if (refundStr === null) return;
  const refund = Math.min(Math.round(toFinite(refundStr)), paidMax);

  // Shrink the sale in place.
  const oldCredit = saleCreditAmount(sale);
  sale.pieces -= returnPieces;
  sale.bags = sale.bags > 0 ? Math.max(0, Math.round((sale.pieces / (sale.pieces + returnPieces)) * sale.bags)) : 0;
  sale.amount = Math.max(0, sale.amount - defaultRefund);
  sale.paidAmount = Math.max(0, (isNaN(sale.paidAmount) ? sale.amount : sale.paidAmount) - refund);
  // Adjust the customer's credit ledger for the refunded portion.
  const newCredit = saleCreditAmount(sale);
  const creditDelta = newCredit - oldCredit;
  if (creditDelta && sale.customerId) {
    const customer = saleCustomer(sale.customerId);
    if (customer) customer.debt = Math.max(0, toFinite(customer.debt) + creditDelta);
  }
  if (sale.pieces <= 0) {
    // Everything was returned — remove the empty sale entirely.
    state.sales = state.sales.filter(function (s) { return s.id !== sale.id; });
  }
  rebuildStockAndCogs();
  saveState();
  renderAll();
  triggerGoogleSync();
  showToast((sale.pieces > 0 ? 'Returned ' + fmt(returnPieces) + ' pcs' : 'Sale fully returned') +
    (refund > 0 ? ' · refunded ' + fmtKs(refund) + ' (kept out of cash drawer)' : '') + '.', sale.pieces > 0 ? 'info' : 'success');
}
// @@SALES2@@

/* ============================================================
   RENDER SALES TAB + READY-TO-SELL STOCK CARD
   ============================================================ */
function renderSalesTab() {
  renderSaleCustomerOptions();
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
  let list = salesList().slice().reverse();
  const query = (($('salesFilter') || {}).value || '').trim().toLowerCase();
  if (query) {
    list = list.filter(function (s) {
      const customer = saleCustomer(s.customerId);
      return String(s.date).toLowerCase().indexOf(query) !== -1
        || String(customer ? customer.name : 'walk-in').toLowerCase().indexOf(query) !== -1
        || String(s.receiptNo || s.id).toLowerCase().indexOf(query) !== -1;
    });
  }
  if (!list.length) {
    tbody.innerHTML = '<tr><td colspan="9" class="py-6 text-center text-gray-500">' + (query ? 'No sales match "' + esc(query) + '".' : 'No sales logged yet. Record a bag sale here — it deducts from ready-to-sell stock.') + '</td></tr>';
    return;
  }
  tbody.innerHTML = list.map(function (s) {
    const customer = saleCustomer(s.customerId);
    const credit = saleCreditAmount(s);
    const paid = s.paidAmount === undefined ? s.amount : s.paidAmount;
    return '<tr class="border-b border-gray-800">' +
      '<td class="py-2 pr-2 whitespace-nowrap">' + esc(s.date) + '</td>' +
      '<td class="py-2 pr-2 text-xs">' + esc(customer ? customer.name : 'Walk-in') + '</td>' +
      '<td class="py-2 pr-2">' + fmt(s.bags) + '</td>' +
      '<td class="py-2 pr-2">' + fmt(s.pieces) + '</td>' +
      '<td class="py-2 pr-2">' + (s.bags > 0 ? (s.pieces / s.bags).toFixed(1) : '—') + '</td>' +
      '<td class="py-2 pr-2 text-emerald-400 font-semibold">' + fmtKs(s.amount) + '</td>' +
      '<td class="py-2 pr-2 text-xs"><span class="text-emerald-400">' + fmtKs(paid) + '</span>' + (credit ? ' <span class="text-red-400">/ ' + fmtKs(credit) + '</span>' : '') + '</td>' +
      '<td class="py-2 pr-2 ' + ((saleProfit(s) >= 0) ? 'text-emerald-400' : 'text-red-400') + ' font-bold">' + fmtKs(saleProfit(s)) + '</td>' +
      '<td class="py-2"><div class="flex gap-2">' +
      '<button onclick="shareSaleWhatsApp(\'' + s.id + '\')" class="text-emerald-500 hover:text-emerald-400 transition" title="Share on WhatsApp"><i data-lucide="message-circle" class="w-4 h-4"></i></button>' +
      '<button onclick="printSaleReceipt(\'' + s.id + '\')" class="text-emerald-400 hover:text-emerald-300 transition" title="Print receipt"><i data-lucide="receipt" class="w-4 h-4"></i></button>' +
      '<button onclick="returnSale(\'' + s.id + '\')" class="text-sky-400 hover:text-sky-300 transition" title="Return / refund"><i data-lucide="rotate-ccw" class="w-4 h-4"></i></button>' +
      '<button onclick="selectSaleToEdit(\'' + s.id + '\')" class="text-amber-400 hover:text-amber-300 transition" title="Edit"><i data-lucide="pencil" class="w-4 h-4"></i></button>' +
      '<button onclick="removeSale(\'' + s.id + '\')" class="text-red-400 hover:text-red-300 transition" title="Delete"><i data-lucide="trash-2" class="w-4 h-4"></i></button>' +
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
  // Build the receipt with DOM APIs so customer/notes text is never parsed as HTML.
  const doc = win.document;
  doc.open();
  doc.write('<!doctype html><html><head><meta charset="utf-8"><title>Receipt ' +
    String(sale.receiptNo || sale.id).replace(/[<>&"']/g, '') +
    '</title><style>body{font-family:Arial,sans-serif;max-width:360px;margin:24px auto;color:#111}h1{font-size:20px;margin:4px 0}.muted{color:#555;font-size:12px}.line{display:flex;justify-content:space-between;border-bottom:1px solid #ddd;padding:8px 0}.total{font-weight:bold;font-size:17px;border-bottom:none}@media print{body{margin:0}}</style></head><body></body></html>');
  doc.close();
  const body = doc.body;
  function line(left, right, cls) {
    const d = doc.createElement('div');
    d.className = 'line' + (cls ? ' ' + cls : '');
    const l = doc.createElement('span'); l.textContent = left;
    const r = doc.createElement('span'); r.textContent = right;
    d.appendChild(l); d.appendChild(r);
    body.appendChild(d);
  }
  const h1 = doc.createElement('h1'); h1.textContent = 'Daily Crispy Roll Ledger';
  body.appendChild(h1);
  const sub = doc.createElement('div'); sub.className = 'muted';
  sub.textContent = 'Receipt ' + (sale.receiptNo || sale.id) + ' · ' + sale.date;
  body.appendChild(sub);
  const cust = doc.createElement('div'); cust.className = 'muted';
  cust.textContent = 'Customer: ' + (customer ? customer.name : 'Walk-in');
  body.appendChild(cust);
  line(fmt(sale.bags) + ' bag(s) · ' + fmt(sale.pieces) + ' pcs', fmtKs(sale.amount));
  line('Paid now', fmtKs(paid));
  line('Balance due', fmtKs(credit), 'total');
  if (credit && sale.dueDate) line('Due date', sale.dueDate);
  const thanks = doc.createElement('p'); thanks.className = 'muted'; thanks.textContent = 'Thank you.';
  body.appendChild(thanks);
  setTimeout(function () { try { win.focus(); win.print(); } catch (e) { /* popup blocked or closed */ } }, 100);
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
