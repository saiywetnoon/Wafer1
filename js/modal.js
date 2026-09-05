/* ============================================================
   IN-APP MODALS — replaces native confirm()/alert()/prompt()
   ------------------------------------------------------------
   Native dialogs block the page (freezing the pan timers and
   Background-Sync on phones), are unstylable, and their input
   can't be validated. These small promise-based dialogs render
   into the page instead and are fully theme-consistent.

   API:
     Modal.confirm({ title, message, okLabel, cancelLabel, danger })
        -> Promise<boolean>   (resolves true when OK pressed)
     Modal.prompt({ title, message, value, placeholder, inputType, validate })
        -> Promise<string|null>  (null when cancelled; validate(err) may
                                  show an inline error and refuse submit)
     Modal.alert({ title, message, okLabel })

   Load after helpers.js (uses $ / esc / lucide).
   ============================================================ */

const Modal = (function () {
  'use strict';
  let live = null; // current dialog element (only one dialog at a time)

  function backdrop() {
    const d = document.createElement('div');
    d.className = 'fixed inset-0 z-[300] bg-gray-950/80 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto';
    return d;
  }
  function panel() {
    const p = document.createElement('div');
    p.className = 'w-full max-w-sm card bg-gray-900 rounded-2xl border border-gray-700 p-5 shadow-2xl shadow-black/60 text-left';
    p.setAttribute('role', 'dialog');
    p.setAttribute('aria-modal', 'true');
    return p;
  }
  function titleEl(title, danger) {
    const h = document.createElement('h3');
    h.className = 'font-bold text-base flex items-center gap-2 ' + (danger ? 'text-red-400' : 'text-gray-100');
    const ic = document.createElement('i');
    ic.setAttribute('data-lucide', danger ? 'alert-triangle' : 'help-circle');
    ic.className = 'w-5 h-5 shrink-0';
    h.appendChild(ic);
    h.appendChild(document.createTextNode(String(title || '')));
    return h;
  }
  function msgEl(message) {
    const m = document.createElement('div');
    m.className = 'text-xs text-gray-400 mt-2 leading-relaxed whitespace-pre-wrap break-words';
    m.textContent = String(message || '');
    return m;
  }
  function btnRow() {
    const row = document.createElement('div');
    row.className = 'flex justify-end gap-2 mt-5';
    return row;
  }
  function button(label, cls, opts) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'px-4 py-2 rounded-lg text-white text-xs font-bold transition ' + cls;
    b.textContent = String(label || '');
    if (opts && opts.autofocus) b.setAttribute('autofocus', '');
    return b;
  }
  function inputEl(type, value, placeholder) {
    const i = document.createElement('input');
    i.type = type || 'text';
    i.value = (value === undefined || value === null) ? '' : String(value);
    i.placeholder = placeholder || '';
    i.className = 'mt-3 w-full px-3 py-2 rounded-lg border border-gray-700 bg-gray-800 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500';
    i.autocomplete = 'off';
    return i;
  }
  function errorLine() {
    const e = document.createElement('div');
    e.className = 'text-[11px] text-red-400 mt-1.5 hidden';
    return e;
  }

  function close(dialog) {
    if (!dialog) return;
    if (dialog._backdrop && dialog._backdrop.parentNode) dialog._backdrop.parentNode.removeChild(dialog._backdrop);
    document.removeEventListener('keydown', dialog._keyHandler, true);
    if (live === dialog) live = null;
    try {
      if (window.lucide) lucide.createIcons();
    } catch (e) { /* icon refresh is best-effort */ }
    const activeEl = dialog._prevFocus;
    if (activeEl && activeEl.focus) activeEl.focus();
  }

  function openDialog(dialog) {
    if (live) close(live);
    dialog._prevFocus = document.activeElement;
    live = dialog;
    document.body.appendChild(dialog._backdrop);
    dialog._backdrop.appendChild(dialog._panel);
    dialog._keyHandler = function (e) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close(dialog);
        dialog._onClose(false, null);
      }
    };
    document.addEventListener('keydown', dialog._keyHandler, true);
    try {
      if (window.lucide) lucide.createIcons();
    } catch (e) { /* ignore */ }
    const focus = dialog._panel.querySelector('[autofocus], input, button:last-child');
    if (focus) setTimeout(function () { focus.focus(); }, 10);
  }

  function confirm(opts) {
    opts = opts || {};
    return new Promise(function (resolve) {
      const dialog = {};
      dialog._backdrop = backdrop();
      dialog._panel = panel();
      const danger = !!opts.danger;
      dialog._panel.appendChild(titleEl(opts.title || 'Are you sure?', danger));
      dialog._panel.appendChild(msgEl(opts.message || ''));
      const row = btnRow();
      const cancel = button(opts.cancelLabel || 'Cancel', 'bg-gray-700 hover:bg-gray-600', { autofocus: true });
      cancel.addEventListener('click', function () { close(dialog); resolve(false); });
      const ok = button(opts.okLabel || (danger ? 'Delete' : 'OK'), danger
        ? 'bg-red-600 hover:bg-red-500'
        : 'bg-emerald-600 hover:bg-emerald-500');
      ok.addEventListener('click', function () { close(dialog); resolve(true); });
      row.appendChild(cancel);
      row.appendChild(ok);
      dialog._panel.appendChild(row);
      dialog._onClose = function (_, val) { resolve(!!val); };
      openDialog(dialog);
    });
  }

  function prompt(opts) {
    opts = opts || {};
    return new Promise(function (resolve) {
      const dialog = {};
      dialog._backdrop = backdrop();
      dialog._panel = panel();
      dialog._panel.appendChild(titleEl(opts.title || 'Enter a value', false));
      dialog._panel.appendChild(msgEl(opts.message || ''));
      const input = inputEl(opts.inputType || 'text', opts.value, opts.placeholder);
      const err = errorLine();
      dialog._panel.appendChild(input);
      dialog._panel.appendChild(err);
      const row = btnRow();
      const cancel = button(opts.cancelLabel || 'Cancel', 'bg-gray-700 hover:bg-gray-600', { autofocus: true });
      cancel.addEventListener('click', function () { close(dialog); resolve(null); });
      const ok = button(opts.okLabel || 'OK', 'bg-amber-500 hover:bg-amber-400 text-gray-900');
      function submit() {
        const raw = input.value;
        if (typeof opts.validate === 'function') {
          const problem = opts.validate(raw);
          if (problem) {
            err.textContent = problem;
            err.classList.remove('hidden');
            input.focus();
            return;
          }
        }
        err.classList.add('hidden');
        close(dialog);
        resolve(raw);
      }
      ok.addEventListener('click', submit);
      input.addEventListener('keydown', function (e) {
        e.stopPropagation();
        if (e.key === 'Enter') { e.preventDefault(); submit(); }
      });
      row.appendChild(cancel);
      row.appendChild(ok);
      dialog._panel.appendChild(row);
      dialog._onClose = function (_, val) { resolve(val); };
      openDialog(dialog);
      setTimeout(function () { input.focus(); if (input.value) input.select(); }, 20);
    });
  }

  function alert(opts) {
    opts = opts || {};
    return new Promise(function (resolve) {
      const dialog = {};
      dialog._backdrop = backdrop();
      dialog._panel = panel();
      dialog._panel.appendChild(titleEl(opts.title || 'Notice', opts.danger));
      dialog._panel.appendChild(msgEl(opts.message || ''));
      const row = btnRow();
      const ok = button(opts.okLabel || 'OK', 'bg-emerald-600 hover:bg-emerald-500', { autofocus: true });
      ok.addEventListener('click', function () { close(dialog); resolve(); });
      row.appendChild(ok);
      dialog._panel.appendChild(row);
      dialog._onClose = function () { resolve(); };
      openDialog(dialog);
    });
  }

  return { confirm: confirm, prompt: prompt, alert: alert };
})();