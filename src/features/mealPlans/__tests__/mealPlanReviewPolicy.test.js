import { describe, expect, it } from 'vitest';
import { getMealPlanCatalog } from '../mealPlanCatalog.js';
import { getMealQuantityRequirements } from '../mealQuantityDomain.js';
import { PILOT_CANDIDATE_POLICY, selectMealPlanCandidates } from '../mealPlanReviewPolicy.js';

const select = catalog => selectMealPlanCandidates(catalog, PILOT_CANDIDATE_POLICY);
const reviewed = () => getMealPlanCatalog().find(item => item.key === 'mfds-dinner:book2-spinach-risotto');

describe('approved local pilot menu evidence', () => {
  it('returns the six approved whole dinners with all source quantities and preparation water intact', () => {
    const catalog = getMealPlanCatalog();
    const before = structuredClone(catalog);
    const candidates = select(catalog);
    expect(candidates.map(item => item.title)).toEqual([
      '시금치 리조또', '칠곡석류국수', '채소 자장면', '두유 파스타', '감자밥', '된장비빔밥',
    ]);
    expect(candidates.map(item => item.components[0].ingredients.length)).toEqual([7, 11, 13, 8, 7, 15]);
    expect(candidates.map(item => item.components[0].processInputs.length)).toEqual([1, 1, 4, 1, 3, 3]);
    expect(candidates.every(item => item.processQuantityStatus === 'needs-review' && item.nutrition === null)).toBe(true);
    expect(getMealQuantityRequirements(candidates[1], 2).requirements).toEqual(expect.arrayContaining([
      expect.objectContaining({ ingredientKey: 'food:물', amount: 1200, unit: 'g' }),
    ]));
    expect(candidates[3].components[0].ingredients.filter(line => line.rawName === '마늘'))
      .toMatchObject([{ amount: 40, purpose: '향내기·고명' }]);
    expect(candidates[4].components[0].processInputs.find(line => line.id.endsWith(':rice-cooking-water')))
      .toMatchObject({ amount: null, unit: null, quantityStatus: 'unverified' });
    expect(catalog).toStrictEqual(before);
  });

  it.each([
    ['unapproved new menu identity', item => { item.key = 'mfds-dinner:book2-new-menu'; }],
    ['unknown review grade', item => { item.reviewStatus = 'unreviewed'; }],
    ['unconfirmed template servings', item => { item.servingsStatus = 'unverified'; }],
    ['different source portion', item => { item.components[0].sourceServings = 2; }],
    ['missing portion evidence', item => { item.components[0].servingsEvidence = ''; }],
    ['unknown template quantity status', item => { item.quantityStatus = 'unverified'; }],
    ['side dish promoted to dinner', item => { item.components[0].role = 'side'; }],
    ['unreviewed added side', item => { item.components.push({ id: 'extra', role: 'side', ingredients: [] }); }],
    ['no source review', item => { item.components[0].source.kind = 'editorial-pairing'; }],
    ['missing source identifier', item => { item.components[0].source.id = ''; }],
    ['missing source version', item => { item.components[0].recipeVersion = ''; }],
    ['missing grain evidence', item => { item.components[0].ingredients.forEach(line => { line.foodGroups = []; }); }],
    ['unknown required amount', item => { item.components[0].ingredients[0].amount = null; }],
    ['zero required grain amount', item => { item.components[0].ingredients[0].amount = 0; }],
    ['unknown required unit', item => { item.components[0].ingredients[0].unit = '팩'; }],
    ['unknown preparation state', item => { item.components[0].ingredients[0].preparationState = null; }],
    ['missing amount evidence', item => { item.components[0].ingredients[0].quantityEvidence = ''; }],
    ['deselected required ingredient', item => { item.components[0].ingredients[0].selected = false; }],
    ['required ingredient made optional', item => { item.components[0].ingredients[0].optional = true; }],
  ])('excludes %s instead of trusting the source-reviewed label alone', (_label, corrupt) => {
    const candidate = reviewed();
    corrupt(candidate);
    expect(select([candidate])).toEqual([]);
  });

  it('fails closed for unknown policies and malformed entries without changing the ordinary catalog', () => {
    const catalog = getMealPlanCatalog();
    expect(selectMealPlanCandidates(catalog, 'unknown-pilot-policy')).toEqual([]);
    expect(select([null, {}, { reviewStatus: 'source-quantity-compared' }])).toEqual([]);
    expect(selectMealPlanCandidates(catalog)).toEqual(catalog);
  });
});
