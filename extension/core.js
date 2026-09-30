(function (root, factory) {
  'use strict';
  const api = factory();
  root.TwitchSnooze = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';

  const STORAGE_KEY = 'twitchSnoozeState';
  const PRESETS = Object.freeze([
    { key: 'today', label: 'Today', hint: 'Until midnight' },
    { key: 'day', label: '24 hours', hint: 'Back tomorrow' },
    { key: 'three-days', label: '3 days', hint: 'A few days off' },
    { key: 'week', label: '1 week', hint: 'Back next week' },
    { key: 'fortnight', label: '2 weeks', hint: 'A longer break' },
    { key: 'month', label: '1 month', hint: 'Back next month' }
  ].map(Object.freeze));
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

  function validTimestamp(value) {
    return Number.isSafeInteger(value) && value >= 0 && value <= MAX_DATE;
  }

  function snoozeUntil(key, now = Date.now()) {
    if (!PRESET_KEYS.has(key)) throw new RangeError('Choose a valid snooze duration.');
    if (!validTimestamp(now)) throw new RangeError('The current time is invalid.');
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
    if (!validTimestamp(until) || until <= now) throw new RangeError('The snooze end time is invalid.');
    return until;
  }

  function normalizeDisplayName(value, login) {
    if (typeof value !== 'string') return login;
    const name = value.replace(/[\u0000-\u001f\u007f-\u009f]/g, '').trim().slice(0, 100);
    return name || login;
  }

  function normalizeCategory(value) {
    let source = value;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      source = typeof value.name === 'string' && value.name.trim() ? value.name : value.key;
    }
    if (typeof source !== 'string' || source.length > 300) return null;
    const name = source.normalize('NFKC').replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!name || name.length > 200) return null;
    // Derive identity from the visible category name so sidebar text and card links agree.
    const key = name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '');
    return key ? { key, name } : null;
  }

  function ruleId(category, login = null) {
    const normalized = normalizeCategory(category);
    if (!normalized) return null;
    if (login === null || login === undefined) return 'category:' + normalized.key;
    const channel = normalizeLogin(login);
    return channel ? 'channel:' + channel + ':' + normalized.key : null;
  }

  function validToken(value) {
    return typeof value === 'string' && /^[a-z0-9_-]{8,128}$/i.test(value);
  }

  function ownPut(collection, key, value) {
    Object.defineProperty(collection, key, { value, enumerable: true, writable: true, configurable: true });
  }

  function normalizeState(raw, now = Date.now()) {
    const state = { schema: 1, revision: 0, snoozes: {}, undoMarkers: {}, rules: {}, whitelist: {} };
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) || raw.schema !== 1) return state;
    if (Number.isSafeInteger(raw.revision) && raw.revision >= 0 && raw.revision < Number.MAX_SAFE_INTEGER) {
      state.revision = raw.revision;
    }
    const timestamp = validTimestamp(now) ? now : Date.now();
    const snoozes = raw.snoozes && typeof raw.snoozes === 'object' && !Array.isArray(raw.snoozes) ? raw.snoozes : {};
    for (const [key, entry] of Object.entries(snoozes)) {
      const login = normalizeLogin(key);
      if (!login || !entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
      if (normalizeLogin(entry.login) !== login) continue;
      if (!validTimestamp(entry.until) || entry.until <= timestamp) continue;
      if (!validTimestamp(entry.createdAt) || entry.createdAt >= entry.until) continue;
      if (!PRESET_KEYS.has(entry.duration)) continue;
      if (typeof entry.token !== 'string' || !/^[a-z0-9_-]{8,128}$/i.test(entry.token)) continue;
      // Define an own property so even a valid login such as __proto__ is safe.
      Object.defineProperty(state.snoozes, login, {
        value: {
          login,
          displayName: normalizeDisplayName(entry.displayName, login),
          until: entry.until,
          createdAt: entry.createdAt,
          duration: entry.duration,
          token: entry.token
        },
        enumerable: true,
        writable: true,
        configurable: true
      });
    }
    if (raw.undoMarkers && typeof raw.undoMarkers === 'object' && !Array.isArray(raw.undoMarkers)) {
      for (const [key, marker] of Object.entries(raw.undoMarkers)) {
        const login = normalizeLogin(key);
        if (!login || Object.hasOwn(state.snoozes, login) || !marker || typeof marker !== 'object' || Array.isArray(marker)) continue;
        if (typeof marker.token !== 'string' || !/^[a-z0-9_-]{8,128}$/i.test(marker.token)) continue;
        if (!validTimestamp(marker.createdAt) || !validTimestamp(marker.until) || marker.until <= timestamp) continue;
        if (marker.createdAt > timestamp || marker.createdAt >= marker.until || marker.until - marker.createdAt > RESTORE_UNDO_MS) continue;
        Object.defineProperty(state.undoMarkers, login, {
          value: { token: marker.token, createdAt: marker.createdAt, until: marker.until },
          enumerable: true, writable: true, configurable: true
        });
      }
    }
    if (raw.rules && typeof raw.rules === 'object' && !Array.isArray(raw.rules)) {
      for (const [key, entry] of Object.entries(raw.rules)) {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
        const category = normalizeCategory(entry.category);
        const login = entry.login === null ? null : normalizeLogin(entry.login);
        if (!category || (entry.login !== null && !login)) continue;
        const id = ruleId(category, login);
        if (key !== id || entry.id !== id || !validTimestamp(entry.createdAt) || !validToken(entry.token)) continue;
        const exceptions = [];
        const seen = new Set();
        if (login === null && Array.isArray(entry.exceptions)) {
          for (const exception of entry.exceptions) {
            if (!exception || typeof exception !== 'object' || Array.isArray(exception)) continue;
            const channel = normalizeLogin(exception.login);
            if (!channel || seen.has(channel)) continue;
            seen.add(channel);
            exceptions.push({ login: channel, displayName: normalizeDisplayName(exception.displayName, channel) });
          }
        }
        ownPut(state.rules, id, {
          id, category, login,
          displayName: login === null ? '' : normalizeDisplayName(entry.displayName, login),
          exceptions, createdAt: entry.createdAt, token: entry.token
        });
      }
    }
    if (raw.whitelist && typeof raw.whitelist === 'object' && !Array.isArray(raw.whitelist)) {
      for (const [key, entry] of Object.entries(raw.whitelist)) {
        const login = normalizeLogin(key);
        if (!login || !entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
        if (normalizeLogin(entry.login) !== login || !validTimestamp(entry.createdAt) || entry.createdAt > timestamp) continue;
        ownPut(state.whitelist, login, {
          login, displayName: normalizeDisplayName(entry.displayName, login), createdAt: entry.createdAt
        });
      }
    }
    return state;
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
      if (entry && validTimestamp(entry.until) && entry.until > now) reasons.push({ type: 'snooze', entry });
    }
    const category = normalizeCategory(info.category);
    if (!category || !state.rules || typeof state.rules !== 'object') return reasons;
    for (const id of [ruleId(category), ruleId(category, login)]) {
      if (!Object.hasOwn(state.rules, id)) continue;
      const rule = state.rules[id];
      if (!rule || (rule.login !== null && rule.login !== login)) continue;
      if (rule.login === null && Array.isArray(rule.exceptions) && rule.exceptions.some(item => item && item.login === login)) continue;
      reasons.push({ type: 'rule', rule });
    }
    return reasons;
  }

  function formatRemaining(until, now = Date.now()) {
    if (!validTimestamp(until) || !validTimestamp(now) || until <= now) return 'Ready to restore';
    const remaining = until - now;
    const minute = 60 * 1000;
    const hour = 60 * minute;
    if (remaining < minute) return 'Less than a minute left';
    let count;
    let unit;
    if (remaining >= DAY_MS) {
      count = Math.ceil(remaining / DAY_MS);
      unit = 'day';
    } else if (remaining >= hour) {
      count = Math.ceil(remaining / hour);
      unit = 'hour';
    } else {
      count = Math.ceil(remaining / minute);
      unit = 'minute';
    }
    return count + ' ' + unit + (count === 1 ? '' : 's') + ' left';
  }

  function formatUntil(until) {
    if (!validTimestamp(until)) return 'Unknown date';
    return new Intl.DateTimeFormat(undefined, {
      month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit'
    }).format(new Date(until));
  }

  return Object.freeze({ STORAGE_KEY, PRESETS, RESTORE_UNDO_MS, normalizeLogin, snoozeUntil, normalizeState, formatRemaining, formatUntil, normalizeDisplayName, normalizeCategory, ruleId, hiddenReasons, isWhitelisted });
});
