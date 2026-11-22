import { describe, expect, it } from 'vitest';
import { allocatePlannedMeals } from '../mealPlanningAllocation.js';

const context = { scope: 'guest', asOf: '2026-09-15T09:00:00+09:00', fromDate: '2026-09-15' };

function batch(id = 'batch:one', amount = 300, overrides = {}) {
  return {
    id, foodId: 'food:rice', preparationState: 'raw', amount, unit: 'g',
    quantityStatus: 'confirmed', availabilityStatus: 'available',
    expiryStatus: 'dated', expiryDate: '2026-10-01', confirmedAt: context.asOf,
    ...overrides,
  };
}

function demand(lineId = 'line:rice', amount = 200, overrides = {}) {
  return {
    lineId, foodId: 'food:rice', preparationState: 'raw', amount, unit: 'g',
    quantityStatus: 'verified', required: true, selected: true, ...overrides,
  };
}

function meal(id = 'meal:one', date = '2026-09-15', overrides = {}) {
  return {
    id, scope: 'guest', planId: 'plan:week-one', planRevision: 1, slotId: `${date}:dinner`, componentId: id,
    date, mealType: 'dinner', status: 'confirmed', locked: false,
    recipeId: 'recipe:rice', recipeVersion: 'v1', demands: [demand()], ...overrides,
  };
}

function allocate(items, meals, overrides = {}) {
  return allocatePlannedMeals({ ...context, inventory: { scope: 'guest', revision: 'stock:1', items }, meals, ...overrides });
}

function deepFreeze(value) {
  Object.values(value).forEach((nested) => {
    if (nested && typeof nested === 'object') deepFreeze(nested);
  });
  return Object.freeze(value);
}

describe('allocation of confirmed meals across the whole planning horizon', () => {
  it('reserves 200 then only the remaining 100 from a physical 300 without double use', () => {
    const result = allocate([batch()], [meal(), meal('meal:two', '2026-09-16')]);
    expect(result.status).toBe('calculated');
    expect(result.meals.map((entry) => entry.requirements[0])).toMatchObject([
      { requiredAmount: 200, allocatedAmount: 200, missingAmount: 0, status: 'sufficient', allocations: [{ inventoryId: 'batch:one', amount: 200 }] },
      { requiredAmount: 200, allocatedAmount: 100, missingAmount: 100, status: 'shortage', allocations: [{ inventoryId: 'batch:one', amount: 100 }] },
    ]);
  });

  it('allocates across weeks in date/id order independently of input order and lock state', () => {
    const meals = [
      meal('meal:z', '2026-09-22', { planId: 'plan:week-two', planRevision: 3 }),
      meal('meal:b', '2026-09-15', { locked: true }), meal('meal:a'),
    ];
    const result = allocate([batch('stock', 450)], meals);
    expect(result.meals.map((entry) => entry.id)).toEqual(['meal:a', 'meal:b', 'meal:z']);
    expect(result.meals.map((entry) => entry.requirements[0].allocatedAmount)).toEqual([200, 200, 50]);
    expect(result.basis).toEqual({ ...context, inventoryRevision: 'stock:1', planVersions: [
      { id: 'plan:week-one', revision: 1 }, { id: 'plan:week-two', revision: 3 },
    ] });
    expect(allocate([batch('stock', 450)], [...meals].reverse())).toEqual(result);
  });

  it('excludes past, draft, skipped, cooked and archived meals from reservations', () => {
    const meals = [meal('past', '2026-09-14'), ...['draft', 'skipped', 'cooked', 'archived'].map((status) => meal(status, '2026-09-15', { status })), meal()];
    const result = allocate([batch('stock', 200)], meals);
    expect(result.meals.map((entry) => entry.id)).toEqual(['meal:one']);
    expect(result.meals[0].requirements[0]).toMatchObject({ allocatedAmount: 200, status: 'sufficient' });
  });

  it('uses the earliest valid expiry then batch id, with no-expiry batches last', () => {
    const result = allocate([
      batch('none', 100, { expiryStatus: 'no-expiry', expiryDate: null }),
      batch('b', 40, { expiryDate: '2026-09-15' }),
      batch('a', 30, { expiryDate: '2026-09-15' }),
      batch('later', 50, { expiryDate: '2026-09-16' }),
    ], [meal()]);
    expect(result.status).toBe('calculated');
    expect(result.meals[0].requirements[0].allocations).toEqual([
      { inventoryId: 'a', amount: 30 }, { inventoryId: 'b', amount: 40 },
      { inventoryId: 'later', amount: 50 }, { inventoryId: 'none', amount: 80 },
    ]);
  });

  it('still puts an actual maximum calendar expiry before a no-expiry batch', () => {
    const result = allocate([
      batch('a-no-expiry', 200, { expiryStatus: 'no-expiry', expiryDate: null }),
      batch('z-dated', 200, { expiryDate: '9999-12-31' }),
    ], [meal()]);
    expect(result.meals[0].requirements[0].allocations).toEqual([{ inventoryId: 'z-dated', amount: 200 }]);
  });

  it('combines repeated selected ingredient lines and preserves their identities and requiredness', () => {
    const result = allocate([batch('stock', 90)], [meal('one', '2026-09-15', { demands: [
      demand('main', 40), demand('sauce', 30, { required: false }),
      demand('excluded', 1000, { selected: false }),
    ] })]);
    expect(result.status).toBe('calculated');
    expect(result.meals[0].requirements).toEqual([{
      foodId: 'food:rice', preparationState: 'raw', unit: 'g', lineIds: ['main', 'sauce'], required: true,
      requiredAmount: 70, allocatedAmount: 70, missingAmount: 0, status: 'sufficient',
      allocations: [{ inventoryId: 'stock', amount: 70 }], reasons: [],
    }]);
  });

  it('does not mutate frozen inventory, plan order, locked menu, demands or context', () => {
    const input = deepFreeze({ ...context, inventory: { scope: 'guest', revision: 0, items: [batch()] }, meals: [meal('locked', '2026-09-15', { locked: true })] });
    const before = structuredClone(input);
    const first = allocatePlannedMeals(input);
    expect(first.status).toBe('calculated');
    expect(first.meals[0].requirements[0].allocatedAmount).toBe(200);
    first.meals[0].requirements[0].allocations[0].amount = 99;
    expect(allocatePlannedMeals(input).meals[0].requirements[0].allocations[0].amount).toBe(200);
    expect(input).toEqual(before);
  });
});

describe('uncertainty is not invented as zero or free stock', () => {
  it.each([
    ['absent', [], 0, null, 'needs-confirmation'],
    ['unknown amount', [batch('unknown', null, { quantityStatus: 'unknown' })], 0, null, 'needs-confirmation'],
    ['explicit zero', [batch('zero', 0, { expiryStatus: 'unknown', expiryDate: null })], 0, 200, 'shortage'],
    ['unavailable', [batch('none', null, { quantityStatus: 'unknown', availabilityStatus: 'unavailable', expiryStatus: 'unknown', expiryDate: null, confirmedAt: null })], 0, 200, 'shortage'],
    ['other unit', [batch('ml', 300, { unit: 'ml' })], 0, null, 'needs-confirmation'],
    ['cooked rice is not raw rice', [batch('cooked', 300, { preparationState: 'cooked' })], 0, null, 'needs-confirmation'],
  ])('distinguishes %s from known compatible stock', (_name, items, allocatedAmount, missingAmount, status) => {
    const result = allocate(items, [meal()]);
    expect(result.status).toBe('calculated');
    expect(result.meals[0].requirements[0]).toMatchObject({ allocatedAmount, missingAmount, status });
  });

  it.each([
    ['quantity unconfirmed', { amount: 50, quantityStatus: 'unknown' }],
    ['availability unconfirmed', { availabilityStatus: 'unknown' }],
    ['expiry unconfirmed', { expiryStatus: 'unknown', expiryDate: null }],
    ['expired on meal date', { expiryDate: '2026-09-14' }],
    ['preparation unknown', { preparationState: null }],
    ['unit unknown', { unit: null }],
    ['confirmation absent', { confirmedAt: null }],
    ['confirmation from the future', { confirmedAt: '2026-09-16T09:00:00+09:00' }],
  ])('allocates only the known batch but keeps %s explicit', (_name, uncertain) => {
    const result = allocate([batch('known', 300), batch('uncertain', 400, uncertain)], [meal()]);
    expect(result.status).toBe('calculated');
    expect(result.meals[0].requirements[0]).toMatchObject({
      allocatedAmount: 200, missingAmount: null, status: 'needs-confirmation',
      allocations: [{ inventoryId: 'known', amount: 200 }],
    });
    expect(result.meals[0].requirements[0].reasons.length).toBeGreaterThan(0);
  });

  it('requires confirmation for expired stock even when its recorded quantity is zero', () => {
    const result = allocate([batch('zero-expired', 0, { expiryDate: '2026-09-14' })], [meal()]);
    expect(result.meals[0].requirements[0]).toMatchObject({ allocatedAmount: 0, missingAmount: null, status: 'needs-confirmation' });
  });

  it('checks expiry at each meal date instead of just the snapshot date', () => {
    const result = allocate([batch('short-life', 300, { expiryDate: '2026-09-15' })], [meal(), meal('tomorrow', '2026-09-16')]);
    expect(result.meals.map((entry) => entry.requirements[0])).toMatchObject([
      { allocatedAmount: 200, missingAmount: 0, status: 'sufficient' },
      { allocatedAmount: 0, missingAmount: null, status: 'needs-confirmation' },
    ]);
  });

  it('blocks the same food after unknown demand but does not block unrelated food', () => {
    const result = allocate([batch(), batch('cooked-stock', 300, { preparationState: 'cooked' }), batch('beans', 300, { foodId: 'food:beans' })], [
      meal('unknown', '2026-09-15', { demands: [demand('unknown-rice', null, { quantityStatus: 'unknown' })] }),
      meal('later', '2026-09-16', { demands: [demand(), demand('cooked', 100, { preparationState: 'cooked' }), demand('beans', 100, { foodId: 'food:beans' })] }),
    ]);
    expect(result.meals[0].requirements[0]).toMatchObject({ requiredAmount: null, allocatedAmount: 0, missingAmount: null, status: 'needs-confirmation' });
    expect(result.meals[1].requirements).toMatchObject([
      { allocatedAmount: 0, missingAmount: null, status: 'needs-confirmation' },
      { allocatedAmount: 0, missingAmount: null, status: 'needs-confirmation' },
      { allocatedAmount: 100, missingAmount: 0, status: 'sufficient' },
    ]);
  });

  it('blocks every later food when an earlier selected demand has no food identity', () => {
    const result = allocate([batch()], [
      meal('unknown', '2026-09-15', { demands: [demand('unknown', null, { foodId: null, quantityStatus: 'unknown' })] }),
      meal('later', '2026-09-16'),
    ]);
    expect(result.meals[1].requirements[0]).toMatchObject({ allocatedAmount: 0, missingAmount: null, status: 'needs-confirmation' });
  });

  it('merges unknown duplicate demand into uncertainty without reserving its known sibling', () => {
    const result = allocate([batch()], [meal('mixed', '2026-09-15', { demands: [
      demand('main', 100), demand('unknown-sauce', null, { quantityStatus: 'unknown' }),
    ] })]);
    expect(result.meals[0].requirements).toMatchObject([{
      lineIds: ['main', 'unknown-sauce'], requiredAmount: null, allocatedAmount: 0,
      missingAmount: null, status: 'needs-confirmation',
    }]);
  });

  it('includes optional selected demand without falsely labeling it required', () => {
    const result = allocate([batch('zero', 0)], [meal('optional', '2026-09-15', { demands: [demand('garnish', 5, { required: false })] })]);
    expect(result.meals[0].requirements[0]).toMatchObject({ required: false, requiredAmount: 5, allocatedAmount: 0, missingAmount: 5, status: 'shortage' });
  });

  it('does not block later meals for unknown demand that is unselected or not confirmed', () => {
    const unknown = demand('unknown', null, { foodId: null, quantityStatus: 'unknown' });
    const result = allocate([batch()], [
      meal('draft', '2026-09-15', { status: 'draft', demands: [unknown] }),
      meal('unselected', '2026-09-15', { demands: [{ ...unknown, selected: false }] }),
      meal('later', '2026-09-16'),
    ]);
    expect(result.meals[1].requirements[0]).toMatchObject({ allocatedAmount: 200, status: 'sufficient' });
  });

  it('does not interpret an unidentified unavailable batch as confirmed absence of every food', () => {
    const unidentified = batch('unidentified', null, { foodId: null, quantityStatus: 'unknown', availabilityStatus: 'unavailable' });
    const withoutKnown = allocate([unidentified], [meal()]);
    expect(withoutKnown.meals[0].requirements[0]).toMatchObject({ allocatedAmount: 0, missingAmount: null, status: 'needs-confirmation' });
    const withKnown = allocate([unidentified, batch()], [meal()]);
    expect(withKnown.meals[0].requirements[0]).toMatchObject({ allocatedAmount: 200, missingAmount: 0, status: 'sufficient' });
  });
});

describe('invalid inputs are rejected atomically', () => {
  it.each([
    ['inventory scope', (input) => { input.inventory.scope = 'user:other'; }],
    ['meal scope', (input) => { input.meals[0].scope = 'user:other'; }],
    ['missing meal scope', (input) => { delete input.meals[0].scope; }],
    ['missing snapshot revision', (input) => { delete input.inventory.revision; }],
    ['unknown status enum', (input) => { input.meals[0].status = 'ready'; }],
    ['missing selected boolean', (input) => { delete input.meals[0].demands[0].selected; }],
    ['missing required boolean', (input) => { delete input.meals[0].demands[0].required; }],
    ['missing recipe version', (input) => { delete input.meals[0].recipeVersion; }],
    ['bad plan revision', (input) => { input.meals[0].planRevision = -1; }],
    ['bad stock amount string', (input) => { input.inventory.items[0].amount = '300'; }],
    ['bad demand amount string', (input) => { input.meals[0].demands[0].amount = '200'; }],
    ['negative stock amount', (input) => { input.inventory.items[0].amount = -0.1; }],
    ['NaN stock amount', (input) => { input.inventory.items[0].amount = NaN; }],
    ['infinite demand', (input) => { input.meals[0].demands[0].amount = Infinity; }],
    ['negative unselected demand', (input) => { input.meals[0].demands[0].amount = -1; input.meals[0].demands[0].selected = false; }],
    ['impossible start date', (input) => { input.fromDate = '2026-02-30'; }],
    ['impossible meal date', (input) => { input.meals[0].date = '2026-02-30'; }],
    ['impossible expiry date', (input) => { input.inventory.items[0].expiryDate = '2026-02-30'; }],
    ['dated expiry missing date', (input) => { input.inventory.items[0].expiryDate = null; }],
    ['impossible snapshot timestamp', (input) => { input.asOf = '2026-02-30T09:00:00Z'; }],
    ['malformed confirmation timestamp', (input) => { input.inventory.items[0].confirmedAt = 'yesterday'; }],
  ])('rejects %s without returning an actionable partial allocation', (_name, change) => {
    const input = { ...context, inventory: { scope: 'guest', revision: 1, items: [batch()] }, meals: [meal()] };
    change(input);
    let result;
    expect(() => { result = allocatePlannedMeals(input); }).not.toThrow();
    expect(result).toMatchObject({ status: 'invalid', meals: [] });
    expect(result.issues.length).toBeGreaterThan(0);
  });

  it.each([undefined, null, {}, { ...context, inventory: null }, { ...context, inventory: { scope: 'guest', revision: 1, items: [] }, meals: null }])('rejects missing structural data safely (%o)', (input) => {
    let result;
    expect(() => { result = allocatePlannedMeals(input); }).not.toThrow();
    expect(result).toMatchObject({ status: 'invalid', meals: [] });
  });

  it.each([
    ['duplicate inventory id', [batch(), batch()], [meal()]],
    ['duplicate meal id', [batch()], [meal(), meal()]],
    ['duplicate line id', [batch()], [meal('one', '2026-09-15', { demands: [demand(), demand()] })]],
    ['conflicting plan revisions', [batch()], [meal(), meal('second', '2026-09-16', { planRevision: 2 })]],
  ])('rejects %s instead of counting data twice', (_name, inventory, meals) => {
    expect(allocate(inventory, meals)).toMatchObject({ status: 'invalid', meals: [] });
  });

  it('keeps a known zero demand zero rather than inventing unknown stock requirements', () => {
    expect(allocate([], [meal('none', '2026-09-15', { demands: [demand('zero', 0)] })]).meals[0].requirements[0])
      .toMatchObject({ requiredAmount: 0, allocatedAmount: 0, missingAmount: 0, status: 'sufficient' });
  });

  it('does not drop small positive allocations or round them to zero', () => {
    const result = allocate([batch('tiny', 3e-20)], [
      meal('first', '2026-09-15', { demands: [demand('tiny', 2e-20)] }),
      meal('second', '2026-09-16', { demands: [demand('tiny', 2e-20)] }),
    ]);
    expect(result.status).toBe('calculated');
    expect(result.meals[0].requirements[0]).toMatchObject({ allocatedAmount: 2e-20, missingAmount: 0 });
    expect(result.meals[1].requirements[0].allocatedAmount).toBeGreaterThan(0);
    expect(result.meals[1].requirements[0].allocatedAmount).toBeLessThan(2e-20);
    const subnormal = allocate([batch('smallest', Number.MIN_VALUE)], [meal('tiny', '2026-09-15', { demands: [demand('tiny', Number.MIN_VALUE)] })]);
    expect(subnormal.meals[0].requirements[0]).toMatchObject({ allocatedAmount: Number.MIN_VALUE, missingAmount: 0, status: 'sufficient' });
  });

  it.each([
    ['stock sum overflow', [batch('a', Number.MAX_VALUE), batch('b', Number.MAX_VALUE)], [meal()]],
    ['demand sum overflow', [batch()], [meal('one', '2026-09-15', { demands: [demand('a', Number.MAX_VALUE), demand('b', Number.MAX_VALUE)] })]],
    ['unrepresentable subtraction', [batch('large', 1)], [meal('one', '2026-09-15', { demands: [demand('tiny', 1e-20)] })]],
    ['unrepresentable stock sum', [batch('a', 1), batch('b', 1e-20)], [meal()]],
  ])('rejects %s instead of losing quantity or over-reserving', (_name, inventory, meals) => {
    expect(allocate(inventory, meals)).toMatchObject({ status: 'invalid', meals: [], issues: [{ code: 'numeric_range' }] });
  });

  it('makes numeric validation deterministic when inventory order changes', () => {
    const inventory = [batch('a', 1), batch('b', 1e-16), batch('c', 1e-16)];
    const plans = [meal('tiny', '2026-09-15', { demands: [demand('tiny', 0)] })];
    expect(allocate(inventory, plans)).toEqual(allocate([...inventory].reverse(), plans));
  });

  it('does not make numeric validity depend on repeated source line order', () => {
    const demands = [demand('a', 1), demand('b', 1e-16), demand('c', 1e-16)];
    for (const lines of [demands, [...demands].reverse()]) {
      expect(allocate([batch('stock', 2)], [meal('one', '2026-09-15', { demands: lines })]))
        .toMatchObject({ status: 'invalid', meals: [], issues: [{ code: 'numeric_range' }] });
    }
  });
});
