import FDBFactory from 'fake-indexeddb/lib/FDBFactory';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const NOW = '2026-09-21T09:00:00.000Z';
const WEEK = '2026-09-21';
const NEXT = '2026-09-28';
const SLOT = `${WEEK}:dinner`;
const STORES = ['ingredients', 'inventoryQuantities', 'mealPlans', 'inventoryEvents', 'shoppingEntries', 'menuDecisions', 'mealPlanPilot'];
let connections = [];

async function open(scope = 'guest') {
  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(`fridgemate-db__${scope.replace(':', '_')}`);
    request.onsuccess = () => { connections.push(request.result); resolve(request.result); };
    request.onerror = () => reject(request.error);
  });
}

async function state(scope = 'guest') {
  const database = await open(scope);
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORES, 'readonly');
    const reads = STORES.map(name => transaction.objectStore(name).getAll());
    transaction.oncomplete = () => resolve(Object.fromEntries(STORES.map((name, index) => [name, reads[index].result])));
    transaction.onabort = () => reject(transaction.error);
  });
}

async function setup(scope = 'guest', options = {}) {
  const db = await import('../../../db/indexedDB');
  const plans = await import('../mealPlanRepository');
  const changes = await import('../mealPlanChangesRepository');
  const quantities = await import('../inventoryQuantityRepository');
  const cooking = await import('../mealCookingRepository');
  const { generateMealPlan } = await import('../mealPlanDomain');
  const ingredient = { id: 'chicken', name: '닭고기', quantity: '300g', consumed: false, memo: '보존 메모',
    category: '육류', storageType: '냉장', expiryDate: options.expiryDate || '2026-10-30', createdAt: NOW, updatedAt: NOW };
  await db.saveIngredient(ingredient, scope);
  async function review(amount) {
    const row = (await quantities.getInventoryQuantitySnapshot(scope)).inventory[0];
    await quantities.saveInventoryQuantity({ scope, ingredientId: row.id, expectedRevision: row.quantityRevision,
      expectedSourceToken: row.sourceToken, values: { name: '닭고기', amount, unit: 'g', preparationState: 'raw' } });
  }
  await review(300);
  async function addWeek(weekStart, dinnerDays = [0, 1], update = () => {}) {
    const plan = generateMealPlan({ scope, weekStart, now: NOW,
      preferences: { servings: 1, dinnerDays, excludedIngredients: [] } });
    const source = generateMealPlan({ scope, weekStart, now: NOW, preferences: { servings: 1, dinnerDays: [0] } }).slots[0].components[0];
    for (const slot of plan.slots.filter(item => item.status === 'planned')) {
      slot.title = `산술 메뉴 ${slot.date}`;
      slot.components = [{ ...structuredClone(source), servings: 1, servingsStatus: 'verified', processInputs: [], ingredients: [{
        ...source.ingredients[0], id: 'chicken-line', rawName: '닭고기', normalizedName: '닭고기', ingredientKey: 'food:닭고기',
        amount: 200, unit: 'g', preparationState: 'raw', quantityStatus: 'verified', quantityEvidence: 'fixture:200g',
        optional: false, selected: true,
      }] }];
    }
    update(plan);
    await plans.saveMealPlan(plan, scope, 0);
    return plans.confirmMealPlan(weekStart, scope, 1);
  }
  await addWeek(WEEK);
  const request = { scope, weekStart: WEEK, kind: 'move', slotId: SLOT, targetDate: NEXT, mode: 'move', pantryItems: [] };
  const preview = (input = request) => changes.previewMealPlanChange(input);
  return { scope, db, plans, changes, quantities, cooking, ingredient, request, preview, review, addWeek };
}

// A persisted correction chain, independent of the correction command under
// development. The original 150g consumption stays immutable; its inverse and
// replacement 100g consumption belong to one later operation.
async function seedCorrectedCooking(s, { reversed = false } = {}) {
  const row = (await s.quantities.getInventoryQuantitySnapshot(s.scope)).inventory[0];
  await s.cooking.recordMealCooking({ scope: s.scope, weekStart: WEEK, slotId: SLOT, operationId: 'actual',
    expectedPlanRevision: 2, usageMode: 'measured', completeUsageConfirmed: true,
    usages: [{ ingredientId: row.id, amount: 150, unit: 'g', expectedRevision: row.quantityRevision, expectedSourceToken: row.sourceToken }] });
  const before = await state(s.scope);
  const original = before.inventoryEvents.find(event => event.id === 'consumption:actual');
  const common = { schemaVersion: 1, scope: s.scope, weekStart: WEEK, slotId: SLOT, cookingId: 'cooking:actual',
    operationId: 'corrected', requestKey: '{"actual":100}', createdAt: '2026-09-21T09:01:00.000Z' };
  const replacement = { ...common, id: 'consumption:corrected', kind: 'consumption', replacesId: original.id,
    lines: original.lines.map(line => ({ ...line, amount: 100 })) };
  const inverse = { ...common, id: 'consumption-reversal:corrected', kind: 'consumption-reversal',
    reversesId: original.id, replacementConsumptionId: replacement.id, lines: structuredClone(original.lines) };
  const terminal = { ...common, id: 'consumption-reversal:terminal', kind: 'consumption-reversal',
    operationId: 'terminal', requestKey: '{"reverse":true}', createdAt: '2026-09-21T09:02:00.000Z',
    reversesId: replacement.id, lines: structuredClone(replacement.lines) };
  await s.db.runMealCookingTransaction('readwrite', ({ mealPlans, events }) => {
    events.add(inverse);
    events.add(replacement);
    if (reversed) events.add(terminal);
    const read = mealPlans.get(`week:${WEEK}`);
    read.onsuccess = () => {
      const record = read.result;
      record.revision = 4;
      record.confirmed.revision = 4;
      Object.assign(record.confirmed.slots[0].cooking, {
        consumptionId: replacement.id, inventoryStatus: reversed ? 'reversed' : 'applied',
        reversalId: reversed ? terminal.id : null,
      });
      mealPlans.put(record);
    };
  }, s.scope);
  // Use a separately confirmed current count, not historical-event arithmetic,
  // to supply the planning reader's valid inventory snapshot.
  await s.db.saveIngredient({ ...s.ingredient, quantity: reversed ? '300g' : '200g' }, s.scope);
  await s.review(reversed ? 300 : 200);
  return { original, replacement, inverse, terminal };
}

describe('explicit atomic meal plan changes', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(NOW));
    connections = [];
    Object.defineProperty(window, 'indexedDB', { configurable: true, value: new FDBFactory() });
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    connections.forEach(database => database.close());
    const db = await import('../../../db/indexedDB');
    await Promise.all(['guest', 'user:alice'].map(scope => db.deleteDatabase(scope)));
    vi.useRealTimers();
  });

  it('previews a cross-week move and global allocation without changing any stored rows', async () => {
    const s = await setup();
    await s.addWeek('2026-10-05', [0]);
    const before = await state();
    const preview = await s.preview();
    expect(preview).toMatchObject({ scope: 'guest', today: WEEK, canApply: true, createdAt: NOW, token: expect.any(String) });
    expect(preview.plans.map(plan => plan.weekStart)).toEqual([WEEK, NEXT]);
    expect(preview.changes.map(change => change.date)).toEqual([WEEK, NEXT]);
    expect(preview.changes[0].before.status).toBe('planned');
    expect(preview.changes[0].after.status).not.toBe('planned');
    expect(preview.changes[1].after).toMatchObject({ status: 'planned', title: `산술 메뉴 ${WEEK}` });
    expect(preview.afterAllocation.slots.map(slot => [slot.date, slot.requirements[0].allocatedAmount])).toEqual([
      ['2026-09-22', 200], [NEXT, 100], ['2026-10-05', 0],
    ]);
    expect(preview.beforeAllocation.shopping.shortages).toMatchObject([{ amount: 300 }]);
    expect(preview.afterAllocation.shopping.shortages).toMatchObject([{ amount: 300 }]);
    expect(await state()).toEqual(before);
  });

  it('explicitly moves a past uncompleted dinner across weeks without automatically consuming stock', async () => {
    const s = await setup();
    vi.setSystemTime(new Date('2026-09-22T09:00:00.000Z'));
    const before = await state();
    const preview = await s.preview();
    expect(preview.beforeAllocation.slots).toMatchObject([
      { date: WEEK, overdue: true, requirements: [{ allocatedAmount: 200 }] },
      { date: '2026-09-22', overdue: false, requirements: [{ allocatedAmount: 100, shortageAmount: 100 }] }
    ]);
    expect(preview.afterAllocation.slots).toMatchObject([
      { date: '2026-09-22', overdue: false, requirements: [{ allocatedAmount: 200 }] },
      { date: NEXT, overdue: false, requirements: [{ allocatedAmount: 100, shortageAmount: 100 }] }
    ]);
    expect(await state()).toEqual(before);
    await s.changes.confirmMealPlanChange(preview);
    const after = await state();
    expect(after.mealPlans[0].confirmed.slots[0]).toMatchObject({ status: 'skipped', components: before.mealPlans[0].confirmed.slots[0].components });
    expect(after.mealPlans[0].archives).toEqual([before.mealPlans[0].confirmed]);
    expect(after.mealPlans[1].confirmed.slots[0].status).toBe('planned');
    for (const store of STORES.filter(name => name !== 'mealPlans')) expect(after[store]).toEqual(before[store]);
  });

  it('retains a past hold while skipping is only a draft and releases it after explicit confirmation', async () => {
    const s = await setup();
    const { allocateMealPlanInventory } = await import('../mealPlanAllocation');
    const { setMealPlanSlotSkipped } = await import('../mealPlanDomain');
    vi.setSystemTime(new Date('2026-09-22T09:00:00.000Z'));
    const before = await state();
    const current = await s.plans.getMealPlan(WEEK);
    const skipped = setMealPlanSlotSkipped(current.confirmed, SLOT, true, { now: '2026-09-22T09:00:00.000Z' });
    const draft = await s.plans.saveMealPlan(skipped, 'guest', current.revision);
    const allocate = async () => allocateMealPlanInventory({ ...await s.plans.getMealPlanningSnapshot(), today: '2026-09-22' });
    expect((await allocate()).slots).toMatchObject([{ overdue: true }, { requirements: [{ allocatedAmount: 100 }] }]);
    await s.plans.confirmMealPlan(WEEK, 'guest', draft.revision);
    const after = await allocate();
    expect(after.slots).toEqual([expect.objectContaining({ date: '2026-09-22', overdue: false, requirements: [expect.objectContaining({ allocatedAmount: 200 })] })]);
    expect(after.shopping.needsReview).toEqual([]);
    const persisted = await state();
    for (const store of STORES.filter(name => name !== 'mealPlans')) expect(persisted[store]).toEqual(before[store]);
  });

  it('releases a past hold after explicit measured cooking and allocates only the actual remainder', async () => {
    const s = await setup();
    const { allocateMealPlanInventory } = await import('../mealPlanAllocation');
    vi.setSystemTime(new Date('2026-09-22T09:00:00.000Z'));
    const stock = (await s.quantities.getInventoryQuantitySnapshot()).inventory[0];
    await s.cooking.recordMealCooking({ scope: 'guest', weekStart: WEEK, slotId: SLOT, operationId: 'past-cooked',
      expectedPlanRevision: 2, usageMode: 'measured', completeUsageConfirmed: true,
      usages: [{ ingredientId: stock.id, expectedRevision: stock.quantityRevision, expectedSourceToken: stock.sourceToken, amount: 150, unit: 'g' }] });
    const snapshot = await s.plans.getMealPlanningSnapshot();
    const result = allocateMealPlanInventory({ ...snapshot, today: '2026-09-22' });
    expect(snapshot.inventory[0].amount).toBe(150);
    expect(result.slots).toEqual([expect.objectContaining({ date: '2026-09-22', overdue: false, requirements: [expect.objectContaining({ allocatedAmount: 150, shortageAmount: 50 })] })]);
    expect(result.shopping.needsReview).toEqual([]);
    expect((await state()).inventoryEvents.map(event => event.kind).sort()).toEqual(['consumption', 'cooking']);
  });

  it('ends a past meal hold after unknown cooking without pretending its stock quantity remains verified', async () => {
    const s = await setup();
    const { allocateMealPlanInventory } = await import('../mealPlanAllocation');
    vi.setSystemTime(new Date('2026-09-22T09:00:00.000Z'));
    const before = await state();
    await s.cooking.recordMealCooking({ scope: 'guest', weekStart: WEEK, slotId: SLOT, operationId: 'past-unknown',
      expectedPlanRevision: 2, usageMode: 'unknown', completeUsageConfirmed: false, usages: [] });
    const snapshot = await s.plans.getMealPlanningSnapshot();
    const result = allocateMealPlanInventory({ ...snapshot, today: '2026-09-22' });
    expect(result.slots).toEqual([expect.objectContaining({ date: '2026-09-22', overdue: false, status: 'needs-review',
      requirements: [expect.objectContaining({ allocatedAmount: 0, shortageAmount: null })] })]);
    expect(result.shopping.needsReview.some(item => item.reason === 'overdue-meal-unconfirmed')).toBe(false);
    expect(result.shopping.needsReview).toContainEqual(expect.objectContaining({ reason: 'inventory-unverified' }));
    const after = await state();
    expect(after.ingredients).toEqual(before.ingredients);
    expect(after.inventoryEvents.map(event => event.kind)).toEqual(['cooking']);
    expect(after.inventoryQuantities[0].status).toBe('unverified');
    for (const store of ['shoppingEntries', 'menuDecisions', 'mealPlanPilot']) expect(after[store]).toEqual(before[store]);
  });

  it('reserves newly received stock conservatively for unresolved past demand but never counts purchase notes as inventory', async () => {
    const s = await setup();
    const shopping = await import('../../shopping/shoppingRepository');
    const { allocateMealPlanInventory } = await import('../mealPlanAllocation');
    await s.review(0);
    vi.setSystemTime(new Date('2026-09-22T09:00:00.000Z'));
    const before = await state();
    const note = await shopping.recordPurchaseNote({ scope: 'guest', operationId: 'buy-after-overdue',
      source: { source: 'manual', sourceId: 'manual:chicken@1', name: '닭고기', quantityText: '200g', context: '직접 입력' },
      actualQuantityText: '500g', memo: '입고 전' });
    const allocate = async () => allocateMealPlanInventory({ ...await s.plans.getMealPlanningSnapshot(), today: '2026-09-22' });
    expect((await allocate()).slots.map(slot => slot.requirements[0].allocatedAmount)).toEqual([0, 0]);
    await shopping.applyPurchaseReceipt({ scope: 'guest', operationId: 'receive-after-overdue', purchaseNoteId: note.id,
      values: { name: '닭고기', quantityText: '500g', quantityStatus: 'verified', amount: 500, unit: 'g', preparationState: 'raw',
        category: '육류', storageType: '냉장', purchaseDate: '2026-09-22', expiryDate: '2026-10-01', memo: '새 입고' } });
    const received = await state();
    const result = await allocate();
    expect(result.slots).toMatchObject([
      { date: WEEK, overdue: true, requirements: [{ allocatedAmount: 200 }] },
      { date: '2026-09-22', overdue: false, requirements: [{ allocatedAmount: 200, shortageAmount: 0 }] }
    ]);
    expect(result.shopping.shortages).toEqual([]);
    expect(result.shopping.needsReview).toContainEqual(expect.objectContaining({ reason: 'overdue-meal-unconfirmed' }));
    expect(received.mealPlans).toEqual(before.mealPlans);
    expect(received.inventoryEvents.map(event => event.kind)).toEqual(['receipt']);
    expect((await s.plans.getMealPlanningSnapshot()).inventory.map(item => item.amount).sort((a, b) => a - b)).toEqual([0, 500]);
    expect(await state()).toEqual(received);
  });

  it('does not allocate stock after a moved meal crosses its expiry date', async () => {
    const s = await setup('guest', { expiryDate: '2026-09-23' });
    const preview = await s.preview();
    expect(preview?.afterAllocation?.slots.find(slot => slot.date === NEXT)).toMatchObject({ status: 'needs-review',
      requirements: [{ allocatedAmount: 0, shortageAmount: null }] });
    expect(preview.afterAllocation.shopping.needsReview).toContainEqual(expect.objectContaining({ date: NEXT, reason: 'inventory-expired' }));
    expect((await s.quantities.getInventoryQuantitySnapshot()).inventory[0].amount).toBe(300);
  });

  it('confirms both weeks together, archives the source and leaves stock and shopping untouched', async () => {
    const s = await setup();
    const shopping = await import('../../shopping/shoppingRepository');
    await shopping.saveManualShoppingItem({ scope: 'guest', id: 'manual:keep', expectedRevision: 0,
      values: { name: '봉투', quantityText: '1개', memo: '보존', checked: false } });
    const before = await state();
    const result = await s.changes.confirmMealPlanChange(await s.preview());
    expect(result?.weekStarts).toEqual([WEEK, NEXT]);
    expect(result.records.map(record => record.revision)).toEqual([3, 1]);
    const source = await s.plans.getMealPlan(WEEK);
    const target = await s.plans.getMealPlan(NEXT);
    expect(source).toMatchObject({ draft: null, revision: 3, archives: [before.mealPlans[0].confirmed] });
    expect(target).toMatchObject({ draft: null, revision: 1, archives: [], confirmed: { slots: [
      expect.objectContaining({ status: 'planned', title: `산술 메뉴 ${WEEK}` }), ...Array.from({ length: 6 }, () => expect.any(Object)),
    ] } });
    const after = await state();
    for (const store of STORES.filter(name => name !== 'mealPlans')) expect(after[store]).toEqual(before[store]);
  });

  it('archives both existing weeks for a swap and preserves all unrelated slots', async () => {
    const s = await setup();
    await s.addWeek(NEXT, [0, 1]);
    const before = await state();
    const preview = await s.preview({ ...s.request, mode: 'swap' });
    await s.changes.confirmMealPlanChange(preview);
    const after = (await state()).mealPlans;
    expect(after.map(record => record.confirmed.slots[0].title)).toEqual([`산술 메뉴 ${NEXT}`, `산술 메뉴 ${WEEK}`]);
    after.forEach((record, index) => {
      expect(record.archives).toEqual([before.mealPlans[index].confirmed]);
      expect(record.confirmed.slots.slice(1)).toEqual(before.mealPlans[index].confirmed.slots.slice(1));
    });
  });

  it('copies both preview requests and confirmation proposals before asynchronous reads', async () => {
    const s = await setup();
    s.request.pantryItems = ['소금'];
    const pending = s.preview();
    s.request.targetDate = '2026-10-05';
    s.request.pantryItems[0] = '후추';
    const preview = await pending;
    expect(preview?.request).toMatchObject({ targetDate: NEXT, pantryItems: ['소금'] });
    const committing = s.changes.confirmMealPlanChange(preview);
    preview.plans[0].slots[1].title = '호출 후 변경';
    await committing;
    expect((await s.plans.getMealPlan(WEEK)).confirmed.slots[1].title).toBe('산술 메뉴 2026-09-22');
  });

  it('recalculates remaining menus from current inventory only after explicit confirmation', async () => {
    const s = await setup();
    const before = await state();
    const preview = await s.preview({ scope: 'guest', weekStart: WEEK, kind: 'readjust', pantryItems: [] });
    expect(preview?.plans).toHaveLength(1);
    expect(preview.changes.length).toBeGreaterThan(0);
    expect(preview.canApply).toBe(true);
    expect(await state()).toEqual(before);
    await s.changes.confirmMealPlanChange(preview);
    expect((await s.plans.getMealPlan(WEEK)).confirmed.slots[0].title).not.toBe(`산술 메뉴 ${WEEK}`);
    expect((await state()).ingredients).toEqual(before.ingredients);
  });

  it('rejects repeated confirmation instead of rearchiving the same proposal', async () => {
    const s = await setup();
    const preview = await s.preview();
    await s.changes.confirmMealPlanChange(preview);
    const committed = await state();
    await expect(s.changes.confirmMealPlanChange(preview)).rejects.toThrow();
    expect(await state()).toEqual(committed);
  });

  it.each([
    ['source draft', async s => { const record = await s.plans.getMealPlan(WEEK); await s.plans.saveMealPlan(record.confirmed, 'guest', record.revision); }],
    ['target draft', async s => { await s.addWeek(NEXT, []); const record = await s.plans.getMealPlan(NEXT); await s.plans.saveMealPlan(record.confirmed, 'guest', record.revision); }],
    ['unconfirmed target', async s => { const { generateMealPlan } = await import('../mealPlanDomain'); await s.plans.saveMealPlan(generateMealPlan({ scope: 'guest', weekStart: NEXT, now: NOW }), 'guest', 0); }],
    ['locked source', async s => { await s.db.runMealCookingTransaction('readwrite', ({ mealPlans }) => { const read = mealPlans.get(`week:${WEEK}`); read.onsuccess = () => { read.result.confirmed.slots[0].locked = true; mealPlans.put(read.result); }; }); }],
  ])('does not discard %s to produce a preview', async (_name, alter) => {
    const s = await setup();
    await alter(s);
    const before = await state();
    await expect(s.preview()).rejects.toThrow();
    expect(await state()).toEqual(before);
  });

  it.each([
    ['invalid scope', { scope: 'guest/other' }], ['foreign scope', { scope: 'user:alice' }],
    ['invalid date', { targetDate: '2026-02-30' }], ['non-Monday source', { weekStart: '2026-09-22' }],
    ['foreign source slot', { slotId: `${NEXT}:dinner` }], ['unsupported kind', { kind: 'delete' }],
    ['unsupported mode', { mode: 'overwrite' }], ['bad pantry', { pantryItems: [null] }],
    ['past destination', { targetDate: '2026-09-20' }],
  ])('rejects %s without changing data', async (_name, change) => {
    const s = await setup();
    const before = await state();
    await expect(s.preview({ ...s.request, ...change })).rejects.toThrow();
    expect(await state()).toEqual(before);
  });

  it.each([
    ['another confirmed week', async s => s.addWeek('2026-10-05', [0])],
    ['new raw stock', async s => s.db.saveIngredient({ ...s.ingredient, id: 'new' })],
    ['quantity review', async s => s.review(250)],
    ['raw quantity', async s => s.db.saveIngredient({ ...s.ingredient, quantity: '반 팩' })],
    ['deleted source', async s => s.plans.clearMealPlans()],
    ['midnight', async () => { vi.setSystemTime(new Date('2026-09-22T09:00:00Z')); }],
  ])('rejects a proposal made before %s changed', async (_name, alter) => {
    const s = await setup();
    const preview = await s.preview();
    await alter(s);
    const changed = await state();
    await expect(s.changes.confirmMealPlanChange(preview)).rejects.toThrow();
    expect(await state()).toEqual(changed);
  });

  it.each([
    ['menu', p => { p.plans[0].slots[1].title = '위조 메뉴'; }],
    ['allocation', p => { p.afterAllocation.shopping.shortages = []; }],
    ['change list', p => { p.changes = []; }],
    ['request', p => { p.request.targetDate = '2026-10-05'; }],
    ['scope', p => { p.scope = 'user:alice'; }],
    ['day', p => { p.today = '2026-09-20'; }],
  ])('rejects mutated %s instead of committing an unreviewed proposal', async (_name, mutate) => {
    const s = await setup();
    const preview = await s.preview();
    expect(preview).toBeTruthy();
    mutate(preview);
    const before = await state();
    await expect(s.changes.confirmMealPlanChange(preview)).rejects.toThrow();
    expect(await state()).toEqual(before);
  });

  it('rolls back the first week when the second write aborts, then permits a fresh confirmation', async () => {
    const s = await setup();
    const preview = await s.preview();
    const before = await state();
    const database = await open();
    const prototype = Object.getPrototypeOf(database.transaction('mealPlans').objectStore('mealPlans'));
    const put = prototype.put;
    let writes = 0;
    const spy = vi.spyOn(prototype, 'put').mockImplementation(function (...args) {
      const request = put.apply(this, args);
      if (this.name === 'mealPlans' && ++writes === 2) this.transaction.abort();
      return request;
    });
    await expect(s.changes.confirmMealPlanChange(preview)).rejects.toThrow();
    expect(writes).toBe(2);
    spy.mockRestore();
    expect(await state()).toEqual(before);
    expect((await s.changes.confirmMealPlanChange(preview)).records).toHaveLength(2);
  });

  it('does not recreate demand in a cleared week with an active cooking record', async () => {
    const s = await setup();
    await s.addWeek(NEXT, [0]);
    await s.cooking.recordMealCooking({ scope: 'guest', weekStart: NEXT, slotId: `${NEXT}:dinner`, operationId: 'target-cooked',
      expectedPlanRevision: 2, usageMode: 'unknown', completeUsageConfirmed: false, usages: [] });
    await s.db.runMealCookingTransaction('readwrite', ({ mealPlans }) => mealPlans.delete(`week:${NEXT}`));
    const before = await state();
    await expect(s.preview()).rejects.toThrow();
    expect(await state()).toEqual(before);
  });

  it('preserves the entire cooked snapshot when changing another dinner', async () => {
    const s = await setup();
    await s.cooking.recordMealCooking({ scope: 'guest', weekStart: WEEK, slotId: SLOT, operationId: 'first-cooked',
      expectedPlanRevision: 2, usageMode: 'unknown', completeUsageConfirmed: false, usages: [] });
    const before = await s.plans.getMealPlan(WEEK);
    const preview = await s.preview({ ...s.request, slotId: '2026-09-22:dinner' });
    await s.changes.confirmMealPlanChange(preview);
    expect((await s.plans.getMealPlan(NEXT))?.confirmed?.slots[0]).toMatchObject({ status: 'planned', title: '산술 메뉴 2026-09-22' });
    expect((await s.plans.getMealPlan(WEEK)).confirmed.slots[0]).toEqual(before.confirmed.slots[0]);
  });

  it.each([
    ['orphan foreign review', stores => stores.quantities.put({ id: 'orphan', schemaVersion: 1, scope: 'user:alice', revision: 1, status: 'unverified' })],
    ['malformed receipt', stores => stores.events.put({ id: 'receipt:bad', kind: 'receipt', scope: 'guest' })],
    ['orphan cooking history', stores => stores.events.put({ id: 'cooking:bad', kind: 'cooking', scope: 'guest' })],
    ['corrupt unrelated archive', stores => { const read = stores.mealPlans.get('week:2026-10-05'); read.onsuccess = () => { read.result.archives = [{}]; stores.mealPlans.put(read.result); }; }],
  ])('rejects %s rather than hiding damaged state', async (_name, damage) => {
    const s = await setup();
    await s.addWeek('2026-10-05', []);
    await s.db.runMealCookingTransaction('readwrite', damage);
    const before = await state();
    await expect(s.preview()).rejects.toThrow();
    expect(await state()).toEqual(before);
  });

  it('keeps authenticated and guest changes separate even with matching record IDs', async () => {
    const guest = await setup();
    const alice = await setup('user:alice');
    const before = await state();
    const preview = await alice.preview();
    expect(preview?.scope).toBe('user:alice');
    await alice.changes.confirmMealPlanChange(preview);
    expect((await alice.plans.getMealPlan(NEXT, 'user:alice')).confirmed.slots[0].status).toBe('planned');
    expect(await state()).toEqual(before);
    expect(await guest.plans.getMealPlan(NEXT)).toBeNull();
  });

  it('archives a same-week move exactly once and preserves a separate locked dinner', async () => {
    const s = await setup();
    await s.db.runMealCookingTransaction('readwrite', ({ mealPlans }) => {
      const read = mealPlans.get(`week:${WEEK}`);
      read.onsuccess = () => { read.result.confirmed.slots[1].locked = true; mealPlans.put(read.result); };
    });
    const before = await s.plans.getMealPlan(WEEK);
    const preview = await s.preview({ ...s.request, targetDate: '2026-09-23' });
    expect(preview.plans).toHaveLength(1);
    const result = await s.changes.confirmMealPlanChange(preview);
    expect(result.weekStarts).toEqual([WEEK]);
    expect(result.records[0].archives).toEqual([before.confirmed]);
    expect(result.records[0].confirmed.slots[1]).toEqual(before.confirmed.slots[1]);
    expect(result.records[0].confirmed.slots[2]).toMatchObject({ status: 'planned', title: `산술 메뉴 ${WEEK}` });
  });

  it('does not accept a no-change proposal as a successful write', async () => {
    const s = await setup();
    const preview = await s.preview({ ...s.request, targetDate: WEEK });
    expect(preview).toMatchObject({ canApply: false, changes: [] });
    const before = await state();
    await expect(s.changes.confirmMealPlanChange(preview)).rejects.toThrow();
    expect(await state()).toEqual(before);
  });

  it('leaves unrelated manual shopping edits intact without unnecessarily invalidating a meal preview', async () => {
    const s = await setup();
    const preview = await s.preview();
    const shopping = await import('../../shopping/shoppingRepository');
    await shopping.saveManualShoppingItem({ scope: 'guest', id: 'manual:after-preview', expectedRevision: 0,
      values: { name: '식기', quantityText: '1개', memo: '따로 기록', checked: false } });
    const before = (await state()).shoppingEntries;
    await s.changes.confirmMealPlanChange(preview);
    expect((await state()).shoppingEntries).toEqual(before);
  });

  it('rejects a valid receipt event added after preview even when the stock itself is unchanged', async () => {
    const s = await setup();
    const shopping = await import('../../shopping/shoppingRepository');
    const note = await shopping.recordPurchaseNote({ scope: 'guest', operationId: 'bought', actualQuantityText: '500g', memo: '',
      source: { source: 'manual', sourceId: 'manual:stock@1', name: '닭고기', quantityText: '500g', context: '직접 입력' } });
    const receipt = await shopping.applyPurchaseReceipt({ scope: 'guest', operationId: 'received', purchaseNoteId: note.id,
      values: { name: '닭고기', quantityText: '500g', quantityStatus: 'verified', amount: 500, unit: 'g', preparationState: 'raw',
        purchaseDate: WEEK, expiryDate: '2026-10-30', category: '육류', storageType: '냉장', memo: '' } });
    await s.db.runMealCookingTransaction('readwrite', ({ events }) => events.delete(receipt.id));
    const preview = await s.preview();
    await s.db.runMealCookingTransaction('readwrite', ({ events }) => events.put(receipt));
    const before = await state();
    await expect(s.changes.confirmMealPlanChange(preview)).rejects.toThrow();
    expect(await state()).toEqual(before);
  });

  it('reads plans and inventory from one committed version when another transaction is queued between reads', async () => {
    const s = await setup();
    const database = await open();
    const prototype = Object.getPrototypeOf(database.transaction('ingredients').objectStore('ingredients'));
    const getAll = prototype.getAll;
    let queued;
    const spy = vi.spyOn(prototype, 'getAll').mockImplementation(function (...args) {
      const read = getAll.apply(this, args);
      if (this.name === 'ingredients' && !queued) queued = new Promise((resolve, reject) => {
        const transaction = database.transaction(['ingredients', 'mealPlans'], 'readwrite');
        transaction.objectStore('ingredients').put({ ...s.ingredient, quantity: '반 팩' });
        const plan = transaction.objectStore('mealPlans').get(`week:${WEEK}`);
        plan.onsuccess = () => {
          plan.result.confirmed.slots[1].title = '다른 탭에서 바꾼 메뉴';
          transaction.objectStore('mealPlans').put(plan.result);
        };
        transaction.oncomplete = resolve;
        transaction.onabort = () => reject(transaction.error);
      });
      return read;
    });
    const preview = await s.preview();
    expect(preview.beforeAllocation.slots[0].requirements[0].allocatedAmount).toBe(200);
    expect(preview.plans[0].slots[1].title).toBe('산술 메뉴 2026-09-22');
    await queued;
    spy.mockRestore();
    await expect(s.changes.confirmMealPlanChange(preview)).rejects.toThrow();
    const current = await s.preview();
    expect(current.plans[0].slots[1].title).toBe('다른 탭에서 바꾼 메뉴');
    expect(current.beforeAllocation.slots[0].requirements[0].allocatedAmount).toBe(0);
  });

  it('rejects a read transaction aborted after its final request rather than returning a successful preview', async () => {
    const s = await setup();
    const before = await state();
    const database = await open();
    const prototype = Object.getPrototypeOf(database.transaction('inventoryEvents').objectStore('inventoryEvents'));
    const getAll = prototype.getAll;
    const spy = vi.spyOn(prototype, 'getAll').mockImplementation(function (...args) {
      const read = getAll.apply(this, args);
      if (this.name === 'inventoryEvents') read.addEventListener('success', () => this.transaction.abort());
      return read;
    });
    await expect(s.preview()).rejects.toThrow();
    spy.mockRestore();
    expect(await state()).toEqual(before);
    expect((await s.preview()).canApply).toBe(true);
  });

  it.each([
    ['missing cooking event', cooking => { cooking.id = 'cooking:missing'; }],
    ['incorrect cooking timestamp', cooking => { cooking.recordedAt = '2026-09-21T08:00:00.000Z'; }],
    ['invented consumption', cooking => { cooking.inventoryStatus = 'applied'; cooking.consumptionId = 'consumption:invented'; }],
  ])('rejects a confirmed cooked slot with %s before changing another week', async (_name, damage) => {
    const s = await setup();
    await s.addWeek('2026-10-05', [0]);
    await s.cooking.recordMealCooking({ scope: 'guest', weekStart: '2026-10-05', slotId: '2026-10-05:dinner',
      operationId: 'future-cooked', expectedPlanRevision: 2, usageMode: 'unknown', completeUsageConfirmed: false, usages: [] });
    await s.db.runMealCookingTransaction('readwrite', ({ mealPlans }) => {
      const read = mealPlans.get('week:2026-10-05');
      read.onsuccess = () => { damage(read.result.confirmed.slots[0].cooking); mealPlans.put(read.result); };
    });
    const before = await state();
    await expect(s.preview()).rejects.toThrow();
    expect(await state()).toEqual(before);
  });

  it.each(['move', 'readjust'])('rejects a cancelled cooking event still shown as cooked before %s', async kind => {
    const s = await setup();
    await s.cooking.recordMealCooking({ scope: 'guest', weekStart: WEEK, slotId: SLOT, operationId: 'first',
      expectedPlanRevision: 2, usageMode: 'unknown', completeUsageConfirmed: false, usages: [] });
    const cooked = (await s.plans.getMealPlan(WEEK)).confirmed.slots[0];
    await s.cooking.cancelMealCooking({ scope: 'guest', weekStart: WEEK, slotId: SLOT, operationId: 'cancel',
      cookingId: 'cooking:first', expectedPlanRevision: 3 });
    await s.db.runMealCookingTransaction('readwrite', ({ mealPlans }) => {
      const read = mealPlans.get(`week:${WEEK}`);
      read.onsuccess = () => { read.result.confirmed.slots[0] = cooked; mealPlans.put(read.result); };
    });
    const before = await state();
    await expect(s.preview(kind === 'move' ? { ...s.request, slotId: '2026-09-22:dinner' }
      : { scope: 'guest', weekStart: WEEK, kind, pantryItems: [] })).rejects.toThrow();
    expect(await state()).toEqual(before);
  });

  it('rejects a reversed consumption still shown as applied before changing another meal', async () => {
    const s = await setup();
    let row = (await s.quantities.getInventoryQuantitySnapshot()).inventory[0];
    await s.cooking.recordMealCooking({ scope: 'guest', weekStart: WEEK, slotId: SLOT, operationId: 'actual',
      expectedPlanRevision: 2, usageMode: 'measured', completeUsageConfirmed: true,
      usages: [{ ingredientId: row.id, amount: 150, unit: 'g', expectedRevision: row.quantityRevision, expectedSourceToken: row.sourceToken }] });
    const applied = (await s.plans.getMealPlan(WEEK)).confirmed.slots[0];
    row = (await s.quantities.getInventoryQuantitySnapshot()).inventory[0];
    await s.cooking.reverseMealConsumption({ scope: 'guest', weekStart: WEEK, slotId: SLOT, operationId: 'undo-stock',
      cookingId: 'cooking:actual', expectedPlanRevision: 3,
      inventory: [{ ingredientId: row.id, expectedRevision: row.quantityRevision, expectedSourceToken: row.sourceToken }] });
    await s.db.runMealCookingTransaction('readwrite', ({ mealPlans }) => {
      const read = mealPlans.get(`week:${WEEK}`);
      read.onsuccess = () => { read.result.confirmed.slots[0] = applied; mealPlans.put(read.result); };
    });
    const before = await state();
    await expect(s.preview({ ...s.request, slotId: '2026-09-22:dinner' })).rejects.toThrow();
    expect(await state()).toEqual(before);
  });

  it.each(['move', 'readjust'])('preserves a corrected consumption leaf when approving a %s of another dinner', async kind => {
    const s = await setup();
    await seedCorrectedCooking(s);
    const before = await state();
    const request = kind === 'move' ? { ...s.request, slotId: '2026-09-22:dinner' }
      : { scope: 'guest', weekStart: WEEK, kind, pantryItems: [] };
    const pending = s.preview(request);
    await expect(pending).resolves.toMatchObject({ canApply: true });
    const preview = await pending;
    expect(preview.plans[0].slots[0].cooking).toEqual({ id: 'cooking:actual', recordedAt: NOW,
      inventoryStatus: 'applied', consumptionId: 'consumption:corrected', reversalId: null });
    expect(await state()).toEqual(before);
    await s.changes.confirmMealPlanChange(preview);
    const after = await state();
    expect(after.mealPlans[0].confirmed.slots[0]).toEqual(before.mealPlans[0].confirmed.slots[0]);
    expect(after.mealPlans[0].archives.at(-1)).toEqual(before.mealPlans[0].confirmed);
    for (const store of STORES.filter(name => name !== 'mealPlans')) expect(after[store]).toEqual(before[store]);
    expect(after.inventoryEvents.find(event => event.id === 'cooking:actual').consumptionId).toBe('consumption:actual');
  });

  it.each(['move', 'readjust'])('requires a fresh %s preview after the real usage-correction command commits', async kind => {
    const s = await setup();
    let row = (await s.quantities.getInventoryQuantitySnapshot()).inventory[0];
    await s.cooking.recordMealCooking({ scope: 'guest', weekStart: WEEK, slotId: SLOT, operationId: 'actual',
      expectedPlanRevision: 2, usageMode: 'measured', completeUsageConfirmed: true,
      usages: [{ ingredientId: row.id, amount: 150, unit: 'g', expectedRevision: row.quantityRevision, expectedSourceToken: row.sourceToken }] });
    const request = kind === 'move' ? { ...s.request, slotId: '2026-09-22:dinner' }
      : { scope: 'guest', weekStart: WEEK, kind, pantryItems: [] };
    const oldPreview = await s.preview(request);
    row = (await s.quantities.getInventoryQuantitySnapshot()).inventory[0];
    const check = { ingredientId: row.id, expectedRevision: row.quantityRevision, expectedSourceToken: row.sourceToken };
    await s.cooking.correctMealConsumption({ scope: 'guest', weekStart: WEEK, slotId: SLOT, operationId: 'corrected',
      cookingId: 'cooking:actual', expectedPlanRevision: 3, expectedConsumptionId: 'consumption:actual',
      completeUsageConfirmed: true, inventory: [check], usages: [{ ...check, amount: 100, unit: 'g' }] });
    const corrected = await state();
    expect((await s.quantities.getInventoryQuantitySnapshot()).inventory[0]).toMatchObject({ amount: 200, quantityStatus: 'verified' });
    await expect(s.changes.confirmMealPlanChange(oldPreview)).rejects.toThrow();
    expect(await state()).toEqual(corrected);
    const fresh = await s.preview(request);
    expect(fresh).toMatchObject({ canApply: true });
    await s.changes.confirmMealPlanChange(fresh);
    const after = await state();
    expect(after.mealPlans[0].confirmed.slots[0].cooking).toEqual({ id: 'cooking:actual', recordedAt: NOW,
      consumptionId: 'consumption:corrected', inventoryStatus: 'applied', reversalId: null });
    for (const store of STORES.filter(name => name !== 'mealPlans')) expect(after[store]).toEqual(corrected[store]);
  });

  it.each(['move', 'readjust'])('preserves the terminal inverse of a corrected consumption when approving a %s', async kind => {
    const s = await setup();
    await seedCorrectedCooking(s, { reversed: true });
    const before = await state();
    const pending = s.preview(kind === 'move' ? { ...s.request, slotId: '2026-09-22:dinner' }
      : { scope: 'guest', weekStart: WEEK, kind, pantryItems: [] });
    await expect(pending).resolves.toMatchObject({ canApply: true });
    const preview = await pending;
    expect(preview.plans[0].slots[0].cooking).toEqual({ id: 'cooking:actual', recordedAt: NOW,
      inventoryStatus: 'reversed', consumptionId: 'consumption:corrected', reversalId: 'consumption-reversal:terminal' });
    await s.changes.confirmMealPlanChange(preview);
    const after = await state();
    expect(after.mealPlans[0].confirmed.slots[0]).toEqual(before.mealPlans[0].confirmed.slots[0]);
    for (const store of STORES.filter(name => name !== 'mealPlans')) expect(after[store]).toEqual(before[store]);
  });

  it.each([
    ['superseded consumption and its correction inverse', false, {
      consumptionId: 'consumption:actual', inventoryStatus: 'reversed', reversalId: 'consumption-reversal:corrected',
    }],
    ['superseded consumption after a terminal inverse', true, {
      consumptionId: 'consumption:actual', inventoryStatus: 'reversed', reversalId: 'consumption-reversal:terminal',
    }],
    ['replacement treated as reversed by its internal correction inverse', false, {
      consumptionId: 'consumption:corrected', inventoryStatus: 'reversed', reversalId: 'consumption-reversal:corrected',
    }],
    ['terminally reversed replacement still marked applied', true, {
      consumptionId: 'consumption:corrected', inventoryStatus: 'applied', reversalId: null,
    }],
  ])('rejects a cooked slot pointing to %s without changing any stores', async (_label, reversed, damage) => {
    const s = await setup();
    await seedCorrectedCooking(s, { reversed });
    await s.db.runMealCookingTransaction('readwrite', ({ mealPlans }) => {
      const read = mealPlans.get(`week:${WEEK}`);
      read.onsuccess = () => {
        Object.assign(read.result.confirmed.slots[0].cooking, damage);
        mealPlans.put(read.result);
      };
    });
    const before = await state();
    await expect(s.preview({ ...s.request, slotId: '2026-09-22:dinner' })).rejects.toThrow('조리 상태');
    expect(await state()).toEqual(before);
  });

  it('does not silently reallocate an active cooked dinner disguised as planned in an unrelated confirmed week', async () => {
    const s = await setup();
    await s.addWeek('2026-10-05', [0]);
    await s.cooking.recordMealCooking({ scope: 'guest', weekStart: '2026-10-05', slotId: '2026-10-05:dinner',
      operationId: 'future-cooked', expectedPlanRevision: 2, usageMode: 'unknown', completeUsageConfirmed: false, usages: [] });
    await s.db.runMealCookingTransaction('readwrite', ({ mealPlans }) => {
      const read = mealPlans.get('week:2026-10-05');
      read.onsuccess = () => {
        const slot = read.result.confirmed.slots[0];
        delete slot.cooking;
        slot.status = 'planned';
        mealPlans.put(read.result);
      };
    });
    const before = await state();
    await expect(s.preview()).rejects.toThrow();
    expect(await state()).toEqual(before);
  });

  it.each(['move', 'readjust'])('does not approve a %s proposal retaining another locked meal with an exclusion conflict', async kind => {
    const s = await setup();
    // Legacy confirmed states stay readable. A new approval must not perpetuate
    // this previously accepted conflict merely because that meal is locked.
    await s.db.runMealCookingTransaction('readwrite', ({ mealPlans }) => {
      const read = mealPlans.get(`week:${WEEK}`);
      read.onsuccess = () => {
        const plan = read.result.confirmed;
        plan.preferences.excludedIngredients = ['계란'];
        plan.slots[1].locked = true;
        plan.slots[1].components[0].ingredients[0].rawName = '달걀';
        plan.slots[1].components[0].ingredients[0].normalizedName = '계란';
        mealPlans.put(read.result);
      };
    });
    const before = await state();
    expect((await s.plans.getMealPlan(WEEK)).confirmed.slots[1].locked).toBe(true);
    await expect(s.preview(kind === 'move' ? s.request
      : { scope: 'guest', weekStart: WEEK, kind, pantryItems: [] })).rejects.toThrow('제외');
    expect(await state()).toEqual(before);
  });
});
