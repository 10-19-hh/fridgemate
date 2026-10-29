import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const collector = vi.hoisted(() => ({ begin: vi.fn(), finish: vi.fn() }));
vi.mock('../mealPlanPilotCollector', () => ({
  beginMealPlanPilotOperation: (...args) => collector.begin(...args),
  finishMealPlanPilotOperation: (...args) => collector.finish(...args),
}));
const modules = import.meta.glob('../mealPlanPilotActions.js');
async function api() {
  const value = modules['../mealPlanPilotActions.js'] ? await modules['../mealPlanPilotActions.js']() : {};
  expect(value.runMealPlanPilotAction, 'business outcome must be independent from optional pilot storage').toBeTypeOf('function');
  return value;
}
const NOW = '2026-09-28T03:00:00.000Z';
const event = status => ({ name: 'shopping_list_recalculated', status,
  sourceKey: `shopping:${status}:one`, operationKey: 'one', occurredAt: NOW });

beforeEach(() => {
  vi.resetAllMocks();
  collector.begin.mockResolvedValue(Object.freeze({}));
  collector.finish.mockResolvedValue({ status: 'recorded', recordedCount: 1 });
});
afterEach(() => vi.restoreAllMocks());

describe('optional pilot business adapter', () => {
  it('does not reuse operation keys at the same clock time across fresh module instances', async () => {
    const first = await api();
    vi.spyOn(Date, 'now').mockReturnValue(123456);
    const one = first.createMealPlanPilotOperation('shopping_list_recalculated');
    vi.resetModules();
    const second = await api();
    const two = second.createMealPlanPilotOperation('shopping_list_recalculated');
    expect(two.operationKey).not.toBe(one.operationKey);
  });

  it('continues business when secure operation identity is unavailable without inventing a stable key', async () => {
    const m = await api();
    vi.spyOn(crypto, 'getRandomValues').mockImplementation(() => { throw new Error('unavailable'); });
    const operation = m.createMealPlanPilotOperation('shopping_list_recalculated');
    expect(operation.operationKey).toBeNull();
    let calls = 0;
    expect(await m.runMealPlanPilotAction({ scope: 'guest', ...operation },
      async () => { calls += 1; return 'saved'; }, () => [])).toBe('saved');
    expect(calls).toBe(1);
  });

  it('runs business once between pending persistence and a terminal ACK and preserves its exact result', async () => {
    const { runMealPlanPilotAction } = await api();
    const order = [];
    const result = { private: 'not an analytics field' };
    collector.begin.mockImplementation(async () => { order.push('pending'); return Object.freeze({}); });
    collector.finish.mockImplementation(async (_ticket, events) => { order.push(events[0].status); });
    const actual = await runMealPlanPilotAction({ scope: 'guest', failureEvent: event('failure') },
      async () => { order.push('business'); return result; }, () => [event('success')]);
    expect(actual).toBe(result);
    expect(order).toEqual(['pending', 'business', 'success']);
    expect(collector.finish.mock.calls[0][1]).toEqual([event('success')]);
  });

  it.each(['begin', 'finish'])('does not retry or replace successful business when %s throws', async stage => {
    const { runMealPlanPilotAction } = await api();
    collector[stage].mockRejectedValue(new Error('private storage error'));
    let calls = 0;
    const result = { committed: true };
    expect(await runMealPlanPilotAction({ scope: 'guest', failureEvent: event('failure') },
      async () => { calls += 1; return result; }, () => [event('success')])).toBe(result);
    expect(calls).toBe(1);
    expect(collector.finish.mock.calls.flatMap(call => call[1])).not.toContainEqual(event('failure'));
  });

  it('preserves the original business rejection even when failure recording also rejects', async () => {
    const { runMealPlanPilotAction } = await api();
    const original = new Error('business rejection');
    collector.finish.mockRejectedValue(new Error('collector error'));
    let calls = 0;
    await expect(runMealPlanPilotAction({ scope: 'guest', failureEvent: event('failure') },
      async () => { calls += 1; throw original; }, () => [event('success')])).rejects.toBe(original);
    expect(calls).toBe(1);
    expect(collector.finish.mock.calls[0][1]).toEqual([event('failure')]);
  });

  it('does not label a successful commit as a business failure if descriptor mapping fails', async () => {
    const { runMealPlanPilotAction } = await api();
    const result = { committed: true };
    expect(await runMealPlanPilotAction({ scope: 'guest', failureEvent: event('failure') },
      async () => result, () => { throw new Error('mapping failure'); })).toBe(result);
    expect(collector.finish.mock.calls.flatMap(call => call[1])).not.toContainEqual(event('failure'));
  });

  it('cancels before business if the guarded view changes while pending capture is opening', async () => {
    const { runMealPlanPilotAction } = await api();
    let current = true;
    let calls = 0;
    collector.begin.mockImplementation(async () => { current = false; return Object.freeze({}); });
    expect(await runMealPlanPilotAction({ scope: 'guest', isCurrent: () => current, failureEvent: event('failure') },
      async () => { calls += 1; return 'must not write'; }, () => [event('success')])).toBeNull();
    expect(calls).toBe(0);
    expect(collector.finish.mock.calls[0][1]).toEqual([{ ...event('failure'), status: 'cancelled' }]);
  });

  it('records committed business after its view disappears instead of reporting cancellation', async () => {
    const { runMealPlanPilotAction } = await api();
    let current = true;
    const result = { committed: true };
    expect(await runMealPlanPilotAction({ scope: 'guest', isCurrent: () => current, failureEvent: event('failure') },
      async () => { current = false; return result; }, () => [event('success')])).toBe(result);
    expect(collector.finish.mock.calls[0][1]).toEqual([event('success')]);
  });

  it('uses only public event identity from a cooking ACK, including its original retry operation and time', async () => {
    const m = await api();
    expect(m.mealCookingPilotEvents).toBeTypeOf('function');
    const result = m.mealCookingPilotEvents({ event: { kind: 'cooking', id: 'cooking:first', operationId: 'first',
      weekStart: '2026-09-28', slotId: '2026-09-28:dinner', createdAt: NOW,
      consumptionId: 'consumption:first', requestKey: 'private source token', lines: [{ rawName: 'private food', amount: 150 }] } });
    expect(result).toEqual([
      { name: 'meal_cooked_recorded', status: 'success', sourceKey: 'meal_cooked_recorded:cooking:first', operationKey: 'first', occurredAt: NOW, planKey: 'week:2026-09-28', slotKey: '2026-09-28:dinner' },
      { name: 'consumption_applied', status: 'success', sourceKey: 'consumption_applied:consumption:first', operationKey: 'first', occurredAt: NOW, planKey: 'week:2026-09-28', slotKey: '2026-09-28:dinner' },
    ]);
  });

  it('maps a zero-use correction to one inverse and one replacement batch without recounting cooking', async () => {
    const m = await api();
    expect(m.mealCookingPilotEvents).toBeTypeOf('function');
    const result = m.mealCookingPilotEvents({ event: { kind: 'consumption', id: 'consumption:correction',
      operationId: 'correction', weekStart: '2026-09-28', slotId: '2026-09-28:dinner', createdAt: NOW,
      replacesId: 'consumption:first', lines: [], requestKey: 'private' } });
    expect(result.map(row => [row.name, row.sourceKey, row.reversesKey])).toEqual([
      ['consumption_reversed', 'consumption_reversed:consumption-reversal:correction', 'consumption_applied:consumption:first'],
      ['consumption_applied', 'consumption_applied:consumption:correction', undefined],
    ]);
    expect(result.every(row => row.operationKey === 'correction' && row.occurredAt === NOW)).toBe(true);
  });
});
