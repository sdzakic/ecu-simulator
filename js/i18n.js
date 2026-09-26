/* Tiny i18n: English strings are the keys; ECU.HR maps them to Croatian.
   t('Knock on cylinder {c}', {c: 3}) → translated + placeholders filled.
   Placeholder values may themselves be {k, v} keys (translated recursively). */
(function () {
  const root = typeof window !== 'undefined' ? window : globalThis;
  const ECU = (root.ECU = root.ECU || {});
  ECU.HR = ECU.HR || {};
  ECU.INFO_HR = ECU.INFO_HR || {};

  let lang = 'hr';
  try {
    const saved = root.localStorage && root.localStorage.getItem('ecu-lang');
    if (saved === 'en' || saved === 'hr') lang = saved;
  } catch (e) { /* storage unavailable — keep default */ }
  ECU.lang = lang;

  ECU.tr = function (x) {
    if (x == null) return '';
    if (typeof x === 'object') return ECU.t(x.k, x.v);
    return String(x);
  };

  ECU.t = function (key, vars) {
    if (key == null) return '';
    const s = ECU.lang === 'hr' && ECU.HR[key] != null ? ECU.HR[key] : key;
    if (!vars) return s;
    return s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? ECU.tr(vars[k]) : m));
  };

  // long-form content (sensor explanations etc.): ECU.info('sensors', def, 'what')
  ECU.info = function (section, def, field) {
    if (ECU.lang === 'hr') {
      const o = ECU.INFO_HR[section] && ECU.INFO_HR[section][def.id];
      if (o && o[field] != null) return o[field];
    }
    return def[field];
  };

  // static HTML: [data-i18n] (text), [data-i18n-html] (markup), [data-i18n-title] (tooltip).
  // The original English content is captured once and used as the key.
  ECU.applyStatic = function (scope) {
    if (typeof document === 'undefined') return;
    const rootEl = scope || document;
    rootEl.querySelectorAll('[data-i18n]').forEach((el) => {
      if (el._k == null) el._k = el.textContent.trim();
      el.textContent = ECU.t(el._k);
    });
    rootEl.querySelectorAll('[data-i18n-html]').forEach((el) => {
      if (el._kh == null) el._kh = el.innerHTML.trim();
      el.innerHTML = ECU.lang === 'hr' && ECU.HR[el._kh] != null ? ECU.HR[el._kh] : el._kh;
    });
    rootEl.querySelectorAll('[data-i18n-title]').forEach((el) => {
      if (el._kt == null) el._kt = el.getAttribute('title') || '';
      el.setAttribute('title', ECU.t(el._kt));
    });
    document.documentElement.lang = ECU.lang;
    document.title = ECU.t('ECU Simulator');
  };

  ECU.setLang = function (l) {
    ECU.lang = l;
    try { root.localStorage.setItem('ecu-lang', l); } catch (e) { /* ignore */ }
    ECU.applyStatic();
    root.dispatchEvent(new Event('ecu:lang'));
  };
})();
