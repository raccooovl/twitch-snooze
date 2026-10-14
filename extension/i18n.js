// Translated text for every part of Twitch Snooze. Messages live in _locales/<language>/messages.json
// (generated from tools/messages.cjs). Placeholders are written {name} and filled in here.
(function (root) {
  'use strict';
  const getMessage = (key) => {
    try {
      const api = root.chrome && root.chrome.i18n;
      return api && typeof api.getMessage === 'function' ? api.getMessage(key) : '';
    } catch (_) { return ''; }
  };
  const fill = (text, vars) => (vars ? text.replace(/\{(\w+)\}/g, (match, name) => (Object.hasOwn(vars, name) ? String(vars[name]) : match)) : text);
  // Dates and numbers follow the browser's regional format (en-GB, pt-PT…) when it matches the message language.
  const messageLocale = getMessage('localeCode') || 'en';
  let uiLanguage = '';
  try { uiLanguage = root.chrome && root.chrome.i18n && typeof root.chrome.i18n.getUILanguage === 'function' ? root.chrome.i18n.getUILanguage() : ''; } catch (_) { uiLanguage = ''; }
  const base = value => String(value || '').split(/[-_]/)[0].toLowerCase();
  const locale = uiLanguage && base(uiLanguage) === base(messageLocale) ? uiLanguage.replace('_', '-') : messageLocale;
  let plurals;
  try { plurals = new Intl.PluralRules(locale); } catch (_) { plurals = new Intl.PluralRules('en'); }
  function t(key, vars) {
    const text = getMessage(key);
    return fill(text || key, vars);
  }
  // Picks key_one / key_other (and other plural forms when a language has them).
  function tp(key, count, vars) {
    const form = plurals.select(count);
    const text = getMessage(key + '_' + form) || getMessage(key + '_other');
    return fill(text || key, { count, ...vars });
  }
  function list(items) {
    try { return new Intl.ListFormat(locale, { style: 'long', type: 'conjunction' }).format(items); }
    catch (_) { return items.join(', '); }
  }
  root.TwitchSnoozeI18n = Object.freeze({ t, tp, list, locale });
})(typeof globalThis === 'object' ? globalThis : this);
