/* ============================================================
   i18n — English / Myanma (Burmese) language toggle
   ------------------------------------------------------------
   - `t(text)` looks the exact English phrase up in the dictionary
     and returns the Myanma translation (English fallback).
   - Static UI is translated by walking DOM text nodes and exact-
     matching their trimmed content against the dictionary, so the
     app's own HTML needs no extra attributes. Switch back and the
     original English is restored from memory.
   - `showToast`, `confirm`, `prompt`, `alert` messages are
     translated automatically the same way (exact match, fallback).
   - The choice is saved per device in localStorage.
   ============================================================ */
const LANG_STORAGE_KEY = 'dailyCrispyRollLedger_lang';
let appLang = 'en';

function readAppLang() {
  try {
    const v = localStorage.getItem(LANG_STORAGE_KEY);
    return v === 'my' ? 'my' : 'en';
  } catch (e) { return 'en'; }
}
function getAppLang() { return appLang; }
function currentLang() { return appLang; }

/* Exact-match translation with English fallback. */
function t(text) {
  if (appLang !== 'my' || text == null || String(text).trim() === '') return text;
  const v = I18N_MY[String(text).trim()];
  return v !== undefined ? v : text;
}

function updateDocumentTitle() {
  try {
    document.title = appLang === 'my'
      ? 'နေ့စဉ် ကြွပ်ကြွပ်အလိပ်စာရင်း'
      : 'My Crispy Roll Ledger — Cloud-Synced Daily Record-Keeping';
  } catch (e) {}
}

/* Walk the DOM and translate every text node / placeholder / title
   whose (trimmed) English matches a dictionary entry. English originals
   are remembered on the node so switching back restores them exactly. */
function applyLanguageToDom(root) {
  try {
    root = root || document.body;
    if (!root) return;
    if (typeof NodeFilter === 'undefined' || typeof document.createTreeWalker !== 'function') {
      translateAttributes(root);
      return;
    }
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const textNodes = [];
    while (walker.nextNode()) textNodes.push(walker.currentNode);
    textNodes.forEach(function (n) {
      const raw = n.nodeValue;
      if (!raw || raw.trim() === '') return;
      let el = n.parentNode;
      while (el && el.nodeType !== 1) el = el.parentNode;
      if (el && el.closest && el.closest('[data-noi18n]')) return;
      if (n.__enText === undefined) n.__enText = raw;
      const en = String(n.__enText);
      if (appLang === 'en') {
        if (n.nodeValue !== en) n.nodeValue = en;
      } else {
        const tr = I18N_MY[en.trim()];
        if (tr !== undefined && n.nodeValue !== tr) n.nodeValue = tr;
      }
    });
    translateAttributes(root);
  } catch (e) { console.warn('applyLanguageToDom failed', e); }
}

function translateAttributes(root) {
  try {
    const els = root || document.body;
    if (!els) return;
    Array.prototype.forEach.call(els.querySelectorAll('[placeholder],[title],[aria-label]'), function (el) {
      if (el.dataset && el.dataset.noi18n) return;
      ['placeholder', 'title', 'aria-label'].forEach(function (attr) {
        if (!el.hasAttribute(attr)) return;
        if (el['data-i18n-' + attr] === undefined) el['data-i18n-' + attr] = el.getAttribute(attr);
        const en = el['data-i18n-' + attr];
        const tr = en && appLang === 'my' ? I18N_MY[String(en).trim()] : undefined;
        el.setAttribute(attr, (tr !== undefined && appLang === 'my') ? tr : en);
      });
    });
  } catch (e) { /* best-effort */ }
}

/* Update the two language-toggle buttons with the TARGET language. */
function updateLangToggleLabels() {
  const target = appLang === 'en' ? 'မြန်မာ' : 'English';
  const title = appLang === 'en' ? 'Switch language to Myanma (Burmese)' : 'ဘာသာစကား ပြောင်းရန် (English)';
  ['langToggleLabel', 'authLangToggleLabel'].forEach(function (id) {
    const el = document.getElementById(id);
    if (el) el.textContent = target;
  });
  ['langToggleBtn', 'authLangToggleBtn'].forEach(function (id) {
    const el = document.getElementById(id);
    if (el) el.setAttribute('title', title);
  });
  const instEl = document.getElementById('installAppLabel');
  if (instEl) instEl.textContent = t('Install');
}

function setAppLang(lang) {
  appLang = lang === 'my' ? 'my' : 'en';
  try { localStorage.setItem(LANG_STORAGE_KEY, appLang); } catch (e) {}
  try {
    const html = document.documentElement;
    if (html) html.setAttribute('lang', appLang);
  } catch (e) {}
  updateDocumentTitle();
  applyLanguageToDom();
  updateLangToggleLabels();
  if (typeof renderAll === 'function') { try { renderAll(); } catch (e) {} }
}

function toggleAppLang() {
  setAppLang(appLang === 'my' ? 'en' : 'my');
  const msg = appLang === 'my' ? 'ဘာသာစကားကို မြန်မာသို့ ပြောင်းပြီးပါပြီ ☑' : 'Language switched to English ☑';
  if (typeof showToast === 'function') showToast(msg, 'success');
}

/* Translate confirm/prompt/alert messages on the fly. */
function i18nWrapDialogs() {
  try {
    if (!window.__i18nPatched) {
      window.__i18nPatched = true;
      const c0 = window.confirm, p0 = window.prompt, a0 = window.alert;
      window.confirm = function (msg) { return c0(t(msg)); };
      window.prompt = function (msg, def) { return arguments.length > 1 ? p0(t(msg), def) : p0(t(msg)); };
      window.alert = function (msg) { return a0(t(msg)); };
    }
  } catch (e) {}
}

/* ============================================================
   MYANMA (BURMESE) DICTIONARY — English key → Myanma value.
   Exact match only; anything not listed stays in English.
   ============================================================ */
const I18N_MY = {
  // ---------- Top bar ----------
  'Daily Crispy Roll Ledger': 'နေ့စဉ် ကြွပ်ကြွပ်အလိပ်စာရင်း',
  'Cloud-synced across devices': 'စက်ပစ္စည်းများကြား Cloud ဖြင့် ထပ်တူကျသည်',
  'Sign Out': 'ထွက်မည်',
  'Sign out': 'ထွက်မည်',
  'Admin': 'အက်မင်',
  'Notifications': 'အသိပေးချက်များ',
  'All caught up': 'အားလုံးပြည့်စုံပြီ',
  'Switch workspace': 'လုပ်ငန်းခွင်ပြောင်းရန်',
  'Sign out of your account': 'သင့်အကောင့်မှ ထွက်ရန်',
  'Approve new accounts': 'အကောင့်အသစ်များ အတည်ပြုရန်',
  'Notifications & alerts': 'အသိပေးချက်များနှင့် သတိပေးချက်များ',
  'Install': 'ထည့်သွင်းမည်',
  'Install app': 'အက်ပ်ထည့်သွင်းမည်',
  'Sync Now': 'ယခု Sync လုပ်မည်',
  'Reconnect / Sync Now': 'ပြန်ချိတ် / Sync လုပ်မည်',
  'Numbers wrong on another device? One-time force copy': 'အခြားစက်တွင် ဂဏန်းများ မှားနေပါသလား? တစ်ကြိမ် အတင်းကော်ပီပြုလုပ်ရန်',
  'Overwrite Cloud With This Device': 'ဤစက်မှ Cloud ကို အစားထိုးမည်',
  'Load Cloud Onto This Device': 'Cloud ကို ဤစက်ထဲ ထည့်သွင်းမည်',
  "Replace the CLOUD ledger with this device's data?\n\nAll other devices will pull this exact copy at their next sync.\nAny changes that exist ONLY on the cloud right now will be replaced.": 'ဤစက်၏ဒေတာဖြင့် Cloud စာရင်းကို အစားထိုးမည်လား?\n\nအခြားစက်အားလုံးသည် နောက် sync တွင် ဤကော်ပီအတိုင်း ဆွဲယူမည်။\nယခု cloud တွင်သာ ရှိသော အပြောင်းအလဲများကို အစားထိုးမည်။',
  "Replace THIS device's data with the cloud copy?\n\nUse this on a device showing stale/old numbers after you overwrote the cloud.\nLocal-only changes that never reached the cloud will be replaced.": 'ဤစက်၏ဒေတာကို cloud ကော်ပီဖြင့် အစားထိုးမည်လား?\n\ncloud ကို အစားထိုးပြီးနောက် ဂဏန်းဟောင်းများ ပြသနေသော စက်တွင်သုံးပါ။\ncloud သို့ မရောက်ဖူးသော ဤစက်တွင်သာရှိသည့် အပြောင်းအလဲများကို အစားထိုးမည်။',
  'This Device & Account': 'ဤစက်ပစ္စည်းနှင့် အကောင့်',
  // ---------- Navigation ----------
  'Operations': 'လုပ်ငန်းများ',
  'Production': 'ထုတ်လုပ်မှု',
  'Fry Timers': 'ကြော်မီတာများ',
  'Sales & Stock': 'အရောင်းနှင့် စတော့',
  'Insight': 'ထိုးထွင်းသိမြင်မှု',
  'Dashboard': 'အကျဉ်းချုပ်',
  'Calendar & Audit': 'ပြက္ခဒိန်နှင့် စစ်ဆေးမှတ်တမ်း',
  'AI Root Cause': 'AI ဇာစ်မြစ်ရှာဖွေခြင်း',
  'Manage': 'စီမံခန့်ခွဲမှု',
  'Inventory': 'ကုန်ပစ္စည်းစာရင်း',
  'Customers': 'ဝယ်သူများ',
  'Suppliers': 'ပေးသွင်းသူများ',
  'Finance': 'ဘဏ္ဍာရေး',
  'Cash Drawer': 'ငွေသားသေတ္တာ',
  'System': 'စနစ်',
  'Business Tools': 'လုပ်ငန်းသုံး ကိရိယာများ',
  'Sync & Backup': 'Sync နှင့် အရန်ကူးမှု',
  // ---------- Production ----------
  'Ingredient Price List': 'ကုန်ကြမ်း ဈေးနှုန်းစာရင်း',
  "Today's Usage & Production": 'ယနေ့သုံးစွဲမှုနှင့် ထုတ်လုပ်မှု',
  'Recent Production (Rolled)': 'မကြာသေးသော ထုတ်လုပ်မှုများ',
  'Add Ingredient': 'ကုန်ကြမ်း ထည့်မည်',
  'Production Date': 'ထုတ်လုပ်သည့်ရက်',
  'Total Bags (Packed)': 'စုစုပေါင်း အိတ် (ထုပ်ပြီး)',
  'Actual Pieces Rolled': 'အမှန်တကယ် လိပ်အရေအတွက်',
  'Rolls per bag': 'တစ်အိတ်လျှင် လိပ်',
  'Weight of 1 roll (g)': 'လိပ်တစ်ခု၏ အလေးချိန် (ဂရမ်)',
  'Labor Worked (Minutes)': 'လုပ်အားချိန် (မိနစ်)',
  'Outcome / Quality Notes': 'ရလဒ် / အရည်အသွေး မှတ်ချက်',
  'Sell / use by date (optional)': 'ရောင်းရန် / သုံးရမည့်ရက် (ရွေးချယ်နိုင်သည်)',
  'Save Production Work': 'ထုတ်လုပ်မှု သိမ်းမည်',
  'Save Production': 'ထုတ်လုပ်မှု သိမ်းမည်',
  'Update Production': 'ထုတ်လုပ်မှု ပြင်ဆင်သိမ်းမည်',
  'Record the mix now — expected rolls appear instantly below': 'အရောအနှော မှတ်တမ်းတင်ပါ — မျှော်မှန်းလိပ်အရေအတွက် အောက်တွင် ချက်ချင်းပေါ်ပါမည်',
  // ---------- Sales ----------
  'Record a Sale': 'အရောင်းမှတ်တမ်း တင်ရန်',
  'Export Sales CSV': 'အရောင်း CSV ထုတ်မည်',
  'Sale Date': 'ရောင်းသည့်ရက်',
  'Bags Sold': 'ရောင်းပြီး အိတ်',
  'Pieces in those bags': 'အိတ်ထဲရှိ လိပ်အရေအတွက်',
  'Price per Bag (Ks)': 'တစ်အိတ်ဈေး (ကျပ်)',
  'Customer (optional)': 'ဝယ်သူ (ရွေးချယ်နိုင်သည်)',
  'Payment': 'ငွေပေးချေမှု',
  'Paid now (Ks)': 'ယခုပေးငွေ (ကျပ်)',
  'Due date (credit)': 'ပေးရမည့်ရက် (အကြွေး)',
  'Rolls per bag (full sets only)': 'တစ်အိတ်လျှင် လိပ် (အပြည့်အစုံသာ)',
  'Log Sale': 'အရောင်းသိမ်းမည်',
  'Sales Summary': 'ရောင်းအား အကျဉ်းချုပ်',
  'Recent Sales': 'မကြာသေးသော အရောင်းများ',
  'Export Ledger CSV': 'စာရင်း CSV ထုတ်မည်',
  'From Date': 'ရက်မှ',
  'To Date': 'ရက်အထိ',
  'Quick Week Select': 'တစ်ပတ် အမြန်ရွေးမှု',
  'Walk-in / no customer': 'အဝယ်တန်း / ဝယ်သူမရှိ',
  'Paid in full': 'အပြည့် ပေးပြီး',
  'Partial': 'တစ်စိတ်တစ်ပိုင်း',
  'Credit': 'အကြွေး',
  // ---------- Dashboard ----------
  'Day-by-Day Trends': 'နေ့စဉ် လားရာများ',
  'Net Gain (Ks)': 'အသားတင် အမြတ် (ကျပ်)',
  'Bags Produced': 'ထုတ်လုပ်သော အိတ်',
  'Summary': 'အကျဉ်းချုပ်',
  "Today's Money Out": 'ယနေ့ ထွက်ငွေ',
  'Monthly Profit Report': 'လစဉ် အမြတ် အစီရင်ခံစာ',
  'Full list in Cash tab': 'Cash တဘ်တွင် စာရင်းအပြည့်',
  // ---------- Calendar / AI ----------
  'Continuous Calendar & Audit Trail': 'စဉ်ဆက်မပြတ် ပြက္ခဒိန်နှင့် စစ်ဆေးမှတ်တမ်း',
  'AI Root Cause Analysis': 'AI ဇာစ်မြစ် ခွဲခြမ်းစိတ်ဖြာမှု',
  'AI Provider Settings': 'AI Provider ဆက်တင်များ',
  'Provider': 'Provider',
  'API Key': 'API သော့',
  'Endpoint': 'Endpoint',
  'Model': 'Model',
  // ---------- Inventory ----------
  'Ingredient Inventory': 'ကုန်ကြမ်း စတော့စာရင်း',
  'Add Stock': 'စတော့ ထည့်မည်',
  'Record Ingredient Waste': 'ကုန်ကြမ်း အလေအလွင့် မှတ်တမ်း',
  'Record Waste': 'အလေအလွင့် မှတ်တမ်းတင်မည်',
  // ---------- Customers ----------
  'Regular Customers': 'ပုံမှန် ဝယ်သူများ',
  'Credit / Debt Tracker': 'အကြွေး ခြေရာခံ',
  'Customer Name': 'ဝယ်သူအမည်',
  'Phone': 'ဖုန်း',
  'Standing Order (bags/day)': 'ပုံမှန် မှာယူမှု (အိတ်/နေ့)',
  'Price/Bag (Ks)': 'တစ်အိတ်ဈေး (ကျပ်)',
  'Add Customer': 'ဝယ်သူ ထည့်မည်',
  'Record Payment / New Debt': 'ငွေပေးချေမှု / အကြွေးအသစ်',
  // ---------- Suppliers ----------
  'Suppliers (Shops)': 'ပေးသွင်းသူများ (ဆိုင်များ)',
  'Record Stock Purchase': 'ကုန်ပစ္စည်း ဝယ်ယူမှု မှတ်တမ်း',
  'Shop Name': 'ဆိုင်အမည်',
  'Add Supplier': 'ပေးသွင်းသူ ထည့်မည်',
  'Shop': 'ဆိုင်',
  'Date': 'ရက်',
  'Items': 'ပစ္စည်းများ',
  'Add Item': 'ပစ္စည်း ထည့်မည်',
  'Paid Now (Ks)': 'ယခုပေးငွေ (ကျပ်)',
  'Payables & Record Payment': 'ပေးရန် ကြွေးနှင့် ငွေပေးချေမှု',
  'Amount (Ks)': 'ပမာဏ (ကျပ်)',
  'Record Payment': 'ငွေပေးချေမှု မှတ်တမ်း',
  // ---------- Timers ----------
  'Frying Pan Timers': 'ဒယ်အိုး မီတာများ',
  "Today's Batch Log": 'ယနေ့ အသုတ် မှတ်တမ်း',
  'Fry Timer Settings': 'ကြော်မီတာ ဆက်တင်များ',
  'Log finished batch → Production': 'ပြီးစီးသော အသုတ်ကို ထုတ်လုပ်မှုသို့ သိမ်းမည်',
  'Beep volume': 'Beep အတိုးအကျယ်',
  'Beep on alerts': 'သတိပေးချက်များတွင် Beep',
  'Show toast messages': 'Toast မက်ဆေ့ ပြရန်',
  'Flash browser-tab title': 'ဘရောက်ဆာ တဘ်ခေါင်းစဉ် မီးလင်းပြရန်',
  'Flash the Fry Timers menu button': 'Fry Timers မီနူးခလုတ် မီးလင်းပြရန်',
  'Vibrate on mobile': 'မိုဘိုင်းတွင် တုန်ခါမှု ပေးရန်',
  'Save Settings': 'ဆက်တင် သိမ်းမည်',
  // ---------- Business Tools ----------
  'Recipes / Variants': 'ချက်နည်းများ / အမျိုးကွဲများ',
  'Save Current': 'ယခုပုံစံ သိမ်းမည်',
  'Break-Even Calculator': 'ရှုံးမြတ်ချိန် တွက်ချက်မှု',
  'Waste / Scrap Tracking': 'အလေအလွင့် ခြေရာခံ',
  'Ingredient Price History': 'ကုန်ကြမ်း ဈေးနှုန်း မှတ်တမ်း',
  'One-Time Expenses': 'တစ်ကြိမ်တည်း ကုန်ကျစရိတ်',
  'Add Expense': 'ကုန်ကျစရိတ် ထည့်မည်',
  'Recurring Monthly Costs': 'လစဉ် ပုံမှန် ကုန်ကျစရိတ်',
  'Add Recurring Cost': 'လစဉ်ကုန်ကျစရိတ် ထည့်မည်',
  'Sales Forecast & Reports': 'အရောင်း ခန့်မှန်းချက်နှင့် အစီရင်ခံစာ',
  'Target profit (Ks)': 'ပစ်မှတ် အမြတ် (ကျပ်)',
  'Cover': 'အကျုံးဝင်ရန်',
  'Export Monthly CSV': 'လစဉ် CSV ထုတ်မည်',
  'Utilities & Danger Zone': 'အသုံးဝင်မှုများနှင့် အန္တရာယ်ဇုန်',
  'Reset All': 'အားလုံး ပြန်သတ်မှတ်မည်',
  'Clear All Data': 'ဒေတာ အားလုံး ဖျက်မည်',
  // ---------- Sync / Cash ----------
  'Online / Cloud': 'အွန်လိုင်း / Cloud',
  'Google Sheets Sync & Drive Backup': 'Google Sheets ထပ်တူပြုခြင်းနှင့် Drive အရန်ကူး',
  'Opening Balance': 'အစချိန် လက်ကျန်',
  'Manual Adjustment': 'လက်ဖြင့် ချိန်ညှိမှု',
  'Recent Adjustments': 'မကြာသေးသော ချိန်ညှိမှုများ',
  'Where Cash Comes From': 'ငွေဝင်ရာများ',
  'Where Cash Goes': 'ငွေထွက်ရာများ',
  'Money Out — What Was Spent & Why': 'ထွက်ငွေ — ဘာတွေသုံးခဲ့လဲ',
  'Daily Cash Count / Close': 'နေ့စဉ် ငွေကောက်ခံ / ပိတ်ချက်',
  // ---------- Account / Company ----------
  'Log In': 'ဝင်မည်',
  'Create Account': 'အကောင့်ဖွင့်မည်',
  'Email address': 'အီးမေးလ် လိပ်စာ',
  'Password': 'စကားဝှက်',
  'Server settings': 'ဆာဗာ ဆက်တင်များ',
  'Request Account': 'အကောင့် တောင်းခံမည်',
  'Private account access — sign in to use the ledger': 'ကိုယ်ပိုင်အကောင့်ဖြင့်သာ — စာရင်းဇယားသုံးရန် ဝင်ရောက်ပါ',
  'Company workspaces': 'ကုမ္ပဏီ လုပ်ငန်းခွင်',
  'Select your workspace': 'သင့် လုပ်ငန်းခွင်ကို ရွေးပါ',
  'Create & Sign In': 'ဖွဲ့စည်းပြီး ဝင်မည်',
  'Cancel': 'ပယ်ဖျက်မည်',
  'New business': 'လုပ်ငန်းအသစ်',
  // ---------- Common confirm / prompt / toast ----------
  'Please pick a production date.': 'ထုတ်လုပ်သည့်ရက် ရွေးပေးပါ။',
  'Nothing to save yet — enter the ingredient quantities first (expected rolls will appear below).': 'သိမ်းရန် မရှိသေးပါ — ကုန်ကြမ်း ပမာဏများကို အရင်ထည့်ပါ (မျှော်မှန်းလိပ်အရေအတွက် အောက်တွင် ပေါ်ပါမည်)။',
  'Bags, pieces and labor must be zero or valid numbers.': 'အိတ်၊ လိပ်နှင့် လုပ်အားသည် သုည သို့မဟုတ် မှန်ကန်သော ဂဏန်း ဖြစ်ရပါမည်။',
  'Enter date, bags, pieces and price per bag.': 'ရက်၊ အိတ်၊ လိပ်အရေအတွက်နှင့် တစ်အိတ်ဈေး ထည့်ပါ။',
  'Enter a customer name.': 'ဝယ်သူအမည် ထည့်ပါ။',
  'Enter a valid amount.': 'မှန်ကန်သော ပမာဏ ထည့်ပါ။',
  'This customer has no outstanding debt.': 'ဤဝယ်သူတွင် ပေးရန် ကြွေးမရှိပါ။',
  'Enter a valid quantity.': 'မှန်ကန်သော အရေအတွက် ထည့်ပါ။',
  'Enter a valid positive number.': 'မှန်ကန်သော အပေါင်းကိန်း ထည့်ပါ။',
  'Add a short description (e.g. petrol, draw, deposit).': 'အတိုချုံး ဖော်ပြချက် ထည့်ပါ (ဥပမာ။ ဓာတ်ဆီ၊ ထုတ်ယူမှု၊ အပ်ငွေ)။',
  'Enter a valid non-zero amount.': 'သုညမဟုတ်သော မှန်ကန်သည့် ပမာဏ ထည့်ပါ။',
  'Enter a valid monthly amount.': 'မှန်ကန်သော လစဉ်ပမာဏ ထည့်ပါ။',
  'Enter a name (e.g. Rent).': 'အမည် ထည့်ပါ (ဥပမာ။ အိမ်ငှား)။',
  'Choose an ingredient from the Price List first.': 'ဈေးနှုန်းစာရင်းမှ ကုန်ကြမ်း အရင်ရွေးပါ။',
  'Choose the wasted ingredient.': 'အလေအလွင့်ဖြစ်သော ကုန်ကြမ်းကို ရွေးပါ။',
  'Enter the reason for this ingredient waste.': 'ဤကုန်ကြမ်း အလေအလွင့်အတွက် အကြောင်းရင်း ထည့်ပါ။',
  'Enter a valid waste quantity.': 'မှန်ကန်သော အလေအလွင့် ပမာဏ ထည့်ပါ။',
  'Enter a description.': 'ဖော်ပြချက် ထည့်ပါ။',
  'Choose a customer for a partial or credit sale.': 'အပိုင်းပိုင်း သို့မဟုတ် အကြွေး ရောင်းချမှုအတွက် ဝယ်သူ ရွေးပါ။',
  'Choose Paid in full when the entire sale is paid now.': 'ရောင်းငွေ တစ်လုံးလုံး ယခုပေးလျှင် အပြည့်ပေးပြီး ရွေးပါ။',
  'Delete this production batch?': 'ဤ ထုတ်လုပ်မှုအသုတ်ကို ဖျက်မည်လား။',
  'Delete this expense?': 'ဤ ကုန်ကျစရိတ်ကို ဖျက်မည်လား။',
  'Remove this recurring expense?': 'ဤ လစဉ်ကုန်ကျစရိတ်ကို ဖယ်မည်လား။',
  'Delete this cash adjustment?': 'ဤ ငွေချိန်ညှိမှုကို ဖျက်မည်လား။',
  'Remove this customer?': 'ဤဝယ်သူကို ဖယ်ရှားမည်လား။',
  'Remove this supplier?': 'ဤပေးသွင်းသူကို ဖယ်ရှားမည်လား။',
  'Delete this sale?': 'ဤ အရောင်းကို ဖျက်မည်လား။',
  'At least 6 characters': 'အနည်းဆုံး စာလုံး ၆ လုံး'
};

/* ---------- bootstrap ---------- */
(function () {
  appLang = readAppLang();
  i18nWrapDialogs();
  try {
    const html = document.documentElement;
    if (html) html.setAttribute('lang', appLang);
  } catch (e) {}
  const applyNow = function () {
    updateDocumentTitle();
    applyLanguageToDom();
    updateLangToggleLabels();
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', applyNow);
  } else {
    applyNow();
  }
})();