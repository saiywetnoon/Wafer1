/* ============================================================
   SAMPLE DATA
   ============================================================ */
$('demoBtn').addEventListener('click', function () {
  if (Object.keys(state.entries).length || (state.production && state.production.length)) {
    showToast('Clear existing data first to load samples.', 'info');
    return;
  }
  const daysAgo = function (n) {
    const d = new Date();
    d.setDate(d.getDate() - n);
    const off = d.getTimezoneOffset();
    return new Date(d.getTime() - off * 60000).toISOString().slice(0, 10);
  };
  // Each sample is a production batch (rolled) plus a sale that may land
  // on the SAME day or a LATER day — showing production ≠ sales.
  const samples = [
    { roll: 29, sell: 27, bagsP: 38, pcs: 228, sold: 32, price: 1300, labor: 240, mult: 1 },
    { roll: 27, sell: 26, bagsP: 40, pcs: 240, sold: 36, price: 1300, labor: 255, mult: 1 },
    { roll: 25, sell: 24, bagsP: 35, pcs: 210, sold: 30, price: 1300, labor: 220, mult: 1 },
    { roll: 23, sell: 21, bagsP: 45, pcs: 270, sold: 42, price: 1300, labor: 300, mult: 1.2 },
    { roll: 21, sell: 20, bagsP: 37, pcs: 222, sold: 33, price: 1300, labor: 235, mult: 1 },
    { roll: 19, sell: 18, bagsP: 42, pcs: 252, sold: 38, price: 1300, labor: 260, mult: 1.1 },
    { roll: 17, sell: 15, bagsP: 36, pcs: 216, sold: 31, price: 1300, labor: 225, mult: 1 },
    { roll: 15, sell: 14, bagsP: 48, pcs: 288, sold: 44, price: 1300, labor: 310, mult: 1.3 },
    { roll: 13, sell: 12, bagsP: 39, pcs: 234, sold: 34, price: 1300, labor: 245, mult: 1 },
    { roll: 11, sell: 10, bagsP: 43, pcs: 258, sold: 40, price: 1300, labor: 270, mult: 1.1 },
    { roll: 9, sell: 8, bagsP: 36, pcs: 216, sold: 32, price: 1300, labor: 230, mult: 1 },
    { roll: 7, sell: 5, bagsP: 50, pcs: 300, sold: 46, price: 1300, labor: 320, mult: 1.3 },
    { roll: 5, sell: 4, bagsP: 40, pcs: 240, sold: 35, price: 1300, labor: 250, mult: 1 },
    { roll: 3, sell: 2, bagsP: 44, pcs: 264, sold: 41, price: 1300, labor: 275, mult: 1.1 },
    { roll: 1, sell: 0, bagsP: 38, pcs: 228, sold: 34, price: 1300, labor: 240, mult: 1 }
  ];
  state.production = [];
  state.sales = [];
  samples.forEach(function (s) {
    const rdate = daysAgo(s.roll);
    const usage = {};
    state.prices.forEach(function (ing) {
      usage[ing.name] = Math.round((DEFAULT_USAGE[ing.name] || 0) * s.mult);
    });
    const ingCost = ingredientCostFor(usage);
    const capital = ingCost;
    const laborHrs = s.labor / 60;
    const laborCost = laborHrs * state.settings.hourlyWage;
    state.production.push({
      id: uid(), date: rdate, pieces: s.pcs, bags: s.bagsP,
      usage: usage, additionalCost: 0, capital: Math.round(capital),
      laborMinutes: s.labor, laborCost: Math.round(laborCost),
      costPerPiece: Math.round((capital / s.pcs) * 100) / 100
    });
    // Sale on the sell-day (or 1 day after roll if sell:0 meaning still not sold).
    const sdate = daysAgo(s.sell <= 0 ? s.roll : s.sell);
    const soldBags = s.sell <= 0 ? 0 : Math.min(s.sold, s.bagsP);
    if (soldBags > 0) {
      // vary per-bag count slightly
      const perBag = 6 + (s.roll % 3); // 6, 7, or 8 per bag
      state.sales.push({
        id: uid(), date: sdate, bags: soldBags, pieces: soldBags * perBag,
        price: s.price, amount: soldBags * s.price, cogs: 0, avgCost: 0, net: 0
      });
    }
  });
  rebuildStockAndCogs();
  saveState();
  renderAll();
  showToast('Sample data loaded — roll dates and sale dates are separate, so you can see stock build up.');
});

/* ============================================================
   CLEAR ALL
   ============================================================ */
$('clearBtn').addEventListener('click', function () {
  const hasAny = Object.keys(state.entries).length || (state.production && state.production.length) || (state.sales && state.sales.length);
  if (!hasAny) { showToast('No data to clear.', 'info'); return; }
  if (!confirm('Clear ALL production, sales and stock? This cannot be undone.')) return;
  state.entries = {};
  state.production = [];
  state.sales = [];
  state.stock = { pieces: 0, cost: 0 };
  saveState();
  triggerGoogleSync();
  renderAll();
  showToast('All data cleared.');
});

