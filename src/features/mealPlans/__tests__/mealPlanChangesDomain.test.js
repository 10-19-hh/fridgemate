import { describe, expect, it } from 'vitest';
import * as domain from '../mealPlanDomain.js';
import { allocateMealPlanInventory } from '../mealPlanAllocation.js';

const WEEK = '2026-09-21';
const NEXT = '2026-09-28';
const NOW = '2026-09-21T03:00:00.000Z';
const LATER = '2026-09-21T04:00:00.000Z';
const preferences = { servings: 1, excludedIngredients: [], dinnerDays: [0, 1, 2, 3, 4, 5, 6] };

function plan(options = {}) {
  return domain.generateMealPlan({ weekStart: WEEK, now: NOW, preferences, ...options });
}

function frozen(value) {
  Object.values(value).forEach(item => {
    if (item && typeof item === 'object') frozen(item);
  });
  return Object.freeze(value);
}

function move(sourcePlan, targetPlan = sourcePlan, overrides = {}) {
  expect(domain.moveMealPlanSlot, 'the date-move proposal API must exist').toBeTypeOf('function');
  return domain.moveMealPlanSlot({ sourcePlan, targetPlan, sourceSlotId: sourcePlan.slots[0].id,
    targetSlotId: targetPlan.slots[1].id, mode: 'swap', today: WEEK, now: LATER, ...overrides });
}

function readjust(value, options = {}) {
  expect(domain.readjustRemainingMealPlan, 'the remaining-meal proposal API must exist').toBeTypeOf('function');
  return domain.readjustRemainingMealPlan(value, { today: WEEK, now: LATER, ...options });
}

function cooked(slot) {
  return { ...slot, status: 'cooked', cooking: { id: 'cooking:first', recordedAt: NOW,
    inventoryStatus: 'needs-review', consumptionId: null, reversalId: null } };
}

// Arithmetic-only data, not a reviewed recipe or a claim of cooking suitability.
function chickenPlan() {
  const value = plan({ preferences: { ...preferences, dinnerDays: [0] } });
  value.slots[0].components = [{ id: 'fixture', recipeVersion: 'fixture-v1', source: { id: 'fixture' },
    servings: 1, servingsStatus: 'verified', ingredients: [{ id: 'chicken', rawName: '닭고기',
      ingredientKey: 'fixture:chicken', preparationState: 'raw', unit: 'g', amount: 200,
      quantityStatus: 'verified', quantityEvidence: 'arithmetic fixture', optional: false, selected: true }] }];
  return value;
}

describe('explicit meal date move proposals', () => {
  it('swaps only the two selected menus while keeping destination identities and all source rows', () => {
    const original = plan();
    original.slots[4].notice = undefined;
    frozen(original);
    const { plans, changes, notices } = move(original);
    expect(plans).toHaveLength(1);
    expect(plans[0].slots[0]).toMatchObject({ id: '2026-09-21:dinner', date: WEEK,
      templateKey: original.slots[1].templateKey, components: original.slots[1].components });
    expect(plans[0].slots[1]).toMatchObject({ id: '2026-09-22:dinner', date: '2026-09-22',
      templateKey: original.slots[0].templateKey, components: original.slots[0].components });
    expect(plans[0].slots.slice(2)).toStrictEqual(original.slots.slice(2));
    expect(plans[0]).toMatchObject({ revision: original.revision + 1, createdAt: NOW, updatedAt: LATER });
    expect(changes.map(change => change.date)).toEqual([WEEK, '2026-09-22']);
    expect(changes[0]).toMatchObject({ before: original.slots[0], after: plans[0].slots[0] });
    expect(notices.join(' ')).toMatch(/교환/);
  });

  it('moves to a skipped dinner only explicitly and releases the source demand without deleting its source snapshot', () => {
    const original = plan({ preferences: { ...preferences, dinnerDays: [0, 2] } });
    const before = structuredClone(original);
    const { plans, notices } = move(frozen(original), original, { mode: 'move' });
    expect(plans[0].slots[0]).toMatchObject({ status: 'skipped', components: before.slots[0].components,
      title: before.slots[0].title, templateKey: before.slots[0].templateKey });
    expect(plans[0].slots[1]).toMatchObject({ status: 'planned', components: before.slots[0].components });
    expect(plans[0].preferences.dinnerDays).toEqual([1, 2]);
    expect(plans[0].slots.slice(2)).toStrictEqual(before.slots.slice(2));
    expect(notices.join(' ')).toMatch(/건너뛰|외식/);
    expect(original).toStrictEqual(before);
  });

  it('moves to an empty selected slot and does not generate unrelated menus', () => {
    const original = plan();
    original.slots[1] = { ...original.slots[1], status: 'empty', templateKey: null, templateVersion: null,
      title: '', components: [], foodGroups: [] };
    const result = move(original, original, { mode: 'move' });
    expect(result.plans[0].slots[0].status).toBe('skipped');
    expect(result.plans[0].slots[1].title).toBe(original.slots[0].title);
    expect(result.plans[0].preferences.dinnerDays).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('moves across weeks without copying the source week identity or changing other dates', () => {
    const source = frozen(plan());
    const target = frozen(plan({ weekStart: NEXT, preferences: { ...preferences, dinnerDays: [] } }));
    const result = move(source, target, { targetSlotId: `${NEXT}:dinner`, mode: 'move' });
    expect(result.plans.map(item => item.weekStart)).toEqual([WEEK, NEXT]);
    expect(result.plans[0].slots[0].status).toBe('skipped');
    expect(result.plans[1].slots[0]).toMatchObject({ id: `${NEXT}:dinner`, date: NEXT,
      title: source.slots[0].title, components: source.slots[0].components });
    expect(result.plans[0].slots.slice(1)).toStrictEqual(source.slots.slice(1));
    expect(result.plans[1].slots.slice(1)).toStrictEqual(target.slots.slice(1));
    expect(result.plans[0].preferences.dinnerDays).toEqual([1, 2, 3, 4, 5, 6]);
    expect(result.plans[1].preferences.dinnerDays).toEqual([0]);
    expect(result.plans.every(item => item.revision === 2)).toBe(true);
  });

  it.each(['2026-09-22', NEXT])('resolves an overdue source by moving it to an explicitly free %s dinner', targetDate => {
    const source = chickenPlan();
    const target = targetDate === NEXT ? plan({ weekStart: NEXT, preferences: { ...preferences, dinnerDays: [] } }) : source;
    const result = move(frozen(source), frozen(target), { today: '2026-09-22', now: '2026-09-22T03:00:00.000Z', targetSlotId: `${targetDate}:dinner`, mode: 'move' });
    expect(result.plans[0].slots[0]).toMatchObject({ status: 'skipped', components: source.slots[0].components });
    const moved = result.plans.flatMap(value => value.slots).find(value => value.date === targetDate);
    expect(moved).toMatchObject({ status: 'planned', components: source.slots[0].components, servings: source.slots[0].servings });
    const allocation = allocateMealPlanInventory({ scope: 'guest', confirmedPlans: result.plans, inventory: [], today: '2026-09-22' });
    expect(allocation.slots).toEqual([expect.objectContaining({ date: targetDate, overdue: false })]);
    expect(allocation.shopping.needsReview.some(item => item.reason === 'overdue-meal-unconfirmed')).toBe(false);
  });

  it.each(['locked', 'cooked'])('does not release an overdue %s source through a move', protection => {
    const source = chickenPlan();
    if (protection === 'locked') source.slots[0].locked = true;
    else source.slots[0] = cooked(source.slots[0]);
    const before = structuredClone(source);
    expect(() => move(source, source, { today: '2026-09-22', mode: 'move' })).toThrow();
    expect(source).toStrictEqual(before);
  });

  it('swaps across weeks without losing either menu or changing the other selected dinner days', () => {
    const source = plan();
    const target = plan({ weekStart: NEXT });
    const result = move(source, target, { targetSlotId: `${NEXT}:dinner` });
    expect(result.plans[0].slots[0].components).toStrictEqual(target.slots[0].components);
    expect(result.plans[1].slots[0].components).toStrictEqual(source.slots[0].components);
    expect(result.plans.map(item => item.preferences.dinnerDays)).toEqual([preferences.dinnerDays, preferences.dinnerDays]);
  });

  it.each([
    ['implicit replacement', value => ({ sourcePlan: value, mode: 'move' })],
    ['implicit swap', value => ({ sourcePlan: value, mode: undefined })],
    ['unknown mode', value => ({ sourcePlan: value, mode: 'replace' })],
    ['swap into skipped', value => {
      value.slots[1].status = 'skipped'; return { sourcePlan: value };
    }],
    ['non-planned source', value => {
      value.slots[0].status = 'skipped'; return { sourcePlan: value };
    }],
    ['unknown source', value => ({ sourcePlan: value, sourceSlotId: 'missing' })],
    ['unknown target', value => ({ sourcePlan: value, targetSlotId: 'missing' })],
    ['invalid today', value => ({ sourcePlan: value, today: '2026-02-30' })],
    ['missing today', value => ({ sourcePlan: value, today: undefined })],
  ])('rejects %s instead of silently selecting a destructive interpretation', (_label, input) => {
    expect(domain.moveMealPlanSlot).toBeTypeOf('function');
    const value = plan();
    const options = input(value);
    expect(() => move(value, value, options)).toThrow();
  });

  it.each([0, 1])('keeps locked slot %s untouched', index => {
    const value = plan(); value.slots[index].locked = true;
    const before = structuredClone(value);
    expect(() => move(value)).toThrow(/고정/);
    expect(value).toStrictEqual(before);
  });

  it.each([0, 1])('keeps cooked slot %s and its event identity untouched', index => {
    const value = plan(); value.slots[index] = cooked(value.slots[index]);
    const before = structuredClone(value);
    expect(() => move(value)).toThrow(/조리/);
    expect(value).toStrictEqual(before);
  });

  it.each([
    { sourceSlotId: `${WEEK}:dinner`, targetSlotId: '2026-09-23:dinner' },
    { sourceSlotId: '2026-09-23:dinner', targetSlotId: `${WEEK}:dinner` },
  ])('rejects either a past source or a past destination: %j', options => {
    const value = plan();
    expect(() => move(value, value, { ...options, today: '2026-09-22' })).toThrow(/지난|과거/);
  });

  it('treats a same-date request as no change without increasing revision', () => {
    const value = plan();
    const result = move(value, value, { targetSlotId: value.slots[0].id });
    expect(result.plans).toEqual([value]);
    expect(result.plans[0]).toBe(value);
    expect(result.changes).toEqual([]);
  });

  it('rejects cross-account movement', () => {
    const value = plan();
    expect(() => move(value, plan({ weekStart: NEXT, scope: 'user:alice' }))).toThrow(/계정|범위/);
  });

  it('rejects different servings instead of silently rescaling or changing target preferences', () => {
    const value = plan();
    const target = plan({ weekStart: NEXT, preferences: { ...preferences, servings: 2 } });
    expect(() => move(value, target)).toThrow(/인분|인원/);
  });

  it('checks the moved source against the destination exclusions, including an optional source ingredient', () => {
    const source = plan();
    source.slots[0].components[0].ingredients.push({ ...source.slots[0].components[0].ingredients[0],
      id: 'optional-egg', rawName: '계란', normalizedName: '계란', optional: true, selected: false });
    const target = plan({ weekStart: NEXT, preferences: { ...preferences, excludedIngredients: ['달걀'] } });
    expect(() => move(source, target)).toThrow(/제외/);
  });

  it('checks the returning menu against source-week exclusions during a swap', () => {
    const source = plan();
    source.preferences.excludedIngredients = ['달걀'];
    const target = plan({ weekStart: NEXT });
    target.slots[1].components[0].ingredients.push({ ...target.slots[1].components[0].ingredients[0],
      id: 'egg', rawName: '계란', normalizedName: '계란' });
    expect(() => move(source, target)).toThrow(/제외/);
  });

  it('does not allocate expired stock after moving dinner later, and leaves the physical stock unchanged', () => {
    const value = chickenPlan();
    const stock = frozen([{ id: 'chicken', ingredientKey: 'fixture:chicken', preparationState: 'raw',
      amount: 300, unit: 'g', quantityStatus: 'verified', quantityEvidence: 'arithmetic fixture', expiryDate: WEEK }]);
    const before = allocateMealPlanInventory({ scope: 'guest', confirmedPlans: [value], inventory: stock, today: WEEK });
    const result = move(value, value, { mode: 'move' });
    const after = allocateMealPlanInventory({ scope: 'guest', confirmedPlans: result.plans, inventory: stock, today: WEEK });
    expect(before.slots[0].requirements[0].allocatedAmount).toBe(200);
    expect(after.slots[0].date).toBe('2026-09-22');
    expect(after.slots[0].requirements[0]).toMatchObject({ allocatedAmount: 0, shortageAmount: null, status: 'needs-review' });
    expect(after.shopping.needsReview).toMatchObject([{ reason: 'inventory-expired' }]);
    expect(stock[0].amount).toBe(300);
  });
});

describe('remaining-meal readjustment proposals', () => {
  it('proposes only future selected unlocked meals and exactly preserves past, locked, skipped and cooked snapshots', () => {
    const value = plan();
    value.slots[1].locked = true;
    value.slots[1].notice = undefined;
    value.slots[2] = cooked(value.slots[2]);
    value.slots[3].status = 'skipped';
    value.preferences.dinnerDays = [0, 1, 2, 4, 5, 6];
    value.slots[4].title = '이전 메뉴 스냅샷';
    const before = structuredClone(value);
    const result = readjust(frozen(value), { today: '2026-09-22' });
    expect(result.plan.slots.slice(0, 4)).toStrictEqual(before.slots.slice(0, 4));
    expect(result.changes.every(change => change.date >= '2026-09-25')).toBe(true);
    expect(result.changes.length).toBeGreaterThan(0);
    expect(result.plan.preferences).toStrictEqual(before.preferences);
    expect(result.plan).toMatchObject({ revision: before.revision + 1, createdAt: NOW, updatedAt: LATER });
    expect(value).toStrictEqual(before);
  });

  it('keeps every existing menu when exclusions leave no candidates, with an explicit explanation', () => {
    const value = plan();
    value.preferences.excludedIngredients = ['밥', '파스타면', '소면', '쌀', '중화면'];
    const result = readjust(frozen(value));
    expect(result.plan).toBe(value);
    expect(result.changes).toEqual([]);
    expect(result.notices.join(' ')).toMatch(/후보|메뉴가 없/);
  });

  it('does not revive skipped meals or fill dates not selected by the user', () => {
    const value = plan({ preferences: { ...preferences, dinnerDays: [0] } });
    const result = readjust(value);
    expect(result.plan.slots.slice(1)).toStrictEqual(value.slots.slice(1));
    expect(result.plan.preferences.dinnerDays).toEqual([0]);
  });

  it('fills a selected future empty slot only with a candidate that meets current exclusions', () => {
    const value = plan({ preferences: { ...preferences, excludedIngredients: ['달걀'] } });
    value.slots[0] = { ...value.slots[0], status: 'empty', components: [], templateKey: null,
      templateVersion: null, title: '', foodGroups: [] };
    const result = readjust(value);
    expect(result.plan.slots[0].status).toBe('planned');
    expect(result.plan.slots[0].components.flatMap(item => item.ingredients.map(line => line.rawName))).not.toContain('계란');
  });

  it('uses newly available named inventory without mutating inventory or other protected meals', () => {
    const value = plan({ preferences: { ...preferences, dinnerDays: [0] } });
    const ingredients = frozen(['파스타면', '토마토', '새우'].map(name => ({ id: name, name, expiryDate: WEEK, quantity: '조금' })));
    const result = readjust(value, { ingredients, pantryItems: ['소금'] });
    expect(result.plan.slots[0].templateKey).toBe('local-meal:shrimp-tomato-pasta');
    expect(result.plan.slots[0].reason).toMatch(/기한이 가까운/);
    expect(ingredients[0].quantity).toBe('조금');
    expect(result.plan.generationInput).toMatchObject({ operation: 'readjust-remaining', today: WEEK });
  });

  it('keeps a sole eligible unchanged menu and revision rather than claiming a new proposal', () => {
    const value = plan({ preferences: { ...preferences, dinnerDays: [0],
      excludedIngredients: ['밥', '토마토', '소면', '쌀', '중화면', '두유'] } });
    const result = readjust(value);
    expect(value.slots[0].templateKey).toBe('local-meal:broccoli-pasta');
    expect(result.plan).toBe(value);
    expect(result.changes).toEqual([]);
    expect(result.notices.join(' ')).toMatch(/변경|유지/);
  });

  it('does not revise an entirely past plan', () => {
    const value = plan();
    const result = readjust(value, { today: NEXT });
    expect(result.plan).toBe(value);
    expect(result.changes).toEqual([]);
  });

  it('reproduces the same proposal from the same immutable inputs', () => {
    const value = frozen(plan());
    expect(readjust(value)).toStrictEqual(readjust(value));
  });

  it('replays the exact full proposal from its saved input without retaining recursive generation history', () => {
    const value = plan();
    value.engineVersion = 'older-engine';
    value.catalogVersion = 'older-catalog';
    value.personalNote = { text: '다음 주에도 참고', optional: undefined };
    value.generationInput.previousPlan = { generationInput: { previousPlan: { marker: 'old private history' } } };
    const result = readjust(frozen(value));
    expect(result.changes.length).toBeGreaterThan(0);
    const input = result.plan.generationInput;
    expect(input.previousPlan).not.toHaveProperty('generationInput');
    const replay = domain.readjustRemainingMealPlan(input.previousPlan, {
      today: input.today, ingredients: input.ingredients, pantryItems: input.pantryItems, now: input.now,
    });
    expect(replay).toStrictEqual(result);
  });

  it('keeps the saved replay input and output source rows independent from the original plan', () => {
    const value = plan();
    value.personalNote = { text: '바꾸지 않을 메모' };
    const before = structuredClone(value);
    const result = readjust(value);
    expect(result.plan.generationInput.previousPlan.personalNote).toStrictEqual(before.personalNote);
    result.plan.generationInput.previousPlan.personalNote.text = '변경된 복사본';
    result.plan.generationInput.previousPlan.slots[0].components[0].ingredients[0].rawName = '다른 재료';
    result.plan.slots[0].components[0].ingredients[0].rawName = '다른 출력 재료';
    expect(value).toStrictEqual(before);
  });

  it.each([undefined, '2026-02-30', '2026-9-21'])('rejects ambiguous current day %s', today => {
    expect(domain.readjustRemainingMealPlan).toBeTypeOf('function');
    expect(() => readjust(plan(), { today })).toThrow();
  });
});

describe('explicit lock preservation for skipping', () => {
  it('requires a separate unlock before skipping a fixed meal', () => {
    const value = plan(); value.slots[0].locked = true;
    const result = domain.setMealPlanSlotSkipped(frozen(value), value.slots[0].id, true, { now: LATER });
    expect(result).toBe(value);
    expect(result.slots[0].status).toBe('planned');
    expect(result.preferences.dinnerDays).toContain(0);
  });
});
