import { describe, expect, it } from 'vitest';
import { buildRecipeRecommendations } from '../../../utils/recommendations';
import { publicRecipeCatalog } from '../publicRecipeCatalog';
import { getQuantityRecipeForPublicRecipe } from '../quantityRecipeCatalog';
import { buildQuantityAwareRecommendations, getQuantityRecommendationResult } from '../quantityRecommendationBridge';

const context = { scope: 'guest', inventoryRevision: 'stock-v1', mealDate: '2026-09-15', targetServings: 1 };

function source(id = '29') {
  return getQuantityRecipeForPublicRecipe(publicRecipeCatalog.find((recipe) => recipe.externalId === id));
}

function candidate(id = '29') {
  const recipe = source(id);
  return {
    id: recipe.id, title: recipe.name,
    quantitySource: { kind: recipe.source.kind, id: recipe.source.id, version: recipe.version },
    ingredients: recipe.ingredients.map((line) => ({ rawName: line.rawName, ingredientType: line.role === 'core' ? 'main' : 'seasoning' })),
  };
}

function confirmation(id = '29', scaleFactor = 0.5, targetServings = 1) {
  const recipe = source(id);
  return {
    recipeId: recipe.id, recipeVersion: recipe.version, inventoryRevision: 'stock-v1', targetServings,
    inventory: {
      scope: 'guest', revision: 'manual:7', asOf: '2026-09-15T09:00:00+09:00', mealDate: '2026-09-15', basis: 'user-confirmed-for-meal',
      items: recipe.ingredients.map((line) => ({
        id: line.id, foodId: line.foodId, preparationState: line.preparationState, unit: line.unit,
        amount: line.amount === null ? null : line.amount * targetServings * (line.role === 'core' ? scaleFactor : 1),
        quantityStatus: line.amount === null ? 'unknown' : 'confirmed',
        availabilityStatus: line.amount === null ? 'unknown' : 'available',
        confirmedAt: line.amount === null ? null : '2026-09-15T09:00:00+09:00',
      })),
    },
  };
}

function deepFreeze(value) {
  Object.values(value).forEach((nested) => {
    if (nested && typeof nested === 'object') deepFreeze(nested);
  });
  return Object.freeze(value);
}

describe('quantity confirmation recommendation bridge', () => {
  it('calculates only a matching source and separates manual revision from stock revision', () => {
    const result = getQuantityRecommendationResult(candidate(), confirmation(), context);
    expect(result).toMatchObject({ status: 'scaled', scaleFactor: 0.5, requirementsStatus: 'needs-confirmation' });
    expect(result.ingredients.slice(0, 2)).toMatchObject([{ scaledAmount: 25 }, { scaledAmount: 3.5 }]);
    expect(result.basis.inventory.revision).toBe('manual:7');
  });

  it('rejects stale recipe, version, stock, scope, date and explicit target-person bindings', () => {
    const changes = [
      (value) => { value.recipeId = 'mfds:31'; },
      (value) => { value.recipeVersion = 'old'; },
      (value) => { value.inventoryRevision = 'stock-v0'; },
      (value) => { value.targetServings = 2; },
      (value) => { value.inventory.scope = 'user:alice'; },
      (value) => { value.inventory.mealDate = '2026-09-16'; },
    ];
    for (const change of changes) {
      const value = confirmation();
      change(value);
      expect(getQuantityRecommendationResult(candidate(), value, context)).toBeNull();
    }
    for (const missing of ['scope', 'inventoryRevision', 'mealDate']) {
      const incomplete = { ...context };
      delete incomplete[missing];
      expect(getQuantityRecommendationResult(candidate(), confirmation(), incomplete)).toBeNull();
    }
  });

  it('rejects missing confirmation and forged source identity instead of trusting supplied quantityResult', () => {
    expect(getQuantityRecommendationResult(candidate(), undefined, context)).toBeNull();
    const forged = { ...candidate(), id: 'local:clone', quantityResult: { status: 'original', scaleFactor: 1 } };
    expect(getQuantityRecommendationResult(forged, confirmation(), context)).toBeNull();
    expect(getQuantityRecommendationResult(candidate('31'), confirmation('29'), context)).toBeNull();
  });

  it('uses the confirmation target when no target is specified by the current context', () => {
    const current = { ...context };
    delete current.targetServings;
    const result = getQuantityRecommendationResult(candidate(), confirmation('29', 0.5, 2), current);
    expect(result).toMatchObject({ scaleFactor: 0.5, basis: { targetServings: 2 } });
    expect(result.ingredients[0].scaledAmount).toBe(50);
  });

  it('preserves explicit zero and unknown quantities as different calculation outcomes', () => {
    expect(getQuantityRecommendationResult(candidate(), confirmation('29', 0), context)).toMatchObject({ status: 'unavailable', scaleFactor: 0 });
    const unknown = confirmation();
    unknown.inventory.items[0].amount = null;
    unknown.inventory.items[0].quantityStatus = 'unknown';
    expect(getQuantityRecommendationResult(candidate(), unknown, context)).toMatchObject({ status: 'needs-confirmation', scaleFactor: null });
  });

  it('preserves legacy recommendations and their readiness when no current quantity confirmation exists', () => {
    const legacy = { id: 'local:kimchi', title: '김치 요리', coreIngredients: ['김치'] };
    const recipes = [legacy, candidate()];
    const ingredients = [{ name: '김치' }];
    const baseline = buildRecipeRecommendations(recipes, ingredients);
    const output = buildQuantityAwareRecommendations(recipes, ingredients, { context });
    expect(output.map(({ quantityResult: _quantity, quantityContext: _context, ...rest }) => rest)).toEqual(baseline);
    expect(output).toMatchObject([{ id: 'local:kimchi', status: 'ready', canMakeNow: true, quantityResult: null, quantityContext: null }]);
  });

  it('rescues a positive confirmed recipe excluded by name matching without a score or ratio cutoff', () => {
    const recipe = candidate();
    const ingredients = [{ name: '사과' }];
    expect(buildRecipeRecommendations([recipe], ingredients)).toEqual([]);
    const output = buildQuantityAwareRecommendations([recipe], ingredients, {
      confirmations: { 'mfds:29': confirmation('29', 1e-20) }, context,
    });
    expect(output).toHaveLength(1);
    expect(output[0]).toMatchObject({ id: 'mfds:29', score: 0, status: 'needsCore', canMakeNow: false });
    expect(output[0].quantityResult.status).toBe('scaled');
    expect(output[0].quantityResult.scaleFactor).toBeGreaterThan(0);
  });

  it('keeps bound zero, unknown and invalid outcomes visible without claiming readiness', () => {
    const zero = confirmation('29', 0);
    const unknown = confirmation();
    unknown.inventory.items[0].amount = null;
    unknown.inventory.items[0].quantityStatus = 'unknown';
    const invalid = confirmation();
    invalid.inventory.items[0].amount = -1;
    for (const [value, status, scaleFactor] of [
      [zero, 'unavailable', 0],
      [unknown, 'needs-confirmation', null],
      [invalid, 'invalid', null],
    ]) {
      const output = buildQuantityAwareRecommendations([candidate()], [{ name: '사과' }], {
        confirmations: { 'mfds:29': value }, context,
      });
      expect(output).toHaveLength(1);
      expect(output[0]).toMatchObject({
        id: 'mfds:29', status: 'needsCore', canMakeNow: false,
        quantityResult: { status, scaleFactor },
      });
    }
  });

  it('does not rescue candidates with missing, stale or differently bound confirmations', () => {
    const stale = confirmation();
    stale.inventoryRevision = 'old';
    for (const value of [undefined, stale, confirmation('31')]) {
      expect(buildQuantityAwareRecommendations([candidate()], [{ name: '사과' }], {
        confirmations: { 'mfds:29': value }, context,
      })).toEqual([]);
    }
  });

  it('orders confirmed tied candidates around legacy positions while leaving readiness unchanged', () => {
    const recipes = [candidate('29'), { id: 'local:apple', title: '사과 요리', coreIngredients: ['사과'] }, candidate('31')];
    const ingredients = [...recipes[0].ingredients, ...recipes[2].ingredients].map((line) => line.rawName).concat('사과');
    const output = buildQuantityAwareRecommendations(recipes, ingredients, {
      confirmations: { 'mfds:29': confirmation('29', 0.2), 'mfds:31': confirmation('31', 0.8) }, context,
    });
    expect(output.map((recipe) => recipe.id)).toEqual(['mfds:31', 'local:apple', 'mfds:29']);
    expect(output.every((recipe) => recipe.status === 'ready' && recipe.canMakeNow)).toBe(true);
    expect(output[0].quantityResult.requirementsStatus).toBe('needs-confirmation');
  });

  it('keeps per-recipe confirmed person counts in different ordering cohorts', () => {
    const recipes = [candidate('29'), candidate('31')];
    const ingredients = recipes.flatMap((recipe) => recipe.ingredients.map((line) => line.rawName));
    const output = buildQuantityAwareRecommendations(recipes, ingredients, {
      confirmations: { 'mfds:29': confirmation('29', 0.2, 1), 'mfds:31': confirmation('31', 0.8, 2) }, context,
    });
    expect(output.map((recipe) => recipe.id)).toEqual(['mfds:29', 'mfds:31']);
    expect(output.map((recipe) => recipe.quantityContext.targetServings)).toEqual([1, 2]);
    expect(output[1].quantityResult.basis.targetServings).toBe(2);
  });

  it('does not mutate frozen sources, inventories, confirmations or context and is deterministic', () => {
    const recipes = deepFreeze([candidate()]);
    const ingredients = deepFreeze([{ name: '사과' }]);
    const options = deepFreeze({ confirmations: { 'mfds:29': confirmation() }, context: { ...context } });
    const before = structuredClone({ recipes, ingredients, options });
    const first = buildQuantityAwareRecommendations(recipes, ingredients, options);
    expect(first[0].quantityResult.scaleFactor).toBe(0.5);
    first[0].quantityResult.ingredients[0].scaledAmount = 999;
    const second = buildQuantityAwareRecommendations(recipes, ingredients, options);
    expect(second[0].quantityResult.ingredients[0].scaledAmount).toBe(25);
    expect({ recipes, ingredients, options }).toEqual(before);
  });
});
