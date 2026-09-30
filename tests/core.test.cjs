'use strict';

process.env.TZ = 'Europe/Amsterdam';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const extensionPath = path.resolve(__dirname, '../extension');
const Core = require(path.join(extensionPath, 'core.js'));
const coreSource = fs.readFileSync(path.join(extensionPath, 'core.js'), 'utf8');
const backgroundSource = fs.readFileSync(path.join(extensionPath, 'background.js'), 'utf8');
const now = new Date(2026, 8, 30, 14, 0, 0).getTime();

function entry(login, options = {}) {
  return {
    login, displayName: login.toUpperCase(), until: now + 86400000,
    createdAt: now - 1000, duration: 'day', token: 'valid-token-12345', ...options
  };
}

function rule(category, login = null, options = {}) {
  const normalized = Core.normalizeCategory(category);
  return {
    id: Core.ruleId(normalized, login), category: normalized, login,
    displayName: login ? login.toUpperCase() : '', exceptions: [],
    createdAt: now - 1000, token: 'valid-rule-token-12345', ...options
  };
}

function serializable(value) {
  return JSON.parse(JSON.stringify(value));
}

function reorderObjectKeys(value) {
  if (Array.isArray(value)) return value.map(reorderObjectKeys);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, reorderObjectKeys(value[key])]));
}

function event() {
  const listeners = [];
  return { addListener(listener) { listeners.push(listener); }, fire(...args) { for (const listener of listeners) listener(...args); }, listeners };
}

function worker(options = {}) {
  const storage = options.storage || {};
  const sessionStorage = options.sessionStorage || {};
  const snapshots = options.snapshots || new Map();
  const tabMessages = [];
  const clock = options.clock || { now };
  const alarms = new Map();
  const badges = [];
  let sets = 0;
  let reads = 0;
  let failNextWrite = false;
  const runtime = { id: 'twitch-snooze-test-id', onMessage: event(), onStartup: event(), onInstalled: event() };
  const alarmEvent = event();
  const pause = () => new Promise(resolve => setTimeout(resolve, options.delay || 0));
  class FakeDate extends Date {
    constructor(...args) { super(...(args.length ? args : [clock.now])); }
    static now() { return clock.now; }
  }
  const chrome = {
    runtime,
    storage: { local: {
      async get(key) {
        reads++;
        await pause();
        if (!Object.hasOwn(storage, key)) return {};
        const value = serializable(storage[key]);
        return { [key]: options.reorderStorageKeys ? reorderObjectKeys(value) : value };
      },
      async set(values) {
        await pause();
        if (failNextWrite) { failNextWrite = false; throw new Error('Simulated storage failure'); }
        sets++;
        Object.assign(storage, serializable(values));
      }
    }, session: {
      async get(key) { return Object.hasOwn(sessionStorage, key) ? { [key]: serializable(sessionStorage[key]) } : {}; },
      async set(values) { Object.assign(sessionStorage, serializable(values)); }
    } },
    tabs: { async sendMessage(id, payload) {
      tabMessages.push({ id, payload: serializable(payload) });
      if (!snapshots.has(id)) throw new Error('No receiving end');
      const reply = snapshots.get(id);
      if (typeof reply === 'function') return reply();
      if (reply instanceof Error) throw reply;
      return reply === undefined ? undefined : serializable(reply);
    } },
    action: {
      async setBadgeText(value) { badges.push(value.text); },
      async setBadgeBackgroundColor() {}
    },
    alarms: {
      onAlarm: alarmEvent,
      async create(name, info) { alarms.set(name, serializable(info)); },
      async clear(name) { return alarms.delete(name); }
    }
  };
  const warnings = [];
  const context = vm.createContext({
    chrome, Date: FakeDate, URL, crypto: webcrypto, Intl, setTimeout, clearTimeout,
    console: { warn(...args) { warnings.push(args); } }
  });
  context.importScripts = filename => {
    assert.equal(filename, 'core.js');
    vm.runInContext(coreSource, context, { filename: 'core.js' });
  };
  vm.runInContext(backgroundSource, context, { filename: 'background.js' });
  function message(payload, sender = { id: runtime.id }) {
    return new Promise(resolve => {
      const keepAlive = runtime.onMessage.listeners[0](payload, sender, result => resolve(serializable(result)));
      if (sender.id === runtime.id) assert.equal(keepAlive, true);
    });
  }
  return {
    storage, sessionStorage, snapshots, tabMessages, clock, alarms, badges, runtime, alarmEvent, warnings, message,
    failWrite() { failNextWrite = true; },
    get sets() { return sets; }, get reads() { return reads; }
  };
}

test('presets match the approved six durations and omit one hour', () => {
  assert.deepEqual(Core.PRESETS.map(preset => preset.key), ['today', 'day', 'three-days', 'week', 'fortnight', 'month']);
  assert.equal(Core.PRESETS.find(preset => preset.key === 'day').label, '24 hours');
  assert.ok(Core.PRESETS.every(preset => !/1 hour/i.test(preset.label)));
});

test('normalizes direct channel links while rejecting reserved routes and foreign links', () => {
  for (const value of ['ShRoUd', '@Shroud', '/shroud', 'https://www.twitch.tv/shroud/?foo=bar', 'twitch.tv/shroud']) {
    assert.equal(Core.normalizeLogin(value), 'shroud', value);
  }
  for (const value of [null, {}, '', 'directory', '/directory', '/settings', 'https://evil.test/shroud', '//evil.test/shroud',
    'https://twitch.tv.evil.test/shroud', 'javascript:alert(1)', 'https://user:pass@twitch.tv/shroud', 'https://twitch.tv:4000/shroud',
    '/directory/following', '/shroud/videos', '/%73hroud', 'some channel', 'x'.repeat(26)]) {
    assert.equal(Core.normalizeLogin(value), null, String(value));
  }
});

test('fixed durations remain exact elapsed time through daylight saving changes', () => {
  const spring = new Date(2026, 2, 28, 12, 0, 0).getTime();
  const fall = new Date(2026, 9, 24, 12, 0, 0).getTime();
  for (const date of [spring, fall]) {
    for (const [preset, days] of [['day', 1], ['three-days', 3], ['week', 7], ['fortnight', 14]]) {
      assert.equal(Core.snoozeUntil(preset, date) - date, days * 86400000);
    }
  }
});

test('Today ends at local midnight even on 23 and 25 hour days', () => {
  const spring = new Date(2026, 2, 29, 0, 0, 0).getTime();
  const fall = new Date(2026, 9, 25, 0, 0, 0).getTime();
  assert.equal(Core.snoozeUntil('today', spring), new Date(2026, 2, 30, 0, 0, 0).getTime());
  assert.equal(Core.snoozeUntil('today', spring) - spring, 23 * 3600000);
  assert.equal(Core.snoozeUntil('today', fall) - fall, 25 * 3600000);
});

test('month clamps to calendar month end and preserves local time', () => {
  for (const [year, month, day, nextYear, nextMonth, nextDay] of [
    [2026, 0, 31, 2026, 1, 28], [2028, 0, 31, 2028, 1, 29], [2026, 2, 31, 2026, 3, 30], [2026, 11, 31, 2027, 0, 31]
  ]) {
    assert.equal(Core.snoozeUntil('month', new Date(year, month, day, 16, 37, 22).getTime()),
      new Date(nextYear, nextMonth, nextDay, 16, 37, 22).getTime());
  }
});

test('rejects invalid duration and invalid current time', () => {
  assert.throws(() => Core.snoozeUntil('hour', now), /duration/);
  assert.throws(() => Core.snoozeUntil('day', NaN), /time/);
  assert.throws(() => Core.snoozeUntil('day', 8.64e15), /time/);
});

test('missing and malformed storage produces safe empty state', () => {
  const empty = { schema: 1, revision: 0, snoozes: {}, undoMarkers: {}, rules: {}, whitelist: {} };
  for (const raw of [undefined, null, [], 'bad', { schema: 2 }, { schema: 1, revision: 'oops', snoozes: [] }]) {
    assert.deepEqual(Core.normalizeState(raw, now), empty);
  }
});

test('prunes expired and corrupt entries and strips unknown fields', () => {
  const state = Core.normalizeState({ schema: 1, revision: 8, snoozes: {
    shroud: entry('shroud', { displayName: '  Shroud\n  ', ignored: 'remove' }),
    expired: entry('expired', { until: now }),
    wrong: entry('other'),
    directory: entry('directory'),
    badtime: entry('badtime', { until: 'tomorrow' }),
    badtoken: entry('badtoken', { token: '' }),
    badpreset: entry('badpreset', { duration: 'hour' }),
    badcreation: entry('badcreation', { createdAt: now + 2 * 86400000 })
  } }, now);
  assert.equal(state.revision, 8);
  assert.deepEqual(Object.keys(state.snoozes), ['shroud']);
  assert.equal(state.snoozes.shroud.displayName, 'Shroud');
  assert.equal(Object.hasOwn(state.snoozes.shroud, 'ignored'), false);
});

test('special object property logins cannot pollute state prototypes', () => {
  const snoozes = JSON.parse('{"__proto__":null,"constructor":null}');
  snoozes.__proto__ = entry('__proto__');
  snoozes.constructor = entry('constructor');
  const state = Core.normalizeState({ schema: 1, revision: 0, snoozes }, now);
  assert.equal(Object.getPrototypeOf(state.snoozes), Object.prototype);
  assert.equal(Object.hasOwn(state.snoozes, '__proto__'), true);
  assert.equal(state.snoozes.__proto__.login, '__proto__');
  assert.equal(state.snoozes.constructor.login, 'constructor');
});

test('formats expiry as readable local time and remaining duration', () => {
  assert.equal(Core.formatRemaining(now + 2 * 86400000, now), '2 days left');
  assert.equal(Core.formatRemaining(now + 3600000, now), '1 hour left');
  assert.equal(Core.formatRemaining(now + 120000, now), '2 minutes left');
  assert.equal(Core.formatRemaining(now + 1000, now), 'Less than a minute left');
  assert.equal(Core.formatRemaining(now, now), 'Ready to restore');
  assert.equal(Core.formatUntil(NaN), 'Unknown date');
  assert.match(Core.formatUntil(now), /2026/);
});

test('worker initializes undefined storage, increments revision only when writing, and clears badge', async () => {
  const w = worker();
  const result = await w.message({ type: 'TSNOOZE_GET' });
  assert.equal(result.ok, true);
  assert.deepEqual(result.state, { schema: 1, revision: 1, snoozes: {}, undoMarkers: {}, rules: {}, whitelist: {} });
  const sets = w.sets;
  assert.equal((await w.message({ type: 'TSNOOZE_GET' })).state.revision, 1);
  assert.equal(w.sets, sets);
  assert.equal(w.badges.at(-1), '');
  assert.equal(w.alarms.size, 0);
});

test('worker serializes concurrent tab updates so both channels survive', async () => {
  const w = worker({ delay: 2 });
  await w.message({ type: 'TSNOOZE_GET' });
  const [first, second] = await Promise.all([
    w.message({ type: 'TSNOOZE_SET', login: 'shroud', displayName: 'Shroud', duration: 'day' }),
    w.message({ type: 'TSNOOZE_SET', login: 'lirik', displayName: 'LIRIK', duration: 'week' })
  ]);
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  const state = (await w.message({ type: 'TSNOOZE_GET' })).state;
  assert.deepEqual(Object.keys(state.snoozes).sort(), ['lirik', 'shroud']);
  assert.equal(state.revision, 3);
  assert.equal(w.badges.at(-1), '2');
  assert.equal(w.alarms.get('twitch-snooze-expiry').when, now + 86400000);
});

test('expiry alarm removes only expired channels and schedules the next expiry', async () => {
  const w = worker();
  await w.message({ type: 'TSNOOZE_SET', login: 'shroud', duration: 'day' });
  await w.message({ type: 'TSNOOZE_SET', login: 'lirik', duration: 'week' });
  w.clock.now = now + 86400000;
  w.alarmEvent.fire({ name: 'twitch-snooze-expiry' });
  const result = await w.message({ type: 'TSNOOZE_GET' });
  assert.deepEqual(Object.keys(result.state.snoozes), ['lirik']);
  assert.equal(w.badges.at(-1), '1');
  assert.equal(w.alarms.get('twitch-snooze-expiry').when, now + 7 * 86400000);
});

test('expiry is reconciled on worker reload even if alarms did not run', async () => {
  const old = worker();
  await old.message({ type: 'TSNOOZE_SET', login: 'shroud', duration: 'day' });
  const revision = old.storage[Core.STORAGE_KEY].revision;
  const fresh = worker({ storage: old.storage, clock: { now: now + 2 * 86400000 } });
  const result = await fresh.message({ type: 'TSNOOZE_GET' });
  assert.deepEqual(result.state.snoozes, {});
  assert.equal(result.state.revision, revision + 1);
  assert.equal(fresh.alarms.size, 0);
  assert.equal(fresh.badges.at(-1), '');
});

test('startup and installation reconcile corrupted local storage', async () => {
  const w = worker();
  await w.message({ type: 'TSNOOZE_GET' });
  w.storage[Core.STORAGE_KEY] = { schema: 1, revision: 12, snoozes: { valid: entry('valid'), expired: entry('expired', { until: now - 1 }) } };
  w.runtime.onStartup.fire();
  assert.deepEqual(Object.keys((await w.message({ type: 'TSNOOZE_GET' })).state.snoozes), ['valid']);
  w.storage[Core.STORAGE_KEY] = 'broken';
  w.runtime.onInstalled.fire();
  assert.deepEqual((await w.message({ type: 'TSNOOZE_GET' })).state.snoozes, {});
});

test('invalid sender, login, duration, and messages are rejected without applying changes', async () => {
  const w = worker();
  await w.message({ type: 'TSNOOZE_GET' });
  const sets = w.sets;
  for (const [request, sender] of [
    [{ type: 'TSNOOZE_SET', login: 'shroud', duration: 'day' }, { id: 'another-extension' }],
    [{ type: 'TSNOOZE_SET', login: 'directory', duration: 'day' }],
    [{ type: 'TSNOOZE_SET', login: 'https://evil.test/shroud', duration: 'day' }],
    [{ type: 'TSNOOZE_SET', login: 'shroud', duration: 'hour' }],
    [{ type: 'unknown' }], [null],
    [{ type: 'TSNOOZE_UNDO', undo: { login: 'shroud', expectedToken: null, previous: null } }]
  ]) {
    const result = await w.message(request, sender);
    assert.equal(result.ok, false);
    assert.equal(typeof result.error, 'string');
  }
  assert.equal(w.sets, sets);
  assert.deepEqual((await w.message({ type: 'TSNOOZE_GET' })).state.snoozes, {});
});

test('Undo removes a new snooze and restores a prior snooze without losing other channels', async () => {
  const w = worker();
  const first = await w.message({ type: 'TSNOOZE_SET', login: 'shroud', duration: 'day' });
  await w.message({ type: 'TSNOOZE_SET', login: 'lirik', duration: 'month' });
  const changed = await w.message({ type: 'TSNOOZE_SET', login: 'shroud', duration: 'week' });
  const undone = await w.message({ type: 'TSNOOZE_UNDO', undo: changed.undo });
  assert.equal(undone.ok, true);
  assert.equal(undone.state.snoozes.shroud.token, first.state.snoozes.shroud.token);
  assert.equal(undone.state.snoozes.shroud.duration, 'day');
  assert.ok(undone.state.snoozes.lirik);
  const removed = await w.message({ type: 'TSNOOZE_UNDO', undo: first.undo });
  assert.equal(removed.ok, true);
  assert.deepEqual(Object.keys(removed.state.snoozes), ['lirik']);
});

test('stale token Undo never overwrites a newer snooze', async () => {
  const w = worker();
  const first = await w.message({ type: 'TSNOOZE_SET', login: 'shroud', duration: 'day' });
  const newer = await w.message({ type: 'TSNOOZE_SET', login: 'shroud', duration: 'month' });
  const result = await w.message({ type: 'TSNOOZE_UNDO', undo: first.undo });
  assert.equal(result.ok, false);
  assert.match(result.error, /newer change/i);
  assert.equal((await w.message({ type: 'TSNOOZE_GET' })).state.snoozes.shroud.token, newer.state.snoozes.shroud.token);
});

test('Restore Undo survives a worker reload using the per-channel absence token', async () => {
  const w = worker();
  const first = await w.message({ type: 'TSNOOZE_SET', login: 'shroud', duration: 'day' });
  const restored = await w.message({ type: 'TSNOOZE_RESTORE', login: 'shroud' });
  assert.equal(restored.undo.expectedToken, null);
  assert.equal(restored.undo.expectedAbsenceToken, restored.state.undoMarkers.shroud.token);
  assert.equal(Object.hasOwn(restored.undo, 'expectedRevision'), false);
  const reloaded = worker({ storage: w.storage, clock: w.clock });
  const undone = await reloaded.message({ type: 'TSNOOZE_UNDO', undo: restored.undo });
  assert.equal(undone.ok, true);
  assert.equal(undone.state.snoozes.shroud.token, first.state.snoozes.shroud.token);
  assert.deepEqual(undone.state.undoMarkers, {});
});

test('Restore Undo cannot overwrite a newer set-and-restore action even when channel is absent again', async () => {
  const w = worker();
  await w.message({ type: 'TSNOOZE_SET', login: 'shroud', duration: 'day' });
  const restored = await w.message({ type: 'TSNOOZE_RESTORE', login: 'shroud' });
  await w.message({ type: 'TSNOOZE_SET', login: 'shroud', duration: 'week' });
  await w.message({ type: 'TSNOOZE_RESTORE', login: 'shroud' });
  const result = await w.message({ type: 'TSNOOZE_UNDO', undo: restored.undo });
  assert.equal(result.ok, false);
  assert.match(result.error, /newer change/i);
  assert.deepEqual((await w.message({ type: 'TSNOOZE_GET' })).state.snoozes, {});
});

test('Restore Undo survives unrelated snoozes and preserves those channels', async () => {
  const w = worker();
  const first = await w.message({ type: 'TSNOOZE_SET', login: 'shroud', duration: 'day' });
  const restored = await w.message({ type: 'TSNOOZE_RESTORE', login: 'shroud' });
  const unrelated = await w.message({ type: 'TSNOOZE_SET', login: 'lirik', duration: 'month' });
  assert.ok(unrelated.state.revision > restored.state.revision);
  const undone = await w.message({ type: 'TSNOOZE_UNDO', undo: restored.undo });
  assert.equal(undone.ok, true);
  assert.equal(undone.state.snoozes.shroud.token, first.state.snoozes.shroud.token);
  assert.equal(undone.state.snoozes.lirik.token, unrelated.state.snoozes.lirik.token);
  assert.deepEqual(undone.state.undoMarkers, {});
});

test('Restore Undo survives an unrelated expiry alarm', async () => {
  const w = worker({ storage: { [Core.STORAGE_KEY]: { schema: 1, revision: 4, snoozes: {
    shroud: entry('shroud'), lirik: entry('lirik', { until: now + 60000 })
  } } } });
  const restored = await w.message({ type: 'TSNOOZE_RESTORE', login: 'shroud' });
  assert.equal(w.alarms.get('twitch-snooze-expiry').when, now + 60000);
  w.clock.now = now + 120000;
  w.alarmEvent.fire({ name: 'twitch-snooze-expiry' });
  const expired = await w.message({ type: 'TSNOOZE_GET' });
  assert.ok(expired.state.revision > restored.state.revision);
  assert.deepEqual(expired.state.snoozes, {});
  const undone = await w.message({ type: 'TSNOOZE_UNDO', undo: restored.undo });
  assert.equal(undone.ok, true);
  assert.deepEqual(Object.keys(undone.state.snoozes), ['shroud']);
  assert.deepEqual(undone.state.undoMarkers, {});
});

test('a newer Set and its Undo clear the earlier Restore marker', async () => {
  const w = worker();
  await w.message({ type: 'TSNOOZE_SET', login: 'shroud', duration: 'day' });
  const restored = await w.message({ type: 'TSNOOZE_RESTORE', login: 'shroud' });
  const newer = await w.message({ type: 'TSNOOZE_SET', login: 'shroud', duration: 'week' });
  assert.deepEqual(newer.state.undoMarkers, {});
  const removed = await w.message({ type: 'TSNOOZE_UNDO', undo: newer.undo });
  assert.equal(removed.ok, true);
  assert.deepEqual(removed.state.snoozes, {});
  assert.deepEqual(removed.state.undoMarkers, {});
  const stale = await w.message({ type: 'TSNOOZE_UNDO', undo: restored.undo });
  assert.equal(stale.ok, false);
  assert.match(stale.error, /newer change/i);
});

test('legacy schema 1 state gains an empty marker map without changing saved snoozes', async () => {
  const original = entry('shroud');
  const legacy = { schema: 1, revision: 41, snoozes: { shroud: original } };
  const normalized = Core.normalizeState(legacy, now);
  assert.deepEqual(normalized.snoozes.shroud, original);
  assert.deepEqual(normalized.undoMarkers, {});
  const w = worker({ storage: { [Core.STORAGE_KEY]: legacy } });
  const result = await w.message({ type: 'TSNOOZE_GET' });
  assert.equal(result.state.schema, 1);
  assert.equal(result.state.revision, 42);
  assert.deepEqual(result.state.snoozes.shroud, original);
  assert.deepEqual(result.state.undoMarkers, {});
  assert.equal(w.alarms.get('twitch-snooze-expiry').when, original.until);
});

test('Restore markers expire after ten minutes and the alarm removes their history', async () => {
  const w = worker();
  await w.message({ type: 'TSNOOZE_SET', login: 'shroud', duration: 'month' });
  const restored = await w.message({ type: 'TSNOOZE_RESTORE', login: 'shroud' });
  assert.equal(Core.RESTORE_UNDO_MS, 600000);
  assert.equal(restored.state.undoMarkers.shroud.until, now + Core.RESTORE_UNDO_MS);
  assert.equal(w.alarms.get('twitch-snooze-expiry').when, now + Core.RESTORE_UNDO_MS);
  assert.equal(w.badges.at(-1), '');
  w.clock.now = now + Core.RESTORE_UNDO_MS;
  w.alarmEvent.fire({ name: 'twitch-snooze-expiry' });
  const expired = await w.message({ type: 'TSNOOZE_GET' });
  assert.deepEqual(expired.state.undoMarkers, {});
  assert.deepEqual(expired.state.snoozes, {});
  assert.equal(w.alarms.size, 0);
  const stale = await w.message({ type: 'TSNOOZE_UNDO', undo: restored.undo });
  assert.equal(stale.ok, false);
  assert.match(stale.error, /expired/i);
  assert.deepEqual(w.storage[Core.STORAGE_KEY].undoMarkers, {});
});

test('Restore marker retention is capped by the removed snooze expiry and pruned on worker restart', async () => {
  const until = now + 45000;
  const w = worker({ storage: { [Core.STORAGE_KEY]: {
    schema: 1, revision: 2, snoozes: { shroud: entry('shroud', { until }) }
  } } });
  const restored = await w.message({ type: 'TSNOOZE_RESTORE', login: 'shroud' });
  assert.equal(restored.state.undoMarkers.shroud.until, until);
  assert.equal(w.alarms.get('twitch-snooze-expiry').when, until);
  const restarted = worker({ storage: w.storage, clock: { now: until } });
  const result = await restarted.message({ type: 'TSNOOZE_GET' });
  assert.deepEqual(result.state.undoMarkers, {});
  assert.equal(restarted.alarms.size, 0);
  assert.equal((await restarted.message({ type: 'TSNOOZE_UNDO', undo: restored.undo })).ok, false);
  assert.deepEqual((await restarted.message({ type: 'TSNOOZE_GET' })).state.snoozes, {});
});

test('marker validation prunes corrupt, expired, overlong, and active-channel records safely', () => {
  const marker = { token: 'restore-token-12345', createdAt: now, until: now + Core.RESTORE_UNDO_MS };
  const markers = {
    valid: { ...marker, ignored: 'remove' },
    expired: { ...marker, until: now },
    overlong: { ...marker, until: now + Core.RESTORE_UNDO_MS + 1 },
    future: { ...marker, createdAt: now + Core.RESTORE_UNDO_MS, until: now + 2 * Core.RESTORE_UNDO_MS },
    invalid: { ...marker, token: '' },
    shroud: { ...marker },
    directory: { ...marker }
  };
  Object.defineProperty(markers, '__proto__', { value: { ...marker }, enumerable: true });
  const state = Core.normalizeState({ schema: 1, revision: 5, snoozes: { shroud: entry('shroud') }, undoMarkers: markers }, now);
  assert.deepEqual(Object.keys(state.undoMarkers).sort(), ['__proto__', 'valid']);
  assert.deepEqual(state.undoMarkers.valid, marker);
  assert.equal(Object.getPrototypeOf(state.undoMarkers), Object.prototype);
  assert.equal(Object.hasOwn(state.undoMarkers, '__proto__'), true);
});

test('Undo does not re-hide an earlier snooze that expired during a later snooze', async () => {
  const w = worker();
  await w.message({ type: 'TSNOOZE_SET', login: 'shroud', duration: 'day' });
  const changed = await w.message({ type: 'TSNOOZE_SET', login: 'shroud', duration: 'week' });
  w.clock.now = now + 2 * 86400000;
  const undone = await w.message({ type: 'TSNOOZE_UNDO', undo: changed.undo });
  assert.equal(undone.ok, true);
  assert.deepEqual(undone.state.snoozes, {});
});

test('a failed write does not poison the serialized queue or apply an unsaved change', async () => {
  const w = worker();
  await w.message({ type: 'TSNOOZE_GET' });
  w.failWrite();
  const result = await w.message({ type: 'TSNOOZE_SET', login: 'shroud', duration: 'day' });
  assert.equal(result.ok, false);
  assert.match(result.error, /storage failure/i);
  const next = await w.message({ type: 'TSNOOZE_SET', login: 'lirik', duration: 'week' });
  assert.equal(next.ok, true);
  assert.deepEqual(Object.keys(next.state.snoozes), ['lirik']);
});

test('category identity agrees across card links and visible names without trusting conflicting keys', () => {
  assert.deepEqual(Core.normalizeCategory('  Ｊｕｓｔ\n Chatting  '), { key: 'just-chatting', name: 'Just Chatting' });
  assert.equal(Core.normalizeCategory({ name: 'Grand Theft Auto V', key: 'wrong-key' }).key, 'grand-theft-auto-v');
  assert.equal(Core.normalizeCategory({ key: 'grand-theft-auto-v' }).key, 'grand-theft-auto-v');
  assert.equal(Core.normalizeCategory('Pokémon Écarlate / Violet').key, 'pokémon-écarlate-violet');
  assert.equal(Core.normalizeCategory('原神').key, '原神');
  for (const value of [null, [], {}, 3, '   ', '!!!', '\u0000', 'x'.repeat(201)]) assert.equal(Core.normalizeCategory(value), null);
  assert.equal(Core.ruleId('Just Chatting'), 'category:just-chatting');
  assert.equal(Core.ruleId('Just Chatting', '@Shroud'), 'channel:shroud:just-chatting');
  assert.equal(Core.ruleId('Just Chatting', '/directory'), null);
});

test('old state migrates rules independently of malformed snoozes and preserves valid saved data', () => {
  const original = entry('shroud');
  const migrated = Core.normalizeState({ schema: 1, revision: 42, snoozes: { shroud: original } }, now);
  assert.deepEqual(migrated.rules, {});
  assert.deepEqual(migrated.snoozes.shroud, original);
  const categoryRule = rule('Just Chatting');
  const repaired = Core.normalizeState({ schema: 1, snoozes: [], rules: { [categoryRule.id]: categoryRule } }, now);
  assert.deepEqual(repaired.snoozes, {});
  assert.deepEqual(repaired.rules[categoryRule.id], categoryRule);
});

test('rule normalization prunes malformed identities and safely deduplicates global exceptions', () => {
  const global = rule('Just Chatting', null, { ignored: 'remove', exceptions: [
    { login: '__proto__', displayName: '  Prototype\n' }, { login: 'CONSTRUCTOR' },
    { login: '__proto__', displayName: 'duplicate' }, { login: '/directory' }, null
  ] });
  const channel = rule('Counter-Strike', 'constructor', { exceptions: [{ login: 'shroud' }] });
  const rules = Object.fromEntries([
    [global.id, global], [channel.id, channel],
    ['__proto__', global], ['constructor', global],
    ['category:invalid-token', rule('Invalid Token', null, { token: '' })],
    ['category:mismatch', rule('Mismatch', null, { id: 'category:wrong' })],
    ['channel:directory:games', rule('Games', null, { id: 'channel:directory:games', login: 'directory' })]
  ]);
  const state = Core.normalizeState({ schema: 1, rules }, now);
  assert.deepEqual(Object.keys(state.rules), [global.id, channel.id]);
  assert.equal(Object.getPrototypeOf(state.rules), Object.prototype);
  assert.deepEqual(state.rules[global.id].exceptions, [
    { login: '__proto__', displayName: 'Prototype' }, { login: 'constructor', displayName: 'constructor' }
  ]);
  assert.deepEqual(state.rules[channel.id].exceptions, []);
  assert.equal(Object.hasOwn(state.rules[global.id], 'ignored'), false);
});

test('global and streamer rules combine with timed snoozes, react to category changes, and skip unknown categories', () => {
  const global = rule('Just Chatting');
  const channel = rule('Just Chatting', 'shroud');
  const state = Core.normalizeState({ schema: 1, snoozes: { shroud: entry('shroud') }, rules: {
    [global.id]: global, [channel.id]: channel
  } }, now);
  const info = { login: 'Shroud', category: Core.normalizeCategory('Just Chatting') };
  assert.deepEqual(Core.hiddenReasons(state, info, now).map(reason => reason.type), ['snooze', 'rule', 'rule']);
  assert.equal(Core.hiddenReasons(state, { ...info, category: 'VALORANT' }, now).length, 1);
  assert.equal(Core.hiddenReasons(state, { ...info, category: null }, now).length, 1);
  assert.equal(Core.hiddenReasons(state, info, now + 86400000).length, 2);
  assert.equal(Core.hiddenReasons(state, { login: 'lirik', category: 'Just Chatting' }, now).length, 1);
  assert.deepEqual(Core.hiddenReasons(state, { login: 'constructor', category: null }, now), []);
  assert.deepEqual(Core.hiddenReasons(state, null, now), []);
});

test('global exceptions do not suppress an explicit streamer rule or timed snooze', () => {
  const global = rule('Just Chatting', null, { exceptions: [{ login: 'shroud', displayName: 'Shroud' }] });
  const channel = rule('Just Chatting', 'shroud');
  const state = Core.normalizeState({ schema: 1, snoozes: { shroud: entry('shroud') }, rules: {
    [global.id]: global, [channel.id]: channel
  } }, now);
  assert.deepEqual(Core.hiddenReasons(state, { login: 'shroud', category: 'Just Chatting' }, now).map(reason => reason.type), ['snooze', 'rule']);
  delete state.snoozes.shroud;
  delete state.rules[channel.id];
  assert.deepEqual(Core.hiddenReasons(state, { login: 'shroud', category: 'Just Chatting' }, now), []);
});

test('worker persists both category scopes, preserves exceptions on duplicate saves, and counts rules in badge', async () => {
  const w = worker();
  const first = await w.message({ type: 'TSNOOZE_RULE_SET', category: 'Just Chatting' });
  const id = 'category:just-chatting';
  assert.equal(first.ok, true);
  assert.equal(first.state.rules[id].login, null);
  assert.equal(w.badges.at(-1), '1');
  assert.equal(w.alarms.size, 0);
  await w.message({ type: 'TSNOOZE_RULE_EXCEPTION', id, login: '__proto__', displayName: 'Prototype', allow: true });
  const duplicate = await w.message({ type: 'TSNOOZE_RULE_SET', category: 'JUST CHATTING' });
  assert.equal(Object.keys(duplicate.state.rules).length, 1);
  assert.deepEqual(duplicate.state.rules[id].exceptions, [{ login: '__proto__', displayName: 'Prototype' }]);
  assert.equal(duplicate.state.rules[id].createdAt, first.state.rules[id].createdAt);
  assert.notEqual(duplicate.state.rules[id].token, first.state.rules[id].token);
  const scoped = await w.message({ type: 'TSNOOZE_RULE_SET', category: 'Just Chatting', login: 'constructor', displayName: 'Constructor' });
  assert.equal(scoped.state.rules['channel:constructor:just-chatting'].login, 'constructor');
  await w.message({ type: 'TSNOOZE_SET', login: 'shroud', duration: 'day' });
  assert.equal(w.badges.at(-1), '3');
  assert.equal(w.alarms.get('twitch-snooze-expiry').when, now + 86400000);
  w.clock.now = now + 86400000;
  w.alarmEvent.fire({ name: 'twitch-snooze-expiry' });
  const expired = await w.message({ type: 'TSNOOZE_GET' });
  assert.deepEqual(expired.state.snoozes, {});
  assert.equal(Object.keys(expired.state.rules).length, 2);
  assert.equal(w.badges.at(-1), '2');
});

test('worker validates rule actions and removing an exception makes the category apply again', async () => {
  const w = worker();
  await w.message({ type: 'TSNOOZE_RULE_SET', category: 'Just Chatting' });
  const id = 'category:just-chatting';
  await w.message({ type: 'TSNOOZE_RULE_EXCEPTION', id, login: 'shroud', allow: true });
  const hiddenAgain = await w.message({ type: 'TSNOOZE_RULE_EXCEPTION', id, login: 'shroud', allow: false });
  assert.deepEqual(hiddenAgain.state.rules[id].exceptions, []);
  const sets = w.sets;
  for (const request of [
    { type: 'TSNOOZE_RULE_SET', category: '!!!' },
    { type: 'TSNOOZE_RULE_SET', category: 'Just Chatting', login: 'directory' },
    { type: 'TSNOOZE_RULE_REMOVE', id: '__proto__' },
    { type: 'TSNOOZE_RULE_EXCEPTION', id, login: 'shroud', allow: 'yes' },
    { type: 'TSNOOZE_RULE_EXCEPTION', id: 'constructor', login: 'shroud', allow: true },
    { type: 'TSNOOZE_SHOW_CHANNEL', login: 'shroud', categories: 'Just Chatting' }
  ]) assert.equal((await w.message(request)).ok, false);
  assert.equal(w.sets, sets);
  const removed = await w.message({ type: 'TSNOOZE_RULE_REMOVE', id });
  assert.deepEqual(removed.state.rules, {});
  assert.equal(w.badges.at(-1), '');
});

test('atomic Show channel clears every overlapping channel rule and adds relevant global exceptions only', async () => {
  const w = worker();
  for (const category of ['Just Chatting', 'VALORANT', 'Minecraft']) {
    await w.message({ type: 'TSNOOZE_RULE_SET', category });
  }
  await w.message({ type: 'TSNOOZE_RULE_SET', category: 'Just Chatting', login: 'shroud' });
  await w.message({ type: 'TSNOOZE_RULE_SET', category: 'Minecraft', login: 'shroud' });
  await w.message({ type: 'TSNOOZE_RULE_SET', category: 'Just Chatting', login: 'lirik' });
  const snoozed = await w.message({ type: 'TSNOOZE_SET', login: 'shroud', duration: 'day' });
  const result = await w.message({ type: 'TSNOOZE_SHOW_CHANNEL', login: 'shroud', displayName: 'Shroud', categories: ['Just Chatting', 'VALORANT'] });
  assert.equal(result.ok, true);
  assert.equal(Object.hasOwn(result, 'undo'), false);
  assert.deepEqual(result.state.snoozes, {});
  assert.deepEqual(result.state.undoMarkers, {});
  assert.equal(Object.values(result.state.rules).filter(item => item.login === 'shroud').length, 0);
  assert.ok(result.state.rules['channel:lirik:just-chatting']);
  assert.deepEqual(result.state.rules['category:just-chatting'].exceptions, [{ login: 'shroud', displayName: 'Shroud' }]);
  assert.deepEqual(result.state.rules['category:valorant'].exceptions, [{ login: 'shroud', displayName: 'Shroud' }]);
  assert.deepEqual(result.state.rules['category:minecraft'].exceptions, []);
  assert.equal((await w.message({ type: 'TSNOOZE_UNDO', undo: snoozed.undo })).ok, false);
  const sets = w.sets;
  assert.equal((await w.message({ type: 'TSNOOZE_SHOW_CHANNEL', login: 'shroud', categories: ['Just Chatting'] })).ok, true);
  assert.equal(w.sets, sets);
});

test('Show channel retains normal Restore Undo when only the timed snooze changes', async () => {
  const w = worker();
  await w.message({ type: 'TSNOOZE_SET', login: '__proto__', duration: 'day' });
  const restored = await w.message({ type: 'TSNOOZE_SHOW_CHANNEL', login: '__proto__', categories: [] });
  assert.equal(restored.ok, true);
  assert.equal(restored.undo.expectedToken, null);
  const undone = await w.message({ type: 'TSNOOZE_UNDO', undo: restored.undo });
  assert.equal(undone.ok, true);
  assert.equal(Object.hasOwn(undone.state.snoozes, '__proto__'), true);
});

test('overview registers only Twitch tabs and stores no observed browsing content in local or session storage', async () => {
  const w = worker();
  await w.message({ type: 'TSNOOZE_GET' });
  const sender = { id: w.runtime.id, tab: { id: 7 }, url: 'https://www.twitch.tv/directory/following' };
  assert.equal((await w.message({ type: 'TSNOOZE_REGISTER' }, sender)).ok, true);
  assert.equal((await w.message({ type: 'TSNOOZE_REGISTER' }, sender)).ok, true);
  assert.deepEqual(w.sessionStorage, { twitchSnoozeTabs: [7] });
  for (const bad of [
    { id: w.runtime.id },
    { id: w.runtime.id, tab: { id: 8 }, url: 'https://evil.test/' },
    { id: w.runtime.id, tab: { id: 8 }, url: 'http://www.twitch.tv/' },
    { id: w.runtime.id, tab: { id: -1 }, url: 'https://www.twitch.tv/' }
  ]) assert.equal((await w.message({ type: 'TSNOOZE_REGISTER' }, bad)).ok, false);
  w.snapshots.set(7, { items: [{ login: 'shroud', displayName: 'Shroud', category: 'Just Chatting', title: 'Never retain this title' }] });
  const snapshot = await w.message({ type: 'TSNOOZE_OVERVIEW' });
  assert.deepEqual(snapshot.observations, [{ login: 'shroud', displayName: 'Shroud', category: { key: 'just-chatting', name: 'Just Chatting' } }]);
  assert.deepEqual(Object.keys(w.storage), [Core.STORAGE_KEY]);
  assert.deepEqual(w.storage[Core.STORAGE_KEY].snoozes, {});
  assert.deepEqual(w.storage[Core.STORAGE_KEY].rules, {});
  assert.deepEqual(w.sessionStorage, { twitchSnoozeTabs: [7] });
});

test('overview deduplicates fresh snapshots, sanitizes inputs, and prunes closed tabs across worker restarts', async () => {
  const sessionStorage = { twitchSnoozeTabs: [1, 2, 3, 4, 1, -1, '5'] };
  const snapshots = new Map([
    [1, { items: [
      { login: '@SHROUD', displayName: ' Shroud\n', category: 'Just Chatting', ignored: 'discard' },
      { login: 'directory', category: 'Just Chatting' }, null,
      { login: '__proto__', category: null }
    ] }],
    [2, { items: [
      { login: 'shroud', category: { key: 'just-chatting' } },
      { login: 'shroud', category: 'Minecraft' },
      { login: 'lirik', category: '!!!' }
    ] }],
    [4, { wrong: 'shape' }]
  ]);
  const w = worker({ sessionStorage, snapshots });
  const result = await w.message({ type: 'TSNOOZE_OVERVIEW' });
  assert.equal(result.ok, true);
  assert.equal(result.observations.length, 4);
  assert.deepEqual(result.observations[0], { login: 'shroud', displayName: 'Shroud', category: { key: 'just-chatting', name: 'Just Chatting' } });
  assert.equal(result.observations.filter(item => item.login === 'shroud').length, 2);
  assert.deepEqual(sessionStorage, { twitchSnoozeTabs: [1, 2] });
  assert.deepEqual(w.tabMessages.map(call => call.id), [1, 2, 3, 4]);
  assert.ok(w.tabMessages.every(call => call.payload.type === 'TSNOOZE_SNAPSHOT'));
  snapshots.set(1, { items: [{ login: 'shroud', category: 'Minecraft' }] });
  snapshots.delete(2);
  const restarted = worker({ storage: w.storage, sessionStorage, snapshots });
  const fresh = await restarted.message({ type: 'TSNOOZE_OVERVIEW' });
  assert.equal(fresh.observations.length, 1);
  assert.equal(fresh.observations[0].category.key, 'minecraft');
  assert.deepEqual(sessionStorage, { twitchSnoozeTabs: [1] });
});

test('a stalled snapshot times out without blocking writes or forgetting a suspended Twitch tab', async () => {
  let snapshotStarted;
  const started = new Promise(resolve => { snapshotStarted = resolve; });
  const w = worker({ sessionStorage: { twitchSnoozeTabs: [7] }, snapshots: new Map([
    [7, () => { snapshotStarted(); return new Promise(() => {}); }]
  ]) });
  await w.message({ type: 'TSNOOZE_GET' });
  let overviewFinished = false;
  const pendingOverview = w.message({ type: 'TSNOOZE_OVERVIEW' }).then(result => { overviewFinished = true; return result; });
  await started;
  const saved = await w.message({ type: 'TSNOOZE_RULE_SET', category: 'Just Chatting' });
  assert.equal(saved.ok, true);
  assert.equal(overviewFinished, false, 'category saves must finish without waiting for the snapshot timeout');
  const result = await pendingOverview;
  assert.equal(result.ok, true);
  assert.deepEqual(result.observations, []);
  assert.deepEqual(w.sessionStorage.twitchSnoozeTabs, [7]);
  w.snapshots.set(7, { items: [{ login: 'shroud', category: 'Just Chatting' }] });
  assert.equal((await w.message({ type: 'TSNOOZE_OVERVIEW' })).observations.length, 1);
});

test('overview failure pruning preserves concurrent registrations including the same tab reloading', async () => {
  let rejectOldSnapshot;
  let snapshotStarted;
  const started = new Promise(resolve => { snapshotStarted = resolve; });
  const w = worker({ sessionStorage: { twitchSnoozeTabs: [7, 8] }, snapshots: new Map([
    [7, () => { snapshotStarted(); return new Promise((resolve, reject) => { rejectOldSnapshot = reject; }); }]
  ]) });
  const pending = w.message({ type: 'TSNOOZE_OVERVIEW' });
  await started;
  for (const id of [7, 9]) {
    assert.equal((await w.message({ type: 'TSNOOZE_REGISTER' }, {
      id: w.runtime.id, tab: { id }, url: 'https://www.twitch.tv/directory/all'
    })).ok, true);
  }
  rejectOldSnapshot(new Error('Old page navigated away'));
  assert.equal((await pending).ok, true);
  assert.deepEqual(w.sessionStorage.twitchSnoozeTabs, [7, 9]);
});

test('whitelist migration preserves every existing snooze, category rule, and exception', async () => {
  const global = rule('Just Chatting', null, { exceptions: [{ login: 'lirik', displayName: 'Lirik' }] });
  const channel = rule('Minecraft', 'shroud');
  const legacy = { schema: 1, revision: 71, snoozes: { shroud: entry('shroud') }, undoMarkers: {}, rules: {
    [global.id]: global, [channel.id]: channel
  } };
  const w = worker({ storage: { [Core.STORAGE_KEY]: legacy } });
  const result = await w.message({ type: 'TSNOOZE_GET' });
  assert.equal(result.state.revision, 72);
  assert.deepEqual(result.state.snoozes, legacy.snoozes);
  assert.deepEqual(result.state.rules, legacy.rules);
  assert.deepEqual(result.state.whitelist, {});
  assert.equal(w.badges.at(-1), '3');
});

test('whitelist validation is independent, strips unknown fields, and rejects invalid records', () => {
  const record = { login: 'shroud', displayName: '  Shroud\n', createdAt: now, ignored: 'remove' };
  const whitelist = {
    shroud: record,
    wrong: { ...record },
    directory: { ...record, login: 'directory' },
    future: { ...record, login: 'future', createdAt: now + 1 },
    badtime: { ...record, login: 'badtime', createdAt: 'today' },
    array: [],
    absent: null
  };
  const state = Core.normalizeState({ schema: 1, snoozes: [], rules: null, whitelist }, now);
  assert.deepEqual(state.whitelist, { shroud: { login: 'shroud', displayName: 'Shroud', createdAt: now } });
  assert.deepEqual(state.snoozes, {});
  assert.deepEqual(state.rules, {});
  for (const malformed of [[], null, 'shroud', 3]) {
    assert.deepEqual(Core.normalizeState({ schema: 1, whitelist: malformed }, now).whitelist, {});
  }
});

test('Always show overrides every hiding reason and removing it resumes saved unexpired rules', async () => {
  const w = worker();
  const snoozed = await w.message({ type: 'TSNOOZE_SET', login: 'shroud', duration: 'week' });
  await w.message({ type: 'TSNOOZE_RULE_SET', category: 'Just Chatting', login: 'shroud' });
  const before = await w.message({ type: 'TSNOOZE_RULE_SET', category: 'Just Chatting' });
  assert.equal(w.badges.at(-1), '3');
  const shown = await w.message({ type: 'TSNOOZE_WHITELIST_SET', login: '@SHROUD', displayName: ' Shroud\n' });
  assert.equal(shown.ok, true);
  assert.deepEqual(shown.state.whitelist.shroud, { login: 'shroud', displayName: 'Shroud', createdAt: now });
  assert.deepEqual(shown.state.snoozes.shroud, snoozed.state.snoozes.shroud);
  assert.deepEqual(shown.state.rules, before.state.rules);
  for (const category of ['Just Chatting', 'Minecraft', null]) {
    assert.deepEqual(Core.hiddenReasons(shown.state, { login: 'shroud', category }, now), []);
  }
  assert.equal(Core.hiddenReasons(shown.state, { login: 'lirik', category: 'Just Chatting' }, now).length, 1);
  assert.equal(w.badges.at(-1), '1', 'global category remains counted while dormant streamer rules do not');
  assert.equal(w.alarms.get('twitch-snooze-expiry').when, snoozed.state.snoozes.shroud.until);
  const removed = await w.message({ type: 'TSNOOZE_WHITELIST_REMOVE', login: 'https://www.twitch.tv/shroud' });
  assert.deepEqual(removed.state.whitelist, {});
  assert.deepEqual(Core.hiddenReasons(removed.state, { login: 'shroud', category: 'Just Chatting' }, now).map(reason => reason.type), ['snooze', 'rule', 'rule']);
  assert.equal(w.badges.at(-1), '3');
});

test('dormant snoozes still expire on schedule without removing Always show or reviving on removal', async () => {
  const w = worker();
  await w.message({ type: 'TSNOOZE_SET', login: 'shroud', duration: 'day' });
  await w.message({ type: 'TSNOOZE_WHITELIST_SET', login: 'shroud' });
  assert.equal(w.badges.at(-1), '');
  assert.equal(w.alarms.get('twitch-snooze-expiry').when, now + 86400000);
  w.clock.now = now + 86400000;
  w.alarmEvent.fire({ name: 'twitch-snooze-expiry' });
  const expired = await w.message({ type: 'TSNOOZE_GET' });
  assert.deepEqual(expired.state.snoozes, {});
  assert.equal(Core.isWhitelisted(expired.state, 'shroud'), true);
  assert.equal(w.alarms.size, 0);
  const removed = await w.message({ type: 'TSNOOZE_WHITELIST_REMOVE', login: 'shroud' });
  assert.deepEqual(Core.hiddenReasons(removed.state, { login: 'shroud', category: 'Just Chatting' }, w.clock.now), []);
  assert.deepEqual(removed.state.snoozes, {});
});

test('Always show persists across worker restart and storage clear removes it authoritatively', async () => {
  const w = worker();
  await w.message({ type: 'TSNOOZE_WHITELIST_SET', login: 'shroud', displayName: 'Shroud' });
  const restarted = worker({ storage: w.storage });
  const persisted = await restarted.message({ type: 'TSNOOZE_GET' });
  assert.deepEqual(persisted.state.whitelist.shroud, { login: 'shroud', displayName: 'Shroud', createdAt: now });
  delete restarted.storage[Core.STORAGE_KEY];
  const cleared = await restarted.message({ type: 'TSNOOZE_GET' });
  assert.equal(Core.isWhitelisted(cleared.state, 'shroud'), false);
  assert.deepEqual(cleared.state.whitelist, {});
  assert.equal(cleared.state.revision, 1);
});

test('whitelisted prototype-name channels use own properties without hiding unrelated streamers', async () => {
  const w = worker();
  await w.message({ type: 'TSNOOZE_RULE_SET', category: 'Just Chatting' });
  assert.equal(Core.isWhitelisted({ whitelist: {} }, 'constructor'), false);
  assert.equal(Core.isWhitelisted({ whitelist: {} }, '__proto__'), false);
  assert.equal(Core.isWhitelisted(null, 'shroud'), false);
  for (const login of ['constructor', '__proto__']) {
    const saved = await w.message({ type: 'TSNOOZE_WHITELIST_SET', login });
    assert.equal(saved.ok, true);
    const normalized = Core.normalizeState(saved.state, now);
    assert.equal(Object.getPrototypeOf(normalized.whitelist), Object.prototype);
    assert.equal(Object.hasOwn(normalized.whitelist, login), true);
    assert.equal(Core.isWhitelisted(normalized, login), true);
    assert.deepEqual(Core.hiddenReasons(normalized, { login, category: 'Just Chatting' }, now), []);
    assert.equal(Core.hiddenReasons(normalized, { login: 'shroud', category: 'Just Chatting' }, now).length, 1);
    const removed = await w.message({ type: 'TSNOOZE_WHITELIST_REMOVE', login });
    assert.equal(Object.hasOwn(removed.state.whitelist, login), false);
    assert.equal(Core.hiddenReasons(removed.state, { login, category: 'Just Chatting' }, now).length, 1);
  }
});

test('Always show mutations sanitize names, preserve identity, and avoid duplicate writes', async () => {
  const w = worker();
  const first = await w.message({ type: 'TSNOOZE_WHITELIST_SET', login: '@SHROUD', displayName: ' Shroud\u0000 ' });
  assert.deepEqual(first.state.whitelist.shroud, { login: 'shroud', displayName: 'Shroud', createdAt: now });
  let sets = w.sets;
  w.clock.now += 1000;
  const duplicate = await w.message({ type: 'TSNOOZE_WHITELIST_SET', login: 'shroud' });
  assert.equal(w.sets, sets);
  assert.deepEqual(duplicate.state.whitelist.shroud, first.state.whitelist.shroud);
  const renamed = await w.message({ type: 'TSNOOZE_WHITELIST_SET', login: 'shroud', displayName: 'New name' });
  assert.deepEqual(renamed.state.whitelist.shroud, { login: 'shroud', displayName: 'New name', createdAt: now });
  await w.message({ type: 'TSNOOZE_WHITELIST_REMOVE', login: 'shroud' });
  sets = w.sets;
  const absent = await w.message({ type: 'TSNOOZE_WHITELIST_REMOVE', login: 'shroud' });
  assert.equal(absent.ok, true);
  assert.deepEqual(absent.state.whitelist, {});
  assert.equal(w.sets, sets);
});

test('Always show validates logins and rejects new direct hiding rules with a helpful message', async () => {
  const w = worker();
  await w.message({ type: 'TSNOOZE_WHITELIST_SET', login: 'shroud' });
  const sets = w.sets;
  for (const type of ['TSNOOZE_WHITELIST_SET', 'TSNOOZE_WHITELIST_REMOVE']) {
    for (const login of ['directory', 'https://evil.test/shroud', '', null, {}]) {
      const invalid = await w.message({ type, login });
      assert.equal(invalid.ok, false);
      assert.match(invalid.error, /valid Twitch channel/);
    }
  }
  for (const request of [
    { type: 'TSNOOZE_SET', login: 'shroud', duration: 'day' },
    { type: 'TSNOOZE_RULE_SET', login: 'shroud', category: 'Just Chatting' }
  ]) {
    const rejected = await w.message(request);
    assert.equal(rejected.ok, false);
    assert.equal(rejected.error, 'Remove this streamer from the whitelist before hiding them.');
  }
  assert.equal(w.sets, sets, 'invalid and blocked requests must not save changes');
  const global = await w.message({ type: 'TSNOOZE_RULE_SET', category: 'Just Chatting' });
  assert.equal(global.ok, true);
  assert.equal(Core.hiddenReasons(global.state, { login: 'shroud', category: 'Just Chatting' }, now).length, 0);
  assert.equal(Core.hiddenReasons(global.state, { login: 'lirik', category: 'Just Chatting' }, now).length, 1);
});

test('whitelist writes serialize with other changes and failed writes leave stored rules intact', async () => {
  const w = worker({ delay: 2 });
  await w.message({ type: 'TSNOOZE_GET' });
  const simultaneous = await Promise.all([
    w.message({ type: 'TSNOOZE_WHITELIST_SET', login: 'shroud' }),
    w.message({ type: 'TSNOOZE_WHITELIST_SET', login: 'lirik' }),
    w.message({ type: 'TSNOOZE_RULE_SET', category: 'Just Chatting' })
  ]);
  assert.ok(simultaneous.every(result => result.ok));
  let latest = await w.message({ type: 'TSNOOZE_GET' });
  assert.deepEqual(Object.keys(latest.state.whitelist).sort(), ['lirik', 'shroud']);
  assert.ok(latest.state.rules['category:just-chatting']);
  w.failWrite();
  const failure = await w.message({ type: 'TSNOOZE_WHITELIST_REMOVE', login: 'shroud' });
  assert.equal(failure.ok, false);
  assert.match(failure.error, /storage failure/);
  latest = await w.message({ type: 'TSNOOZE_GET' });
  assert.equal(Core.isWhitelisted(latest.state, 'shroud'), true);
  const removed = await w.message({ type: 'TSNOOZE_WHITELIST_REMOVE', login: 'shroud' });
  assert.equal(removed.ok, true);
  assert.deepEqual(Object.keys(removed.state.whitelist), ['lirik']);
  assert.ok(removed.state.rules['category:just-chatting']);
});

test('older snooze Undo cannot override Always show even when it restores a dormant snooze', async () => {
  const w = worker();
  await w.message({ type: 'TSNOOZE_SET', login: 'shroud', duration: 'day' });
  const restored = await w.message({ type: 'TSNOOZE_RESTORE', login: 'shroud' });
  await w.message({ type: 'TSNOOZE_WHITELIST_SET', login: 'shroud' });
  const undone = await w.message({ type: 'TSNOOZE_UNDO', undo: restored.undo });
  assert.equal(undone.ok, true);
  assert.ok(undone.state.snoozes.shroud);
  assert.equal(Core.isWhitelisted(undone.state, 'shroud'), true);
  assert.deepEqual(Core.hiddenReasons(undone.state, { login: 'shroud' }, now), []);
  assert.equal(w.badges.at(-1), '');
});

test('reordered Chromium storage keys do not turn reads or repeated Always show saves into writes', async () => {
  const w = worker({ reorderStorageKeys: true });
  await w.message({ type: 'TSNOOZE_SET', login: 'shroud', duration: 'week' });
  await w.message({ type: 'TSNOOZE_RULE_SET', login: 'shroud', category: 'Minecraft' });
  await w.message({ type: 'TSNOOZE_RULE_SET', category: 'Just Chatting' });
  await w.message({ type: 'TSNOOZE_RULE_EXCEPTION', id: 'category:just-chatting', login: '__proto__', displayName: 'Prototype', allow: true });
  const initial = await w.message({ type: 'TSNOOZE_WHITELIST_SET', login: 'shroud', displayName: 'Shroud' });
  const sets = w.sets;
  for (const request of [
    { type: 'TSNOOZE_GET' },
    { type: 'TSNOOZE_WHITELIST_SET', login: 'shroud' },
    { type: 'TSNOOZE_WHITELIST_SET', login: '@SHROUD', displayName: 'Shroud' },
    { type: 'TSNOOZE_WHITELIST_REMOVE', login: 'lirik' },
    { type: 'TSNOOZE_GET' }
  ]) {
    const result = await w.message(request);
    assert.equal(result.ok, true);
    assert.deepEqual(result.state, initial.state);
    assert.equal(w.sets, sets);
  }
  const restarted = worker({ storage: w.storage, reorderStorageKeys: true });
  assert.deepEqual((await restarted.message({ type: 'TSNOOZE_GET' })).state, initial.state);
  assert.equal(restarted.sets, 0);
});

test('key-order-independent reads still persist migrations and remove invalid fields exactly once', async () => {
  const global = rule('Just Chatting', null, { exceptions: [{ login: 'lirik', displayName: 'Lirik' }] });
  const raw = {
    schema: 1, revision: 55, snoozes: { shroud: entry('shroud', { ignored: 'remove' }) },
    rules: { [global.id]: global }, ignored: 'remove'
  };
  const w = worker({ storage: { [Core.STORAGE_KEY]: raw }, reorderStorageKeys: true });
  const normalized = await w.message({ type: 'TSNOOZE_GET' });
  assert.equal(normalized.state.revision, 56);
  assert.deepEqual(normalized.state.whitelist, {});
  assert.deepEqual(normalized.state.undoMarkers, {});
  assert.deepEqual(normalized.state.snoozes.shroud, entry('shroud'));
  assert.deepEqual(normalized.state.rules[global.id], global);
  assert.equal(Object.hasOwn(w.storage[Core.STORAGE_KEY], 'ignored'), false);
  assert.equal(w.sets, 1);
  assert.deepEqual((await w.message({ type: 'TSNOOZE_GET' })).state, normalized.state);
  assert.equal(w.sets, 1);
});

test('key-order-independent reads still persist expiry pruning without redundant writes', async () => {
  const w = worker({ reorderStorageKeys: true });
  const saved = await w.message({ type: 'TSNOOZE_SET', login: 'shroud', duration: 'day' });
  const sets = w.sets;
  w.clock.now = saved.state.snoozes.shroud.until;
  w.alarmEvent.fire({ name: 'twitch-snooze-expiry' });
  const expired = await w.message({ type: 'TSNOOZE_GET' });
  assert.equal(expired.state.revision, saved.state.revision + 1);
  assert.deepEqual(expired.state.snoozes, {});
  assert.equal(w.sets, sets + 1);
  assert.equal(w.alarms.size, 0);
  assert.deepEqual((await w.message({ type: 'TSNOOZE_GET' })).state, expired.state);
  assert.equal(w.sets, sets + 1);
});
