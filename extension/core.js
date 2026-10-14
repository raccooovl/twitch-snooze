(function (root, factory) {
  'use strict';
  const api = factory(root);
  root.TwitchSnooze = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof globalThis === 'object' ? globalThis : this, function (root) {
  'use strict';

  const STORAGE_KEY = 'twitchSnoozeState';
  const VIEW_KEY = 'twitchSnoozeView';
  const I18n = root.TwitchSnoozeI18n || { t: key => key, tp: key => key, list: items => items.join(', '), locale: 'en' };
  const t = I18n.t;
  const PRESET_TEXT = {
    today: ['presetToday', 'snoozedToday'], day: ['presetDay', 'snoozedDay'], 'three-days': ['presetThreeDays', 'snoozedThreeDays'],
    week: ['presetWeek', 'snoozedWeek'], fortnight: ['presetFortnight', 'snoozedFortnight'], month: ['presetMonth', 'snoozedMonth'],
    forever: ['presetForever', 'snoozedForever']
  };
  const PRESETS = Object.freeze(Object.keys(PRESET_TEXT).map(key => Object.freeze({ key, label: t(PRESET_TEXT[key][0]) })));
  const PRESET_KEYS = new Set(PRESETS.map(preset => preset.key));
  const RESERVED = new Set([
    'activate', 'bits', 'broadcast', 'collections', 'creator-dashboard',
    'clip', 'clips', 'dashboard', 'directory', 'downloads', 'drops', 'embed', 'events',
    'following', 'friends', 'inventory', 'jobs', 'legal', 'login', 'logout',
    'messages', 'moderator', 'p', 'payments', 'popout', 'prime', 'privacy',
    'products', 'search', 'settings', 'signup', 'store', 'subscriptions',
    'team', 'teams', 'turbo', 'videos', 'wallet'
  ]);
  const DAY_MS = 24 * 60 * 60 * 1000;
  const RESTORE_UNDO_MS = 10 * 60 * 1000;
  const MAX_DATE = 8.64e15;
  const MAX_ALIASES = 10;
  const MAX_PROFILES = 300;
  const PROFILE_KEEP_MS = 30 * 24 * 60 * 60 * 1000;
  const BACKUP_APP = 'twitch-snooze';
  const BACKUP_FORMAT = 1;
  // Scripts that do not separate words with spaces match keywords anywhere inside the text.
  const SPACELESS = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}]/u;

  function normalizeLogin(value) {
    if (typeof value !== 'string') return null;
    let input = value.trim();
    if (!input || input.length > 2048) return null;
    if (input.startsWith('@')) input = input.slice(1);
    let login;
    if (/^[a-z0-9_]{1,25}$/i.test(input)) {
      login = input.toLowerCase();
    } else {
      try {
        if (/^(?:www\.|m\.)?twitch\.tv\//i.test(input)) input = 'https://' + input;
        const url = new URL(input, input.startsWith('/') ? 'https://www.twitch.tv' : undefined);
        if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.port) return null;
        if (!['twitch.tv', 'www.twitch.tv', 'm.twitch.tv'].includes(url.hostname.toLowerCase())) return null;
        const match = /^\/([a-z0-9_]{1,25})\/?$/i.exec(url.pathname);
        if (!match) return null;
        login = match[1].toLowerCase();
      } catch (_) {
        return null;
      }
    }
    return RESERVED.has(login) ? null : login;
  }

  // The channel a Twitch page belongs to, including its sub-pages such as /name/videos.
  function channelFromPath(pathname) {
    if (typeof pathname !== 'string') return null;
    const match = /^\/([a-z0-9_]{1,25})(?:\/(?:about|schedule|videos|clips|collections|home)?\/?)?$/i.exec(pathname);
    return match ? normalizeLogin(match[1]) : null;
  }

  function validTimestamp(value) {
    return Number.isSafeInteger(value) && value >= 0 && value <= MAX_DATE;
  }

  // Returns null for "Until I unhide", which never expires on its own.
  function snoozeUntil(key, now = Date.now()) {
    if (!PRESET_KEYS.has(key)) throw new RangeError(t('errDuration'));
    if (!validTimestamp(now)) throw new RangeError(t('errClock'));
    if (key === 'forever') return null;
    const fixedDays = { day: 1, 'three-days': 3, week: 7, fortnight: 14 };
    let until;
    if (Object.hasOwn(fixedDays, key)) {
      until = now + fixedDays[key] * DAY_MS;
    } else {
      const date = new Date(now);
      if (key === 'today') {
        date.setDate(date.getDate() + 1);
        date.setHours(0, 0, 0, 0);
      } else {
        const wantedDay = date.getDate();
        date.setDate(1);
        date.setMonth(date.getMonth() + 1);
        const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
        date.setDate(Math.min(wantedDay, lastDay));
      }
      until = date.getTime();
    }
    if (!validTimestamp(until) || until <= now) throw new RangeError(t('errSnoozeTime'));
    return until;
  }

  function isActiveSnooze(entry, now = Date.now()) {
    return Boolean(entry && (entry.until === null ? entry.duration === 'forever' : validTimestamp(entry.until) && entry.until > now));
  }

  function normalizeDisplayName(value, login) {
    if (typeof value !== 'string') return login;
    const name = value.replace(/[\u0000-\u001f\u007f-\u009f]/g, '').trim().slice(0, 100);
    return name || login;
  }

  // Twitch category URL slugs stay the same in every display language.
  function normalizeSlug(value) {
    if (typeof value !== 'string' || !value || value.length > 300) return null;
    let slug;
    try { slug = decodeURIComponent(value); } catch (_) { return null; }
    slug = slug.normalize('NFKC').toLowerCase().trim();
    return /^[\p{L}\p{N}][\p{L}\p{N}_.-]{0,149}$/u.test(slug) ? slug : null;
  }

  function categorySlugFromHref(href) {
    if (typeof href !== 'string' || href.length > 2048) return null;
    let url;
    try { url = new URL(href, 'https://www.twitch.tv'); } catch (_) { return null; }
    if (!['twitch.tv', 'www.twitch.tv', 'm.twitch.tv'].includes(url.hostname.toLowerCase())) return null;
    let match = /^\/directory\/category\/([^/]+)\/?/.exec(url.pathname);
    if (match) return normalizeSlug(match[1]);
    match = /^\/directory\/game\/([^/]+)\/?/.exec(url.pathname);
    if (!match) return null;
    let name;
    try { name = decodeURIComponent(match[1]); } catch (_) { return null; }
    const category = normalizeCategory(name);
    return category ? category.key : null;
  }

  function normalizeCategory(value) {
    let source = value;
    let slug = null;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      source = typeof value.name === 'string' && value.name.trim() ? value.name : value.key;
      if (value.slug !== undefined && value.slug !== null) slug = normalizeSlug(value.slug);
    }
    if (typeof source !== 'string' || source.length > 300) return null;
    const name = source.normalize('NFKC').replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!name || name.length > 200) return null;
    // Derive identity from the visible category name so sidebar text and card links agree.
    const key = name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '');
    if (!key) return null;
    return slug ? { key, name, slug } : { key, name };
  }

  function validCategoryKey(value) {
    return typeof value === 'string' && value.length <= 200 && /^[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*$/u.test(value);
  }

  function normalizeAliases(value, key) {
    if (!Array.isArray(value)) return [];
    const aliases = [];
    for (const alias of value) {
      if (!validCategoryKey(alias) || alias === key || aliases.includes(alias)) continue;
      aliases.push(alias);
      if (aliases.length >= MAX_ALIASES) break;
    }
    return aliases;
  }

  // A rule matches by slug when both sides know it, otherwise by name or a learned translated name.
  function categoryMatches(rule, category) {
    if (!rule || !rule.category || !category) return false;
    const own = rule.category;
    if (own.slug && category.slug) return own.slug === category.slug;
    return own.key === category.key || (Array.isArray(rule.aliases) && rule.aliases.includes(category.key));
  }

  function ruleId(category, login = null) {
    const normalized = normalizeCategory(category);
    if (!normalized) return null;
    if (login === null || login === undefined) return 'category:' + normalized.key;
    const channel = normalizeLogin(login);
    return channel ? 'channel:' + channel + ':' + normalized.key : null;
  }

  function keywordTokens(value) {
    if (typeof value !== 'string') return '';
    return value.normalize('NFKC').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean).join(' ');
  }

  function normalizeKeyword(value) {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value.text : value;
    if (typeof source !== 'string' || source.length > 300) return null;
    const text = source.normalize('NFKC').replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!text || text.length > 80) return null;
    const key = keywordTokens(text);
    return key ? { key, text } : null;
  }

  function filterId(value) {
    const keyword = normalizeKeyword(value);
    return keyword ? 'keyword:' + keyword.key : null;
  }

  function tagTokens(tag) {
    // Twitch tags are often written as one word, such as DropsEnabled.
    return keywordTokens(tag.slice(0, 100).replace(/(\p{Ll})(\p{Lu})/gu, '$1 $2'));
  }

  function keywordMatches(key, info) {
    if (!key || !info) return false;
    const spaceless = SPACELESS.test(key);
    const phrase = segment => Boolean(segment) && ((' ' + segment + ' ').includes(' ' + key + ' ') || (spaceless && segment.includes(key)));
    if (typeof info.title === 'string' && phrase(keywordTokens(info.title.slice(0, 500)))) return true;
    if (!Array.isArray(info.tags)) return false;
    const compact = key.replace(/ /g, '');
    return info.tags.slice(0, 30).some(tag => {
      if (typeof tag !== 'string') return false;
      const tokens = tagTokens(tag);
      return phrase(tokens) || tokens.replace(/ /g, '') === compact;
    });
  }

  // Only Twitch's own profile-picture addresses are kept, never stream thumbnails or other sites.
  function normalizeAvatar(value) {
    if (typeof value !== 'string' || !value || value.length > 300) return null;
    let url;
    try { url = new URL(value); } catch (_) { return null; }
    if (url.protocol !== 'https:' || url.hostname !== 'static-cdn.jtvnw.net' || url.username || url.password || url.port || url.search || url.hash) return null;
    if (!/^\/(?:jtv_user_pictures|user-default-pictures-uv)\/[A-Za-z0-9._\/-]+\.(?:png|jpe?g|webp|gif)$/i.test(url.pathname)) return null;
    // Twitch serves every profile picture at 70x70, sharp enough for a 44 px circle; cards link 50x50.
    url.pathname = url.pathname.replace(/-profile_image-\d{2,3}x\d{2,3}\./, '-profile_image-70x70.');
    return url.href;
  }

  // Everyone your rules mention: snoozed, streamer rules, always shown and exceptions.
  function referencedLogins(state) {
    const logins = new Set();
    if (!state || typeof state !== 'object') return logins;
    for (const login of Object.keys(state.snoozes || {})) logins.add(login);
    for (const login of Object.keys(state.whitelist || {})) logins.add(login);
    for (const rule of Object.values(state.rules || {})) { if (rule.login) logins.add(rule.login); for (const entry of rule.exceptions || []) logins.add(entry.login); }
    for (const filter of Object.values(state.filters || {})) for (const entry of filter.exceptions || []) logins.add(entry.login);
    return logins;
  }

  function validToken(value) {
    return typeof value === 'string' && /^[a-z0-9_-]{8,128}$/i.test(value);
  }

  function ownPut(collection, key, value) {
    Object.defineProperty(collection, key, { value, enumerable: true, writable: true, configurable: true });
  }

  function plainObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  }

  function normalizeExceptions(value) {
    const exceptions = [];
    const seen = new Set();
    if (!Array.isArray(value)) return exceptions;
    for (const exception of value) {
      if (!plainObject(exception)) continue;
      const channel = normalizeLogin(exception.login);
      if (!channel || seen.has(channel)) continue;
      seen.add(channel);
      exceptions.push({ login: channel, displayName: normalizeDisplayName(exception.displayName, channel) });
    }
    return exceptions;
  }

  function normalizeState(raw, now = Date.now()) {
    const state = { schema: 1, revision: 0, snoozes: {}, undoMarkers: {}, rules: {}, filters: {}, whitelist: {}, profiles: {} };
    if (!plainObject(raw) || raw.schema !== 1) return state;
    if (Number.isSafeInteger(raw.revision) && raw.revision >= 0 && raw.revision < Number.MAX_SAFE_INTEGER) {
      state.revision = raw.revision;
    }
    const timestamp = validTimestamp(now) ? now : Date.now();
    const snoozes = plainObject(raw.snoozes) || {};
    for (const [key, entry] of Object.entries(snoozes)) {
      const login = normalizeLogin(key);
      if (!login || !plainObject(entry)) continue;
      if (normalizeLogin(entry.login) !== login) continue;
      if (!PRESET_KEYS.has(entry.duration)) continue;
      const forever = entry.duration === 'forever';
      if (forever ? entry.until !== null : !validTimestamp(entry.until) || entry.until <= timestamp) continue;
      if (!validTimestamp(entry.createdAt) || (!forever && entry.createdAt >= entry.until)) continue;
      if (!validToken(entry.token)) continue;
      // Define an own property so even a valid login such as __proto__ is safe.
      ownPut(state.snoozes, login, {
        login,
        displayName: normalizeDisplayName(entry.displayName, login),
        until: entry.until,
        createdAt: entry.createdAt,
        duration: entry.duration,
        token: entry.token
      });
    }
    if (plainObject(raw.undoMarkers)) {
      for (const [key, marker] of Object.entries(raw.undoMarkers)) {
        const login = normalizeLogin(key);
        if (!login || Object.hasOwn(state.snoozes, login) || !plainObject(marker)) continue;
        if (!validToken(marker.token)) continue;
        if (!validTimestamp(marker.createdAt) || !validTimestamp(marker.until) || marker.until <= timestamp) continue;
        if (marker.createdAt > timestamp || marker.createdAt >= marker.until || marker.until - marker.createdAt > RESTORE_UNDO_MS) continue;
        ownPut(state.undoMarkers, login, { token: marker.token, createdAt: marker.createdAt, until: marker.until });
      }
    }
    if (plainObject(raw.rules)) {
      for (const [key, entry] of Object.entries(raw.rules)) {
        if (!plainObject(entry)) continue;
        const category = normalizeCategory(entry.category);
        const login = entry.login === null ? null : normalizeLogin(entry.login);
        if (!category || (entry.login !== null && !login)) continue;
        const id = ruleId(category, login);
        if (key !== id || entry.id !== id || !validTimestamp(entry.createdAt) || !validToken(entry.token)) continue;
        const rule = {
          id, category, login,
          displayName: login === null ? '' : normalizeDisplayName(entry.displayName, login),
          exceptions: login === null ? normalizeExceptions(entry.exceptions) : [],
          createdAt: entry.createdAt, token: entry.token
        };
        // Translated names are only stored once learned, so older saved rules keep their exact shape.
        const aliases = normalizeAliases(entry.aliases, category.key);
        if (aliases.length) rule.aliases = aliases;
        ownPut(state.rules, id, rule);
      }
    }
    if (plainObject(raw.filters)) {
      for (const [key, entry] of Object.entries(raw.filters)) {
        if (!plainObject(entry)) continue;
        const keyword = normalizeKeyword(entry.text);
        if (!keyword) continue;
        const id = 'keyword:' + keyword.key;
        if (key !== id || entry.id !== id || !validTimestamp(entry.createdAt) || !validToken(entry.token)) continue;
        ownPut(state.filters, id, {
          id, key: keyword.key, text: keyword.text,
          exceptions: normalizeExceptions(entry.exceptions),
          createdAt: entry.createdAt, token: entry.token
        });
      }
    }
    if (plainObject(raw.whitelist)) {
      for (const [key, entry] of Object.entries(raw.whitelist)) {
        const login = normalizeLogin(key);
        if (!login || !plainObject(entry)) continue;
        if (normalizeLogin(entry.login) !== login || !validTimestamp(entry.createdAt) || entry.createdAt > timestamp) continue;
        ownPut(state.whitelist, login, {
          login, displayName: normalizeDisplayName(entry.displayName, login), createdAt: entry.createdAt
        });
      }
    }
    if (plainObject(raw.profiles)) {
      // Profile pictures are kept for streamers in your rules; others go once their picture is 30 days old (Undo can still bring a rule back meanwhile).
      const referenced = referencedLogins(state);
      const kept = [];
      for (const [key, entry] of Object.entries(raw.profiles)) {
        const login = normalizeLogin(key);
        if (!login || !plainObject(entry)) continue;
        const avatar = normalizeAvatar(entry.avatar);
        if (!avatar || !validTimestamp(entry.seenAt) || entry.seenAt > timestamp + DAY_MS) continue;
        if (!referenced.has(login) && timestamp - entry.seenAt > PROFILE_KEEP_MS) continue;
        kept.push([login, { avatar, seenAt: entry.seenAt }]);
      }
      kept.sort((left, right) => right[1].seenAt - left[1].seenAt);
      for (const [login, entry] of kept.slice(0, MAX_PROFILES)) ownPut(state.profiles, login, entry);
    }
    return state;
  }

  function avatarFor(state, login) {
    return state && state.profiles && Object.hasOwn(state.profiles, login) ? state.profiles[login].avatar : null;
  }

  function isWhitelisted(state, value) {
    const login = normalizeLogin(value);
    return Boolean(login && state && state.whitelist && Object.hasOwn(state.whitelist, login));
  }

  function hiddenReasons(state, info, now = Date.now()) {
    const reasons = [];
    const login = normalizeLogin(info && info.login);
    if (!login || !state || typeof state !== 'object') return reasons;
    if (isWhitelisted(state, login)) return reasons;
    if (state.snoozes && Object.hasOwn(state.snoozes, login)) {
      const entry = state.snoozes[login];
      if (isActiveSnooze(entry, now)) reasons.push({ type: 'snooze', entry });
    }
    const category = normalizeCategory(info.category);
    if (category && state.rules && typeof state.rules === 'object') {
      for (const rule of Object.values(state.rules)) {
        if (!rule || (rule.login !== null && rule.login !== login) || !categoryMatches(rule, category)) continue;
        if (rule.login === null && Array.isArray(rule.exceptions) && rule.exceptions.some(item => item && item.login === login)) continue;
        reasons.push({ type: 'rule', rule });
      }
    }
    if ((info.title || info.tags) && state.filters && typeof state.filters === 'object') {
      for (const filter of Object.values(state.filters)) {
        if (!filter || (Array.isArray(filter.exceptions) && filter.exceptions.some(item => item && item.login === login))) continue;
        if (keywordMatches(filter.key, info)) reasons.push({ type: 'keyword', filter });
      }
    }
    return reasons;
  }

  function dateParts(until) {
    const date = new Date(until);
    const format = options => {
      try { return new Intl.DateTimeFormat(I18n.locale, options).format(date); }
      catch (_) { return new Intl.DateTimeFormat(undefined, options).format(date); }
    };
    return {
      time: format({ hour: 'numeric', minute: '2-digit' }),
      weekday: format({ weekday: 'short' }),
      date: format({ weekday: 'short', day: 'numeric', month: 'short' }),
      full: format({ weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: 'numeric', minute: '2-digit' })
    };
  }

  // The short return hint shown beside each duration in the menu.
  function returnHint(key, now = Date.now()) {
    if (key === 'forever') return t('returnNever');
    if (key === 'today') return t('returnMidnight');
    const until = snoozeUntil(key, now);
    const parts = dateParts(until);
    return t('returnOn', { when: until - now <= 1.5 * DAY_MS ? parts.weekday + ' ' + parts.time : parts.date });
  }

  // "Back Wed 14 Oct at 22:30", or "Hidden until you unhide".
  function formatUntil(until) {
    if (until === null) return t('reasonUntil');
    if (!validTimestamp(until)) return '';
    const parts = dateParts(until);
    return t('reasonBack', { date: parts.date, time: parts.time });
  }

  function formatUntilFull(until) {
    if (until === null) return t('reasonUntil');
    return validTimestamp(until) ? dateParts(until).full : '';
  }

  function snoozedMessage(name, duration) {
    return t((PRESET_TEXT[duration] || PRESET_TEXT.day)[1], { name });
  }

  // Backups contain only your saved choices: no Undo history, tab data or revision counters.
  function exportBackup(state, now = Date.now()) {
    const current = normalizeState(state, now);
    return {
      app: BACKUP_APP, format: BACKUP_FORMAT, exportedAt: new Date(now).toISOString(),
      snoozes: current.snoozes, rules: current.rules, filters: current.filters, whitelist: current.whitelist
    };
  }

  function readBackup(data, now = Date.now()) {
    if (!plainObject(data) || data.app !== BACKUP_APP) throw new Error(t('errBackupNotOurs'));
    if (data.format !== BACKUP_FORMAT) throw new Error(t('errBackupNewer'));
    const state = normalizeState({ schema: 1, revision: 0, snoozes: data.snoozes, rules: data.rules, filters: data.filters, whitelist: data.whitelist }, now);
    const counts = backupCounts(state);
    if (!counts.total) throw new Error(t('errBackupEmpty'));
    return { state, counts };
  }

  function describeCounts(counts) {
    const parts = [];
    if (counts.snoozes) parts.push(I18n.tp('countSnoozes', counts.snoozes));
    if (counts.streamerRules) parts.push(I18n.tp('countStreamerRules', counts.streamerRules));
    if (counts.categories) parts.push(I18n.tp('countCategories', counts.categories));
    if (counts.keywords) parts.push(I18n.tp('countKeywords', counts.keywords));
    if (counts.whitelist) parts.push(I18n.tp('countAlways', counts.whitelist));
    return parts.length ? I18n.list(parts) : t('backupNothing');
  }

  function backupCounts(state) {
    const counts = {
      snoozes: Object.keys(state.snoozes).length,
      categories: Object.values(state.rules).filter(rule => rule.login === null).length,
      streamerRules: Object.values(state.rules).filter(rule => rule.login !== null).length,
      keywords: Object.keys(state.filters).length,
      whitelist: Object.keys(state.whitelist).length
    };
    counts.total = counts.snoozes + counts.categories + counts.streamerRules + counts.keywords + counts.whitelist;
    return counts;
  }

  return Object.freeze({
    STORAGE_KEY, VIEW_KEY, PRESETS, RESTORE_UNDO_MS, normalizeLogin, channelFromPath, snoozeUntil, isActiveSnooze, normalizeState,
    returnHint, formatUntil, formatUntilFull, snoozedMessage, describeCounts, normalizeDisplayName, normalizeCategory, normalizeSlug,
    normalizeAvatar, referencedLogins, avatarFor,
    categorySlugFromHref, categoryMatches, ruleId, normalizeKeyword, filterId, keywordMatches, hiddenReasons,
    isWhitelisted, exportBackup, readBackup, backupCounts
  });
});
