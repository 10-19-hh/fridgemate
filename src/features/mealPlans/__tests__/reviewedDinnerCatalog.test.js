import { describe, expect, it } from 'vitest';
import { getReviewedDinnerCatalog } from '../reviewedDinnerCatalog';
import { getMealQuantityRequirements } from '../mealQuantityDomain';

const BOOK_HASH = 'f3ae4dce2cbde7e8024932ee7e87d20bd76230009848dbc7b3813dd4e4e42f6c';

function dinner(key) {
  const template = getReviewedDinnerCatalog().templates.find((item) => item.key === `mfds-dinner:book2-${key}`);
  expect(template).toBeDefined();
  return template;
}

describe('source-compared one-bowl dinner catalog', () => {
  it('provides only the six named bowl compositions actually compared to book pages', () => {
    const { templates, blocked } = getReviewedDinnerCatalog();
    expect(templates.map((item) => item.title)).toEqual(['시금치 리조또', '칠곡석류국수', '채소 자장면', '두유 파스타', '감자밥', '된장비빔밥']);
    expect(blocked).toEqual([]);
    expect(templates.every((item) => item.components.length === 1 && item.components[0].role === 'main')).toBe(true);
    expect(templates.map((item) => item.components[0].source.book.pdfPage)).toEqual([26, 16, 15, 21, 25, 28]);
  });

  it('preserves every risotto ingredient amount rather than assuming a rice portion or changing butter to unsalted butter', () => {
    const component = dinner('spinach-risotto').components[0];
    expect(component.ingredients.map((line) => [line.rawName, line.amount, line.unit, line.preparationState])).toEqual([
      ['밥', 180, 'g', 'cooked'], ['시금치', 50, 'g', 'raw'], ['마', 10, 'g', 'raw'],
      ['두유', 150, 'g', 'as-sold'], ['소금', 1, 'g', 'as-sold'], ['버터', 8, 'g', 'as-sold'],
      ['후춧가루', 1, 'g', 'as-sold'],
    ]);
    expect(component.ingredients[0].rawAmount).toBe('180g(1컵)');
    expect(component.ingredients.every((line) => line.selected && !line.optional)).toBe(true);
  });

  it('scales source-confirmed portions without overwriting original rows', () => {
    const template = dinner('spinach-risotto');
    const before = structuredClone(template);
    expect(getMealQuantityRequirements(template, 2)).toMatchObject({
      status: 'verified', unverifiedLines: [], requirements: expect.arrayContaining([
        expect.objectContaining({ ingredientKey: 'food:밥', amount: 360, unit: 'g', preparationState: 'cooked' }),
        expect.objectContaining({ ingredientKey: 'food:두유', amount: 300, unit: 'g' }),
        expect.objectContaining({ ingredientKey: 'food:버터', amount: 16, unit: 'g' }),
      ]),
    });
    expect(template).toEqual(before);
  });

  it('retains the sauce water found only in a noodle cooking step as a required measured row', () => {
    const component = dinner('chilgok-pomegranate-noodles').components[0];
    expect(component.ingredients.map((line) => [line.rawName, line.amount])).toEqual([
      ['소면', 160], ['저염소금', 4], ['식초', 8], ['석류', 200], ['잣', 4],
      ['아몬드', 4], ['해바라기씨', 4], ['호두', 4], ['호박씨', 4], ['오이', 20], ['물', 600],
    ]);
    expect(component.ingredients.at(-1)).toMatchObject({
      unit: 'g', optional: false, selected: true, purpose: '석류즙',
      sourceLocation: { kind: 'step', order: 3 },
    });
    expect(getMealQuantityRequirements({ components: [component] }, 2).requirements).toEqual(expect.arrayContaining([
      expect.objectContaining({ ingredientKey: 'food:물', amount: 1200, unit: 'g' }),
      expect.objectContaining({ ingredientKey: 'food:소면', amount: 320, unit: 'g' }),
    ]));
  });

  it('keeps indefinite blanching and boiling water separate and unresolved rather than dropping or estimating it', () => {
    const templates = getReviewedDinnerCatalog().templates;
    expect(templates.map((template) => template.components[0].processInputs.length)).toEqual([1, 1, 4, 1, 3, 3]);
    for (const template of templates) {
      for (const line of template.components[0].processInputs) {
        expect(line).toMatchObject({ amount: null, unit: null, quantityStatus: 'unverified', optional: false });
      }
      expect(template.processQuantityStatus).toBe('needs-review');
      expect(template.nutrition).toBeNull();
      expect(template.nutritionStatus).toBe('unavailable');
      expect(template.cookingMinutes).toBeNull();
    }
  });

  it('keeps explicit serving, source version and independent review evidence with the plan-ready snapshot', () => {
    const component = dinner('spinach-risotto').components[0];
    expect(component).toMatchObject({
      servings: 1, servingsStatus: 'verified', recipeVersion: `sha256:${BOOK_HASH}:page:26`,
      source: { book: { sha256: BOOK_HASH, pdfPage: 26, printedPages: [50, 51] } },
    });
    expect(component.servingsEvidence).toContain('재료 준비(1인분)');
    expect(component.source.url).toBe('https://www.foodsafetykorea.go.kr/upload/20170417/20170417053825_1492418305244.pdf#page=26');
    for (const line of component.ingredients) {
      expect(line.quantityEvidence).toContain('PDF 26');
      expect(line.sourceLocation.text).toContain(line.rawName);
    }
  });

  it('returns independent copies so an edited saved plan cannot alter future source portions', () => {
    const first = dinner('spinach-risotto');
    first.components[0].ingredients[0].amount = 999;
    first.components[0].source.book.printedPages[0] = 999;
    first.components[0].processInputs[0].amount = 100;
    const next = dinner('spinach-risotto');
    expect(next.components[0].ingredients[0].amount).toBe(180);
    expect(next.components[0].source.book.printedPages).toEqual([50, 51]);
    expect(next.components[0].processInputs[0].amount).toBeNull();
  });
});
