import FDBFactory from 'fake-indexeddb/lib/FDBFactory';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const TODAY = '2026-09-21';
const NOW = '2026-09-16T03:00:00.000Z';
const WEEKS = ['2026-09-21', '2026-09-28', '2026-10-05', '2026-10-12', '2026-10-19', '2026-10-26'];

// Arithmetic fixtures only: these are not reviewed recipes or real inventory.
function line(id = 'g-raw', overrides = {}) {
  return {
    id, rawName: '경계 재료', normalizedName: '경계 재료', foodCode: null,
    ingredientKey: 'fixture:boundary', amount: 100, unit: 'g', preparationState: 'raw',
    quantityStatus: 'verified', quantityReason: '산술 fixture', quantityEvidence: 'fixture:100',
    selected: true, optional: false, foodGroups: [], ...overrides
  };
}

function plan(weekStart, lines = [line()], dinnerDays = [0]) {
  return {
    id: `week:${weekStart}`, schemaVersion: 1, scope: 'guest', weekStart, revision: 1,
    createdAt: NOW, updatedAt: NOW,
    preferences: { servings: 1, excludedIngredients: [], dinnerDays },
    slots: Array.from({ length: 7 }, (_, day) => {
      const date = new Date(`${weekStart}T12:00:00.000Z`);
      date.setUTCDate(date.getUTCDate() + day);
      const dateText = date.toISOString().slice(0, 10);
      const planned = dinnerDays.includes(day);
      return {
        id: `${dateText}:dinner`, date: dateText, mealType: 'dinner', locked: false, servings: 1,
        status: planned ? 'planned' : 'empty', templateKey: planned ? 'fixture:meal' : null,
        templateVersion: planned ? 1 : null, title: planned ? '산술 경계 메뉴' : '', reason: '', foodGroups: [],
        components: planned ? [{
          id: 'fixture:main', recipeKey: 'fixture:main', recipeVersion: 'fixture-v1', title: '산술 경계 메뉴', role: 'main',
          source: { kind: 'fixture', id: 'fixture:main', name: '산술 확인 자료' },
          sourceServings: 1, servings: 1, servingsStatus: 'verified', nutrition: null, nutritionStatus: 'unavailable',
          ingredients: structuredClone(lines)
        }] : []
      };
    })
  };
}

async function confirm(planToSave) {
  const repository = await import('../../mealPlans/mealPlanRepository');
  const saved = await repository.saveMealPlan(planToSave, 'guest', 0);
  await repository.confirmMealPlan(planToSave.weekStart, 'guest', saved.revision);
}

describe('shopping source display and identity boundaries', () => {
  beforeEach(() => {
    vi.resetModules();
    Object.defineProperty(window, 'indexedDB', { configurable: true, value: new FDBFactory() });
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(NOW));
  });
  afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

  it('reads 42 future dinners alongside a manual note without truncating their exact source references', async () => {
    const repository = await import('../shoppingRepository');
    const plans = WEEKS.map((week) => plan(week, [line()], [0, 1, 2, 3, 4, 5, 6]));
    for (const planned of plans) await confirm(planned);
    const manual = await repository.saveManualShoppingItem({
      scope: 'guest', id: 'manual:keep', expectedRevision: 0,
      values: { name: '우유', quantityText: '두 통', memo: '식단과 별개', checked: false }
    });
    const reading = repository.getShoppingWorkspace('guest', TODAY);
    await expect(reading).resolves.toMatchObject({ manualItems: [manual] });
    const workspace = await reading;
    const source = workspace.sources.find((entry) => entry.source === 'plan');
    expect(source.quantityText).toBe('4200g');
    expect(source.context.length).toBeLessThanOrEqual(400);
    expect(source.context).toContain('2026-09-21');
    expect(source.context).toContain('외 39회');
    expect(source).toMatchObject({ reference: { schemaVersion: 1, planVersions: expect.any(Array), slotIds: expect.any(Array) } });
    for (const planned of plans) {
      expect(source.reference.planVersions).toContainEqual([planned.weekStart, 1]);
      for (const slot of planned.slots) expect(source.reference.slotIds).toContain(slot.id);
    }
    const purchase = await repository.recordPurchaseNote({
      scope: 'guest', operationId: 'many-dates', source, actualQuantityText: '5kg 한 포장', memo: '재고 미반영'
    });
    expect(purchase.source).toEqual(source);
    expect((await repository.getShoppingWorkspace('guest', TODAY)).purchaseNotes).toEqual([purchase]);
  });

  it('reads and records 104 future weeks without a growing row id or lost plan and slot references', async () => {
    const repository = await import('../shoppingRepository');
    const plans = Array.from({ length: 104 }, (_, week) => {
      const start = new Date(`${TODAY}T12:00:00.000Z`);
      start.setUTCDate(start.getUTCDate() + week * 7);
      return plan(start.toISOString().slice(0, 10), [line()], [0, 1, 2, 3, 4, 5, 6]);
    });
    for (const planned of plans) await confirm(planned);
    await repository.saveManualShoppingItem({ scope: 'guest', id: 'manual:unrelated', expectedRevision: 0,
      values: { name: '우유', quantityText: '한 통', memo: '보존', checked: true } });
    const reading = repository.getShoppingWorkspace('guest', TODAY);
    await expect(reading).resolves.toMatchObject({ manualItems: [expect.objectContaining({ name: '우유', checked: true })] });
    const workspace = await reading;
    const source = workspace.sources.find((entry) => entry.source === 'plan');
    expect(source.quantityText).toBe('72800g');
    expect(source.sourceId.length).toBeLessThan(200);
    expect(source.reference.planVersions).toHaveLength(104);
    expect(source.reference.slotIds).toHaveLength(728);
    for (const planned of plans) {
      expect(source.reference.planVersions).toContainEqual([planned.weekStart, 1]);
      for (const slot of planned.slots) expect(source.reference.slotIds).toContain(slot.id);
    }
    const input = { scope: 'guest', operationId: 'long-history', source, actualQuantityText: '80kg', memo: '산술 fixture' };
    const first = await repository.recordPurchaseNote(input);
    expect(first.source).toEqual(source);
    const reread = await repository.getShoppingWorkspace('guest', TODAY);
    expect(reread.purchaseNotes).toEqual([first]);
    expect(reread.sources.find((entry) => entry.source === 'plan')).toEqual(source);
    expect(await repository.recordPurchaseNote(input)).toEqual(first);
  });

  it('retains the old purchase version when the same shopping row is recalculated for a changed dinner', async () => {
    const repository = await import('../shoppingRepository');
    const mealRepository = await import('../../mealPlans/mealPlanRepository');
    await confirm(plan(TODAY));
    const source = (await repository.getShoppingWorkspace('guest', TODAY)).sources[0];
    const input = { scope: 'guest', operationId: 'before-edit', source, actualQuantityText: '500g', memo: '' };
    const bought = await repository.recordPurchaseNote(input);
    const current = await mealRepository.getMealPlan(TODAY);
    const draft = await mealRepository.saveMealPlan(plan(TODAY, [line('g-raw', { amount: 200 })]), 'guest', current.revision);
    await mealRepository.confirmMealPlan(TODAY, 'guest', draft.revision);
    const after = await repository.getShoppingWorkspace('guest', TODAY);
    expect(after.sources[0].sourceId).toBe(source.sourceId);
    expect(after.sources[0]).toMatchObject({ quantityText: '200g', reference: { planVersions: [[TODAY, 3]] } });
    expect(after.purchaseNotes).toEqual([bought]);
    expect(bought.source).toMatchObject({ quantityText: '100g', reference: { planVersions: [[TODAY, 1]], slotIds: [`${TODAY}:dinner`] } });
    await expect(repository.recordPurchaseNote({ ...input, source: after.sources[0] })).rejects.toThrow();
    expect(await repository.recordPurchaseNote(input)).toEqual(bought);
  });

  it('copies nested references before a caller can mutate an in-flight purchase request', async () => {
    const repository = await import('../shoppingRepository');
    await confirm(plan(TODAY));
    const source = (await repository.getShoppingWorkspace('guest', TODAY)).sources[0];
    expect(source).toMatchObject({ reference: { planVersions: [[TODAY, 1]], slotIds: [`${TODAY}:dinner`] } });
    const pending = repository.recordPurchaseNote({ scope: 'guest', operationId: 'copied', source, actualQuantityText: '500g', memo: '' });
    source.reference.planVersions[0][1] = 999;
    source.reference.slotIds.length = 0;
    expect((await pending).source.reference).toEqual({ schemaVersion: 1, planVersions: [[TODAY, 1]], slotIds: [`${TODAY}:dinner`] });
  });

  it.each([
    ['missing', undefined], ['unknown version', { schemaVersion: 99, planVersions: [[TODAY, 1]], slotIds: [`${TODAY}:dinner`] }],
    ['bad revision', { schemaVersion: 1, planVersions: [[TODAY, -1]], slotIds: [`${TODAY}:dinner`] }],
    ['duplicate week', { schemaVersion: 1, planVersions: [[TODAY, 1], [TODAY, 2]], slotIds: [`${TODAY}:dinner`] }],
    ['impossible date', { schemaVersion: 1, planVersions: [['2026-02-30', 1]], slotIds: ['2026-02-30:dinner'] }],
    ['unrelated slot', { schemaVersion: 1, planVersions: [[TODAY, 1]], slotIds: ['2026-10-01:dinner'] }],
    ['empty slots', { schemaVersion: 1, planVersions: [[TODAY, 1]], slotIds: [] }],
  ])('rejects a %s versioned reference without silently stripping it from the purchase', async (_label, reference) => {
    const repository = await import('../shoppingRepository');
    const source = { source: 'plan', sourceId: 'plan:v2:["shortage","fixture:boundary","raw","g"]',
      name: '경계 재료', quantityText: '100g', context: '확정 식단', reference };
    await expect(repository.recordPurchaseNote({ scope: 'guest', operationId: 'invalid-reference', source,
      actualQuantityText: '500g', memo: '' })).rejects.toThrow();
    expect((await repository.getShoppingWorkspace('guest', TODAY)).purchaseNotes).toEqual([]);
  });

  it('reads and retries an existing legacy purchase without rewriting its original source representation', async () => {
    const repository = await import('../shoppingRepository');
    const db = await import('../../../db/indexedDB');
    const legacy = { schemaVersion: 1, kind: 'purchase-note', id: 'purchase:legacy', scope: 'guest', revision: 1,
      source: { source: 'plan', sourceId: 'plan:[[["2026-09-21",1]],"shortage",["fixture:boundary","raw","g",100,["2026-09-21:dinner"]]]',
        name: '경계 재료', quantityText: '100g', context: '확정 식단 부족분 · 2026-09-21' },
      actualQuantityText: '500g 한 팩', memo: '기존 기록', inventoryApplied: false, createdAt: NOW, updatedAt: NOW };
    await db.runShoppingTransaction('readwrite', (store) => store.put(legacy));
    expect((await repository.getShoppingWorkspace('guest', TODAY)).purchaseNotes).toEqual([legacy]);
    expect(await repository.recordPurchaseNote({ scope: 'guest', operationId: 'legacy', source: legacy.source,
      actualQuantityText: legacy.actualQuantityText, memo: legacy.memo })).toEqual(legacy);
    expect(await db.runShoppingTransaction('readonly', (store) => store.get(legacy.id))).toEqual(legacy);
  });

  it.each([
    ['different units', [line(), line('ml-raw', { unit: 'ml' })], ['단위 g', '단위 ml']],
    ['different preparation states', [line(), line('g-cooked', { preparationState: 'cooked' })], ['조리 전', '조리 후']]
  ])('keeps review source ids and visible context distinct for %s of one ingredient', async (_label, lines, labels) => {
    const repository = await import('../shoppingRepository');
    const db = await import('../../../db/indexedDB');
    await confirm(plan(TODAY, lines));
    await db.saveIngredient({ id: 'unknown', name: '경계 재료', quantity: '양 미확인', consumed: false });
    const workspace = await repository.getShoppingWorkspace('guest', TODAY);
    const sources = workspace.sources.filter((entry) => entry.source === 'plan');
    expect(sources).toHaveLength(2);
    expect(new Set(sources.map((entry) => entry.sourceId)).size).toBe(2);
    expect(new Set(sources.map((entry) => entry.context)).size).toBe(2);
    for (const label of labels) expect(sources.some((entry) => entry.context.includes(label))).toBe(true);
    expect(sources.every((entry) => entry.quantityText === '양 확인 필요')).toBe(true);

    const { getMealPlanningSnapshot } = await import('../../mealPlans/mealPlanRepository');
    const { allocateMealPlanInventory } = await import('../../mealPlans/mealPlanAllocation');
    const result = allocateMealPlanInventory({ ...await getMealPlanningSnapshot('guest'), today: TODAY });
    expect(result.shopping.needsReview.map(({ unit, preparationState }) => ({ unit, preparationState })))
      .toEqual(lines.map(({ unit, preparationState }) => ({ unit, preparationState })));
  });
});
