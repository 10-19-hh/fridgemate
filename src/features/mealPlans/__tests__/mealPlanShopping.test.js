import { describe, expect, it } from 'vitest';
import { allocatePlannedMeals } from '../mealPlanningAllocation.js';
import { deriveMealPlanShopping } from '../mealPlanShopping.js';

// Synthetic arithmetic only, not reviewed recipes or a completed dinner.
function demand(overrides = {}) {
  return { lineId: 'main', foodId: 'chicken', preparationState: 'raw', unit: 'g', amount: 200,
    quantityStatus: 'verified', required: true, selected: true, ...overrides };
}
function meal(date, overrides = {}) {
  return { id: date, scope: 'guest', planId: 'week:2026-09-14', planRevision: 3,
    slotId: `${date}:dinner`, componentId: 'main', date, mealType: 'dinner', status: 'confirmed',
    locked: false, recipeId: 'test-only:chicken', recipeVersion: 'test-v1', demands: [demand()], ...overrides };
}
function allocation(meals, items = [{ id: 'chicken-stock', foodId: 'chicken', preparationState: 'raw',
  unit: 'g', amount: 300, quantityStatus: 'confirmed', availabilityStatus: 'available',
  expiryStatus: 'dated', expiryDate: '2026-09-30', confirmedAt: '2026-09-15T00:00:00Z' }]) {
  const result = allocatePlannedMeals({ scope: 'guest', asOf: '2026-09-15T00:00:00Z', fromDate: '2026-09-15',
    inventory: { scope: 'guest', revision: 4, items }, meals });
  expect(result.status).toBe('calculated');
  return result;
}

describe('meal-plan-only shopping derivation', () => {
  it('combines compatible shortages across weeks while retaining their source slots', () => {
    const input = allocation([meal('2026-09-15'), meal('2026-09-22', { planId: 'week:2026-09-21' })]);
    const result = deriveMealPlanShopping(input);
    expect(result).toMatchObject({ status: 'calculated', items: [{
      source: 'meal-plan', foodId: 'chicken', unit: 'g', required: true,
      requiredAmount: 400, allocatedAmount: 300, knownMissingAmount: 100, needsConfirmation: false,
      sources: [
        { planId: 'week:2026-09-14', slotId: '2026-09-15:dinner', missingAmount: 0 },
        { planId: 'week:2026-09-21', slotId: '2026-09-22:dinner', missingAmount: 100 },
      ],
    }] });
    expect(result.items).toHaveLength(1);
  });

  it('removes only the now-unneeded derived shortage after a meal is skipped', () => {
    const result = deriveMealPlanShopping(allocation([meal('2026-09-15'), meal('2026-09-16', { status: 'skipped' })]));
    expect(result).toMatchObject({ status: 'calculated', items: [] });
  });

  it('does not call unknown quantity a zero shortage', () => {
    const result = deriveMealPlanShopping(allocation([meal('2026-09-15')], []));
    expect(result).toMatchObject({ status: 'calculated', items: [{
      requiredAmount: 200, allocatedAmount: 0, knownMissingAmount: 0, needsConfirmation: true,
      sources: [{ status: 'needs-confirmation', missingAmount: null }],
    }] });
  });

  it('retains both known missing quantity and later unknown demand', () => {
    const result = deriveMealPlanShopping(allocation([
      meal('2026-09-15', { demands: [demand({ amount: 400 })] }),
      meal('2026-09-16', { demands: [demand({ amount: null, quantityStatus: 'unknown' })] }),
    ]));
    expect(result).toMatchObject({ status: 'calculated', items: [{
      requiredAmount: null, allocatedAmount: 300, knownMissingAmount: 100, needsConfirmation: true,
      sources: [{ missingAmount: 100 }, { missingAmount: null }],
    }] });
  });

  it('does not combine units, food states, optional items, or unidentified lines', () => {
    const result = deriveMealPlanShopping(allocation([meal('2026-09-15', { demands: [
      demand({ amount: 400 }),
      demand({ lineId: 'liquid', unit: 'ml' }),
      demand({ lineId: 'cooked', preparationState: 'cooked' }),
      demand({ lineId: 'unknown-a', foodId: null, amount: null, quantityStatus: 'unknown' }),
      demand({ lineId: 'unknown-b', foodId: null, amount: null, quantityStatus: 'unknown' }),
    ] }), meal('2026-09-16', { demands: [demand({ required: false })] })]));
    expect(result.status).toBe('calculated');
    expect(result.items).toHaveLength(6);
    expect(new Set(result.items.map((item) => item.id)).size).toBe(6);
    expect(result.items.filter((item) => item.required === false)).toHaveLength(1);
  });

  it('preserves fractional quantities and returns independent source/basis snapshots', () => {
    const input = allocation([meal('2026-09-15', { demands: [demand({ amount: 300.4 })] })]);
    const before = structuredClone(input);
    const result = deriveMealPlanShopping(input);
    expect(result.status).toBe('calculated');
    expect(result.items[0].knownMissingAmount).toBeCloseTo(0.4, 10);
    expect(result.items[0].knownMissingAmount).toBeGreaterThan(0);
    result.items[0].sources[0].lineIds.push('changed');
    result.basis.planVersions[0].revision = 999;
    expect(input).toEqual(before);
  });

  it.each([
    ['invalid allocation', (input) => { input.status = 'invalid'; }],
    ['duplicate meal', (input) => { input.meals.push(structuredClone(input.meals[0])); }],
    ['duplicate source line', (input) => { input.meals[0].requirements.push(structuredClone(input.meals[0].requirements[0])); }],
    ['negative shortage', (input) => { input.meals[0].requirements[0].missingAmount = -1; }],
    ['unknown status', (input) => { input.meals[0].requirements[0].status = 'ready'; }],
    ['non-finite amount', (input) => { input.meals[0].requirements[0].requiredAmount = Infinity; }],
    ['confirmed null shortage', (input) => { input.meals[0].requirements[0].missingAmount = null; }],
    ['inconsistent shortage', (input) => { input.meals[0].requirements[0].missingAmount = 999; }],
    ['unknown with numeric shortage', (input) => { input.meals[0].requirements[0].status = 'needs-confirmation'; }],
    ['overallocated', (input) => { input.meals[0].requirements[0].allocatedAmount = 401; }],
    ['missing basis', (input) => { input.basis = null; }],
  ])('fails closed for %s without publishing partial shopping', (_, mutate) => {
    const input = allocation([meal('2026-09-15', { demands: [demand({ amount: 400 })] })]);
    mutate(input);
    expect(deriveMealPlanShopping(input)).toMatchObject({ status: 'invalid', items: [] });
  });
});
