import { describe, expect, it } from 'vitest';
import { getReviewedDinnerCatalog } from '../reviewedDinnerCatalog';
import { allocateMealPlanInventory } from '../mealPlanAllocation';

const today = '2026-09-21';
function plan() {
  return { scope: 'guest', weekStart: today, slots: [{
    ...getReviewedDinnerCatalog().templates[0], id: `${today}:dinner`, date: today, servings: 2, status: 'planned',
  }] };
}

describe('reviewed dinner allocation and processing gaps', () => {
  it('keeps process water unresolved while exposing only the independently known food shortages', () => {
    const result = allocateMealPlanInventory({ scope: 'guest', today, confirmedPlans: [plan()], inventory: [] });
    expect(result.status).toBe('needs-review');
    expect(result.shopping.needsReview).toEqual([expect.objectContaining({
      label: '시금치 데치는 물', reason: 'process-quantity-unverified', ingredientKey: 'food:물',
    })]);
    expect(result.shopping.shortages).toEqual(expect.arrayContaining([
      expect.objectContaining({ ingredientKey: 'food:밥', amount: 360, unit: 'g' }),
      expect.objectContaining({ ingredientKey: 'food:시금치', amount: 100, unit: 'g' }),
    ]));
  });

  it('deducts only confirmed cooked rice in a read-only calculation and keeps the process warning', () => {
    const inventory = [{ id: 'rice', scope: 'guest', ingredientKey: 'food:밥',
      amount: 300, unit: 'g', preparationState: 'cooked', expiryDate: today,
      quantityStatus: 'verified', quantityEvidence: 'test:user-confirmation' }];
    const before = structuredClone(inventory);
    const result = allocateMealPlanInventory({ scope: 'guest', today, confirmedPlans: [plan()], inventory });
    expect(result.status).toBe('needs-review');
    expect(result.shopping.shortages.find((item) => item.ingredientKey === 'food:밥').amount).toBe(60);
    expect(inventory).toEqual(before);
  });

  it('rejects a nonstring planning scope even when the empty input would otherwise bypass validation', () => {
    expect(() => allocateMealPlanInventory({ scope: ['user:alice'], today, confirmedPlans: [], inventory: [] })).toThrow();
  });

  it('keeps separate unknown noodle-boiling water from making the measured sauce water a complete purchase total', () => {
    const dinner = plan();
    dinner.slots[0] = { ...dinner.slots[0], ...getReviewedDinnerCatalog().templates[1], servings: 2 };
    const result = allocateMealPlanInventory({ scope: 'guest', today, confirmedPlans: [dinner], inventory: [] });
    const water = result.slots[0].requirements.find((item) => item.ingredientKey === 'food:물');
    expect(water).toMatchObject({ requiredAmount: 1200, status: 'needs-review', shortageAmount: null });
    expect(result.shopping.shortages.some((item) => item.ingredientKey === 'food:물')).toBe(false);
    expect(result.shopping.needsReview).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: '소면 삶는 물', reason: 'process-quantity-unverified' }),
    ]));
  });

  it.each([['non-array', {}], ['sparse', new Array(1)], ['null row', [null]]])('rejects %s process rows in a direct calculation instead of hiding their demand', (_label, value) => {
    const dinner = plan();
    dinner.slots[0].components[0].processInputs = value;
    expect(() => allocateMealPlanInventory({ scope: 'guest', today, confirmedPlans: [dinner], inventory: [] })).toThrow();
  });
});
