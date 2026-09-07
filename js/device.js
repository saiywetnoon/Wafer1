/* ============================================================
   DEVICE IDENTITY — who is THIS browser, and who saved a change
   ------------------------------------------------------------
   Sync used to have no way to tell "this tab's own echo" apart
   from a real change made on another phone / PC. Every push was
   broadcast back to the same tab by Supabase Realtime, and the
   app could only compare content — which races while you type
   (an echo of an earlier push arrives after newer local edits,
   looks "different", and pops the "Change From Another Device"
   modal on the very browser that made the change).

   This module gives every browser a stable id and every open
   tab a session id. Pushes carry both, so:
     - an echo from THIS tab is recognised instantly (ignored),
     - a change from ANOTHER tab / phone / PC is shown with its
       exact label, e.g. "Chrome · Windows (PC)".
   ============================================================ */

const DEVICE_ID_KEY = 'dailyCrispyRollLedger_deviceId';
let __deviceSessionId = null;

/* Stable per-browser id (survives refresh; shared by all tabs of
   this browser profile). Used so the cloud can tell "which device"
   wrote a row even after the tab that wrote it has closed. */
function getDeviceId() {
  try {
    let id = localStorage.getItem(DEVICE_ID_KEY);
    if (!id) {
      id = 'dev-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12);
      localStorage.setItem(DEVICE_ID_KEY, id);
    }
    return id;
  } catch (e) {
    return 'dev-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12);
  }
}

/* Per-tab id (in-memory only). Two tabs of the SAME browser are
   genuinely separate editors, so each gets its own session — but
   a tab's own realtime echo always carries its own session id and
   is therefore recognised and ignored instead of popping a modal. */
function getSessionId() {
  if (!__deviceSessionId) {
    __deviceSessionId = 'sess-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12);
  }
  return __deviceSessionId;
}

/* ---------- Human-readable device facts ---------- */

function deviceBrowserName() {
  try {
    const uad = navigator.userAgentData;
    if (uad && uad.brands && uad.brands.length) {
      // userAgentData brands are ordered newest-first; skip the
      // generic "Not A Brand"/"Chromium" placeholders.
      const known = uad.brands.find(function (b) {
        return b && b.brand && !/not.?a.?brand/i.test(b.brand) && !/chromium/i.test(b.brand);
      });
      if (known && known.brand) return known.brand;
    }
  } catch (e) { /* fall through to userAgent parsing */ }
  const ua = (navigator.userAgent || '');
  if (/edg(e|a)?\//i.test(ua)) return 'Edge';
  if (/opr\//i.test(ua) || /opera/i.test(ua)) return 'Opera';
  if (/samsungbrowser/i.test(ua)) return 'Samsung Internet';
  if (/crios/i.test(ua)) return 'Chrome';
  if (/chrome/i.test(ua)) return 'Chrome';
  if (/firefox|fxios/i.test(ua)) return 'Firefox';
  if (/safari/i.test(ua)) return 'Safari';
  return 'Browser';
}

function deviceOsName() {
  try {
    const uad = navigator.userAgentData;
    if (uad && uad.platform) {
      const p = String(uad.platform);
      if (/win/i.test(p)) return 'Windows';
      if (/android/i.test(p)) return 'Android';
      if (/iphone|ipad|ipod|ios/i.test(p)) return 'iOS';
      if (/mac/i.test(p)) return 'macOS';
      if (/linux/i.test(p)) return 'Linux';
      return p;
    }
  } catch (e) { /* fall through to userAgent parsing */ }
  const ua = (navigator.userAgent || '');
  if (/windows nt/i.test(ua)) return 'Windows';
  if (/android/i.test(ua)) return 'Android';
  if (/iphone|ipad|ipod/i.test(ua)) return 'iOS';
  if (/mac os x/i.test(ua)) return 'macOS';
  if (/linux/i.test(ua)) return 'Linux';
  return '';
}

/* 'phone' when this is a touch/mobile browser, otherwise 'computer'. */
function deviceFormFactor() {
  try {
    if (navigator.userAgentData) return navigator.userAgentData.mobile ? 'phone' : 'computer';
  } catch (e) { /* fall through */ }
  const ua = (navigator.userAgent || '');
  if (/mobi|android|iphone|ipad|ipod/i.test(ua)) return 'phone';
  return 'computer';
}

/* "Chrome · Windows (PC)" / "Safari · iOS (phone)" — the exact
   address of this browser shown to the user. */
function getDeviceLabel() {
  const b = deviceBrowserName();
  const os = deviceOsName();
  const kind = deviceFormFactor();
  let label = b;
  if (os) label += ' · ' + os;
  label += kind === 'phone' ? ' (phone)' : ' (PC)';
  return label;
}

/* Full identity stamped onto every cloud push. `id` = the browser,
   `sessionId` = this exact tab. */
function getDeviceFact() {
  return {
    id: getDeviceId(),
    sessionId: getSessionId(),
    label: getDeviceLabel(),
    browser: deviceBrowserName(),
    os: deviceOsName(),
    kind: deviceFormFactor()
  };
}

/* Render a device fact as text for the review modal / status line. */
function deviceLabelOf(d) {
  if (!d) return '';
  if (d.label) return d.label;
  if (d.browser || d.os) {
    let label = d.browser || 'Browser';
    if (d.os) label += ' · ' + d.os;
    label += d.kind === 'phone' ? ' (phone)' : ' (PC)';
    return label;
  }
  return '';
}