import FDBFactory from 'fake-indexeddb/lib/FDBFactory';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const NOW = '2026-09-16T03:00:00.000Z';
const WEEK = '2026-09-21';
const rice = { id: 'rice', name: '밥', quantity: '작은 통', expiryDate: WEEK, consumed: false, memo: '내 수량 메모 보존' };
const namedIngredients = ['밥', '시금치', '마', '두유', '소금', '버터', '후춧가루'].map((name) => ({ name }));

describe('reviewed dinner persisted planning flow', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(NOW));
    Object.defineProperty(window, 'indexedDB', { configurable: true, value: new FDBFactory() });
  });
  afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

  it.each([
    ['vegetable-jajang-noodles', '중화면', 400, 4, 15],
    ['soy-drink-pasta', '페투치네', 240, 1, 21],
    ['potato-rice', '쌀', 400, 3, 25],
    ['doenjang-bibimbap', '현미', 120, 3, 28],
  ])('persists original rows, multiple process gaps and read-only stock allocation for %s', async (key, name, neededAmount, gaps, page) => {
    const { getReviewedDinnerCatalog } = await import('../reviewedDinnerCatalog');
    const { generateMealPlan } = await import('../mealPlanDomain');
    const { saveIngredient, getAllIngredients } = await import('../../../db/indexedDB');
    const { getInventoryQuantitySnapshot, saveInventoryQuantity } = await import('../inventoryQuantityRepository');
    const { saveMealPlan, confirmMealPlan, getMealPlanningSnapshot } = await import('../mealPlanRepository');
    const { allocateMealPlanInventory } = await import('../mealPlanAllocation');
    const template = getReviewedDinnerCatalog().templates.find((item) => item.key === `mfds-dinner:book2-${key}`);
    const originalStock = { ...rice, name };
    await saveIngredient(originalStock);
    const stock = (await getInventoryQuantitySnapshot('guest')).inventory[0];
    await saveInventoryQuantity({ scope: 'guest', ingredientId: stock.id,
      expectedSourceToken: stock.sourceToken, expectedRevision: stock.quantityRevision,
      values: { name, amount: 100, unit: 'g', preparationState: 'as-sold' } });
    const quantityBefore = await getInventoryQuantitySnapshot('guest');
    const plan = generateMealPlan({ weekStart: WEEK, scope: 'guest', now: NOW,
      preferences: { servings: 2, dinnerDays: [0], excludedIngredients: [] },
      ingredients: template.components[0].ingredients.map((line) => ({ name: line.rawName, expiryDate: WEEK })),
    });
    expect(plan.slots[0].templateKey).toBe(template.key);
    const saved = await saveMealPlan(plan, 'guest', 0);
    await confirmMealPlan(WEEK, 'guest', saved.revision);
    const snapshot = await getMealPlanningSnapshot('guest');
    const component = snapshot.confirmedPlans[0].slots[0].components[0];
    expect(component).toEqual(template.components[0]);
    expect(component.source.book.pdfPage).toBe(page);
    const result = allocateMealPlanInventory({ ...snapshot, today: WEEK });
    expect(result.shopping.shortages.find((item) => item.ingredientKey === `food:${name}`)).toMatchObject({ amount: neededAmount - 100, unit: 'g' });
    expect(result.shopping.needsReview).toHaveLength(gaps);
    expect(result.status).toBe('needs-review');
    expect(await getAllIngredients('guest')).toEqual([originalStock]);
    expect(await getInventoryQuantitySnapshot('guest')).toEqual(quantityBefore);
  });

  it('saves original source rows and replay input, then allocates a confirmed two-person meal without consuming stock', async () => {
    const { generateMealPlan } = await import('../mealPlanDomain');
    const { saveIngredient, getAllIngredients } = await import('../../../db/indexedDB');
    const { getInventoryQuantitySnapshot, saveInventoryQuantity } = await import('../inventoryQuantityRepository');
    const { saveMealPlan, confirmMealPlan, getMealPlan, getMealPlanningSnapshot } = await import('../mealPlanRepository');
    const { allocateMealPlanInventory } = await import('../mealPlanAllocation');

    await saveIngredient(rice);
    const raw = await getInventoryQuantitySnapshot('guest');
    const stock = raw.inventory[0];
    await saveInventoryQuantity({ scope: 'guest', ingredientId: stock.id,
      expectedSourceToken: stock.sourceToken, expectedRevision: stock.quantityRevision,
      values: { name: '밥', amount: 300, unit: 'g', preparationState: 'cooked' } });
    const confirmedQuantity = await getInventoryQuantitySnapshot('guest');
    // Names influence candidate ranking; only persisted, explicitly confirmed
    // inventory above can supply quantities in the separate allocation step.
    const plan = generateMealPlan({ weekStart: WEEK, scope: 'guest', now: NOW,
      preferences: { servings: 2, dinnerDays: [0], excludedIngredients: [] }, ingredients: namedIngredients });
    expect(plan.slots[0].templateKey).toBe('mfds-dinner:book2-spinach-risotto');
    const saved = await saveMealPlan(plan, 'guest', 0);
    expect((await getMealPlanningSnapshot('guest')).confirmedPlans).toEqual([]);
    await confirmMealPlan(WEEK, 'guest', saved.revision);
    const reloaded = await getMealPlan(WEEK, 'guest');
    expect(reloaded.draft).toBeNull();
    expect(reloaded.confirmed.slots[0].components).toEqual(plan.slots[0].components);
    expect(reloaded.confirmed.slots[0].components[0].ingredients[0].amount).toBe(180);
    expect(reloaded.confirmed.generationInput).toEqual(plan.generationInput);
    expect(generateMealPlan(reloaded.confirmed.generationInput)).toEqual(plan);

    const snapshot = await getMealPlanningSnapshot('guest');
    const result = allocateMealPlanInventory({ ...snapshot, today: WEEK });
    expect(result.shopping.shortages.find((item) => item.ingredientKey === 'food:밥')).toMatchObject({ amount: 60, unit: 'g' });
    expect(result.status).toBe('needs-review');
    expect(result.shopping.needsReview).toEqual([expect.objectContaining({ label: '시금치 데치는 물', reason: 'process-quantity-unverified' })]);
    expect(await getAllIngredients('guest')).toEqual([rice]);
    expect(await getInventoryQuantitySnapshot('guest')).toEqual(confirmedQuantity);
    expect((await getMealPlanningSnapshot('user:alice')).confirmedPlans).toEqual([]);
  });

  it('keeps unconfirmed quantity notes unknown after a source-reviewed meal is confirmed', async () => {
    const { generateMealPlan } = await import('../mealPlanDomain');
    const { saveIngredient } = await import('../../../db/indexedDB');
    const { saveMealPlan, confirmMealPlan, getMealPlanningSnapshot } = await import('../mealPlanRepository');
    const { allocateMealPlanInventory } = await import('../mealPlanAllocation');
    await saveIngredient({ ...rice, quantity: '300g' });
    const plan = generateMealPlan({ weekStart: WEEK, now: NOW,
      preferences: { servings: 2, dinnerDays: [0], excludedIngredients: [] }, ingredients: namedIngredients });
    const saved = await saveMealPlan(plan, 'guest', 0);
    await confirmMealPlan(WEEK, 'guest', saved.revision);
    const result = allocateMealPlanInventory({ ...await getMealPlanningSnapshot('guest'), today: WEEK });
    const requirement = result.slots[0].requirements.find((item) => item.ingredientKey === 'food:밥');
    expect(requirement).toMatchObject({ requiredAmount: 360, allocatedAmount: 0, shortageAmount: null, status: 'needs-review' });
    expect(requirement.reasons).toContain('inventory-unverified');
  });

  it.each([
    ['missing process inputs', (component) => { delete component.processInputs; }],
    ['missing book evidence', (component) => { delete component.source.book; }],
    ['non-array process inputs', (component) => { component.processInputs = {}; }],
    ['a sparse process row', (component) => { component.processInputs = new Array(1); }],
    ['a null process row', (component) => { component.processInputs = [null]; }],
    ['a process identity object', (component) => { component.processInputs[0].ingredientKey = {}; }],
    ['a non-array method summary', (component) => { component.methodSummary = 'text'; }],
    ['an object method step', (component) => { component.methodSummary = [{}]; }],
    ['non-array printed pages', (component) => { component.source.book.printedPages = '50–51'; }],
    ['an object source note', (component) => { component.source.comparisonNote = {}; }],
    ['an object source review method', (component) => { component.source.reviewMethod = {}; }],
    ['an object original amount', (component) => { component.ingredients[0].rawAmount = {}; }],
    ['an object ingredient purpose', (component) => { component.ingredients[0].purpose = {}; }],
  ])('rejects a saved dinner with %s and leaves the stored evidence untouched', async (_label, corrupt) => {
    const { generateMealPlan } = await import('../mealPlanDomain');
    const { saveMealPlan, getMealPlan, getMealPlanningSnapshot } = await import('../mealPlanRepository');
    const { runMealPlanTransaction } = await import('../../../db/indexedDB');
    const plan = generateMealPlan({ weekStart: WEEK, now: NOW,
      preferences: { servings: 2, dinnerDays: [0], excludedIngredients: [] }, ingredients: namedIngredients });
    const saved = await saveMealPlan(plan, 'guest', 0);
    corrupt(saved.draft.slots[0].components[0]);
    // Inject a damaged stored record, not an application write that should reject it.
    await runMealPlanTransaction('readwrite', (store) => store.put(saved));
    await expect(getMealPlan(WEEK, 'guest')).rejects.toThrow('기존 자료는 지우지 않았습니다');
    await expect(getMealPlanningSnapshot('guest')).rejects.toThrow('식단 형식');
    expect(await runMealPlanTransaction('readonly', (store) => store.get(saved.id))).toEqual(saved);
  });
});
