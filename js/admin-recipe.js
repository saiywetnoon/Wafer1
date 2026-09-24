/* ============================================================
   ADMIN — DEFAULT RECIPE MANAGER + PRODUCTION PROFIT COMPARE
   (admin-only — lives inside the Users & Permissions tab)

   1) DEFAULT RECIPE EDITOR (manual, unit-aware)
      Edits the standing recipe that pre-fills "Today's Qty" every day
      (state.settings.defaultUsage — the SAME store written by the Production
      form's "Save as Default Recipe" button, so there is one shared default).
        • one row per ingredient, editable qty (g items typed in g, counted
          items in units) with a live line cost + mix weight
        • Save   → writes state.settings.defaultUsage (+ provenance stamp)
        • Reset  → deletes it so forms fall back to the built-in DEFAULT_USAGE
      No migration: the stored shape is unchanged ({ name: qty }).

   2) PRODUCTION PROFIT COMPARE
      A single table of the last few actual batches + the active default recipe
      (as a "what-if") + every saved Tools recipe, each costed consistently at
      TODAY'S LAST SALE PRICE, using the SAME profit convention as Compare
      Price & Pack / Break-Even:
          profit = (price × bags) − (capital + labor)
      The most profitable row is highlighted; "Use in editor" loads a recipe
      into the Default Recipe editor (nothing is saved until you press Save).

   Profits grow/shrink with today's prices — it is a WHAT-IF snapshot, not a
   re-booking of history.
   ============================================================ */
'use strict';

/* ============================================================
   PURE MATH — extracted & unit-tested by _verify_admin_recipe.js
   ============================================================ */

/* Cost of one ingredient line — mirrors ingredientCostSingle() so the editor
   totals always agree with the Production form. Electricity keeps its
   tiered-bill pricing; gram items are priced per kg. */
function adminLineCost(ing, qty) {
  qty = parseFloat(qty) || 0;
  if (qty <= 0) return 0;
  if (ing && ing.name === 'Electricity' && typeof electricityBillParts === 'function') return electricityBillParts(qty).total;
  if (ing && ing.unit === 'g') return (qty / 1000) * (parseFloat(ing && ing.price) || 0);
  return qty * (parseFloat(ing && ing.price) || 0);
}

/* Gram-equivalent weight of one line (for mix-weight math). */
function adminMixWeightGrams(ing, qty) {
  qty = parseFloat(qty) || 0;
  if (qty <= 0) return 0;
  if (ing && ing.unit === 'g') return qty;
  return qty * (parseFloat(ing && ing.weightPerUnit) || 0);
}

/* Full ingredient-cost breakdown of a usage map. PURE given state.prices.
   Returns { rows, capital, mixWeight }; each row carries the display bits the
   editor renders (unit label, qty, weight g, line cost). */
function adminUsageCostBreakdown(usage) {
  usage = usage || {};
  var rows = (state.prices || []).map(function (ing) {
    var qty = parseFloat(usage[ing.name]) || 0;
    var unit = ing.unit === 'g' ? 'g' : 'unit';
    return {
      name: ing.name,
      unit: unit,
      unitLabel: unit === 'g' ? 'g' : 'units',
      price: parseFloat(ing.price) || 0,
      weightPerUnit: ing.weightPerUnit || null,
      qty: qty,
      weightGrams: Math.round(adminMixWeightGrams(ing, qty)),
      lineCost: Math.round(adminLineCost(ing, qty) * 100) / 100
    };
  });
  return {
    capital: Math.round(rows.reduce(function (s, r) { return s + r.lineCost; }, 0) * 100) / 100,
    mixWeight: rows.reduce(function (s, r) { return s + r.weightGrams; }, 0),
    rows: rows
  };
}

/* Expected finished pieces for a recipe = floor(mix grams ÷ grams/roll). */
function adminExpectedPieces(usage, weightPerRoll) {
  var grams = (state.prices || []).reduce(function (sum, ing) {
    return sum + adminMixWeightGrams(ing, usage && usage[ing.name]);
  }, 0);
  weightPerRoll = parseFloat(weightPerRoll) || 0;
  return weightPerRoll > 0 ? Math.floor(grams / weightPerRoll) : 0;
}

/* Full-set packing rule — same as the Production form: floor(pieces ÷ ppb). */
function adminExpectedBags(pieces, piecesPerBag) {
  pieces = parseFloat(pieces) || 0;
  piecesPerBag = parseFloat(piecesPerBag) || 0;
  return piecesPerBag > 0 ? Math.floor(pieces / piecesPerBag) : 0;
}

/* Median labor cost of recent batches — the labor estimate used for a recipe
   that was never actually run. PURE (0-cost rows are ignored). */
function adminMedianLaborCost(batches) {
  var costs = (batches || [])
    .map(function (p) { return parseFloat(p && p.laborCost) || 0; })
    .filter(function (n) { return n > 0; })
    .sort(function (a, b) { return a - b; });
  if (!costs.length) return 0;
  var mid = Math.floor(costs.length / 2);
  return costs.length % 2 === 0 ? (costs[mid - 1] + costs[mid]) / 2 : costs[mid];
}

/* One comparison row: profit at a given bag price.
   Convention = Compare Price & Pack / Break-Even:
     revenue = price × bags ;  profit = revenue − (capital + labor). PURE. */
function adminCompareRow(parts) {
  parts = parts || {};
  var priceBag = parseFloat(parts.priceBag) || 0;
  var pieces = Math.max(0, parseFloat(parts.pieces) || 0);
  var bags = Math.max(0, parseFloat(parts.bags) || 0);
  var capital = parseFloat(parts.capital) || 0;
  var laborCost = parseFloat(parts.laborCost) || 0;
  var costTotal = capital + laborCost;
  var revenue = priceBag * bags;
  var profit = Math.round((revenue - costTotal) * 100) / 100;
  return {
    kind: parts.kind || 'recipe',
    label: parts.label || '',
    sub: parts.sub || '',
    mixWeight: Math.round(parseFloat(parts.mixWeight) || 0),
    pieces: pieces,
    bags: bags,
    capital: capital,
    laborCost: laborCost,
    costTotal: Math.round(costTotal * 100) / 100,
    costPerPiece: pieces > 0 ? Math.round((costTotal / pieces) * 100) / 100 : 0,
    costPerBag: bags > 0 ? Math.round((costTotal / bags) * 100) / 100 : 0,
    revenue: Math.round(Math.max(0, revenue) * 100) / 100,
    profit: profit,
    margin: revenue > 0 ? (profit / revenue) * 100 : 0,
    usage: parts.usage || null,
    isDefault: !!parts.isDefault
  };
}

/* ============================================================
   LIVE VIEWS (DOM)
   ============================================================ */

var adminEditorSig = '';    // signature guard: never rebuild inputs while typing
var ADMIN_BATCH_LIMIT = 7;  // how many actual batches appear in the compare

function adminIsAdmin() {
  return typeof authIsAdmin === 'function' && !!authIsAdmin();
}

/* Effective default usage: custom override if present, else built-in. */
function adminDefaultUsage() {
  return (typeof defaultUsageMap === 'function') ? defaultUsageMap() : (DEFAULT_USAGE || {});
}

/* The custom override only (null when using the built-in recipe). */
function adminCustomUsage() {
  var c = state.settings && state.settings.defaultUsage;
  return (c && typeof c === 'object' && Object.keys(c).length) ? c : null;
}

/* Provenance stamp for the custom override (lives in settings, NOT inside the
   usage map, so the stored shape stays a clean { name: qty }). */
function adminAudit() {
  var s = state.settings || {};
  return { updatedAt: s.defaultUsageUpdatedAt || '', updatedBy: s.defaultUsageUpdatedBy || '' };
}

/* Change detector for the editor: rebuild inputs only when the underlying
   default recipe OR the price list changes, so typing is never wiped by an
   unrelated re-render (cloud refresh, stock change, etc). */
function adminEditorSignature() {
  var prices = (state.prices || []).map(function (p) {
    return p.name + '|' + (p.unit || '') + '|' + (p.price || 0) + '|' + (p.weightPerUnit || '');
  }).join(',');
  return prices + '::' + JSON.stringify(adminCustomUsage() || {});
}


function renderAdminRecipe(force) {
  var tbody = $('adminRecipeTable');
  if (!tbody) return;
  var sig = adminEditorSignature();
  if (!force && adminEditorSig === sig) {
    adminRefreshEditorTotals();
    return;
  }
  var b = adminUsageCostBreakdown(adminDefaultUsage());
  tbody.innerHTML = b.rows.map(function (r) {
    var priceStr;
    if (r.name === 'Electricity') priceStr = 'tiered bill';
    else if (r.unit === 'g') priceStr = fmtKs(r.price) + '/kg';
    else priceStr = fmtKs(r.price) + '/unit';
    return '<tr class="border-b border-gray-800">' +
      '<td class="py-1.5 pr-2 font-medium">' + esc(r.name) + '</td>' +
      '<td class="py-1.5 pr-2"><input type="number" min="0" step="0.01" value="' + esc(r.qty) + '" data-name="' + esc(r.name) + '" class="admin-usage-input w-20 px-1.5 py-1 rounded border border-gray-700 bg-gray-800 text-xs text-right focus:outline-none focus:ring-1 focus:ring-amber-500"></td>' +
      '<td class="py-1.5 pr-2 text-gray-500">' + r.unitLabel + '</td>' +
      '<td class="py-1.5 pr-2 text-gray-500 tabular-nums">' + priceStr + '</td>' +
      '<td class="py-1.5 pr-2 text-gray-400 tabular-nums">' + (r.unit === 'g' ? '—' : fmt(r.weightGrams)) + ' g</td>' +
      '<td class="py-1.5 text-amber-400 font-semibold tabular-nums">' + fmtKs(r.lineCost) + '</td>' +
      '</tr>';
  }).join('');
  tbody.querySelectorAll('.admin-usage-input').forEach(function (inp) {
    inp.addEventListener('input', adminRefreshEditorTotals);
  });
  adminEditorSig = sig;
  adminRefreshEditorTotals();
}

/* Read the current editor values back into a usage map. */
function adminReadEditorUsage() {
  var usage = {};
  var tb = $('adminRecipeTable');
  if (tb) {
    tb.querySelectorAll('.admin-usage-input').forEach(function (inp) {
      var v = parseFloat(inp.value);
      usage[inp.dataset.name] = (!isNaN(v) && v >= 0) ? v : 0;
    });
  }
  return usage;
}

function adminRefreshEditorTotals() {
  var b = adminUsageCostBreakdown(adminReadEditorUsage());
  var set = function (id, v) { var el = $(id); if (el) el.textContent = v; };

  var wpr = (typeof recentWeightPerRoll === 'function') ? recentWeightPerRoll() : 0;
  var ppb = (typeof stockAvgPiecesPerBag === 'function' && stockAvgPiecesPerBag() > 0)
    ? stockAvgPiecesPerBag()
    : (typeof DEFAULT_ROLLS_PER_BAG !== 'undefined' ? DEFAULT_ROLLS_PER_BAG : 5);
  var rolls = wpr > 0 ? Math.floor(b.mixWeight / wpr) : 0;
  var bags = adminExpectedBags(rolls, ppb);

  set('adminRecipeWeight', fmt(b.mixWeight) + ' g');
  set('adminRecipeCapital', fmtKs(b.capital));
  var rollsEl = $('adminRecipeRolls');
  if (rollsEl) {
    rollsEl.innerHTML = wpr > 0
      ? '<span class="text-emerald-400">' + fmt(rolls) + ' rolls</span> · <span class="text-gray-300">' + fmt(bags) + ' bags</span>' +
        '<div class="text-[10px] text-gray-500 mt-0.5">≈ ' + fmtKs(b.capital / Math.max(1, rolls)) + '/roll · ' + fmtKs(b.capital / Math.max(1, bags)) + '/bag (ingredient only)</div>'
      : '— <span class="text-[10px] text-gray-500">no weight/roll history yet; set it in the Production form</span>';
  }

  var custom = adminCustomUsage();
  var srcEl = $('adminRecipeSource');
  if (srcEl) {
    srcEl.textContent = custom ? 'CUSTOM DEFAULT' : 'BUILT-IN DEFAULT';
    srcEl.className = 'text-[10px] font-bold px-2 py-0.5 rounded-full border ' +
      (custom ? 'bg-amber-500/10 text-amber-400 border-amber-500/40' : 'bg-gray-800 text-gray-400 border-gray-700');
  }
  var upEl = $('adminRecipeUpdated');
  if (upEl) {
    var a = adminAudit();
    upEl.textContent = custom
      ? 'last edited ' + (a.updatedAt ? new Date(a.updatedAt).toLocaleString() : '(by admin)') + (a.updatedBy ? ' · ' + a.updatedBy : '')
      : 'Forms pre-fill from the built-in recipe until you save one below.';
  }
}

/* Load an arbitrary usage map into the editor inputs (from the compare table). */
function adminSetEditorUsage(usage) {
  usage = usage || {};
  (state.prices || []).forEach(function (ing) {
    var inp = document.querySelector('#adminRecipeTable .admin-usage-input[data-name="' + ing.name + '"]');
    if (inp) inp.value = (usage[ing.name] != null) ? usage[ing.name] : 0;
  });
  adminRefreshEditorTotals();
}

function saveAdminDefaultUsage() {
  if (!adminIsAdmin()) { showToast('Only an admin can change the default recipe.', 'error'); return; }
  var usage = adminReadEditorUsage();
  if (!Object.keys(usage).length) { showToast('No ingredient quantities to save.', 'error'); return; }
  state.settings = state.settings || {};
  state.settings.defaultUsage = usage;
  state.settings.defaultUsageUpdatedAt = new Date().toISOString();
  state.settings.defaultUsageUpdatedBy = (typeof authEmail === 'function' && authEmail()) || 'admin';
  persistState();
  renderAdminRecipe(true);
  renderAdminCompare();
  showToast('Default recipe saved — new days pre-fill from it.');
}

function resetAdminDefaultUsage() {
  if (!adminIsAdmin()) { showToast('Only an admin can change the default recipe.', 'error'); return; }
  if (!confirm('Reset the default recipe to the built-in one? Forms will fall back to the factory quantities (Flour 100 g, Tapioca 280 g, …).')) return;
  var s = state.settings || {};
  delete s.defaultUsage; delete s.defaultUsageUpdatedAt; delete s.defaultUsageUpdatedBy;
  state.settings = s;
  persistState();
  renderAdminRecipe(true);
  renderAdminCompare();
  showToast('Reset to the built-in default recipe.');
}


/* Assemble the comparison table: recent batches + active default + saved
   recipes, all costed at today's last sale price. */
function adminCompareRows() {
  var priceBag = (typeof lastSalePrice === 'function') ? lastSalePrice() : 0;
  var wpr = (typeof recentWeightPerRoll === 'function') ? recentWeightPerRoll() : 0;
  var ppb = (typeof stockAvgPiecesPerBag === 'function' && stockAvgPiecesPerBag() > 0)
    ? stockAvgPiecesPerBag()
    : (typeof DEFAULT_ROLLS_PER_BAG !== 'undefined' ? DEFAULT_ROLLS_PER_BAG : 5);
  var rows = [];

  // 1) Recent actual batches (newest first) — costs are what was really spent.
  var prods = (typeof prodList === 'function' ? prodList() : []).slice();
  var recent = prods.slice(-ADMIN_BATCH_LIMIT).reverse();
  recent.forEach(function (p) {
    var usage = p.usage || {};
    var capital = parseFloat(p.capital)
      || ((typeof ingredientCostFor === 'function' ? ingredientCostFor(usage) : 0) + (parseFloat(p.additionalCost) || 0));
    var pieces = parseFloat(p.pieces) || 0;
    var bags = (typeof productionBags === 'function') ? productionBags(p) : (parseFloat(p.bags) || 0);
    rows.push(adminCompareRow({
      kind: 'batch', label: p.date,
      sub: 'actual batch' + (p.notes ? ' — ' + p.notes : ''),
      usage: usage, mixWeight: parseFloat(p.mixWeight) || adminUsageCostBreakdown(usage).mixWeight,
      pieces: pieces, bags: bags,
      capital: capital, laborCost: parseFloat(p.laborCost) || 0, priceBag: priceBag
    }));
  });

  // 2) The active default recipe as a fresh what-if batch.
  var defUsage = adminDefaultUsage();
  var defB = adminUsageCostBreakdown(defUsage);
  var defPcs = adminExpectedPieces(defUsage, wpr);
  rows.push(adminCompareRow({
    kind: 'default', label: 'Default recipe',
    sub: 'what-if at ' + (wpr > 0 ? fmt(Math.round(wpr)) + ' g/roll' : 'recent weight/roll') +
         ' · labor = median of last ' + recent.length + ' batch(es)',
    isDefault: true, usage: defUsage, mixWeight: defB.mixWeight,
    pieces: defPcs, bags: adminExpectedBags(defPcs, ppb),
    capital: defB.capital, laborCost: adminMedianLaborCost(prods.slice(-8)), priceBag: priceBag
  }));

  // 3) Every saved Tools recipe, costed at its own mix.
  (state.recipes || []).forEach(function (r) {
    var u = r.usage || {};
    var pcs = adminExpectedPieces(u, wpr);
    var bb = adminUsageCostBreakdown(u);
    rows.push(adminCompareRow({
      kind: 'recipe', label: 'Recipe: ' + r.name,
      sub: 'saved Tools recipe', usage: u, mixWeight: bb.mixWeight,
      pieces: pcs, bags: adminExpectedBags(pcs, ppb),
      capital: bb.capital, laborCost: adminMedianLaborCost(prods.slice(-8)), priceBag: priceBag
    }));
  });

  rows.forEach(function (row, i) { row.key = row.kind + ':' + row.label + ':' + i; });

  // Highlight the most profitable row that has any revenue.
  var best = null;
  rows.forEach(function (r) { if (r.revenue > 0 && (!best || r.margin > best.margin)) best = r; });
  rows.forEach(function (r) { r.isBest = (best === r); });

  rows.sort(function (a, b) { return b.margin - a.margin; });
  return { rows: rows, priceBag: priceBag, wpr: wpr, ppb: ppb, best: best };
}

function renderAdminCompare() {
  var tbody = $('adminCompareTable');
  if (!tbody) return;
  var data = adminCompareRows();
  var info = $('adminCompareInfo');
  if (info) {
    info.textContent = data.priceBag > 0
      ? 'All rows costed at ' + fmtKs(Math.round(data.priceBag)) + '/bag · ' + fmt(data.ppb) + ' pcs/bag' + (data.wpr > 0 ? ' · ~' + fmt(Math.round(data.wpr)) + ' g/roll (recipe rows)' : '')
      : 'No sale price recorded yet — profit is 0 until a sale sets the bag price.';
  }
  if (!data.rows.length) {
    tbody.innerHTML = '<tr><td colspan="12" class="py-3 text-gray-500">No batches or recipes yet. Save a production batch or a Tools recipe to see it here.</td></tr>';
    return;
  }
  window.__adminCompareUsage = data.rows.map(function (r) { return r.usage; });
  tbody.innerHTML = data.rows.map(function (r, i) {
    var bestCls = r.isBest ? ' bg-emerald-500/10' : (r.kind === 'default' ? ' bg-amber-500/5' : '');
    var plus = r.profit > 0 ? '+' : '';
    var margin = r.revenue > 0 ? r.margin.toFixed(1) + '%' : '—';
    return '<tr class="border-b border-gray-800' + bestCls + '">' +
      '<td class="py-1.5 pr-2"><div class="font-semibold">' + esc(r.label) + (r.isDefault ? ' <span class="text-[9px] text-amber-400 bg-amber-500/10 px-1 py-0.5 rounded">ACTIVE</span>' : '') + '</div><div class="text-[10px] text-gray-500">' + esc(r.sub) + '</div></td>' +
      '<td class="py-1.5 pr-2 text-gray-400 tabular-nums">' + (r.mixWeight ? fmt(r.mixWeight) + ' g' : '—') + '</td>' +
      '<td class="py-1.5 pr-2 text-gray-400 tabular-nums">' + fmt(r.pieces) + '</td>' +
      '<td class="py-1.5 pr-2 text-gray-300 tabular-nums">' + fmt(r.bags) + '</td>' +
      '<td class="py-1.5 pr-2 tabular-nums">' + fmtKs(r.capital) + '</td>' +
      '<td class="py-1.5 pr-2 tabular-nums">' + fmtKs(r.laborCost) + '</td>' +
      '<td class="py-1.5 pr-2 text-gray-400 tabular-nums">' + fmtKs(r.costPerPiece) + '</td>' +
      '<td class="py-1.5 pr-2 text-gray-400 tabular-nums">' + fmtKs(r.costPerBag) + '</td>' +
      '<td class="py-1.5 pr-2 tabular-nums">' + fmtKs(r.revenue) + '</td>' +
      '<td class="py-1.5 pr-2 font-semibold tabular-nums ' + (r.profit > 0 ? 'text-emerald-400' : (r.profit < 0 ? 'text-red-400' : 'text-gray-400')) + '">' + plus + fmtKs(r.profit) + '</td>' +
      '<td class="py-1.5 pr-2 tabular-nums ' + (r.revenue > 0 ? (r.margin > 0 ? 'text-emerald-400' : 'text-red-400') : 'text-gray-500') + '">' + margin + '</td>' +
      '<td class="py-1.5">' + (r.usage
        ? '<button onclick="adminLoadCompareRow(' + i + ')" class="px-2 py-1 rounded bg-gray-800 hover:bg-gray-700 text-gray-300 text-[10px] font-bold">Use in editor</button>'
        : '') + '</td>' +
      '</tr>';
  }).join('');
}

/* Global handler for the compare table's "Use in editor" buttons. */
function adminLoadCompareRow(idx) {
  var byKey = (window.__adminCompareUsage || [])[idx];
  if (!byKey) return;
  adminSetEditorUsage(byKey);
  var card = $('adminRecipeCard');
  if (card && card.scrollIntoView) card.scrollIntoView({ behavior: 'smooth', block: 'start' });
  showToast('Loaded into the Default Recipe editor — press Save to make it the default.');
}

/* ---------- wiring (DOM is parsed before this script, matching app pattern) ---------- */
(function () {
  var s = $('adminRecipeSave'); if (s) s.addEventListener('click', saveAdminDefaultUsage);
  var r = $('adminRecipeReset'); if (r) r.addEventListener('click', resetAdminDefaultUsage);
})();

