import { describe, expect, it } from 'vitest';
import { allocateMealPlanInventory } from '../mealPlanAllocation.js';
import { generateMealPlan } from '../mealPlanDomain.js';

// Arithmetic-only fixtures. These are not reviewed recipes or inventory records.
const TODAY = '2026-09-14';
function line(overrides = {}) {
  return {
    id: 'chicken', rawName: '닭고기', ingredientKey: 'fixture:chicken',
    preparationState: 'raw', unit: 'g', amount: 200,
    quantityStatus: 'verified', quantityEvidence: 'fixture:200g',
    optional: false, selected: true, ...overrides,
  };
}
function slot(date, overrides = {}) {
  return {
    id: `${date}:dinner`, date, title: '산술 확인용 메뉴', status: 'planned', servings: 1,
    components: [{ id: 'main', recipeVersion: 'fixture-v1', source: { id: 'fixture' },
      servings: 1, servingsStatus: 'verified', ingredients: [line()] }], ...overrides,
  };
}
function plan(slots, overrides = {}) {
  return { id: 'week:2026-09-14', weekStart: '2026-09-14', scope: 'guest', slots, ...overrides };
}
function stock(overrides = {}) {
  return { id: 'batch-1', name: '닭고기', ingredientKey: 'fixture:chicken',
    preparationState: 'raw', amount: 300, unit: 'g', quantityStatus: 'verified',
    quantityEvidence: 'fixture:user-confirmed', expiryDate: '2026-10-01', ...overrides };
}
function allocate(confirmedPlans, inventory = [stock()], overrides = {}) {
  return allocateMealPlanInventory({ scope: 'guest', confirmedPlans, inventory, today: TODAY, ...overrides });
}
function frozen(value) {
  Object.values(value).forEach((entry) => { if (entry && typeof entry === 'object') frozen(entry); });
  return Object.freeze(value);
}

describe('future confirmed meal inventory allocation', () => {
  it('allocates 300g only once across two 200g meals without changing stock or source rows', () => {
    const plans = frozen([plan([slot(TODAY), slot('2026-09-15')])]);
    const inventory = frozen([stock()]);
    const result = allocate(plans, inventory);
    expect(result).toMatchObject({ status: 'shortage', slots: [
      { id: `${TODAY}:dinner`, status: 'sufficient', requirements: [{ allocatedAmount: 200, shortageAmount: 0 }] },
      { id: '2026-09-15:dinner', status: 'shortage', requirements: [{ allocatedAmount: 100, shortageAmount: 100 }] },
    ], shopping: { source: 'plan', shortages: [{ label: '닭고기', amount: 100, unit: 'g' }], needsReview: [] } });
    expect(inventory[0].amount).toBe(300);
    expect(plans[0].slots[0].components[0].ingredients[0].amount).toBe(200);
  });

  it('sorts all weeks by date before allocating the same stock', () => {
    const result = allocate([
      plan([slot('2026-09-21')], { id: 'week:2026-09-21', weekStart: '2026-09-21' }),
      plan([slot(TODAY)]),
    ]);
    expect(result?.slots.map((item) => [item.date, item.requirements[0].allocatedAmount])).toEqual([
      [TODAY, 200], ['2026-09-21', 100],
    ]);
    expect(result?.shopping.shortages).toMatchObject([{ amount: 100, slotIds: ['2026-09-21:dinner'] }]);
  });

  it('keeps yesterday\'s 200g hold when the day changes instead of reusing it for today', () => {
    const plans = frozen([plan([slot(TODAY), slot('2026-09-15')])]);
    const inventory = frozen([stock()]);
    const before = allocate(plans, inventory);
    const after = allocate(plans, inventory, { today: '2026-09-15' });
    expect(before.slots.map(item => item.requirements[0].allocatedAmount)).toEqual([200, 100]);
    expect(after.slots).toMatchObject([
      { date: TODAY, overdue: true, status: 'needs-review', requirements: [{ allocatedAmount: 200, shortageAmount: null, status: 'needs-review' }] },
      { date: '2026-09-15', overdue: false, requirements: [{ allocatedAmount: 100, shortageAmount: 100 }] }
    ]);
    expect(after.shopping.shortages).toMatchObject([{ amount: 100, slotIds: ['2026-09-15:dinner'] }]);
    expect(after.shopping.needsReview.filter(item => item.reason === 'overdue-meal-unconfirmed')).toEqual([
      expect.objectContaining({ slotId: `${TODAY}:dinner`, date: TODAY, title: '산술 확인용 메뉴' })
    ]);
    expect(inventory[0].amount).toBe(300);
    expect(plans[0].slots[0].status).toBe('planned');
  });

  it('keeps past shortages and optional rows out of new purchase quantities', () => {
    const past = slot(TODAY);
    past.components[0].ingredients.push(line({ id: 'optional', rawName: '장식', optional: true, selected: false }));
    const result = allocate([plan([past, slot('2026-09-15')])], [], { today: '2026-09-15' });
    expect(result.slots[0]).toMatchObject({ overdue: true, status: 'needs-review', requirements: [{ allocatedAmount: 0, shortageAmount: null, uncoveredAmount: 200 }] });
    expect(result.shopping.shortages).toEqual([expect.objectContaining({ amount: 200, slotIds: ['2026-09-15:dinner'] })]);
    expect(result.shopping.optional).toEqual([]);
  });

  it('keeps unknown past demand from making future matching stock look available', () => {
    const past = slot(TODAY);
    past.components[0].ingredients[0].amount = null;
    const result = allocate([plan([slot('2026-09-21')], { weekStart: '2026-09-21' }), plan([past])], [stock()], { today: '2026-09-15' });
    expect(result.slots.map(item => item.date)).toEqual([TODAY, '2026-09-21']);
    expect(result.slots[1]).toMatchObject({ overdue: false, status: 'needs-review', requirements: [{ allocatedAmount: 0, shortageAmount: null, reasons: ['prior-demand-unverified'] }] });
    expect(result.shopping.shortages).toEqual([]);
  });

  it.each(['skipped', 'cooked'])('releases a past hold only after its explicit %s state is supplied', (status) => {
    const result = allocate([plan([slot(TODAY, { status }), slot('2026-09-15')])], [stock()], { today: '2026-09-15' });
    expect(result.slots).toHaveLength(1);
    expect(result.slots[0]).toMatchObject({ date: '2026-09-15', overdue: false, requirements: [{ allocatedAmount: 200 }] });
    expect(result.shopping.needsReview).toEqual([]);
  });

  it('keeps a wholly overdue plan visible for confirmation instead of returning empty', () => {
    const result = allocate([plan([slot(TODAY)])], [stock()], { today: '2026-09-21' });
    expect(result).toMatchObject({ status: 'needs-review', slots: [{ overdue: true }], shopping: { shortages: [], optional: [] } });
    expect(result.shopping.needsReview).toContainEqual(expect.objectContaining({ reason: 'overdue-meal-unconfirmed' }));
  });

  it('never parses an unconfirmed half-block or a pantry owned flag as a quantity', () => {
    const result = allocate([plan([slot(TODAY)])], [stock({ amount: null, quantity: '반 모', quantityStatus: 'unverified', owned: true })]);
    expect(result).toMatchObject({ status: 'needs-review', shopping: { shortages: [] }, slots: [
      { requirements: [{ allocatedAmount: 0, shortageAmount: null, uncoveredAmount: 200, status: 'needs-review' }] },
    ] });
    expect(result?.shopping.needsReview).toMatchObject([{ label: '닭고기', reason: 'inventory-unverified' }]);
  });

  it('holds past meals for review but excludes skipped, cooked and consumed or deleted stock', () => {
    const result = allocate([plan([
      slot('2026-09-13'), slot(TODAY, { status: 'skipped' }),
      slot('2026-09-15', { status: 'cooked' }), slot('2026-09-16'),
    ])], [stock({ consumed: true }), stock({ id: 'deleted', deletedAt: '2026-09-14T00:00:00Z' })]);
    expect(result).toMatchObject({ status: 'needs-review', slots: [
      { date: '2026-09-13', overdue: true }, { date: '2026-09-16', overdue: false }
    ], shopping: {
      shortages: [{ amount: 200, slotIds: ['2026-09-16:dinner'] }],
      needsReview: [expect.objectContaining({ slotId: '2026-09-13:dinner', reason: 'overdue-meal-unconfirmed' })],
    } });
    expect(result?.slots).toHaveLength(2);
  });

  it('keeps a current unreviewed generated plan as named review items, never zero-demand success', () => {
    const currentPlan = generateMealPlan({ weekStart: TODAY, scope: 'guest', preferences: {
      servings: 1, dinnerDays: [0], excludedIngredients: [],
    } });
    const result = allocate([currentPlan], []);
    expect(result?.status).toBe('needs-review');
    expect(result?.shopping.needsReview.length).toBeGreaterThan(0);
    expect(result?.shopping.needsReview.every((item) => item.label?.trim() && item.knownAmount === null)).toBe(true);
    expect(result?.shopping.shortages).toEqual([]);
  });

  it('uses earliest expiry first and includes stock expiring on the meal date', () => {
    const result = allocate([plan([slot(TODAY), slot('2026-09-15')])], [
      stock({ id: 'later', amount: 200 }), stock({ id: 'earlier', amount: 100, expiryDate: TODAY }),
    ]);
    expect(result?.slots[0].requirements[0].allocations).toEqual([
      { inventoryId: 'earlier', amount: 100 }, { inventoryId: 'later', amount: 100 },
    ]);
    expect(result?.shopping.shortages).toMatchObject([{ amount: 100 }]);
  });

  it.each([
    ['2026-09-13', 'inventory-expired'], [null, 'inventory-expiry-unknown'],
    ['2026-02-30', 'inventory-expiry-unknown'],
  ])('does not allocate stock with expiry %s and keeps it for confirmation', (expiryDate, reason) => {
    const result = allocate([plan([slot(TODAY)])], [stock({ expiryDate })]);
    expect(result?.slots[0].requirements[0]).toMatchObject({ allocatedAmount: 0, shortageAmount: null });
    expect(result?.shopping.needsReview).toMatchObject([{ reason }]);
  });

  it('keeps known stock usable alongside unknown stock but does not claim an exact shortage', () => {
    const result = allocate([plan([slot(TODAY), slot('2026-09-15')])], [
      stock(), stock({ id: 'unknown', amount: null, quantityStatus: 'unverified' }),
    ]);
    expect(result?.slots.map((item) => item.status)).toEqual(['sufficient', 'needs-review']);
    expect(result?.slots[1].requirements[0]).toMatchObject({ allocatedAmount: 100, uncoveredAmount: 100, shortageAmount: null });
    expect(result?.shopping.shortages).toEqual([]);
  });

  it('propagates earlier unknown demand without reserving a made-up amount', () => {
    const first = slot(TODAY);
    first.components[0].ingredients.push(line({ id: 'sauce', amount: null, quantityStatus: 'unverified' }));
    const result = allocate([plan([first, slot('2026-09-15')])]);
    expect(result?.slots[0].requirements[0]).toMatchObject({ requiredAmount: null, knownAmount: 200, allocatedAmount: 0, shortageAmount: null });
    expect(result?.slots[1].requirements[0]).toMatchObject({ allocatedAmount: 0, shortageAmount: null });
    expect(result?.shopping.needsReview.some((item) => item.reason === 'prior-demand-unverified')).toBe(true);
  });

  it('does not let unknown salt demand block explicitly different chicken stock', () => {
    const first = slot(TODAY);
    first.components[0].ingredients = [line({ ingredientKey: 'fixture:salt', rawName: '소금', amount: null })];
    const result = allocate([plan([first, slot('2026-09-15')])]);
    expect(result?.slots[1]).toMatchObject({ status: 'sufficient', requirements: [{ allocatedAmount: 200 }] });
  });

  it('blocks optimistic allocation after an unidentifiable required demand, regardless of row order', () => {
    const first = slot(TODAY);
    first.components[0].ingredients.push(line({ id: 'unknown', ingredientKey: null, amount: null }));
    const forward = allocate([plan([first, slot('2026-09-15')])]);
    const reversed = structuredClone(first);
    reversed.components[0].ingredients.reverse();
    const backward = allocate([plan([reversed, slot('2026-09-15')])]);
    expect(forward?.slots.map((item) => item.requirements[0].allocatedAmount)).toEqual([0, 0]);
    expect(backward?.slots.map((item) => item.requirements[0].allocatedAmount)).toEqual([0, 0]);
    expect(forward?.shopping.shortages).toEqual([]);
  });

  it('does not attach a different food subtotal to an unidentifiable source row', () => {
    const meal = slot(TODAY);
    meal.components[0].ingredients.push(line({ id: 'unknown', rawName: '알 수 없는 채소', ingredientKey: null, amount: null }));
    const result = allocate([plan([meal])]);
    expect(result?.shopping.needsReview.find((item) => item.lineId === 'unknown')).toMatchObject({
      label: '알 수 없는 채소', ingredientKey: null, knownAmount: null,
    });
  });

  it('preserves both dimension subtotals without assigning one to a unit-unknown source row', () => {
    const meal = slot(TODAY);
    meal.components[0].ingredients = [line({ amount: 2 }), line({ id: 'liquid', unit: 'ml', amount: 3 }),
      line({ id: 'unknown', amount: null, unit: null })];
    const result = allocate([plan([meal])], []);
    expect(result?.slots[0].requirements).toMatchObject([
      { unit: 'g', requiredAmount: null, knownAmount: 2 }, { unit: 'ml', requiredAmount: null, knownAmount: 3 },
    ]);
    expect(result?.shopping.needsReview.find((item) => item.lineId === 'unknown')).toMatchObject({ unit: null, knownAmount: null });
  });

  it.each([
    { preparationState: 'cooked' }, { unit: 'ml' }, { unit: '팩' }, { quantityEvidence: '' },
    { amount: NaN }, { amount: -1 }, { amount: 0.0001 },
  ])('does not infer compatibility or certainty for batch %j', (overrides) => {
    const result = allocate([plan([slot(TODAY)])], [stock(overrides)]);
    expect(result?.slots[0].requirements[0]).toMatchObject({ status: 'needs-review', allocatedAmount: 0, shortageAmount: null });
  });

  it('does not equate recommendation aliases with quantitative batch identity', () => {
    const result = allocate([plan([slot(TODAY)])], [stock({ ingredientKey: 'fixture:chicken-breast', name: '닭가슴살' })]);
    expect(result?.shopping.shortages).toMatchObject([{ amount: 200 }]);
  });

  it('converts compatible kg and l and preserves fractional units without rounding shortage noise', () => {
    const meal = slot(TODAY);
    meal.components[0].ingredients = [line({ amount: 0.1 }), line({ id: 'sauce', amount: 0.2 }),
      line({ id: 'water', ingredientKey: 'fixture:water', amount: 250, unit: 'ml' })];
    const result = allocate([plan([meal])], [stock({ amount: 0.0003, unit: 'kg' }),
      stock({ id: 'water', ingredientKey: 'fixture:water', unit: 'l', amount: 0.25 })]);
    expect(result?.status).toBe('sufficient');
    expect(result?.slots[0].requirements.map((item) => item.allocatedAmount)).toEqual([0.3, 250]);
    expect(result?.shopping.shortages).toEqual([]);
  });

  it('keeps unselected optional ingredients separate but includes a selected option and required seasoning', () => {
    const meal = slot(TODAY);
    meal.components[0].ingredients = [
      line({ amount: 10, selected: false }),
      line({ id: 'on', amount: 20, optional: true, selected: true }),
      line({ id: 'off', amount: null, ingredientKey: null, optional: true, selected: false, rawName: '장식 채소' }),
    ];
    const result = allocate([plan([meal])], []);
    expect(result?.shopping.shortages).toMatchObject([{ amount: 30 }]);
    expect(result?.shopping.needsReview).toEqual([]);
    expect(result?.shopping.optional).toMatchObject([{ label: '장식 채소', slotId: `${TODAY}:dinner` }]);
  });

  it('aggregates only compatible shortages with traceable dates across plans', () => {
    const second = slot('2026-09-15');
    second.components[0].ingredients.push(line({ id: 'liquid', unit: 'ml', amount: 50 }));
    const result = allocate([plan([slot(TODAY), second])], []);
    expect(result?.shopping.shortages).toMatchObject([
      { amount: 400, unit: 'g', slotIds: [`${TODAY}:dinner`, '2026-09-15:dinner'] },
      { amount: 50, unit: 'ml', slotIds: ['2026-09-15:dinner'] },
    ]);
  });

  it('treats a verified zero stock amount as known empty, not unknown', () => {
    expect(allocate([plan([slot(TODAY)])], [stock({ amount: 0 })])?.shopping.shortages).toMatchObject([{ amount: 200 }]);
  });

  it('returns empty for no future confirmed demands instead of claiming cooking readiness', () => {
    expect(allocate([], [])).toMatchObject({ status: 'empty', slots: [], shopping: { shortages: [], needsReview: [], optional: [] } });
  });

  it('blocks later quantities after an unidentified food even when its unit differs', () => {
    const meal = slot(TODAY);
    meal.components[0].ingredients = [line({ ingredientKey: null, amount: null, unit: 'ml' })];
    expect(allocate([plan([meal, slot('2026-09-15')])])?.slots[1]).toMatchObject({
      status: 'needs-review', requirements: [{ allocatedAmount: 0, shortageAmount: null }],
    });
  });

  it('rejects an explicitly foreign inventory scope even when its food identity matches', () => {
    expect(() => allocate([plan([slot(TODAY)])], [stock({ scope: 'user:other' })])).toThrow();
  });

  it('rejects a shopping sum that would lose 0.001g in its numeric output', () => {
    const first = slot(TODAY);
    first.components[0].ingredients[0].amount = 9007199254740.99;
    const second = slot('2026-09-15');
    second.components[0].ingredients[0].amount = 0.001;
    expect(() => allocate([plan([first, second])], [])).toThrow(RangeError);
  });

  it('rejects an allocation output that cannot preserve the exact remaining thousandth', () => {
    const first = slot(TODAY);
    first.components[0].ingredients[0].amount = 0.001;
    const second = slot('2026-09-15');
    second.components[0].ingredients[0].amount = 9007199254740.99;
    expect(() => allocate([plan([first, second])], [stock({ amount: 9007199254740.99 })])).toThrow(RangeError);
  });

  it.each([12345, {}, true])('keeps malformed expiry %j as review-needed without crashing the list', (expiryDate) => {
    const run = () => allocate([plan([slot(TODAY)])], [stock({ id: 'empty', amount: 0 }), stock({ expiryDate })]);
    expect(run).not.toThrow();
    expect(run()).toMatchObject({ status: 'needs-review', shopping: { shortages: [] } });
  });

  it.each([
    { today: '2026-02-30' }, { scope: '../guest' }, { scope: 'user:other' },
    { inventory: [stock(), stock()] }, { confirmedPlans: [plan([slot(TODAY), slot(TODAY)])] },
    { confirmedPlans: [plan([slot(TODAY, { status: 'surprise' })])] },
    { confirmedPlans: [plan([slot('invalid')])] }, { confirmedPlans: [null] },
    { inventory: [null] }, { inventory: null }, { confirmedPlans: new Array(1) },
  ])('rejects ambiguous or malformed input %j instead of guessing', (overrides) => {
    expect(() => allocate([plan([slot(TODAY)])], [stock()], overrides)).toThrow();
  });
});
