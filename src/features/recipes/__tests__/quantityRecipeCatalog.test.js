import { describe, expect, it } from 'vitest';
import publicRecipes from '../../../data/publicRecipes.json';
import { getQuantityRecipeForPublicRecipe } from '../quantityRecipeCatalog.js';
import { validateQuantityRecipe } from '../recipeQuantityContract.js';

const publicRecipe29 = publicRecipes.find((recipe) => recipe.externalId === '29');

describe('getQuantityRecipeForPublicRecipe', () => {
  it('provides the source-compared one-serving recipe without inventing a sesame amount', () => {
    const recipe = getQuantityRecipeForPublicRecipe(publicRecipe29);
    expect(recipe).not.toBeNull();
    expect(validateQuantityRecipe(recipe)).toEqual({ status: 'eligible', issues: [] });
    expect(recipe).toMatchObject({
      id: 'mfds:29', version: '2026-09-15.1', name: '부추 콩가루 찜',
      source: { kind: 'mfds-cookrcp01', id: '29', name: '식품의약품안전처 조리식품의 레시피 DB' },
      servings: 1, servingsStatus: 'verified',
      review: {
        method: 'ai-source-comparison', reviewedAt: '2026-09-15',
        humanReviewed: false, cookingValidated: false, nutritionExpertReviewed: false,
        weightBasis: 'purchase-vs-trimmed-unspecified',
        references: [{
          url: 'https://www.foodsafetykorea.go.kr/upload/20170417/20170417053825_1492418305214.pdf',
          pdfPage: 44, printedPages: '86–87'
        }]
      },
      reviewNote: 'AI가 원문 분량을 대조했습니다. 실조리·영양 전문가 검증은 하지 않았습니다.'
    });
    expect(recipe.ingredients.map(({ rawName, rawText, role, required, selected, amount, unit, quantityStatus }) => ({
      rawName, rawText, role, required, selected, amount, unit, quantityStatus
    }))).toEqual([
      { rawName: '조선부추', rawText: '조선부추 50g', role: 'core', required: true, selected: true, amount: 50, unit: 'g', quantityStatus: 'verified' },
      { rawName: '날콩가루', rawText: '날콩가루 7g(1⅓작은술)', role: 'core', required: true, selected: true, amount: 7, unit: 'g', quantityStatus: 'verified' },
      { rawName: '저염간장', rawText: '저염간장 3g(2/3작은술)', role: 'seasoning', required: true, selected: true, amount: 3, unit: 'g', quantityStatus: 'verified' },
      { rawName: '다진 대파', rawText: '다진 대파 5g(1작은술)', role: 'seasoning', required: true, selected: true, amount: 5, unit: 'g', quantityStatus: 'verified' },
      { rawName: '다진 마늘', rawText: '다진 마늘 2g(1/2쪽)', role: 'seasoning', required: true, selected: true, amount: 2, unit: 'g', quantityStatus: 'verified' },
      { rawName: '고춧가루', rawText: '고춧가루 2g(1/3작은술)', role: 'seasoning', required: true, selected: true, amount: 2, unit: 'g', quantityStatus: 'verified' },
      { rawName: '요리당', rawText: '요리당 2g(1/3작은술)', role: 'seasoning', required: true, selected: true, amount: 2, unit: 'g', quantityStatus: 'verified' },
      { rawName: '참기름', rawText: '참기름 2g(1/3작은술)', role: 'seasoning', required: true, selected: true, amount: 2, unit: 'g', quantityStatus: 'verified' },
      { rawName: '참깨', rawText: '참깨 약간', role: 'seasoning', required: true, selected: true, amount: null, unit: null, quantityStatus: 'unknown' }
    ]);
    expect(recipe.ingredients.map((line) => line.foodId)).toEqual([
      'joseon-chives', 'raw-soybean-powder', 'low-sodium-soy-sauce', 'green-onion',
      'garlic', 'red-pepper-powder', 'cooking-syrup', 'sesame-oil', 'sesame-seeds'
    ]);
    expect(recipe.ingredients.map((line) => line.preparationState)).toEqual([
      'raw', 'raw-ground', 'liquid', 'minced', 'minced', 'ground', 'liquid', 'liquid', null
    ]);
    expect(recipe.servingsEvidence).toContain('[1인분]');
    expect(recipe.servingsEvidence).toContain('PDF 44');
    expect(recipe.servingsEvidence).toContain('86–87');
    expect(recipe.sourceNotes.join(' ')).toContain('구입중량');
    expect(recipe.sourceNotes.join(' ')).toContain('수율');
  });

  it.each([
    { field: 'externalId', value: '31' },
    { field: 'externalId', value: 29 },
    { field: 'name', value: '부추콩가루찜' },
    { field: 'cookingMethod', value: '끓이기' },
    { field: 'dishType', value: '국&찌개' },
    { field: 'servingWeight', value: 100 },
    { field: 'source', value: '이름만 같은 복제 출처' },
    { field: 'sourceUrl', value: 'https://example.invalid/recipe-29' },
    { field: 'ingredientsText', value: publicRecipe29.ingredientsText.replace('50g', '60g') },
    { field: 'ingredientsText', value: publicRecipe29.ingredientsText.replace('50g', '50ml') },
    { field: 'ingredientsText', value: publicRecipe29.ingredientsText.replace('[1인분]', '[2인분]') }
  ])('withholds the reviewed recipe after $field changes to $value', ({ field, value }) => {
    expect(getQuantityRecipeForPublicRecipe({ ...publicRecipe29, [field]: value })).toBeNull();
  });

  it.each([
    { label: 'text changed', steps: publicRecipe29.steps.map((step, index) => index === 0 ? { ...step, text: `${step.text} 소금을 추가한다.` } : step) },
    { label: 'new step', steps: [...publicRecipe29.steps, { order: 4, text: '4. 추가로 굽는다.' }] },
    { label: 'reordered steps', steps: [...publicRecipe29.steps].reverse() },
    { label: 'changed order field', steps: publicRecipe29.steps.map((step, index) => index === 0 ? { ...step, order: 2 } : step) },
    { label: 'no steps', steps: [] },
    { label: 'missing steps', steps: null },
    { label: 'invalid step', steps: [null] }
  ])('requires a fresh source comparison for $label', ({ steps }) => {
    expect(getQuantityRecipeForPublicRecipe({ ...publicRecipe29, steps })).toBeNull();
  });

  it.each([{ recipe: null }, { recipe: undefined }, { recipe: {} }, { recipe: [] }, { recipe: '29' }])('does not create a recipe from an absent or malformed source record (%j)', ({ recipe }) => {
    expect(getQuantityRecipeForPublicRecipe(recipe)).toBeNull();
  });

  it('does not treat an unreviewed public recipe as a source-reviewed quantity recipe', () => {
    expect(getQuantityRecipeForPublicRecipe(publicRecipes.find((recipe) => recipe.externalId === '32'))).toBeNull();
  });

  it('exposes the cooking source snapshot used for the comparison', () => {
    const recipe = getQuantityRecipeForPublicRecipe(publicRecipe29);
    expect(recipe.sourceSnapshot).toMatchObject({
      externalId: '29', name: '부추 콩가루 찜',
      ingredientsText: '[1인분]조선부추 50g, 날콩가루 7g(1⅓작은술)\n·양념장 : 저염간장 3g(2/3작은술), 다진 대파 5g(1작은술), 다진 마늘 2g(1/2쪽), 고춧가루 2g(1/3작은술), 요리당 2g(1/3작은술), 참기름 2g(1/3작은술), 참깨 약간',
      steps: [
        { order: 1, text: '1. 부추는 깨끗이 씻어 물기를 제거하고, 5cm 길이로 썰고 부추에 날콩가루를 넣고 고루 섞이도록 버무린다.' },
        { order: 2, text: '2. 찜기에 면보를 깔고 부추를 넣은 후 김이 오르게 쪄서 파랗게 익힌다.' },
        { order: 3, text: '3. 저염간장에 다진 대파, 다진 마늘, 고춧가루, 요리당 , 참기름, 참깨를 섞어 양념장을 만들고 찐 부추는 그릇에 담아낸다.' }
      ]
    });
  });

  it('does not import unrelated nutrition or image changes into the canonical quantity record', () => {
    const source = structuredClone(publicRecipe29);
    source.nutrition.calories = 999;
    source.imageSmallUrl = 'https://example.invalid/new-photo.png';
    source.steps[0].imageUrl = 'https://example.invalid/new-step-photo.png';
    const recipe = getQuantityRecipeForPublicRecipe(source);
    expect(recipe).not.toBeNull();
    expect(recipe).not.toHaveProperty('nutrition');
    expect(recipe).not.toHaveProperty('imageSmallUrl');
  });

  it('does not modify the public source while returning reviewed quantities', () => {
    const source = structuredClone(publicRecipe29);
    const before = structuredClone(source);
    source.steps.forEach(Object.freeze);
    Object.freeze(source.steps);
    Object.freeze(source);
    expect(getQuantityRecipeForPublicRecipe(source)).not.toBeNull();
    expect(source).toEqual(before);
  });

  it('isolates later lookups from mutations to an earlier result and its audit data', () => {
    const first = getQuantityRecipeForPublicRecipe(publicRecipe29);
    first.ingredients[0].amount = 1;
    first.review.humanReviewed = true;
    const second = getQuantityRecipeForPublicRecipe(publicRecipe29);
    expect(second.ingredients[0].amount).toBe(50);
    expect(second.review.humanReviewed).toBe(false);
    first.sourceSnapshot.steps[0].text = '잘못된 단계';
    expect(getQuantityRecipeForPublicRecipe(publicRecipe29).sourceSnapshot.steps[0].text).toBe('1. 부추는 깨끗이 씻어 물기를 제거하고, 5cm 길이로 썰고 부추에 날콩가루를 넣고 고루 섞이도록 버무린다.');
  });

  it.each([
    {
      id: '31', name: '방울토마토 소박이', pdfPage: 46, printedPages: '90–91',
      rows: [
        ['방울토마토', '방울토마토 150g(5개)', 'cherry-tomato', 'raw', 'core', 150, 'g'],
        ['양파', '양파 10g(3×1cm)', 'onion', 'raw', 'core', 10, 'g'],
        ['부추', '부추 10g(5줄기)', 'chives', 'raw', 'core', 10, 'g'],
        ['고춧가루', '고춧가루 4g(1작은술)', 'red-pepper-powder', 'ground', 'seasoning', 4, 'g'],
        ['멸치액젓', '멸치액젓 3g(2/3작은술)', 'anchovy-fish-sauce', 'liquid', 'seasoning', 3, 'g'],
        ['다진 마늘', '다진 마늘 2.5g(1/2쪽)', 'garlic', 'minced', 'seasoning', 2.5, 'g'],
        ['매실액', '매실액 2g(1/3작은술)', 'plum-extract', 'liquid', 'seasoning', 2, 'g'],
        ['설탕', '설탕 2g(1/3작은술)', 'sugar', 'as-supplied', 'seasoning', 2, 'g'],
        ['물', '물 2ml(1/3작은술)', 'water', 'liquid', 'seasoning', 2, 'ml'],
        ['통깨', '통깨 약간', 'whole-sesame-seeds', null, 'seasoning', null, null]
      ]
    },
    {
      id: '95', name: '치커리샐러드와 올리브 마늘 소스', pdfPage: 113, printedPages: '224–225',
      rows: [
        ['치커리', '치커리 30g(10줄기)', 'chicory', 'raw', 'core', 30, 'g'],
        ['적양배추', '적양배추 15g(5×3cm)', 'red-cabbage', 'raw', 'core', 15, 'g'],
        ['양파', '양파 10g(2×1cm)', 'onion', 'raw', 'core', 10, 'g'],
        ['당근', '당근 5g(3×1×1cm)', 'carrot', 'raw', 'core', 5, 'g'],
        ['올리브유', '올리브유 10g(2작은술)', 'olive-oil', 'liquid', 'seasoning', 10, 'g'],
        ['식초', '식초 5g(1작은술)', 'vinegar', 'liquid', 'seasoning', 5, 'g'],
        ['설탕', '설탕 5g(1작은술)', 'sugar', 'as-supplied', 'seasoning', 5, 'g'],
        ['마늘', '마늘 5g(1쪽)', 'garlic', 'raw', 'seasoning', 5, 'g']
      ]
    }
  ])('preserves source quantities and the one-serving evidence for ID $id', ({ id, name, pdfPage, printedPages, rows }) => {
    const source = publicRecipes.find((recipe) => recipe.externalId === id);
    const recipe = getQuantityRecipeForPublicRecipe(source);
    expect(recipe).not.toBeNull();
    expect(validateQuantityRecipe(recipe)).toEqual({ status: 'eligible', issues: [] });
    expect(recipe).toMatchObject({
      id: `mfds:${id}`, name, version: '2026-09-15.1',
      source: { kind: 'mfds-cookrcp01', id, name: '식품의약품안전처 조리식품의 레시피 DB' },
      servings: 1, servingsStatus: 'verified',
      review: {
        method: 'ai-source-comparison', reviewedAt: '2026-09-15', humanReviewed: false,
        cookingValidated: false, nutritionExpertReviewed: false,
        weightBasis: 'purchase-vs-trimmed-unspecified',
        references: [{ pdfPage, printedPages }]
      },
      sourceSnapshot: { externalId: id, servingWeight: null }
    });
    expect(recipe.ingredients.map((line) => [
      line.rawName, line.rawText, line.foodId, line.preparationState, line.role, line.amount, line.unit
    ])).toEqual(rows);
    expect(recipe.ingredients.every((line) => line.required && line.selected)).toBe(true);
    expect(recipe.ingredients.filter((line) => line.role === 'core').every((line) => line.quantityStatus === 'verified' && line.unit === 'g')).toBe(true);
    expect(recipe.ingredients.filter((line) => line.amount === null).every((line) => line.quantityStatus === 'unknown' && line.unit === null)).toBe(true);
    expect(recipe.servingsEvidence).toContain(`PDF ${pdfPage}`);
    expect(recipe.servingsEvidence).toContain('재료준비(1인분)');
    expect(recipe.sourceSnapshot.ingredientsText).toBe(source.ingredientsText);
    expect(recipe.sourceSnapshot.steps).toEqual(source.steps.map(({ order, text }) => ({ order, text })));
    expect(recipe.sourceNotes.join(' ')).toContain('수율');
    expect(recipe).not.toHaveProperty('nutrition');
    expect(recipe).not.toHaveProperty('imageSmallUrl');
  });

  it('exposes only the three source-compared records from the public catalog', () => {
    expect(publicRecipes.map(getQuantityRecipeForPublicRecipe).filter(Boolean).map((recipe) => recipe.id)).toEqual([
      'mfds:29', 'mfds:31', 'mfds:95'
    ]);
  });

  it.each(['31', '95'])('fails closed after cooking-source changes to ID %s', (id) => {
    const source = publicRecipes.find((recipe) => recipe.externalId === id);
    expect(getQuantityRecipeForPublicRecipe(source)).not.toBeNull();
    for (const changes of [
      { externalId: '29' }, { name: `${source.name} 변형` }, { source: '다른 출처' },
      { sourceUrl: 'https://example.invalid/copied' }, { servingWeight: 200 },
      { cookingMethod: '굽기' }, { dishType: '밥' },
      { ingredientsText: source.ingredientsText.replace('g(', 'ml(') },
      { steps: source.steps.map((step, index) => index === 0 ? { ...step, text: `${step.text} 새 재료 추가` } : step) },
      { steps: [...source.steps].reverse() }, { steps: [] }
    ]) {
      expect(getQuantityRecipeForPublicRecipe({ ...source, ...changes })).toBeNull();
    }
  });

  it.each(['31', '95'])('isolates ID %s quantities and evidence from caller mutations', (id) => {
    const source = publicRecipes.find((recipe) => recipe.externalId === id);
    const before = structuredClone(source);
    const first = getQuantityRecipeForPublicRecipe(source);
    expect(first).not.toBeNull();
    const originalAmount = first.ingredients[0].amount;
    first.ingredients[0].amount = 0;
    first.sourceSnapshot.ingredientsText = '변경된 재료';
    first.sourceSnapshot.steps[0].text = '변경된 단계';
    first.review.references[0].pdfPage = 1;
    const next = getQuantityRecipeForPublicRecipe(source);
    expect(next.ingredients[0].amount).toBe(originalAmount);
    expect(next.sourceSnapshot.ingredientsText).toBe(before.ingredientsText);
    expect(next.sourceSnapshot.steps[0].text).toBe(before.steps[0].text);
    expect(next.review.references[0].pdfPage).toBe(id === '31' ? 46 : 113);
    expect(source).toEqual(before);
  });
});
