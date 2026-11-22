import { afterEach, describe, expect, it, vi } from 'vitest';
import { publicRecipeCatalog } from '../publicRecipeCatalog';
import * as quantityCatalog from '../quantityRecipeCatalog';
import { getQuantityRecommendationRecipes, getQuantityRecipeForRecommendation } from '../quantityRecommendationCatalog';

afterEach(() => vi.restoreAllMocks());

describe('quantity recommendation source adapter', () => {
  it('adapts source-matched recipes with exact identity, typed ingredients and a public detail path', () => {
    const candidates = getQuantityRecommendationRecipes();
    const recipe = candidates.find((candidate) => candidate.id === 'mfds:29');
    expect(recipe).toMatchObject({
      id: 'mfds:29', title: '부추 콩가루 찜',
      quantitySource: { kind: 'mfds-cookrcp01', id: '29', version: '2026-09-15.1' },
      publicRecipePath: '/recipes/29-부추-콩가루-찜',
    });
    expect(recipe.ingredients.slice(0, 3)).toMatchObject([
      { rawName: '조선부추', ingredientType: 'main' },
      { rawName: '날콩가루', ingredientType: 'main' },
      { rawName: '저염간장', ingredientType: 'seasoning' },
    ]);
    expect(recipe.ingredients).toHaveLength(9);
    expect(candidates.some((candidate) => candidate.id === 'mfds:32')).toBe(false);
    expect(recipe).not.toHaveProperty('cookTimeMinutes');
    expect(recipe).not.toHaveProperty('nutrition');
  });

  it('preserves required and optional non-core classification without adding unselected rows', () => {
    const canonical = quantityCatalog.getQuantityRecipeForPublicRecipe(publicRecipeCatalog.find((recipe) => recipe.externalId === '29'));
    // The current genuine catalog has no optional row; exercise this adapter boundary
    // with controlled source-resolver output without changing the production catalog.
    canonical.ingredients[2].role = 'other';
    canonical.ingredients[3].role = 'other';
    canonical.ingredients[3].required = false;
    canonical.ingredients[4].required = false;
    canonical.ingredients[4].selected = false;
    vi.spyOn(quantityCatalog, 'getQuantityRecipeForPublicRecipe').mockImplementation((source) => source.externalId === '29' ? structuredClone(canonical) : null);
    const recipe = getQuantityRecommendationRecipes()[0];
    expect(recipe.ingredients.find((line) => line.rawName === '저염간장').ingredientType).toBe('main');
    expect(recipe.ingredients.find((line) => line.rawName === '다진 대파').ingredientType).toBe('optional');
    expect(recipe.ingredients.some((line) => line.rawName === '다진 마늘')).toBe(false);
  });

  it('resolves exact canonical identity but never joins an unrelated candidate by title', () => {
    const candidate = getQuantityRecommendationRecipes().find((recipe) => recipe.id === 'mfds:29');
    expect(getQuantityRecipeForRecommendation(candidate)).toMatchObject({ id: 'mfds:29', servings: 1 });
    for (const altered of [
      { ...candidate, id: 'local:same-title' },
      { ...candidate, quantitySource: undefined },
      { ...candidate, quantitySource: { ...candidate.quantitySource, kind: 'other-source' } },
      { ...candidate, quantitySource: { ...candidate.quantitySource, id: 29 } },
      { ...candidate, quantitySource: { ...candidate.quantitySource, id: '31' } },
      { ...candidate, quantitySource: { ...candidate.quantitySource, version: 'old-version' } },
      { title: candidate.title },
    ]) expect(getQuantityRecipeForRecommendation(altered)).toBeNull();
  });

  it('fails closed if the reviewed source resolver withdraws a quantity record', () => {
    const candidate = getQuantityRecommendationRecipes().find((recipe) => recipe.id === 'mfds:29');
    vi.spyOn(quantityCatalog, 'getQuantityRecipeForPublicRecipe').mockReturnValue(null);
    expect(getQuantityRecipeForRecommendation(candidate)).toBeNull();
    expect(getQuantityRecommendationRecipes()).toEqual([]);
  });

  it('keeps public sources and later adapter/resolver results independent of caller mutation', () => {
    const before = structuredClone(publicRecipeCatalog);
    const first = getQuantityRecommendationRecipes().find((recipe) => recipe.id === 'mfds:29');
    const canonical = getQuantityRecipeForRecommendation(first);
    first.ingredients[0].rawName = '다른 재료';
    first.quantitySource.version = 'changed';
    canonical.ingredients[0].amount = 999;
    const second = getQuantityRecommendationRecipes().find((recipe) => recipe.id === 'mfds:29');
    expect(second.ingredients[0].rawName).toBe('조선부추');
    expect(getQuantityRecipeForRecommendation(second).ingredients[0].amount).toBe(50);
    expect(publicRecipeCatalog).toEqual(before);
  });
});
