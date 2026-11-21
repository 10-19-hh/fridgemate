import { describe, expect, it } from 'vitest';
import { calculateScaledCooking } from '../scaledCooking.js';
import { makeAvailabilitySnapshot, makeAvailableItem, makeQuantityLine, makeQuantityRecipe } from './fixtures/scaledCookingFixtures.js';

function calculate(recipe = makeQuantityRecipe(), inventory = makeAvailabilitySnapshot(), targetServings = 2) {
  return calculateScaledCooking({ recipe, inventory, targetServings });
}

describe('scaled cooking: synthetic quantities, no storage or catalog mutation', () => {
  it('uses the limiting core amount for every selected recipe line', () => {
    const result = calculate();
    expect(result).toMatchObject({ status: 'scaled', scaleFactor: 0.67, requirementsStatus: 'satisfied' });
    expect(result.ingredients).toMatchObject([
      { lineId: 'pork-main', requestedAmount: 300, scaledAmount: 201, unit: 'g' },
      { lineId: 'onion-main', requestedAmount: 100, scaledAmount: 67, unit: 'g' },
    ]);
    expect(result.limitingIngredients).toMatchObject([{ foodId: 'pork-front-leg', requiredAmount: 300, availableAmount: 201 }]);
  });

  it('scales from verified source servings once, and never enlarges beyond the requested amount', () => {
    const result = calculate(undefined, undefined, 1);
    expect(result).toMatchObject({ status: 'original', scaleFactor: 1 });
    expect(result.ingredients.map((line) => line.scaledAmount)).toEqual([150, 50]);
  });

  it('does not turn an absent item or an unknown quantity into confirmed zero', () => {
    for (const items of [[], [makeAvailableItem({ amount: null, quantityStatus: 'unknown' })]]) {
      const result = calculate(undefined, makeAvailabilitySnapshot({ items }));
      expect(result).toMatchObject({ status: 'needs-confirmation', scaleFactor: null });
      expect(result.ingredients.every((line) => line.scaledAmount === null)).toBe(true);
    }
  });

  it('treats an explicitly confirmed zero as unavailable, not a small positive recipe', () => {
    const inventory = makeAvailabilitySnapshot();
    inventory.items[0].amount = 0;
    expect(calculate(undefined, inventory)).toMatchObject({ status: 'unavailable', scaleFactor: 0 });
  });

  it('keeps very small positive scales without a product cutoff', () => {
    const inventory = makeAvailabilitySnapshot();
    inventory.items[0].amount = 0.000003;
    const result = calculate(undefined, inventory);
    expect(result.status).toBe('scaled');
    expect(result.scaleFactor).toBeCloseTo(0.00000001, 16);
    expect(result.ingredients[0].scaledAmount).toBeCloseTo(0.000003, 12);
  });

  it('sums compatible repeated uses before calculating without losing source sections', () => {
    const recipe = makeQuantityRecipe();
    recipe.ingredients.push(makeQuantityLine({ id: 'pork-sauce', section: 'sauce', role: 'other', amount: 100 }));
    const result = calculate(recipe);
    expect(result.scaleFactor).toBe(0.5025);
    expect(result.ingredients.map((line) => line.lineId)).toEqual(['pork-main', 'onion-main', 'pork-sauce']);
    expect(result.ingredients[0].scaledAmount).toBeCloseTo(150.75, 12);
    expect(result.ingredients[1].scaledAmount).toBeCloseTo(50.25, 12);
    expect(result.ingredients[2].scaledAmount).toBeCloseTo(50.25, 12);
    expect(result.limitingIngredients[0].requiredAmount).toBe(400);
  });

  it('does not borrow from the wrong ingredient, preparation state or unit', () => {
    for (const overrides of [
      { foodId: 'pork-belly' }, { preparationState: 'cooked' }, { unit: 'ml' },
      { amount: null, unit: null, quantityStatus: 'unknown', rawText: '반 모' },
    ]) {
      const inventory = makeAvailabilitySnapshot();
      inventory.items[0] = makeAvailableItem(overrides);
      expect(calculate(undefined, inventory)).toMatchObject({ status: 'needs-confirmation', scaleFactor: null });
    }
  });

  it('keeps mandatory seasoning shortages separate from core scaling', () => {
    const recipe = makeQuantityRecipe();
    recipe.ingredients.push(makeQuantityLine({ id: 'soy-sauce', foodId: 'soy-sauce', rawName: '간장', role: 'seasoning', amount: 10, unit: 'ml' }));
    const inventory = makeAvailabilitySnapshot();
    inventory.items.push(makeAvailableItem({ id: 'soy-batch', foodId: 'soy-sauce', amount: 0, unit: 'ml' }));
    const result = calculate(recipe, inventory);
    expect(result).toMatchObject({ status: 'scaled', scaleFactor: 0.67, requirementsStatus: 'missing' });
    expect(result.checks).toContainEqual(expect.objectContaining({ foodId: 'soy-sauce', reason: 'insufficient', requiredAmount: 6.7, availableAmount: 0 }));
  });

  it('does not invent numeric amounts for unknown seasonings or include unselected garnishes', () => {
    const recipe = makeQuantityRecipe();
    recipe.ingredients.push(
      makeQuantityLine({ id: 'salt', foodId: 'salt', rawName: '소금', role: 'seasoning', amount: null, unit: null, quantityStatus: 'unknown', quantityEvidence: null }),
      makeQuantityLine({ id: 'garnish', foodId: 'sesame', role: 'other', amount: 10, selected: false, required: false }),
    );
    const result = calculate(recipe);
    expect(result).toMatchObject({ status: 'scaled', requirementsStatus: 'needs-confirmation' });
    expect(result.ingredients.find((line) => line.lineId === 'salt').scaledAmount).toBeNull();
    expect(result.ingredients.find((line) => line.lineId === 'garnish')).toBeUndefined();
  });

  it('preserves originals, snapshots and version evidence over repeated independent calculations', () => {
    const recipe = makeQuantityRecipe();
    const inventory = makeAvailabilitySnapshot();
    const before = structuredClone({ recipe, inventory });
    const first = calculate(recipe, inventory);
    expect(first.ingredients).toMatchObject([{ scaledAmount: 201 }, { scaledAmount: 67 }]);
    first.ingredients[0].scaledAmount = 1;
    const second = calculate(recipe, inventory);
    expect(second.ingredients[0].scaledAmount).toBe(201);
    expect({ recipe, inventory }).toEqual(before);
    expect(second.basis).toMatchObject({ recipeId: recipe.id, recipeVersion: 'test-v1', targetServings: 2, inventory: { scope: 'guest', revision: 'inventory-test-v1' } });
    inventory.items[0].amount = 150;
    inventory.revision = 'inventory-test-v2';
    expect(calculate(recipe, inventory)).toMatchObject({ scaleFactor: 0.5, basis: { inventory: { revision: 'inventory-test-v2' } } });
  });

  it('does not claim a maximum available quantity while another allocation is unknown', () => {
    const inventory = makeAvailabilitySnapshot();
    inventory.items[0].availabilityStatus = 'unknown';
    expect(calculate(undefined, inventory)).toMatchObject({ status: 'needs-confirmation', scaleFactor: null });
  });

  it('does not treat raw stock totals as a confirmed per-meal allocation', () => {
    expect(calculate(undefined, makeAvailabilitySnapshot({ basis: 'raw-stock' }))).toMatchObject({ status: 'needs-confirmation', scaleFactor: null });
  });

  it('sums separate confirmed batches but does not hide another unconfirmed matching batch', () => {
    const inventory = makeAvailabilitySnapshot();
    inventory.items.push(makeAvailableItem({ id: 'pork-second-batch', amount: 99 }));
    expect(calculate(undefined, inventory).scaleFactor).toBe(0.8);
    inventory.items.push(makeAvailableItem({ id: 'pork-unknown-batch', amount: null, quantityStatus: 'unknown' }));
    expect(calculate(undefined, inventory)).toMatchObject({ status: 'needs-confirmation', scaleFactor: null });
  });

  it('does not claim a maximum when another batch of the same food has unknown preparation state', () => {
    const inventory = makeAvailabilitySnapshot();
    inventory.items.push(makeAvailableItem({ id: 'pork-unknown-state', preparationState: 'unknown', amount: 100 }));
    expect(calculate(undefined, inventory)).toMatchObject({ status: 'needs-confirmation', scaleFactor: null });
  });

  it('rejects duplicate stock IDs instead of counting the same batch twice', () => {
    const inventory = makeAvailabilitySnapshot();
    inventory.items.push({ ...inventory.items[0] });
    expect(calculate(undefined, inventory)).toMatchObject({ status: 'invalid', scaleFactor: null });
  });

  it.each([-1, NaN, Infinity, '201'])('rejects malformed stock amount %s', (amount) => {
    const inventory = makeAvailabilitySnapshot();
    inventory.items[0].amount = amount;
    expect(calculate(undefined, inventory)).toMatchObject({ status: 'invalid', scaleFactor: null });
  });

  it('requires per-batch confirmation evidence rather than trusting a parent snapshot flag', () => {
    const inventory = makeAvailabilitySnapshot();
    delete inventory.items[0].confirmedAt;
    expect(calculate(undefined, inventory)).toMatchObject({ status: 'needs-confirmation', scaleFactor: null });
  });

  it('excludes unavailable batches and carries allocation version evidence', () => {
    const inventory = makeAvailabilitySnapshot({ basis: 'allocated', allocationRevision: 'allocation-v2' });
    inventory.items[0].availabilityStatus = 'unavailable';
    expect(calculate(undefined, inventory)).toMatchObject({
      status: 'unavailable', scaleFactor: 0,
      basis: { inventory: { basis: 'allocated', allocationRevision: 'allocation-v2' } },
    });
    delete inventory.allocationRevision;
    expect(calculate(undefined, inventory)).toMatchObject({ status: 'needs-confirmation', scaleFactor: null });
  });

  it('leaves unreviewed legacy recipes on a confirmation path instead of inventing servings', () => {
    expect(calculate({ id: 'legacy', coreIngredients: ['돼지고기', '양파'], servings: 1 })).toMatchObject({
      status: 'needs-confirmation', scaleFactor: null,
    });
  });

  it('does not report a seasoning-style shortage caused solely by floating-point multiplication', () => {
    const inventory = makeAvailabilitySnapshot();
    inventory.items[0].amount = 0.1;
    expect(calculate(undefined, inventory)).toMatchObject({ status: 'scaled', requirementsStatus: 'satisfied', checks: [] });
  });

  it('does not invent zero availability when a positive ratio is outside numeric range', () => {
    const recipe = makeQuantityRecipe({ ingredients: [makeQuantityLine({ amount: 1e300 })] });
    const inventory = makeAvailabilitySnapshot({ items: [makeAvailableItem({ amount: 1e-300 })] });
    expect(calculate(recipe, inventory)).toMatchObject({ status: 'invalid', scaleFactor: null });
  });

  it('does not turn a positive non-core scaled amount into zero on underflow', () => {
    const recipe = makeQuantityRecipe();
    recipe.ingredients.push(makeQuantityLine({ id: 'tiny-seasoning', foodId: 'salt', role: 'seasoning', amount: Number.MIN_VALUE }));
    const inventory = makeAvailabilitySnapshot();
    inventory.items[0].amount = 3;
    expect(calculate(recipe, inventory)).toMatchObject({ status: 'invalid', scaleFactor: null });
  });

  it('does not compute a partial core requirement while another use of the same food is unknown', () => {
    const recipe = makeQuantityRecipe();
    recipe.ingredients.push(makeQuantityLine({ id: 'pork-sauce', role: 'other', amount: null, quantityStatus: 'unknown', quantityEvidence: null }));
    expect(calculate(recipe)).toMatchObject({ status: 'needs-confirmation', scaleFactor: null });
  });

  it('does not let anonymous required ingredients borrow anonymous stock quantities', () => {
    const recipe = makeQuantityRecipe();
    recipe.ingredients.push(makeQuantityLine({ id: 'unknown-sauce', foodId: null, preparationState: null, role: 'other', amount: 10 }));
    const inventory = makeAvailabilitySnapshot();
    inventory.items.push(makeAvailableItem({ id: 'unknown-item', foodId: null, preparationState: null, amount: 100 }));
    expect(calculate(recipe, inventory)).toMatchObject({ status: 'scaled', requirementsStatus: 'needs-confirmation' });
  });

  it.each(['foodId', 'preparationState', 'unit'])('does not treat the %s unknown marker as an exact stock identity', (field) => {
    const recipe = makeQuantityRecipe();
    recipe.ingredients.push(makeQuantityLine({ id: 'unknown-sauce', foodId: 'soy-sauce', role: 'seasoning', amount: 10, [field]: 'unknown' }));
    const inventory = makeAvailabilitySnapshot();
    inventory.items.push(makeAvailableItem({ id: 'unknown-item', foodId: 'soy-sauce', amount: 100, [field]: 'unknown' }));
    expect(calculate(recipe, inventory)).toMatchObject({ status: 'scaled', requirementsStatus: 'needs-confirmation' });
  });

  it.each(['2026-02-30', '2026-99-01', 'later'])('rejects an unusable meal date %s', (mealDate) => {
    expect(calculate(undefined, makeAvailabilitySnapshot({ mealDate }))).toMatchObject({ status: 'needs-confirmation', scaleFactor: null });
  });

  it.each([0, -1, NaN, Infinity, null, '2'])('rejects invalid target servings %s', (target) => {
    expect(calculate(undefined, undefined, target)).toMatchObject({ status: 'invalid', scaleFactor: null });
  });
});
