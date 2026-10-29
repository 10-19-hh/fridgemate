import { describe, expect, it } from 'vitest';
import * as form from '../mealCookingForm';
import { createInventoryQuantityReview, projectInventoryQuantity } from '../inventoryQuantityDomain';

const NOW = '2026-09-21T09:00:00.000Z';
const line = (patch = {}) => ({ id: 'chicken', rawName: '닭고기', ingredientKey: 'food:닭고기', preparationState: 'raw',
  amount: 200, unit: 'g', quantityStatus: 'verified', quantityEvidence: 'fixture:200g', optional: false, selected: true, ...patch });
function slot(lines = [line()], processInputs = []) {
  return { id: '2026-09-21:dinner', date: '2026-09-21', title: '닭고기 저녁', servings: 1, components: [{
    id: 'dish', source: { id: 'fixture' }, recipeVersion: '1', servings: 1, servingsStatus: 'verified', ingredients: lines, processInputs,
  }] };
}
function batch(id = 'chicken', values = {}, raw = {}) {
  const ingredient = { id, name: '닭고기', quantity: '300g', consumed: false, expiryDate: '2026-09-30', storageType: '냉장', updatedAt: NOW, ...raw };
  const review = createInventoryQuantityReview({ ingredient, scope: 'guest', revision: 2, now: NOW,
    values: { name: '닭고기', amount: 300, unit: 'g', preparationState: 'raw', ...values } });
  return projectInventoryQuantity(ingredient, review, 'guest');
}

describe('honest cooking quantity proposals', () => {
  it('proposes a complete reviewed 200g requirement once for an unambiguous verified batch', () => {
    const meal = slot(); const inventory = [batch()];
    const before = structuredClone({ meal, inventory });
    const model = form.createMealCookingFormModel?.(meal, inventory);
    expect(model?.rows).toEqual([expect.objectContaining({ ingredientId: 'chicken', name: '닭고기', availableAmount: 300,
      unit: 'g', initialAmount: '200', expectedRevision: 2, expectedSourceToken: inventory[0].sourceToken })]);
    expect(model.requirements).toEqual([expect.objectContaining({ label: '닭고기', amount: 200, knownAmount: 200, unit: 'g' })]);
    expect({ meal, inventory }).toEqual(before);
  });

  it('converts only compatible units to the confirmed batch unit', () => {
    expect(form.createMealCookingFormModel?.(slot(), [batch('kg', { amount: 0.3, unit: 'kg' })])?.rows[0].initialAmount).toBe('0.2');
  });

  it.each([
    ['multiple compatible batches', () => [batch('one'), batch('two')]],
    ['insufficient current stock', () => [batch('one', { amount: 100 })]],
    ['another preparation', () => [batch('one', { preparationState: 'cooked' })]],
    ['another dimension', () => [batch('one', { unit: 'ml' })]],
    ['another exact identity', () => [batch('one', { name: '닭 가슴살' })]],
    ['unknown expiry', () => [batch('one', {}, { expiryDate: '' })]],
    ['past expiry', () => [batch('one', {}, { expiryDate: '2026-09-20' })]],
  ])('leaves actual entries blank for %s', (_label, inventory) => {
    expect(form.createMealCookingFormModel?.(slot(), inventory())?.rows.map(row => row.initialAmount)).toEqual(inventory().map(() => ''));
  });

  it.each([
    ['unconfirmed', item => ({ ...item, quantityStatus: 'unverified', amount: null })],
    ['stale raw source', item => ({ ...item, quantity: 'changed' })],
    ['consumed', item => ({ ...item, consumed: true })],
    ['deleted', item => ({ ...item, deletedAt: NOW })],
    ['zero remaining', () => batch('empty', { amount: 0 })],
    ['invalid revision', item => ({ ...item, quantityRevision: 0 })],
  ])('never submits a %s batch as measured stock', (_label, mutate) => {
    const model = form.createMealCookingFormModel?.(slot(), [mutate(batch())]);
    expect(model?.rows).toEqual([]);
    expect(model.unavailableCount).toBe(1);
  });

  it('shows known subtotal and unresolved original labels without proposing the partial amount', () => {
    const meal = slot([line(), line({ id: 'sauce', rawName: '소스에 쓰는 닭고기', amount: null, quantityStatus: 'unverified' })]);
    const model = form.createMealCookingFormModel?.(meal, [batch()]);
    expect(model?.requirements[0]).toMatchObject({ amount: null, knownAmount: 200 });
    expect(model.unresolved).toContainEqual(expect.objectContaining({ label: '소스에 쓰는 닭고기' }));
    expect(model.rows[0].initialAmount).toBe('');
  });

  it('keeps process inputs visible and blocks false full proposals for unknown identity', () => {
    const model = form.createMealCookingFormModel?.(slot([line()], [{ id: 'wash', name: '원문 세척용 재료', ingredientKey: null, amount: null, unit: null }]), [batch()]);
    expect(model?.unresolved).toContainEqual(expect.objectContaining({ label: '원문 세척용 재료', process: true }));
    expect(model.requirements[0]).toMatchObject({ amount: null, knownAmount: 200 });
    expect(model.rows[0].initialAmount).toBe('');
  });

  it('keeps unselected optional rows separate without adding their amount', () => {
    const model = form.createMealCookingFormModel?.(slot([line(), line({ id: 'optional', rawName: '선택 닭고기', amount: 50, optional: true, selected: false })]), [batch()]);
    expect(model?.optional).toEqual([expect.objectContaining({ label: '선택 닭고기' })]);
    expect(model.rows[0].initialAmount).toBe('200');
  });

  it('preserves the established mandatory-row policy even if selected is false', () => {
    expect(form.createMealCookingFormModel?.(slot([line({ selected: false })]), [batch()])?.rows[0].initialAmount).toBe('200');
  });

  it('uses reviewed identity rather than unrelated raw name or recommendation aliases', () => {
    const model = form.createMealCookingFormModel?.(slot(), [batch('one', {}, { name: '포장에 적힌 이름' })]);
    expect(model?.rows[0]).toMatchObject({ name: '닭고기', initialAmount: '200' });
  });
});

describe('explicit actual-use payload', () => {
  it('passes actual 150g and captured optimistic concurrency tokens instead of planned 200g', () => {
    const inventory = [batch()];
    const model = form.createMealCookingFormModel?.(slot(), inventory);
    expect(form.createMealCookingPayload?.(model, { chicken: '150' }, true)).toEqual({ usageMode: 'measured', completeUsageConfirmed: true,
      usages: [{ ingredientId: 'chicken', amount: 150, unit: 'g', expectedRevision: 2, expectedSourceToken: inventory[0].sourceToken }] });
  });

  it('includes actual alternative and multiple batches while omitting blank and zero entries', () => {
    const inventory = [batch('one'), batch('two'), batch('alternative', { name: '두부' }), batch('unused')];
    const model = form.createMealCookingFormModel?.(slot(), inventory);
    const result = form.createMealCookingPayload?.(model, { one: '100', two: '0', alternative: '50', unused: '' }, true);
    expect(result?.usages).toEqual([
      { ingredientId: 'one', amount: 100, unit: 'g', expectedRevision: 2, expectedSourceToken: inventory[0].sourceToken },
      { ingredientId: 'alternative', amount: 50, unit: 'g', expectedRevision: 2, expectedSourceToken: inventory[2].sourceToken },
    ]);
  });

  it.each([
    ['empty list', {}, true], ['only zero', { chicken: '0' }, true], ['negative', { chicken: '-1' }, true],
    ['overdraw', { chicken: '301' }, true], ['text', { chicken: 'one' }, true], ['infinite', { chicken: 'Infinity' }, true],
    ['precision loss', { chicken: '0.0001' }, true], ['unconfirmed full usage', { chicken: '150' }, false],
  ])('rejects %s before requesting persistence', (_label, amounts, confirmed) => {
    let failure;
    try { form.createMealCookingPayload?.(form.createMealCookingFormModel?.(slot(), [batch()]), amounts, confirmed); } catch (error) { failure = error; }
    expect(failure).toBeInstanceOf(Error);
  });
});
