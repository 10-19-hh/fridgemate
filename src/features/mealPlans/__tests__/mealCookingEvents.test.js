import { describe, expect, it } from 'vitest';
import * as events from '../mealCookingEvents';

const line = () => ({ inventoryId: 'batch-one', ingredientKey: 'food:닭고기', name: '닭 고기',
  amount: 150, unit: 'g', preparationState: 'raw' });
const event = (kind = 'cooking') => ({ schemaVersion: 1, kind, id: `${kind}:one`, operationId: 'one', scope: 'guest',
  slotId: '2026-09-16:dinner', weekStart: '2026-09-14', createdAt: '2026-09-19T08:00:00.000Z', requestKey: '{"actual":150}',
  ...(kind === 'cooking' ? { inventoryStatus: 'applied', consumptionId: 'consumption:one' }
    : kind === 'consumption' ? { cookingId: 'cooking:one', lines: [line()] }
      : kind === 'consumption-reversal' ? { cookingId: 'cooking:original', reversesId: 'consumption:original', lines: [line()] }
        : { reversesId: 'cooking:original' }) });

describe('local cooking event validation', () => {
  it.each(['cooking', 'consumption', 'consumption-reversal', 'cooking-reversal'])('accepts %s without changing stored history', kind => {
    const saved = event(kind);
    const before = structuredClone(saved);
    expect(events.assertMealCookingEvent?.(saved, 'guest')).toEqual(before);
    expect(saved).toEqual(before);
  });

  it('accepts unmeasured cooking without inventing a consumption event', () => {
    const saved = { ...event(), inventoryStatus: 'needs-review', consumptionId: null, localContext: 'kept' };
    expect(events.assertMealCookingEvent?.(saved, 'guest')).toEqual(saved);
  });

  it('accepts scoped account history and canonical positive fractional quantities', () => {
    const saved = { ...event('consumption'), scope: 'user:alice_1-2', lines: [
      { ...line(), amount: 0.001, unit: 'ml', preparationState: 'cooked' },
      { ...line(), inventoryId: 'batch-two', amount: 0.5, unit: '개', preparationState: 'as-sold' },
    ] };
    expect(events.assertMealCookingEvent?.(saved, 'user:alice_1-2')).toEqual(saved);
  });

  it.each([{ lines: [line()] }, { lines: [] }])('accepts a replacement consumption, including an explicitly confirmed zero usage: %j', ({ lines }) => {
    const saved = { ...event('consumption'), cookingId: 'cooking:original', replacesId: 'consumption:original', lines };
    const before = structuredClone(saved);
    expect(events.assertMealCookingEvent(saved, 'guest')).toStrictEqual(before);
    expect(saved).toStrictEqual(before);
  });

  it.each([{ lines: [line()] }, { lines: [] }])('accepts the inverse of a replacement consumption without requiring the initial operation suffix: %j', ({ lines }) => {
    const saved = { ...event('consumption-reversal'), reversesId: 'consumption:corrected', lines };
    expect(events.assertMealCookingEvent(saved, 'guest')).toStrictEqual(saved);
  });

  it('accepts an atomic correction inverse linked to its same-operation replacement', () => {
    const saved = { ...event('consumption-reversal'), replacementConsumptionId: 'consumption:one' };
    expect(events.assertMealCookingEvent(saved, 'guest')).toStrictEqual(saved);
  });

  it.each([
    ['replacement with wrong prior namespace', { kind: 'consumption', cookingId: 'cooking:original', replacesId: 'cooking:original' }],
    ['replacement without prior id', { kind: 'consumption', replacesId: null }],
    ['replacement with undefined prior id', { kind: 'consumption', replacesId: undefined }],
    ['self-replacement', { kind: 'consumption', replacesId: 'consumption:one' }],
    ['replacement without original cooking id', { kind: 'consumption', cookingId: 'cooking:', replacesId: 'consumption:original' }],
    ['inverse with another operation replacement', { kind: 'consumption-reversal', replacementConsumptionId: 'consumption:other' }],
    ['inverse with null replacement', { kind: 'consumption-reversal', replacementConsumptionId: null }],
    ['inverse with undefined replacement', { kind: 'consumption-reversal', replacementConsumptionId: undefined }],
    ['replacement pointer on original cooking', { kind: 'cooking', replacesId: 'consumption:original' }],
    ['inverse replacement pointer on consumption', { kind: 'consumption', replacementConsumptionId: 'consumption:other' }],
  ])('rejects malformed correction metadata: %s', (_label, patch) => {
    const saved = { ...event(patch.kind), ...patch };
    expect(() => events.assertMealCookingEvent(saved, 'guest')).toThrow();
  });

  it.each([
    ['foreign scope', saved => { saved.scope = 'user:alice'; }],
    ['unsupported scope', saved => { saved.scope = 'guest/other'; }, 'guest/other'],
    ['schema', saved => { saved.schemaVersion = 2; }],
    ['unknown kind', saved => { saved.kind = 'made-up'; }],
    ['receipt namespace', saved => { saved.id = 'receipt:one'; }],
    ['other operation id', saved => { saved.id = 'cooking:two'; }],
    ['unsafe operation id', saved => { saved.operationId = '../one'; saved.id = 'cooking:../one'; }],
    ['empty operation id', saved => { saved.operationId = ''; saved.id = 'cooking:'; }],
    ['long operation id', saved => { saved.operationId = 'a'.repeat(121); saved.id = `cooking:${saved.operationId}`; }],
    ['invalid slot day', saved => { saved.slotId = '2026-02-30:dinner'; }],
    ['invalid meal', saved => { saved.slotId = '2026-09-16:lunch'; }],
    ['non-Monday week', saved => { saved.weekStart = '2026-09-15'; }],
    ['other week', saved => { saved.weekStart = '2026-09-21'; }],
    ['invalid week day', saved => { saved.weekStart = '2026-02-30'; }],
    ['noncanonical time', saved => { saved.createdAt = '2026-09-19T08:00:00Z'; }],
    ['invalid time', saved => { saved.createdAt = 'never'; }],
    ['empty request', saved => { saved.requestKey = ''; }],
    ['invalid request JSON', saved => { saved.requestKey = '{'; }],
    ['array request', saved => { saved.requestKey = '[]'; }],
    ['null request', saved => { saved.requestKey = 'null'; }],
    ['scalar request', saved => { saved.requestKey = '1'; }],
    ['receipt index contamination', saved => { saved.purchaseNoteId = 'purchase:one'; }],
    ['null receipt index field', saved => { saved.purchaseNoteId = null; }],
    ['undefined receipt index field', saved => { saved.purchaseNoteId = undefined; }],
    ['unknown inventory status', saved => { saved.inventoryStatus = 'reversed'; }],
    ['wrong consumption link', saved => { saved.consumptionId = 'consumption:two'; }],
    ['missing applied consumption', saved => { saved.consumptionId = null; }],
    ['unmeasured consumption link', saved => { saved.inventoryStatus = 'needs-review'; }],
  ])('rejects %s', (_label, mutate, scope = 'guest') => {
    const saved = event(); mutate(saved);
    expect(events.assertMealCookingEvent).toBeTypeOf('function');
    expect(() => events.assertMealCookingEvent(saved, scope)).toThrow();
  });

  it.each([
    ['no lines', saved => { saved.lines = []; }],
    ['sparse lines', saved => { saved.lines = new Array(1); }],
    ['duplicate batch', saved => { saved.lines.push(line()); }],
    ['empty batch', saved => { saved.lines[0].inventoryId = ' '; }],
    ['wrong identity', saved => { saved.lines[0].ingredientKey = 'food:소고기'; }],
    ['noncanonical unit', saved => { saved.lines[0].unit = 'kg'; }],
    ['unsupported unit', saved => { saved.lines[0].unit = '팩'; }],
    ['zero amount', saved => { saved.lines[0].amount = 0; }],
    ['negative amount', saved => { saved.lines[0].amount = -1; }],
    ['nonfinite amount', saved => { saved.lines[0].amount = Infinity; }],
    ['text amount', saved => { saved.lines[0].amount = '150'; }],
    ['unsupported precision', saved => { saved.lines[0].amount = 0.0001; }],
    ['overflow amount', saved => { saved.lines[0].amount = Number.MAX_SAFE_INTEGER; }],
    ['unknown preparation', saved => { saved.lines[0].preparationState = 'unknown'; }],
    ['incorrect cooking link', saved => { saved.cookingId = 'cooking:two'; }],
  ])('rejects consumption with %s', (_label, mutate) => {
    const saved = event('consumption'); mutate(saved);
    expect(events.assertMealCookingEvent).toBeTypeOf('function');
    expect(() => events.assertMealCookingEvent(saved, 'guest')).toThrow();
  });

  it.each([
    ['consumption-reversal', { reversesId: 'consumption:bad/id' }],
    ['consumption-reversal', { cookingId: 'cooking:' }],
    ['consumption-reversal', { reversesId: 'receipt:original' }],
    ['consumption-reversal', { lines: [ { ...line(), amount: 0 } ] }],
    ['cooking-reversal', { reversesId: 'cooking:' }],
    ['cooking-reversal', { reversesId: 'consumption:original' }],
    ['cooking-reversal', { reversesId: 'cooking:bad/id' }],
  ])('rejects a malformed %s link or quantity %#', (kind, patch) => {
    expect(events.assertMealCookingEvent).toBeTypeOf('function');
    expect(() => events.assertMealCookingEvent({ ...event(kind), ...patch }, 'guest')).toThrow();
  });

  it.each([
    ['cooking:one', true], ['consumption:one', true], ['consumption-reversal:one', true], ['cooking-reversal:one', true],
    ['cooking:', true], ['cooking:bad/id', true], ['receipt:one', false], ['unknown:one', false],
    ['cooking-prefix:one', false], [null, false], [12, false],
  ])('routes %s only to its known namespace, leaving payload checks to the validator', (id, expected) => {
    expect(events.isMealCookingEventId?.(id)).toBe(expected);
  });
});
