import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getMealPlanCatalog } from '../mealPlanCatalog.js';
import {
  generateMealPlan,
  readjustRemainingMealPlan,
  replaceMealPlanSlot,
  setMealPlanSlotSkipped,
} from '../mealPlanDomain.js';

const WEEK = '2026-10-05';
const NOW = '2026-10-05T03:00:00.000Z';
const LATER = '2026-10-05T04:00:00.000Z';
const APPROVED_KEYS = [
  'mfds-dinner:book2-spinach-risotto',
  'mfds-dinner:book2-chilgok-pomegranate-noodles',
  'mfds-dinner:book2-vegetable-jajang-noodles',
  'mfds-dinner:book2-soy-drink-pasta',
  'mfds-dinner:book2-potato-rice',
  'mfds-dinner:book2-doenjang-bibimbap',
];
const BLOCK_REVIEWED = ['두유', '석류', '중화면', '쌀'];
const ingredients = ['파스타면', '토마토', '새우'].map(name => ({ id: name, name,
  expiryDate: WEEK, quantity: '조금', consumed: false }));
const preferences = { servings: 1, dinnerDays: [0, 1, 2, 3, 4, 5, 6], excludedIngredients: [] };

function generate(options = {}) {
  return generateMealPlan({ weekStart: WEEK, now: NOW, preferences, ingredients, ...options });
}

function legacyPlan(options = {}) {
  vi.stubEnv('VITE_LOCAL_PILOT_ENABLED', 'false');
  const plan = generate(options);
  vi.stubEnv('VITE_LOCAL_PILOT_ENABLED', 'true');
  return plan;
}

beforeEach(() => vi.stubEnv('VITE_LOCAL_PILOT_ENABLED', 'true'));
afterEach(() => vi.unstubAllEnvs());

describe('local pilot candidate selection through real meal plan operations', () => {
  it('keeps the full lookup catalog and normal-build editorial recommendation available', () => {
    vi.stubEnv('VITE_LOCAL_PILOT_ENABLED', 'false');
    expect(generate().slots[0].templateKey).toBe('local-meal:shrimp-tomato-pasta');
    vi.stubEnv('VITE_LOCAL_PILOT_ENABLED', 'true');
    expect(getMealPlanCatalog()).toHaveLength(22);
    expect(getMealPlanCatalog().some(template => template.key === 'local-meal:shrimp-tomato-pasta')).toBe(true);
  });

  it('uses only the six approved source-compared dinners for every newly generated pilot slot', () => {
    const plan = generate({ preferences: { ...preferences, servings: 2 } });
    expect(plan.slots).toHaveLength(7);
    for (const slot of plan.slots) {
      expect(slot.status).toBe('planned');
      expect(APPROVED_KEYS).toContain(slot.templateKey);
      expect(slot.servings).toBe(2);
      expect(slot.components[0].servings).toBe(1);
      expect(slot.components[0].processInputs.length).toBeGreaterThan(0);
      expect(slot.components[0].processInputs.every(line => line.amount === null && line.unit === null)).toBe(true);
    }
  });

  it('replaces only the selected legacy slot with an approved pilot candidate without altering stock', () => {
    const plan = legacyPlan();
    const before = structuredClone(plan);
    const stockBefore = structuredClone(ingredients);
    const next = replaceMealPlanSlot(plan, plan.slots[0].id, { ingredients, now: LATER });
    expect(APPROVED_KEYS).toContain(next.slots[0].templateKey);
    expect(next.slots.slice(1)).toStrictEqual(before.slots.slice(1));
    expect(plan).toStrictEqual(before);
    expect(ingredients).toStrictEqual(stockBefore);
  });

  it('does not revive an editorial snapshot as a new pilot dinner when unskipping it', () => {
    const original = legacyPlan();
    const skipped = setMealPlanSlotSkipped(original, original.slots[0].id, true, { now: LATER });
    const before = structuredClone(skipped);
    const restored = setMealPlanSlotSkipped(skipped, skipped.slots[0].id, false, { ingredients, now: LATER });
    expect(restored.slots[0].status).toBe('planned');
    expect(APPROVED_KEYS).toContain(restored.slots[0].templateKey);
    expect(restored.slots.slice(1)).toStrictEqual(skipped.slots.slice(1));
    expect(skipped).toStrictEqual(before);
  });

  it('preserves the skipped source snapshot and selected days when no approved restoration is possible', () => {
    const original = legacyPlan({ preferences: { ...preferences, excludedIngredients: BLOCK_REVIEWED } });
    const skipped = setMealPlanSlotSkipped(original, original.slots[0].id, true, { now: LATER });
    const before = structuredClone(skipped);
    const result = setMealPlanSlotSkipped(skipped, skipped.slots[0].id, false, { now: LATER });
    expect(result.slots[0]).toMatchObject({ status: 'skipped', templateKey: before.slots[0].templateKey,
      components: before.slots[0].components, title: before.slots[0].title });
    expect(result.slots[0].notice).toMatch(/메뉴가 없/);
    expect(result.preferences.dinnerDays).toEqual(before.preferences.dinnerDays);
    expect(skipped).toStrictEqual(before);
  });

  it('records the pilot selection policy for explicit generation replay outside the pilot build', () => {
    const plan = generate();
    vi.stubEnv('VITE_LOCAL_PILOT_ENABLED', 'false');
    const replay = generateMealPlan(plan.generationInput);
    expect(replay).toStrictEqual(plan);
    expect(replay.slots.every(slot => APPROVED_KEYS.includes(slot.templateKey))).toBe(true);
    expect(generate().slots[0].templateKey).toBe('local-meal:shrimp-tomato-pasta');
  });

  it('does not inherit an old pilot plan policy when ordinary generation selects new meals', () => {
    const plan = generate();
    vi.stubEnv('VITE_LOCAL_PILOT_ENABLED', 'false');
    expect(generate({ previousPlan: plan }).slots[0].templateKey).toBe('local-meal:shrimp-tomato-pasta');
  });

  it('cannot bypass a pilot build with a null replay policy', () => {
    expect(generate({ candidatePolicy: null }).slots.every(slot => APPROVED_KEYS.includes(slot.templateKey))).toBe(true);
  });

  it('replays a pilot readjustment with the same policy after the build flag changes', () => {
    const original = legacyPlan();
    const result = readjustRemainingMealPlan(original, { today: WEEK, ingredients, now: LATER });
    vi.stubEnv('VITE_LOCAL_PILOT_ENABLED', 'false');
    const replay = readjustRemainingMealPlan(result.plan.generationInput.previousPlan, result.plan.generationInput);
    expect(replay.plan).toStrictEqual(result.plan);
    expect(replay.changes).toStrictEqual(result.changes);
  });

  it('does not restore a reviewed key whose stored required quantity no longer matches its source', () => {
    const stock = ['밥', '시금치', '마', '두유', '소금', '버터', '후춧가루']
      .map(name => ({ name, expiryDate: WEEK, consumed: false }));
    const original = legacyPlan({ ingredients: stock, preferences: { ...preferences, dinnerDays: [0] } });
    expect(original.slots[0].templateKey).toBe('mfds-dinner:book2-spinach-risotto');
    const skipped = setMealPlanSlotSkipped(original, original.slots[0].id, true, { now: LATER });
    skipped.slots[0].components[0].ingredients[0].amount = null;
    const before = structuredClone(skipped);
    const restored = setMealPlanSlotSkipped(skipped, skipped.slots[0].id, false, { ingredients: stock, now: LATER });
    expect(restored.slots[0].components[0].ingredients[0]).toMatchObject({ rawName: '밥', amount: 180, unit: 'g' });
    expect(skipped).toStrictEqual(before);
  });

  it('does not fall back to unrestricted candidates for an unknown replay policy', () => {
    expect(generate({ candidatePolicy: 'unrecognized-policy' }).slots.every(slot => slot.status === 'empty')).toBe(true);
  });

  it('preserves past, locked, cooked and skipped legacy meals during pilot readjustment', () => {
    const plan = legacyPlan();
    plan.slots[1].locked = true;
    plan.slots[2].status = 'cooked';
    plan.slots[2].cooking = { id: 'cooked:existing', recordedAt: NOW,
      inventoryStatus: 'needs-review', consumptionId: null, reversalId: null };
    plan.slots[3].status = 'skipped';
    plan.preferences.dinnerDays = [0, 1, 2, 4, 5, 6];
    const before = structuredClone(plan);
    const result = readjustRemainingMealPlan(plan, { today: '2026-10-06', ingredients, now: LATER });
    expect(result.plan.slots.slice(0, 4)).toStrictEqual(before.slots.slice(0, 4));
    expect(result.plan.slots.slice(4).map(slot => slot.templateKey).every(key => APPROVED_KEYS.includes(key))).toBe(true);
    expect(result.changes.every(change => change.date >= '2026-10-09')).toBe(true);
    expect(plan).toStrictEqual(before);
  });

  it('leaves slots empty when exclusions remove all six instead of backfilling editorial meals', () => {
    const plan = generate({ preferences: { ...preferences, excludedIngredients: BLOCK_REVIEWED } });
    expect(plan.slots.every(slot => slot.status === 'empty' && slot.templateKey === null)).toBe(true);
    expect(plan.slots[0].reason).toMatch(/메뉴가 없/);
  });

  it('preserves the existing plan when no approved readjustment or replacement survives exclusions', () => {
    const plan = legacyPlan({ preferences: { ...preferences, excludedIngredients: BLOCK_REVIEWED } });
    const before = structuredClone(plan);
    const result = readjustRemainingMealPlan(plan, { today: WEEK, now: LATER });
    expect(result.plan).toBe(plan);
    expect(result.changes).toEqual([]);
    expect(result.notices.join(' ')).toMatch(/메뉴가 없/);
    const replaced = replaceMealPlanSlot(plan, plan.slots[0].id, { ingredients, now: LATER });
    expect(replaced.slots[0].templateKey).toBe(plan.slots[0].templateKey);
    expect(replaced.slots[0].components).toStrictEqual(plan.slots[0].components);
    expect(plan).toStrictEqual(before);
  });

  it('explains both review criteria and exclusions when pilot selection has no candidate', () => {
    const original = legacyPlan({ preferences: { ...preferences, excludedIngredients: BLOCK_REVIEWED } });
    const skipped = setMealPlanSlotSkipped(original, original.slots[0].id, true, { now: LATER });
    const generated = generate({ preferences: { ...preferences, excludedIngredients: BLOCK_REVIEWED } });
    const replaced = replaceMealPlanSlot(original, original.slots[0].id, { now: LATER });
    const restored = setMealPlanSlotSkipped(skipped, skipped.slots[0].id, false, { now: LATER });
    const readjusted = readjustRemainingMealPlan(original, { today: WEEK, now: LATER });
    for (const notice of [generated.slots[0].reason, replaced.slots[0].notice, restored.slots[0].notice, ...readjusted.notices.slice(0, 1)]) {
      expect(notice).toMatch(/검수 기준/);
      expect(notice).toMatch(/제외 재료/);
    }
    vi.stubEnv('VITE_LOCAL_PILOT_ENABLED', 'false');
    const ordinary = generate({ preferences: { ...preferences, excludedIngredients: ['밥', '파스타면', '소면', '쌀', '중화면'] } });
    expect(ordinary.slots[0].reason).toMatch(/제외한 재료/);
    expect(ordinary.slots[0].reason).not.toMatch(/검수 기준/);
  });
});
