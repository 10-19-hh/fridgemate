import FDBFactory from 'fake-indexeddb/lib/FDBFactory';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const NOW = '2026-09-21T09:00:00.000Z';
const WEEK = '2026-09-21';
const SLOT = `${WEEK}:dinner`;

async function setup(scope = 'guest', initialAmount = 150) {
  const db = await import('../../../db/indexedDB');
  const plans = await import('../mealPlanRepository');
  const quantities = await import('../inventoryQuantityRepository');
  const cooking = await import('../mealCookingRepository');
  const shopping = await import('../../shopping/shoppingRepository');
  const { generateMealPlan } = await import('../mealPlanDomain');
  const ingredient = { id: 'chicken', name: '닭고기', quantity: '300g', consumed: false, memo: '원본 메모',
    category: '육류', storageType: '냉장', expiryDate: '2026-09-30', createdAt: NOW, updatedAt: NOW, syncState: 'synced' };
  await db.saveIngredient(ingredient, scope);
  async function confirmAmount(id, amount, values = {}) {
    const row = (await quantities.getInventoryQuantitySnapshot(scope)).inventory.find(item => item.id === id);
    return quantities.saveInventoryQuantity({ scope, ingredientId: id, expectedRevision: row.quantityRevision,
      expectedSourceToken: row.sourceToken, values: { name: row.name, amount, unit: 'g', preparationState: 'raw', ...values } });
  }
  await confirmAmount('chicken', 300);
  const plan = generateMealPlan({ scope, weekStart: WEEK, preferences: { servings: 1, dinnerDays: [0, 1], excludedIngredients: [] }, now: NOW });
  const original = plan.slots[0].components[0];
  for (const slot of plan.slots.filter(item => item.status === 'planned')) slot.components = [{
    ...structuredClone(original), servings: 1, servingsStatus: 'verified', processInputs: [], ingredients: [{
      ...original.ingredients[0], id: 'chicken-line', rawName: '닭고기', normalizedName: '닭고기',
      ingredientKey: 'food:닭고기', amount: 200, unit: 'g', preparationState: 'raw', quantityStatus: 'verified',
      quantityEvidence: 'test:measured', selected: true, optional: false,
    }],
  }];
  await plans.saveMealPlan(plan, scope, 0);
  await plans.confirmMealPlan(WEEK, scope, 1);
  const rows = async () => (await quantities.getInventoryQuantitySnapshot(scope)).inventory;
  const check = row => ({ ingredientId: row.id, expectedRevision: row.quantityRevision, expectedSourceToken: row.sourceToken });
  const row = (await rows())[0];
  await cooking.recordMealCooking({ scope, weekStart: WEEK, slotId: SLOT, operationId: 'original', expectedPlanRevision: 2,
    usageMode: 'measured', completeUsageConfirmed: true, usages: [{ ...check(row), amount: initialAmount, unit: 'g' }] });
  async function raw() {
    return db.runMealCookingTransaction('readonly', stores => {
      const result = { result: undefined };
      const keys = ['ingredients', 'quantities', 'mealPlans', 'events'];
      const reads = keys.map(key => stores[key].getAll());
      let remaining = reads.length;
      for (const read of reads) read.onsuccess = () => {
        if (--remaining === 0) result.result = Object.fromEntries(keys.map((key, index) => [key, reads[index].result]));
      };
      return result;
    }, scope);
  }
  async function correction(operationId = 'correct-one', previous = 'consumption:original', amounts = [['chicken', 100, 'g']]) {
    const state = await raw();
    const stock = await rows();
    const originalConsumption = state.events.find(event => event.id === previous);
    return { scope, weekStart: WEEK, slotId: SLOT, cookingId: 'cooking:original', operationId,
      expectedPlanRevision: state.mealPlans[0]?.revision ?? 0, expectedConsumptionId: previous, completeUsageConfirmed: true,
      inventory: originalConsumption.lines.map(line => check(stock.find(item => item.id === line.inventoryId))),
      usages: amounts.map(([id, amount, unit]) => ({ ...check(stock.find(item => item.id === id)), amount, unit })) };
  }
  async function receive() {
    const note = await shopping.recordPurchaseNote({ scope, operationId: 'later-note', actualQuantityText: '500g', memo: '',
      source: { source: 'manual', sourceId: 'manual:later@1', name: '닭고기', quantityText: '500g', context: '직접 구매' } });
    return shopping.applyPurchaseReceipt({ scope, operationId: 'later-receipt', purchaseNoteId: note.id,
      values: { name: '닭고기', quantityText: '500g', quantityStatus: 'verified', amount: 500, unit: 'g', preparationState: 'raw',
        purchaseDate: WEEK, expiryDate: '2026-09-30', category: '육류', storageType: '냉장', memo: '새 입고 보존' } });
  }
  async function correct(input = null) {
    expect(cooking.correctMealConsumption).toBeTypeOf('function');
    return cooking.correctMealConsumption(input || await correction());
  }
  return { db, plans, quantities, cooking, shopping, ingredient, plan, raw, rows, check, correction, receive, correct, confirmAmount };
}

describe('atomic correction of actual meal consumption', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(NOW));
    Object.defineProperty(window, 'indexedDB', { configurable: true, value: new FDBFactory() });
  });
  afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

  it('changes actual 150g to 100g atomically, preserving a later 500g receipt and the cooking fact', async () => {
    const s = await setup();
    await s.receive();
    const before = await s.raw();
    const result = await s.correct();
    const stock = await s.rows();
    expect(stock.find(item => item.id === 'chicken')).toMatchObject({ amount: 200, quantityStatus: 'verified', memo: '원본 메모' });
    expect(stock.reduce((sum, item) => sum + item.amount, 0)).toBe(700);
    const after = await s.raw();
    expect(after.ingredients.find(item => item.id === 'receipt-later-receipt')).toStrictEqual(before.ingredients.find(item => item.id === 'receipt-later-receipt'));
    expect(after.events.filter(event => ['receipt', 'cooking'].includes(event.kind))).toStrictEqual(before.events.filter(event => ['receipt', 'cooking'].includes(event.kind)));
    expect(after.events.find(event => event.id === 'consumption:original')).toStrictEqual(before.events.find(event => event.id === 'consumption:original'));
    expect(result.event).toMatchObject({ id: 'consumption:correct-one', kind: 'consumption', cookingId: 'cooking:original', replacesId: 'consumption:original', lines: [{ amount: 100, unit: 'g' }] });
    expect(after.events.find(event => event.id === 'consumption-reversal:correct-one')).toMatchObject({ reversesId: 'consumption:original', replacementConsumptionId: result.event.id, lines: [{ amount: 150 }] });
    expect(after.mealPlans[0]).toMatchObject({ revision: 4, confirmed: { slots: [expect.objectContaining({ status: 'cooked', cooking: {
      id: 'cooking:original', recordedAt: NOW, inventoryStatus: 'applied', consumptionId: 'consumption:correct-one', reversalId: null,
    } }), ...before.mealPlans[0].confirmed.slots.slice(1)] } });
    const { allocateMealPlanInventory } = await import('../mealPlanAllocation');
    const allocation = allocateMealPlanInventory({ ...await s.plans.getMealPlanningSnapshot(), today: WEEK });
    expect(allocation.slots).toHaveLength(1);
    expect(allocation.shopping.shortages).toEqual([]);
    expect(allocation.shopping.needsReview).toEqual([]);
  });

  it('replays identical and concurrent requests once and rejects reuse with a changed amount', async () => {
    const s = await setup();
    const request = await s.correction();
    const [one, two, otherTab] = await Promise.all([s.correct(request), s.correct(request), s.correct({ ...request, operationId: 'other-tab' })]);
    expect(two.event).toStrictEqual(one.event);
    expect(otherTab.event).toStrictEqual(one.event);
    expect((await s.rows())[0].amount).toBe(200);
    expect((await s.raw()).events).toHaveLength(4);
    const after = await s.raw();
    await expect(s.correct({ ...request, usages: [{ ...request.usages[0], amount: 99 }] })).rejects.toThrow();
    expect(await s.raw()).toStrictEqual(after);
  });

  it('corrects a second time then reverses only the latest consumption before cancelling cooking', async () => {
    const s = await setup();
    await s.correct();
    await s.correct(await s.correction('correct-two', 'consumption:correct-one', [['chicken', 120, 'g']]));
    expect((await s.rows())[0].amount).toBe(180);
    const input = await s.correction('reverse-latest', 'consumption:correct-two');
    await expect(s.cooking.cancelMealCooking({ ...input, operationId: 'premature-cancel' })).rejects.toThrow();
    const result = await s.cooking.reverseMealConsumption(input);
    expect(result.event).toMatchObject({ reversesId: 'consumption:correct-two', lines: [{ amount: 120 }] });
    expect((await s.rows())[0]).toMatchObject({ quantity: '300g', quantityStatus: 'unverified', amount: null });
    const record = await s.plans.getMealPlan(WEEK);
    await s.cooking.cancelMealCooking({ ...input, operationId: 'cancel-latest', expectedPlanRevision: record.revision });
    expect((await s.plans.getMealPlan(WEEK)).confirmed.slots[0].status).toBe('planned');
    expect((await s.cooking.getMealCookingWorkspace()).history).toHaveLength(8);
  });

  it('allows confirmed zero usage and a later correction without recreating a cooking fact', async () => {
    const s = await setup();
    await s.correct(await s.correction('zero', 'consumption:original', []));
    expect((await s.rows())[0].amount).toBe(300);
    expect((await s.raw()).events.find(event => event.id === 'consumption:zero').lines).toEqual([]);
    await s.correct(await s.correction('after-zero', 'consumption:zero', [['chicken', 80, 'g']]));
    expect((await s.rows())[0].amount).toBe(220);
    expect((await s.raw()).events.filter(event => event.kind === 'cooking')).toHaveLength(1);
  });

  it('can reverse a zero-usage correction and cancel cooking without changing stock', async () => {
    const s = await setup();
    await s.correct(await s.correction('zero', 'consumption:original', []));
    const input = await s.correction('reverse-zero', 'consumption:zero', []);
    const before = await s.rows();
    await s.cooking.reverseMealConsumption(input);
    expect(await s.rows()).toStrictEqual(before);
    await s.cooking.cancelMealCooking({ ...input, operationId: 'cancel-zero', expectedPlanRevision: 5 });
    expect((await s.plans.getMealPlan(WEEK)).confirmed.slots[0].status).toBe('planned');
  });

  it('restores a fully consumed zero balance before applying an increased amount within the restored balance', async () => {
    const s = await setup('guest', 300);
    await s.correct(await s.correction('from-zero', 'consumption:original', [['chicken', 250, 'g']]));
    expect((await s.rows())[0].amount).toBe(50);
  });

  it('moves actual usage between batches while preserving independent later stock', async () => {
    const s = await setup();
    await s.receive();
    await s.correct(await s.correction('other-stock', 'consumption:original', [['receipt-later-receipt', 100, 'g']]));
    expect((await s.rows()).map(item => [item.id, item.amount]).sort()).toEqual([['chicken', 300], ['receipt-later-receipt', 400]]);
    expect((await s.cooking.getMealCookingWorkspace()).history).toHaveLength(4);
  });

  it('corrects from surviving history after plan deletion without recreating a plan', async () => {
    const s = await setup();
    await s.plans.clearMealPlans();
    const input = await s.correction();
    const result = await s.correct(input);
    expect(result.record).toBeNull();
    expect((await s.raw()).mealPlans).toEqual([]);
    expect((await s.rows())[0].amount).toBe(200);
    expect((await s.correct(input)).event).toStrictEqual(result.event);
  });

  it('copies the request before any asynchronous read', async () => {
    const s = await setup();
    const input = await s.correction();
    expect(s.cooking.correctMealConsumption).toBeTypeOf('function');
    const promise = s.cooking.correctMealConsumption(input);
    input.usages[0].amount = 299;
    input.inventory.length = 0;
    await promise;
    expect((await s.rows())[0].amount).toBe(200);
  });

  it.each([
    ['old plan', input => { input.expectedPlanRevision = 2; }],
    ['old consumption', input => { input.expectedConsumptionId = 'consumption:missing'; }],
    ['old stock proof', input => { input.inventory[0].expectedRevision = 1; }],
    ['different new stock proof', input => { input.usages[0].expectedSourceToken = 'changed'; }],
    ['missing old batch', input => { input.inventory = []; }],
    ['duplicate old batch', input => { input.inventory.push({ ...input.inventory[0] }); }],
    ['duplicate new batch', input => { input.usages.push({ ...input.usages[0] }); }],
    ['incompatible unit', input => { input.usages[0].unit = 'ml'; }],
    ['negative usage', input => { input.usages[0].amount = -1; }],
    ['unsupported precision', input => { input.usages[0].amount = 0.0001; }],
    ['amount above restored balance', input => { input.usages[0].amount = 301; }],
    ['unconfirmed completeness', input => { input.completeUsageConfirmed = false; }],
    ['wrong scope', input => { input.scope = 'user:other'; }],
    ['wrong meal', input => { input.slotId = '2026-09-22:dinner'; }],
  ])('rejects %s without saving any part', async (_label, change) => {
    const s = await setup();
    expect(s.cooking.correctMealConsumption).toBeTypeOf('function');
    const input = await s.correction();
    const before = await s.raw();
    change(input);
    await expect(s.cooking.correctMealConsumption(input)).rejects.toThrow();
    expect(await s.raw()).toStrictEqual(before);
  });

  it('rejects stale requests after another stock edit, even without a plan', async () => {
    const s = await setup();
    await s.plans.clearMealPlans();
    const input = await s.correction();
    const stock = (await s.db.getAllIngredients())[0];
    await s.db.saveIngredient({ ...stock, quantity: '400g', updatedAt: '2026-09-22T09:00:00.000Z' });
    const before = await s.raw();
    expect(s.cooking.correctMealConsumption).toBeTypeOf('function');
    await expect(s.cooking.correctMealConsumption(input)).rejects.toThrow();
    expect(await s.raw()).toStrictEqual(before);
  });

  it('does not correct an already reversed or cancelled consumption', async () => {
    const s = await setup();
    expect(s.cooking.correctMealConsumption).toBeTypeOf('function');
    const correction = await s.correction();
    await s.cooking.reverseMealConsumption({ ...correction, operationId: 'standalone-reverse' });
    const before = await s.raw();
    await expect(s.cooking.correctMealConsumption(correction)).rejects.toThrow();
    expect(await s.raw()).toStrictEqual(before);
  });

  it('isolates identical operation ids between guest and authenticated scopes', async () => {
    const guest = await setup();
    const alice = await setup('user:alice');
    await guest.correct();
    expect((await alice.rows())[0].amount).toBe(150);
    await alice.correct(await alice.correction('correct-one', 'consumption:original', [['chicken', 120, 'g']]));
    expect((await guest.rows())[0].amount).toBe(200);
    expect((await alice.rows())[0].amount).toBe(180);
  });

  it('applies only the net delta to a later verified increase and retains later metadata', async () => {
    const s = await setup();
    const current = (await s.db.getAllIngredients())[0];
    await s.db.saveIngredient({ ...current, quantity: '650g', memo: '나중에 수정한 메모' });
    await s.confirmAmount('chicken', 650);
    await s.correct();
    expect((await s.rows())[0]).toMatchObject({ amount: 700, memo: '나중에 수정한 메모', quantityStatus: 'verified' });
  });

  it('can increase recorded usage above current stock when the atomic inverse supplies the difference', async () => {
    const s = await setup();
    await s.correct(await s.correction('increase', 'consumption:original', [['chicken', 0.25, 'kg']]));
    expect((await s.rows())[0].amount).toBe(50);
    expect((await s.raw()).events.find(event => event.id === 'consumption:increase').lines[0]).toMatchObject({ amount: 250, unit: 'g' });
  });

  it('preserves all other planned demand and draft edits when updating a matching cooked slot', async () => {
    const s = await setup();
    const record = await s.plans.getMealPlan(WEEK);
    const draft = structuredClone(record.confirmed);
    draft.slots[1].locked = true;
    await s.plans.saveMealPlan(draft, 'guest', record.revision);
    const before = await s.raw();
    await s.correct();
    const after = (await s.raw()).mealPlans[0];
    expect(after.draft.slots[1]).toStrictEqual(before.mealPlans[0].draft.slots[1]);
    expect(after.confirmed.slots.slice(1)).toStrictEqual(before.mealPlans[0].confirmed.slots.slice(1));
    expect(after.archives).toStrictEqual(before.mealPlans[0].archives);
    expect(after.draft.slots[0].cooking).toStrictEqual(after.confirmed.slots[0].cooking);
  });

  it('rejects a conflicting cooked draft without saving the inverse or replacement', async () => {
    const s = await setup();
    const record = await s.plans.getMealPlan(WEEK);
    record.draft = structuredClone(record.confirmed);
    record.draft.slots[0].title = '다른 메뉴';
    await s.db.runMealPlanTransaction('readwrite', store => store.put(record));
    const before = await s.raw();
    await expect(s.correct()).rejects.toThrow(/초안/);
    expect(await s.raw()).toStrictEqual(before);
  });

  it('acknowledges an old correction after a later correction without changing the latest state', async () => {
    const s = await setup();
    const input = await s.correction();
    const first = await s.correct(input);
    await s.correct(await s.correction('latest', first.event.id, [['chicken', 120, 'g']]));
    const before = await s.raw();
    expect((await s.correct(input)).event).toStrictEqual(first.event);
    expect(await s.raw()).toStrictEqual(before);
  });

  it.each([
    ['changed identity', { name: '소고기' }],
    ['changed preparation', { preparationState: 'cooked' }],
    ['changed unit dimension', { unit: 'ml' }],
  ])('rejects a currently verified old batch with %s instead of applying an incompatible inverse', async (_label, values) => {
    const s = await setup();
    await s.confirmAmount('chicken', 150, values);
    const before = await s.raw();
    await expect(s.correct()).rejects.toThrow();
    expect(await s.raw()).toStrictEqual(before);
  });

  it('rejects a stale latest-consumption reference for reversal even after plan deletion', async () => {
    const s = await setup();
    await s.correct();
    await s.plans.clearMealPlans();
    const latest = await s.correction('reverse-new', 'consumption:correct-one');
    const before = await s.raw();
    await expect(s.cooking.reverseMealConsumption({ ...latest, expectedConsumptionId: 'consumption:original' })).rejects.toThrow();
    const { expectedConsumptionId: _omitted, ...legacy } = latest;
    await expect(s.cooking.reverseMealConsumption(legacy)).rejects.toThrow();
    expect(await s.raw()).toStrictEqual(before);
  });

  it('rolls back if the replacement event fails after the inverse event was successfully written', async () => {
    const s = await setup();
    const before = await s.raw();
    let prototype;
    await s.db.runMealCookingTransaction('readonly', stores => { prototype = Object.getPrototypeOf(stores.events); return stores.events.getAll(); });
    const add = prototype.add;
    const seen = [];
    const spy = vi.spyOn(prototype, 'add').mockImplementation(function (value, ...args) {
      const request = add.call(this, value, ...args);
      if (this.name === 'inventoryEvents') request.addEventListener('success', () => {
        seen.push(value.id);
        if (value.id === 'consumption:correct-one') this.transaction.abort();
      });
      return request;
    });
    await expect(s.correct()).rejects.toThrow();
    expect(seen).toEqual(['consumption-reversal:correct-one', 'consumption:correct-one']);
    expect(await s.raw()).toStrictEqual(before);
    spy.mockRestore();
    await s.correct();
    expect((await s.rows())[0].amount).toBe(200);
  });

  it.each([
    ['old consumption pointer', slot => { slot.cooking.consumptionId = 'consumption:original'; }],
    ['false reversed status', slot => { slot.cooking.inventoryStatus = 'reversed'; slot.cooking.reversalId = 'consumption-reversal:correct-one'; }],
    ['lost cooking status', slot => { slot.status = 'planned'; delete slot.cooking; }],
  ])('rejects reversing corrected consumption when the stored slot has %s', async (_label, damage) => {
    const s = await setup();
    await s.correct();
    const record = await s.plans.getMealPlan(WEEK);
    damage(record.confirmed.slots[0]);
    await s.db.runMealPlanTransaction('readwrite', store => store.put(record));
    const input = await s.correction('reverse-damaged', 'consumption:correct-one');
    const before = await s.raw();
    await expect(s.cooking.reverseMealConsumption(input)).rejects.toThrow();
    expect(await s.raw()).toStrictEqual(before);
  });

  it('does not cancel a corrected cooking fact through a mismatched final inverse pointer', async () => {
    const s = await setup();
    await s.correct();
    await s.cooking.reverseMealConsumption(await s.correction('final-inverse', 'consumption:correct-one'));
    const record = await s.plans.getMealPlan(WEEK);
    record.confirmed.slots[0].cooking.reversalId = 'consumption-reversal:correct-one';
    await s.db.runMealPlanTransaction('readwrite', store => store.put(record));
    const before = await s.raw();
    await expect(s.cooking.cancelMealCooking({ scope: 'guest', weekStart: WEEK, slotId: SLOT,
      expectedPlanRevision: record.revision, cookingId: 'cooking:original', operationId: 'cancel-damaged' })).rejects.toThrow();
    expect(await s.raw()).toStrictEqual(before);
  });

  it.each(['ingredients', 'inventoryQuantities', 'mealPlans', 'inventoryEvents'])('rolls back a completed %s write and retries the whole correction once', async storeName => {
    const s = await setup();
    await s.receive();
    expect(s.cooking.correctMealConsumption).toBeTypeOf('function');
    const input = await s.correction();
    const before = await s.raw();
    let prototype;
    await s.db.runMealCookingTransaction('readonly', stores => { prototype = Object.getPrototypeOf(stores.events); return stores.events.getAll(); });
    const method = storeName === 'inventoryEvents' ? 'add' : 'put';
    const original = prototype[method];
    let aborted = 0;
    const spy = vi.spyOn(prototype, method).mockImplementation(function (...args) {
      const request = original.apply(this, args);
      if (this.name === storeName && aborted === 0) request.addEventListener('success', () => { aborted += 1; this.transaction.abort(); });
      return request;
    });
    await expect(s.cooking.correctMealConsumption(input)).rejects.toThrow();
    expect(aborted).toBe(1);
    expect(await s.raw()).toStrictEqual(before);
    spy.mockRestore();
    await s.cooking.correctMealConsumption(input);
    const after = await s.raw();
    expect((await s.rows()).reduce((sum, row) => sum + row.amount, 0)).toBe(700);
    await s.cooking.correctMealConsumption(input);
    expect(await s.raw()).toStrictEqual(after);
  });
});
