import FDBFactory from 'fake-indexeddb/lib/FDBFactory';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const START = '2026-09-21T00:00:00.000Z';
const EXPIRES = '2026-10-26T00:00:00.000Z';
const BUSINESS = ['ingredients', 'inventoryQuantities', 'mealPlans', 'menuDecisions', 'shoppingEntries', 'inventoryEvents'];
let factory;
let connections;

function active(scope = 'guest', changes = {}) {
  return { id: 'session', schemaVersion: 1, scope, status: 'active', version: 'a'.repeat(32),
    startedAt: START, expiresAt: EXPIRES, events: ['private payload'], subjectId: 'private alias', ...changes };
}

function name(scope) { return `fridgemate-db__${scope.replace(':', '_')}`; }

function open(databaseName, version, upgrade) {
  return new Promise((resolve, reject) => {
    const request = version === undefined ? factory.open(databaseName) : factory.open(databaseName, version);
    request.onupgradeneeded = () => upgrade?.(request.result);
    request.onsuccess = () => { connections.push(request.result); resolve(request.result); };
    request.onerror = () => reject(request.error);
  });
}

async function seed(scope, row = active(scope), { version = 7, databaseName = name(scope), extras = [] } = {}) {
  const db = await open(databaseName, version, database => {
    for (const storeName of BUSINESS) {
      const store = database.createObjectStore(storeName, { keyPath: storeName === 'menuDecisions' ? 'decisionDate' : 'id' });
      if (storeName === 'inventoryEvents') store.createIndex('purchaseNoteId', 'purchaseNoteId', { unique: true });
    }
    if (version === 7) database.createObjectStore('mealPlanPilot', { keyPath: 'id' });
  });
  const names = [...BUSINESS, ...(version === 7 ? ['mealPlanPilot'] : [])];
  await new Promise((resolve, reject) => {
    const transaction = db.transaction(names, 'readwrite');
    BUSINESS.forEach(storeName => transaction.objectStore(storeName).put(storeName === 'menuDecisions'
      ? { decisionDate: '2026-09-21', private: storeName } : { id: 'keep', private: storeName }));
    if (version === 7) [row, ...extras].filter(Boolean).forEach(item => transaction.objectStore('mealPlanPilot').put(item));
    transaction.oncomplete = resolve;
    transaction.onabort = () => reject(transaction.error);
  });
  db.close();
  return databaseName;
}

async function snapshot(databaseName) {
  const db = await open(databaseName);
  try {
    const names = [...db.objectStoreNames];
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction(names, 'readonly');
      const requests = names.map(storeName => transaction.objectStore(storeName).getAll());
      transaction.oncomplete = () => resolve({ version: db.version,
        stores: Object.fromEntries(names.map((storeName, i) => [storeName, requests[i].result])) });
      transaction.onabort = () => reject(transaction.error);
    });
  } finally { db.close(); }
}

async function purge() {
  const modules = import.meta.glob('../mealPlanPilotRetention.js');
  expect(modules['../mealPlanPilotRetention.js'], 'retention cleanup module must exist').toBeTypeOf('function');
  const module = await modules['../mealPlanPilotRetention.js']();
  expect(module.purgeExpiredMealPlanPilots).toBeTypeOf('function');
  return module.purgeExpiredMealPlanPilots();
}

describe('private meal plan pilot startup retention', () => {
  beforeEach(() => {
    factory = new FDBFactory(); connections = [];
    Object.defineProperty(window, 'indexedDB', { configurable: true, value: factory });
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(EXPIRES));
  });
  afterEach(() => {
    vi.restoreAllMocks(); connections.forEach(db => db.close()); vi.useRealTimers();
  });

  it('expires guest and another account without changing the current active account or any business records', async () => {
    const guestName = await seed('guest');
    const aliceName = await seed('user:alice');
    const bobName = await seed('user:bob', active('user:bob', {
      startedAt: '2026-09-22T00:00:00.000Z', expiresAt: '2026-10-27T00:00:00.000Z',
    }));
    const before = await Promise.all([guestName, aliceName, bobName].map(snapshot));
    expect(await purge()).toEqual({ supported: true, checkedScopes: 3, expiredScopes: 2, failedScopes: 0 });
    const after = await Promise.all([guestName, aliceName, bobName].map(snapshot));
    for (const [index, scope] of ['guest', 'user:alice'].entries()) {
      const row = after[index].stores.mealPlanPilot[0];
      expect(after[index].stores.mealPlanPilot).toHaveLength(1);
      expect(row).toEqual({ id: 'session', schemaVersion: 1, scope, status: 'expired', version: expect.stringMatching(/^[a-f0-9]{32}$/) });
      expect(row.version).not.toBe('a'.repeat(32));
      BUSINESS.forEach(storeName => expect(after[index].stores[storeName]).toStrictEqual(before[index].stores[storeName]));
    }
    expect(after[2]).toStrictEqual(before[2]);
  });

  it('keeps the session one millisecond before 35 days and expires exactly at the boundary', async () => {
    const dbName = await seed('guest');
    const before = await snapshot(dbName);
    vi.setSystemTime(new Date('2026-10-25T23:59:59.999Z'));
    expect(await purge()).toEqual({ supported: true, checkedScopes: 1, expiredScopes: 0, failedScopes: 0 });
    expect(await snapshot(dbName)).toStrictEqual(before);
    vi.setSystemTime(new Date(EXPIRES));
    expect((await purge()).expiredScopes).toBe(1);
  });

  it('checks time when the session read succeeds, not when enumeration started', async () => {
    await seed('guest');
    vi.setSystemTime(new Date('2026-10-25T23:59:59.999Z'));
    const database = await open(name('guest'));
    const prototype = Object.getPrototypeOf(database.transaction('mealPlanPilot').objectStore('mealPlanPilot'));
    const get = prototype.get;
    vi.spyOn(prototype, 'get').mockImplementation(function (...args) {
      const request = get.apply(this, args);
      if (this.name === 'mealPlanPilot') request.addEventListener('success', () => vi.setSystemTime(new Date(EXPIRES)));
      return request;
    });
    expect((await purge()).expiredScopes).toBe(1);
  });

  it('deletes damaged expired payload and extra rows based only on the valid expiration header', async () => {
    const dbName = await seed('guest', active('guest', { events: null, privateUnknown: { unhealthy: 'private' } }), {
      extras: [{ id: 'unexpected', corrupt: 'private data' }],
    });
    expect((await purge()).expiredScopes).toBe(1);
    expect((await snapshot(dbName)).stores.mealPlanPilot).toEqual([
      { id: 'session', schemaVersion: 1, scope: 'guest', status: 'expired', version: expect.any(String) },
    ]);
  });

  it('expires a v2 capture session and its alias/operation material without touching business stores', async () => {
    const dbName = await seed('guest', active('guest', { schemaVersion: 2,
      capture: { privateAlias: 'must expire', pending: ['private operation'] } }));
    const before = await snapshot(dbName);
    expect(await purge()).toEqual({ supported: true, checkedScopes: 1, expiredScopes: 1, failedScopes: 0 });
    const after = await snapshot(dbName);
    expect(after.stores.mealPlanPilot).toEqual([{ id: 'session', schemaVersion: 1, scope: 'guest', status: 'expired', version: expect.any(String) }]);
    BUSINESS.forEach(storeName => expect(after.stores[storeName]).toEqual(before.stores[storeName]));
  });

  it('does not upgrade a v6 database or create pilot data for it', async () => {
    const dbName = await seed('guest', null, { version: 6 });
    const before = await snapshot(dbName);
    expect(await purge()).toEqual({ supported: true, checkedScopes: 1, expiredScopes: 0, failedScopes: 0 });
    expect(await snapshot(dbName)).toStrictEqual(before);
  });

  it('never touches unrelated or ambiguous database names', async () => {
    const ignored = ['other-app', 'fridgemate-db', 'fridgemate-db__user_', 'fridgemate-db__user_alice:private', 'fridgemate-db__guest_extra'];
    for (const databaseName of ignored) await seed('guest', active(), { databaseName });
    const before = await Promise.all(ignored.map(snapshot));
    expect(await purge()).toEqual({ supported: true, checkedScopes: 0, expiredScopes: 0, failedScopes: 0 });
    expect(await Promise.all(ignored.map(snapshot))).toStrictEqual(before);
  });

  it.each([
    { schemaVersion: 3 }, { scope: 'user:other' }, { version: 'not-private-safe' }, { status: 'unknown' },
    { startedAt: '1999-09-21T00:00:00.000Z', expiresAt: '1999-10-26T00:00:00.000Z' },
    { startedAt: '2026-09-21T00:00:00Z' }, { startedAt: '2026-02-30T00:00:00.000Z' },
    { expiresAt: '2026-10-25T00:00:00.000Z' },
  ])('leaves malformed expiration header %j unchanged and returns only a failed count', async changes => {
    const dbName = await seed('guest', active('guest', changes));
    const before = await snapshot(dbName);
    expect(await purge()).toEqual({ supported: true, checkedScopes: 1, expiredScopes: 0, failedScopes: 1 });
    expect(await snapshot(dbName)).toStrictEqual(before);
  });

  it('does not grant or rotate already inactive sessions', async () => {
    const dbName = await seed('guest', { id: 'session', schemaVersion: 1, scope: 'guest', status: 'withdrawn', version: 'b'.repeat(32) });
    const before = await snapshot(dbName);
    expect((await purge()).expiredScopes).toBe(0);
    expect(await snapshot(dbName)).toStrictEqual(before);
  });

  it('rejects a v2 closed marker instead of treating it as an accepted deletion barrier', async () => {
    const dbName = await seed('guest', { id: 'session', schemaVersion: 2, scope: 'guest', status: 'withdrawn', version: 'b'.repeat(32) });
    const before = await snapshot(dbName);
    expect(await purge()).toEqual({ supported: true, checkedScopes: 1, expiredScopes: 0, failedScopes: 1 });
    expect(await snapshot(dbName)).toEqual(before);
  });

  it('rolls back clearing and the tombstone if the final write aborts, without reflecting raw errors', async () => {
    const dbName = await seed('guest', active(), { extras: [{ id: 'private-extra', raw: 'secret' }] });
    const before = await snapshot(dbName);
    const database = await open(dbName);
    const prototype = Object.getPrototypeOf(database.transaction('mealPlanPilot').objectStore('mealPlanPilot'));
    const put = prototype.put;
    vi.spyOn(prototype, 'put').mockImplementation(function (...args) {
      if (this.name === 'mealPlanPilot') throw new Error('private-error-payload');
      return put.apply(this, args);
    });
    expect(await purge()).toEqual({ supported: true, checkedScopes: 1, expiredScopes: 0, failedScopes: 1 });
    expect(await snapshot(dbName)).toStrictEqual(before);
  });

  it.each(['missing', 'throws'])('reports unsupported enumeration (%s) without opening databases', async mode => {
    await seed('guest');
    if (mode === 'missing') Object.defineProperty(factory, 'databases', { value: undefined });
    else vi.spyOn(factory, 'databases').mockRejectedValue(new Error('private-enumeration-error'));
    const opened = vi.spyOn(factory, 'open');
    expect(await purge()).toEqual({ supported: false, checkedScopes: 0, expiredScopes: 0, failedScopes: 0 });
    expect(opened).not.toHaveBeenCalled();
  });

  it('aborts opening a database deleted after enumeration instead of creating a replacement', async () => {
    const enumeration = vi.spyOn(factory, 'databases').mockResolvedValue([{ name: name('guest'), version: 7 }]);
    expect(await purge()).toEqual({ supported: true, checkedScopes: 1, expiredScopes: 0, failedScopes: 1 });
    enumeration.mockRestore();
    expect(await factory.databases()).toEqual([]);
  });

  it('stops immediately on a blocked open and closes a connection delivered later without reading it', async () => {
    const dbName = await seed('guest');
    const before = await snapshot(dbName);
    const database = await open(dbName);
    const close = vi.spyOn(database, 'close');
    const request = { result: database };
    const opened = vi.spyOn(factory, 'open').mockImplementation(() => {
      queueMicrotask(() => { request.onblocked(); queueMicrotask(() => request.onsuccess()); });
      return request;
    });
    expect(await purge()).toEqual({ supported: true, checkedScopes: 1, expiredScopes: 0, failedScopes: 1 });
    await Promise.resolve();
    expect(close).toHaveBeenCalled();
    opened.mockRestore();
    expect(await snapshot(dbName)).toStrictEqual(before);
  });

  it('bounds a stalled open and closes a late success without expiring its data', async () => {
    const dbName = await seed('guest');
    const before = await snapshot(dbName);
    const database = await open(dbName);
    const close = vi.spyOn(database, 'close');
    const request = { result: database };
    const opened = vi.spyOn(factory, 'open').mockReturnValue(request);
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    const pending = purge().then(result => ({ result }), error => ({ error }));
    await vi.advanceTimersByTimeAsync(5000);
    const outcome = await pending;
    if (outcome.error) throw outcome.error;
    expect(outcome.result).toEqual({ supported: true, checkedScopes: 1, expiredScopes: 0, failedScopes: 1 });
    request.onsuccess();
    expect(close).toHaveBeenCalled();
    opened.mockRestore();
    expect(await snapshot(dbName)).toStrictEqual(before);
  });

  it('aborts a stalled transaction at its deadline and ignores a late expired-session callback', async () => {
    const dbName = await seed('guest');
    const before = await snapshot(dbName);
    const database = await open(dbName);
    const read = { result: active() };
    const clear = vi.fn();
    const put = vi.fn();
    const transaction = { objectStore: () => ({ get: () => read, clear, put }), abort: vi.fn() };
    const deferredDatabase = { objectStoreNames: database.objectStoreNames,
      transaction: () => transaction, close: () => database.close() };
    const request = { result: deferredDatabase };
    const opened = vi.spyOn(factory, 'open').mockImplementation(() => {
      queueMicrotask(() => request.onsuccess()); return request;
    });
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    const pending = purge().then(result => ({ result }), error => ({ error }));
    await vi.advanceTimersByTimeAsync(5000);
    const outcome = await pending;
    if (outcome.error) throw outcome.error;
    expect(outcome.result).toEqual({ supported: true, checkedScopes: 1, expiredScopes: 0, failedScopes: 1 });
    expect(transaction.abort).toHaveBeenCalled();
    read.onsuccess();
    expect(clear).not.toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
    opened.mockRestore();
    expect(await snapshot(dbName)).toStrictEqual(before);
  });
});
