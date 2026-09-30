'use strict';

importScripts('core.js');

const Core = globalThis.TwitchSnooze;
const EXPIRY_ALARM = 'twitch-snooze-expiry';
const TABS_KEY = 'twitchSnoozeTabs';
const SNAPSHOT_TIMEOUT_MS = 1500;
const tabRegistrations = new Map();
let operationQueue = Promise.resolve();

function serialize(operation) {
  const result = operationQueue.then(operation);
  operationQueue = result.catch(() => {});
  return result;
}

function errorMessage(error) {
  return error && typeof error.message === 'string' ? error.message : 'Twitch Snooze could not save this change.';
}

async function updateAuxiliary(state) {
  const entries = Object.values(state.snoozes);
  const expiries = [...entries, ...Object.values(state.undoMarkers)].map(entry => entry.until);
  const nextExpiry = expiries.length ? Math.min(...expiries) : null;
  const count = entries.filter(entry => !Core.isWhitelisted(state, entry.login)).length +
    Object.values(state.rules).filter(rule => rule.login === null || !Core.isWhitelisted(state, rule.login)).length;
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
  if (!login) throw new Error('Choose a valid Twitch channel.');
  return login;
}

function ownEntry(state, login) {
  return Object.hasOwn(state.snoozes, login) ? state.snoozes[login] : null;
}

function putEntry(state, login, entry) {
  Object.defineProperty(state.snoozes, login, {
    value: entry, enumerable: true, writable: true, configurable: true
  });
}

function requireCategory(value) {
  const category = Core.normalizeCategory(value);
  if (!category) throw new Error('Choose a valid Twitch category.');
  return category;
}

function requireHideable(state, login) {
  if (Core.isWhitelisted(state, login)) throw new Error('Remove this streamer from the whitelist before hiding them.');
}

function ownRule(state, id) {
  return typeof id === 'string' && Object.hasOwn(state.rules, id) ? state.rules[id] : null;
}

function putRule(state, rule) {
  Object.defineProperty(state.rules, rule.id, {
    value: rule, enumerable: true, writable: true, configurable: true
  });
}

function allowChannel(rule, login, displayName, allow) {
  rule.exceptions = rule.exceptions.filter(entry => entry.login !== login);
  if (allow) rule.exceptions.push({ login, displayName: Core.normalizeDisplayName(displayName, login) });
  rule.token = newToken();
}

async function restoredResult(state, login, previous) {
  delete state.snoozes[login];
  const now = Date.now();
  const marker = { token: newToken(), createdAt: now, until: Math.min(now + Core.RESTORE_UNDO_MS, previous.until) };
  Object.defineProperty(state.undoMarkers, login, {
    value: marker, enumerable: true, writable: true, configurable: true
  });
  const next = await writeState(state);
  return { ok: true, state: next, undo: { login, expectedToken: null, previous, expectedAbsenceToken: marker.token } };
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
      observations.push({ login, displayName: Core.normalizeDisplayName(info.displayName, login), category });
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

async function handleMessage(message, sender) {
  if (!message || typeof message !== 'object' || Array.isArray(message)) throw new Error('Invalid Twitch Snooze request.');
  if (message.type === 'TSNOOZE_REGISTER') {
    if (!isTwitchSender(sender)) throw new Error('Only an open Twitch tab can register.');
    const ids = await registeredTabs();
    if (!ids.includes(sender.tab.id)) await chrome.storage.session.set({ [TABS_KEY]: [...ids, sender.tab.id] });
    // Identity protects a fresh registration from an older in-flight snapshot failure.
    tabRegistrations.set(sender.tab.id, {});
    return { ok: true };
  }
  if (message.type === 'TSNOOZE_GET') return { ok: true, state: await readState() };
  if (message.type === 'TSNOOZE_WHITELIST_SET') {
    const login = requireLogin(message.login);
    const state = await readState();
    const previous = Core.isWhitelisted(state, login) ? state.whitelist[login] : null;
    const displayName = message.displayName === undefined && previous
      ? previous.displayName : Core.normalizeDisplayName(message.displayName, login);
    if (previous && previous.displayName === displayName) return { ok: true, state };
    Object.defineProperty(state.whitelist, login, {
      value: { login, displayName, createdAt: previous ? previous.createdAt : Date.now() },
      enumerable: true, writable: true, configurable: true
    });
    return { ok: true, state: await writeState(state) };
  }
  if (message.type === 'TSNOOZE_WHITELIST_REMOVE') {
    const login = requireLogin(message.login);
    const state = await readState();
    if (!Core.isWhitelisted(state, login)) return { ok: true, state };
    delete state.whitelist[login];
    return { ok: true, state: await writeState(state) };
  }
  if (message.type === 'TSNOOZE_RULE_SET') {
    const category = requireCategory(message.category);
    const login = message.login === null || message.login === undefined ? null : requireLogin(message.login);
    const id = Core.ruleId(category, login);
    const state = await readState();
    if (login !== null) requireHideable(state, login);
    const previous = ownRule(state, id);
    putRule(state, {
      id, category, login,
      displayName: login === null ? '' : Core.normalizeDisplayName(message.displayName, login),
      exceptions: previous ? previous.exceptions : [],
      createdAt: previous ? previous.createdAt : Date.now(), token: newToken()
    });
    return { ok: true, state: await writeState(state) };
  }
  if (message.type === 'TSNOOZE_RULE_REMOVE') {
    const state = await readState();
    if (!ownRule(state, message.id)) throw new Error('This category rule is no longer active.');
    delete state.rules[message.id];
    return { ok: true, state: await writeState(state) };
  }
  if (message.type === 'TSNOOZE_RULE_EXCEPTION') {
    const login = requireLogin(message.login);
    if (typeof message.allow !== 'boolean') throw new Error('Choose whether to show this channel.');
    const state = await readState();
    const rule = ownRule(state, message.id);
    if (!rule || rule.login !== null) throw new Error('Choose an active category rule.');
    allowChannel(rule, login, message.displayName, message.allow);
    return { ok: true, state: await writeState(state) };
  }
  if (message.type === 'TSNOOZE_SHOW_CHANNEL') {
    const login = requireLogin(message.login);
    if (message.categories !== undefined && !Array.isArray(message.categories)) throw new Error('Choose valid Twitch categories.');
    const categories = (message.categories || []).map(requireCategory);
    const state = await readState();
    const previous = ownEntry(state, login);
    let rulesChanged = false;
    delete state.snoozes[login];
    for (const rule of Object.values(state.rules)) {
      if (rule.login === login) { delete state.rules[rule.id]; rulesChanged = true; }
    }
    for (const category of categories) {
      const rule = ownRule(state, Core.ruleId(category));
      if (rule && !rule.exceptions.some(entry => entry.login === login)) {
        allowChannel(rule, login, message.displayName, true);
        rulesChanged = true;
      }
    }
    if (previous && !rulesChanged) return restoredResult(state, login, previous);
    if (previous || rulesChanged) {
      // A composite Restore invalidates any older same-channel Undo.
      delete state.undoMarkers[login];
      return { ok: true, state: await writeState(state) };
    }
    return { ok: true, state };
  }
  if (message.type === 'TSNOOZE_SET') {
    const login = requireLogin(message.login);
    if (!Core.PRESETS.some(preset => preset.key === message.duration)) throw new Error('Choose a valid snooze duration.');
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
    if (!previous) throw new Error('This channel is no longer snoozed.');
    return restoredResult(state, login, previous);
  }
  if (message.type === 'TSNOOZE_UNDO') {
    const undo = message.undo;
    if (!undo || typeof undo !== 'object' || Array.isArray(undo)) throw new Error('This change cannot be undone.');
    const login = requireLogin(undo.login);
    if (undo.expectedToken !== null && (typeof undo.expectedToken !== 'string' || !/^[a-z0-9_-]{8,128}$/i.test(undo.expectedToken))) {
      throw new Error('This change cannot be undone.');
    }
    if (undo.expectedToken === null && (typeof undo.expectedAbsenceToken !== 'string' || !/^[a-z0-9_-]{8,128}$/i.test(undo.expectedAbsenceToken))) {
      throw new Error('This restore can no longer be undone.');
    }
    let previous = null;
    if (undo.previous !== null) {
      const previousState = { schema: 1, revision: 0, snoozes: {} };
      putEntry(previousState, login, undo.previous);
      // Validate the original entry independently of whether it has since expired.
      previous = ownEntry(Core.normalizeState(previousState, 0), login);
      if (!previous) throw new Error('This change cannot be undone.');
    }
    const state = await readState();
    const current = ownEntry(state, login);
    const tokenMatches = undo.expectedToken === null ? current === null : current && current.token === undo.expectedToken;
    const marker = Object.hasOwn(state.undoMarkers, login) ? state.undoMarkers[login] : null;
    const absenceMatches = undo.expectedToken !== null || (marker && marker.token === undo.expectedAbsenceToken);
    if (!tokenMatches || !absenceMatches) throw new Error('A newer change was made or this Undo expired. Undo cannot overwrite it.');
    delete state.undoMarkers[login];
    if (previous && previous.until > Date.now()) putEntry(state, login, previous);
    else delete state.snoozes[login];
    return { ok: true, state: await writeState(state) };
  }
  throw new Error('Unknown Twitch Snooze request.');
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!sender || sender.id !== chrome.runtime.id) {
    sendResponse({ ok: false, error: 'This request did not come from Twitch Snooze.' });
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
