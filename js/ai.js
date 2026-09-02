/* ============================================================
   AI ROOT CAUSE ANALYSIS
   ------------------------------------------------------------
   Module  : window.AiAnalyzer — self-contained classic script
             (matches the js/ module convention of this project).
   Used by : index.html → <section id="tab-ai">. The generic
             .tab-btn handler in js/helpers.js calls renderAiAnalysis()
             when the tab opens; this module wires its own buttons.

   WHAT IT DOES
   ------------
   1. LOCAL DIAGNOSTIC ENGINE  (works offline, zero cost)
      It builds a "production profile" for a chosen date from the
      data already recorded in the ledger:
        • Yield gap        — pieces rolled vs expectedRolls
                             (mix weight ÷ weight per roll)
        • Weight/roll drift— today's weightPerRoll vs the median of
                             recent batches
        • Labor efficiency — labor minutes per 100 pieces vs baseline
        • Cost per piece   — capital ÷ pieces vs baseline
        • Waste            — today's waste vs typical daily waste
        • Recipe mix       — each ingredient's grams per 100 pieces
                             vs the historical ratio (measuring drift)
        • Quality notes    — keyword detection: "not crispy", "burnt",
                             "salty", "heavy", "broken", "sticky"...
      These signals are matched against a rules table that maps them
      to likely ROOT CAUSES, each with a confidence score, the exact
      evidence trail, and concrete checks / fixes for the kitchen.

   2. OPTIONAL LLM NARRATIVE  (needs an OpenAI-compatible API key)
      If you add a key in the ⚙ panel, the same (aggregate, private-
      safe) profile is sent to a chat/completions endpoint and the
      LLM writes a plain-language root-cause narrative. The key is
      stored ONLY on this device (localStorage, per-company key),
      is never part of the synced ledger, and everything degrades
      gracefully to the local engine when the call fails/offline.

   DESIGN PRINCIPLES
   -----------------
   • Data privacy — the LLM prompt only contains daily aggregates and
     note keywords, never customer names, phone numbers or balances.
   • Testability — all pure logic (profile, rules, scoring, prompt)
     is exposed via window.AiAnalyzer and is exercised by
     _verify_ai.js with a Node DOM/state stub.
   ============================================================ */
(function () {
  'use strict';

  /* ---------- Config (per-company, local-only) ---------- */
  var AI_CONFIG_PREFIX = 'dailyCrispyRollLedger_aiConfig';
  var LLM_TIMEOUT_MS = 30000;

  function aiConfigKey() {
    var id = (typeof ACTIVE_COMPANY !== 'undefined' && ACTIVE_COMPANY) ? ACTIVE_COMPANY.id : 'default';
    return AI_CONFIG_PREFIX + (id === 'default' ? '' : '_' + id);
  }
  function aiGetConfig() {
    try {
      var raw = (typeof localStorage !== 'undefined') ? localStorage.getItem(aiConfigKey()) : null;
      if (!raw) return {};
      var c = JSON.parse(raw) || {};
      if (typeof c !== 'object') return {};
      return c;
    } catch (e) { return {}; }
  }
  function aiSaveConfig(cfg) {
    try {
      if (typeof localStorage !== 'undefined') localStorage.setItem(aiConfigKey(), JSON.stringify(cfg || {}));
    } catch (e) { /* config save is best-effort */ }
  }

  /* ---------- Small numeric helpers ---------- */
  function toNum(v, fallback) {
    var n = parseFloat(v);
    return isFinite(n) ? n : (fallback === undefined ? 0 : fallback);
  }
  function median(list) {
    var arr = (list || []).filter(function (x) { return isFinite(x); }).map(Number).sort(function (a, b) { return a - b; });
    if (!arr.length) return 0;
    var mid = Math.floor(arr.length / 2);
    return arr.length % 2 ? arr[mid] : (arr[mid - 1] + arr[mid]) / 2;
  }
  function average(list) {
    var arr = (list || []).filter(function (x) { return isFinite(x); }).map(Number);
    if (!arr.length) return 0;
    return arr.reduce(function (s, x) { return s + x; }, 0) / arr.length;
  }
  /* Percent that `value` is above (+) or below (−) `ref`. */
  function pctDiff(value, ref) {
    if (!isFinite(value) || !isFinite(ref) || ref === 0) return 0;
    return (value - ref) / ref * 100;
  }
  function safeDiv(a, b) {
    return isFinite(a) && isFinite(b) && b !== 0 ? a / b : 0;
  }
/* ---------- Formatting / escaping helpers (self-contained) ---------- */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      if (c === '&') return '&amp;';
      if (c === '<') return '&lt;';
      if (c === '>') return '&gt;';
      if (c === '"') return '&quot;';
      return '&#39;';
    });
  }
  function round1(v) {
    return (Math.round((toNum(v)) * 10) / 10).toLocaleString('en-US');
  }
  function fmtInt(v) {
    return Math.round(toNum(v)).toLocaleString('en-US');
  }
  function fmtPct(v) {
    v = toNum(v);
    return (v > 0 ? '+' : '') + round1(v) + '%';
  }
  function fmtKs(v) {
    return Math.round(toNum(v)).toLocaleString('en-US') + ' Ks';
  }
/* ============================================================
     QUALITY-NOTE KEYWORD CLASSIFIER
     Maps free-text batch notes ("good & crispy", "a bit salty",
     "not crispy this time") onto symptom flags the rules can use.
     ============================================================ */
  var NEG_WORD_RE = /(?:^|\s)(not|no|less|wont|doesnt|didnt|never)(?:\s+|$)/i;

  function hasNoteKeyword(notes, re) {
    if (!notes) return false;
    re.lastIndex = 0;
    var m = re.exec(notes);
    if (!m) return false;
    /* If the keyword is negated ("not crispy", "no sugar"), don't
       count it as a positive symptom signal. */
    var before = notes.slice(Math.max(0, m.index - 12), m.index);
    if (NEG_WORD_RE.test(before)) return false;
    return true;
  }

  function summarizeNotes(notes) {
    var out = {
      undercooked: false, overcooked: false, salty: false, sweet: false,
      heavy: false, light: false, breakable: false, oily: false,
      uneven: false, stale: false, hard: false, slow: false, good: false
    };
    var t = ' ' + String(notes || '').toLowerCase() + ' ';
    /* "not crispy" must be caught as UNDERCOOKED even though "crispy"
       alone would normally count as GOOD. Check negated forms first. */
    var negCrispy = /\bnot\s+crispy\b/.test(t);
    out.undercooked = negCrispy || (hasNoteKeyword(t, /\btoo\s+soft\b|\bchewy\b|\bdoughy\b|\bnot\s+firm\b|\bunder.?cook(ed)?\b|\bsoggy\b|\bsquishy\b|\bsticky\b|\braw(er)?\b|\bgooey\b|\bsoft(er|ening)?\b/i) && !/\btoo?\s+crispy\b/.test(t));
    out.overcooked = hasNoteKeyword(t, /\bburnt\b|\bburned\b|\bdark(er)?\b|\bscorch(ed)?\b|\bover.?cook(ed)?\b|\bblacken(ed)?\b|\bsmok(y|ey)?\b/i);
    out.salty = hasNoteKeyword(t, /\bsal(t|ty)\b/i);
    out.sweet = hasNoteKeyword(t, /\btoo\s+sweet\b|\bsugary\b|\bover.?sweet\b/i);
    out.heavy = hasNoteKeyword(t, /\bover.?weight\b|\btoo\s+heavy\b|\bheavy\b|\bthick(er)?\b|\btoo\s+big\b|\btoo\s+fat\b/i);
    out.light = hasNoteKeyword(t, /\bunder.?weight\b|\btoo\s+light\b|\bthin(ner)?\b|\btoo\s+small\b|\btoo\s+tiny\b|\bskinny\b/i);
    out.breakable = hasNoteKeyword(t, /\bbreak(s|ing|able)?\b|\bbroke(n)?\b|\bcrumbling?\b|\bcrack(s|ed)?\b/i);
    out.oily = hasNoteKeyword(t, /\boily\b|\bgreasy\b|\btoo\s+much\s+oil\b/i);
    out.uneven = hasNoteKeyword(t, /\bun?even\b|\binconsistent\b|\bmix(ed)?\s+(up|results)\b|\bpatchy\b/i);
    out.stale = hasNoteKeyword(t, /\bstale\b|\bwent\s+off\b|\bhardened\b/i);
    out.hard = hasNoteKeyword(t, /\btoo\s+hard\b|\btooth.?break\b|\bhard\s+as\b/i);
    out.slow = hasNoteKeyword(t, /\bslow(fin g|ly)?\b|\bbreakdown\b|\bmachine\b|\bmotor\b|\bstoppage\b|\bwait(ed|ing)?\s+too\s+long\b|\bdelay(ed)?\b/i);
    out.good = (hasNoteKeyword(t, /\bgood\b|\bcrispy\b|\bgreat\b|\bperfect\b|\bnice\b|\bexcellent\b|\bon\s+point\b/i)) && !negCrispy;
    return out;
  }
/* ============================================================
     PRODUCTION PROFILE
     Collects today's batch + the recent history into one object of
     normalized metrics that the rules engine can reason about.
     ============================================================ */
  function historyBatches(date, max) {
    max = max || 30;
    return (typeof state !== 'undefined' && state.production || [])
      .filter(function (p) { return p && p.date && p.date < date; })
      .sort(function (a, b) { return a.date === b.date ? 0 : (a.date < b.date ? 1 : -1); })
      .slice(0, max);
  }

  function dailyWasteSums(excludeDate) {
    var sums = {};
    ((typeof state !== 'undefined' && state.waste) || []).forEach(function (w) {
      if (!w || !w.date) return;
      if (excludeDate && w.date === excludeDate) return;
      sums[w.date] = toNum(sums[w.date]) + toNum(w.qty);
    });
    return Object.keys(sums).map(function (d) { return sums[d]; });
  }

  function addDays(dateStr, days) {
    var d = new Date(dateStr + 'T00:00:00');
    d.setDate(d.getDate() + days);
    var off = d.getTimezoneOffset();
    return new Date(d.getTime() - off * 60000).toISOString().slice(0, 10);
  }
function ingredientAnomalies(batch, history) {
    var out = [];
    if (!batch || !batch.pieces || batch.pieces <= 0 || !history.length) return out;
    var prices = (typeof state !== 'undefined' && state.prices) || [];
    prices.forEach(function (ing) {
      var qty = toNum((batch.usage || {})[ing.name]);
      if (qty <= 0) return;
      var ratios = [];
      history.forEach(function (p) {
        var q = toNum((p.usage || {})[ing.name]);
        if (p.pieces > 0 && q > 0) ratios.push(q / p.pieces * 100);
      });
      if (!ratios.length) return;
      var med = median(ratios);
      if (med <= 0) return;
      var ratio = qty / batch.pieces * 100;
      var diff = pctDiff(ratio, med);
      if (Math.abs(diff) >= 20) out.push({ name: ing.name, ratio: ratio, median: med, diff: diff });
    });
    out.sort(function (a, b) { return Math.abs(b.diff) - Math.abs(a.diff); });
    return out.slice(0, 3);
  }
function buildProfileForDate(date) {
    var production = (typeof state !== 'undefined' && state.production) || [];
    var batch = production.filter(function (p) { return p && p.date === date; })
      .sort(function (a, b) { return (b && b.id ? b.id : '').localeCompare(a && a.id ? a.id : ''); })[0] || null;
    var history = historyBatches(date);

    var profile = {
      date: date,
      hasBatch: !!batch,
      batch: batch,
      historyCount: history.length,
      notes: batch ? (batch.notes || '') : '',
      pieces: batch ? toNum(batch.pieces) : 0,
      bags: batch ? toNum(batch.bags) : 0,
      expectedRolls: batch ? toNum(batch.expectedRolls) : 0,
      mixWeight: batch ? toNum(batch.mixWeight) : 0,
      weightPerRoll: batch ? toNum(batch.weightPerRoll) : 0,
      laborMinutes: batch ? toNum(batch.laborMinutes) : 0,
      capital: batch ? toNum(batch.capital) : 0,
      additionalCost: batch ? toNum(batch.additionalCost) : 0,
      costPerPiece: batch && batch.pieces > 0 ? safeDiv(toNum(batch.capital), toNum(batch.pieces)) : 0
    };

    /* Yield — how close actual pieces landed to the batter's expected rolls. */
    profile.yieldPct = profile.expectedRolls > 0 ? safeDiv(profile.pieces, profile.expectedRolls) * 100 : null;
    profile.yieldShortfallPcs = profile.expectedRolls > 0 ? Math.max(0, profile.expectedRolls - profile.pieces) : 0;

    /* Weight-per-roll vs recent median (only meaningful batches) */
    var wprHistory = history.filter(function (p) { return toNum(p.weightPerRoll) > 0; }).map(function (p) { return toNum(p.weightPerRoll); });
    profile.wprMedian = median(wprHistory);
    profile.wprPctDiff = profile.weightPerRoll > 0 && profile.wprMedian > 0 ? pctDiff(profile.weightPerRoll, profile.wprMedian) : 0;

    /* Labor efficiency: minutes per 100 pieces */
    profile.laborPer100 = profile.pieces > 0 ? safeDiv(profile.laborMinutes, profile.pieces) * 100 : 0;
    var laborHistory = history.filter(function (p) { return toNum(p.pieces) > 0; })
      .map(function (p) { return safeDiv(toNum(p.laborMinutes), toNum(p.pieces)) * 100; });
    profile.laborMedian = median(laborHistory);
    profile.laborPctDiff = profile.laborMedian > 0 && profile.laborPer100 > 0 ? pctDiff(profile.laborPer100, profile.laborMedian) : 0;
/* Cost per piece vs recent median */
    var costHistory = history.filter(function (p) { return toNum(p.pieces) > 0; })
      .map(function (p) { return safeDiv(toNum(p.capital), toNum(p.pieces)); });
    profile.costMedian = median(costHistory);
    profile.costPctDiff = profile.costMedian > 0 && profile.costPerPiece > 0 ? pctDiff(profile.costPerPiece, profile.costMedian) : 0;

    /* Waste today vs typical daily waste */
    profile.wasteToday = ((typeof state !== 'undefined' && state.waste) || [])
      .filter(function (w) { return w && w.date === date; })
      .reduce(function (s, w) { return s + toNum(w.qty); }, 0);
    profile.wasteMedian = median(dailyWasteSums(date));
    profile.wastePctDiff = profile.wasteMedian > 0 ? pctDiff(profile.wasteToday, profile.wasteMedian) : 0;

    /* Pieces per bag vs history */
    profile.piecesPerBag = profile.bags > 0 ? safeDiv(profile.pieces, profile.bags) : 0;
    var ppbHistory = history.filter(function (p) { return toNum(p.bags) > 0 && toNum(p.pieces) > 0; })
      .map(function (p) { return safeDiv(toNum(p.pieces), toNum(p.bags)); });
    profile.ppbMedian = median(ppbHistory);

    /* Ingredient mix drift (grams per 100 pieces) */
    profile.ingredientAnomalies = ingredientAnomalies(batch, history);

    /* Keyword flags from today's quality notes */
    profile.keywords = summarizeNotes(profile.notes);

    /* Expiry risk — today's batch is past its use-by */
    profile.expired = !!(batch && batch.useBy && batch.useBy < date);
    profile.expiringSoon = !!(batch && batch.useBy && batch.useBy >= date && batch.useBy <= addDays(date, 3));

    return profile;
  }
/* ============================================================
     RULES ENGINE — maps the profile to likely root causes.
     Each rule produces a finding with:
       id, category, phase, severity, confidence (0-100),
       title, summary, evidence[], fixes[] (action + detail),
       impact (estimated Kg/Pcs/Ks lost this batch).
     ============================================================ */
  function finding(cfg) {
    return {
      id: cfg.id,
      category: cfg.category,
      phase: cfg.phase,
      severity: cfg.severity,
      confidence: cfg.confidence,
      title: cfg.title,
      summary: cfg.summary,
      evidence: cfg.evidence || [],
      fixes: cfg.fixes || [],
      impact: cfg.impact || null
    };
  }

  function fix(action, detail) {
    return { action: action, detail: detail };
  }

  function diagnose(profile) {
    var out = [];
    if (!profile || !profile.hasBatch) return out;
    // Batch recorded but packaging not finished — no actual counts yet, so
    // yield/weight/labor/cost findings would be misleading. The UI shows an
    // "update after packing" card instead.
    if (!(parseFloat(profile.pieces) > 0)) return out;

    var k = profile.keywords || {};
    var p = profile;

    /* ---- 1) Roll weight too high → fewer pieces + thick rolls ---- */
    if (p.wprPctDiff >= 10) {
      var lostPcs = p.expectedRolls > 0 ? Math.max(0, p.expectedRolls - p.pieces) : 0;
      out.push(finding({
        id: 'weight-high', category: 'weight', phase: 'rolling',
        severity: lostPcs >= 10 ? 'high' : 'medium',
        confidence: Math.min(95, 55 + Math.abs(p.wprPctDiff) / 2 + (lostPcs >= 5 ? 10 : 0)),
        title: 'Rolls are coming out heavier than usual',
        summary: 'Weight per roll is ' + fmtPct(p.wprPctDiff) + ' above your recent median (' + round1(p.weightPerRoll) + ' g vs usually ' + round1(p.wprMedian) + ' g). Heavier rolls use batter faster, so you ended up with ' + fmtInt(lostPcs) + ' fewer pieces than the batter should make.',
        evidence: [
          'Weight/roll today: ' + round1(p.weightPerRoll) + ' g · recent median: ' + round1(p.wprMedian) + ' g',
          'Expected rolls from batter: ' + fmtInt(p.expectedRolls) + ' · rolled: ' + fmtInt(p.pieces)
        ],
        fixes: [
          fix('Recalibrate the rolling portion', 'Weigh every 5th roll for one batch and re-tune the scoop/spoon size to hit ' + round1(p.wprMedian) + ' g.'),
          fix('Slow the rolling speed', 'Gently firm, uniform pressure — ask everyone on the line to compare their rolls on the scale.'),
          fix('Check the batter hydration', 'A stiffer batter rolls thicker; if weight stays high, check water/palm-sugar measurement from the mix phase.')
        ],
        impact: { label: '≈ ' + fmtInt(lostPcs) + ' pcs lost to over-weight rolls', pcs: lostPcs }
      }));
    }

    /* ---- 2) Roll weight too low → thin, fragile, under-weight ---- */
    if (p.wprPctDiff <= -10) {
      out.push(finding({
        id: 'weight-low', category: 'weight', phase: 'rolling',
        severity: 'medium',
        confidence: Math.min(90, 55 + Math.abs(p.wprPctDiff) / 2),
        title: 'Rolls are coming out lighter / thinner than usual',
        summary: 'Weight per roll is ' + fmtPct(p.wprPctDiff) + ' under the recent median. Thin rolls break easily and customers complain about under-weight bags.',
        evidence: [
          'Weight/roll today: ' + round1(p.weightPerRoll) + ' g · recent median: ' + round1(p.wprMedian) + ' g'
        ],
        fixes: [
          fix('Add more batter per roll', 'Increase the portion per roll until a test batch sits at ' + round1(p.wprMedian) + ' g.'),
          fix('Check batter is not too runny', 'If the batter pours too thin, check water quantity / resting time in the mix phase.')
        ],
        impact: { label: 'Under-weight batches risk refunds & breakage', pcs: 0 }
      }));
    }
/* ---- 3) Yield shortfall without a weight cause = batter/material loss ---- */
    if (p.expectedRolls > 0 && p.pieces < p.expectedRolls * 0.95 && Math.abs(p.wprPctDiff) < 10) {
      var short = p.expectedRolls - p.pieces;
      out.push(finding({
        id: 'yield-loss', category: 'yield', phase: 'mixing',
        severity: short >= 10 ? 'high' : 'medium',
        confidence: Math.min(90, 55 + short / 2),
        title: 'Batter made ' + fmtInt(p.expectedRolls) + ' rolls but only ' + fmtInt(p.pieces) + ' came out',
        summary: 'Even though roll weight is normal, the batter produced ' + fmtInt(short) + ' fewer pieces than its weight should yield. That usually means material is lost somewhere — spillage, stuck batter, or a batch that was thrown away.',
        evidence: [
          'Mix weight: ' + fmtInt(p.mixWeight) + ' g · expected: ' + fmtInt(p.expectedRolls) + ' rolls · rolled: ' + fmtInt(p.pieces) + ' pcs',
          'Yield: ' + round1(p.yieldPct) + '% of expected'
        ],
        fixes: [
          fix('Measure the full mix exactly', 'Weigh ingredients into the mixer and re-check each pour; a 5% measuring slip shows up as exactly this gap.'),
          fix('Look for batter loss between mixing and pan', 'Stuck batter in the mixer bowl, transfers, and scraped-side spills are the classic culprits.'),
          fix('Track an ingredient-waste record', 'Log spills in Inventory → Record Ingredient Waste so the next analysis can separate spoilage from measurement.')
        ],
        impact: { label: '≈ ' + fmtInt(short) + ' pcs lost (batter shortfall)', pcs: short }
      }));
    }

    /* ---- 4) Labor efficiency dropped ---- */
    if (p.laborPctDiff >= 15) {
      var extraMin = p.laborMinutes - safeDiv(p.pieces, 100) * p.laborMedian;
      out.push(finding({
        id: 'labor-slow', category: 'labor', phase: 'rolling',
        severity: p.laborPctDiff >= 30 ? 'high' : 'medium',
        confidence: Math.min(90, 50 + p.laborPctDiff / 2),
        title: 'Production ran slower than usual',
        summary: 'You took ' + round1(p.laborPer100) + ' min per 100 pieces vs a usual ' + round1(p.laborMedian) + ' — about ' + fmtPct(p.laborPctDiff) + ' slower. Slow runs usually mean breakdowns, waiting, or re-rolling.',
        evidence: [
          'Labor today: ' + fmtInt(p.laborMinutes) + ' min for ' + fmtInt(p.pieces) + ' pcs',
          'Baseline: ' + round1(p.laborMedian) + ' min / 100 pcs'
        ],
        fixes: [
          fix('Check for equipment downtime', 'If a pan or mixer stalled, log it in the batch notes ("breakdown / motor") so the AI can link it to slow days.'),
          fix('Review staffing / workflow', 'One slow station on the line slows everything; watch the rolling + packing handoff.'),
          fix('Reduce re-rolling', 'If slow days also have quality issues, fix the root cause first — re-rolled batches double the labor time.')
        ],
        impact: { label: '≈ +' + fmtInt(Math.max(0, Math.round(extraMin))) + ' min vs baseline', pcs: 0 }
      }));
    }

    /* ---- 5) Cost per piece jumped ---- */
    if (p.costPctDiff >= 10) {
      out.push(finding({
        id: 'cost-up', category: 'cost', phase: 'planning',
        severity: p.costPctDiff >= 20 ? 'high' : 'medium',
        confidence: Math.min(85, 45 + p.costPctDiff / 2),
        title: 'Each piece is costing more than usual',
        summary: 'Cost per piece is ' + fmtPct(p.costPctDiff) + ' above baseline. Your margin shrinks by the same amount, even if you sell everything.',
        evidence: [
          'Cost/piece today: ' + round1(p.costPerPiece) + ' Ks · recent median: ' + round1(p.costMedian) + ' Ks',
          'Capital: ' + fmtInt(p.capital) + ' Ks for ' + fmtInt(p.pieces) + ' pcs'
        ],
        fixes: [
          fix('Check ingredient prices', 'A recent price-list increase raises every piece; compare with the Price History in Business Tools ⟶ Price History.'),
          fix('Look for yield loss first', 'High weight/roll and batter loss both raise cost-per-piece — the root is often one of those, not the price.'),
          fix('Control additional costs', 'If extra costs (gas, oil, packaging) spiked, that is included in capital — trace the day\'s additional cost line.')
        ],
        impact: { label: '≈ ' + fmtKs((p.costPerPiece - p.costMedian) * p.pieces) + ' extra on this batch', pcs: 0 }
      }));
    }
/* ---- 6) Waste spike ---- */
    if (p.wasteToday > 0 && p.wasteToday > (p.wasteMedian * 1.5 + 2)) {
      out.push(finding({
        id: 'waste-spike', category: 'waste', phase: 'packing',
        severity: p.wasteToday >= 25 ? 'high' : 'medium',
        confidence: Math.min(92, 60 + (p.wasteToday / (p.wasteMedian || 1))),
        title: 'Breakage / waste is higher than normal today',
        summary: 'You logged ' + fmtInt(p.wasteToday) + ' wasted pieces vs a typical ' + round1(p.wasteMedian) + ' per day. Big waste days are almost always breakage in rolling/packing or a bad frying batch.',
        evidence: [
          'Waste today: ' + fmtInt(p.wasteToday) + ' pcs · typical: ' + round1(p.wasteMedian) + ' pcs/day',
          'That is ' + fmtPct(p.wastePctDiff) + ' vs usual (0 if usual is zero)'
        ],
        fixes: [
          fix('Note WHY pieces were wasted', 'Add a reason on the Waste log ("broke in packing", "burnt batch") — the AI reads those reasons to pin the root cause.'),
          fix('Check roll firmness', 'Soft/under-crisp rolls break in the bag. If waste coincides with thin rolls, fix weight/roll first.'),
          fix('Review packing handling', 'Over-stuffing bags or rough handling during packing is the #1 cause of broken wafers.')
        ],
        impact: { label: '≈ ' + fmtInt(p.wasteToday) + ' pcs scrapped today', pcs: p.wasteToday }
      }));
    }

    /* ---- 7) Ingredient mix drift (grams per 100 pieces) ---- */
    (p.ingredientAnomalies || []).forEach(function (an, i) {
      var direction = an.diff > 0 ? 'more' : 'less';
      out.push(finding({
        id: 'ingredient-' + i, category: 'recipe', phase: 'mixing',
        severity: Math.abs(an.diff) >= 40 ? 'high' : 'medium',
        confidence: Math.min(85, 55 + Math.abs(an.diff) / 3),
        title: an.name + ' ratio is ' + fmtPct(an.diff) + ' vs your usual batch',
        summary: 'This batch used ' + direction + ' ' + an.name + ' than the recipe usually calls for (per 100 pieces). A sudden change in one ingredient usually means a measuring slip or an intentional recipe tweak that has consequences downstream.',
        evidence: [
          'Today: ' + round1(an.ratio) + ' g per 100 pcs · usual: ' + round1(an.median) + ' g per 100 pcs',
          'Diff: ' + fmtPct(an.diff)
        ],
        fixes: [
          fix('Re-check the ' + an.name + ' measurement', 'Weigh the container and the used amount — a missing/extra scoop shows up exactly like this.'),
          fix('Confirm the recipe before scaling', 'If you changed the mix on purpose, update the saved recipe so future batches (and this analysis) compare against the new target.'),
          fix('Watch the linked symptoms', direction === 'more' ? 'Too much of a dry ingredient makes stiff, heavy batter — check today\'s roll weight and crispness.' : 'A short ingredient can make batter too runny or weak — check crispness and breakage.')
        ],
        impact: { label: 'Measuring drift in ' + an.name, pcs: 0 }
      }));
    });
/* ---- 8) Quality notes — undercooked / soft ---- */
    if (k.undercooked && !k.overcooked) {
      out.push(finding({
        id: 'q-undercooked', category: 'quality', phase: 'frying',
        severity: 'medium',
        confidence: 80,
        title: 'Rolls came out soft / not crispy',
        summary: 'Your notes say the batch was not crispy. That is a frying symptom: heat too low, rolls taken out too early, or batter too thick so the inside stays soft while the outside colours.',
        evidence: ['Quality note: "' + esc(p.notes) + '"'],
        fixes: [
          fix('Check the pan temperature', 'Confirm the pan is at full heat before dropping rolls — a cooler pan makes soft, chewy wafers.'),
          fix('Lengthen the final-heat time', 'Give the last 20 s its full time (see Fry Timers settings); pulling early = soft rolls.'),
          fix('Thin the batter slightly', 'If rolls are also heavy, reduce batter per roll so the middle cooks through.')
        ],
        impact: { label: 'Soft rolls: refunds & rework risk', pcs: 0 }
      }));
    }

    /* ---- 9) Quality notes — overcooked / burnt ---- */
    if (k.overcooked) {
      out.push(finding({
        id: 'q-overcooked', category: 'quality', phase: 'frying',
        severity: 'high',
        confidence: 85,
        title: 'Rolls came out burnt / too dark',
        summary: 'Your notes mention burnt or over-cooked rolls. Heat is too high, the final stage runs too long, or the batter is thinner than usual so it browns faster.',
        evidence: ['Quality note: "' + esc(p.notes) + '"'],
        fixes: [
          fix('Lower the pan temperature slightly', 'Bring it back to the normal frying temperature and re-test one roll.'),
          fix('Shorten / watch the final heat stage', 'Use the Fry Timers panel and check the batch at the fold point — burnt rolls come from the last 20 s running long.'),
          fix('Check roll thickness', 'Thin rolls crisp and burn much faster; add batter per roll if weight is low.')
        ],
        impact: { label: 'Burnt rolls are usually scrapped', pcs: 0 }
      }));
    }

    /* ---- 10) Quality notes — too salty / sweet ---- */
    if (k.salty || k.sweet) {
      out.push(finding({
        id: 'q-flavour', category: 'quality', phase: 'mixing',
        severity: 'medium',
        confidence: 78,
        title: 'Batch flavour is off (' + (k.salty ? 'salty' : '') + (k.salty && k.sweet ? ' & ' : '') + (k.sweet ? 'sweet' : '') + ')',
        summary: 'A flavour complaint points at the seasoning measurements in the mix, or a brand/grade change of an ingredient.',
        evidence: ['Quality note: "' + esc(p.notes) + '"'],
        fixes: [
          fix('Re-measure the seasoning scoop', 'Salt and sugar are the first things to drift — weigh the exact amounts next batch.'),
          fix('Check ingredient brand changes', 'A new batch of salt or sugar can taste different at the same weight; adjust the recipe and update the saved recipe.')
        ],
        impact: { label: 'Off-flavour batches hurt repeat customers', pcs: 0 }
      }));
    }

    /* ---- 11) Quality notes — breakable / crumbling ---- */
    if (k.breakable || k.light) {
      out.push(finding({
        id: 'q-breakable', category: 'quality', phase: 'frying',
        severity: 'medium',
        confidence: 75,
        title: 'Rolls are breaking / too fragile',
        summary: 'Breakage complaints line up with thin or over-crisped rolls. Fragile wafers waste money in packing and disappoint customers opening the bag.',
        evidence: [
          'Quality note: "' + esc(p.notes) + '"',
          (p.weightPerRoll ? 'Weight/roll today: ' + round1(p.weightPerRoll) + ' g' : '')
        ].filter(Boolean),
        fixes: [
          fix('Add batter per roll', 'Slightly thicker rolls are sturdier — nudge weight/roll up toward the median.'),
          fix('Stop frying just short of the brittle point', 'Take the batch off a touch earlier so the core stays flexible.'),
          fix('Soften packing handling', 'Gentler bag-fill and less stacking pressure cuts breakage sharply.')
        ],
        impact: { label: 'Breakage costs pcs + refunds', pcs: 0 }
      }));
    }

    /* ---- 12) Quality notes — oily / greasy ---- */
    if (k.oily) {
      out.push(finding({
        id: 'q-oily', category: 'quality', phase: 'frying',
        severity: 'medium',
        confidence: 76,
        title: 'Rolls came out oily / greasy',
        summary: 'Greasy wafers mean the oil was not hot enough (rolls soak oil) or they sat in oil too long after cooking.',
        evidence: ['Quality note: "' + esc(p.notes) + '"'],
        fixes: [
          fix('Heat oil fully before frying', 'Cold oil soaks into the batter — let it reach full temperature first.'),
          fix('Drain immediately after cooking', 'Lift rolls out promptly and let them drain on a rack instead of sitting in oil.')
        ],
        impact: { label: 'Oily rolls: quality complaint', pcs: 0 }
      }));
    }
/* ---- 13) Pieces-per-bag drift (giving away money or shorting) ---- */
    if (p.piecesPerBag > 0 && p.ppbMedian > 0 && Math.abs(p.piecesPerBag - p.ppbMedian) >= 0.8) {
      var ppbDiff = p.piecesPerBag - p.ppbMedian;
      out.push(finding({
        id: 'ppb-drift', category: 'packing', phase: 'packing',
        severity: 'medium',
        confidence: 70,
        title: 'Pieces per bag has drifted from your usual ' + round1(p.ppbMedian),
        summary: ppbDiff > 0
          ? 'Bags now hold ' + round1(ppbDiff) + ' extra pieces on average — you are giving away free product every bag.'
          : 'Bags now hold ' + round1(Math.abs(ppbDiff)) + ' fewer pieces on average — customers may notice under-filled bags.',
        evidence: [
          'Today: ' + round1(p.piecesPerBag) + ' pcs/bag · usual: ' + round1(p.ppbMedian) + ' pcs/bag'
        ],
        fixes: [
          fix(ppbDiff > 0 ? 'Reduce pieces per bag to ' + round1(p.ppbMedian) : 'Add pieces back to ' + round1(p.ppbMedian), 'Standardise the fill count so every bag is the same — it protects both margin and trust.'),
          fix('Train the packing station', 'Have packers count by the dozen so bags stay consistent.')
        ],
        impact: { label: ppbDiff > 0 ? 'Giving away ≈ ' + round1(ppbDiff * p.bags) + ' pcs in packing' : 'Under-filled bags risk complaints', pcs: 0 }
      }));
    }

    /* ---- 14) Expiry risk ---- */
    if (p.expired) {
      out.push(finding({
        id: 'expired', category: 'planning', phase: 'planning',
        severity: 'high',
        confidence: 90,
        title: 'This batch is past its use-by date',
        summary: 'The batch recorded for this date carries a use-by that has already passed. Selling expired stock is a health risk and a liability.',
        evidence: ['Use-by ' + esc(p.batch && p.batch.useBy) + ' is before ' + p.date],
        fixes: [
          fix('Do not sell expired stock', 'Mark it as waste and record the reason so stock and reports stay honest.'),
          fix('Review production sizing', 'Over-production that expires means the batch size is too big for demand — check the Sales Forecast in Business Tools.')
        ],
        impact: { label: 'Expired stock must be scrapped', pcs: 0 }
      }));
    }

    /* Sort strongest first so the list stays readable. */
    out.sort(function (a, b) { return b.confidence - a.confidence; });
    return out;
  }
/* ============================================================
     LLM PROVIDERS — OpenAI (ChatGPT) and DeepSeek
     Both providers speak the OpenAI chat/completions wire format,
     so one askLLM() path serves both with a different endpoint
     and model name. The user picks a provider in the ⚙ panel.
     ============================================================ */
  var LLM_PROVIDERS = {
    openai:   { label: 'ChatGPT (OpenAI)', endpoint: 'https://api.openai.com/v1/chat/completions', model: 'gpt-4o-mini' },
    deepseek: { label: 'DeepSeek',         endpoint: 'https://api.deepseek.com/chat/completions',   model: 'deepseek-chat' }
  };

  function providerDefaults(provider) {
    var key = (provider === 'deepseek') ? 'deepseek' : 'openai';
    return { provider: key, endpoint: LLM_PROVIDERS[key].endpoint, model: LLM_PROVIDERS[key].model };
  }
  /* Merge whatever is stored with the provider's defaults so a stale
     config (old endpoint/model) is repaired automatically. */
  function aiNormalizedConfig() {
    var c = aiGetConfig() || {};
    var d = providerDefaults(c.provider);
    return {
      provider: d.provider,
      endpoint: c.endpoint || d.endpoint,
      model: c.model || d.model,
      apiKey: c.apiKey || ''
    };
  }

  /* ============================================================
     HEALTH SCORE + ONE-CALL ANALYSIS
     ============================================================ */
  function healthScore(profile, findings) {
    if (!profile || !profile.hasBatch) return 0;
    var score = 100;
    (findings || []).forEach(function (f) {
      if (f.severity === 'high') score -= 16;
      else if (f.severity === 'medium') score -= 9;
      else score -= 4;
    });
    return Math.max(5, Math.min(100, Math.round(score)));
  }

  /* One-call analysis: build the profile, run the rules, score it. */
  function solve(date) {
    date = date || (typeof today === 'function' ? today() : new Date().toISOString().slice(0, 10));
    var profile = buildProfileForDate(date);
    var findings = diagnose(profile);
    var health = healthScore(profile, findings);
    return { date: date, profile: profile, findings: findings, health: health };
  }
/* ============================================================
     LLM NARRATIVE (optional — ChatGPT or DeepSeek)
     The prompt contains only daily aggregates + note keywords —
     never customer names, phone numbers, or balances.
     ============================================================ */
  function promptPayload(profile, findings, model) {
    var p = profile || {};
    var kw = p.keywords || {};
    var flags = [];
    ['undercooked', 'overcooked', 'salty', 'sweet', 'heavy', 'light',
     'breakable', 'oily', 'uneven', 'stale', 'hard', 'slow', 'good']
      .forEach(function (key) { if (kw[key]) flags.push(key); });

    var evidence = (findings || []).map(function (f) {
      return { id: f.id, title: f.title, confidence: f.confidence, evidence: f.evidence };
    });

    return {
      model: model || 'gpt-4o-mini',
      temperature: 0.4,
      max_tokens: 500,
      messages: [
        {
          role: 'system',
          content: 'You are a friendly production analyst for a small wafer/crispy-roll kitchen. ' +
            'Read the production profile below, identify the MOST LIKELY root cause of today\'s problems, ' +
            'and reply in short plain paragraphs: (1) what went wrong, (2) the likely root cause, ' +
            '(3) 2-3 concrete checks to confirm it today, (4) the fix to apply tomorrow. ' +
            'Use simple language a busy kitchen owner understands. If nothing is wrong, say the day looks healthy and suggest one small improvement.'
        },
        {
          role: 'user',
          content: 'Daily production profile (aggregate numbers only, no customer data):\n' +
            JSON.stringify({
              date: p.date,
              pieces: p.pieces,
              bags: p.bags,
              expectedRolls: p.expectedRolls,
              yieldPct: p.yieldPct,
              weightPerRoll: p.weightPerRoll,
              wprMedian: p.wprMedian,
              wprPctDiff: p.wprPctDiff,
              laborPer100: p.laborPer100,
              laborMedian: p.laborMedian,
              laborPctDiff: p.laborPctDiff,
              costPerPiece: p.costPerPiece,
              costMedian: p.costMedian,
              costPctDiff: p.costPctDiff,
              wasteToday: p.wasteToday,
              wasteMedian: p.wasteMedian,
              noteFlags: flags,
              ingredientDrift: (p.ingredientAnomalies || []).map(function (a) { return a.name + ' ' + Math.round(a.diff) + '%'; }),
              topFindings: evidence.slice(0, 4)
            }, null, 0)
        }
      ]
    };
  }

  /* Fire the LLM request. Resolves with { text } or rejects with an Error. */
  function askLLM(profile, findings) {
    return new Promise(function (resolve, reject) {
      var cfg = aiNormalizedConfig();
      if (!cfg.apiKey) {
        reject(new Error('No API key configured.'));
        return;
      }
      var body = promptPayload(profile, findings, cfg.model);
      var controller = (typeof AbortController !== 'undefined') ? new AbortController() : null;
      var timer = (typeof setTimeout === 'function')
        ? setTimeout(function () { if (controller) controller.abort(); }, LLM_TIMEOUT_MS)
        : null;

      fetch(cfg.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + cfg.apiKey },
        body: JSON.stringify(body),
        signal: controller ? controller.signal : undefined
      }).then(function (res) {
        if (!res.ok) {
          return res.text().then(function (txt) {
            throw new Error('LLM API ' + res.status + ': ' + String(txt || res.statusText).slice(0, 300));
          });
        }
        return res.json();
      }).then(function (data) {
        var text = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
        if (!text) throw new Error('LLM returned no text.');
        resolve({ text: text.trim() });
      }).catch(function (err) {
        reject(err);
      }).finally(function () {
        if (timer) clearTimeout(timer);
      });
    });
  }
/* ============================================================
     UI — render the AI Root Cause tab
     ============================================================ */
  function findingCard(f, i) {
    var sevColor = f.severity === 'high' ? 'bg-red-500/15 text-red-300 border-red-700/50'
      : f.severity === 'medium' ? 'bg-amber-500/15 text-amber-300 border-amber-700/50'
      : 'bg-emerald-500/15 text-emerald-300 border-emerald-700/50';
    var ev = (f.evidence || []).map(function (e) {
      return '<li class="text-[11px] text-gray-400">' + esc(e) + '</li>';
    }).join('');
    var fixes = (f.fixes || []).map(function (fx) {
      return '<li class="flex items-start gap-2"><span class="text-emerald-400 font-bold shrink-0">✓</span>' +
        '<div><span class="font-semibold text-gray-200">' + esc(fx.action) + '</span>' +
        (fx.detail ? '<div class="text-[11px] text-gray-500">' + esc(fx.detail) + '</div>' : '') + '</div></li>';
    }).join('');
    return '<div class="rounded-xl border border-gray-800 bg-gray-900 p-4 mb-3">' +
      '<div class="flex items-start justify-between gap-2 mb-2 flex-wrap">' +
        '<div class="flex items-center gap-2 flex-wrap">' +
          '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold ' + sevColor + '">' +
            esc(String(f.severity).toUpperCase()) + '</span>' +
          '<span class="text-[11px] font-bold text-gray-500">' + Math.round(f.confidence) + '% confident</span>' +
        '</div>' +
        (f.impact && f.impact.label ? '<span class="text-[11px] text-gray-400 font-semibold">' + esc(f.impact.label) + '</span>' : '') +
      '</div>' +
      '<h4 class="font-bold text-sm text-gray-100 mb-1">' + esc(f.title) + '</h4>' +
      '<p class="text-xs text-gray-400 mb-2">' + esc(f.summary) + '</p>' +
      (ev ? '<ul class="mb-2 space-y-0.5">' + ev + '</ul>' : '') +
      (fixes ? '<ul class="space-y-1.5 border-t border-gray-800 pt-2">' + fixes + '</ul>' : '') +
    '</div>';
  }

  function renderAiAnalysis() {
    if (!window.document || !$('aiDate')) return;
    var date = $('aiDate').value || today();
    var res = solve(date);
    var p = res.profile;
    var health = res.health;
    var pendingPack = p.hasBatch && !(parseFloat(p.pieces) > 0);
    var hs = $('aiHealthScore');
    var hb = $('aiHealthBar');
    if (hs) {
      hs.textContent = pendingPack ? '—' : (p.hasBatch ? health + ' / 100' : '—');
      hs.className = 'text-4xl font-extrabold ' +
        (pendingPack ? 'text-gray-500' : health >= 80 ? 'text-emerald-400' : health >= 55 ? 'text-amber-400' : 'text-red-400');
    }
    if (hb) hb.style.width = (p.hasBatch && !pendingPack ? health : 0) + '%';
    var list = $('aiFindings');
    if (list) {
      if (!p.hasBatch) {
        list.innerHTML = '<div class="p-4 rounded-lg bg-gray-800/40 border border-gray-700 text-xs text-gray-400">' +
          'No production batch recorded for <b>' + esc(date) + '</b>. ' +
          'Record the day\'s ingredients in the Production tab (even before packing) and re-analyze — the AI will show the expected roll count and flag problems.</div>';
      } else if (pendingPack) {
        list.innerHTML = '<div class="p-4 rounded-lg bg-amber-900/20 border border-amber-700/50 text-xs text-amber-200">' +
          '⏳ This batch is recorded as a <b>mix</b> (packaging not finished yet) — expected <b>' + esc(fmtInt(p.expectedRolls)) + '</b> rolls. ' +
          'Open this date in the Production tab after packaging, fill in the actual bags &amp; pieces, and press <b>Update Production</b>, then re-analyze for the root-cause report.</div>';
      } else if (!res.findings.length) {
        list.innerHTML = '<div class="p-4 rounded-lg bg-emerald-900/20 border border-emerald-700/50 text-xs text-emerald-300 font-semibold">' +
          '✅ No problems detected for ' + esc(date) + ' — production looks healthy and consistent with recent batches.</div>';
      } else {
        list.innerHTML = res.findings.map(findingCard).join('');
      }
    }
    var meta = $('aiMeta');
    if (meta) {
      meta.innerHTML = p.hasBatch
        ? (pendingPack
            ? 'Mix recorded · expected <b>' + esc(fmtInt(p.expectedRolls)) + '</b> rolls · packaging pending'
            : 'Batch: <b>' + esc(fmtInt(p.pieces)) + '</b> pcs · <b>' + esc(fmtInt(p.bags)) + '</b> bags · expected <b>' + esc(fmtInt(p.expectedRolls)) + '</b> rolls' +
              ' · yield <b>' + (p.yieldPct === null ? '—' : esc(round1(p.yieldPct)) + '%') + '</b>' +
              (p.historyCount ? ' · vs <b>' + p.historyCount + '</b> previous days' : ''))
        : 'No batch for this date yet.';
    }
    renderAiNarrativeStatus(res);
    refreshAiSettingsPanel();
  }

  function renderAiNarrativeStatus(res) {
    var box = $('aiNarrative');
    if (!box) return;
    if (!res.profile.hasBatch) {
      box.innerHTML = '<div class="text-xs text-gray-500">Record a batch first, then ask the AI for a plain-language summary.</div>';
      return;
    }
    if (!(parseFloat(res.profile.pieces) > 0)) {
      box.innerHTML = '<div class="text-xs text-gray-500">Finish packaging first (add actual bags & pieces), then the AI can summarize the root cause.</div>';
      return;
    }
    var cfg = aiNormalizedConfig();
    var provider = LLM_PROVIDERS[cfg.provider] || LLM_PROVIDERS.openai;
    box.innerHTML = cfg.apiKey
      ? '<div class="text-xs text-gray-500">Ready to ask <b>' + esc(provider.label) + '</b> (' + esc(cfg.model) + ') for a root-cause narrative.</div>'
      : '<div class="text-xs text-gray-500">Add a <b>ChatGPT or DeepSeek API key</b> in ⚙ Settings to get a plain-language root-cause summary. ' +
        'Until then you already have the on-device analysis above — no key needed, works offline.</div>';
  }
/* ---------- Settings panel ---------- */
  function refreshAiSettingsPanel() {
    if (!window.document || !$('aiProvider')) return;
    var cfg = aiNormalizedConfig();
    $('aiProvider').value = cfg.provider;
    $('aiEndpoint').value = cfg.endpoint;
    $('aiModel').value = cfg.model;
    if ($('aiApiKey')) $('aiApiKey').value = cfg.apiKey;
  }

  function openAiSettings() {
    if (!$('aiSettingsModal')) return;
    refreshAiSettingsPanel();
    $('aiSettingsModal').classList.remove('hidden');
  }
  function closeAiSettings() {
    if (!$('aiSettingsModal')) return;
    $('aiSettingsModal').classList.add('hidden');
  }
  function saveAiSettings() {
    if (!$('aiProvider')) return;
    var provider = $('aiProvider').value;
    var d = providerDefaults(provider);
    var cfg = aiGetConfig() || {};
    cfg.provider = provider;
    cfg.endpoint = ($('aiEndpoint').value || d.endpoint).trim();
    cfg.model = ($('aiModel').value || d.model).trim();
    var key = $('aiApiKey') ? $('aiApiKey').value.trim() : '';
    if (key) cfg.apiKey = key;
    else cfg.apiKey = '';
    aiSaveConfig(cfg);
    closeAiSettings();
    if (typeof showToast === 'function') showToast('AI provider settings saved (local only).', 'success');
    renderAiNarrativeStatus(solve($('aiDate') ? $('aiDate').value : today()));
  }
  /* When the provider changes, auto-fill its default endpoint + model. */
  function onAiProviderChange() {
    if (!$('aiProvider')) return;
    var d = providerDefaults($('aiProvider').value);
    $('aiEndpoint').value = d.endpoint;
    $('aiModel').value = d.model;
  }

  /* ---------- Ask the LLM ---------- */
  function askAi() {
    var btn = $('aiAskBtn');
    if (!btn) return;
    var date = ($('aiDate') && $('aiDate').value) || today();
    var res = solve(date);
    if (!res.profile.hasBatch) {
      if (typeof showToast === 'function') showToast('Record a production batch first.', 'error');
      return;
    }
    if (!(parseFloat(res.profile.pieces) > 0)) {
      if (typeof showToast === 'function') showToast('Finish packaging first (add actual bags & pieces), then ask the AI.', 'info');
      return;
    }
    btn.disabled = true;
    var original = btn.innerHTML;
    btn.innerHTML = '<i data-lucide="loader" class="w-4 h-4 animate-spin"></i> Asking…';
    if (window.lucide) { try { lucide.createIcons(); } catch (e) {} }
    askLLM(res.profile, res.findings).then(function (answer) {
      var box = $('aiNarrative');
      if (box) {
        box.innerHTML = '<div class="p-3 rounded-lg bg-gray-800/60 border border-emerald-700/50 text-sm text-gray-100 whitespace-pre-wrap leading-relaxed">' +
          esc(answer.text) + '</div>' +
          '<div class="text-[10px] text-gray-500 mt-2">Generated by ' +
          esc((LLM_PROVIDERS[aiNormalizedConfig().provider] || {}).label || 'AI') + ' — verify against the evidence above before acting.</div>';
      }
    }).catch(function (err) {
      if (typeof showToast === 'function') {
        showToast('AI request failed: ' + String(err && err.message || err).slice(0, 120), 'error');
      }
      var box = $('aiNarrative');
      if (box) {
        box.innerHTML = '<div class="p-3 rounded-lg bg-red-900/20 border border-red-700/50 text-xs text-red-300">' +
          'Could not reach the AI: ' + esc(String(err && err.message || err).slice(0, 300)) +
          '<br>Check your API key / provider settings, or use the on-device analysis above.</div>';
      }
    }).finally(function () {
      btn.disabled = false;
      btn.innerHTML = original;
      if (window.lucide) { try { lucide.createIcons(); } catch (e) {} }
    });
  }

  /* ---------- Wire up the tab's controls (guarded: no-op in Node tests) ---------- */
  function bindAiUI() {
    if (!window.document) return;
    var bind = function (id, fn) {
      var el = document.getElementById(id);
      if (el) el.addEventListener('click', fn);
    };
    bind('aiAnalyzeBtn', function () { renderAiAnalysis(); });
    bind('aiAskBtn', askAi);
    bind('aiSettingsBtn', openAiSettings);
    bind('aiSettingsSave', saveAiSettings);
    bind('aiSettingsCancel', closeAiSettings);
    bind('aiSettingsX', closeAiSettings);
    var provider = document.getElementById('aiProvider');
    if (provider) provider.addEventListener('change', onAiProviderChange);
    var dateInput = document.getElementById('aiDate');
    if (dateInput) {
      if (!dateInput.value) dateInput.value = today();
      dateInput.addEventListener('change', renderAiAnalysis);
    }
  }
  bindAiUI();

  /* ---------- Public API (small, documented — used by _verify_ai.js) ---------- */
  window.AiAnalyzer = {
    solve: solve,
    diagnose: diagnose,
    buildProfileForDate: buildProfileForDate,
    summarizeNotes: summarizeNotes,
    promptPayload: promptPayload,
    providerDefaults: providerDefaults,
    providers: LLM_PROVIDERS,
    getConfig: aiGetConfig,
    setConfig: aiSaveConfig,
    render: renderAiAnalysis
  };
})();