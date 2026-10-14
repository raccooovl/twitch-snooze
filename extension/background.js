'use strict';

importScripts('i18n.js', 'core.js');

const Core = globalThis.TwitchSnooze;
const t = globalThis.TwitchSnoozeI18n.t;
const EXPIRY_ALARM = 'twitch-snooze-expiry';
const TABS_KEY = 'twitchSnoozeTabs';
const SNAPSHOT_TIMEOUT_MS = 1500;
const MAX_ALIASES = 10;
const UNDO_AREAS = new Set(['snoozes', 'rules', 'filters', 'whitelist']);
const tabRegistrations = new Map();
let operationQueue = Promise.resolve();

function serialize(operation) {
  const result = operationQueue.then(operation);
  operationQueue = result.catch(() => {});
  return result;
}

function errorMessage(error) {
  return error && typeof error.message === 'string' ? error.message : t('errSave');
}

function hiddenCount(state) {
  return Object.values(state.snoozes).filter(entry => !Core.isWhitelisted(state, entry.login)).length +
    Object.values(state.rules).filter(rule => rule.login === null || !Core.isWhitelisted(state, rule.login)).length +
    Object.keys(state.filters).length;
}

async function updateAuxiliary(state) {
  const expiries = [...Object.values(state.snoozes), ...Object.values(state.undoMarkers)]
    .map(entry => entry.until).filter(until => Number.isSafeInteger(until));
  const nextExpiry = expiries.length ? Math.min(...expiries) : null;
  const count = hiddenCount(state);
  const jobs = [
    chrome.action.setBadgeText({ text: count ? String(count) : '' }),
    chrome.action.setBadgeBackgroundColor({ color: '#9146ff' }),
    nextExpiry === null
      ? chrome.alarms.clear(EXPIRY_ALARM)
      : chrome.alarms.create(EXPIRY_ALARM, { when: nextExpiry })
  ];
  // Storage remains authoritative if a tab/browser closes during badge refresh.
  await Promise.allSettled(jobs);
}

async function writeState(state) {
  const next = Core.normalizeState(state);
  next.revision = state.revision + 1;
  await chrome.storage.local.set({ [Core.STORAGE_KEY]: next });
  await updateAuxiliary(next);
  return next;
}

function sameStoredValue(left, right) {
  if (left === right) return true;
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false;
  if (Array.isArray(left) !== Array.isArray(right)) return false;
  if (Array.isArray(left) && left.length !== right.length) return false;
  const keys = Object.keys(left);
  if (keys.length !== Object.keys(right).length) return false;
  return keys.every(key => Object.hasOwn(right, key) && sameStoredValue(left[key], right[key]));
}

async function readState() {
  const stored = await chrome.storage.local.get(Core.STORAGE_KEY);
  const raw = stored[Core.STORAGE_KEY];
  const state = Core.normalizeState(raw);
  // Chromium storage may reorder object keys. Only changed values warrant a write.
  if (!sameStoredValue(raw, state)) return writeState(state);
  await updateAuxiliary(state);
  return state;
}

function newToken() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

function requireLogin(value) {
  const login = Core.normalizeLogin(value);
  if (!login) throw new Error(t('errChannel'));
  return login;
}

function own(state, area, key) {
  return typeof key === 'string' && Object.hasOwn(state[area], key) ? state[area][key] : null;
}

function put(state, area, key, value) {
  Object.defineProperty(state[area], key, { value, enumerable: true, writable: true, configurable: true });
}

function ownEntry(state, login) { return own(state, 'snoozes', login); }
function putEntry(state, login, entry) { put(state, 'snoozes', login, entry); }
function ownRule(state, id) { return own(state, 'rules', id); }
function putRule(state, rule) { put(state, 'rules', rule.id, rule); }
function ownFilter(state, id) { return own(state, 'filters', id); }

function requireCategory(value) {
  const category = Core.normalizeCategory(value);
  if (!category) throw new Error(t('errCategory'));
  return category;
}

function requireHideable(state, login) {
  if (Core.isWhitelisted(state, login)) throw new Error(t('errAlwaysShown'));
}

function allowChannel(rule, login, displayName, allow) {
  rule.exceptions = rule.exceptions.filter(entry => entry.login !== login);
  if (allow) rule.exceptions.push({ login, displayName: Core.normalizeDisplayName(displayName, login) });
  rule.token = newToken();
}

function clone(value) {
  return value === null || value === undefined ? null : JSON.parse(JSON.stringify(value));
}

// Each record is identified by its token (or whitelist creation time), so Undo never overwrites a newer change.
function fingerprint(area, value) {
  if (!value) return null;
  return area === 'whitelist' ? 'w:' + value.createdAt : value.token;
}

function changeTracker(state) {
  const changes = new Map();
  return {
    touch(area, key) {
      const id = area + '\u0000' + key;
      if (!changes.has(id)) changes.set(id, { area, key, before: clone(own(state, area, key)) });
    },
    undo(next) {
      const list = [...changes.values()]
        .map(change => ({ ...change, after: fingerprint(change.area, own(next, change.area, change.key)) }))
        .filter(change => fingerprint(change.area, change.before) !== change.after);
      return list.length ? { kind: 'entities', changes: list } : null;
    }
  };
}

async function tracked(state, tracker) {
  const next = await writeState(state);
  const undo = tracker.undo(next);
  return undo ? { ok: true, state: next, undo } : { ok: true, state: next };
}

async function restoredResult(state, login, previous) {
  delete state.snoozes[login];
  const now = Date.now();
  const until = previous.until === null ? now + Core.RESTORE_UNDO_MS : Math.min(now + Core.RESTORE_UNDO_MS, previous.until);
  put(state, 'undoMarkers', login, { token: newToken(), createdAt: now, until });
  const next = await writeState(state);
  return { ok: true, state: next, undo: { login, expectedToken: null, previous, expectedAbsenceToken: state.undoMarkers[login].token } };
}

function validUndoFingerprint(value) {
  return value === null || (typeof value === 'string' && /^(?:w:\d{1,16}|[a-z0-9_-]{8,128})$/i.test(value));
}

function parseEntityChange(change) {
  const invalid = () => new Error(t('errUndo'));
  if (!change || typeof change !== 'object' || Array.isArray(change)) throw invalid();
  const { area, key, after } = change;
  if (!UNDO_AREAS.has(area) || typeof key !== 'string' || !key || key.length > 400 || !validUndoFingerprint(after)) throw invalid();
  if ((area === 'snoozes' || area === 'whitelist') && Core.normalizeLogin(key) !== key) throw invalid();
  if (area === 'rules' && !/^(?:category|channel):/.test(key)) throw invalid();
  if (area === 'filters' && !key.startsWith('keyword:')) throw invalid();
  if (change.before === null) return { area, key, before: null, after };
  const raw = { schema: 1, [area]: {} };
  put(raw, area, key, change.before);
  // Snoozes are checked without the clock so an expired original can still be recognised (and then dropped).
  const before = own(Core.normalizeState(raw, area === 'snoozes' ? 0 : Date.now()), area, key);
  if (!before) throw invalid();
  return { area, key, before, after };
}

async function undoEntities(undo) {
  if (!Array.isArray(undo.changes) || !undo.changes.length || undo.changes.length > 500) throw new Error(t('errUndo'));
  const changes = undo.changes.map(parseEntityChange);
  const state = await readState();
  for (const change of changes) {
    if (fingerprint(change.area, own(state, change.area, change.key)) !== change.after) {
      throw new Error(t('errUndoNewer'));
    }
  }
  const now = Date.now();
  for (const change of changes) {
    if (change.area === 'snoozes') delete state.undoMarkers[change.key];
    if (!change.before || (change.area === 'snoozes' && !Core.isActiveSnooze(change.before, now))) delete state[change.area][change.key];
    else put(state, change.area, change.key, change.before);
  }
  return { ok: true, state: await writeState(state) };
}

async function registeredTabs() {
  const stored = await chrome.storage.session.get(TABS_KEY);
  const ids = stored[TABS_KEY];
  return Array.isArray(ids) ? [...new Set(ids.filter(id => Number.isSafeInteger(id) && id >= 0))] : [];
}

function isTwitchSender(sender) {
  if (!sender || !sender.tab || !Number.isSafeInteger(sender.tab.id) || sender.tab.id < 0) return false;
  try {
    const url = new URL(sender.url || sender.tab.url);
    return url.protocol === 'https:' && url.hostname === 'www.twitch.tv';
  } catch (_) { return false; }
}

function cleanText(value, limit) {
  return typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, limit) : '';
}

async function overview() {
  const { ids, registrations } = await serialize(async () => {
    const ids = await registeredTabs();
    return { ids, registrations: new Map(ids.map(id => [id, tabRegistrations.get(id)])) };
  });
  // Snapshot waits run outside the mutation queue so suspended tabs cannot block saves.
  const replies = await Promise.all(ids.map(snapshot));
  const unreachable = new Set();
  const observations = [];
  const seen = new Set();
  for (let index = 0; index < replies.length; index++) {
    const reply = replies[index];
    // A timeout says nothing about whether the tab is still valid; try it again next time.
    if (reply.status === 'timeout') continue;
    if (reply.status !== 'fulfilled' || !reply.value || !Array.isArray(reply.value.items)) {
      unreachable.add(ids[index]);
      continue;
    }
    for (const info of reply.value.items) {
      if (!info || typeof info !== 'object' || Array.isArray(info)) continue;
      const login = Core.normalizeLogin(info.login);
      if (!login) continue;
      const category = Core.normalizeCategory(info.category);
      const identity = login + '\u0000' + (category ? category.key : '');
      if (seen.has(identity)) continue;
      seen.add(identity);
      const observation = { login, displayName: Core.normalizeDisplayName(info.displayName, login), category };
      const avatar = Core.normalizeAvatar(info.avatar);
      if (avatar) observation.avatar = avatar;
      const title = cleanText(info.title, 300);
      const tags = Array.isArray(info.tags) ? info.tags.slice(0, 12).map(tag => cleanText(tag, 60)).filter(Boolean) : [];
      if (title) observation.title = title;
      if (tags.length) observation.tags = tags;
      observations.push(observation);
    }
  }
  if (unreachable.size) await serialize(async () => {
    const current = await registeredTabs();
    const keep = current.filter(id => !unreachable.has(id) || tabRegistrations.get(id) !== registrations.get(id));
    if (keep.length !== current.length) {
      await chrome.storage.session.set({ [TABS_KEY]: keep });
      for (const id of current) if (!keep.includes(id)) tabRegistrations.delete(id);
    }
  });
  return { ok: true, observations };
}

function snapshot(id) {
  return new Promise(resolve => {
    let settled = false;
    const finish = result => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => finish({ status: 'timeout' }), SNAPSHOT_TIMEOUT_MS);
    Promise.resolve().then(() => chrome.tabs.sendMessage(id, { type: 'TSNOOZE_SNAPSHOT' })).then(
      value => finish({ status: 'fulfilled', value }),
      () => finish({ status: 'rejected' })
    );
  });
}

// Fill in names and category links that Twitch shows, without changing what is hidden or any Undo identity.
function learn(state, message) {
  let changed = false;
  const names = new Map();
  for (const item of Array.isArray(message.names) ? message.names.slice(0, 300) : []) {
    const login = item && Core.normalizeLogin(item.login);
    if (!login) continue;
    const name = Core.normalizeDisplayName(item.displayName, login);
    if (name !== login) names.set(login, name);
  }
  // Profile pictures, only for streamers your rules mention.
  const referenced = Core.referencedLogins(state);
  for (const item of Array.isArray(message.names) ? message.names.slice(0, 300) : []) {
    const login = item && Core.normalizeLogin(item.login);
    const avatar = item && Core.normalizeAvatar(item.avatar);
    if (!login || !avatar || !referenced.has(login)) continue;
    const current = own(state, 'profiles', login);
    if (current && current.avatar === avatar) continue;
    put(state, 'profiles', login, { avatar, seenAt: Date.now() });
    changed = true;
  }
  const rename = record => {
    const name = record && names.get(record.login);
    if (name && record.displayName === record.login) { record.displayName = name; changed = true; }
  };
  if (names.size) {
    for (const entry of Object.values(state.snoozes)) rename(entry);
    for (const entry of Object.values(state.whitelist)) rename(entry);
    for (const rule of Object.values(state.rules)) { if (rule.login) rename(rule); rule.exceptions.forEach(rename); }
    for (const filter of Object.values(state.filters)) filter.exceptions.forEach(rename);
  }
  for (const item of Array.isArray(message.categories) ? message.categories.slice(0, 300) : []) {
    const category = Core.normalizeCategory(item);
    if (!category || !category.slug) continue;
    for (const rule of Object.values(state.rules)) {
      const aliases = rule.aliases || [];
      if (!rule.category.slug) {
        if (rule.category.key !== category.key && !aliases.includes(category.key)) continue;
        rule.category = { ...rule.category, slug: category.slug };
        changed = true;
      } else if (rule.category.slug === category.slug && rule.category.key !== category.key && !aliases.includes(category.key)) {
        rule.aliases = [...aliases, category.key].slice(-MAX_ALIASES);
        changed = true;
      }
    }
  }
  return changed;
}

function laterSnooze(candidate, current) {
  if (!current) return true;
  if (candidate.until === null) return current.until !== null;
  return current.until !== null && candidate.until > current.until;
}

function unionExceptions(left, right) {
  const result = left.map(entry => ({ ...entry }));
  for (const entry of right) if (!result.some(item => item.login === entry.login)) result.push({ ...entry });
  return result;
}

function importBackup(state, incoming, replace) {
  if (replace) {
    for (const area of ['snoozes', 'undoMarkers', 'rules', 'filters', 'whitelist']) state[area] = {};
  }
  for (const entry of Object.values(incoming.snoozes)) {
    if (!laterSnooze(entry, ownEntry(state, entry.login))) continue;
    putEntry(state, entry.login, { ...entry, token: newToken() });
    delete state.undoMarkers[entry.login];
  }
  for (const rule of Object.values(incoming.rules)) {
    const current = ownRule(state, rule.id) || (rule.category.slug &&
      Object.values(state.rules).find(item => item.login === rule.login && item.category.slug === rule.category.slug));
    if (!current) {
      putRule(state, { ...clone(rule), token: newToken() });
      continue;
    }
    const exceptions = unionExceptions(current.exceptions, rule.exceptions);
    const aliases = [...new Set([...(current.aliases || []), ...(rule.aliases || []), ...(rule.category.key !== current.category.key ? [rule.category.key] : [])])]
      .filter(alias => alias !== current.category.key).slice(-MAX_ALIASES);
    const slug = current.category.slug || rule.category.slug;
    if (exceptions.length === current.exceptions.length && aliases.length === (current.aliases || []).length && slug === current.category.slug) continue;
    current.exceptions = exceptions;
    if (aliases.length) current.aliases = aliases;
    if (slug) current.category = { ...current.category, slug };
    current.token = newToken();
  }
  for (const filter of Object.values(incoming.filters)) {
    const current = ownFilter(state, filter.id);
    if (!current) {
      put(state, 'filters', filter.id, { ...clone(filter), token: newToken() });
    } else {
      const exceptions = unionExceptions(current.exceptions, filter.exceptions);
      if (exceptions.length !== current.exceptions.length) { current.exceptions = exceptions; current.token = newToken(); }
    }
  }
  for (const entry of Object.values(incoming.whitelist)) {
    if (!Core.isWhitelisted(state, entry.login)) put(state, 'whitelist', entry.login, { ...entry });
  }
}

async function handleMessage(message, sender) {
  if (!message || typeof message !== 'object' || Array.isArray(message)) throw new Error(t('errInvalidRequest'));
  if (message.type === 'TSNOOZE_REGISTER') {
    if (!isTwitchSender(sender)) throw new Error(t('errRegister'));
    const ids = await registeredTabs();
    if (!ids.includes(sender.tab.id)) await chrome.storage.session.set({ [TABS_KEY]: [...ids, sender.tab.id] });
    // Identity protects a fresh registration from an older in-flight snapshot failure.
    tabRegistrations.set(sender.tab.id, {});
    return { ok: true };
  }
  if (message.type === 'TSNOOZE_GET') return { ok: true, state: await readState() };
  if (message.type === 'TSNOOZE_OPEN_BACKUP') { await chrome.runtime.openOptionsPage(); return { ok: true }; }
  if (message.type === 'TSNOOZE_LEARN') {
    if (!isTwitchSender(sender)) throw new Error(t('errLearn'));
    const state = await readState();
    return learn(state, message) ? { ok: true, state: await writeState(state) } : { ok: true, state };
  }
  if (message.type === 'TSNOOZE_WHITELIST_SET') {
    const login = requireLogin(message.login);
    const state = await readState();
    const tracker = changeTracker(state);
    const previous = Core.isWhitelisted(state, login) ? state.whitelist[login] : null;
    const displayName = message.displayName === undefined && previous
      ? previous.displayName : Core.normalizeDisplayName(message.displayName, login);
    if (previous && previous.displayName === displayName) return { ok: true, state };
    tracker.touch('whitelist', login);
    put(state, 'whitelist', login, { login, displayName, createdAt: previous ? previous.createdAt : Date.now() });
    return tracked(state, tracker);
  }
  if (message.type === 'TSNOOZE_WHITELIST_REMOVE') {
    const login = requireLogin(message.login);
    const state = await readState();
    if (!Core.isWhitelisted(state, login)) return { ok: true, state };
    const tracker = changeTracker(state);
    tracker.touch('whitelist', login);
    delete state.whitelist[login];
    return tracked(state, tracker);
  }
  if (message.type === 'TSNOOZE_RULE_SET') {
    const category = requireCategory(message.category);
    const login = message.login === null || message.login === undefined ? null : requireLogin(message.login);
    const state = await readState();
    if (login !== null) requireHideable(state, login);
    // The same category saved under another display language is updated rather than duplicated.
    const bySlug = category.slug && Object.values(state.rules).find(rule => rule.login === login && rule.category.slug === category.slug);
    const id = bySlug ? bySlug.id : Core.ruleId(category, login);
    const previous = ownRule(state, id);
    const tracker = changeTracker(state);
    tracker.touch('rules', id);
    const rule = {
      id, category: previous ? previous.category : category, login,
      displayName: login === null ? '' : Core.normalizeDisplayName(message.displayName, login),
      exceptions: previous ? previous.exceptions : [],
      createdAt: previous ? previous.createdAt : Date.now(), token: newToken()
    };
    if (previous && category.slug && !previous.category.slug) rule.category = { ...previous.category, slug: category.slug };
    const aliases = previous ? [...(previous.aliases || [])] : [];
    if (previous && category.key !== previous.category.key && !aliases.includes(category.key)) aliases.push(category.key);
    if (aliases.length) rule.aliases = aliases.slice(-MAX_ALIASES);
    putRule(state, rule);
    return tracked(state, tracker);
  }
  if (message.type === 'TSNOOZE_RULE_REMOVE') {
    const state = await readState();
    if (!ownRule(state, message.id)) throw new Error(t('errRuleGone'));
    const tracker = changeTracker(state);
    tracker.touch('rules', message.id);
    delete state.rules[message.id];
    return tracked(state, tracker);
  }
  if (message.type === 'TSNOOZE_RULE_EXCEPTION') {
    const login = requireLogin(message.login);
    if (typeof message.allow !== 'boolean') throw new Error(t('errAllow'));
    const state = await readState();
    const rule = ownRule(state, message.id);
    if (!rule || rule.login !== null) throw new Error(t('errNoRule'));
    const tracker = changeTracker(state);
    tracker.touch('rules', rule.id);
    allowChannel(rule, login, message.displayName, message.allow);
    return tracked(state, tracker);
  }
  if (message.type === 'TSNOOZE_FILTER_SET') {
    const keyword = Core.normalizeKeyword(message.text);
    if (!keyword) throw new Error(t('errKeywordInvalid'));
    const id = 'keyword:' + keyword.key;
    const state = await readState();
    const previous = ownFilter(state, id);
    if (previous) return { ok: true, state };
    const tracker = changeTracker(state);
    tracker.touch('filters', id);
    put(state, 'filters', id, { id, key: keyword.key, text: keyword.text, exceptions: [], createdAt: Date.now(), token: newToken() });
    return tracked(state, tracker);
  }
  if (message.type === 'TSNOOZE_FILTER_REMOVE') {
    const state = await readState();
    if (!ownFilter(state, message.id)) throw new Error(t('errKeywordGone'));
    const tracker = changeTracker(state);
    tracker.touch('filters', message.id);
    delete state.filters[message.id];
    return tracked(state, tracker);
  }
  if (message.type === 'TSNOOZE_FILTER_EXCEPTION') {
    const login = requireLogin(message.login);
    if (typeof message.allow !== 'boolean') throw new Error(t('errAllow'));
    const state = await readState();
    const filter = ownFilter(state, message.id);
    if (!filter) throw new Error(t('errNoKeyword'));
    const tracker = changeTracker(state);
    tracker.touch('filters', filter.id);
    allowChannel(filter, login, message.displayName, message.allow);
    return tracked(state, tracker);
  }
  if (message.type === 'TSNOOZE_SHOW_CHANNEL') {
    const login = requireLogin(message.login);
    if (message.categories !== undefined && !Array.isArray(message.categories)) throw new Error(t('errCategories'));
    if (message.filters !== undefined && !Array.isArray(message.filters)) throw new Error(t('errKeywords'));
    const categories = (message.categories || []).map(requireCategory);
    const state = await readState();
    const tracker = changeTracker(state);
    const previous = ownEntry(state, login);
    let rulesChanged = false;
    tracker.touch('snoozes', login);
    delete state.snoozes[login];
    for (const rule of Object.values(state.rules)) {
      if (rule.login === login) { tracker.touch('rules', rule.id); delete state.rules[rule.id]; rulesChanged = true; }
    }
    for (const category of categories) {
      for (const rule of Object.values(state.rules)) {
        if (rule.login !== null || !Core.categoryMatches(rule, category) || rule.exceptions.some(entry => entry.login === login)) continue;
        tracker.touch('rules', rule.id);
        allowChannel(rule, login, message.displayName, true);
        rulesChanged = true;
      }
    }
    for (const id of message.filters || []) {
      const filter = ownFilter(state, id);
      if (!filter || filter.exceptions.some(entry => entry.login === login)) continue;
      tracker.touch('filters', filter.id);
      allowChannel(filter, login, message.displayName, true);
      rulesChanged = true;
    }
    if (previous && !rulesChanged) return restoredResult(state, login, previous);
    if (previous || rulesChanged) {
      // A composite Restore invalidates any older same-channel Restore marker; its own Undo covers every record it changed.
      delete state.undoMarkers[login];
      return tracked(state, tracker);
    }
    return { ok: true, state };
  }
  if (message.type === 'TSNOOZE_SET') {
    const login = requireLogin(message.login);
    if (!Core.PRESETS.some(preset => preset.key === message.duration)) throw new Error(t('errDuration'));
    const state = await readState();
    requireHideable(state, login);
    const previous = ownEntry(state, login);
    const now = Date.now();
    const entry = {
      login,
      displayName: Core.normalizeDisplayName(message.displayName, login),
      until: Core.snoozeUntil(message.duration, now),
      createdAt: now,
      duration: message.duration,
      token: newToken()
    };
    delete state.undoMarkers[login];
    putEntry(state, login, entry);
    const next = await writeState(state);
    return { ok: true, state: next, undo: { login, expectedToken: entry.token, previous } };
  }
  if (message.type === 'TSNOOZE_RESTORE') {
    const login = requireLogin(message.login);
    const state = await readState();
    const previous = ownEntry(state, login);
    if (!previous) throw new Error(t('errNotSnoozed'));
    return restoredResult(state, login, previous);
  }
  if (message.type === 'TSNOOZE_IMPORT') {
    if (message.mode !== 'merge' && message.mode !== 'replace') throw new Error(t('errImportMode'));
    const { state: incoming, counts } = Core.readBackup(message.data);
    const state = await readState();
    importBackup(state, incoming, message.mode === 'replace');
    return { ok: true, state: await writeState(state), counts };
  }
  if (message.type === 'TSNOOZE_UNDO') {
    const undo = message.undo;
    if (!undo || typeof undo !== 'object' || Array.isArray(undo)) throw new Error(t('errUndo'));
    if (undo.kind === 'entities') return undoEntities(undo);
    const login = requireLogin(undo.login);
    if (undo.expectedToken !== null && (typeof undo.expectedToken !== 'string' || !/^[a-z0-9_-]{8,128}$/i.test(undo.expectedToken))) {
      throw new Error(t('errUndo'));
    }
    if (undo.expectedToken === null && (typeof undo.expectedAbsenceToken !== 'string' || !/^[a-z0-9_-]{8,128}$/i.test(undo.expectedAbsenceToken))) {
      throw new Error(t('errUndoRestore'));
    }
    let previous = null;
    if (undo.previous !== null) {
      const previousState = { schema: 1, revision: 0, snoozes: {} };
      putEntry(previousState, login, undo.previous);
      // Validate the original entry independently of whether it has since expired.
      previous = ownEntry(Core.normalizeState(previousState, 0), login);
      if (!previous) throw new Error(t('errUndo'));
    }
    const state = await readState();
    const current = ownEntry(state, login);
    const tokenMatches = undo.expectedToken === null ? current === null : current && current.token === undo.expectedToken;
    const marker = Object.hasOwn(state.undoMarkers, login) ? state.undoMarkers[login] : null;
    const absenceMatches = undo.expectedToken !== null || (marker && marker.token === undo.expectedAbsenceToken);
    if (!tokenMatches || !absenceMatches) throw new Error(t('errUndoNewer'));
    delete state.undoMarkers[login];
    if (previous && Core.isActiveSnooze(previous, Date.now())) putEntry(state, login, previous);
    else delete state.snoozes[login];
    return { ok: true, state: await writeState(state) };
  }
  throw new Error(t('errUnknown'));
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!sender || sender.id !== chrome.runtime.id) {
    sendResponse({ ok: false, error: t('errNotFromExtension') });
    return false;
  }
  const response = message && !Array.isArray(message) && message.type === 'TSNOOZE_OVERVIEW'
    ? overview() : serialize(() => handleMessage(message, sender));
  response.then(
    result => sendResponse(result),
    error => sendResponse({ ok: false, error: errorMessage(error) })
  );
  return true;
});

function reconcile() {
  serialize(readState).catch(error => console.warn('Twitch Snooze could not refresh local state:', errorMessage(error)));
}

chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === EXPIRY_ALARM) reconcile();
});
chrome.runtime.onStartup.addListener(reconcile);
chrome.runtime.onInstalled.addListener(reconcile);
reconcile();
