/* ============================================================
   PWA — service worker registration + install button
   ------------------------------------------------------------
   Makes the app installable on PC (Chrome/Edge "Install") and
   phone (Android "Install app" / iOS "Add to Home Screen").
   The #installAppBtn button appears only when the browser offers
   a real install prompt (beforeinstallprompt). On mobile browsers
   without the prompt the toast explains how to add it manually.
   ============================================================ */

(function () {
  var deferredPrompt = null;
  var triedManual = false;

  function hideInstallBtn() {
    var b = document.getElementById('installAppBtn');
    if (b) b.classList.add('hidden');
  }
  function showInstallBtn() {
    var b = document.getElementById('installAppBtn');
    if (b) b.classList.remove('hidden');
  }
  function manualHint() {
    if (triedManual) return;
    triedManual = true;
    var isIOS = /iphone|ipad|ipod|ios/i.test((navigator.userAgent || ''));
    var msg = isIOS
      ? 'To install: Safari → Share → "Add to Home Screen".'
      : 'To install: browser menu → "Install app" / "Add to Home Screen".';
    if (typeof showToast === 'function') showToast(msg, 'info');
    else alert(msg);
  }

  // A browser that CAN install the app gives us this event.
  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    deferredPrompt = e;
    showInstallBtn();
  });

  var installBtn = document.getElementById('installAppBtn');
  if (installBtn) {
    installBtn.addEventListener('click', function () {
      if (!deferredPrompt) { manualHint(); return; }
      deferredPrompt.prompt();
      deferredPrompt.userChoice.then(function () {
        deferredPrompt = null;
        hideInstallBtn();
      }).catch(function () {});
    });
  }

  window.addEventListener('appinstalled', function () {
    deferredPrompt = null;
    hideInstallBtn();
  });

  // Register the service worker (needs https or localhost).
  if ('serviceWorker' in navigator) {
    var host = window.location.hostname;
    if (window.location.protocol === 'https:' || host === 'localhost' || host === '127.0.0.1') {
      window.addEventListener('load', function () {
        navigator.serviceWorker.register('sw.js').catch(function (err) {
          console.warn('[PWA] service worker registration failed', err);
        });
      });
    } else {
      console.warn('[PWA] service workers need https/localhost — installable app disabled on this origin.');
    }
  }
})();