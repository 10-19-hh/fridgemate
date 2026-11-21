import { describe, expect, it } from 'vitest';
import { validateQuantityRecipe } from '../recipeQuantityContract.js';

// These amounts and evidence labels are test fixtures, not reviewed production recipes.
function makeLine(overrides = {}) {
  return {
    id: 'pork-main',
    foodId: 'pork-shoulder',
    rawName: '돼지고기 앞다리살',
    rawText: '돼지고기 앞다리살 300g',
    section: '주재료',
    role: 'core',
    required: true,
    selected: true,
    preparationState: 'raw',
    amount: 300,
    unit: 'g',
    quantityStatus: 'verified',
    quantityEvidence: 'test fixture: source row quantity checked',
    ...overrides
  };
}

function makeRecipe(overrides = {}) {
  return {
    id: 'fixture:recipe-1',
    version: 1,
    source: { kind: 'test-fixture', id: 'fixture-source-1', name: 'Test-only recipe source' },
    servings: 2,
    servingsStatus: 'verified',
    servingsEvidence: 'test fixture: source basis is two servings',
    ingredients: [makeLine()],
    ...overrides
  };
}

function expectIssue(recipe, status, code, lineId) {
  const result = validateQuantityRecipe(recipe);
  expect(result.status).toBe(status);
  expect(result.issues).toContainEqual(lineId === undefined ? { code } : { code, lineId });
}

describe('validateQuantityRecipe', () => {
  it('allows a source-qualified recipe with explicit serving and core gram evidence', () => {
    expect(validateQuantityRecipe(makeRecipe())).toEqual({ status: 'eligible', issues: [] });
  });

  it.each([
    ['id', null, 'recipe_identity_unverified'],
    ['version', null, 'recipe_identity_unverified'],
    ['source', null, 'recipe_source_unverified'],
    ['source', { kind: 'fixture', name: 'Missing source ID' }, 'recipe_source_unverified'],
    ['source', { kind: 'fixture', id: 'source' }, 'recipe_source_unverified'],
    ['source', { id: 'source', name: 'Missing source kind' }, 'recipe_source_unverified'],
    ['servings', null, 'servings_unverified'],
    ['servingsStatus', 'unverified', 'servings_unverified'],
    ['servingsEvidence', '  ', 'servings_evidence_missing']
  ])('does not promote missing %s evidence (%j) to eligible', (field, value, code) => {
    expectIssue(makeRecipe({ [field]: value }), 'unverified', code);
  });

  it.each([0, -1, Infinity, NaN, '2'])('rejects invalid source servings %s', (servings) => {
    expectIssue(makeRecipe({ servings }), 'invalid', 'invalid_servings');
  });

  it.each([
    ['foodId', null, 'food_identity_unverified'],
    ['foodId', 'unknown', 'food_identity_unverified'],
    ['preparationState', null, 'preparation_state_unverified'],
    ['preparationState', 'unknown', 'preparation_state_unverified'],
    ['amount', null, 'core_quantity_unverified'],
    ['unit', null, 'core_unit_unverified'],
    ['unit', 'kg', 'core_unit_unverified'],
    ['unit', '모', 'core_unit_unverified'],
    ['quantityStatus', 'unverified', 'core_quantity_unverified'],
    ['quantityStatus', 'unknown', 'core_quantity_unverified'],
    ['quantityEvidence', '', 'quantity_evidence_missing'],
    ['rawName', '', 'ingredient_source_unverified'],
    ['rawText', '', 'ingredient_source_unverified']
  ])('requires explicit core %s evidence (%j)', (field, value, code) => {
    expectIssue(makeRecipe({ ingredients: [makeLine({ [field]: value })] }), 'unverified', code, 'pork-main');
  });

  it('does not turn parser confidence into quantity verification', () => {
    expectIssue(makeRecipe({ ingredients: [makeLine({
      quantityStatus: 'unverified',
      confidence: 0.99,
      quantityEvidence: 'parser output only'
    })] }), 'unverified', 'core_quantity_unverified', 'pork-main');
  });

  it.each([-1, Infinity, -Infinity, NaN, '300'])('rejects malformed provided amounts %s', (amount) => {
    expectIssue(makeRecipe({ ingredients: [makeLine({ amount })] }), 'invalid', 'invalid_amount', 'pork-main');
  });

  it('rejects a zero verified requirement instead of dividing by zero', () => {
    expectIssue(makeRecipe({ ingredients: [makeLine({ amount: 0 })] }), 'invalid', 'invalid_amount', 'pork-main');
  });

  it('does not reject tiny but positive verified gram requirements', () => {
    expect(validateQuantityRecipe(makeRecipe({ ingredients: [makeLine({ amount: 0.000001 })] })).status).toBe('eligible');
  });

  it('allows an unknown independent required seasoning for a separate confirmation notice', () => {
    const salt = makeLine({
      id: 'salt', foodId: null, rawName: '소금', rawText: '소금 약간',
      section: '양념', role: 'seasoning', preparationState: null,
      amount: null, unit: null, quantityStatus: 'unknown', quantityEvidence: ''
    });
    expect(validateQuantityRecipe(makeRecipe({ ingredients: [makeLine(), salt] }))).toEqual({
      status: 'eligible', issues: []
    });
  });

  it('ignores the quantity of optional unselected ingredients, including unselected core alternatives', () => {
    const alternative = makeLine({
      id: 'alternative', required: false, selected: false,
      foodId: null, preparationState: null, amount: null, unit: null,
      quantityStatus: 'unknown', quantityEvidence: ''
    });
    expect(validateQuantityRecipe(makeRecipe({ ingredients: [makeLine(), alternative] })).status).toBe('eligible');
  });

  it('requires gram evidence for a selected sauce row that consumes the same core food and state', () => {
    const sauceRow = makeLine({
      id: 'pork-sauce', section: '소스', role: 'other', required: false,
      amount: null, unit: null, quantityStatus: 'unknown', quantityEvidence: ''
    });
    expectIssue(makeRecipe({ ingredients: [makeLine(), sauceRow] }),
      'unverified', 'core_quantity_unverified', 'pork-sauce');
  });

  it('accepts distinct source rows for repeated food instead of treating them as duplicate line IDs', () => {
    const sauceRow = makeLine({ id: 'pork-sauce', section: '소스', role: 'seasoning', amount: 20 });
    expect(validateQuantityRecipe(makeRecipe({ ingredients: [makeLine(), sauceRow] })).status).toBe('eligible');
  });

  it('does not conflate the same food in different preparation states', () => {
    const cookedRow = makeLine({
      id: 'cooked-pork', role: 'other', preparationState: 'cooked',
      amount: null, unit: null, quantityStatus: 'unknown', quantityEvidence: ''
    });
    expect(validateQuantityRecipe(makeRecipe({ ingredients: [makeLine(), cookedRow] })).status).toBe('eligible');
  });

  it('does not let an unknown state conceal possible repeated consumption of a core food', () => {
    const ambiguousRow = makeLine({
      id: 'ambiguous-pork', role: 'seasoning', preparationState: null,
      amount: null, unit: null, quantityStatus: 'unknown', quantityEvidence: ''
    });
    expectIssue(makeRecipe({ ingredients: [makeLine(), ambiguousRow] }),
      'unverified', 'preparation_state_unverified', 'ambiguous-pork');
  });

  it('rejects duplicate source line IDs even if their food identities differ', () => {
    expectIssue(makeRecipe({ ingredients: [makeLine(), makeLine({ foodId: 'onion' })] }),
      'invalid', 'duplicate_line_id', 'pork-main');
  });

  it('requires source line identity before allowing calculations', () => {
    expectIssue(makeRecipe({ ingredients: [makeLine({ id: null })] }), 'unverified', 'line_identity_unverified');
  });

  it.each([
    ['role', undefined, 'unverified', 'ingredient_role_unverified'],
    ['role', 'garnish', 'invalid', 'invalid_ingredient_role'],
    ['selected', undefined, 'unverified', 'ingredient_selection_unverified'],
    ['selected', 'yes', 'invalid', 'invalid_ingredient_selection'],
    ['required', undefined, 'unverified', 'ingredient_selection_unverified'],
    ['required', 1, 'invalid', 'invalid_ingredient_selection']
  ])('does not infer an ingredient %s flag from %j', (field, value, status, code) => {
    expectIssue(makeRecipe({ ingredients: [makeLine({ [field]: value })] }), status, code, 'pork-main');
  });

  it('does not hide a malformed negative quantity by unselecting the row', () => {
    const optional = makeLine({ id: 'optional', required: false, selected: false, amount: -1 });
    expectIssue(makeRecipe({ ingredients: [makeLine(), optional] }), 'invalid', 'invalid_amount', 'optional');
  });

  it('rejects an explicitly unselected required ingredient', () => {
    expectIssue(makeRecipe({ ingredients: [makeLine({ selected: false })] }),
      'invalid', 'required_not_selected', 'pork-main');
  });

  it('rejects a selected core ingredient not marked required', () => {
    expectIssue(makeRecipe({ ingredients: [makeLine({ required: false })] }),
      'invalid', 'selected_core_not_required', 'pork-main');
  });

  it.each([
    { ingredients: [] },
    { ingredients: [makeLine({ role: 'seasoning' })] },
    { ingredients: [makeLine({ selected: false, required: false })] }
  ])('rejects an explicit recipe without an active core ingredient', ({ ingredients }) => {
    expectIssue(makeRecipe({ ingredients }), 'invalid', 'no_active_core');
  });

  it('keeps legacy quantity-null rows unverified without manufacturing roles or amounts', () => {
    const legacy = makeRecipe({
      servings: null, servingsStatus: 'unverified', servingsEvidence: '',
      ingredients: [{
        id: 'legacy-pork', rawName: '돼지고기', normalizedName: '돼지고기',
        amount: null, unit: null, quantityStatus: 'unverified', selected: true
      }]
    });
    expectIssue(legacy, 'unverified', 'ingredient_role_unverified', 'legacy-pork');
  });

  it.each([{ recipe: null }, { recipe: [] }, { recipe: 'recipe' }])('rejects a non-object recipe without throwing (%j)', ({ recipe }) => {
    expectIssue(recipe, 'invalid', 'invalid_recipe');
  });

  it('keeps missing legacy ingredient rows unverified', () => {
    expectIssue(makeRecipe({ ingredients: undefined }), 'unverified', 'ingredients_unverified');
  });

  it('rejects a non-array ingredient collection', () => {
    expectIssue(makeRecipe({ ingredients: {} }), 'invalid', 'invalid_ingredients');
  });

  it('rejects a malformed ingredient row without throwing', () => {
    expectIssue(makeRecipe({ ingredients: [null] }), 'invalid', 'invalid_ingredient');
  });

  it('prioritizes invalid data over unrelated missing verification', () => {
    expectIssue(makeRecipe({ source: null, ingredients: [makeLine({ amount: -2 })] }),
      'invalid', 'invalid_amount', 'pork-main');
  });

  it('does not mutate or collapse original recipe source rows on repeated validation', () => {
    const recipe = makeRecipe({ ingredients: [makeLine(), makeLine({ id: 'pork-sauce', amount: 20 })] });
    const before = structuredClone(recipe);
    Object.freeze(recipe.source);
    recipe.ingredients.forEach(Object.freeze);
    Object.freeze(recipe.ingredients);
    Object.freeze(recipe);

    expect(validateQuantityRecipe(recipe)).toEqual({ status: 'eligible', issues: [] });
    expect(validateQuantityRecipe(recipe)).toEqual({ status: 'eligible', issues: [] });
    expect(recipe).toEqual(before);
  });
});
