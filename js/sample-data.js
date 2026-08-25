/* ============================================================
   SAMPLE DATA
   ============================================================ */
$('demoBtn').addEventListener('click', function () {
  if (Object.keys(state.entries).length) {
    showToast('Clear existing data first to load samples.', 'info');
    return;
  }
  const daysAgo = function (n) {
    const d = new Date();
    d.setDate(d.getDate() - n);
    const off = d.getTimezoneOffset();
    return new Date(d.getTime() - off * 60000).toISOString().slice(0, 10);
  };
  const samples = [
    { days: 29, bagsProduced: 38, pieces: 228, bagsSold: 32, price: 1300, labor: 240, mult: 1 },
    { days: 27, bagsProduced: 40, pieces: 240, bagsSold: 36, price: 1300, labor: 255, mult: 1 },
    { days: 25, bagsProduced: 35, pieces: 210, bagsSold: 30, price: 1300, labor: 220, mult: 1 },
    { days: 23, bagsProduced: 45, pieces: 270, bagsSold: 42, price: 1300, labor: 300, mult: 1.2 },
    { days: 21, bagsProduced: 37, pieces: 222, bagsSold: 33, price: 1300, labor: 235, mult: 1 },
    { days: 19, bagsProduced: 42, pieces: 252, bagsSold: 38, price: 1300, labor: 260, mult: 1.1 },
    { days: 17, bagsProduced: 36, pieces: 216, bagsSold: 31, price: 1300, labor: 225, mult: 1 },
    { days: 15, bagsProduced: 48, pieces: 288, bagsSold: 44, price: 1300, labor: 310, mult: 1.3 },
    { days: 13, bagsProduced: 39, pieces: 234, bagsSold: 34, price: 1300, labor: 245, mult: 1 },
    { days: 11, bagsProduced: 43, pieces: 258, bagsSold: 40, price: 1300, labor: 270, mult: 1.1 },
    { days: 9, bagsProduced: 36, pieces: 216, bagsSold: 32, price: 1300, labor: 230, mult: 1 },
    { days: 7, bagsProduced: 50, pieces: 300, bagsSold: 46, price: 1300, labor: 320, mult: 1.3 },
    { days: 5, bagsProduced: 40, pieces: 240, bagsSold: 35, price: 1300, labor: 250, mult: 1 },
    { days: 3, bagsProduced: 44, pieces: 264, bagsSold: 41, price: 1300, labor: 275, mult: 1.1 },
    { days: 1, bagsProduced: 38, pieces: 228, bagsSold: 34, price: 1300, labor: 240, mult: 1 }
  ];
  samples.forEach(function (s) {
    const date = daysAgo(s.days);
    const usage = {};
    state.prices.forEach(function (ing) {
      usage[ing.name] = Math.round((DEFAULT_USAGE[ing.name] || 0) * s.mult);
    });
    const ingCost = ingredientCostFor(usage);
    const capital = ingCost;
    const revenue = s.bagsSold * s.price;
    const laborHrs = s.labor / 60;
    const laborCost = laborHrs * state.settings.hourlyWage;
    const net = revenue - capital;
    state.entries[date] = {
      id: uid(),
      usage: usage,
      additionalCost: 0,
      capital: Math.round(capital),
      bagsProduced: s.bagsProduced,
      pieces: s.pieces,
      bagsSold: s.bagsSold,
      price: s.price,
      revenue: revenue,
      net: Math.round(net),
      laborMinutes: s.labor,
      laborCost: Math.round(laborCost),
      netAfterLabor: Math.round(net - laborCost),
      mixWeight: Math.round(totalMixWeightFor(usage))
    };
  });
  saveState();
  renderAll();
  showToast('Sample data loaded — explore the dashboard, calendar and audit trail.');
});

/* ============================================================
   CLEAR ALL
   ============================================================ */
$('clearBtn').addEventListener('click', function () {
  if (!Object.keys(state.entries).length) { showToast('No data to clear.', 'info'); return; }
  if (!confirm('Clear ALL daily entries? This cannot be undone.')) return;
  state.entries = {};
  saveState();
  triggerGoogleSync();
  renderAll();
  showToast('All data cleared.');
});

