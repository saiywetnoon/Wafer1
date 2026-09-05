/* ============================================================
   CUSTOMERS
   ============================================================ */
/* Rebuild the customer <option> markup for any dropdown. */
function customerOptions(customers, placeholder) {
  return '<option value="">' + esc(placeholder || 'Select customer...') + '</option>' + (customers || []).map(function (c) {
    return '<option value="' + esc(c.id) + '">' + esc(c.name) + '</option>';
  }).join('');
}
/* Refill a <select> with customer options, preserving the current selection. */
function refillCustomerSelect(select, customers, placeholder) {
  if (!select) return;
  const current = select.value;
  select.innerHTML = customerOptions(customers, placeholder);
  select.value = current || '';
}

function renderCustomers() {
  const customers = state.customers || [];
  const listBody = $('customerListBody');
  if (listBody) {
    const query = (($('customerFilter') || {}).value || '').trim().toLowerCase();
    const visible = query
      ? customers.filter(function (c) {
          return String(c.name).toLowerCase().indexOf(query) !== -1
            || String(c.phone || '').toLowerCase().indexOf(query) !== -1;
        })
      : customers;
    listBody.innerHTML = visible.length ? visible.map(function (c) {
      const debt = toFinite(c.debt);
      return '<tr class="border-b border-gray-800">' +
        '<td class="py-1.5 pr-2 font-medium">' + esc(c.name) + (c.phone ? ' <span class="text-gray-500">(' + esc(c.phone) + ')</span>' : '') + '</td>' +
        '<td class="py-1.5 pr-2">' + fmt(c.standingOrder || 0) + ' bags</td>' +
        '<td class="py-1.5 pr-2 ' + (debt > 0 ? 'text-red-400' : 'text-emerald-400') + ' font-semibold">' + fmtKs(debt) + '</td>' +
        '<td class="py-1.5"><button onclick="deleteCustomer(\'' + c.id + '\')" class="text-red-500 hover:text-red-400" title="Remove customer"><i data-lucide="trash-2" class="w-3.5 h-3.5"></i></button></td>' +
        '</tr>';
    }).join('') : '<tr><td colspan="4" class="py-4 text-center text-gray-500">' + (query ? 'No customers match "' + esc(query) + '".' : 'No customers yet. Add your first regular customer above.') + '</td></tr>';
  }

  refillCustomerSelect($('paymentCustomer'), customers, 'Select customer...');
  refillCustomerSelect($('statementCustomer'), customers, 'Choose customer…');
  renderCustomerStatement();

  if ($('standingOrdersTotal') && $('standingRevenueTotal') && $('totalDebt')) {
    const standingBags = customers.reduce(function (s, c) { return s + toFinite(c.standingOrder); }, 0);
    const standingRev = customers.reduce(function (s, c) { return s + (toFinite(c.standingOrder) * toFinite(c.price, 1300)); }, 0);
    const totalDebt = customers.reduce(function (s, c) { return s + toFinite(c.debt); }, 0);
    $('standingOrdersTotal').textContent = fmt(standingBags) + ' bags';
    $('standingRevenueTotal').textContent = fmtKs(standingRev);
    $('totalDebt').textContent = fmtKs(totalDebt);
  }
  lucide.createIcons();
}

async function deleteCustomer(id) {
  const customer = (state.customers || []).find(function (c) { return c.id === id; });
  const hasSales = (state.sales || []).some(function (sale) { return sale.customerId === id; });
  if ((customer && toFinite(customer.debt) > 0) || hasSales) {
    showToast('Keep this customer because they have a sale or an outstanding balance.', 'error');
    return;
  }
  const ok = await Modal.confirm({ title: 'Remove customer?', message: 'Remove this customer from the list?', danger: true, okLabel: 'Remove' });
  if (!ok) return;
  state.customers = (state.customers || []).filter(function (c) { return c.id !== id; });
  saveState();
  renderCustomers();
  showToast('Customer removed.');
}

function renderCustomerStatement() {
  const output = $('customerStatement');
  const select = $('statementCustomer');
  if (!output || !select) return;
  const customerId = select.value;
  if (!customerId) { output.textContent = 'Choose a customer to view sales and payments.'; return; }
  const customer = (state.customers || []).find(function (c) { return c.id === customerId; });
  if (!customer) { output.textContent = 'Customer not found.'; return; }
  const rows = [];
  (state.sales || []).filter(function (sale) { return sale.customerId === customerId; }).forEach(function (sale) {
    const credit = saleCreditAmount(sale);
    rows.push({ date: sale.date, order: 0, label: 'Sale ' + (sale.receiptNo || sale.id),
      amount: credit, dueDate: sale.dueDate || '' });
  });
  (state.customerPayments || []).filter(function (payment) { return payment.customerId === customerId; }).forEach(function (payment) {
    rows.push({ date: payment.date, order: 1, label: 'Payment received', amount: -Math.abs(payment.amount || 0), dueDate: '' });
  });
  // Include the manual-baseline charge (extraDebt) that isn't backed by a sale,
  // so the standing ledger's running balance matches the customer's real debt.
  if ((parseFloat(customer.extraDebt) || 0) > 0) {
    rows.push({ date: customer.createdAt ? String(customer.createdAt).slice(0, 10) : '', order: -1,
      label: 'Manual / opening balance', amount: Math.round(parseFloat(customer.extraDebt) || 0), dueDate: '' });
  }
  rows.sort(function (a, b) {
    const byDate = String(a.date || '').localeCompare(String(b.date || ''));
    return byDate !== 0 ? byDate : (a.order - b.order);
  });
  if (!rows.length) { output.textContent = 'No customer-linked sales or payments yet.'; return; }
  let running = 0;
  output.innerHTML = rows.map(function (row) {
    running += toMoney(row.amount);
    const isPayment = toFinite(row.amount) < 0;
    return '<div class="flex justify-between gap-2 py-1.5 border-b border-gray-800 last:border-0">' +
      '<div><span>' + esc(row.date || '—') + ' · ' + esc(row.label) + '</span>' +
      (row.dueDate ? '<span class="block text-[10px] text-amber-400">Due ' + esc(row.dueDate) + '</span>' : '') + '</div>' +
      '<div class="text-right shrink-0"><span class="' + (isPayment ? 'text-emerald-400' : 'text-red-400') + ' font-semibold">' +
      (isPayment ? '−' : '+') + fmtKs(Math.abs(toFinite(row.amount))) + '</span><span class="block text-[10px] text-gray-500">Balance ' + fmtKs(Math.max(0, running)) + '</span></div></div>';
  }).join('') + '<div class="flex justify-between pt-2 font-bold"><span>Current balance</span><span class="text-red-400">' + fmtKs(toFinite(customer.debt)) + '</span></div>';
}

if ($('statementCustomer')) $('statementCustomer').addEventListener('change', renderCustomerStatement);
if ($('customerFilter')) $('customerFilter').addEventListener('input', function () { renderCustomers(); });

$('addCustomerBtn').addEventListener('click', function () {
  const name = validateText($('custName'));
  if (!name) { showToast('Enter a customer name.', 'error'); return; }
  const order = parseFloat($('custOrder').value) || 0;
  const price = parseFloat($('custPrice').value) || 1300;
  const phone = $('custPhone').value.trim();
  if (!state.customers) state.customers = [];
  state.customers.push({ id: uid(), name: name, phone: phone, standingOrder: order, price: price, debt: 0 });
  saveState();
  renderCustomers();
  $('custName').value = '';
  $('custPhone').value = '';
  $('custOrder').value = '';
  $('custPrice').value = '';
  showToast('Customer "' + name + '" added.');
});

$('paymentMinusBtn').addEventListener('click', function () {
  adjustCustomerDebt(-1);
});
$('paymentPlusBtn').addEventListener('click', function () {
  adjustCustomerDebt(1);
});

function adjustCustomerDebt(direction) {
  const id = $('paymentCustomer').value;
  const amount = parseFloat($('paymentAmount').value);
  if (!id) { showToast('Select a customer first.', 'error'); return; }
  if (isNaN(amount) || amount <= 0) { showToast('Enter a valid amount.', 'error'); return; }
  const cust = (state.customers || []).find(function (c) { return c.id === id; });
  if (!cust) return;
  const outstanding = Math.max(0, toFinite(cust.debt));
  const appliedAmount = direction < 0 ? Math.min(amount, outstanding) : amount;
  if (direction < 0 && appliedAmount === 0) { showToast('This customer has no outstanding debt.', 'info'); return; }
  if (direction < 0) {
    // A repayment is recorded as real cash received. Only the payment record
    // lowers the ledger balance — extraDebt (the manual baseline) is left alone
    // so the authoritative recompute in normalizeCustomerBalances() stays exact.
    if (!state.customerPayments) state.customerPayments = [];
    state.customerPayments.push({ id: uid(), customerId: id, date: today(), amount: Math.round(appliedAmount) });
  } else {
    // Manual "debt added" charge — tracked on the baseline so it survives the
    // authoritative recompute in normalizeCustomerBalances().
    cust.extraDebt = Math.max(0, toMoney(toFinite(cust.extraDebt) + appliedAmount));
  }
  normalizeCustomerBalances();
  saveState();
  renderCustomers();
  $('paymentAmount').value = '';
  showToast(direction < 0
    ? 'Payment recorded — debt reduced.' + (appliedAmount < amount ? ' Applied ' + fmtKs(appliedAmount) + ' (the outstanding balance).' : '')
    : 'Debt added to customer.');
}

