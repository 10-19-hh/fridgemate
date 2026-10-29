import { describe, expect, it } from 'vitest';
import * as events from '../mealCookingEvents';

const base = { schemaVersion: 1, scope: 'guest', weekStart: '2026-09-14', slotId: '2026-09-16:dinner',
  createdAt: '2026-09-19T08:00:00.000Z' };
const line = (inventoryId = 'chicken') => ({ inventoryId, name: '닭고기', ingredientKey: 'food:닭고기',
  amount: 150, unit: 'g', preparationState: 'raw' });
function measured(operationId = 'one', slotId = base.slotId) {
  const common = { ...base, operationId, slotId, requestKey: '{"action":"cook"}' };
  return [
    { ...common, kind: 'cooking', id: `cooking:${operationId}`, inventoryStatus: 'applied', consumptionId: `consumption:${operationId}` },
    { ...common, kind: 'consumption', id: `consumption:${operationId}`, cookingId: `cooking:${operationId}`, lines: [line(), line('second-batch')] },
  ];
}
function unmeasured(operationId = 'unknown') {
  return { ...base, operationId, requestKey: '{"action":"unknown"}', kind: 'cooking', id: `cooking:${operationId}`,
    inventoryStatus: 'needs-review', consumptionId: null };
}
function inverse(operationId = 'undo', originalId = 'one') {
  return { ...base, operationId, requestKey: '{"action":"undo"}', kind: 'consumption-reversal', id: `consumption-reversal:${operationId}`,
    cookingId: `cooking:${originalId}`, reversesId: `consumption:${originalId}`, lines: [line(), line('second-batch')] };
}
function cancel(operationId = 'cancel', originalId = 'one') {
  return { ...base, operationId, requestKey: '{"action":"cancel"}', kind: 'cooking-reversal', id: `cooking-reversal:${operationId}`,
    reversesId: `cooking:${originalId}` };
}

function correction(operationId = 'adjust', original = measured()[1], lines = [{ ...line(), amount: 100 }]) {
  const common = { ...base, scope: original.scope, weekStart: original.weekStart, slotId: original.slotId,
    operationId, requestKey: JSON.stringify({ action: 'correct', operationId }), cookingId: original.cookingId };
  return [
    { ...common, kind: 'consumption-reversal', id: `consumption-reversal:${operationId}`,
      reversesId: original.id, replacementConsumptionId: `consumption:${operationId}`, lines: structuredClone(original.lines) },
    { ...common, kind: 'consumption', id: `consumption:${operationId}`, replacesId: original.id, lines: structuredClone(lines) },
  ];
}

function finalInverse(consumption, operationId = 'final-undo') {
  return { ...inverse(operationId), cookingId: consumption.cookingId, reversesId: consumption.id,
    lines: structuredClone(consumption.lines) };
}

describe('linked immutable cooking history', () => {
  it.each(['guest/other', undefined])('rejects invalid scope %s even when no events have been stored', scope => {
    let failure;
    try { events.assertMealCookingHistory?.([], scope); } catch (error) { failure = error; }
    expect(failure).toBeInstanceOf(Error);
  });

  it.each([
    ['empty history', () => []],
    ['measured cooking', () => measured()],
    ['unmeasured cooking', () => [unmeasured()]],
    ['consumption reversal retaining cooking', () => [...measured(), inverse()]],
    ['cancelled measured cooking', () => [...measured(), inverse(), cancel()]],
    ['cancelled unmeasured cooking', () => [unmeasured(), cancel('cancel', 'unknown')]],
    ['new cooking after cancellation', () => [...measured(), inverse(), cancel(), ...measured('later')]],
    ['independent dinner slots', () => [...measured(), ...measured('tomorrow', '2026-09-17:dinner')]],
  ])('accepts %s without changing event history', (_label, make) => {
    const history = make();
    const before = structuredClone(history);
    expect(events.assertMealCookingHistory?.(history, 'guest')).toEqual(before);
    expect(history).toEqual(before);
  });

  it('does not depend on event, line or object-property insertion order', () => {
    const undo = inverse();
    undo.lines = undo.lines.reverse().map(item => Object.fromEntries(Object.entries(item).reverse()));
    const history = [cancel(), undo, ...measured().reverse()];
    const before = structuredClone(history);
    expect(events.assertMealCookingHistory?.(history, 'guest')).toEqual(before);
    expect(history).toEqual(before);
  });

  it('accepts account-scoped history without requiring original and reversal requests to match', () => {
    const history = [...measured(), inverse(), cancel()].map(item => ({ ...item, scope: 'user:alice' }));
    expect(events.assertMealCookingHistory?.(history, 'user:alice')).toEqual(history);
  });

  it.each([
    ['non-array input', () => ({})],
    ['sparse array', () => new Array(1)],
    ['receipt namespace', () => [{ ...unmeasured(), id: 'receipt:one', kind: 'receipt' }]],
    ['foreign scope', () => measured().map(item => ({ ...item, scope: 'user:alice' }))],
    ['duplicate event id', () => [...measured(), measured()[0]]],
    ['applied cooking without consumption', () => [measured()[0]]],
    ['consumption without cooking', () => [measured()[1]]],
    ['unmeasured cooking with consumption', () => [unmeasured('one'), measured()[1]]],
    ['different consumption slot', () => { const result = measured(); result[1].slotId = '2026-09-17:dinner'; return result; }],
    ['different consumption week', () => { const result = measured(); result[1].weekStart = '2026-09-21'; result[1].slotId = '2026-09-22:dinner'; return result; }],
    ['different consumption request', () => { const result = measured(); result[1].requestKey = '{"action":"changed"}'; return result; }],
    ['reversal without original consumption', () => [inverse()]],
    ['reversal for another cooking', () => [...measured(), inverse('undo', 'other')]],
    ['reversal on another slot', () => [...measured(), { ...inverse(), slotId: '2026-09-17:dinner' }]],
    ['reversal on another week', () => [...measured(), { ...inverse(), weekStart: '2026-09-21', slotId: '2026-09-22:dinner' }]],
    ['changed inverse amount', () => [...measured(), { ...inverse(), lines: [{ ...line(), amount: 100 }, line('second-batch')] }]],
    ['changed inverse batch', () => [...measured(), { ...inverse(), lines: [line('other-batch'), line('second-batch')] }]],
    ['changed inverse identity', () => [...measured(), { ...inverse(), lines: [{ ...line(), name: '두부', ingredientKey: 'food:두부' }, line('second-batch')] }]],
    ['changed inverse metadata', () => [...measured(), { ...inverse(), lines: [{ ...line(), note: 'changed payload' }, line('second-batch')] }]],
    ['missing inverse line', () => [...measured(), { ...inverse(), lines: [line()] }]],
    ['two reversals of one consumption', () => [...measured(), inverse(), inverse('another-undo')]],
    ['cancellation without cooking', () => [cancel()]],
    ['cancellation before consumption reversal', () => [...measured(), cancel()]],
    ['cancellation on another slot', () => [unmeasured(), { ...cancel('cancel', 'unknown'), slotId: '2026-09-17:dinner' }]],
    ['two cancellations of one cooking', () => [unmeasured(), cancel('cancel', 'unknown'), cancel('again', 'unknown')]],
    ['two active measured cookings of one slot', () => [...measured(), ...measured('two')]],
    ['two active unknown cookings of one slot', () => [unmeasured(), unmeasured('two')]],
    ['second cooking while the first has only consumption reversed', () => [...measured(), inverse(), ...measured('two')]],
  ])('rejects %s rather than acknowledging inconsistent history', (_label, make) => {
    let failure;
    try { events.assertMealCookingHistory?.(make(), 'guest'); } catch (error) { failure = error; }
    // Missing functionality is an assertion failure, never a throwing import/function false positive.
    expect(failure).toBeInstanceOf(Error);
  });
});

describe('atomic consumption correction history', () => {
  it.each([
    ['one replacement', () => [...measured(), ...correction()]],
    ['repeated replacement', () => { const first = correction(); return [...measured(), ...first, ...correction('again', first[1])]; }],
    ['zero actual use', () => [...measured(), ...correction('zero', measured()[1], [])]],
    ['replacement after zero use', () => { const zero = correction('zero', measured()[1], []); return [...measured(), ...zero, ...correction('again', zero[1])]; }],
    ['standalone reversal of latest replacement', () => { const pair = correction(); return [...measured(), ...pair, finalInverse(pair[1])]; }],
    ['standalone reversal of zero use', () => { const pair = correction('zero', measured()[1], []); return [...measured(), ...pair, finalInverse(pair[1])]; }],
    ['cancelled corrected cooking', () => { const pair = correction(); return [...measured(), ...pair, finalInverse(pair[1]), cancel()]; }],
    ['new cooking after corrected cancellation', () => { const pair = correction(); return [...measured(), ...pair, finalInverse(pair[1]), cancel(), ...measured('later')]; }],
  ])('accepts %s without mutating original events', (_label, build) => {
    const history = build();
    const before = structuredClone(history);
    expect(events.assertMealCookingHistory(history, 'guest')).toStrictEqual(before);
    expect(history).toStrictEqual(before);
  });

  it('follows reciprocal links regardless of event order or inverse line/property order', () => {
    const first = correction();
    first[0].lines = first[0].lines.reverse().map(item => Object.fromEntries(Object.entries(item).reverse()));
    const second = correction('again', first[1]);
    const history = [second[1], first[0], measured()[1], second[0], measured()[0], first[1]];
    expect(events.assertMealCookingHistory(history, 'guest')).toStrictEqual(history);
  });

  it.each([
    ['missing correction inverse', () => [...measured(), correction()[1]]],
    ['missing replacement consumption', () => [...measured(), correction()[0]]],
    ['inverse without reciprocal replacement pointer', () => { const pair = correction(); delete pair[0].replacementConsumptionId; return [...measured(), ...pair]; }],
    ['replacement points to different prior consumption', () => { const pair = correction(); pair[1].replacesId = 'consumption:other'; return [...measured(), ...pair]; }],
    ['mixed correction requests', () => { const pair = correction(); pair[1].requestKey = '{"action":"another"}'; return [...measured(), ...pair]; }],
    ['mixed correction scopes', () => { const pair = correction(); pair[1].scope = 'user:other'; return [...measured(), ...pair]; }],
    ['mixed correction slots', () => { const pair = correction(); pair[1].slotId = '2026-09-17:dinner'; return [...measured(), ...pair]; }],
    ['mixed correction cooking links', () => { const pair = correction(); pair[1].cookingId = 'cooking:other'; return [...measured(), ...pair]; }],
    ['changed original cooking pointer', () => { const history = [...measured(), ...correction()]; history[0].consumptionId = 'consumption:adjust'; return history; }],
    ['two replacements of one consumption', () => [...measured(), ...correction(), ...correction('branch')]],
    ['replacement after standalone reversal', () => [...measured(), inverse(), ...correction()]],
    ['replacement after cancelled cooking', () => [...measured(), inverse(), cancel(), ...correction()]],
    ['cancelled correction with latest consumption still applied', () => [...measured(), ...correction(), cancel()]],
    ['empty inverse for nonempty prior consumption', () => { const pair = correction(); pair[0].lines = []; return [...measured(), ...pair]; }],
    ['changed correction inverse amount', () => { const pair = correction(); pair[0].lines[0].amount = 149; return [...measured(), ...pair]; }],
    ['orphan cyclic replacement component', () => {
      const first = correction('cycle-a');
      const second = correction('cycle-b', first[1]);
      first[0].reversesId = second[1].id;
      first[0].lines = structuredClone(second[1].lines);
      first[1].replacesId = second[1].id;
      return [...measured(), ...first, ...second];
    }],
  ])('rejects %s', (_label, build) => {
    expect(() => events.assertMealCookingHistory(build(), 'guest')).toThrow();
  });
});

describe('current state of an immutable cooking history', () => {
  function state(history, id = 'cooking:one') {
    expect(events.getMealCookingState).toBeTypeOf('function');
    return events.getMealCookingState(history, id);
  }

  it('returns the original legacy cooking and its active consumption', () => {
    const history = measured();
    expect(state(history)).toStrictEqual({ cooking: history[0], consumption: history[1], reversal: null,
      cancelled: false, inventoryStatus: 'applied' });
  });

  it('returns unmeasured cooking without inventing inventory usage', () => {
    const cooking = unmeasured();
    expect(state([cooking], cooking.id)).toStrictEqual({ cooking, consumption: null, reversal: null,
      cancelled: false, inventoryStatus: 'needs-review' });
  });

  it('returns the latest consumption rather than a replaced consumption or intermediate reversal', () => {
    const original = measured();
    const first = correction();
    const second = correction('again', first[1]);
    const history = [...original, ...first, ...second].reverse();
    const before = structuredClone(history);
    expect(state(history)).toStrictEqual({ cooking: original[0], consumption: second[1], reversal: null,
      cancelled: false, inventoryStatus: 'applied' });
    expect(history).toStrictEqual(before);
  });

  it('keeps a zero-use correction applied until its latest consumption is explicitly reversed', () => {
    const original = measured();
    const pair = correction('zero', original[1], []);
    expect(state([...original, ...pair])).toStrictEqual({ cooking: original[0], consumption: pair[1], reversal: null,
      cancelled: false, inventoryStatus: 'applied' });
    const undo = finalInverse(pair[1]);
    expect(state([...original, ...pair, undo])).toStrictEqual({ cooking: original[0], consumption: pair[1], reversal: undo,
      cancelled: false, inventoryStatus: 'reversed' });
  });

  it('keeps cancellation distinct from a consumption-only reversal', () => {
    const original = measured();
    const pair = correction();
    const undo = finalInverse(pair[1]);
    expect(state([...original, ...pair, undo, cancel()])).toStrictEqual({ cooking: original[0], consumption: pair[1],
      reversal: undo, cancelled: true, inventoryStatus: 'reversed' });
    const unknown = unmeasured();
    expect(state([unknown, cancel('unknown-cancel', 'unknown')], unknown.id)).toStrictEqual({ cooking: unknown, consumption: null,
      reversal: null, cancelled: true, inventoryStatus: 'needs-review' });
  });

  it('validates all history before returning null for an unknown cooking id', () => {
    expect(state([], 'cooking:absent')).toBeNull();
    expect(state(measured(), 'cooking:absent')).toBeNull();
    expect(() => state([measured()[1]], 'cooking:absent')).toThrow();
    expect(() => state([...measured(), ...measured('other').map(item => ({ ...item, scope: 'user:other' }))], 'cooking:absent')).toThrow();
  });
});
