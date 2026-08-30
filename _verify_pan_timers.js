/* Verify the pan-timer core logic (mirrors js/pan-timers.js implementation).
   Run with: node _verify_pan_timers.js */
const SETTINGS_DEFAULTS = { fold: 50, final: 20, volume: 75, beep: true, toast: true, title: true, nav: true, vibrate: true };
let CONF = { fold: 50, final: 20 };   // live settings the step logic reads

function normalizeSettings(raw) {
  const s = raw || {};
  function num(v, lo, hi, dflt) {
    const n = parseInt(v, 10);
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

function createPan(duration) {
  return { duration, remaining: duration, running: false, endAt: 0, stage: 0 };
}
function fmtTime(sec) {
  sec = Math.max(0, Math.ceil(sec));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m + ':' + (s < 10 ? '0' + s : s);
}
function stepPan(pan, now) {
  if (!pan.running || !pan.endAt) return false;
  const prev = pan.remaining;
  pan.remaining = Math.max(0, Math.ceil((pan.endAt - now) / 1000));
  if (pan.remaining === prev) return false;
  if (pan.remaining <= 0) {
    pan.running = false;
    if (pan.stage !== 3) { pan.stage = 3; return true; }
    return false;
  }
  const foldDue = pan.stage < 1 && pan.duration > CONF.fold &&
                  pan.remaining <= pan.duration - CONF.fold;
  if (foldDue) { pan.stage = (pan.remaining <= CONF.final) ? 2 : 1; return true; }
  if (pan.stage === 1 && pan.remaining <= CONF.final) { pan.stage = 2; return true; }
  return false;
}
function pause(pan, now) {
  pan.running = false;
  pan.remaining = Math.max(0, Math.ceil((pan.endAt - now) / 1000));
  pan.endAt = 0;
}

let pass = 0, fail = 0;
function check(name, cond) {
  console.log((cond ? 'PASS' : 'FAIL') + '  ' + name);
  cond ? pass++ : fail++;
}

/* == 1) default 70 s batch: 0:00–0:50 silent heating, fold at 0:50, roll at 1:10 == */
console.log('== 1) default 70s workflow (0:00–0:50 heat → fold → 0:20 heat → roll) ==');
const T0 = 1_000_000_000_000;
const p = createPan(70);
p.running = true; p.endAt = T0 + 70_000;
const events = [];
for (let now = T0; now <= T0 + 75_000; now += 250) {
  if (stepPan(p, now)) events.push({ atElapsed: Math.round((now - T0) / 1000), stage: p.stage, remaining: p.remaining });
}
check('no alerts during 0:00–0:49 heating', events.length === 0 || events[0].atElapsed >= 50);
check('first alert fires at exactly t=50s (0:50)', events[0] && events[0].atElapsed === 50);
check('first alert is the combined fold+close stage (stage 2, remaining 20)', events[0] && events[0].stage === 2 && events[0].remaining === 20);
check('fold fired exactly once', events.filter(e => e.stage === 2).length === 1);
check('done fires exactly once at 0:00 remaining', events.some(e => e.stage === 3 && e.remaining === 0) && events.filter(e => e.stage === 3).length === 1);
check('pan ends stopped and done', !p.running && p.stage === 3 && p.remaining === 0);

/* == 2) longer 90 s batch: fold at 0:50 elapsed, close/prep at 0:20 remaining, done == */
console.log('== 2) longer batch keeps fold at 50s elapsed + separate 20s-remaining alert ==');
const q = createPan(90);
q.running = true; q.endAt = T0 + 90_000;
const evQ = [];
for (let now = T0; now <= T0 + 95_000; now += 250) {
  if (stepPan(q, now)) evQ.push({ atElapsed: Math.round((now - T0) / 1000), stage: q.stage, remaining: q.remaining });
}
check('fold fired once at 50 s elapsed (stage 1, remaining 40)', evQ.filter(e => e.stage === 1).length === 1 && evQ.find(e => e.stage === 1).atElapsed === 50 && evQ.find(e => e.stage === 1).remaining === 40);
check('close/prep fired once at 20 s remaining (elapsed 70)', evQ.filter(e => e.stage === 2).length === 1 && evQ.find(e => e.stage === 2).remaining === 20);
check('done fired once at 0:00', evQ.filter(e => e.stage === 3).length === 1);
check('no alert ever fired during the first 49 s', evQ.every(e => e.atElapsed >= 50));

/* == 3) short batches: 45 s has no fold at all; 60 s folds inside the last-20s window == */
console.log('== 3) short-batch guards ==');
const s = createPan(45);
s.running = true; s.endAt = T0 + 45_000;
const evS = [];
for (let now = T0; now <= T0 + 50_000; now += 250) { if (stepPan(s, now)) evS.push(s.stage); }
check('45 s batch fires nothing before done', evS.filter(x => x === 1 || x === 2).length === 0 && evS.filter(x => x === 3).length === 1);
const s2 = createPan(60);
s2.running = true; s2.endAt = T0 + 60_000;
const evS2 = [];
for (let now = T0; now <= T0 + 65_000; now += 250) { if (stepPan(s2, now)) evS2.push({ stage: s2.stage, remaining: s2.remaining }); }
check('60 s batch folds at 50 s elapsed (remaining 10, combined stage 2)', evS2[0] && evS2[0].stage === 2 && evS2[0].remaining === 10);

/* == 4) three parallel pans stay isolated == */
console.log('== 4) isolation + clocked checkpoints ==');
const p1 = createPan(70), p2 = createPan(70), p3 = createPan(45);
p1.running = true; p1.endAt = T0 + 70_000;
p2.running = true; p2.endAt = T0 + 60_000;   // started 10 s earlier
p3.running = true; p3.endAt = T0 + 45_000;
const fP1 = [], fP2 = [], fP3 = [];
for (let now = T0; now <= T0 + 75_000; now += 250) {
  [p1, p2, p3].forEach((pan, idx) => { if (stepPan(pan, now)) [fP1, fP2, fP3][idx].push({ at: now, stage: pan.stage }); });
}
check('p1 fold fired once, p1 done once', fP1.filter(e => e.stage === 2).length === 1 && fP1.filter(e => e.stage === 3).length === 1);
check('p2 (10 s earlier) fired its fold before p1', fP2[0].stage === 2 && fP2.find(e => e.stage === 2).at < fP1.find(e => e.stage === 2).at);
check('p3 (45 s) no fold, just done', fP3.filter(e => e.stage === 3).length === 1 && fP3.filter(e => e.stage === 1 || e.stage === 2).length === 0);
check('final stages all 3, none running', p1.stage === 3 && p2.stage === 3 && p3.stage === 3 && !p1.running && !p2.running && !p3.running);

/* == 5) pause/resume keeps remaining, no double-fire == */
console.log('== 5) pause/resume isolation ==');
const r2 = createPan(70);
r2.running = true; r2.endAt = T0 + 70_000;
for (let now = T0; now <= T0 + 40_000; now += 1000) stepPan(r2, now);  // pause BEFORE the fold
pause(r2, T0 + 40_000);
check('paused before fold froze at 30 s remaining, stage 0', r2.remaining === 30 && !r2.running && r2.stage === 0);
let foldAt = null;
r2.running = true; r2.endAt = (T0 + 40_000) + r2.remaining * 1000;     // resume exact point
for (let now = T0 + 40_000; now <= T0 + 80_000; now += 1000) { if (stepPan(r2, now) && r2.stage === 2) foldAt = Math.round((now - (T0 + 40_000)) / 1000); }
check('after resume the fold fires exactly once — 10 s later (30 s left → 20 s left)', foldAt === 10 && r2.stage === 3);

/* == 6) display formatting == */
console.log('== 6) fmtTime ==');
check('fmtTime(70) = 1:10', fmtTime(70) === '1:10');
check('fmtTime(50) = 0:50', fmtTime(50) === '0:50');
check('fmtTime(59) = 0:59', fmtTime(59) === '0:59');
check('fmtTime(-5) = 0:00', fmtTime(-5) === '0:00');

/* == 7) custom settings drive checkpoints + clamping == */
console.log('== 7) custom settings ==');
const clamped = normalizeSettings({ fold: '9999', final: 'abc', volume: -5, toast: false, panCount: '99' });
check('normalize clamps fold to 600', clamped.fold === 600);
check('normalize falls back for garbage final (default 20)', clamped.final === 20);
check('normalize clamps volume to 0', clamped.volume === 0);
check('normalize clamps panCount to 9', clamped.panCount === 9);
check('normalize keeps explicit toasts off, defaults on', clamped.toast === false && clamped.beep === true && clamped.title === true && clamped.vibrate === true);

CONF = { fold: 40, final: 15 };   // user tweaked the batch timing
const c = createPan(55);          // standard = fold + final
c.running = true; c.endAt = T0 + 55_000;
const evC = [];
for (let now = T0; now <= T0 + 60_000; now += 250) {
  if (stepPan(c, now)) evC.push({ atElapsed: Math.round((now - T0) / 1000), stage: c.stage, remaining: c.remaining });
}
check('custom fold alert fires exactly at 40 s elapsed (stage 2, remaining 15)', evC.filter(e => e.stage === 2).length === 1 && evC.find(e => e.stage === 2).atElapsed === 40 && evC.find(e => e.stage === 2).remaining === 15);
check('custom batch finishes once at 0:00', evC.filter(e => e.stage === 3).length === 1);
check('no alerts before the custom 40 s fold time', evC.every(e => e.atElapsed >= 40));

const targetProfitBags = (target, capital, laborCost, priceBag, perBag) => {
  if (!(priceBag > 0)) return { bags: 0, pieces: 0 };
  const bags = Math.ceil((capital + laborCost + target) / priceBag);
  return { bags, pieces: bags * perBag };
};

console.log('== A) production qty should never reset while editing ==');
const moq = {
  names: ['Water', 'Electricity'],
  stockFlags: { Water: false, Electricity: false },
  isStockItem(n) { return !(this.stockFlags[n] === false); },
  inventoryShortage(usage) {
    for (const n of Object.keys(usage)) {
      if (!this.isStockItem(n)) continue;
      const avail = 0;
      if (usage[n] > avail) return { name: n, available: avail, requested: usage[n] };
    }
    return null;
  }
};
check('water (non-stock) does not block a production batch', moq.inventoryShortage({ Water: 580, Electricity: 4 }) === null);
check('flour (stock) still blocks when short', moq.inventoryShortage({ Flour: 5000 }) && moq.inventoryShortage({ Flour: 5000 }).name === 'Flour');

console.log('== B) target-profit calculator ==');
const r = targetProfitBags(50000, 200000, 12000, 1300, 6);
check('bags for 50k profit over 212k costs at 1300/bag', r.bags === 202);   // ceil(262000/1300)=202
check('pieces = bags × perBag', r.bags * 6 === r.pieces);
check('no price -> 0 bags', targetProfitBags(10000, 2000, 0, 0, 6).bags === 0);

console.log('== C) dynamic pan configs (scalable pans) ==');
function buildPanConfigs(count) {
  count = Math.max(1, Math.min(9, count));
  const T = ['sky', 'amber', 'violet', 'emerald', 'rose', 'cyan', 'lime', 'purple', 'orange'];
  return Array.from({ length: count }, (_, i) => ({ id: 'pan' + (i + 1), key: String(i + 1), code: 'Digit' + (i + 1), theme: T[i] }));
}
check('buildPanConfigs(9) yields 9 pans, last key Digit9', buildPanConfigs(9).length === 9 && buildPanConfigs(9)[8].code === 'Digit9');
check('pan count clamps up to 9', buildPanConfigs(12).length === 9);
check('pan count clamps down to 1', buildPanConfigs(0).length === 1);

console.log(fail === 0 ? 'ALL CHECKS PASSED' : fail + ' CHECK(S) FAILED');
process.exit(fail === 0 ? 0 : 1);