/* ============================================================
   CUSTOMERS
   ============================================================ */
function renderCustomers() {
  const listBody = $('customerListBody');
  const customers = state.customers || [];
  listBody.innerHTML = customers.length ? customers.map(function (c) {
    return '<tr class="border-b border-gray-800">' +
      '<td class="py-1.5 pr-2 font-medium">' + esc(c.name) + (c.phone ? ' <span class="text-gray-500">(' + esc(c.phone) + ')</span>' : '') + '</td>' +
      '<td class="py-1.5 pr-2">' + fmt(c.standingOrder || 0) + ' bags</td>' +
      '<td class="py-1.5 pr-2 ' + ((c.debt || 0) > 0 ? 'text-red-400' : 'text-emerald-400') + ' font-semibold">' + fmtKs(c.debt || 0) + '</td>' +
      '<td class="py-1.5"><button onclick="deleteCustomer(\'' + c.id + '\')" class="text-red-500 hover:text-red-400" title="Remove customer"><i data-lucide="trash-2" class="w-3.5 h-3.5"></i></button></td>' +
      '</tr>';
  }).join('') : '<tr><td colspan="4" class="py-4 text-center text-gray-500">No customers yet. Add your first regular customer above.</td></tr>';

  // Payment dropdown
  const paySel = $('paymentCustomer');
  const current = paySel.value;
  paySel.innerHTML = '<option value="">Select customer...</option>' + customers.map(function (c) {
    return '<option value="' + c.id + '">' + esc(c.name) + '</option>';
  }).join('');
  if (current) paySel.value = current;

  // Totals
  const standingBags = customers.reduce(function (s, c) { return s + (c.standingOrder || 0); }, 0);
  const standingRev = customers.reduce(function (s, c) { return s + ((c.standingOrder || 0) * (c.price || 0)); }, 0);
  const totalDebt = customers.reduce(function (s, c) { return s + (c.debt || 0); }, 0);
  $('standingOrdersTotal').textContent = fmt(standingBags) + ' bags';
  $('standingRevenueTotal').textContent = fmtKs(standingRev);
  $('totalDebt').textContent = fmtKs(totalDebt);
  lucide.createIcons();
}

function deleteCustomer(id) {
  if (!confirm('Remove this customer?')) return;
  state.customers = (state.customers || []).filter(function (c) { return c.id !== id; });
  saveState();
  renderCustomers();
  showToast('Customer removed.');
}

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
  cust.debt = Math.max(0, (cust.debt || 0) + (direction * amount));
  // Record cash actually received when a customer repays debt (feeds the Cash Drawer)
  if (direction < 0 && amount > 0) {
    if (!state.customerPayments) state.customerPayments = [];
    state.customerPayments.push({ id: uid(), customerId: id, date: today(), amount: Math.round(amount) });
  }
  saveState();
  renderCustomers();
  $('paymentAmount').value = '';
  showToast(direction < 0 ? 'Payment recorded — debt reduced.' : 'Debt added to customer.');
}

