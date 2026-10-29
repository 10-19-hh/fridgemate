import { describe, expect, it } from 'vitest';
import { seedRecipes } from '../../../data/seedRecipes.js';
import {
  addCalendarDays,
  generateMealPlan,
  getSlotSummary,
  getWeekStart,
  mealPlanCatalog,
  replaceMealPlanSlot,
  setMealPlanSlotSkipped,
  toggleMealPlanSlotLock,
} from '../mealPlanDomain.js';

const now = '2026-09-12T04:00:00.000Z';
const weekStart = '2026-09-14';
const preferences = { servings: 2, excludedIngredients: [], dinnerDays: [0, 1, 2, 3, 4, 5, 6] };

function generate(options = {}) {
  return generateMealPlan({ weekStart, preferences, now, ...options });
}

function slotFor(key, date = weekStart) {
  const template = mealPlanCatalog.find((item) => item.key === `local-meal:${key}`);
  return { ...structuredClone(template), templateKey: template.key, date, status: 'planned' };
}

function inventory(name, expiryDate = '2026-10-01', extra = {}) {
  return { id: name, name, expiryDate, quantity: '조금', consumed: false, ...extra };
}

describe('meal plan calendar dates', () => {
  it('uses the local calendar and a Monday week start', () => {
    expect(getWeekStart(new Date(2026, 8, 13, 23, 59))).toBe('2026-09-07');
    expect(getWeekStart('2026-09-14')).toBe('2026-09-14');
    expect(getWeekStart('2027-01-01')).toBe('2026-12-28');
  });

  it('adds calendar days across months, years and leap days', () => {
    expect(addCalendarDays('2024-02-28', 1)).toBe('2024-02-29');
    expect(addCalendarDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addCalendarDays('2026-03-09', -1)).toBe('2026-03-08');
  });

  it('rejects invalid dates instead of rolling them into another month', () => {
    expect(() => getWeekStart('2026-02-30')).toThrow(RangeError);
    expect(() => getWeekStart(new Date('invalid'))).toThrow(RangeError);
    expect(() => addCalendarDays('2026-09-14', 1.5)).toThrow(RangeError);
    expect(() => addCalendarDays('2026-02-29', 1)).toThrow(RangeError);
  });
});

describe('meal template source contract', () => {
  it('keeps 16 explicitly composed dinner suggestions with qualified, versioned sources', () => {
    expect(mealPlanCatalog).toHaveLength(16);
    expect(new Set(mealPlanCatalog.map((item) => item.key)).size).toBe(16);
    mealPlanCatalog.forEach((template) => {
      expect(template.key).toMatch(/^local-meal:/);
      expect(template.version).toBe(1);
      expect(template.foodGroups).toEqual(expect.arrayContaining([{ id: 'grains', label: '곡류' }]));
      expect(template.servings).toBeNull();
      expect(template.servingsStatus).toBe('unverified');
      expect(template.nutrition).toBeNull();
      template.components.forEach((component) => {
        expect(component.recipeKey).toMatch(/^(local|editorial):/);
        expect(component.recipeVersion).toBeTruthy();
        expect(component.source.name).toBeTruthy();
        expect(component.servings).toBeNull();
        component.ingredients.forEach((line) => {
          expect(line.rawName).toBeTruthy();
          expect(line.amount).toBeNull();
          expect(line.unit).toBeNull();
          expect(line.quantityReason).toBeTruthy();
        });
      });
    });
  });

  it('preserves the source portion label separately from an unverified plan portion', () => {
    const curry = mealPlanCatalog.find((item) => item.key === 'local-meal:chicken-curry');
    expect(curry.components[0].sourceServings).toBe(3);
    expect(curry.components[0].servings).toBeNull();
    expect(curry.components[0].servingsStatus).toBe('unverified');
  });

  it('does not count optional garnish as a selected food group', () => {
    const kimchiRice = slotFor('kimchi-rice');
    const optionalEgg = kimchiRice.components[0].ingredients.find((line) => line.rawName === '계란');
    expect(optionalEgg.selected).toBe(false);
    expect(getSlotSummary(kimchiRice).foodGroups.some((group) => group.id === 'proteinFoods')).toBe(false);

    const omelette = slotFor('vegetable-omelette-rice');
    expect(omelette.components[1].ingredients.find((line) => line.rawName === '당근').selected).toBe(true);
    expect(getSlotSummary(omelette).foodGroups.some((group) => group.id === 'vegetables')).toBe(true);
  });

  it('keeps same-named ingredient lines from different dishes instead of adding guessed amounts', () => {
    const dinner = slotFor('tofu-zucchini-rice');
    const lines = dinner.components.flatMap((component) => component.ingredients);
    const onionLines = lines.filter((line) => line.rawName === '양파');
    expect(onionLines).toHaveLength(2);
    expect(new Set(onionLines.map((line) => line.id)).size).toBe(2);
    expect(onionLines.every((line) => line.amount === null)).toBe(true);
  });
});

describe('weekly generation and snapshots', () => {
  it('preserves the complete overdue planned snapshot despite changed servings, exclusions and dinner days', () => {
    const first = generate();
    first.slots[0].notice = undefined;
    const before = structuredClone(first.slots[0]);
    const next = generate({ previousPlan: first, confirmedPlan: first, now: new Date(2026, 8, 15, 0, 1),
      preferences: { servings: 1, dinnerDays: [1], excludedIngredients: [first.slots[0].components[0].ingredients[0].rawName] } });
    expect(next.slots[0]).toStrictEqual(before);
    expect(next.slots[1].servings).toBe(1);
    next.slots[0].components[0].ingredients[0].rawName = '복사본 수정';
    expect(first.slots[0]).toStrictEqual(before);
  });

  it('uses the supplied local calendar day and still permits regeneration of today', () => {
    const first = generate();
    const next = generate({ previousPlan: first, now: new Date(2026, 8, 14, 23, 59),
      preferences: { ...preferences, servings: 1 } });
    expect(next.slots[0].servings).toBe(1);
  });

  it('replays the complete confirmed overdue snapshot including an explicitly undefined optional field', () => {
    const confirmed = generate();
    confirmed.slots[0].notice = undefined;
    const before = structuredClone(confirmed);
    const plan = generate({ confirmedPlan: confirmed, now: new Date(2026, 8, 15, 0, 1) });

    expect(plan.slots[0]).toStrictEqual(before.slots[0]);
    expect(generateMealPlan(plan.generationInput)).toStrictEqual(plan);
    plan.generationInput.confirmedPlan.slots[0].components[0].ingredients[0].rawName = '입력 복사본 수정';
    expect(confirmed).toStrictEqual(before);
    expect(plan.slots[0]).toStrictEqual(before.slots[0]);
  });

  it('continues editing an overdue unconfirmed draft because it never reserved inventory', () => {
    const draft = generate();
    const changed = generate({ previousPlan: draft, now: new Date(2026, 8, 15, 0, 1),
      preferences: { ...preferences, servings: 1, dinnerDays: [1] } });
    expect(changed.slots[0].status).toBe('skipped');
    const replaced = replaceMealPlanSlot(draft, draft.slots[0].id, { now: new Date(2026, 8, 15, 0, 1) });
    expect(replaced.slots[0].templateKey).not.toBe(draft.slots[0].templateKey);
  });

  it('restores the protected confirmed meal instead of trusting a changed past draft snapshot', () => {
    const confirmed = generate();
    const draft = structuredClone(confirmed);
    draft.slots[0].components[0].ingredients[0].amount = 999;
    draft.slots[0].servings = 1;
    const changed = generate({ previousPlan: draft, confirmedPlan: confirmed, now: new Date(2026, 8, 15, 0, 1) });
    expect(changed.slots[0]).toStrictEqual(confirmed.slots[0]);
    expect(generateMealPlan(changed.generationInput)).toStrictEqual(changed);
  });

  it('preserves an explicit skip draft for a protected past meal during later regeneration', () => {
    const confirmed = generate();
    const draft = setMealPlanSlotSkipped(confirmed, confirmed.slots[0].id, true, { now: new Date(2026, 8, 15, 0, 1) });
    const changed = generate({ previousPlan: draft, confirmedPlan: confirmed, now: new Date(2026, 8, 15, 0, 2), preferences });
    expect(changed.slots[0]).toStrictEqual(draft.slots[0]);
  });

  it('replays an explicit overdue skip without losing optional source fields from the draft', () => {
    const confirmed = generate();
    confirmed.slots[0].components[0].source.reviewMethod = undefined;
    const draft = setMealPlanSlotSkipped(confirmed, confirmed.slots[0].id, true, { now: new Date(2026, 8, 15, 0, 1) });
    const before = structuredClone({ confirmed, draft });
    const plan = generate({ previousPlan: draft, confirmedPlan: confirmed, now: new Date(2026, 8, 15, 0, 2) });

    expect(plan.slots[0]).toStrictEqual(before.draft.slots[0]);
    expect(generateMealPlan(plan.generationInput)).toStrictEqual(plan);
    plan.generationInput.previousPlan.slots[0].components[0].source.reviewMethod = '입력 복사본 수정';
    expect({ confirmed, draft }).toStrictEqual(before);
    expect(plan.slots[0]).toStrictEqual(before.draft.slots[0]);
  });

  it.each([{ scope: 'user:other' }, { weekStart: '2026-09-21' }])('rejects a foreign confirmed snapshot %j instead of silently dropping protection', options => {
    const confirmed = generate(options);
    const draft = generate();
    expect(() => generate({ previousPlan: draft, confirmedPlan: confirmed })).toThrow();
    expect(() => replaceMealPlanSlot(draft, draft.slots[0].id, { confirmedPlan: confirmed, now })).toThrow();
  });

  it('creates seven ordered dinner slots and skips unselected weekdays', () => {
    const plan = generate({ preferences: { ...preferences, dinnerDays: [0, 2, 4] } });
    expect(plan).toMatchObject({ id: `week:${weekStart}`, schemaVersion: 1, scope: 'guest', revision: 1, createdAt: now, updatedAt: now });
    expect(plan.slots).toHaveLength(7);
    expect(plan.slots.map((slot) => slot.date)).toEqual(Array.from({ length: 7 }, (_, day) => addCalendarDays(weekStart, day)));
    expect(plan.slots.map((slot) => slot.status)).toEqual(['planned', 'skipped', 'planned', 'skipped', 'planned', 'skipped', 'skipped']);
    expect(plan.slots.every((slot) => slot.servings === 2 && slot.mealType === 'dinner')).toBe(true);
  });

  it('normalizes preferences and supports intentionally empty dinner days', () => {
    const plan = generate({ preferences: { servings: 99, dinnerDays: [], excludedIngredients: [' 두부 ', '', '두부', null] } });
    expect(plan.preferences).toEqual({ servings: 1, dinnerDays: [], excludedIngredients: ['두부'] });
    expect(plan.slots.every((slot) => slot.status === 'skipped')).toBe(true);
    expect(generate({ preferences: { dinnerDays: [0, 0, -1, 7, '1', 2] } }).preferences.dinnerDays).toEqual([0, 2]);
  });

  it('is reproducible with the same time and inputs and reduces menu repetition', () => {
    const first = generate();
    expect(generate()).toEqual(first);
    expect(new Set(first.slots.map((slot) => slot.templateKey)).size).toBe(7);
  });

  it('prefers named inventory matches and near-expiry ingredients', () => {
    const ingredients = ['파스타면', '토마토', '새우'].map((name) => inventory(name, weekStart));
    const plan = generate({ ingredients, pantryItems: ['소금'] });
    expect(plan.slots[0].templateKey).toBe('local-meal:shrimp-tomato-pasta');
    expect(plan.slots[0].reason).toContain('기한이 가까운');
  });

  it('filters all source ingredient alternatives, including aliases and unselected optional names', () => {
    const excluded = ['달걀', '돼지고기', '파마산 치즈'];
    const plan = generate({ preferences: { ...preferences, excludedIngredients: excluded } });
    const rawNames = plan.slots.flatMap((slot) => slot.components.flatMap((component) => component.ingredients.map((line) => line.rawName)));
    expect(rawNames).not.toContain('계란');
    expect(rawNames).not.toContain('돼지고기');
    expect(rawNames).not.toContain('파마산 치즈');
  });

  it('matches common mushroom, tofu and pork aliases conservatively', () => {
    const plan = generate({ preferences: { ...preferences, excludedIngredients: ['표고버섯', '순두부', '앞다리살'] } });
    const rawNames = plan.slots.flatMap((slot) => slot.components.flatMap((component) => component.ingredients.map((line) => line.rawName)));
    expect(rawNames).not.toContain('버섯');
    expect(rawNames).not.toContain('두부');
    expect(rawNames).not.toContain('돼지고기');
  });

  it('shows empty slots and an explanation if every candidate is excluded', () => {
    // Raw rice and Chinese noodles remain separate from cooked rice and pasta.
    const plan = generate({ preferences: { ...preferences, excludedIngredients: ['밥', '파스타면', '소면', '쌀', '중화면'] } });
    expect(plan.slots.every((slot) => slot.status === 'empty' && slot.templateKey === null)).toBe(true);
    expect(plan.slots[0].reason).toContain('메뉴가 없어요');
  });

  it('never mutates input inventory, source recipes, preferences, previous plans or the catalog', () => {
    const ingredients = [inventory('두부', '2026-09-14', { quantity: '1모' })];
    const before = JSON.stringify({ ingredients, preferences, seedRecipes, mealPlanCatalog });
    const first = generate({ ingredients });
    const firstBefore = JSON.stringify(first);
    const second = generate({ ingredients, previousPlan: first });
    second.slots[0].components[0].ingredients[0].rawName = 'changed snapshot';
    expect(JSON.stringify(first)).toBe(firstBefore);
    expect(JSON.stringify({ ingredients, preferences, seedRecipes, mealPlanCatalog })).toBe(before);
  });

  it('never reuses another scope or another week as the previous plan', () => {
    const first = generate();
    const nextAccount = generate({ scope: 'user:other', previousPlan: first });
    expect(nextAccount.revision).toBe(1);
    expect(nextAccount.scope).toBe('user:other');
    const nextWeek = generate({ weekStart: '2026-09-21', previousPlan: first });
    expect(nextWeek.revision).toBe(1);
    expect(nextWeek.weekStart).toBe('2026-09-21');
  });
});

describe('inventory checking without quantity guarantees', () => {
  it('checks expiry against the planned meal date, including expiry day', () => {
    const slot = slotFor('tomato-egg-rice', '2026-09-16');
    const ingredients = [inventory('밥'), inventory('토마토', '2026-09-15'), inventory('달걀', '2026-09-16')];
    const result = getSlotSummary(slot, ingredients, ['소금', '식용유']);
    expect(result.availableIngredients).toEqual(expect.arrayContaining(['밥', '계란', '소금', '식용유']));
    expect(result.missingIngredients).toEqual(['토마토']);
    expect(result.expiringIngredients).toEqual(['계란']);
  });

  it('does not count consumed, deleted or unknown-expiry ingredients as confirmed availability', () => {
    const slot = slotFor('tomato-egg-rice');
    const ingredients = [
      inventory('밥', '2026-10-01', { consumed: true }),
      inventory('토마토', '2026-10-01', { deletedAt: now }),
      inventory('계란', ''),
      inventory('소금', '2026-02-30'),
    ];
    const result = getSlotSummary(slot, ingredients, ['식용유']);
    expect(result.availableIngredients).toEqual(['식용유']);
    expect(result.missingIngredients).toEqual(['밥', '토마토']);
    expect(result.unverifiedExpiryIngredients).toEqual(['계란', '소금']);
    expect(result.reason).toContain('기한 미확인');
  });

  it('does not let an expired duplicate override a usable stock item', () => {
    const slot = slotFor('tomato-egg-rice');
    const result = getSlotSummary(slot, [inventory('계란', '2026-09-13'), inventory('달걀'), inventory('계란', '')]);
    expect(result.availableIngredients).toContain('계란');
    expect(result.missingIngredients).not.toContain('계란');
    expect(result.unverifiedExpiryIngredients).not.toContain('계란');
  });

  it('does not allocate the same free-form inventory or claim sufficient weekly amounts', () => {
    const ingredients = [inventory('밥', '2026-12-01', { quantity: '1개' })];
    const result = getSlotSummary(slotFor('tomato-egg-rice'), ingredients);
    expect(result.quantityStatus).toBe('unverified');
    expect(result.quantityCaution).toContain('한 주에 필요한 분량을 보장하지 않아요');
    expect(result).not.toHaveProperty('availableAmount');
    expect(ingredients[0].quantity).toBe('1개');
    expect(ingredients[0].consumed).toBe(false);
  });

  it('does not expose requirement lists for skipped dates', () => {
    const result = getSlotSummary({ ...slotFor('tomato-egg-rice'), status: 'skipped' }, []);
    expect(result.availableIngredients).toEqual([]);
    expect(result.missingIngredients).toEqual([]);
  });

  it('recomputes the displayed recommendation reason when inventory changes', () => {
    const slot = { ...slotFor('tomato-egg-rice'), reason: '보유한 토마토에 맞춘 메뉴예요.' };
    expect(getSlotSummary(slot, [inventory('토마토')]).reason).toContain('보유한 토마토');
    expect(getSlotSummary(slot, []).reason).not.toContain('보유한 토마토');
    expect(getSlotSummary(slot, []).reason).toContain('장보기를 고려한');
  });
});

describe('menu changes, locks and skipped dates', () => {
  it('does not replace an overdue planned meal or release its pending demand', () => {
    const plan = generate();
    const before = structuredClone(plan);
    const next = replaceMealPlanSlot(plan, plan.slots[0].id, { confirmedPlan: plan, now: new Date(2026, 8, 15, 0, 1) });
    expect(next).toBe(plan);
    expect(plan).toStrictEqual(before);
  });

  it('replaces with a different eligible menu and increments revision without inventory writes', () => {
    const plan = generate();
    const ingredients = [inventory('밥')];
    const next = replaceMealPlanSlot(plan, plan.slots[0].id, { ingredients, now: '2026-09-12T05:00:00.000Z' });
    expect(next.slots[0].templateKey).not.toBe(plan.slots[0].templateKey);
    expect(next.revision).toBe(2);
    expect(next.createdAt).toBe(now);
    expect(next.updatedAt).toBe('2026-09-12T05:00:00.000Z');
    expect(next.slots[1]).toEqual(plan.slots[1]);
    expect(ingredients).toEqual([inventory('밥')]);
  });

  it('explains when no replacement meets current preferences', () => {
    const plan = generate({ preferences: { ...preferences, excludedIngredients: ['밥', '파스타면', '소면', '쌀', '중화면'] } });
    const next = replaceMealPlanSlot(plan, plan.slots[0].id, { now });
    expect(next.slots[0].status).toBe('empty');
    expect(next.slots[0].reason).toContain('다른 메뉴가 없어요');
  });

  it('keeps the selected dinner and displays a notice when it is the only eligible option', () => {
    const plan = generate({ preferences: { ...preferences, excludedIngredients: ['밥', '토마토', '소면', '쌀', '중화면', '두유'] } });
    expect(plan.slots[0].templateKey).toBe('local-meal:broccoli-pasta');
    const next = replaceMealPlanSlot(plan, plan.slots[0].id, { now });
    expect(next.slots[0].templateKey).toBe(plan.slots[0].templateKey);
    expect(next.slots[0].components).toEqual(plan.slots[0].components);
    expect(getSlotSummary(next.slots[0]).reason).toContain('다른 메뉴가 없어요');
  });

  it('keeps locked menus and skipped dates during regeneration', () => {
    const plan = generate();
    const locked = toggleMealPlanSlotLock(plan, plan.slots[0].id, { now });
    const skipped = setMealPlanSlotSkipped(locked, plan.slots[1].id, true, { now });
    const next = generate({ previousPlan: skipped, preferences: skipped.preferences });
    expect(next.slots[0].locked).toBe(true);
    expect(next.slots[0].templateKey).toBe(plan.slots[0].templateKey);
    expect(next.slots[1].status).toBe('skipped');
    expect(replaceMealPlanSlot(next, next.slots[0].id, { now }).slots[0].templateKey).toBe(plan.slots[0].templateKey);
  });

  it('flags a preference conflict without silently overwriting the locked snapshot', () => {
    const plan = generate();
    const first = plan.slots[0];
    const excludedName = first.components[0].ingredients.find((line) => line.selected).rawName;
    const locked = toggleMealPlanSlotLock(plan, first.id, { now });
    const next = generate({ previousPlan: locked, preferences: { ...preferences, excludedIngredients: [excludedName] } });
    expect(next.slots[0].templateKey).toBe(first.templateKey);
    expect(next.slots[0].reason).toContain('제외 재료');
    expect(next.slots[0].reason).toContain('고정을 풀고');
    expect(getSlotSummary(next.slots[0]).reason).toContain('제외 재료');
  });

  it('restores a skipped menu with current preferences, keeping dinner days in sync', () => {
    const plan = generate();
    const skipped = setMealPlanSlotSkipped(plan, plan.slots[0].id, true, { now });
    expect(skipped.preferences.dinnerDays).not.toContain(0);
    const restored = setMealPlanSlotSkipped(skipped, plan.slots[0].id, false, { now });
    expect(restored.slots[0].status).toBe('planned');
    expect(restored.slots[0].templateKey).toBe(plan.slots[0].templateKey);
    expect(restored.preferences.dinnerDays).toContain(0);
  });

  it('restores a skipped date when the dinner-day checkbox explicitly adds it back', () => {
    const plan = generate({ preferences: { ...preferences, dinnerDays: [1, 2, 3, 4, 5, 6] } });
    expect(plan.slots[0].status).toBe('skipped');
    const next = generate({ previousPlan: plan, preferences });
    expect(next.slots[0].status).toBe('planned');
    expect(next.preferences.dinnerDays).toContain(0);
  });

  it('clears a locked preference conflict after the exclusion is removed', () => {
    const plan = generate();
    const first = plan.slots[0];
    const name = first.components[0].ingredients.find((line) => line.selected).rawName;
    const locked = toggleMealPlanSlotLock(plan, first.id, { now });
    const conflict = generate({ previousPlan: locked, preferences: { ...preferences, excludedIngredients: [name] } });
    const resolved = generate({ previousPlan: conflict, preferences });
    expect(resolved.slots[0].locked).toBe(true);
    expect(getSlotSummary(resolved.slots[0]).reason).not.toContain('제외 재료');
  });

  it('does not restore excluded ingredients from a previously skipped snapshot', () => {
    const plan = generate();
    const skipped = setMealPlanSlotSkipped(plan, plan.slots[0].id, true, { now });
    const withExclusions = { ...skipped, preferences: { ...skipped.preferences, excludedIngredients: ['밥', '파스타면', '소면', '쌀', '중화면'] } };
    const restored = setMealPlanSlotSkipped(withExclusions, plan.slots[0].id, false, { now });
    expect(restored.slots[0].status).toBe('empty');
    expect(restored.slots[0].templateKey).toBeNull();
  });

  it('ignores an unknown slot ID without mutating the revision', () => {
    const plan = generate();
    expect(replaceMealPlanSlot(plan, 'unknown', { now })).toBe(plan);
    expect(toggleMealPlanSlotLock(plan, 'unknown', { now })).toBe(plan);
    expect(setMealPlanSlotSkipped(plan, 'unknown', true, { now })).toBe(plan);
  });
});
