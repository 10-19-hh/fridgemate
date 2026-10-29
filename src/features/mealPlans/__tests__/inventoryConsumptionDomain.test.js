import { describe, expect, it } from 'vitest';
import * as consumption from '../inventoryConsumptionDomain';
import { createInventoryQuantityReview, getInventorySourceToken, projectInventoryQuantity } from '../inventoryQuantityDomain';

const NOW = '2026-09-16T08:00:00.000Z';
const SLOT = '2026-09-16:dinner';

function stock(id = 'chicken-one', amount = 300, unit = 'g', overrides = {}) {
  const ingredient = { id, clientId: id, name: '닭고기', quantity: `${amount}${unit}`, consumed: false,
    memo: '사용자 메모', expiryDate: '2026-09-23', storageType: '냉장', category: '육류',
    createdAt: '2026-09-14T08:00:00.000Z', updatedAt: '2026-09-14T08:00:00.000Z', syncState: 'synced', ...overrides };
  const review = createInventoryQuantityReview({ ingredient, scope: 'guest', revision: 2, now: NOW,
    values: { name: ingredient.name, amount, unit, preparationState: 'raw' } });
  return { ingredient, review, expectedRevision: 2, expectedSourceToken: getInventorySourceToken(ingredient) };
}
const input = (changes = [{ ...stock(), amount: 150, unit: 'g' }]) => ({ scope: 'guest', operationId: 'cook-one', slotId: SLOT, now: NOW, changes });
const project = (change) => projectInventoryQuantity(change.ingredient, change.review, 'guest');

describe('measured consumption prepared for an atomic commit', () => {
  it('deducts the actual 150g and preserves metadata and the input', () => {
    const request = input();
    const before = structuredClone(request);
    const result = consumption.prepareConsumption?.(request);
    expect(result?.changes[0].review.amount).toBe(150);
    expect(request).toEqual(before);
    expect(project(result.changes[0])).toMatchObject({ amount: 150, unit: 'g', quantityStatus: 'verified', consumed: false });
    expect(result.changes[0].ingredient).toMatchObject({ quantity: '150g', memo: '사용자 메모', expiryDate: '2026-09-23', syncState: 'pendingUpdate' });
    expect(result.event).toMatchObject({ schemaVersion: 1, kind: 'consumption', id: 'consumption:cook-one', scope: 'guest', slotId: SLOT,
      lines: [{ inventoryId: 'chicken-one', ingredientKey: 'food:닭고기', name: '닭고기', amount: 150, unit: 'g', preparationState: 'raw' }] });
  });

  it('adds only the inverse 150g to current 650g, preserving later additions and edits', () => {
    expect(consumption.prepareConsumption).toBeTypeOf('function');
    expect(consumption.prepareConsumptionReversal).toBeTypeOf('function');
    const originalEvent = consumption.prepareConsumption(input()).event;
    const request = { scope: 'guest', operationId: 'undo-one', originalEvent,
      inventory: [stock('chicken-one', 650, 'g', { memo: '나중 메모' }), stock('later-receipt', 500)], now: NOW };
    const before = structuredClone(request);
    const result = consumption.prepareConsumptionReversal(request);
    expect(result.changes).toHaveLength(1);
    expect(project(result.changes[0])).toMatchObject({ amount: 800, unit: 'g', memo: '나중 메모' });
    expect(result.event).toMatchObject({ kind: 'consumption-reversal', reversesId: 'consumption:cook-one', slotId: SLOT });
    expect(request).toEqual(before);
  });

  it.each([
    [0.3, 'g', 0.2, 'g', 0.1, 'g', 0.2],
    [0.3, 'kg', 150, 'g', 150, 'g', 150],
    [600, 'ml', 0.2, 'l', 400, 'ml', 200],
    [3, '개', 3, '개', 0, '개', 3],
  ])('subtracts %s%s minus %s%s without rounding or mixing dimensions', (have, unit, amount, usedUnit, remaining, canonical, delta) => {
    const result = consumption.prepareConsumption?.(input([{ ...stock('one', have, unit), amount, unit: usedUnit }]));
    expect(result?.changes[0].review).toMatchObject({ amount: remaining, unit: canonical, revision: 3 });
    expect(project(result.changes[0])).toMatchObject({ amount: remaining, quantityStatus: 'verified', consumed: false });
    expect(result.event.lines[0]).toMatchObject({ amount: delta, unit: canonical });
  });

  it('prepares every batch without losing pending creates or mutating inputs', () => {
    const request = input([{ ...stock('new', 300, 'g', { syncState: 'pendingCreate' }), amount: 150, unit: 'g' },
      { ...stock('other', 200), amount: 100, unit: 'g' }]);
    const before = structuredClone(request);
    const result = consumption.prepareConsumption?.(request);
    expect(result?.changes.map(change => change.ingredient.syncState)).toEqual(['pendingCreate', 'pendingUpdate']);
    expect(result.changes.map(change => project(change).amount)).toEqual([150, 100]);
    expect(request).toEqual(before);
  });

  it.each([0, -1, 301, NaN, Infinity, '150', null, 0.0001, Number.MAX_SAFE_INTEGER])('rejects invalid or excessive usage %s without changing stock', amount => {
    const request = input([{ ...stock(), amount, unit: 'g' }]);
    const before = structuredClone(request);
    expect(() => consumption.prepareConsumption?.(request)).toThrow();
    expect(request).toEqual(before);
  });

  it.each(['ml', '개', '봉', '__proto__'])('rejects incompatible or unsupported unit %s', unit => {
    expect(() => consumption.prepareConsumption?.(input([{ ...stock(), amount: 1, unit }]))).toThrow();
  });

  it.each([
    ['old revision', value => { value.expectedRevision = 1; }],
    ['old source', value => { value.expectedSourceToken = 'stale'; }],
    ['changed raw data', value => { value.ingredient.quantity = '새 포장'; }],
    ['unconfirmed', value => { value.review.status = 'unverified'; }],
    ['missing review', value => { value.review = null; }],
    ['consumed', value => { value.ingredient.consumed = true; }],
    ['deleted', value => { value.ingredient.deletedAt = NOW; }],
    ['foreign stock', value => { value.ingredient.scope = 'user:other'; }],
    ['foreign review', value => { value.review.scope = 'user:other'; }],
    ['revision overflow', value => { value.review.revision = Number.MAX_SAFE_INTEGER; value.expectedRevision = Number.MAX_SAFE_INTEGER; }],
  ])('rejects %s and leaves every earlier batch untouched', (_name, damage) => {
    const bad = { ...stock('bad'), amount: 10, unit: 'g' };
    damage(bad);
    const request = input([{ ...stock(), amount: 150, unit: 'g' }, bad]);
    const before = structuredClone(request);
    expect(() => consumption.prepareConsumption?.(request)).toThrow();
    expect(request).toEqual(before);
  });

  it.each([
    ['empty', () => []], ['sparse', () => new Array(1)],
    ['duplicate batch', () => [{ ...stock(), amount: 10, unit: 'g' }, { ...stock(), amount: 10, unit: 'g' }]],
  ])('rejects %s batch lists', (_name, changes) => {
    expect(() => consumption.prepareConsumption?.(input(changes()))).toThrow();
  });

  it.each([
    { scope: 'user:bad/id' }, { operationId: '' }, { operationId: 'has:colon' },
    { slotId: '2026-02-30:dinner' }, { slotId: '2026-09-16:lunch' }, { now: 'yesterday' },
  ])('rejects malformed request metadata %j', fields => {
    expect(() => consumption.prepareConsumption?.({ ...input(), ...fields })).toThrow();
  });
});

// Independent persisted-event fixture: undo must not depend on a snapshot of old stock.
const originalEvent = () => ({ schemaVersion: 1, id: 'consumption:cook-one', kind: 'consumption',
  operationId: 'cook-one', scope: 'guest', slotId: SLOT, createdAt: NOW,
  lines: [{ inventoryId: 'chicken-one', ingredientKey: 'food:닭고기', name: '닭고기', amount: 150, unit: 'g', preparationState: 'raw' }] });
const undoInput = () => ({ scope: 'guest', operationId: 'undo-one', originalEvent: originalEvent(), now: NOW,
  inventory: [stock('chicken-one', 0.1, 'kg')] });

describe('inverse measured consumption', () => {
  it('keeps subsequent consumption: 100g now plus reversed 150g is 250g, not the former 300g', () => {
    const request = undoInput();
    const before = structuredClone(request);
    const result = consumption.prepareConsumptionReversal?.(request);
    expect(result?.changes[0].review).toMatchObject({ amount: 250, unit: 'g', revision: 3 });
    expect(project(result.changes[0])).toMatchObject({ amount: 250, quantityStatus: 'verified' });
    expect(result.event).toMatchObject({ id: 'consumption-reversal:undo-one', kind: 'consumption-reversal', reversesId: 'consumption:cook-one' });
    expect(request).toEqual(before);
  });

  it.each([
    ['missing stock', request => { request.inventory = []; }],
    ['duplicate stock', request => { request.inventory.push(structuredClone(request.inventory[0])); }],
    ['different identity', request => { request.inventory = [stock('chicken-one', 100, 'g', { name: '두부' })]; }],
    ['different preparation', request => { request.inventory[0].review.preparationState = 'cooked'; }],
    ['different dimension', request => { request.inventory = [stock('chicken-one', 100, 'ml')]; }],
    ['deleted stock', request => { request.inventory[0].ingredient.deletedAt = NOW; }],
    ['stale stock', request => { request.inventory[0].expectedRevision = 1; }],
    ['unknown amount', request => { request.inventory[0].review.status = 'unverified'; }],
    ['another scope', request => { request.originalEvent.scope = 'user:other'; }],
    ['invalid event ID', request => { request.originalEvent.id = 'consumption:wrong'; }],
    ['invalid schema', request => { request.originalEvent.schemaVersion = 2; }],
    ['not a consumption', request => { request.originalEvent.kind = 'consumption-reversal'; }],
    ['zero event amount', request => { request.originalEvent.lines[0].amount = 0; }],
    ['invalid event identity', request => { request.originalEvent.lines[0].ingredientKey = 'food:두부'; }],
    ['invalid event time', request => { request.originalEvent.createdAt = 'invalid'; }],
    ['empty event', request => { request.originalEvent.lines = []; }],
    ['sparse event', request => { request.originalEvent.lines = new Array(1); }],
    ['duplicate event batch', request => { request.originalEvent.lines.push({ ...request.originalEvent.lines[0] }); }],
  ])('rejects %s instead of silently restoring an old snapshot', (_name, damage) => {
    const request = undoInput();
    damage(request);
    const before = structuredClone(request);
    expect(() => consumption.prepareConsumptionReversal?.(request)).toThrow();
    expect(request).toEqual(before);
  });
});
