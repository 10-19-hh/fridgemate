import { describe, expect, it } from 'vitest';
import { createInventoryQuantityReview, projectInventoryQuantity } from '../inventoryQuantityDomain';
import { createMealConsumptionCorrectionModel, createMealConsumptionCorrectionPayload, getMealConsumptionCorrectionPreview } from '../mealConsumptionCorrectionForm';

function batch(id = 'old', amount = 150, unit = 'g') {
  const ingredient = { id, name: '닭고기', quantity: `${amount}${unit}`, consumed: false, updatedAt: '2026-09-21T09:00:00Z' };
  return projectInventoryQuantity(ingredient, createInventoryQuantityReview({ ingredient, scope: 'guest', revision: 3, now: '2026-09-21T09:00:00.000Z',
    values: { name: '닭고기', amount, unit, preparationState: 'raw' } }), 'guest');
}
const consumption = (amount = 150) => ({ id: 'latest-consumption', kind: 'consumption', lines: [
  { inventoryId: 'old', ingredientKey: 'food:닭고기', name: '닭고기', amount, unit: 'g', preparationState: 'raw' },
] });

describe('consumption correction form arithmetic and current-stock checks', () => {
  it('prefills the recorded usage only and previews current + recorded - replacement without writes', () => {
    const inventory = [batch(), batch('later', 500)]; const before = structuredClone(inventory);
    const model = createMealConsumptionCorrectionModel(consumption(), inventory);
    expect(model.rows.map(row => row.initialAmount)).toEqual(['150', '']);
    expect(getMealConsumptionCorrectionPreview(model, { old: '100', later: '' }).map(row => row.remainingAmount)).toEqual([200, 500]);
    expect(inventory).toEqual(before);
    expect(createMealConsumptionCorrectionPayload(model, { old: '100', later: '' }, true)).toEqual({
      expectedConsumptionId: 'latest-consumption', completeUsageConfirmed: true,
      inventory: [{ ingredientId: 'old', expectedRevision: 3, expectedSourceToken: inventory[0].sourceToken }],
      usages: [{ ingredientId: 'old', expectedRevision: 3, expectedSourceToken: inventory[0].sourceToken, amount: 100, unit: 'g' }],
    });
  });

  it('allows confirmed all-zero usage and allows adding usage after a previously empty correction', () => {
    const model = createMealConsumptionCorrectionModel(consumption(), [batch()]);
    expect(createMealConsumptionCorrectionPayload(model, { old: '0' }, true).usages).toEqual([]);
    expect(getMealConsumptionCorrectionPreview(model, { old: '0' })[0].remainingAmount).toBe(300);
    const empty = createMealConsumptionCorrectionModel({ ...consumption(), lines: [] }, [batch('new', 50)]);
    expect(createMealConsumptionCorrectionPayload(empty, { new: '20' }, true)).toMatchObject({ inventory: [], usages: [{ amount: 20 }] });
  });

  it('permits zero remaining original stock and converts canonical old grams to the current kilograms', () => {
    const model = createMealConsumptionCorrectionModel(consumption(300), [batch('old', 0, 'kg')]);
    expect(model.blockedReason).toBe(''); expect(model.rows[0].initialAmount).toBe('0.3');
    expect(getMealConsumptionCorrectionPreview(model, { old: '0.1' })[0].remainingAmount).toBe(0.2);
    expect(createMealConsumptionCorrectionPayload(model, { old: '0.1' }, true).usages[0]).toMatchObject({ amount: 0.1, unit: 'kg' });
  });

  it('moves actual usage to a newly chosen stock without silently splitting batches', () => {
    const model = createMealConsumptionCorrectionModel(consumption(), [batch(), batch('new', 500)]);
    expect(getMealConsumptionCorrectionPreview(model, { old: '0', new: '100' }).map(row => row.remainingAmount)).toEqual([300, 400]);
    expect(createMealConsumptionCorrectionPayload(model, { old: '0', new: '100' }, true).usages.map(row => row.ingredientId)).toEqual(['new']);
  });

  it.each(['missing', 'consumed', 'unverified', 'name', 'preparation', 'unit', 'source'])('blocks the entire correction when old stock is %s', kind => {
    const row = batch();
    const changes = { consumed: { consumed: true }, unverified: { quantityStatus: 'unverified' }, name: { ingredientKey: 'food:다른재료' },
      preparation: { preparationState: 'cooked' }, unit: { unit: 'ml' }, source: { sourceToken: 'stale' } };
    const inventory = kind === 'missing' ? [] : [{ ...row, ...changes[kind] }];
    const model = createMealConsumptionCorrectionModel(consumption(), inventory);
    expect(model.blockedReason).toMatch(/원래 사용한 재고/);
    expect(() => createMealConsumptionCorrectionPayload(model, { old: '0' }, true)).toThrow(/원래 사용한 재고/);
  });

  it('requires reconfirmation and rejects overdraft, negative and unsupported precision', () => {
    const model = createMealConsumptionCorrectionModel(consumption(), [batch()]);
    expect(() => createMealConsumptionCorrectionPayload(model, { old: '100' }, false)).toThrow(/모두 확인/);
    expect(() => createMealConsumptionCorrectionPayload(model, { old: '301' }, true)).toThrow(/많아요/);
    expect(() => createMealConsumptionCorrectionPayload(model, { old: '-1' }, true)).toThrow();
    expect(() => createMealConsumptionCorrectionPayload(model, { old: '0.0001' }, true)).toThrow();
  });

  it('preserves decimal precision in the readonly preview', () => {
    const model = createMealConsumptionCorrectionModel(consumption(0.2), [batch('old', 0.1)]);
    expect(getMealConsumptionCorrectionPreview(model, { old: '0.1' })[0].remainingAmount).toBe(0.2);
  });
});
