/* ============================================================
   CSV EXPORT
   ============================================================ */
$('exportCsvBtn').addEventListener('click', function () {
  const entries = entriesSorted();
  if (!entries.length) { showToast('No entries to export.', 'info'); return; }
  const header = ['Date', 'Ingredient Cost (Ks)', 'Additional Cost (Ks)', 'Capital (Ks)', 'Bags Produced', 'Pieces Rolled', 'Bags Sold', 'Price/Bag (Ks)', 'Revenue (Ks)', 'Labor Minutes', 'Labor Cost (Ks)', 'Net Gain (Ks)', 'Net Gain After Labor (Ks)', 'Mix Weight (g)', 'Cost / Bag (Ks)', 'Margin %'];
  const lines = [header.join(',')];
  entries.forEach(function (e) {
    const ingCost = (e.capital || 0) - (e.additionalCost || 0);
    lines.push([e.date, Math.round(ingCost), e.additionalCost || 0, e.capital, e.bagsProduced, e.pieces, e.bagsSold, e.price, e.revenue, e.laborMinutes || 0, e.laborCost || 0, e.net, e.netAfterLabor || 0, e.mixWeight || 0, e.costPerBag || 0, e.marginPct || 0].join(','));
  });
  const blob = new Blob(['\uFEFF' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'daily-crispy-roll-ledger-' + today() + '.csv';
  a.click();
  URL.revokeObjectURL(a.href);
  showToast('Ledger exported to CSV successfully.');
});

