import FDBFactory from 'fake-indexeddb/lib/FDBFactory';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const WEEK = '2026-09-14';
const NOW = '2026-09-14T00:00:00.000Z';

function plan(scope = 'guest') {
  return {
    id: `week:${WEEK}`, schemaVersion: 1, scope, weekStart: WEEK,
    revision: 2, createdAt: NOW, updatedAt: NOW,
    preferences: { servings: 1, dinnerDays: [0, 1, 2, 3, 4, 5, 6], excludedIngredients: [] },
    slots: Array.from({ length: 7 }, (_, day) => {
      const date = `2026-09-${14 + day}`;
      return {
        id: `${date}:dinner`, date, mealType: 'dinner', status: 'planned', locked: false,
        servings: 1, templateKey: 'test:rice', templateVersion: 1, title: '밥', foodGroups: [],
        reason: '확인 전 제안', notice: null,
        components: [{ id: 'rice', recipeKey: 'test:rice', recipeVersion: '1', title: '밥', role: 'staple',
          source: { kind: 'test', id: 'rice', name: '테스트' },
          sourceServings: 1, servings: 1, servingsStatus: 'verified', nutrition: null, nutritionStatus: 'unverified',
          ingredients: [{ id: 'rice-line', rawName: '밥', normalizedName: '밥', foodCode: null,
            amount: 200, unit: 'g', preparationState: 'cooked', quantityStatus: 'verified', quantityReason: '확인',
            selected: true, optional: false, foodGroups: ['grains'] }] }],
      };
    }),
  };
}

function record(scope = 'guest') {
  return { id: `week:${WEEK}`, schemaVersion: 2, scope, weekStart: WEEK,
    revision: 2, createdAt: NOW, updatedAt: NOW,
    confirmed: plan(scope), draft: null, archives: [] };
}

async function seed(value) {
  const db = await import('../../../db/indexedDB.js');
  await db.runMealPlanTransaction('readwrite', store => store.put(value), value.scope);
  return db;
}

describe('overdue confirmed meals keep their demand until explicitly resolved', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 8, 16, 12));
    Object.defineProperty(window, 'indexedDB', { configurable: true, value: new FDBFactory() });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it.each([
    ['menu replacement', slot => { slot.title = '다른 메뉴'; }],
    ['serving change', slot => { slot.servings = 2; }],
    ['source quantity change', slot => { slot.components[0].ingredients[0].amount = 1; }],
    ['deselected ingredient', slot => { slot.components[0].ingredients[0].selected = false; }],
    ['removed demand', slot => { slot.status = 'empty'; slot.components = []; }],
    ['skip with changed recipe', slot => { slot.status = 'skipped'; slot.components = []; }],
  ])('rejects %s in ordinary draft saves and confirmations without losing data', async (_label, change) => {
    const value = record();
    const candidate = structuredClone(value.confirmed);
    change(candidate.slots[0]);
    await seed(value);
    const repository = await import('../mealPlanRepository.js');
    await expect(repository.saveMealPlan(candidate, 'guest', 2)).rejects.toThrow(/지난.*끼니/);
    expect(await repository.getMealPlan(WEEK)).toEqual(value);
    const stale = { ...value, draft: candidate };
    await seed(stale);
    await expect(repository.confirmMealPlan(WEEK, 'guest', 2)).rejects.toThrow(/지난.*끼니/);
    expect(await repository.getMealPlan(WEEK)).toEqual(stale);
  });

  it('keeps confirmed demand until an unchanged-menu skip draft is explicitly confirmed', async () => {
    const value = record();
    const db = await seed(value);
    await db.saveIngredient({ id: 'rice-stock', name: '밥', quantity: '300g' });
    const repository = await import('../mealPlanRepository.js');
    const beforeStock = await db.getAllIngredients();
    const candidate = structuredClone(value.confirmed);
    candidate.slots[0].status = 'skipped';
    candidate.slots[0].reason = '사용자가 건너뛰기 선택';
    candidate.preferences.dinnerDays = [1, 2, 3, 4, 5, 6];
    await repository.saveMealPlan(candidate, 'guest', 2);
    expect((await repository.getMealPlanningSnapshot()).confirmedPlans[0].slots[0].status).toBe('planned');
    const saved = await repository.confirmMealPlan(WEEK, 'guest', 3);
    expect(saved.confirmed.slots[0]).toEqual(candidate.slots[0]);
    expect(saved.archives).toEqual([value.confirmed]);
    expect(await db.getAllIngredients()).toEqual(beforeStock);
    expect(await db.runMealCookingTransaction('readonly', ({ events }) => events.getAll())).toEqual([]);
  });

  it('permits today and future edits and an overdue lock change without changing overdue demand', async () => {
    const value = record();
    await seed(value);
    const candidate = structuredClone(value.confirmed);
    candidate.slots[0].locked = true;
    candidate.slots[2].title = '오늘 편집';
    candidate.slots[4].servings = 2;
    const repository = await import('../mealPlanRepository.js');
    await repository.saveMealPlan(candidate, 'guest', 2);
    const saved = await repository.confirmMealPlan(WEEK, 'guest', 3);
    expect(saved.confirmed.slots).toEqual(candidate.slots);
  });

  it('saves and confirms a replayed explicit skip without losing optional source fields', async () => {
    const value = record();
    value.confirmed.slots[0].components[0].source.reviewMethod = undefined;
    const db = await seed(value);
    await db.saveIngredient({ id: 'replay-stock', name: '밥', quantity: '300g' });
    const stock = await db.getAllIngredients();
    const candidate = structuredClone(value.confirmed);
    candidate.slots[0].status = 'skipped';
    candidate.slots[0].reason = '직접 건너뛰기';
    const { generateMealPlan } = await import('../mealPlanDomain.js');
    const generated = generateMealPlan({
      weekStart: WEEK, scope: 'guest', now: new Date().toISOString(),
      previousPlan: candidate, confirmedPlan: value.confirmed,
      preferences: candidate.preferences, ingredients: [], pantryItems: [],
    });
    const replayed = generateMealPlan(generated.generationInput);
    const repository = await import('../mealPlanRepository.js');
    await expect(repository.saveMealPlan(replayed, 'guest', 2)).resolves.toMatchObject({ revision: 3 });
    expect((await repository.getMealPlan(WEEK)).confirmed).toStrictEqual(value.confirmed);
    const saved = await repository.confirmMealPlan(WEEK, 'guest', 3);
    expect(saved.confirmed.slots[0].status).toBe('skipped');
    expect(saved.confirmed.slots[0].components).toStrictEqual(value.confirmed.slots[0].components);
    expect(saved.archives).toStrictEqual([value.confirmed]);
    expect(await db.getAllIngredients()).toEqual(stock);
    expect(await db.runMealCookingTransaction('readonly', ({ events }) => events.getAll())).toEqual([]);
  });

  it('rechecks the local calendar at confirmation when an edited meal crosses midnight', async () => {
    vi.setSystemTime(new Date(2026, 8, 14, 23, 59));
    const value = record();
    await seed(value);
    const candidate = structuredClone(value.confirmed);
    candidate.slots[0].title = '오늘 작성한 교체 초안';
    const repository = await import('../mealPlanRepository.js');
    const saved = await repository.saveMealPlan(candidate, 'guest', 2);
    vi.setSystemTime(new Date(2026, 8, 15, 0, 1));
    await expect(repository.confirmMealPlan(WEEK, 'guest', 3)).rejects.toThrow(/지난.*끼니/);
    expect(await repository.getMealPlan(WEEK)).toEqual(saved);
  });

  it('identifies only conflicts with confirmed overdue demand, not skip drafts or future edits', async () => {
    const value = record();
    value.draft = structuredClone(value.confirmed);
    value.draft.slots[0].servings = 2;
    value.draft.slots[1].status = 'skipped';
    value.draft.slots[1].reason = '직접 건너뛰기';
    value.draft.slots[2].title = '오늘 편집';
    const repository = await import('../mealPlanRepository.js');
    expect(repository.getOverdueMealPlanDraftConflicts).toBeTypeOf('function');
    expect(repository.getOverdueMealPlanDraftConflicts(value, '2026-09-16').map(slot => slot.id))
      .toEqual(['2026-09-14:dinner']);
    expect(repository.getOverdueMealPlanDraftConflicts(null, '2026-09-16')).toEqual([]);
    expect(repository.getOverdueMealPlanDraftConflicts({ ...value, confirmed: null }, '2026-09-16')).toEqual([]);
    expect(() => repository.getOverdueMealPlanDraftConflicts(value, '2026-02-30')).toThrow();
  });

  it('explicitly restores only conflicting overdue draft slots, preserving future edits and skip choices', async () => {
    const value = record();
    value.draft = structuredClone(value.confirmed);
    value.draft.slots[0].components[0].ingredients[0].amount = 999;
    value.draft.slots[1].status = 'skipped';
    value.draft.slots[4].title = '금요일 초안 보존';
    value.draft.preferences.servings = 2;
    await seed(value);
    const repository = await import('../mealPlanRepository.js');
    expect(repository.restoreOverdueMealPlanDraft).toBeTypeOf('function');
    const restored = await repository.restoreOverdueMealPlanDraft(WEEK, 'guest', 2);
    expect(restored).toMatchObject({ revision: 3, confirmed: value.confirmed, archives: [] });
    expect(restored.draft.slots[0]).toEqual(value.confirmed.slots[0]);
    expect(restored.draft.slots.slice(1)).toEqual(value.draft.slots.slice(1));
    expect(restored.draft.preferences).toEqual(value.draft.preferences);
    expect(await repository.getMealPlan(WEEK)).toEqual(restored);
    const confirmed = await repository.confirmMealPlan(WEEK, 'guest', 3);
    expect(confirmed.confirmed.slots[0]).toEqual(value.confirmed.slots[0]);
    expect(confirmed.confirmed.slots[1].status).toBe('skipped');
    expect(confirmed.confirmed.slots[4].title).toBe('금요일 초안 보존');
  });

  it('does not let recovery modify another scope or overwrite a newer revision', async () => {
    const value = record('user:alice');
    value.draft = structuredClone(value.confirmed);
    value.draft.slots[0].title = '과거 변경';
    await seed(value);
    const guest = record();
    await seed(guest);
    const repository = await import('../mealPlanRepository.js');
    expect(repository.restoreOverdueMealPlanDraft).toBeTypeOf('function');
    await expect(repository.restoreOverdueMealPlanDraft(WEEK, 'user:alice', 1)).rejects.toThrow(/다른 화면/);
    await expect(repository.restoreOverdueMealPlanDraft(WEEK, 'user:a:b', 2)).rejects.toThrow(/계정/);
    await expect(repository.restoreOverdueMealPlanDraft(WEEK, 'guest', 2)).rejects.toThrow(/초안/);
    expect(await repository.getMealPlan(WEEK, 'user:alice')).toEqual(value);
    expect(await repository.getMealPlan(WEEK)).toEqual(guest);
    await repository.restoreOverdueMealPlanDraft(WEEK, 'user:alice', 2);
    expect(await repository.getMealPlan(WEEK)).toEqual(guest);
  });

  it('rolls back a failed recovery write and permits a safe retry without touching stock or events', async () => {
    const value = record();
    value.draft = structuredClone(value.confirmed);
    value.draft.slots[0].title = '과거 변경';
    const db = await seed(value);
    await db.saveIngredient({ id: 'keep-stock', name: '밥', quantity: '300g' });
    const stock = await db.getAllIngredients();
    let prototype;
    await db.runMealPlanTransaction('readonly', store => { prototype = Object.getPrototypeOf(store); return store.get(value.id); });
    const original = prototype.put;
    vi.spyOn(prototype, 'put').mockImplementationOnce(function (next) {
      const request = original.call(this, next);
      this.transaction.abort();
      return request;
    });
    const repository = await import('../mealPlanRepository.js');
    expect(repository.restoreOverdueMealPlanDraft).toBeTypeOf('function');
    await expect(repository.restoreOverdueMealPlanDraft(WEEK, 'guest', 2)).rejects.toThrow();
    expect(await repository.getMealPlan(WEEK)).toEqual(value);
    expect(await db.getAllIngredients()).toEqual(stock);
    expect(await db.runMealCookingTransaction('readonly', ({ events }) => events.getAll())).toEqual([]);
    const retried = await repository.restoreOverdueMealPlanDraft(WEEK, 'guest', 2);
    expect(retried.draft.slots[0]).toEqual(value.confirmed.slots[0]);
    expect(await db.getAllIngredients()).toEqual(stock);
  });
});
