/* ============================================================
   FRYING PAN TIMERS — 3 independent parallel pan timers
   ------------------------------------------------------------
   Module  : window.PanTimers — self-contained classic script
             (matches the js/ module convention of this project).
   Used by : index.html → <section id="tab-timers">. The generic
             .tab-btn handler in js/helpers.js auto-wires the tab;
             this module registers its own tab-click + keyboard +
             mouse listeners, so no other file needs to change.

   Features (per requirement):
   1. ISOLATED STATE — 3 pans, each holding its own duration,
      remaining, endAt (wall-clock) and stage. A single tick loop
      steps each pan from its OWN endAt, so the pans run in
      parallel and can never interfere with each other.
   2. INPUT TRIGGERS — each pan supports mouse (click card or the
      on-card buttons to run/pause, right-click / middle-click to
      reset) AND a unique keyboard shortcut:
        key "1" / "2" / "3"  → run/pause that pan
        Shift+1 / 2 / 3      → reset that pan
      (shortcuts are ignored while typing in an input).
   3. MULTI-STEP CHECKPOINTS (fire-once per batch) — the workflow is:
        0:00–0:50   heating with the lid closed (no alerts yet)
            0:50    stage 1/2  "Open lid & fold margins (3/4 temp)" —
                     after folding, close the lid back ("Close back /
                     prep next roll"), then heat for the final 20 s
        0:50–1:10   final 20 s of heating (lid closed)
            0:00    stage 3  done — "Rolls ready — lift lid & roll!"
      Each fires a high-visibility alert: flashing card state,
      global alert strip, browser-tab title, optional Web-Audio
      beeps and an app toast.
   4. VISUAL DISTINCTION — each pan has its own accent theme
      (sky / orange / violet) plus amber and red flashing warning
      states that are obvious from across the room.
   5. INTEGRATION — lenient persistence (localStorage) so a refresh
      or background tab never drifts: running pans are stored as a
      wall-clock endAt and recomputed on load.
   ============================================================ */
(function () {
  'use strict';

  /* ---------- Config ---------- */
  var STORAGE_KEY = 'panTimers_v1';
  var STORAGE_VERSION = 2;
  var TICK_MS = 200;                  // UI refresh; accuracy from endAt, not ticks

  /* Default settings + live (mutable) settings object. Everything adjustable
     from the ⚙ Fry Timer Settings panel lives here and is persisted. */
  var SETTINGS_DEFAULTS = {
    fold: 50,     // seconds of heating before "Open lid & fold margins" fires
    final: 20,    // seconds of heating after the lid is closed back
    panCount: 3,  // number of independent frying pans (1–9, scalable production lines)
    volume: 75,   // beep volume (%)
    beep: true,   // Web-Audio beeps on checkpoints
    toast: true,  // app toast messages
    title: true,  // flash the browser-tab title
    nav: true,    // flash the Fry Timers menu button
    vibrate: true // mobile vibration on checkpoints
  };
  var settings = Object.assign({}, SETTINGS_DEFAULTS);

  // Optional pan "runs" (feature 2): after a pan finishes a batch you can log
  // it to production from the timers screen. Keyed by pan id (dynamic).
  var runPieces = {};
  var runBags = {};

  // Per-pan preset library (feature 1): named timing profiles. Keyed by pan id,
  // defaults off — each pan simply uses the global settings.
  var panPresets = { pan1: null, pan2: null, pan3: null };

  // Per-pan duration presets: standard batch (fold + final) plus these extra
  // seconds. Re-generated whenever the settings change.
  var DURATION_STEPS = [0, 15, 30, 45, 60];

  function settingsTotal() { return settings.fold + settings.final; }
  function presetFor(pan) { return panPresets && panPresets[pan.id] ? panPresets[pan.id] : null; }
  function getTimeoutSettings(pan) {
    const p = presetFor(pan);
    if (!p) return { fold: settings.fold, final: settings.final };
    return { fold: p.fold, final: p.final };
  }
  function durationOptions() {
    // Honour per-pan presets for the standard option list.
    var base = pans.reduce(function (memo, pan) {
      const t = getTimeoutSettings(pan);
      memo[t.fold + t.final] = true;
      return memo;
    }, {});
    var presetTotals = Object.keys(base).map(Number);
    var list = presetTotals.length ? presetTotals
      : DURATION_STEPS.map(function (step) { return settingsTotal() + step; });
    // Keep the standard-step options around too:
    DURATION_STEPS.forEach(function (step) {
      var v = settingsTotal() + step;
      if (list.indexOf(v) === -1) list.push(v);
    });
    list.sort(function (a, b) { return a - b; });
    // Keep any per-pan custom duration visible in the dropdown.
    pans.forEach(function (pan) {
      if (pan.duration > 0 && list.indexOf(pan.duration) === -1) list.push(pan.duration);
    });
    return list;
  }
  function normalizeSettings(raw) {
    var s = raw || {};
    function num(v, lo, hi, dflt) {
      var n = parseInt(v, 10);
      if (isNaN(n)) return dflt;
      return Math.max(lo, Math.min(hi, n));
    }
    return {
      fold: num(s.fold, 5, 600, SETTINGS_DEFAULTS.fold),
      final: num(s.final, 1, 300, SETTINGS_DEFAULTS.final),
      panCount: num(s.panCount, 1, 9, SETTINGS_DEFAULTS.panCount),
      volume: num(s.volume, 0, 100, SETTINGS_DEFAULTS.volume),
      beep: s.beep !== false,
      toast: s.toast !== false,
      title: s.title !== false,
      nav: s.nav !== false,
      vibrate: s.vibrate !== false
    };
  }

  var MSG = {
    1: 'Open lid & fold margins (3/4 temp)',
    2: 'Close back / prep next roll',
    3: 'Rolls ready — lift lid & roll!'
  };

  var PAN_THEMES = ['sky', 'amber', 'violet', 'emerald', 'rose', 'cyan', 'lime', 'purple', 'orange'];
  var PAN_ACCENTS = ['#38BDF8', '#F59E0B', '#A78BFA', '#34D399', '#FB7185', '#22D3EE', '#A3E635', '#C084FC', '#FB923C'];
  /* Unique per-pan blueprints for the configured number of pans. Each pan gets
     its own accent theme + digit key (1–9) so the UIs are visually distinct and
     each pan keeps a unique keyboard shortcut. */
  function buildPanConfigs() {
    var count = Math.max(1, Math.min(9, settings.panCount || SETTINGS_DEFAULTS.panCount));
    var out = [];
    for (var i = 0; i < count; i++) {
      out.push({
        id: 'pan' + (i + 1),
        name: 'Pan ' + (i + 1),
        key: String(i + 1),
        code: 'Digit' + (i + 1),
        theme: PAN_THEMES[i] || PAN_THEMES[0],
        accent: PAN_ACCENTS[i] || PAN_ACCENTS[i % PAN_ACCENTS.length]
      });
    }
    return out;
  }

  var BANNER_BASE = 'mt-3 w-full px-4 py-3 rounded-xl text-center font-extrabold text-lg tabular-nums';

  /* ---------- Module state (private — nothing leaks to the app scope) ---------- */
  var pans = [];
  var els = {};
  var audioCtx = null;
  var ticker = null;
  var root = null;
  var baseTitle = document.title;

  /* ---------- Small helpers ---------- */
  function fmtTime(sec) {
    sec = Math.max(0, Math.ceil(sec));
    var m = Math.floor(sec / 60);
    var s = sec % 60;
    return m + ':' + (s < 10 ? '0' + s : s);
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      if (c === '&') return '&amp;';
      if (c === '<') return '&lt;';
      if (c === '>') return '&gt;';
      if (c === '"') return '&quot;';
      return '&#39;';
    });
  }

  function findPan(id) {
    for (var i = 0; i < pans.length; i++) if (pans[i].id === id) return pans[i];
    return null;
  }

  function closestCard(node) {
    while (node && node !== root) {
      if (node.classList && node.classList.contains('pan-card')) return node;
      node = node.parentNode;
    }
    return null;
  }

  /* ---------- Factory — one fully isolated timer per pan ---------- */
  function createPan(cfg) {
    return {
      id: cfg.id,
      name: cfg.name,
      key: cfg.key,
      code: cfg.code,
      theme: cfg.theme,
      accent: cfg.accent,
      duration: settingsTotal(),
      remaining: settingsTotal(),
      running: false,
      endAt: 0,     // wall-clock ms at which this pan hits 0
      stage: 0      // 0 none · 1 fold (long batch) · 2 fold+close/prep or close/prep · 3 done
    };
  }

  /* ---------- Pure per-pan step (kept pure for easy verification) ----------
     Advances one pan against the wall clock. Returns true when a checkpoint
     event fired so callers can trigger the high-visibility alert.

     Timeline (user workflow) for the default 70 s batch:
       0:00–0:50  heating (lid closed)             → no alerts
       0:50       "Open lid & fold margins (3/4 temp)" → fold, close back
       0:50–1:10  final 20 s heating               → "Close back / prep next roll"
       1:10       done                             → "Rolls ready — lift lid & roll!"
     For batches longer than 70 s the fold still fires at 50 s elapsed and
     "Close back / prep next roll" fires as its own alert at 20 s remaining. */
  function stepPan(pan, now) {
    if (!pan.running || !pan.endAt) return false;
    var prev = pan.remaining;
    pan.remaining = Math.max(0, Math.ceil((pan.endAt - now) / 1000));
    if (pan.remaining === prev) return false;
    const t = getTimeoutSettings(pan);   // presets can override fold/final per pan

    if (pan.remaining <= 0) {
      pan.running = false;
      if (pan.stage !== 3) { pan.stage = 3; return true; }
      return false;
    }

    // Fold checkpoint: fires when t.fold s have ELAPSED
    // (remaining <= duration - fold). Short batches jump straight to stage 2
    // with a combined instruction because the fold happens inside the
    // final-heat window (e.g. 70 s batch → fold at 20 s left).
    var foldDue = pan.stage < 1 && pan.duration > t.fold &&
                  pan.remaining <= pan.duration - t.fold;
    if (foldDue) {
      pan.stage = (pan.remaining <= t.final) ? 2 : 1;
      return true;
    }

    // "Close back / prep next roll" — separate alert with t.final s
    // remaining, only after the fold checkpoint fired on a longer batch.
    if (pan.stage === 1 && pan.remaining <= t.final) { pan.stage = 2; return true; }
    return false;
  }

  /* ---------- Controls (each is per-pan; pans never share state) ---------- */
  function startPan(pan) {
    if (pan.running) return;
    if (pan.stage === 3 || pan.remaining <= 0) { pan.remaining = pan.duration; pan.stage = 0; }
    if (pan.remaining == null || pan.remaining <= 0) pan.remaining = pan.duration;
    pan.running = true;
    pan.endAt = Date.now() + pan.remaining * 1000;
    ensureTick();
    save();
    paintPan(pan);
    updateGlobalBanner();
  }

  function pausePan(pan) {
    if (!pan.running) return;
    pan.running = false;
    pan.remaining = Math.max(0, Math.ceil((pan.endAt - Date.now()) / 1000));
    pan.endAt = 0;
    save();
    paintPan(pan);
    stopTickIfIdle();
    updateGlobalBanner();
  }

  function togglePan(pan) {
    if (pan.running) pausePan(pan); else startPan(pan);
  }

  function resetPan(pan) {
    pan.running = false;
    pan.endAt = 0;
    pan.remaining = pan.duration;
    pan.stage = 0;
    save();
    paintPan(pan);
    stopTickIfIdle();
    updateGlobalBanner();
  }

  function applyDuration(pan, sec) {
    if (!sec || sec <= 0 || pan.running) return;   // never change mid-batch
    pan.duration = sec;
    pan.remaining = sec;
    pan.stage = 0;
    save();
    paint();
  }

  /* ---------- Tick loop ---------- */
  function ensureTick() { if (!ticker) ticker = setInterval(tick, TICK_MS); }

  function stopTickIfIdle() {
    if (!pans.length) return;
    for (var i = 0; i < pans.length; i++) if (pans[i].running) return;
    clearInterval(ticker);
    ticker = null;
  }

  function tick() {
    var now = Date.now();
    pans.forEach(function (pan) {
      const wasStage3 = pan.stage === 3 && !pan.running;
      if (stepPan(pan, now)) {
        triggerAlert(pan, pan.stage);   // toast + beep + save + flash + banner
      } else {
        paintPan(pan);
      }
      if (!wasStage3 && pan.stage === 3 && !pan.running) markRun(pan);
    });
    renderRunSummary();
    wireRunSummary();
    updateGlobalBanner();
    stopTickIfIdle();
  }

  /* ---------- High-visibility alert ---------- */
  /* The exact instruction text for a pan's current stage. On batches of
     70 s or less the fold happens inside the final-20s window, so the one
     alert combines both instructions. */
  function stageMessage(pan) {
    if ((pan.stage === 1 || pan.stage === 2) && pan.duration <= settingsTotal()) {
      return MSG[1] + ' — ' + MSG[2];
    }
    return MSG[pan.stage] || '';
  }

  function triggerAlert(pan, stage) {
    paintPan(pan);
    updateGlobalBanner();
    if (settings.toast && window.showToast) {
      var type = stage === 3 ? 'error' : 'info';
      showToast(pan.name + ' · ' + stageMessage(pan), type);
    }
    beepFor(stage);
    if (settings.vibrate && typeof navigator !== 'undefined' && navigator.vibrate) {
      try { navigator.vibrate(stage === 3 ? [200, 100, 200] : 150); } catch (e) { /* best-effort */ }
    }
    save();
  }

  function alertSummary() {
    var list = [];
    pans.forEach(function (p) {
      if (p.stage > 0) list.push({ name: p.name, pan: p, severity: p.stage });
    });
    if (!list.length) return null;
    var sev = 0;
    list.forEach(function (x) { if (x.severity > sev) sev = x.severity; });
    return {
      text: list.map(function (x) { return x.name + ' — ' + stageMessage(x.pan); }).join('   ·   '),
      severity: sev
    };
  }

  function updateGlobalBanner() {
    var banner = document.getElementById('panAlertBanner');
    var nav = document.querySelector('[data-tab="timers"]');
    var summary = alertSummary();
    if (!summary) {
      if (banner) banner.className = BANNER_BASE + ' hidden';
      if (nav) nav.classList.remove('pan-nav-alert');
      if (document.title !== baseTitle) document.title = baseTitle;
      return;
    }
    if (banner) {
      banner.className = BANNER_BASE + ' pan-banner-' + summary.severity;
      banner.textContent = '⚠ ' + summary.text;
    }
    if (nav && settings.nav) nav.classList.add('pan-nav-alert');
    if (settings.title) document.title = (summary.severity === 3 ? '⏰ ' : '⚠ ') + summary.text;
  }

  /* ---------- Sound (Web Audio; best-effort) ---------- */
  function beepFor(stage) {
    if (!settings.beep) return;
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      if (!audioCtx) audioCtx = new AC();
      if (audioCtx.state === 'suspended') audioCtx.resume();
      var seq = stage === 3 ? [[1245, 0.30], [1245, 0.30], [1245, 0.45]]
        : stage === 2 ? [[1046, 0.16], [880, 0.16], [1046, 0.24]]
        : [[880, 0.14], [660, 0.20]];
      seq.forEach(function (note, i) {
        var t = audioCtx.currentTime + i * 0.24;
        var osc = audioCtx.createOscillator();
        var gain = audioCtx.createGain();
        osc.type = 'square';
        osc.frequency.value = note[0];
        var vol = Math.max(0.05, settings.volume / 100);
        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.exponentialRampToValueAtTime(0.2 * vol, t + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + note[1]);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start(t);
        osc.stop(t + note[1] + 0.03);
      });
    } catch (e) { /* audio is best-effort — never break the kitchen timer */ }
  }

  /* ---------- Rendering ---------- */
  function cardHtml(pan) {
    var durOpts = durationOptions().map(function (d) {
      return '<option value="' + d + '"' + (pan.duration === d ? ' selected' : '') + '>' + fmtTime(d) + '</option>';
    }).join('');
    return '' +
      '<div class="pan-card pan-theme-' + pan.theme + ' pan-ready" data-pan="' + pan.id + '" style="--pan-accent:' + pan.accent + '">' +
        '<div class="flex items-start justify-between gap-2">' +
          '<div class="flex items-center gap-2">' +
            '<span class="pan-dot"></span>' +
            '<span class="pan-name">' + pan.name + '</span>' +
            '<span class="pan-preset-label" title="' + (presetFor(pan) ? 'Preset: ' + escapeHtml(presetFor(pan).name) : 'Uses the global settings from ⚙') + '">' + (presetFor(pan) ? escapeHtml(presetFor(pan).name || 'custom') : '⚙') + '</span>' +
          '</div>' +
          '<span class="pan-badge">READY</span>' +
        '</div>' +
        '<div class="pan-time">' + fmtTime(pan.remaining) + '</div>' +
        '<div class="pan-bar"><div class="pan-bar-fill"></div></div>' +
        '<div class="pan-msg">' + msgText(pan) + '</div>' +
        '<div class="flex items-center gap-2 mt-3">' +
          '<button class="pan-btn pan-btn-primary" data-act="toggle">Start</button>' +
          '<button class="pan-btn" data-act="reset">Reset</button>' +
          '<select class="pan-dur" data-act="duration" title="Batch time (seconds)">' + durOpts + '</select>' +
        '</div>' +
        '<div class="pan-hint">Key <kbd>' + pan.key + '</kbd> run/pause · <kbd>Shift+' + pan.key + '</kbd> reset · click card · right-click reset</div>' +
      '</div>';
  }

  function badgeText(pan) {
    if (pan.stage === 3) return 'DONE';
    if (pan.stage === 1) return 'FOLD MARGINS';
    if (pan.stage === 2) return pan.duration <= settingsTotal() ? 'FOLD MARGINS' : 'CLOSE & PREP';
    if (pan.running) return 'HEATING';
    if (pan.remaining < pan.duration) return 'PAUSED';
    return 'READY';
  }

  function msgText(pan) {
    if (pan.stage === 3) return MSG[3];
    if (pan.stage === 2) return stageMessage(pan);
    if (pan.stage === 1) return stageMessage(pan);
    if (pan.running) return 'Heating (lid closed) — open lid & fold margins at ' + fmtTime(settings.fold);
    if (pan.remaining < pan.duration) return 'Paused — press Start to continue';
    return 'Press Start or press key ' + pan.key;
  }

  function paint() {
    if (!root) return;
    root.innerHTML = pans.map(cardHtml).join('');
    els = {};
    pans.forEach(function (pan) {
      els[pan.id] = root.querySelector('[data-pan="' + pan.id + '"]');
    });
    pans.forEach(function (pan) { paintPan(pan); });
    pans.forEach(markRun);          // already-done pans show in the run summary too
    updateSoundButton();
    updateGlobalBanner();
    renderRunSummary();
    wireRunSummary();
  }

  function paintPan(pan) {
    var card = els[pan.id];
    if (!card) return;
    var stateCls = pan.running ? 'pan-running' : (pan.stage === 0 && pan.remaining < pan.duration ? 'pan-paused' : 'pan-ready');
    card.className = 'pan-card pan-theme-' + pan.theme + ' ' + stateCls + (pan.stage ? ' pan-stage-' + pan.stage : '');

    var timeEl = card.querySelector('.pan-time');
    if (timeEl) timeEl.textContent = fmtTime(pan.remaining);

    var bar = card.querySelector('.pan-bar-fill');
    if (bar) bar.style.width = Math.max(0, Math.min(100, (pan.remaining / pan.duration) * 100)) + '%';

    var badge = card.querySelector('.pan-badge');
    if (badge) badge.textContent = badgeText(pan);

    var msg = card.querySelector('.pan-msg');
    if (msg) msg.textContent = msgText(pan);

    var toggleBtn = card.querySelector('[data-act="toggle"]');
    if (toggleBtn) toggleBtn.textContent = pan.running ? 'Pause' : 'Start';

    var durSel = card.querySelector('.pan-dur');
    if (durSel) durSel.value = String(pan.duration);
  }

  /* ---------- Batch-run tracker (feature 2) ---------- */
  function markRun(pan) {
    if (pan.stage === 3 && !pan.running && !runPieces[pan.id]) {
      // Pan finished: remember pieces (user will adjust + log to Production).
      runPieces[pan.id] = runPieces[pan.id] || 6;
      runBags[pan.id] = runBags[pan.id] || 1;
    }
  }
  function renderRunSummary() {
    const box = g('panRunSummary');
    if (!box) return;
    box.innerHTML = pans.map(function (pan) {
      const pcs = runPieces[pan.id] || 0;
      const bags = runBags[pan.id] || 0;
      return '<div class="p-3 rounded-lg bg-gray-800/60 border border-gray-700">' +
        '<div class="text-xs font-bold text-gray-300">' + escapeHtml(pan.name) + '</div>' +
        '<div class="flex items-center gap-2 mt-1">' +
        '<input type="number" min="0" step="1" value="' + pcs + '" data-run-pieces="' + pan.id + '" class="w-16 px-1.5 py-1 rounded border border-gray-700 bg-gray-800 text-xs text-right"> pcs' +
        '</div>' +
        '<div class="text-[10px] text-gray-500 mt-1">≈ ' + bags + ' bags at 6 pcs/bag · ' + escapeHtml(pan.name) + '</div></div>';
    }).join('') || '<div class="text-gray-500 text-xs">No finished batches yet.</div>';
  }
  function wireRunSummary() {
    const box = g('panRunSummary');
    if (!box) return;
    Array.from(box.querySelectorAll('[data-run-pieces]')).forEach(function (inp) {
      inp.addEventListener('change', function () {
        runPieces[inp.dataset.runPieces] = Math.max(0, parseInt(inp.value, 10) || 0);
        runBags[inp.dataset.runPieces] = Math.round(runPieces[inp.dataset.runPieces] / 6) || 0;
        renderRunSummary();
      });
    });
  }
  function saveRun() {
    // Save ALL remembered finished batches into Production (one batch per pan).
    let savedAny = false;
    pans.forEach(function (pan) {
      const pcs = runPieces[pan.id] || 0;
      if (!pcs) return;
      saveProductionFromRun(today(), pcs, runBags[pan.id] || Math.round(pcs / 6), undefined, (g('logNotes') ? g('logNotes').value : ''), undefined);
      runPieces[pan.id] = 0;
      runBags[pan.id] = 0;
      savedAny = true;
    });
    if (savedAny) {
      renderRunSummary();
      if (window.showToast) showToast('Finished batches logged to Production for today.', 'success');
    } else {
      if (window.showToast) showToast('No finished batches to log yet.', 'info');
    }
  }

  function updateSoundButton() {
    var btn = document.getElementById('panSoundBtn');
    if (!btn) return;
    btn.textContent = settings.beep ? '🔊 Sound On' : '🔇 Sound Off';
    btn.classList.toggle('bg-emerald-600', settings.beep);
    btn.classList.toggle('bg-gray-700', !settings.beep);
    btn.classList.toggle('hover:bg-emerald-500', settings.beep);
    btn.classList.toggle('hover:bg-gray-600', !settings.beep);
  }

  /* ---------- Events ---------- */
  function bindEvents() {
    if (!root) return;
    root.addEventListener('click', function (e) {
      var card = closestCard(e.target);
      if (!card) return;
      var pan = findPan(card.getAttribute('data-pan'));
      if (!pan) return;
      var actEl = e.target.closest('[data-act]');
      if (actEl) {
        var act = actEl.getAttribute('data-act');
        if (act === 'toggle') togglePan(pan);
        else if (act === 'reset') resetPan(pan);
        // duration select is handled on 'change'; never toggles a pan.
      } else {
        togglePan(pan);             // click anywhere else on the card
      }
    });

    root.addEventListener('change', function (e) {
      var sel = e.target.closest('select[data-act="duration"]');
      if (!sel) return;
      var card = closestCard(sel);
      if (!card) return;
      applyDuration(findPan(card.getAttribute('data-pan')), parseInt(sel.value, 10));
    });

    root.addEventListener('contextmenu', function (e) {
      var card = closestCard(e.target);
      if (!card) return;
      e.preventDefault();
      resetPan(findPan(card.getAttribute('data-pan')));
    });

    root.addEventListener('auxclick', function (e) {
      if (e.button !== 1) return;   // middle click = reset
      var card = closestCard(e.target);
      if (!card) return;
      e.preventDefault();
      resetPan(findPan(card.getAttribute('data-pan')));
    });
  }

  function onKey(e) {
    if (e.key === 'Escape') { hideSettings(); return; }
    if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
    var t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
    for (var i = 0; i < pans.length; i++) {
      // Match by physical key code so Shift+1/2/3 also lands here
      // (with Shift held, e.key becomes "!"/"@"/"#"). Fall back to e.key.
      if (pans[i].code === e.code || pans[i].key === e.key) {
        e.preventDefault();
        if (e.shiftKey) resetPan(pans[i]); else togglePan(pans[i]);
        return;
      }
    }
  }

  function bindHeaderAndTabs() {
    var soundBtn = document.getElementById('panSoundBtn');
    if (soundBtn) {
      soundBtn.addEventListener('click', function () {
        settings.beep = !settings.beep;
        updateSoundButton();
        save();
      });
    }
    var resetAllBtn = document.getElementById('panResetAllBtn');
    if (resetAllBtn) {
      resetAllBtn.addEventListener('click', function () {
        pans.forEach(function (p) {
          p.running = false; p.endAt = 0; p.remaining = p.duration; p.stage = 0;
        });
        stopTickIfIdle();
        save();
        paint();
        updateGlobalBanner();
        if (window.showToast) showToast('All frying pans reset.', 'info');
      });
    }
    var saveRunBtn = document.getElementById('panSaveRunBtn');
    if (saveRunBtn) saveRunBtn.addEventListener('click', saveRun);
    // Re-render when the Fry Timers tab is opened (durations may have changed).
    document.querySelectorAll('.tab-btn').forEach(function (btn) {
      if (btn.getAttribute('data-tab') === 'timers') {
        btn.addEventListener('click', function () { paint(); });
      }
    });
  }

  /* ---------- Settings panel ---------- */
  function g(id) { return document.getElementById(id); }

  function showSettings() {
    var m = g('panSettingsModal');
    if (!m) return;
    g('panFoldSec').value = settings.fold;
    g('panFinalSec').value = settings.final;
    g('panPanCount').value = settings.panCount;
    g('panVolume').value = settings.volume;
    g('panOptBeep').checked = settings.beep;
    g('panOptToast').checked = settings.toast;
    g('panOptTitle').checked = settings.title;
    g('panOptNav').checked = settings.nav;
    g('panOptVibrate').checked = settings.vibrate;
    updateTotalReadout();
    updateVolumeReadout();
    m.classList.remove('hidden');
  }

  function hideSettings() {
    var m = g('panSettingsModal');
    if (m) m.classList.add('hidden');
  }

  function updateTotalReadout() {
    var el = g('panTotalReadout');
    if (!el) return;
    var fold = parseInt(g('panFoldSec').value, 10) || 0;
    var fin = parseInt(g('panFinalSec').value, 10) || 0;
    el.textContent = fmtTime(fold + fin);
  }

  function updateVolumeReadout() {
    var el = g('panVolumeReadout');
    if (el) el.textContent = (parseInt(g('panVolume').value, 10) || 0) + '%';
  }

  function readSettingsFromForm() {
    return normalizeSettings({
      fold: g('panFoldSec').value,
      final: g('panFinalSec').value,
      panCount: g('panPanCount').value,
      volume: g('panVolume').value,
      beep: g('panOptBeep').checked,
      toast: g('panOptToast').checked,
      title: g('panOptTitle').checked,
      nav: g('panOptNav').checked,
      vibrate: g('panOptVibrate').checked
    });
  }

  /* Applying new settings: ready pans on the standard (default) batch follow
     the new total; running / paused / customized pans keep their own duration.
     Checkpoints (fold / close-prep) always use the new timings from here on. */
  function applySettings(next) {
    var prevTotal = settingsTotal();
    var prevCount = settings.panCount;
    settings = normalizeSettings(next);
    var newTotal = settingsTotal();
    if (prevCount !== settings.panCount) rebuildPans();   // scale the production line
    pans.forEach(function (pan) {
      if (!pan.running && pan.stage === 0 && pan.remaining === pan.duration && pan.duration === prevTotal && !(prevCount !== settings.panCount)) {
        pan.duration = newTotal;
        pan.remaining = newTotal;
      }
    });
    save();
    paint();
    updateGlobalBanner();
  }

  /* (Re)build the pan array to match settings.panCount, preserving any running
     timer that still exists and adding fresh READY pans for new slots. */
  function rebuildPans() {
    var configs = buildPanConfigs();
    var byId = {};
    pans.forEach(function (p) { byId[p.id] = p; });
    var next = configs.map(function (cfg) {
      return byId[cfg.id] ? Object.assign(byId[cfg.id], { theme: cfg.theme, accent: cfg.accent, key: cfg.key, code: cfg.code, name: cfg.name }) : createPan(cfg);
    });
    pans = next;
    runPieces = {};
    runBags = {};
    if (pans.length !== (settings.panCount || 3)) settings.panCount = pans.length;
  }

  function bindSettingsPanel() {
    var openBtn = g('panSettingsBtn');
    if (openBtn) openBtn.addEventListener('click', showSettings);

    ['panFoldSec', 'panFinalSec'].forEach(function (id) {
      var e = g(id);
      if (e) e.addEventListener('input', updateTotalReadout);
    });
    var vol = g('panVolume');
    if (vol) vol.addEventListener('input', updateVolumeReadout);

    var save = g('panSettingsSave');
    if (save) save.addEventListener('click', function () {
      applySettings(readSettingsFromForm());
      hideSettings();
      if (window.showToast) showToast('Fry timer settings saved.', 'success');
    });

    var cancel = g('panSettingsCancel');
    var closeX = g('panSettingsX');
    if (cancel) cancel.addEventListener('click', hideSettings);
    if (closeX) closeX.addEventListener('click', hideSettings);

    var defaults = g('panSettingsReset');
    if (defaults) defaults.addEventListener('click', function () {
      applySettings(SETTINGS_DEFAULTS);
      showSettings();   // refresh the form with the defaults
      if (window.showToast) showToast('Fry timer settings reset to defaults.', 'info');
    });
  }

  /* ---------- Persistence (timestamp-based → refresh-safe timers) ---------- */
  function save() {
    try {
      var data = {
        v: STORAGE_VERSION,
        settings: settings,
        pans: pans.map(function (p) {
          return { id: p.id, duration: p.duration, remaining: p.remaining, running: p.running, endAt: p.endAt, stage: p.stage };
        })
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) { /* storage unavailable — timers keep working in memory */ }
  }

  function load() {
    var raw = null;
    try { raw = localStorage.getItem(STORAGE_KEY); } catch (e) { return; }
    if (!raw) return;
    var data = null;
    try { data = JSON.parse(raw); } catch (e) { return; }
    if (!data || !data.pans) return;
    if (data.settings) {
      settings = normalizeSettings(data.settings);
    } else if (typeof data.sound === 'boolean') {
      // v1 storage kept only the sound toggle.
      settings = normalizeSettings(Object.assign({}, SETTINGS_DEFAULTS, { beep: data.sound }));
    }
    data.pans.forEach(function (saved) {
      var pan = findPan(saved.id);
      if (!pan) return;
      pan.duration = (saved.duration > 0) ? saved.duration : settingsTotal();
      pan.stage = saved.stage || 0;
      if (saved.running && saved.endAt) {
        pan.running = true;
        pan.endAt = saved.endAt;
        pan.remaining = Math.max(0, Math.ceil((saved.endAt - Date.now()) / 1000));
        if (pan.remaining <= 0) { pan.running = false; pan.stage = 3; }
      } else {
        pan.running = false;
        if (pan.stage === 3) {
          pan.remaining = 0;    // done pan reloads as done, not full
        } else {
          pan.remaining = (typeof saved.remaining === 'number' && saved.remaining > 0) ? Math.ceil(saved.remaining) : pan.duration;
        }
      }
    });
  }

  /* ---------- Init ---------- */
  function init() {
    root = document.getElementById('panTimersGrid');
    if (!root) return;                      // module not mounted on this page
    pans = buildPanConfigs().map(createPan);
    load();
    if (!pans.length) pans = buildPanConfigs().map(createPan);   // empty storage fallback
    bindEvents();
    bindHeaderAndTabs();
    bindSettingsPanel();
    paint();
    if (pans.some(function (p) { return p.running; })) ensureTick();
    document.addEventListener('keydown', onKey);
    updateGlobalBanner();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  /* ---------- Public API (small, documented) ---------- */
  window.PanTimers = {
    render: function () { paint(); },
    getPans: function () { return pans.map(function (p) { return Object.assign({}, p); }); },
    getSettings: function () { return Object.assign({}, settings); },
    setSettings: function (next) { applySettings(next); },
    getDefaults: function () { return Object.assign({}, SETTINGS_DEFAULTS); },
    settingsTotal: settingsTotal
  };
})();