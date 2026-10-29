import { describe, expect, it } from 'vitest';
import { getReviewedDinnerCatalog } from '../reviewedDinnerCatalog';
import { getMealQuantityRequirements } from '../mealQuantityDomain';
import { allocateMealPlanInventory } from '../mealPlanAllocation';
import { generateMealPlan, toggleMealPlanSlotLock } from '../mealPlanDomain';

const WEEK = '2026-09-21';
const NOW = '2026-09-16T03:00:00.000Z';
// Independent transcription of the four visually checked source tables.
const CASES = [
  { key: 'vegetable-jajang-noodles', title: '채소 자장면', page: 15, pages: [28, 29], waters: [1, 2, 5, 9], rows: [
    ['중화면', 200, 'as-sold'], ['감자', 80, 'raw'], ['양파', 80, 'raw'], ['애호박', 30, 'raw'],
    ['검은콩', 2, 'as-sold'], ['새송이버섯', 30, 'raw'], ['옥수수통조림', 10, 'as-sold'],
    ['설탕', 20, 'as-sold'], ['저염간장', 15, 'as-sold'], ['자장분말', 30, 'as-sold'],
    ['녹말가루', 30, 'as-sold'], ['오이', 30, 'raw'], ['완두콩', 10, 'as-sold'],
  ] },
  { key: 'soy-drink-pasta', title: '두유 파스타', page: 21, pages: [40, 41], waters: [1], rows: [
    ['페투치네', 120, 'as-sold'], ['올리브오일', 2, 'as-sold'], ['양파', 40, 'raw'],
    ['두유', 400, 'as-sold'], ['흰 후춧가루', 5, 'as-sold'], ['파마산치즈가루', 30, 'as-sold'],
    ['실파', 2, 'raw'], ['마늘', 40, 'raw'],
  ] },
  { key: 'potato-rice', title: '감자밥', page: 25, pages: [48, 49], waters: [1, 3, 6], rows: [
    ['쌀', 200, 'as-sold'], ['감자', 200, 'raw'], ['양파', 100, 'raw'], ['양송이버섯', 50, 'raw'],
    ['목이버섯', 5, 'as-sold'], ['칵테일새우', 15, 'as-sold'], ['깻잎', 10, 'raw'],
  ] },
  { key: 'doenjang-bibimbap', title: '된장비빔밥', page: 28, pages: [54, 55], waters: [2, 2, 7], rows: [
    ['현미', 60, 'as-sold'], ['쌀', 60, 'as-sold'], ['숙주', 40, 'raw'], ['두부', 70, 'as-sold'],
    ['비름나물', 30, 'raw'], ['쇠고기(우둔)', 50, 'raw'], ['달걀', 40, 'raw'], ['당근', 40, 'raw'],
    ['된장', 5, 'as-sold'], ['파인애플', 10, 'raw'], ['마늘', 5, 'raw'], ['청양고추', 2, 'raw'],
    ['양파', 5, 'raw'], ['들깨가루', 3, 'as-sold'], ['참기름', 10, 'as-sold'],
  ] },
];

function templateFor(key) {
  const template = getReviewedDinnerCatalog().templates.find((item) => item.key === `mfds-dinner:book2-${key}`);
  expect(template, `reviewed dinner ${key}`).toBeDefined();
  return template;
}

function generate(candidate, excludedIngredients = [], previousPlan = null) {
  return generateMealPlan({ weekStart: WEEK, now: NOW, previousPlan,
    preferences: { servings: 2, dinnerDays: [0], excludedIngredients },
    ingredients: candidate.rows.map(([name]) => ({ name, expiryDate: WEEK, consumed: false })),
  });
}

describe('additional source-compared dinner compositions', () => {
  it.each(CASES)('preserves every original one-person row and evidence for $title', (candidate) => {
    const component = templateFor(candidate.key).components[0];
    expect(component.title).toBe(candidate.title);
    expect(component.source.book).toMatchObject({ pdfPage: candidate.page, printedPages: candidate.pages });
    expect(component).toMatchObject({ sourceServings: 1, servings: 1, servingsStatus: 'verified' });
    expect(component.ingredients.map((line) => [line.rawName, line.amount, line.preparationState])).toEqual(candidate.rows);
    for (const line of component.ingredients) {
      expect(line).toMatchObject({ unit: 'g', optional: false, selected: true, quantityStatus: 'verified' });
      expect(line.quantityEvidence).toContain(`PDF ${candidate.page}`);
      expect(line.rawAmount).toMatch(new RegExp(`^${line.amount}g`));
      expect(line.purpose).toBeTruthy();
    }
  });

  it.each(CASES)('scales $title for two people without changing raw units or source rows', (candidate) => {
    const template = templateFor(candidate.key);
    const before = structuredClone(template);
    const result = getMealQuantityRequirements(template, 2);
    expect(result.status).toBe('verified');
    expect(result.unverifiedLines).toEqual([]);
    expect(result.requirements.map((line) => [line.ingredientKey, line.amount, line.unit, line.preparationState])).toEqual(
      candidate.rows.map(([name, amount, state]) => [`food:${name.replace(/\s+/g, '')}`, amount * 2, 'g', state]),
    );
    expect(template).toEqual(before);
  });

  it.each(CASES)('keeps all unmeasured processing water unresolved in $title shopping', (candidate) => {
    const template = templateFor(candidate.key);
    const water = template.components[0].processInputs;
    expect(water.map((line) => line.sourceLocation.order)).toEqual(candidate.waters);
    expect(new Set(water.map((line) => line.id)).size).toBe(water.length);
    for (const line of water) expect(line).toMatchObject({ amount: null, unit: null, optional: false, quantityStatus: 'unverified' });
    const result = allocateMealPlanInventory({ scope: 'guest', today: WEEK, inventory: [], confirmedPlans: [{
      scope: 'guest', weekStart: WEEK, slots: [{ ...template, id: `${WEEK}:dinner`, date: WEEK, status: 'planned', servings: 2 }],
    }] });
    expect(result.status).toBe('needs-review');
    expect(result.shopping.needsReview.map((item) => item.label)).toEqual(water.map((line) => line.name));
    expect(result.shopping.needsReview.every((item) => item.reason === 'process-quantity-unverified')).toBe(true);
    expect(result.shopping.shortages.some((item) => item.ingredientKey === 'food:물')).toBe(false);
    expect(result.shopping.shortages).toHaveLength(candidate.rows.length);
  });

  it.each(CASES)('uses $title in normal generation when its actual ingredient names match', (candidate) => {
    const plan = generate(candidate);
    expect(plan.slots[0].templateKey).toBe(`mfds-dinner:book2-${candidate.key}`);
    expect(plan.slots[0].components).toEqual(templateFor(candidate.key).components);
    expect(generate(candidate)).toEqual(plan);
  });

  it.each([
    ['soy-drink-pasta', '페투치네', '파스타면'],
    ['soy-drink-pasta', '올리브오일', '올리브유'],
    ['soy-drink-pasta', '흰 후춧가루', '후추'],
    ['soy-drink-pasta', '파마산치즈가루', '파마산 치즈'],
    ['doenjang-bibimbap', '쇠고기(우둔)', '소고기'],
    ['potato-rice', '칵테일새우', '새우'],
    ['vegetable-jajang-noodles', '저염간장', '간장'],
  ])('respects raw and reviewed exclusion names in %s: %s / %s', (key, rawName, normalizedName) => {
    const candidate = CASES.find((item) => item.key === key);
    const original = generate(candidate);
    expect(original.slots[0].templateKey).toBe(`mfds-dinner:book2-${key}`);
    const line = original.slots[0].components[0].ingredients.find((item) => item.rawName === rawName);
    // An exclusion category never establishes quantitative compatibility.
    expect(line).toMatchObject({ normalizedName, ingredientKey: `food:${rawName.replace(/\s+/g, '')}` });
    for (const excluded of [rawName, normalizedName]) {
      expect(generate(candidate, [excluded]).slots[0].templateKey).not.toBe(original.slots[0].templateKey);
      const locked = toggleMealPlanSlotLock(original, original.slots[0].id, { now: NOW });
      const preserved = generate(candidate, [excluded], locked).slots[0];
      expect(preserved.components).toEqual(original.slots[0].components);
      expect(preserved.notice).toContain(`제외 재료(${rawName})`);
    }
  });

  it('does not turn an unspecified rice-to-water ratio into grams or replace source amaranth with spinach', () => {
    const potato = templateFor('potato-rice').components[0];
    expect(potato.ingredients[0].rawAmount).toBe('200g(1컵)');
    expect(potato.source.comparisonNote).toContain('1:1');
    expect(potato.processInputs.find((line) => line.sourceLocation.order === 6)).toMatchObject({ amount: null, unit: null });
    expect(templateFor('doenjang-bibimbap').components[0].ingredients.map((line) => line.rawName)).toContain('비름나물');
    expect(templateFor('doenjang-bibimbap').components[0].ingredients.map((line) => line.rawName)).not.toContain('시금치');
  });
});
