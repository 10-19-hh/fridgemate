import { describe, expect, it } from 'vitest';
import { buildConfirmedRecipeMeal, previewAllocatedRecipeMeal } from '../mealPlanQuantityDomain.js';
import { allocatePlannedMeals } from '../mealPlanningAllocation.js';
import { deriveMealPlanShopping } from '../mealPlanShopping.js';
import { publicRecipeCatalog } from '../../recipes/publicRecipeCatalog.js';
import { getQuantityRecipeForPublicRecipe } from '../../recipes/quantityRecipeCatalog.js';
import { makeQuantityLine, makeQuantityRecipe, makeAvailableItem } from '../../recipes/__tests__/fixtures/scaledCookingFixtures.js';

// Synthetic arithmetic only. These fixtures are not reviewed meal templates.
const asOf = '2026-09-15T09:00:00+09:00';

function confirmationInput({ recipe = makeQuantityRecipe(), ...overrides } = {}) {
  return {
    recipe, scope: 'guest', planId: 'week:2026-09-14', planRevision: 3,
    slotId: '2026-09-15:dinner', componentId: 'explicit-side', date: '2026-09-15', locked: false,
    quantityChoice: {
      status: 'confirmed', recipeId: recipe.id, recipeVersion: recipe.version,
      targetServings: 2, scaleFactor: 0.5, confirmedAt: asOf,
      selectedLineIds: recipe.ingredients.filter((line) => line.selected).map((line) => line.id),
    },
    ...overrides,
  };
}

function build(input = confirmationInput()) {
  const result = buildConfirmedRecipeMeal(input);
  expect(result.status).toBe('valid');
  return result.meal;
}

function allocate(meals, items = [
  makeAvailableItem({ amount: 300, expiryStatus: 'dated', expiryDate: '2026-09-30' }),
  makeAvailableItem({ id: 'onion-batch', foodId: 'onion', amount: 100, expiryStatus: 'dated', expiryDate: '2026-09-30' }),
]) {
  return allocatePlannedMeals({ scope: 'guest', asOf, fromDate: '2026-09-15',
    inventory: { scope: 'guest', revision: 7, items }, meals });
}

function freezeDeep(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freezeDeep);
    Object.freeze(value);
  }
  return value;
}

describe('approved recipe demand', () => {
  it('stores the explicitly approved amount, not the original amount or rounded display', () => {
    const input = confirmationInput();
    input.quantityChoice.scaleFactor = 0.67;
    const before = JSON.stringify(input);
    const result = buildConfirmedRecipeMeal(freezeDeep(input));
    expect(result).toMatchObject({ status: 'valid', meal: {
      status: 'confirmed', scope: 'guest', planRevision: 3,
      targetServings: 2, approvedScaleFactor: 0.67,
      demands: [
        { lineId: 'pork-main', amount: 201, unit: 'g', quantityStatus: 'verified' },
        { lineId: 'onion-main', amount: 67, unit: 'g', quantityStatus: 'verified' },
      ],
    } });
    expect(JSON.stringify(input)).toBe(before);
  });

  it('adjusts servings before applying the approved scale and keeps duplicate source rows', () => {
    const input = confirmationInput({ recipe: makeQuantityRecipe({ ingredients: [
      makeQuantityLine({ amount: 300 }),
      makeQuantityLine({ id: 'pork-sauce', role: 'seasoning', section: 'sauce', amount: 100 }),
    ] }) });
    input.quantityChoice.targetServings = 1;
    const meal = build(input);
    expect(meal.demands.map(({ lineId, amount }) => ({ lineId, amount }))).toEqual([
      { lineId: 'pork-main', amount: 75 }, { lineId: 'pork-sauce', amount: 25 },
    ]);
  });

  it('keeps unknown seasoning unknown and excludes optional unselected rows', () => {
    const input = confirmationInput({ recipe: makeQuantityRecipe({ ingredients: [
      makeQuantityLine(),
      makeQuantityLine({ id: 'salt', foodId: 'salt', role: 'seasoning', amount: null,
        unit: null, quantityStatus: 'unknown', quantityEvidence: null }),
      makeQuantityLine({ id: 'sesame', foodId: 'sesame', role: 'other', required: false, selected: false, amount: 3 }),
    ] }) });
    const meal = build(input);
    expect(meal.demands).toHaveLength(2);
    expect(meal.demands[1]).toMatchObject({ lineId: 'salt', amount: null, quantityStatus: 'unknown' });
  });

  it.each([
    ['draft', (input) => { input.quantityChoice.status = 'draft'; }],
    ['missing approval', (input) => { delete input.quantityChoice; }],
    ['old source version', (input) => { input.quantityChoice.recipeVersion = 'old'; }],
    ['different source', (input) => { input.quantityChoice.recipeId = 'different'; }],
    ['changed selection', (input) => { input.quantityChoice.selectedLineIds.pop(); }],
    ['duplicate selection', (input) => { input.quantityChoice.selectedLineIds.push('pork-main'); }],
    ['zero scale', (input) => { input.quantityChoice.scaleFactor = 0; }],
    ['increased scale', (input) => { input.quantityChoice.scaleFactor = 1.1; }],
    ['missing scale', (input) => { delete input.quantityChoice.scaleFactor; }],
    ['zero servings', (input) => { input.quantityChoice.targetServings = 0; }],
    ['unreviewed source', (input) => { input.recipe.servingsStatus = 'unverified'; }],
    ['impossible date', (input) => { input.date = '2026-02-30'; }],
    ['missing scope', (input) => { delete input.scope; }],
    ['missing revision', (input) => { delete input.planRevision; }],
    ['underflow', (input) => { input.quantityChoice.targetServings = Number.MIN_VALUE; }],
    ['overflow', (input) => { input.quantityChoice.targetServings = Number.MAX_VALUE; }],
    ['date-only approval time', (input) => { input.quantityChoice.confirmedAt = '2026-09-15'; }],
    ['normalized impossible approval date', (input) => { input.quantityChoice.confirmedAt = '2026-02-30T09:00:00Z'; }],
    ['numeric recipe ID unsupported by planning storage', (input) => { input.recipe.id = 29; input.quantityChoice.recipeId = 29; }],
    ['numeric source line ID unsupported by allocation', (input) => {
      input.recipe.ingredients[0].id = 1; input.quantityChoice.selectedLineIds[0] = 1;
    }],
  ])('does not turn %s into a confirmed demand', (_, mutate) => {
    const input = confirmationInput();
    mutate(input);
    expect(buildConfirmedRecipeMeal(input)).toMatchObject({ status: 'invalid', meal: null });
  });

  it('keeps tiny representable quantities without a product cutoff', () => {
    const input = confirmationInput();
    input.quantityChoice.scaleFactor = 0.000001;
    const meal = build(input);
    expect(meal.demands[0].amount).toBeCloseTo(0.0003, 15);
    expect(meal.demands[0].amount).toBeGreaterThan(0);
  });

  it('reports invalid rather than throwing for a null command', () => {
    let result;
    expect(() => { result = buildConfirmedRecipeMeal(null); }).not.toThrow();
    expect(result).toMatchObject({ status: 'invalid', meal: null });
  });
});

describe('common allocation to scaled cooking preview', () => {
  it('only uses the selected meal allocation, including meals in another week', () => {
    const recipe = makeQuantityRecipe({ ingredients: [makeQuantityLine({ amount: 200 })] });
    const firstInput = confirmationInput({ recipe });
    firstInput.quantityChoice.scaleFactor = 1;
    const secondInput = confirmationInput({ recipe, planId: 'week:2026-09-21',
      date: '2026-09-22', slotId: '2026-09-22:dinner' });
    secondInput.quantityChoice.scaleFactor = 1;
    const first = build(firstInput);
    const second = build(secondInput);
    const allocation = allocate([second, first]);
    expect(allocation.status).toBe('calculated');
    expect(allocation.meals[1].requirements[0].missingAmount).toBe(100);
    const before = JSON.stringify({ first, second, allocation, recipe });
    [first, second, allocation, recipe].forEach(freezeDeep);
    const result = previewAllocatedRecipeMeal({ recipe, meal: second, allocation });
    expect(result).toMatchObject({ status: 'calculated', preview: {
      status: 'scaled', scaleFactor: 0.5,
      ingredients: [{ requestedAmount: 200, scaledAmount: 100 }],
    }, planningBasis: {
      scope: 'guest', planId: 'week:2026-09-21', planRevision: 3,
      slotId: '2026-09-22:dinner', componentId: 'explicit-side', date: '2026-09-22',
      inventoryRevision: 7, targetServings: 2, approvedScaleFactor: 1,
    } });
    expect(JSON.stringify({ first, second, allocation, recipe })).toBe(before);
    expect(second.demands[0].amount).toBe(200);
  });

  it('does not increase an approved half recipe when more stock is available', () => {
    const recipe = makeQuantityRecipe();
    const meal = build(confirmationInput({ recipe }));
    const result = previewAllocatedRecipeMeal({ recipe, meal, allocation: allocate([meal]) });
    expect(result).toMatchObject({ status: 'calculated', preview: {
      scaleFactor: 0.5, ingredients: [
        { requestedAmount: 300, scaledAmount: 150 },
        { requestedAmount: 100, scaledAmount: 50 },
      ],
    } });
  });

  it('passes an allocation group once, not once per duplicate ingredient row', () => {
    const recipe = makeQuantityRecipe({ ingredients: [
      makeQuantityLine({ amount: 300 }),
      makeQuantityLine({ id: 'pork-sauce', role: 'seasoning', amount: 100 }),
    ] });
    const meal = build(confirmationInput({ recipe }));
    const result = previewAllocatedRecipeMeal({ recipe, meal, allocation: allocate([meal]) });
    expect(result).toMatchObject({ status: 'calculated', preview: {
      scaleFactor: 0.5, ingredients: [{ scaledAmount: 150 }, { scaledAmount: 50 }],
    } });
  });

  it('does not convert an unknown allocation with zero assigned into known zero stock', () => {
    const recipe = makeQuantityRecipe();
    const meal = build(confirmationInput({ recipe }));
    const result = previewAllocatedRecipeMeal({ recipe, meal, allocation: allocate([meal], []) });
    expect(result).toMatchObject({ status: 'calculated', preview: {
      status: 'needs-confirmation', scaleFactor: null,
    } });
    expect(result.preview.checks[0].availableAmount).toBeNull();
  });

  it.each([
    ['scope changed', ({ meal }) => { meal.scope = 'user:another'; }],
    ['plan revision changed', ({ meal }) => { meal.planRevision += 1; }],
    ['slot changed', ({ meal }) => { meal.slotId = '2026-09-16:dinner'; }],
    ['date changed', ({ meal }) => { meal.date = '2026-09-16'; }],
    ['component changed', ({ meal }) => { meal.componentId = 'other'; }],
    ['source version changed', ({ recipe }) => { recipe.version = 'new'; }],
    ['servings changed', ({ meal }) => { meal.targetServings = 1; }],
    ['approved scale changed', ({ meal }) => { meal.approvedScaleFactor = 0.25; }],
    ['approved choice changed', ({ meal }) => { meal.quantityChoice.scaleFactor = 0.25; }],
    ['demand edited', ({ meal }) => { meal.demands[0].amount = 75; }],
    ['skipped meal', ({ meal }) => { meal.status = 'skipped'; }],
    ['future confirmation', ({ meal }) => { meal.quantityChoice.confirmedAt = '2026-09-16T09:00:00+09:00'; }],
    ['allocation has older revision', ({ allocation }) => { allocation.meals[0].planRevision = 2; }],
    ['basis has older revision', ({ allocation }) => { allocation.basis.planVersions[0].revision = 2; }],
    ['allocation before window', ({ allocation }) => { allocation.basis.fromDate = '2026-09-16'; }],
    ['duplicate allocated meal', ({ allocation }) => { allocation.meals.push(structuredClone(allocation.meals[0])); }],
    ['duplicate allocated requirement', ({ allocation }) => {
      allocation.meals[0].requirements.push(structuredClone(allocation.meals[0].requirements[0]));
    }],
    ['allocated beyond approved demand', ({ allocation }) => {
      allocation.meals[0].requirements[0].allocatedAmount = 300;
      allocation.meals[0].requirements[1].allocatedAmount = 100;
    }],
    ['wrong line binding', ({ allocation }) => { allocation.meals[0].requirements[0].lineIds = ['onion-main']; }],
    ['missing requirement', ({ allocation }) => { allocation.meals[0].requirements.pop(); }],
    ['wrong food identity', ({ allocation }) => { allocation.meals[0].requirements[0].foodId = 'different'; }],
    ['unknown result status', ({ allocation }) => { allocation.meals[0].requirements[0].status = 'ready'; }],
    ['negative missing quantity', ({ allocation }) => { allocation.meals[0].requirements[0].missingAmount = -1; }],
    ['sufficient with unknown missing quantity', ({ allocation }) => { allocation.meals[0].requirements[0].missingAmount = null; }],
    ['shortage with missing zero', ({ allocation }) => { allocation.meals[0].requirements[0].status = 'shortage'; }],
    ['allocation record missing amounts', ({ allocation }) => { allocation.meals[0].requirements[0].allocations = []; }],
  ])('rejects stale or inconsistent input: %s', (_, mutate) => {
    const recipe = makeQuantityRecipe();
    const meal = build(confirmationInput({ recipe }));
    const allocation = allocate([meal]);
    const input = { recipe, meal, allocation };
    mutate(input);
    expect(previewAllocatedRecipeMeal(input)).toMatchObject({ status: 'invalid', preview: null });
  });

  it('preserves explicit zero and separate unknown seasoning warnings', () => {
    const recipe = makeQuantityRecipe({ ingredients: [makeQuantityLine(),
      makeQuantityLine({ id: 'salt', foodId: 'salt', role: 'seasoning', amount: null,
        quantityStatus: 'unknown', quantityEvidence: null }),
    ] });
    const meal = build(confirmationInput({ recipe }));
    const zero = allocate([meal], [makeAvailableItem({ amount: 0, expiryStatus: 'unknown', expiryDate: null })]);
    expect(previewAllocatedRecipeMeal({ recipe, meal, allocation: zero })).toMatchObject({
      status: 'calculated', preview: { status: 'unavailable', scaleFactor: 0, requirementsStatus: 'needs-confirmation' },
    });
    const partial = previewAllocatedRecipeMeal({ recipe, meal, allocation: allocate([meal]) });
    expect(partial).toMatchObject({ status: 'calculated', preview: {
      scaleFactor: 0.5, requirementsStatus: 'needs-confirmation',
      checks: [{ foodId: 'salt', requiredAmount: null, availableAmount: null }],
    } });
  });

  it('reports invalid rather than throwing for a null preview request', () => {
    let result;
    expect(() => { result = previewAllocatedRecipeMeal(null); }).not.toThrow();
    expect(result).toMatchObject({ status: 'invalid', preview: null });
  });

  it.each([
    ['29', [25, 3.5]],
    ['31', [75, 5, 5]],
    ['95', [15, 7.5, 5, 2.5]],
  ])('accepts the canonical source %s without inventing unknown seasoning quantities', (id, amounts) => {
    const recipe = getQuantityRecipeForPublicRecipe(publicRecipeCatalog.find((source) => source.externalId === id));
    const input = confirmationInput({ recipe });
    input.quantityChoice.targetServings = 1;
    const meal = build(input);
    // Hypothetical inventory for the integration test, not real user inventory.
    const items = recipe.ingredients.filter((line) => line.amount !== null).map((line) => makeAvailableItem({
      id: line.id, foodId: line.foodId, preparationState: line.preparationState,
      unit: line.unit, amount: line.amount, expiryStatus: 'dated', expiryDate: '2026-09-30',
    }));
    const result = previewAllocatedRecipeMeal({ recipe, meal, allocation: allocate([meal], items) });
    expect(result.status).toBe('calculated');
    expect(result.preview.scaleFactor).toBe(0.5);
    expect(result.preview.ingredients.filter((line) => line.role === 'core').map((line) => line.scaledAmount)).toEqual(amounts);
    expect(result.preview.ingredients.filter((line) => line.requestedAmount === null)
      .every((line) => line.scaledAmount === null)).toBe(true);
  });

  it('keeps the shortage during preview and changes it only after a new approved quantity is provided', () => {
    const tomato = getQuantityRecipeForPublicRecipe(publicRecipeCatalog.find((source) => source.externalId === '31'));
    const salad = getQuantityRecipeForPublicRecipe(publicRecipeCatalog.find((source) => source.externalId === '95'));
    const firstInput = confirmationInput({ recipe: tomato, locked: true });
    firstInput.quantityChoice.targetServings = 1;
    firstInput.quantityChoice.scaleFactor = 1;
    const secondInput = confirmationInput({ recipe: salad, date: '2026-09-16', slotId: '2026-09-16:dinner' });
    secondInput.quantityChoice.targetServings = 1;
    secondInput.quantityChoice.scaleFactor = 1;
    const first = build(firstInput);
    const second = build(secondInput);
    const items = [
      ['cherry-tomato', 150], ['onion', 15], ['chives', 10],
      ['chicory', 30], ['red-cabbage', 15], ['carrot', 5],
    ].map(([foodId, amount]) => makeAvailableItem({ id: foodId, foodId, amount,
      expiryStatus: 'dated', expiryDate: '2026-09-30' }));
    const before = allocate([first, second], items);
    const beforeShopping = deriveMealPlanShopping(before);
    const preview = previewAllocatedRecipeMeal({ recipe: salad, meal: second, allocation: before });
    expect(preview.preview.scaleFactor).toBe(0.5);
    expect(beforeShopping.items.find((item) => item.foodId === 'onion').knownMissingAmount).toBe(5);
    expect(second.demands.find((line) => line.foodId === 'onion').amount).toBe(10);

    const approvedSecond = confirmationInput({ ...secondInput, planRevision: 4,
      quantityChoice: { ...secondInput.quantityChoice, scaleFactor: 0.5 } });
    const approvedFirst = confirmationInput({ ...firstInput, planRevision: 4 });
    const after = allocate([build(approvedFirst), build(approvedSecond)], items);
    const afterShopping = deriveMealPlanShopping(after);
    expect(afterShopping.status).toBe('calculated');
    expect(afterShopping.items.some((item) => item.foodId === 'onion')).toBe(false);
    expect(afterShopping.items.some((item) => item.needsConfirmation)).toBe(true);
    expect(first.locked).toBe(true);
    expect(items.find((item) => item.foodId === 'onion').amount).toBe(15);
  });
});
