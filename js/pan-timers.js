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
   6. PER-PAN TIMING, ROLLS & BAGS — in ⚙ Settings each pan can keep
      its OWN duration (fold + final), its OWN Rolls and its OWN Bags
      via settings.panOverrides — everything is set by the user. The
      card's duration dropdown is always anchored on that pan's own
      total so a selection and the pan's real checkpoints never
      disagree.
   7. AUTOMATIC ROLL + BAG COUNT → PRODUCTION — when a timer finishes,
      the pan counts the Rolls & Bags you set for it and (with
      settings.autoReport, on by default) reports them straight into
      the Production panel (quietly, merged into that day's batch,
      once). Manually resetting a finished pan cancels its pending
      count so nothing can ever be double-reported.
   ============================================================ */
(function () {
  'use strict';

  /* ---------- Config ---------- */
  var STORAGE_KEY = 'panTimers_v1';
  var STORAGE_VERSION = 3;
  var TICK_MS = 200;                  // UI refresh; accuracy from endAt, not ticks

  /* Default settings + live (mutable) settings object. Everything adjustable
     from the ⚙ Fry Timer Settings panel lives here and is persisted.
     - panOverrides lets EACH pan keep its own timing (fold/final) and its own
       rolls-per-batch. Pans with no override simply follow the global values.
     - autoReport: when a pan finishes, its configured roll count is counted
       automatically and reported straight into the Production panel. */
  var SETTINGS_DEFAULTS = {
    fold: 50,     // seconds of heating before "Open lid & fold margins" fires
    final: 20,    // seconds of heating after the lid is closed back
    panCount: 3,  // number of independent frying pans (1–9, scalable production lines)
    volume: 75,   // beep volume (%)
    beep: true,   // Web-Audio beeps on checkpoints
    toast: true,  // app toast messages
    title: true,  // flash the browser-tab title
    nav: true,    // flash the Fry Timers menu button
    vibrate: true,             // mobile vibration on checkpoints
    notify: true,              // local browser Notification when the tab is backgrounded
    rollsPerBatch: 1,          // Rolls a finished pan counts by default — YOU set
                               // this (global here, or per-pan in "Use global"
                               // mode). Reported to Production as pieces.
    bagsPerBatch: 1,           // Bags a finished pan counts by default — YOU set
                               // this too (global, or per-pan). Reported to
                               // Production as the bag count for that batch.
    autoReport: true,          // finished batches auto-log to the Production panel
    panOverrides: {}           // { panId: { fold, final, rolls, bags } } per-pan
                               // timing, rolls AND bags, all set by you
  };
  var settings = normalizeSettings(SETTINGS_DEFAULTS);

  /* Optional local Notification when a pan alerts while the tab is hidden/backgrounded.
     Requested lazily (on first timer use) so a new user isn't pestered up front. */
  var notifyPermissionAsked = false;
  function notifyFor(pan, stage) {
    try {
      if (!settings.notify) return;
      if (typeof Notification === 'undefined') return;
      if (document.visibilityState === 'visible' && document.hasFocus && document.hasFocus()) return; // tab is in front — toast/banner are enough
      if (Notification.permission === 'denied') return;
      if (Notification.permission === 'default') {
        if (notifyPermissionAsked) return;
        notifyPermissionAsked = true;
        Notification.requestPermission().then(function (p) {
          if (p === 'granted') notifyFor(pan, stage);
        }).catch(function () { /* best-effort */ });
        return;
      }
      var n = new Notification(pan.name + ' — ' + (stage === 3 ? 'Rolls ready!' : 'Check the pan'), {
        body: stageMessage(pan),
        tag: 'pan-' + pan.id + '-' + stage + '-' + pan.batch,
        renotify: true
      });
      n.onclick = function () {
        try { window.focus(); n.close(); } catch (e) { /* ignore */ }
      };
      setTimeout(function () { try { n.close(); } catch (e) { /* ignore */ } }, 15000);
    } catch (e) { /* notifications are best-effort */ }
  }

  // Optional pan "runs" (feature 2): after a pan finishes a batch you can log
  // it to production from the timers screen. Keyed by pan id (dynamic).
  var runPieces = {};
  var runBags = {};
  // Pans whose finished batch was already auto-reported to Production (live
  // session guard; persisted in each saved pan as `reported` so a refresh can
  // never double-count a finished batch).
  var reportedRun = {};

  // Extra seconds offered around a pan's own total in its duration dropdown.
  // The dropdown is always anchored on THAT pan's effective fold + final so a
  // selection is compatible with the pan's own timing (never a mismatch).
  var DURATION_STEPS = [0, 15, 30, 45, 60];

  function settingsTotal() { return settings.fold + settings.final; }

  /* Per-pan overrides: { fold, final, rolls } or null when the pan follows the
     global settings. */
  function panOverride(id) {
    return (settings.panOverrides && settings.panOverrides[id]) || null;
  }

  /* Effective fold/final for a pan: its own override when set, else global. */
  function getTimeoutSettings(pan) {
    var o = panOverride(pan.id);
    if (o && (o.fold > 0 || o.final > 0)) return { fold: o.fold, final: o.final };
    return { fold: settings.fold, final: settings.final };
  }
  function getTimeoutSettingsForId(id) {
    var o = panOverride(id);
    if (o && (o.fold > 0 || o.final > 0)) return { fold: o.fold, final: o.final };
    return { fold: settings.fold, final: settings.final };
  }

  /* Rolls this pan counts per finished batch (its own override or the global
     default). This is what gets reported to the Production panel as pieces. */
  function rollsFor(id) {
    var o = panOverride(id);
    if (o && typeof o.rolls === 'number' && o.rolls > 0) return o.rolls;
    return settings.rollsPerBatch;
  }

  /* Bags this pan counts per finished batch (its own override or the global
     default). Reported to Production as the bag count — so the Production bag
     count always matches exactly what YOU set, not a fixed 6-per-bag rule. */
  function bagsFor(id) {
    var o = panOverride(id);
    if (o && typeof o.bags === 'number' && o.bags > 0) return o.bags;
    return settings.bagsPerBatch;
  }

  function setOverride(id, data) {
    settings.panOverrides = settings.panOverrides || {};
    settings.panOverrides[id] = Object.assign({}, settings.panOverrides[id] || {}, data);
  }

  function removeOverride(id) {
    if (settings.panOverrides) delete settings.panOverrides[id];
  }

  /* Dropdown options for ONE pan, always anchored on that pan's own effective
     total so the selection matches its actual timing (fold + final). */
  function durationOptions(pan) {
    var t = getTimeoutSettings(pan);
    var base = t.fold + t.final;
    var list = [base];
    DURATION_STEPS.forEach(function (step) {
      if (step) { var v = base + step; if (list.indexOf(v) === -1) list.push(v); }
    });
    var lower = base - 15;
    if (lower >= 10 && list.indexOf(lower) === -1) list.push(lower);
    // The pan's current total is always selectable so a restored pan is never
    // left without its own value in the list.
    if (pan.duration > 0 && list.indexOf(pan.duration) === -1) list.push(pan.duration);
    list.sort(function (a, b) { return a - b; });
    return list;
  }
  function normalizeSettings(raw) {
    var s = raw || {};
    function num(v, lo, hi, dflt) {
      var n = parseInt(v, 10);
      if (isNaN(n)) return dflt;
      return Math.max(lo, Math.min(hi, n));
    }
    /* Per-pan overrides survive a settings save: only rows the user explicitly
       customised are kept, each clamped to sane ranges. */
    var overrides = {};
    if (s.panOverrides && typeof s.panOverrides === 'object') {
      Object.keys(s.panOverrides).forEach(function (id) {
        var o = s.panOverrides[id] || {};
        var fold = num(o.fold, 5, 600, SETTINGS_DEFAULTS.fold);
        var fin = num(o.final, 1, 300, SETTINGS_DEFAULTS.final);
        var rolls = num(o.rolls, 1, 500, (SETTINGS_DEFAULTS.rollsPerBatch != null ? SETTINGS_DEFAULTS.rollsPerBatch : 1));
        var bags = num(o.bags, 1, 500, (SETTINGS_DEFAULTS.bagsPerBatch != null ? SETTINGS_DEFAULTS.bagsPerBatch : 1));
        if (o && typeof o === 'object' && (o.fold !== undefined || o.final !== undefined || o.rolls !== undefined || o.bags !== undefined)) {
          overrides[id] = { fold: fold, final: fin, rolls: rolls, bags: bags };
        }
      });
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
      vibrate: s.vibrate !== false,
      rollsPerBatch: num(s.rollsPerBatch, 1, 500, (SETTINGS_DEFAULTS.rollsPerBatch != null ? SETTINGS_DEFAULTS.rollsPerBatch : 1)),
      bagsPerBatch: num(s.bagsPerBatch, 1, 500, (SETTINGS_DEFAULTS.bagsPerBatch != null ? SETTINGS_DEFAULTS.bagsPerBatch : 1)),
      autoReport: s.autoReport !== false,
      panOverrides: overrides
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
    var t = getTimeoutSettingsForId(cfg.id);
    var dur = t.fold + t.final;
    return {
      id: cfg.id,
      name: cfg.name,
      key: cfg.key,
      code: cfg.code,
      theme: cfg.theme,
      accent: cfg.accent,
      duration: dur,
      remaining: dur,
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
    if (pan.stage === 3 || pan.remaining <= 0) { pan.remaining = pan.duration; pan.stage = 0; reportedRun[pan.id] = false; }
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
    // Resetting a finished pan cancels its pending batch-log count so a manual
    // reset can never double-report a batch that isn't actually being counted.
    reportedRun[pan.id] = false;
    runPieces[pan.id] = 0;
    runBags[pan.id] = 0;
    save();
    paintPan(pan);
    stopTickIfIdle();
    updateGlobalBanner();
  }

  function applyDuration(pan, sec) {
    if (!sec || sec <= 0 || pan.running) return;   // never change mid-batch
    // A dropdown selection changes THIS pan's own duration. Keep the fold/final
    // split proportional to its current timing and store it as a per-pan
    // override so the pan card, the settings panel and the pan's checkpoints
    // always agree (the dropdown is then fully compatible with the timing).
    var t = getTimeoutSettings(pan);
    var oldTotal = (t.fold + t.final) || 1;
    var fold = Math.max(1, Math.round(t.fold * sec / oldTotal));
    var final = Math.max(1, sec - fold);
    setOverride(pan.id, { fold: fold, final: final, rolls: rollsFor(pan.id), bags: bagsFor(pan.id) });
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
      if (!wasStage3 && pan.stage === 3 && !pan.running) {
        markRun(pan);
        autoReportDone(pan);   // auto-counted rolls → Production panel
      }
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
    var t = getTimeoutSettings(pan);
    if ((pan.stage === 1 || pan.stage === 2) && pan.duration <= (t.fold + t.final)) {
      return MSG[1] + ' — ' + MSG[2];
    }
    return MSG[pan.stage] || '';
  }

  function triggerAlert(pan, stage) {
    paintPan(pan);
    updateGlobalBanner();
    notifyFor(pan, stage);
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
    var durOpts = durationOptions(pan).map(function (d) {
      return '<option value="' + d + '"' + (pan.duration === d ? ' selected' : '') + '>' + fmtTime(d) + '</option>';
    }).join('');
    var custom = !!panOverride(pan.id);
    return '' +
      '<div class="pan-card pan-theme-' + pan.theme + ' pan-ready" data-pan="' + pan.id + '" style="--pan-accent:' + pan.accent + '">' +
        '<div class="flex items-start justify-between gap-2">' +
          '<div class="flex items-center gap-2">' +
            '<span class="pan-dot"></span>' +
            '<span class="pan-name">' + pan.name + '</span>' +
            '<span class="pan-preset-label" title="' + (custom ? 'This pan has its own timing &amp; roll count (change it in ⚙ Settings)' : 'Uses the global settings from ⚙') + '">' + (custom ? 'custom' : '⚙') + '</span>' +
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
    var t = getTimeoutSettings(pan);
    if (pan.stage === 3) return 'DONE';
    if (pan.stage === 1) return 'FOLD MARGINS';
    if (pan.stage === 2) return pan.duration <= (t.fold + t.final) ? 'FOLD MARGINS' : 'CLOSE & PREP';
    if (pan.running) return 'HEATING';
    if (pan.remaining < pan.duration) return 'PAUSED';
    return 'READY';
  }

  function msgText(pan) {
    var t = getTimeoutSettings(pan);
    if (pan.stage === 3) {
      var n = rollsFor(pan.id);
      var noun = n + ' roll' + (n === 1 ? '' : 's');
      return MSG[3] + (settings.autoReport ? ' — ' + noun + ' counted & reported to Production' : ' — ' + noun + ' counted, log it in the batch log');
    }
    if (pan.stage === 2) return stageMessage(pan);
    if (pan.stage === 1) return stageMessage(pan);
    if (pan.running) return 'Heating (lid closed) — open lid & fold margins at ' + fmtTime(t.fold);
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
  /* A finished pan automatically counts its configured Rolls/batch AND
     Bags/batch (per-pan or global defaults — both set by the user). The counts
     stay editable in the batch log, and when autoReport is on they are reported
     straight into the Production panel. */
  function markRun(pan) {
    if (pan.stage === 3 && !pan.running && !reportedRun[pan.id]) {
      runPieces[pan.id] = runPieces[pan.id] || rollsFor(pan.id);
      runBags[pan.id] = runBags[pan.id] || bagsFor(pan.id);
    }
  }
  /* Auto-report a finished batch to Production (quietly — no tab jump, no
     success toast). The run is only cleared when the report succeeded, so a
     stock shortage never loses the count and it can be retried. Bags pass
     through with the exact value you set so the Production bag count matches. */
  function autoReportDone(pan) {
    if (!settings.autoReport || reportedRun[pan.id] || !runPieces[pan.id]) return;
    if (typeof saveProductionFromRun !== 'function') return;
    var ok = saveProductionFromRun(today(), runPieces[pan.id], runBags[pan.id], undefined, undefined, undefined, true);
    if (ok) {
      runPieces[pan.id] = 0;
      runBags[pan.id] = 0;
      reportedRun[pan.id] = true;
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
        '<label class="text-[10px] text-gray-400">Rolls<input type="number" min="0" step="1" value="' + pcs + '" data-run-pieces="' + pan.id + '" class="pan-ov-input w-16"></label>' +
        '<label class="text-[10px] text-gray-400">Bags<input type="number" min="0" step="1" value="' + bags + '" data-run-bags="' + pan.id + '" class="pan-ov-input w-16"></label>' +
        '</div>' +
        '<div class="text-[10px] text-gray-500 mt-1">Rolls &amp; bags you set are what get reported to Production when this batch is logged.</div></div>';
    }).join('') || '<div class="text-gray-500 text-xs">No finished batches yet. Finished batches are auto-counted from your Rolls/bags settings and' + (settings.autoReport ? ' reported to Production.' : ' ready for the Log button below.') + '</div>';
  }
  function wireRunSummary() {
    const box = g('panRunSummary');
    if (!box) return;
    Array.from(box.querySelectorAll('[data-run-pieces]')).forEach(function (inp) {
      inp.addEventListener('change', function () {
        runPieces[inp.dataset.runPieces] = Math.max(0, parseInt(inp.value, 10) || 0);
        renderRunSummary();
      });
    });
    Array.from(box.querySelectorAll('[data-run-bags]')).forEach(function (inp) {
      inp.addEventListener('change', function () {
        runBags[inp.dataset.runBags] = Math.max(0, parseInt(inp.value, 10) || 0);
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
      const ok = saveProductionFromRun(today(), pcs, runBags[pan.id] || bagsFor(pan.id), undefined, (g('logNotes') ? g('logNotes').value : ''), undefined);
      if (ok) {
        runPieces[pan.id] = 0;
        runBags[pan.id] = 0;
        reportedRun[pan.id] = true;
        savedAny = true;
      }
    });
    if (savedAny) {
      renderRunSummary();
      if (window.showToast) showToast('Finished batches logged to Production for today.', 'success');
    } else {
      if (window.showToast) showToast(noFinishedRuns() ? 'No finished batches to log yet.' : 'Could not log — check ingredient stock.', 'info');
    }
  }
  function noFinishedRuns() {
    return pans.every(function (pan) { return !runPieces[pan.id]; });
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
          reportedRun[p.id] = false;
          runPieces[p.id] = 0;
          runBags[p.id] = 0;
        });
        stopTickIfIdle();
        save();
        paint();
        renderRunSummary();
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
    if (g('panRollsDefault')) g('panRollsDefault').value = settings.rollsPerBatch;
    if (g('panBagsDefault')) g('panBagsDefault').value = settings.bagsPerBatch;
    if (g('panOptAutoReport')) g('panOptAutoReport').checked = settings.autoReport;
    renderPanOverrideRows();
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
    // Per-pan rows: only pans with "Use global" UNCHECKED get an override.
    var overrides = {};
    var box = g('panPerPanRows');
    if (box && box.querySelectorAll) {
      Array.from(box.querySelectorAll('[data-ov-use]')).forEach(function (cb) {
        var id = cb.getAttribute && cb.getAttribute('data-ov-use');
        if (!id || cb.checked) return;   // pan follows the global timing
        var foldEl = box.querySelector('[data-ov-fold="' + id + '"]');
        var finalEl = box.querySelector('[data-ov-final="' + id + '"]');
        var rollsEl = box.querySelector('[data-ov-rolls="' + id + '"]');
        var bagsEl = box.querySelector('[data-ov-bags="' + id + '"]');
        if (!foldEl || !finalEl || !rollsEl || !bagsEl) return;
        overrides[id] = { fold: foldEl.value, final: finalEl.value, rolls: rollsEl.value, bags: bagsEl.value };
      });
    }
    return normalizeSettings({
      fold: g('panFoldSec').value,
      final: g('panFinalSec').value,
      panCount: g('panPanCount').value,
      volume: g('panVolume').value,
      beep: g('panOptBeep').checked,
      toast: g('panOptToast').checked,
      title: g('panOptTitle').checked,
      nav: g('panOptNav').checked,
      vibrate: g('panOptVibrate').checked,
      rollsPerBatch: g('panRollsDefault') ? g('panRollsDefault').value : undefined,
      bagsPerBatch: g('panBagsDefault') ? g('panBagsDefault').value : undefined,
      autoReport: g('panOptAutoReport') ? g('panOptAutoReport').checked : undefined,
      panOverrides: overrides
    });
  }

  /* Per-pan rows in the settings modal: each pan shows its own fold/final/rolls/
     bags with a "Use global" checkbox. Unchecking enables custom values — you
     set the exact rolls AND bags that pan counts when it finishes a batch. */
  function renderPanOverrideRows() {
    var box = g('panPerPanRows');
    if (!box) return;
    if (!pans.length) pans = buildPanConfigs().map(createPan);
    box.innerHTML = pans.map(function (pan) {
      var o = panOverride(pan.id);
      var useGlobal = !o;
      var fold = o ? o.fold : settings.fold;
      var fin = o ? o.final : settings.final;
      var rolls = o ? o.rolls : settings.rollsPerBatch;
      var bags = o ? o.bags : settings.bagsPerBatch;
      return '<div class="rounded-lg bg-gray-800/50 border border-gray-700 p-2 pan-ov-row" data-ov-row="' + pan.id + '">' +
        '<div class="flex items-center justify-between gap-2 mb-1.5">' +
          '<span class="text-xs font-bold" style="color:' + pan.accent + '">' + escapeHtml(pan.name) + '</span>' +
          '<label class="flex items-center gap-1 text-[10px] text-gray-400 cursor-pointer">' +
            '<input type="checkbox" class="accent-amber-500" data-ov-use="' + pan.id + '"' + (useGlobal ? ' checked' : '') + '> Use global' +
          '</label>' +
        '</div>' +
        '<div class="grid grid-cols-4 gap-2">' +
          '<label class="block text-[10px] text-gray-400 font-semibold">Fold (s)<input type="number" min="5" max="600" step="5" inputmode="numeric" data-ov-fold="' + pan.id + '" value="' + fold + '"' + (useGlobal ? ' disabled' : '') + ' class="pan-ov-input"></label>' +
          '<label class="block text-[10px] text-gray-400 font-semibold">Final (s)<input type="number" min="1" max="300" step="5" inputmode="numeric" data-ov-final="' + pan.id + '" value="' + fin + '"' + (useGlobal ? ' disabled' : '') + ' class="pan-ov-input"></label>' +
          '<label class="block text-[10px] text-gray-400 font-semibold">Rolls<input type="number" min="1" max="500" step="1" inputmode="numeric" data-ov-rolls="' + pan.id + '" value="' + rolls + '"' + (useGlobal ? ' disabled' : '') + ' class="pan-ov-input"></label>' +
          '<label class="block text-[10px] text-gray-400 font-semibold">Bags<input type="number" min="1" max="500" step="1" inputmode="numeric" data-ov-bags="' + pan.id + '" value="' + bags + '"' + (useGlobal ? ' disabled' : '') + ' class="pan-ov-input"></label>' +
        '</div>' +
      '</div>';
    }).join('');
    wirePanOverrideRows();
  }

  function wirePanOverrideRows() {
    var box = g('panPerPanRows');
    if (!box || !box.querySelectorAll) return;
    Array.from(box.querySelectorAll('[data-ov-use]')).forEach(function (cb) {
      cb.addEventListener('change', function () {
        var id = cb.getAttribute && cb.getAttribute('data-ov-use');
        if (!id) return;
        var row = box.querySelector('[data-ov-row="' + id + '"]');
        if (!row) return;
        Array.from(row.querySelectorAll('[data-ov-fold], [data-ov-final], [data-ov-rolls], [data-ov-bags]')).forEach(function (inp) {
          inp.disabled = cb.checked;
        });
        if (cb.checked) {
          // Copy the current global values into the (now disabled) inputs.
          var f = g('panFoldSec') ? g('panFoldSec').value : '';
          var fn = g('panFinalSec') ? g('panFinalSec').value : '';
          var rd = g('panRollsDefault') ? g('panRollsDefault').value : '';
          var bd = g('panBagsDefault') ? g('panBagsDefault').value : '';
          var fe = row.querySelector('[data-ov-fold="' + id + '"]');
          if (fe) fe.value = f;
          var fne = row.querySelector('[data-ov-final="' + id + '"]');
          if (fne) fne.value = fn;
          var re = row.querySelector('[data-ov-rolls="' + id + '"]');
          if (re) re.value = rd;
          var be = row.querySelector('[data-ov-bags="' + id + '"]');
          if (be) be.value = bd;
        }
      });
    });
  }

  /* Applying new settings: every READY pan picks up its OWN effective duration
     (per-pan override when set, otherwise the new global fold + final).
     Running / paused / done pans keep their current countdown untouched.
     Checkpoints (fold / close-prep) always use each pan's own timings. */
  function applySettings(next) {
    var prevCount = settings.panCount;
    settings = normalizeSettings(next);
    if (prevCount !== settings.panCount) rebuildPans();   // scale the production line
    pans.forEach(function (pan) {
      if (!pan.running && pan.stage === 0 && pan.remaining === pan.duration) {
        var t = getTimeoutSettings(pan);
        pan.duration = t.fold + t.final;
        pan.remaining = pan.duration;
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
      var preserved = byId[cfg.id];
      if (preserved) {
        // Keep the auto-report guard for pans that are carried over, so a
        // pan-count change can never cause a finished batch to be logged twice.
        if (reportedRun[preserved.id]) reportedRun[cfg.id] = true;
        Object.assign(preserved, { theme: cfg.theme, accent: cfg.accent, key: cfg.key, code: cfg.code, name: cfg.name });
        return preserved;
      }
      return createPan(cfg);
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

    var useGlobalAll = g('panUseGlobalBtn');
    if (useGlobalAll) useGlobalAll.addEventListener('click', function () {
      // Clear every pan's own timing so all pans follow the global settings.
      pans.forEach(function (pan) { removeOverride(pan.id); });
      renderPanOverrideRows();
    });
  }

  /* ---------- Persistence (timestamp-based → refresh-safe timers) ---------- */
  function save() {
    try {
      var data = {
        v: STORAGE_VERSION,
        settings: settings,
        pans: pans.map(function (p) {
          return { id: p.id, duration: p.duration, remaining: p.remaining, running: p.running, endAt: p.endAt, stage: p.stage, reported: !!reportedRun[p.id] };
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
      if (saved.reported) reportedRun[saved.id] = true;
      var eff = getTimeoutSettingsForId(pan.id);
      pan.duration = (saved.duration > 0) ? saved.duration : (eff.fold + eff.final);
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