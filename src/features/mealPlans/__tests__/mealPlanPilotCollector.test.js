import { webcrypto } from 'node:crypto';
import { setTimeout as realSetTimeout } from 'node:timers';
import FDBFactory from 'fake-indexeddb/lib/FDBFactory';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const START = '2026-09-21T09:00:00.000Z';
const modules = import.meta.glob('../mealPlanPilotCollector.js');
const descriptor = (changes = {}) => ({ name: 'meal_plan_generated', status: 'success', sourceKey: 'private-generated',
  operationKey: 'private-operation', occurredAt: START, planKey: 'private-plan', plannedSlotCount: 3, ...changes });
const raw = async (scope = 'guest') => (await import('../../../db/indexedDB'))
  .runMealPlanPilotTransaction('readonly', store => store.getAll(), scope);

async function api({ resume = true, scope = 'guest' } = {}) {
  const load = modules['../mealPlanPilotCollector.js'];
  const collector = load ? await load() : {};
  for (const name of ['getMealPlanPilotCapture', 'subscribeMealPlanPilotCapture', 'resumeMealPlanPilotCapture',
    'beginMealPlanPilotOperation', 'finishMealPlanPilotOperation']) expect(collector[name]).toBeTypeOf('function');
  const consent = await import('../mealPlanPilotConsent');
  const state = await consent.grantMealPlanPilotConsent({ scope, expectedVersion: null, accepted: true, policyVersion: 'local-pilot-35d-v1' });
  if (resume) await collector.resumeMealPlanPilotCapture({ scope, expectedVersion: state.version }, { isCurrent: () => true });
  return { ...collector, ...consent, state };
}

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(START));
  vi.stubGlobal('crypto', webcrypto);
  Object.defineProperty(window, 'indexedDB', { configurable: true, value: new FDBFactory() });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('local-only pilot operation collector', () => {
  it('keeps existing consent view unchanged and explicitly resumes into a private v2 session', async () => {
    const m = await api({ resume: false });
    const before = await m.getMealPlanPilotConsent();
    expect(await m.getMealPlanPilotCapture()).toEqual({ ...before, captureState: 'paused', gapCount: 0, pendingCount: 0 });
    const active = await m.resumeMealPlanPilotCapture({ scope: 'guest', expectedVersion: m.state.version });
    expect(active).toEqual({ ...before, captureState: 'collecting', gapCount: 0, pendingCount: 0 });
    expect(await m.getMealPlanPilotConsent()).toEqual(before);
    expect((await raw())[0]).toMatchObject({ schemaVersion: 2, version: before.version, firstGenerationKnown: false });
    expect(JSON.stringify(active)).not.toMatch(/secret|subjectId|owner|pending"/);
  });

  it('persists a private pending marker before appending a completed event', async () => {
    const m = await api();
    const ticket = await m.beginMealPlanPilotOperation({ scope: 'guest' });
    expect(Object.isFrozen(ticket)).toBe(true);
    expect(Reflect.ownKeys(ticket)).toEqual([]);
    expect(await m.getMealPlanPilotCapture()).toMatchObject({ pendingCount: 1, eventCount: 0 });
    expect(await m.finishMealPlanPilotOperation(ticket, [descriptor()])).toEqual({ status: 'recorded', recordedCount: 1 });
    expect(await m.getMealPlanPilotCapture()).toMatchObject({ pendingCount: 0, eventCount: 1, captureState: 'collecting' });
    const [stored] = await raw();
    expect(JSON.stringify(stored)).not.toContain('private-');
    expect(stored.events[0]).toMatchObject({ name: 'meal_plan_generated', status: 'success', plannedSlotCount: 3,
      occurredAt: START, weekKey: '2026-09-21', id: expect.stringMatching(/^evt_[a-f0-9]{32}$/),
      planId: expect.stringMatching(/^plan_[a-f0-9]{32}$/), operationId: expect.stringMatching(/^op_[a-f0-9]{32}$/) });
  });

  it.each([
    ['replace', 'repetition'], ['skip', 'schedule'], ['not_cooked', 'difficulty'], ['replace', 'not_answered'],
  ])('stores and exports successful %s feedback using purpose-specific aliases', async (changeType, reasonCode) => {
    const m = await api();
    await m.finishMealPlanPilotOperation(await m.beginMealPlanPilotOperation({ scope: 'guest' }), [descriptor()]);
    const ticket = await m.beginMealPlanPilotOperation({ scope: 'guest' });
    const feedback = descriptor({ name: 'meal_slot_changed', sourceKey: 'private-change', slotKey: 'private-slot', changeType, reasonCode });
    delete feedback.plannedSlotCount;
    expect(await m.finishMealPlanPilotOperation(ticket, [feedback])).toEqual({ status: 'recorded', recordedCount: 1 });
    const [stored] = await raw();
    expect(stored.events.map(event => event.version)).toEqual([1, 2]);
    expect(stored.events[1]).toMatchObject({ version: 2, name: 'meal_slot_changed', status: 'success', changeType, reasonCode,
      slotId: expect.stringMatching(/^slot_[a-f0-9]{32}$/), planId: expect.stringMatching(/^plan_[a-f0-9]{32}$/) });
    expect(JSON.stringify(stored)).not.toContain('private-');
    const exported = await m.prepareMealPlanPilotExport({ scope: 'guest', expectedVersion: m.state.version });
    expect(exported.schemaVersion).toBe(1);
    expect(exported.dataset.events.find(event => event.version === 2)).toMatchObject({ changeType, reasonCode });
    await m.withdrawMealPlanPilotConsent('guest');
    expect(JSON.stringify(await raw())).not.toMatch(/reasonCode|changeType|evt_|slot_|plan_/);
  });

  it.each([
    ['reason without action', { reasonCode: 'repetition' }],
    ['action without reason', { changeType: 'replace' }],
    ['unknown action', { changeType: 'private-action', reasonCode: 'repetition' }],
    ['free-text reason', { changeType: 'replace', reasonCode: 'SECRET_PRIVATE_REASON' }],
    ['other event', { name: 'meal_cooked_recorded', changeType: 'replace', reasonCode: 'repetition' }],
    ['failed change', { status: 'failure', changeType: 'replace', reasonCode: 'repetition' }],
    ['cancelled change', { status: 'cancelled', changeType: 'skip', reasonCode: 'schedule' }],
    ['free-text field', { changeType: 'replace', reasonCode: 'repetition', reasonText: 'SECRET_PRIVATE_REASON' }],
  ])('keeps %s out of persisted feedback and marks an observation gap', async (_name, changes) => {
    const m = await api();
    const ticket = await m.beginMealPlanPilotOperation({ scope: 'guest' });
    const feedback = descriptor({ name: 'meal_slot_changed', slotKey: 'private-slot', ...changes });
    delete feedback.plannedSlotCount;
    expect(await m.finishMealPlanPilotOperation(ticket, [feedback])).toEqual({ status: 'missing' });
    expect((await raw())[0].events).toEqual([]);
    expect(await m.getMealPlanPilotCapture()).toMatchObject({ captureState: 'paused', pendingCount: 1 });
    expect(JSON.stringify(await raw())).not.toMatch(/SECRET_PRIVATE_REASON|private-action|reasonText/);
  });

  it('links generation start and result with the same operation and plan aliases', async () => {
    const m = await api();
    const ticket = await m.beginMealPlanPilotOperation({ scope: 'guest', startEvent: descriptor({ name: 'meal_plan_generation_started',
      status: 'started', sourceKey: 'private-start' }) });
    expect((await raw())[0].events).toHaveLength(1);
    await m.finishMealPlanPilotOperation(ticket, [descriptor()]);
    const events = (await raw())[0].events;
    expect(events).toHaveLength(2);
    expect(events[0].operationId).toBe(events[1].operationId);
    expect(events[0].planId).toBe(events[1].planId);
  });

  it('does not collect before explicit resume or accept a forged completion', async () => {
    const m = await api({ resume: false });
    expect(await m.beginMealPlanPilotOperation({ scope: 'guest' })).toBeNull();
    expect(await m.finishMealPlanPilotOperation({}, [descriptor()])).toEqual({ status: 'ignored' });
    expect(await m.finishMealPlanPilotOperation(null, [descriptor()])).toEqual({ status: 'ignored' });
    expect((await raw())[0].events).toEqual([]);
  });

  it('records each ticket completion once and deduplicates a replay with stable business source keys', async () => {
    const m = await api();
    const ticket = await m.beginMealPlanPilotOperation({ scope: 'guest' });
    const results = await Promise.all([m.finishMealPlanPilotOperation(ticket, [descriptor()]), m.finishMealPlanPilotOperation(ticket, [descriptor()])]);
    expect(results).toEqual([{ status: 'recorded', recordedCount: 1 }, { status: 'recorded', recordedCount: 1 }]);
    const retry = await m.beginMealPlanPilotOperation({ scope: 'guest' });
    expect(await m.finishMealPlanPilotOperation(retry, [descriptor()])).toEqual({ status: 'recorded', recordedCount: 0 });
    expect((await raw())[0].events).toHaveLength(1);
  });

  it('pauses on a conflicting replay instead of overwriting the first observed outcome', async () => {
    const m = await api();
    await m.finishMealPlanPilotOperation(await m.beginMealPlanPilotOperation({ scope: 'guest' }), [descriptor()]);
    const retry = await m.beginMealPlanPilotOperation({ scope: 'guest' });
    expect(await m.finishMealPlanPilotOperation(retry, [descriptor({ plannedSlotCount: 5 })])).toEqual({ status: 'missing' });
    expect((await raw())[0].events[0].plannedSlotCount).toBe(3);
    expect(await m.getMealPlanPilotCapture()).toMatchObject({ captureState: 'paused' });
  });

  it('appends a consumption correction reversal and replacement together without another cooking event', async () => {
    const m = await api();
    const consumed = { name: 'consumption_applied', status: 'success', sourceKey: 'private-consumption', operationKey: 'private-cooking',
      occurredAt: START, planKey: 'private-plan', slotKey: 'private-slot' };
    await m.finishMealPlanPilotOperation(await m.beginMealPlanPilotOperation({ scope: 'guest' }), [consumed]);
    const correction = await m.beginMealPlanPilotOperation({ scope: 'guest' });
    expect(await m.finishMealPlanPilotOperation(correction, [
      { ...consumed, name: 'consumption_reversed', sourceKey: 'private-reversal', operationKey: 'private-correction', reversesKey: 'private-consumption' },
      { ...consumed, sourceKey: 'private-replacement', operationKey: 'private-correction' },
    ])).toEqual({ status: 'recorded', recordedCount: 2 });
    const [stored] = await raw();
    expect(stored.events.filter(event => event.name === 'meal_cooked_recorded')).toEqual([]);
    const reversal = stored.events.find(event => event.name === 'consumption_reversed');
    expect(reversal.reversesEventId).toBe(stored.events.find(event => event.name === 'consumption_applied' && event.operationId !== reversal.operationId).id);
    expect((await m.prepareMealPlanPilotExport({ scope: 'guest', expectedVersion: m.state.version })).dataset.events).toHaveLength(3);
  });

  it('keeps unlinked reversals as observation loss instead of fabricating an original event', async () => {
    const m = await api();
    const ticket = await m.beginMealPlanPilotOperation({ scope: 'guest' });
    expect(await m.finishMealPlanPilotOperation(ticket, [{ name: 'consumption_reversed', status: 'success', sourceKey: 'private-reversal',
      operationKey: 'private-correction', occurredAt: START, planKey: 'private-plan', slotKey: 'private-slot', reversesKey: 'missing-original' }]))
      .toEqual({ status: 'missing' });
    expect((await raw())[0].events).toEqual([]);
    expect(await m.getMealPlanPilotCapture()).toMatchObject({ captureState: 'paused', pendingCount: 1 });
  });

  it('rejects unknown raw fields without storing them or failing the caller with a private exception', async () => {
    const m = await api();
    const ticket = await m.beginMealPlanPilotOperation({ scope: 'guest' });
    expect(await m.finishMealPlanPilotOperation(ticket, [descriptor({ rawReceipt: 'PRIVATE RECEIPT' })])).toEqual({ status: 'missing' });
    expect(JSON.stringify(await raw())).not.toContain('PRIVATE');
  });

  it('uses separate aliases in different consent scopes and removes all old material on withdrawal', async () => {
    const guest = await api();
    const alice = await api({ scope: 'user:alice' });
    await guest.finishMealPlanPilotOperation(await guest.beginMealPlanPilotOperation({ scope: 'guest' }), [descriptor()]);
    await alice.finishMealPlanPilotOperation(await alice.beginMealPlanPilotOperation({ scope: 'user:alice' }), [descriptor()]);
    expect((await raw())[0].events[0].planId).not.toBe((await raw('user:alice'))[0].events[0].planId);
    const delayed = await guest.beginMealPlanPilotOperation({ scope: 'guest' });
    await guest.withdrawMealPlanPilotConsent('guest');
    expect(await guest.finishMealPlanPilotOperation(delayed, [descriptor({ sourceKey: 'late' })])).toEqual({ status: 'ignored' });
    expect(await raw()).toEqual([{ id: 'session', schemaVersion: 1, scope: 'guest', status: 'withdrawn', version: expect.any(String) }]);
    expect((await raw('user:alice'))[0].events).toHaveLength(1);
  });

  it('preserves old history and records a missing interval on a new-page explicit resume', async () => {
    const first = await api();
    await first.finishMealPlanPilotOperation(await first.beginMealPlanPilotOperation({ scope: 'guest' }), [descriptor()]);
    const old = (await raw())[0];
    const ticket = await first.beginMealPlanPilotOperation({ scope: 'guest' });
    vi.setSystemTime(new Date('2026-09-22T09:00:00.000Z'));
    vi.resetModules();
    const next = await modules['../mealPlanPilotCollector.js']();
    expect(await next.getMealPlanPilotCapture()).toMatchObject({ captureState: 'paused', observedThrough: START, eventCount: 1 });
    const resumed = await next.resumeMealPlanPilotCapture({ scope: 'guest', expectedVersion: old.version });
    expect(resumed).toMatchObject({ captureState: 'collecting', gapCount: 1, pendingCount: 0, eventCount: 1 });
    const [after] = await raw();
    expect(after.startedAt).toBe(old.startedAt);
    expect(after.expiresAt).toBe(old.expiresAt);
    expect(after.events).toEqual(old.events);
    expect(after.gaps).toEqual([{ from: START, through: '2026-09-22T09:00:00.000Z', reason: 'missing' }]);
    expect(await first.finishMealPlanPilotOperation(ticket, [descriptor({ sourceKey: 'late' })])).toEqual({ status: 'ignored' });
  });

  it('returns a paused view to another page without mutating or broadcasting against the live owner', async () => {
    const first = await api();
    const before = await raw();
    vi.resetModules();
    const next = await modules['../mealPlanPilotCollector.js']();
    expect(await next.getMealPlanPilotCapture()).toMatchObject({ captureState: 'paused' });
    expect(await raw()).toEqual(before);
    expect(await first.getMealPlanPilotCapture()).toMatchObject({ captureState: 'collecting' });
    // Unlike an observer, a real action from another owner signals lost coverage.
    expect(await next.beginMealPlanPilotOperation({ scope: 'guest' })).toBeNull();
    expect((await raw())[0].capture.state).toBe('paused');
  });

  it('exports a pending operation as a temporary missing interval without losing a different known success', async () => {
    const m = await api();
    const pending = await m.beginMealPlanPilotOperation({ scope: 'guest' });
    vi.setSystemTime(new Date('2026-09-21T09:01:00.000Z'));
    const completed = await m.beginMealPlanPilotOperation({ scope: 'guest' });
    await m.finishMealPlanPilotOperation(completed, [descriptor({ occurredAt: '2026-09-21T09:01:00.000Z' })]);
    const first = await m.prepareMealPlanPilotExport({ scope: 'guest', expectedVersion: m.state.version });
    expect(first.dataset.events).toHaveLength(1);
    expect(first.dataset.subjects[0].gaps).toEqual([{ from: START, through: '2026-09-21T09:01:00.000Z', reason: 'missing' }]);
    expect((await raw())[0].gaps).toEqual([]);
    await m.finishMealPlanPilotOperation(pending, [descriptor({ sourceKey: 'other-result', operationKey: 'other-operation' })]);
    const after = await m.prepareMealPlanPilotExport({ scope: 'guest', expectedVersion: m.state.version });
    expect(after.dataset.events).toHaveLength(2);
    expect(after.dataset.subjects[0].gaps).toEqual([]);
  });

  it('does not regard a live pending operation in the same module as an abandoned action', async () => {
    const m = await api();
    const ticket = await m.beginMealPlanPilotOperation({ scope: 'guest' });
    vi.setSystemTime(new Date('2026-09-21T09:00:01.000Z'));
    expect(await m.getMealPlanPilotCapture()).toMatchObject({ captureState: 'collecting', pendingCount: 1 });
    expect(await m.finishMealPlanPilotOperation(ticket, [descriptor()])).toMatchObject({ status: 'recorded' });
  });

  it('notifies local subscribers without propagating their exceptions to a successful append', async () => {
    const m = await api();
    let signals = 0;
    const unsubscribe = m.subscribeMealPlanPilotCapture('guest', () => { signals += 1; throw new Error('PRIVATE UI'); });
    const ticket = await m.beginMealPlanPilotOperation({ scope: 'guest' });
    expect(await m.finishMealPlanPilotOperation(ticket, [descriptor()])).toMatchObject({ status: 'recorded' });
    expect(signals).toBeGreaterThan(0);
    unsubscribe();
  });

  it('rejects stale account guards before writing a begin marker or resuming', async () => {
    const m = await api();
    const before = await raw();
    expect(await m.beginMealPlanPilotOperation({ scope: 'guest' }, { isCurrent: () => false })).toBeNull();
    await expect(m.resumeMealPlanPilotCapture({ scope: 'guest', expectedVersion: m.state.version }, { isCurrent: () => false })).rejects.toThrow();
    expect(await raw()).toEqual(before);
  });

  it('remembers an initial begin read failure and notifies without requiring a successful loss-marker write', async () => {
    const m = await api();
    const db = await import('../../../db/indexedDB');
    let prototype;
    await db.runMealPlanPilotTransaction('readonly', store => { prototype = Object.getPrototypeOf(store); });
    let signals = 0;
    const unsubscribe = m.subscribeMealPlanPilotCapture('guest', () => { signals += 1; });
    const getAll = prototype.getAll;
    const read = vi.spyOn(prototype, 'getAll').mockImplementationOnce(() => { throw new Error('PRIVATE read failed'); });
    expect(await m.beginMealPlanPilotOperation({ scope: 'guest' })).toBeNull();
    read.mockImplementation(getAll);
    expect(signals).toBeGreaterThan(0);
    expect(await m.getMealPlanPilotCapture()).toMatchObject({ captureState: 'paused' });
    vi.setSystemTime(new Date('2026-09-21T09:01:00.000Z'));
    await m.resumeMealPlanPilotCapture({ scope: 'guest', expectedVersion: m.state.version });
    expect((await raw())[0].gaps).toEqual([{ from: START, through: '2026-09-21T09:01:00.000Z', reason: 'missing' }]);
    unsubscribe();
  });

  it('provides a degraded paused view after begin and loss-marker quota failures without trying a write on read', async () => {
    const m = await api();
    const db = await import('../../../db/indexedDB');
    let prototype;
    await db.runMealPlanPilotTransaction('readonly', store => { prototype = Object.getPrototypeOf(store); });
    let signals = 0;
    const unsubscribe = m.subscribeMealPlanPilotCapture('guest', () => { signals += 1; });
    const write = vi.spyOn(prototype, 'put').mockImplementation(() => { throw new Error('PRIVATE quota'); });
    expect(await m.beginMealPlanPilotOperation({ scope: 'guest' })).toBeNull();
    const callsBeforeView = write.mock.calls.length;
    expect(await m.getMealPlanPilotCapture()).toMatchObject({ captureState: 'paused' });
    expect(write.mock.calls).toHaveLength(callsBeforeView);
    expect(signals).toBeGreaterThan(0);
    unsubscribe();
  });

  it('does not let a late failed old-ticket hash pause a successfully resumed capture generation', async () => {
    const m = await api();
    const ticket = await m.beginMealPlanPilotOperation({ scope: 'guest' });
    let rejectHash;
    const sign = vi.spyOn(webcrypto.subtle, 'sign').mockImplementationOnce(() => new Promise((_, reject) => { rejectHash = reject; }));
    const finishing = m.finishMealPlanPilotOperation(ticket, [descriptor()]);
    while (!rejectHash) await new Promise(resolve => setTimeout(resolve, 0));
    await m.resumeMealPlanPilotCapture({ scope: 'guest', expectedVersion: m.state.version });
    rejectHash(new Error('PRIVATE failed late'));
    await finishing;
    sign.mockRestore();
    expect(await m.getMealPlanPilotCapture()).toMatchObject({ captureState: 'collecting', pendingCount: 0 });
    expect((await raw())[0].capture.state).toBe('collecting');
  });

  it('does not advance observation when loss is learned while another begin is hashing', async () => {
    const m = await api();
    let releaseHash;
    const sign = webcrypto.subtle.sign.bind(webcrypto.subtle);
    vi.spyOn(webcrypto.subtle, 'sign').mockImplementationOnce((...args) => new Promise(resolve => {
      releaseHash = () => resolve(sign(...args));
    }));
    const first = m.beginMealPlanPilotOperation({ scope: 'guest', startEvent: descriptor({
      name: 'meal_plan_generation_started', status: 'started' }) });
    await vi.waitFor(() => expect(releaseHash).toBeTypeOf('function'));
    const db = await import('../../../db/indexedDB');
    let prototype;
    await db.runMealPlanPilotTransaction('readonly', store => { prototype = Object.getPrototypeOf(store); });
    const write = vi.spyOn(prototype, 'put').mockImplementation(() => { throw new Error('PRIVATE quota'); });
    vi.setSystemTime(new Date('2026-09-21T09:00:01.000Z'));
    expect(await m.beginMealPlanPilotOperation({ scope: 'guest' })).toBeNull();
    write.mockRestore();
    vi.setSystemTime(new Date('2026-09-21T09:01:00.000Z'));
    releaseHash();
    expect(await first).toBeNull();
    const [stored] = await raw();
    expect(stored.observedThrough).toBe(START);
    expect(stored.events).toEqual([]);
    expect(stored.capture.state).toBe('paused');
    const exported = await m.prepareMealPlanPilotExport({ scope: 'guest', expectedVersion: m.state.version });
    expect(exported.dataset.subjects[0].observedThrough).toBe(START);
  });

  it.each(['begin', 'finish'])('bounds %s hashing at two seconds and prevents writes from the late completion', async (stage) => {
    const m = await api();
    const ticket = stage === 'finish' ? await m.beginMealPlanPilotOperation({ scope: 'guest' }) : null;
    const before = await raw();
    let releaseHash;
    let signsFinished = 0;
    const sign = webcrypto.subtle.sign.bind(webcrypto.subtle);
    const spy = vi.spyOn(webcrypto.subtle, 'sign').mockImplementation(async (...args) => {
      if (!releaseHash) await new Promise(resolve => { releaseHash = resolve; });
      const result = await sign(...args);
      signsFinished += 1;
      return result;
    });
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    const pending = stage === 'begin'
      ? m.beginMealPlanPilotOperation({ scope: 'guest', startEvent: descriptor({ name: 'meal_plan_generation_started', status: 'started' }) })
      : m.finishMealPlanPilotOperation(ticket, [descriptor()]);
    await vi.waitFor(() => expect(releaseHash).toBeTypeOf('function'));
    await vi.advanceTimersByTimeAsync(2000);
    expect(await pending).toEqual(stage === 'begin' ? null : { status: 'unavailable' });
    releaseHash();
    // Real WebCrypto promises complete outside the fake clock; wait for the
    // actual late hashes, then let their attempted IDB continuation run.
    for (let attempts = 0; signsFinished < 3 && attempts < 1000; attempts += 1) {
      await new Promise(resolve => realSetTimeout(resolve, 1));
    }
    expect(signsFinished).toBe(3);
    await new Promise(resolve => realSetTimeout(resolve, 5));
    spy.mockRestore();
    expect(await raw()).toEqual(before);
    expect(await m.getMealPlanPilotCapture()).toMatchObject({ captureState: 'paused' });
  });

  it('atomically rejects an entire correction batch when its final pilot write aborts', async () => {
    const m = await api();
    const original = { name: 'consumption_applied', status: 'success', sourceKey: 'original-consumption', operationKey: 'cooking',
      occurredAt: START, planKey: 'private-plan', slotKey: 'private-slot' };
    await m.finishMealPlanPilotOperation(await m.beginMealPlanPilotOperation({ scope: 'guest' }), [original]);
    const ticket = await m.beginMealPlanPilotOperation({ scope: 'guest' });
    const before = (await raw())[0];
    const db = await import('../../../db/indexedDB');
    let prototype;
    await db.runMealPlanPilotTransaction('readonly', store => { prototype = Object.getPrototypeOf(store); });
    const put = prototype.put;
    vi.spyOn(prototype, 'put').mockImplementationOnce(function (...args) {
      const request = put.apply(this, args);
      request.addEventListener('success', () => this.transaction.abort());
      return request;
    });
    expect(await m.finishMealPlanPilotOperation(ticket, [
      { ...original, name: 'consumption_reversed', sourceKey: 'reverse', reversesKey: original.sourceKey },
      { ...original, sourceKey: 'replacement' },
    ])).toEqual({ status: 'missing' });
    const [after] = await raw();
    expect(after.events).toEqual(before.events);
    expect(after.capture.pending).toEqual(before.capture.pending);
    expect(after.capture.state).toBe('paused');
  });

  it('pauses at pending capacity without dropping previous markers or claiming full observation', async () => {
    const m = await api();
    const [stored] = await raw();
    stored.capture.pending = Array.from({ length: 100 }, (_, index) => ({ id: index.toString(16).padStart(32, '0'), startedAt: START }));
    const db = await import('../../../db/indexedDB');
    await db.runMealPlanPilotTransaction('readwrite', store => store.put(stored));
    expect(await m.beginMealPlanPilotOperation({ scope: 'guest' })).toBeNull();
    expect(await m.getMealPlanPilotCapture()).toMatchObject({ captureState: 'paused', pendingCount: 100 });
    expect((await raw())[0].capture.pending).toEqual(stored.capture.pending);
  });

  it('keeps a paused session unchanged when closing a missing interval exceeds gap capacity', async () => {
    const m = await api();
    const [stored] = await raw();
    stored.gaps = Array.from({ length: 100 }, (_, index) => ({
      from: new Date(Date.parse(START) + index * 3).toISOString(), through: new Date(Date.parse(START) + index * 3 + 1).toISOString(), reason: 'missing' }));
    stored.observedThrough = '2026-09-21T09:00:01.000Z';
    stored.capture.state = 'paused';
    stored.capture.missingSince = stored.observedThrough;
    vi.setSystemTime(new Date('2026-09-21T09:01:00.000Z'));
    const db = await import('../../../db/indexedDB');
    await db.runMealPlanPilotTransaction('readwrite', store => store.put(stored));
    await expect(m.resumeMealPlanPilotCapture({ scope: 'guest', expectedVersion: m.state.version })).rejects.toThrow();
    expect(await raw()).toEqual([stored]);
    expect(await m.getMealPlanPilotCapture()).toMatchObject({ captureState: 'paused' });
  });

  it('purges v2 capture material at expiry before a delayed result can append', async () => {
    const m = await api();
    const ticket = await m.beginMealPlanPilotOperation({ scope: 'guest' });
    vi.setSystemTime(new Date('2026-10-26T09:00:00.000Z'));
    expect(await m.finishMealPlanPilotOperation(ticket, [descriptor()])).toEqual({ status: 'ignored' });
    expect(await raw()).toEqual([{ id: 'session', schemaVersion: 1, scope: 'guest', status: 'expired', version: expect.any(String) }]);
  });

  it('clock-recovery resumes after a failed backwards-clock begin without inventing pre-consent observation', async () => {
    const m = await api();
    const db = await import('../../../db/indexedDB');
    const ingredient = { id: 'business-stock', name: '두부', quantity: '1팩', consumed: false };
    await db.saveIngredient(ingredient);
    const before = await raw();
    vi.setSystemTime(new Date('2026-09-21T08:00:00.000Z'));
    expect(await m.beginMealPlanPilotOperation({ scope: 'guest' })).toBeNull();
    expect(await raw()).toEqual(before);
    vi.setSystemTime(new Date('2026-09-21T09:01:00.000Z'));
    expect(await m.resumeMealPlanPilotCapture({ scope: 'guest', expectedVersion: m.state.version }))
      .toMatchObject({ captureState: 'collecting', gapCount: 1, eventCount: 0, pendingCount: 0 });
    expect((await raw())[0].gaps).toEqual([{ from: START, through: '2026-09-21T09:01:00.000Z', reason: 'missing' }]);
    expect(await db.getIngredientById('business-stock')).toEqual(ingredient);
  });
});
