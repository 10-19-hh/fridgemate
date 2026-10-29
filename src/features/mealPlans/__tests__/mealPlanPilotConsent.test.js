import FDBFactory from 'fake-indexeddb/lib/FDBFactory';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const START = '2026-09-21T09:00:00.000Z';
const EXPIRES = '2026-10-26T09:00:00.000Z';
const POLICY = 'local-pilot-35d-v1';
const modules = import.meta.glob('../mealPlanPilotConsent.js');

async function api() {
  const module = modules['../mealPlanPilotConsent.js'] ? await modules['../mealPlanPilotConsent.js']() : {};
  for (const name of ['getMealPlanPilotConsent', 'grantMealPlanPilotConsent', 'withdrawMealPlanPilotConsent', 'prepareMealPlanPilotExport']) {
    expect(module[name], `${name} must enforce the real scoped consent lifecycle`).toBeTypeOf('function');
  }
  return module;
}

const grant = (module, scope = 'guest', expectedVersion = null) => module.grantMealPlanPilotConsent({
  scope, expectedVersion, policyVersion: POLICY, accepted: true,
});
const raw = async (scope = 'guest') => (await import('../../../db/indexedDB'))
  .runMealPlanPilotTransaction('readonly', store => store.getAll(), scope);
const seed = async (row, scope = 'guest') => (await import('../../../db/indexedDB'))
  .runMealPlanPilotTransaction('readwrite', store => store.put(row), scope);

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv('VITE_LOCAL_PILOT_ENABLED', 'true');
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(START));
  Object.defineProperty(window, 'indexedDB', { configurable: true, value: new FDBFactory() });
  window.localStorage.clear();
  window.sessionStorage.clear();
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.useRealTimers(); });

describe('explicit local pilot consent', () => {
  it('refuses new consent outside a dedicated pilot build without storing identifiers', async () => {
    const m = await api();
    vi.stubEnv('VITE_LOCAL_PILOT_ENABLED', 'false');
    await expect(grant(m)).rejects.toThrow();
    expect(await m.getMealPlanPilotConsent()).toEqual({ status: 'off', version: null });
    expect(await raw()).toEqual([]);
  });

  it.each(['get', 'grant'])('bounds a stalled %s open and prevents writes when its database arrives late', async operation => {
    const m = await api();
    const before = await grant(m);
    const database = await new Promise(resolve => {
      const request = window.indexedDB.open('fridgemate-db__guest');
      request.onsuccess = () => resolve(request.result);
    });
    vi.resetModules();
    const next = await api();
    const request = { result: database };
    const open = vi.spyOn(window.indexedDB, 'open').mockReturnValue(request);
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    const pending = (operation === 'get' ? next.getMealPlanPilotConsent() : grant(next)).then(
      value => ({ value }), error => ({ message: error.message }));
    await vi.advanceTimersByTimeAsync(2000);
    expect(await pending).toEqual({ message: '파일럿 설정을 확인하거나 저장하지 못했어요. 새로 확인한 뒤 다시 시도해주세요.' });
    request.onsuccess();
    open.mockRestore();
    expect(await next.getMealPlanPilotConsent()).toEqual(before);
    database.close();
  });

  it('does not grant consent for a stale UI account generation', async () => {
    const m = await api();
    await expect(m.grantMealPlanPilotConsent({ scope: 'guest', expectedVersion: null, accepted: true,
      policyVersion: POLICY }, { isCurrent: () => false })).rejects.toThrow();
    expect(await raw()).toEqual([]);
  });

  it('requires the current version for guarded withdrawal while preserving the legacy cleanup call', async () => {
    const m = await api();
    const state = await grant(m);
    await expect(m.withdrawMealPlanPilotConsent('guest', { expectedVersion: 'b'.repeat(32), isCurrent: () => true })).rejects.toThrow();
    expect((await m.getMealPlanPilotConsent()).version).toBe(state.version);
    await expect(m.withdrawMealPlanPilotConsent('guest', { expectedVersion: state.version, isCurrent: () => false })).rejects.toThrow();
    expect((await m.getMealPlanPilotConsent()).status).toBe('active');
    expect((await m.withdrawMealPlanPilotConsent('guest')).status).toBe('withdrawn');
  });

  it('does not export into a stale UI account generation', async () => {
    const m = await api();
    const state = await grant(m);
    await expect(m.prepareMealPlanPilotExport({ scope: 'guest', expectedVersion: state.version }, { isCurrent: () => false })).rejects.toThrow();
    expect((await m.getMealPlanPilotConsent()).status).toBe('active');
  });

  it('starts off without identifiers or a stored consent row, even with existing GA consent', async () => {
    const m = await api();
    window.localStorage.setItem('fridgemate-analytics-consent', 'granted');
    expect(await m.getMealPlanPilotConsent()).toEqual({ status: 'off', version: null });
    expect(await raw()).toEqual([]);
    expect(window.localStorage.getItem('fridgemate-analytics-consent')).toBe('granted');
  });

  it('stores only explicitly approved consent and fixes expiry at exactly 35 days without claiming collection', async () => {
    const m = await api();
    const state = await grant(m);
    expect(state).toEqual({ status: 'active', version: expect.stringMatching(/^[a-f0-9]{32}$/),
      policyVersion: POLICY, startedAt: START, expiresAt: EXPIRES, eventCount: 0, observedThrough: START });
    expect(await m.getMealPlanPilotConsent()).toEqual(state);
    const [stored] = await raw();
    expect(stored.subjectId).toMatch(/^sub_[a-f0-9]{32}$/);
    expect(stored.firstGenerationKnown).toBe(false);
    expect(stored.events).toEqual([]);
    expect(state).not.toHaveProperty('subjectId');
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
  });

  it.each([
    ['no approval', { accepted: false }], ['missing approval', { accepted: undefined }],
    ['truthy approval', { accepted: 'true' }], ['old policy', { policyVersion: 'old' }],
    ['missing version', { expectedVersion: undefined }], ['extra private field', { email: 'private@example.invalid' }],
  ])('refuses %s without storing any identity', async (_label, override) => {
    const m = await api();
    await expect(m.grantMealPlanPilotConsent({ scope: 'guest', expectedVersion: null,
      policyVersion: POLICY, accepted: true, ...override })).rejects.toThrow();
    expect(await raw()).toEqual([]);
  });

  it.each(['', 'user:', 'user:a/b', 'user:a:b', '../guest', {}, null])('rejects invalid scope %j before accessing guest data', async scope => {
    const m = await api();
    const before = await grant(m);
    await expect(m.getMealPlanPilotConsent(scope)).rejects.toThrow();
    await expect(m.withdrawMealPlanPilotConsent(scope)).rejects.toThrow();
    await expect(grant(m, scope)).rejects.toThrow();
    expect(await m.getMealPlanPilotConsent()).toEqual(before);
  });

  it('separates guest and two account scopes without linking their identities', async () => {
    const m = await api();
    for (const scope of ['guest', 'user:alice', 'user:bob']) await grant(m, scope);
    const rows = await Promise.all(['guest', 'user:alice', 'user:bob'].map(raw));
    expect(new Set(rows.map(([row]) => row.subjectId)).size).toBe(3);
    expect(rows.map(([row]) => row.kind)).toEqual(['guest', 'account', 'account']);
    expect(rows.map(([row]) => row.scope)).toEqual(['guest', 'user:alice', 'user:bob']);
  });

  it('allows only one competing opt-in and rejects stale or repeated grants without extending expiry', async () => {
    const m = await api();
    const results = await Promise.allSettled([grant(m), grant(m)]);
    expect(results.map(result => result.status).sort()).toEqual(['fulfilled', 'rejected']);
    const [before] = await raw();
    vi.setSystemTime(new Date('2026-09-22T09:00:00.000Z'));
    await expect(grant(m)).rejects.toThrow();
    await expect(grant(m, 'guest', before.version)).rejects.toThrow();
    expect(await raw()).toEqual([before]);
  });

  it('does not acknowledge a consent write that aborts', async () => {
    const m = await api();
    const db = await import('../../../db/indexedDB');
    // First obtain the real object-store prototype; only inject its write failure.
    await db.runMealPlanPilotTransaction('readonly', store => {
      vi.spyOn(Object.getPrototypeOf(store), 'put').mockImplementation(function () {
        this.transaction.abort();
        throw new DOMException('private storage failure', 'QuotaExceededError');
      });
    });
    await expect(grant(m)).rejects.toThrow();
    vi.restoreAllMocks();
    expect(await raw()).toEqual([]);
    expect(await m.getMealPlanPilotConsent()).toEqual({ status: 'off', version: null });
  });

  it('does not accept new consent when this browser cannot discover expired scopes on startup', async () => {
    const m = await api();
    Object.defineProperty(window.indexedDB, 'databases', { configurable: true, value: undefined });
    await expect(grant(m)).rejects.toThrow();
    expect(await raw()).toEqual([]);
  });

  it('does not reflect private provider details when access to IndexedDB is blocked during consent checks', async () => {
    const m = await api();
    const factory = window.indexedDB;
    Object.defineProperty(window, 'indexedDB', { configurable: true, get() { throw new Error('PRIVATE PROVIDER DETAIL'); } });
    await expect(grant(m)).rejects.toThrow('파일럿 설정을 확인하거나 저장하지 못했어요. 새로 확인한 뒤 다시 시도해주세요.');
    Object.defineProperty(window, 'indexedDB', { configurable: true, value: factory });
    expect(await raw()).toEqual([]);
  });
});

describe('withdrawal and session-wide expiry', () => {
  it('does not accept v2 closed markers as a valid legacy deletion barrier', async () => {
    const m = await api();
    await seed({ id: 'session', schemaVersion: 2, scope: 'guest', status: 'withdrawn', version: 'a'.repeat(32) });
    await expect(m.getMealPlanPilotConsent()).rejects.toThrow();
  });
  it('withdraws identifiers and events together while retaining only a new opaque stale-write barrier', async () => {
    const m = await api();
    const before = await grant(m);
    const other = await grant(m, 'user:other');
    const cleared = await m.withdrawMealPlanPilotConsent();
    expect(cleared).toEqual({ status: 'withdrawn', version: expect.stringMatching(/^[a-f0-9]{32}$/) });
    expect(cleared.version).not.toBe(before.version);
    expect(await raw()).toEqual([{ id: 'session', schemaVersion: 1, scope: 'guest', ...cleared }]);
    expect(await m.getMealPlanPilotConsent('user:other')).toEqual(other);
    await expect(m.prepareMealPlanPilotExport({ scope: 'guest', expectedVersion: before.version })).rejects.toThrow();
    await expect(grant(m, 'guest', before.version)).rejects.toThrow();
  });

  it('reconsents with entirely new identifiers and never restores old events or an observation gap', async () => {
    const m = await api();
    await grant(m);
    const [before] = await raw();
    const stopped = await m.withdrawMealPlanPilotConsent();
    vi.setSystemTime(new Date('2026-09-22T09:00:00.000Z'));
    await grant(m, 'guest', stopped.version);
    const [after] = await raw();
    expect(after.version).not.toBe(before.version);
    expect(after.subjectId).not.toBe(before.subjectId);
    expect(after.startedAt).toBe('2026-09-22T09:00:00.000Z');
    expect(after.expiresAt).toBe('2026-10-27T09:00:00.000Z');
    expect(after.events).toEqual([]);
    expect(after.gaps).toEqual([]);
  });

  it('retains consent just before expiry but purges the whole session at the exact deadline', async () => {
    const m = await api();
    const initial = await grant(m);
    vi.setSystemTime(new Date('2026-10-26T08:59:59.999Z'));
    expect((await m.getMealPlanPilotConsent()).version).toBe(initial.version);
    vi.setSystemTime(new Date(EXPIRES));
    const expired = await m.getMealPlanPilotConsent();
    expect(expired.status).toBe('expired');
    expect(await raw()).toEqual([{ id: 'session', schemaVersion: 1, scope: 'guest', ...expired }]);
    expect(JSON.stringify(await raw())).not.toContain('sub_');
    await expect(m.prepareMealPlanPilotExport({ scope: 'guest', expectedVersion: initial.version })).rejects.toThrow();
  });

  it('purges on next access after a long absence, not by pretending a closed browser ran a timer', async () => {
    const m = await api();
    await grant(m);
    vi.setSystemTime(new Date('2027-01-01T09:00:00.000Z'));
    expect((await raw())[0].status).toBe('active');
    expect((await m.getMealPlanPilotConsent()).status).toBe('expired');
    expect(Object.keys((await raw())[0]).sort()).toEqual(['id', 'schemaVersion', 'scope', 'status', 'version']);
  });

  it('commits expiry deletion even when an old opt-in request must be rejected', async () => {
    const m = await api();
    const initial = await grant(m);
    vi.setSystemTime(new Date(EXPIRES));
    await expect(grant(m, 'guest', initial.version)).rejects.toThrow();
    const [stored] = await raw();
    expect(stored.status).toBe('expired');
    expect(stored).not.toHaveProperty('subjectId');
  });

  it('does not keep expired event payloads just because those payloads have become malformed', async () => {
    const m = await api();
    await grant(m);
    const [stored] = await raw();
    await seed({ ...stored, events: [{ privateField: 'do not retain beyond expiry' }] });
    vi.setSystemTime(new Date(EXPIRES));
    expect((await m.getMealPlanPilotConsent()).status).toBe('expired');
    expect((await raw())[0]).not.toHaveProperty('events');
  });

  it('purges unexpected extra pilot rows when the valid session header has expired', async () => {
    const m = await api();
    await grant(m);
    await seed({ id: 'unexpected-row', privateField: 'must not delay expiry' });
    vi.setSystemTime(new Date(EXPIRES));
    const expired = await m.getMealPlanPilotConsent();
    expect(expired.status).toBe('expired');
    expect(await raw()).toEqual([{ id: 'session', schemaVersion: 1, scope: 'guest', ...expired }]);
  });

  it('does not claim deletion if its transaction fails and preserves the original session', async () => {
    const m = await api();
    await grant(m);
    const before = await raw();
    const db = await import('../../../db/indexedDB');
    await db.runMealPlanPilotTransaction('readonly', store => {
      vi.spyOn(Object.getPrototypeOf(store), 'clear').mockImplementation(function () {
        this.transaction.abort();
        throw new DOMException('private delete failure', 'UnknownError');
      });
    });
    await expect(m.withdrawMealPlanPilotConsent()).rejects.toThrow();
    vi.restoreAllMocks();
    expect(await raw()).toEqual(before);
  });

  it('allows explicit scoped withdrawal even when stored session data is corrupted', async () => {
    const m = await api();
    await seed({ id: 'session', schemaVersion: 999, scope: 'user:wrong', privateField: 'private@example.invalid' });
    await seed({ id: 'unexpected-row', secret: 'must also clear' });
    await expect(m.getMealPlanPilotConsent()).rejects.toThrow();
    const cleared = await m.withdrawMealPlanPilotConsent();
    expect(await raw()).toEqual([{ id: 'session', schemaVersion: 1, scope: 'guest', ...cleared }]);
  });
});

describe('scoped manual export preparation', () => {
  it('exports no account ID and does not turn an empty consent session into full observation', async () => {
    const m = await api();
    const state = await grant(m, 'user:alice');
    vi.setSystemTime(new Date('2026-09-22T09:00:00.000Z'));
    const before = await raw('user:alice');
    const exported = await m.prepareMealPlanPilotExport({ scope: 'user:alice', expectedVersion: state.version });
    expect(exported).toMatchObject({ schemaVersion: 1, exportKind: 'fridgemate-local-meal-plan-pilot',
      measurementUnit: 'browser-scope', policyVersion: POLICY, startedAt: START, expiresAt: EXPIRES,
      dataset: { schemaVersion: 1, exportedAt: '2026-09-22T09:00:00.000Z', events: [], subjects: [{
        id: expect.stringMatching(/^sub_[a-f0-9]{32}$/), kind: 'account', observedFrom: START,
        observedThrough: START, firstGenerationKnown: false, gaps: [],
      }] } });
    expect(JSON.stringify(exported)).not.toMatch(/alice|"scope"|requestKey|email|inventory/);
    expect(exported).not.toHaveProperty('version');
    expect(await raw('user:alice')).toEqual(before);
    exported.dataset.subjects[0].gaps.push({ private: true });
    expect(await raw('user:alice')).toEqual(before);
  });

  it('refuses export without active consent or with another consent generation', async () => {
    const m = await api();
    await expect(m.prepareMealPlanPilotExport({ scope: 'guest', expectedVersion: null })).rejects.toThrow();
    const one = await grant(m);
    const two = await grant(m, 'user:other');
    await expect(m.prepareMealPlanPilotExport({ scope: 'user:other', expectedVersion: one.version })).rejects.toThrow();
    expect((await m.getMealPlanPilotConsent('user:other')).version).toBe(two.version);
  });

  it('purges instead of exporting when the download is prepared at expiry', async () => {
    const m = await api();
    const initial = await grant(m);
    vi.setSystemTime(new Date(EXPIRES));
    await expect(m.prepareMealPlanPilotExport({ scope: 'guest', expectedVersion: initial.version })).rejects.toThrow();
    expect((await raw())[0].status).toBe('expired');
    expect((await raw())[0]).not.toHaveProperty('subjectId');
  });

  it('checks expiry when a delayed read finishes, not only when export was requested', async () => {
    const m = await api();
    const initial = await grant(m);
    const db = await import('../../../db/indexedDB');
    await db.runMealPlanPilotTransaction('readonly', store => {
      const prototype = Object.getPrototypeOf(store);
      const getAll = prototype.getAll;
      vi.spyOn(prototype, 'getAll').mockImplementation(function (...args) {
        const request = getAll.apply(this, args);
        request.addEventListener('success', () => vi.setSystemTime(new Date(EXPIRES)), { once: true });
        return request;
      });
    });
    vi.setSystemTime(new Date('2026-10-26T08:59:59.999Z'));
    await expect(m.prepareMealPlanPilotExport({ scope: 'guest', expectedVersion: initial.version })).rejects.toThrow();
    vi.restoreAllMocks();
    expect((await raw())[0].status).toBe('expired');
  });

  it('rejects a backwards clock rather than extending or fabricating observation', async () => {
    const m = await api();
    const state = await grant(m);
    const before = await raw();
    vi.setSystemTime(new Date('2026-09-20T09:00:00.000Z'));
    await expect(m.prepareMealPlanPilotExport({ scope: 'guest', expectedVersion: state.version })).rejects.toThrow();
    expect(await raw()).toEqual(before);
  });
});
