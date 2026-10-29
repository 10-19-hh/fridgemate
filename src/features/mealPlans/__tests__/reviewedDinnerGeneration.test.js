import { describe, expect, it } from 'vitest';
import {
  generateMealPlan, replaceMealPlanSlot, setMealPlanSlotSkipped, toggleMealPlanSlotLock,
} from '../mealPlanDomain';
import { mealPlanCatalog } from '../mealPlanCatalog';
import { getMealQuantityRequirements } from '../mealQuantityDomain';

const weekStart = '2026-09-21';
const now = '2026-09-16T01:00:00.000Z';
const preferences = { servings: 2, dinnerDays: [0], excludedIngredients: [] };
const ingredients = ['밥', '시금치', '마', '두유', '소금', '버터', '후춧가루'].map((name) => ({
  id: name, name, quantity: '수량 메모', expiryDate: weekStart, consumed: false,
}));
const RISOTTO = 'mfds-dinner:book2-spinach-risotto';
const generate = (overrides = {}) => generateMealPlan({ weekStart, now, preferences, ingredients, ...overrides });

describe('reviewed dinner generation integration', () => {
  it('uses a source-compared whole bowl in normal generation when its named ingredients match', () => {
    const plan = generate();
    expect(plan.slots[0].templateKey).toBe(RISOTTO);
    expect(plan.slots.slice(1).every((slot) => slot.status === 'skipped')).toBe(true);
    expect(plan.slots[0].components[0].source.book.pdfPage).toBe(26);
    expect(getMealQuantityRequirements(plan.slots[0], 2).requirements).toEqual(expect.arrayContaining([
      expect.objectContaining({ ingredientKey: 'food:밥', amount: 360, unit: 'g' }),
    ]));
    expect(plan.slots[0].components[0].ingredients[0].amount).toBe(180);
  });

  it('retains original versioned source quantities through a serving change and lock preservation', () => {
    const first = generate({ preferences: { ...preferences, servings: 1 } });
    expect(first.slots[0].templateKey).toBe(RISOTTO);
    const locked = toggleMealPlanSlotLock(first, first.slots[0].id, { now });
    const next = generate({ previousPlan: locked });
    expect(next.slots[0].templateKey).toBe(RISOTTO);
    expect(next.slots[0].locked).toBe(true);
    expect(next.slots[0].components).toEqual(first.slots[0].components);
    expect(getMealQuantityRequirements(next.slots[0], 2).requirements.find((item) => item.ingredientKey === 'food:밥').amount).toBe(360);
  });

  it('includes the new recipe through replacement and restoring a formerly empty skipped slot', () => {
    const original = generate({ ingredients: [], preferences: { ...preferences, excludedIngredients: ['시금치'] } });
    const eligible = { ...original, preferences };
    const changed = replaceMealPlanSlot(eligible, eligible.slots[0].id, { ingredients, now });
    expect(changed.slots[0].templateKey).toBe(RISOTTO);
    const skipped = generate({ preferences: { ...preferences, dinnerDays: [] } });
    const restored = setMealPlanSlotSkipped(skipped, skipped.slots[0].id, false, { ingredients, now });
    expect(restored.slots[0].templateKey).toBe(RISOTTO);
  });

  it('excludes the new ingredient even when inventory would otherwise favor it', () => {
    const candidate = generate();
    expect(candidate.slots[0].templateKey).toBe(RISOTTO);
    for (const excluded of ['시금치', '두유', '버터']) {
      const plan = generate({ preferences: { ...preferences, excludedIngredients: [excluded] } });
      expect(plan.slots[0].templateKey).not.toBe(RISOTTO);
      expect(plan.slots[0].components.flatMap((c) => c.ingredients).map((line) => line.rawName)).not.toContain(excluded);
    }
  });

  it('keeps the existing sixteen editorial templates unverified and does not mutate inventory', () => {
    const before = structuredClone({ ingredients, mealPlanCatalog });
    generate();
    expect({ ingredients, mealPlanCatalog }).toEqual(before);
    expect(mealPlanCatalog).toHaveLength(16);
    expect(mealPlanCatalog.every((template) => template.servingsStatus === 'unverified')).toBe(true);
  });

  it('records engine and participating catalog versions and reproducible generation input', () => {
    const plan = generate();
    expect(plan.engineVersion).toBe('weekly-dinner-rules-v3');
    expect(plan.catalogVersion).toBe('2026-09-16.2');
    expect(plan.generationInput).toEqual({
      weekStart, scope: 'guest', preferences, now, previousPlan: null,
      ingredients: ingredients.map(({ name, expiryDate, consumed }) => ({ name, expiryDate, consumed })), pantryItems: [],
    });
    expect(generate()).toEqual(plan);
    plan.generationInput.ingredients[0].name = 'edited';
    expect(ingredients[0].name).toBe('밥');
  });

  it('replays regeneration with locked prior slots without retaining recursive histories or unrelated inventory notes', () => {
    const first = generate();
    const locked = toggleMealPlanSlotLock(first, first.slots[0].id, { now });
    const next = generate({ previousPlan: locked, ingredients: ingredients.map((item) => ({ ...item, memo: 'private note' })) });
    expect(next.generationInput).toBeDefined();
    expect(generateMealPlan(next.generationInput)).toEqual(next);
    expect(next.generationInput.previousPlan.generationInput).toBeUndefined();
    expect(next.generationInput.ingredients.some((item) => Object.hasOwn(item, 'memo'))).toBe(false);
  });
});
