/* ============================================================
   CSV EXPORT
   ============================================================ */
$('exportCsvBtn').addEventListener('click', function () {
  const f = financeTotalsAll();
  const days = entriesProdSales();
  if (!f.revenue && !f.capital && !days.length) { showToast('No data to export.', 'info'); return; }
  const lines = [];
  lines.push('=== CRISPY ROLL LEDGER EXPORT ===');
  lines.push('Generated,' + today());
  lines.push('');
  lines.push('=== OVERALL TOTALS ===');
  lines.push('Total Sales Revenue (Ks),' + Math.round(f.revenue));
  lines.push('Total Pieces Sold,' + f.salesPieces);
  lines.push('Total Bags Sold,' + f.salesBags);
  lines.push('Goods Cost of Sales (COGS, Ks),' + Math.round(f.cogs));
  lines.push('Total Profit (on sold, Ks),' + Math.round(f.net));
  lines.push('Total Capital Spent Rolling (Ks),' + Math.round(f.capital));
  lines.push('Total Pieces Rolled,' + f.productionPieces);
  lines.push('Total Bags Rolled,' + f.productionBags);
  lines.push('Total Labor Cost (Ks),' + Math.round(f.laborCost));
  lines.push('Ready-to-sell pieces on hand,' + ((state.stock && state.stock.pieces) || 0));
  lines.push('');
  lines.push('=== PRODUCTION (ROLLED) ===');
  lines.push('Date,Pieces,Bags,Weight/Roll (g),Mix Weight (g),Expected Rolls,vs Actual,Ingredient Cost (Ks),Additional (Ks),Capital (Ks),Labor Min,Labor Cost (Ks),Cost/Piece (Ks),Notes');
  prodList().forEach(function (p) {
    const ing = (p.capital || 0) - (p.additionalCost || 0);
    lines.push([p.date, p.pieces, p.bags, p.weightPerRoll || 0, p.mixWeight || 0, p.expectedRolls || '', (p.expectedRolls ? (p.pieces - p.expectedRolls) : ''), Math.round(ing), p.additionalCost || 0, p.capital || 0, p.laborMinutes || 0, p.laborCost || 0, p.costPerPiece || 0, (p.notes || '').replace(/,/g, ';')].join(','));
  });
  lines.push('');
  lines.push('=== SALES (SOLD) ===');
  lines.push('Date,Bags,Pieces,Pieces/Bag,Price/Bag (Ks),Amount (Ks),COGS (Ks),Net (Ks)');
  salesList().forEach(function (s) {
    lines.push([s.date, s.bags, s.pieces, s.bags ? (s.pieces / s.bags).toFixed(1) : '', s.price, s.amount || 0, s.cogs || 0, s.net || 0].join(','));
  });
  const blob = new Blob(['\uFEFF' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'daily-crispy-roll-ledger-' + today() + '.csv';
  a.click();
  URL.revokeObjectURL(a.href);
  showToast('Ledger exported to CSV successfully.');
});

