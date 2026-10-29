import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import publicRecipes from '../../../data/publicRecipes.json';
import sourceReviews from '../reviewedRecipeSources.json';
import { getReviewedRecipeCatalog } from '../reviewedRecipeCatalog.js';
import { getMealQuantityRequirements } from '../mealQuantityDomain.js';

function componentFor(id) {
  const component = getReviewedRecipeCatalog().components.find((item) => item.source.id === id);
  expect(component).toBeDefined();
  return component;
}

describe('source-compared recipe quantity catalog', () => {
  it('provides four source-compared recipe components, not invented complete dinner templates', () => {
    const result = getReviewedRecipeCatalog();
    expect(result.components.map((item) => item.source.id)).toEqual(['28', '29', '32', '91']);
    expect(result.blocked).toEqual([]);
    expect(result.components.every((item) => item.role === 'side')).toBe(true);
  });

  it('uses explicit book serving evidence instead of assuming every API recipe is one portion', () => {
    const component = componentFor('28');
    expect(component).toMatchObject({ servings: 1, servingsStatus: 'verified', source: {
      kind: 'mfds-source-comparison', id: '28', book: { pdfPage: 43, printedPages: [84, 85] },
    } });
    const result = getMealQuantityRequirements({ components: [component] }, 2);
    expect(result.requirements).toEqual(expect.arrayContaining([
      expect.objectContaining({ ingredientKey: 'food:연두부', amount: 150, unit: 'g' }),
      expect.objectContaining({ ingredientKey: 'food:칵테일새우', amount: 40, unit: 'g' }),
      expect.objectContaining({ ingredientKey: 'food:무염버터', amount: 10, unit: 'g' }),
    ]));
    expect(component.processInputs).toEqual([expect.objectContaining({ name: '데치는 물', amount: null })]);
  });

  it('keeps an indefinite seasoning mandatory and unknown rather than deleting it to pass review', () => {
    const component = componentFor('29');
    expect(component.ingredients.find((item) => item.rawName === '참깨')).toMatchObject({
      amount: null, unit: null, rawAmount: '약간', selected: true, optional: false,
      quantityStatus: 'unverified',
    });
    const result = getMealQuantityRequirements({ components: [component] }, 2);
    expect(result).toMatchObject({ status: 'needs-review', unverifiedLines: [
      { lineId: 'mfds:29:seasoning:sesame', reason: 'unverified-quantity' },
    ] });
    expect(result.requirements).toEqual(expect.arrayContaining([
      expect.objectContaining({ ingredientKey: 'food:조선부추', amount: 100 }),
      expect.objectContaining({ ingredientKey: 'food:저염간장', amount: 6 }),
    ]));
  });

  it('retains the salt used only in a cooking step as an unresolved process ingredient', () => {
    const component = componentFor('32');
    expect(component.ingredients.find((item) => item.rawName === '소금')).toMatchObject({
      amount: null, quantityStatus: 'unverified', purpose: '세척',
      sourceLocation: { kind: 'step', order: 2, text: '소금' },
    });
    expect(getMealQuantityRequirements({ components: [component] }, 1)).toMatchObject({
      status: 'needs-review', unverifiedLines: [{ lineId: 'mfds:32:cleaning:salt' }],
    });
  });

  it('sums two distinct olive-oil uses while preserving both source quantities and purposes', () => {
    const component = componentFor('91');
    const oil = component.ingredients.filter((item) => item.ingredientKey === 'food:올리브유');
    expect(oil.map((item) => ({ amount: item.amount, purpose: item.purpose }))).toEqual([
      { amount: 10, purpose: '버섯구이' }, { amount: 2, purpose: '두부타르타르 소스' },
    ]);
    expect(getMealQuantityRequirements({ components: [component] }, 2)).toMatchObject({
      status: 'needs-review', requirements: expect.arrayContaining([
        expect.objectContaining({ ingredientKey: 'food:올리브유', amount: 24, sourceLines: [
          { componentId: 'mfds:91', lineId: 'mfds:91:grill:oil' },
          { componentId: 'mfds:91', lineId: 'mfds:91:sauce:oil' },
        ] }),
      ]),
    });
  });

  it('records row-level source evidence without converting household measures to grams', () => {
    const component = componentFor('28');
    const tofu = component.ingredients.find((item) => item.rawName === '연두부');
    expect(tofu).toMatchObject({ amount: 75, unit: 'g', rawAmount: '75g(3/4모)',
      sourceLocation: { kind: 'ingredients', text: '연두부 75g(3/4모)' } });
    expect(tofu.quantityEvidence).toContain('PDF 43');
    expect(component.recipeVersion).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(component.nutrition).toBeNull();
    expect(component.nutritionStatus).toBe('unavailable');
  });

  it.each(['name', 'ingredientsText', 'source', 'sourceUrl'])('blocks stale review when source %s changes', (field) => {
    const sources = structuredClone(publicRecipes);
    sources.find((item) => item.externalId === '28')[field] += ' changed';
    const result = getReviewedRecipeCatalog(sources);
    expect(result.components.map((item) => item.source.id)).not.toContain('28');
    expect(result.blocked).toEqual([{ externalId: '28', reason: 'source-changed' }]);
  });

  it('blocks changed, missing or reordered cooking steps, not just ingredient-text drift', () => {
    for (const change of [
      (recipe) => { recipe.steps[0].text += ' changed'; },
      (recipe) => { recipe.steps.pop(); },
      (recipe) => { recipe.steps.reverse(); },
    ]) {
      const sources = structuredClone(publicRecipes);
      change(sources.find((item) => item.externalId === '28'));
      expect(getReviewedRecipeCatalog(sources).blocked).toEqual([{ externalId: '28', reason: 'source-changed' }]);
    }
  });

  it('fails closed on missing or ambiguous source identities', () => {
    expect(getReviewedRecipeCatalog(publicRecipes.filter((item) => item.externalId !== '28')).blocked)
      .toEqual([{ externalId: '28', reason: 'missing-source' }]);
    expect(getReviewedRecipeCatalog([...publicRecipes, publicRecipes.find((item) => item.externalId === '28')]).blocked)
      .toEqual([{ externalId: '28', reason: 'ambiguous-source' }]);
  });

  it('blocks a missing step even when a sparse array keeps the old step count', () => {
    const sources = structuredClone(publicRecipes);
    delete sources.find((item) => item.externalId === '28').steps[0];
    const result = getReviewedRecipeCatalog(sources);
    expect(result.components.map((item) => item.source.id)).not.toContain('28');
    expect(result.blocked).toEqual([{ externalId: '28', reason: 'source-changed' }]);
  });

  it('does not share mutable source rows or source metadata between calls', () => {
    const before = JSON.stringify(publicRecipes);
    const first = componentFor('28');
    first.ingredients[0].amount = 999;
    first.source.book.printedPages[0] = 999;
    expect(componentFor('28').ingredients[0].amount).toBe(75);
    expect(componentFor('28').source.book.printedPages).toEqual([84, 85]);
    expect(JSON.stringify(publicRecipes)).toBe(before);
  });

  // Literal amounts independently transcribed from the four book spreads.
  // In particular, changing an unmentioned row (e.g. cream 13 -> 130) must fail.
  it.each([
    ['28', [['연두부', 75], ['칵테일새우', 20], ['달걀', 30], ['생크림', 13],
      ['설탕', 5], ['무염버터', 5], ['시금치', 10]]],
    ['29', [['조선부추', 50], ['날콩가루', 7], ['저염간장', 3], ['다진 대파', 5],
      ['다진 마늘', 2], ['고춧가루', 2], ['요리당', 2], ['참기름', 2], ['참깨', null]]],
    ['32', [['오이', 70], ['다진 땅콩', 10], ['순두부', 40], ['사과', 50], ['소금', null]]],
    ['91', [['새송이버섯', 70], ['올리브유', 10], ['치커리', 10], ['연두부', 30],
      ['다진 양파', 10], ['다진 오이피클', 10], ['올리브유', 2], ['식초', 5],
      ['레몬즙', 3], ['머스터드', 3], ['꿀', 2], ['흰 후추', null]]],
  ])('preserves every required source quantity in recipe %s', (id, amounts) => {
    const component = componentFor(id);
    expect(component.ingredients.map((line) => [line.rawName, line.amount])).toEqual(amounts);
    expect(component.ingredients.map((line) => line.unit))
      .toEqual(amounts.map(([, amount]) => amount === null ? null : 'g'));
    expect(component.ingredients.every((line) => line.optional === false && line.selected === true)).toBe(true);
  });

  it('keeps each returned source reference resolvable to the pinned recipe version', () => {
    for (const component of getReviewedRecipeCatalog().components) {
      const { sourceSnapshot } = sourceReviews.find((review) => review.sourceSnapshot.externalId === component.source.id);
      expect(component.recipeVersion).toBe(`sha256:${createHash('sha256').update(JSON.stringify(sourceSnapshot)).digest('hex')}`);
      for (const line of [...component.ingredients, ...component.processInputs]) {
        const location = line.sourceLocation;
        const text = location.kind === 'ingredients' ? sourceSnapshot.ingredientsText
          : sourceSnapshot.steps.find((step) => step.order === location.order)?.text;
        expect(text).toBeDefined();
        expect(text).toContain(location.text);
      }
    }
  });
});
