import FDBFactory from 'fake-indexeddb/lib/FDBFactory';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const NOW = '2026-09-21T09:00:00.000Z';
const WEEK = '2026-09-21';
const SLOT = `${WEEK}:dinner`;

async function setup(scope = 'guest', changePlan = () => {}) {
  const db = await import('../../../db/indexedDB');
  const plans = await import('../mealPlanRepository');
  const quantities = await import('../inventoryQuantityRepository');
  const cooking = await import('../mealCookingRepository');
  const { generateMealPlan } = await import('../mealPlanDomain');
  const { allocateMealPlanInventory } = await import('../mealPlanAllocation');
  const ingredient = { id: 'chicken', name: '닭고기', quantity: '300g', consumed: false, memo: '보존 메모',
    category: '육류', storageType: '냉장', expiryDate: '2026-09-30', updatedAt: NOW, createdAt: NOW, syncState: 'synced' };
  await db.saveIngredient(ingredient, scope);
  async function confirmAmount(id, amount) {
    const row = (await quantities.getInventoryQuantitySnapshot(scope)).inventory.find(item => item.id === id);
    return quantities.saveInventoryQuantity({ scope, ingredientId: id, expectedRevision: row.quantityRevision,
      expectedSourceToken: row.sourceToken, values: { name: row.name, amount, unit: 'g', preparationState: 'raw' } });
  }
  await confirmAmount('chicken', 300);
  const plan = generateMealPlan({ scope, weekStart: WEEK, preferences: { servings: 1, dinnerDays: [0, 1], excludedIngredients: [] }, now: NOW });
  const original = plan.slots[0].components[0];
  const component = { ...original, servings: 1, servingsStatus: 'verified', processInputs: [], ingredients: [{
    ...original.ingredients[0], id: 'chicken-line', rawName: '닭고기', normalizedName: '닭고기',
    ingredientKey: 'food:닭고기', amount: 200, unit: 'g', preparationState: 'raw', quantityStatus: 'verified',
    quantityEvidence: 'test:measured', selected: true, optional: false,
  }] };
  for (const slot of plan.slots.filter(slot => slot.status === 'planned')) slot.components = [structuredClone(component)];
  changePlan(plan);
  await plans.saveMealPlan(plan, scope, 0);
  await plans.confirmMealPlan(WEEK, scope, 1);
  const row = (await quantities.getInventoryQuantitySnapshot(scope)).inventory[0];
  const input = { scope, weekStart: WEEK, slotId: SLOT, operationId: 'cook-one', expectedPlanRevision: 2,
    usageMode: 'measured', completeUsageConfirmed: true,
    usages: [{ ingredientId: 'chicken', amount: 150, unit: 'g', expectedRevision: row.quantityRevision, expectedSourceToken: row.sourceToken }] };
  const events = () => db.runInventoryReceiptTransaction('readonly', ({ events }) => events.getAll(), scope);
  const snapshot = () => plans.getMealPlanningSnapshot(scope);
  const state = async () => ({ snapshot: await snapshot(), record: await plans.getMealPlan(WEEK, scope), events: await events() });
  const invoke = async (name, args) => cooking[name]?.(args);
  async function reversalInput(operationId = 'undo-one') {
    const record = await plans.getMealPlan(WEEK, scope);
    const current = (await quantities.getInventoryQuantitySnapshot(scope)).inventory.find(item => item.id === 'chicken');
    return { scope, weekStart: WEEK, slotId: SLOT, operationId, cookingId: 'cooking:cook-one', expectedPlanRevision: record?.revision ?? 0,
      inventory: [{ ingredientId: 'chicken', expectedRevision: current.quantityRevision, expectedSourceToken: current.sourceToken }] };
  }
  return { db, plans, quantities, cooking, plan, ingredient, input, events, snapshot, state, invoke, confirmAmount, reversalInput, allocateMealPlanInventory };
}

describe('atomic cooked meals and actual stock usage', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(NOW));
    Object.defineProperty(window, 'indexedDB', { configurable: true, value: new FDBFactory() });
  });
  afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

  it('records actual 150g, marks the confirmed meal cooked, and leaves only next dinner demand', async () => {
    const s = await setup();
    await s.cooking.recordMealCooking?.(s.input);
    const snapshot = await s.snapshot();
    expect(snapshot.inventory[0]).toMatchObject({ amount: 150, quantityStatus: 'verified', memo: '보존 메모' });
    expect(snapshot.confirmedPlans[0].slots[0]).toMatchObject({ status: 'cooked', cooking: {
      id: 'cooking:cook-one', inventoryStatus: 'applied', consumptionId: 'consumption:cook-one', reversalId: null } });
    const allocation = s.allocateMealPlanInventory({ ...snapshot, today: WEEK });
    expect(allocation.slots).toHaveLength(1);
    expect(allocation.shopping.shortages).toEqual([expect.objectContaining({ amount: 50, ingredientKey: 'food:닭고기' })]);
    expect((await s.events()).map(event => event.kind).sort()).toEqual(['consumption', 'cooking']);
  });

  it('acknowledges replay and another tab without double deduction, even with stale tokens', async () => {
    const s = await setup();
    const [one, replay, other] = await Promise.all([s.invoke('recordMealCooking', s.input), s.invoke('recordMealCooking', s.input),
      s.invoke('recordMealCooking', { ...s.input, operationId: 'other-tab' })]);
    expect(replay.event).toEqual(one.event);
    expect(other.event).toEqual(one.event);
    expect((await s.snapshot()).inventory[0].amount).toBe(150);
    expect(await s.events()).toHaveLength(2);
    expect((await s.plans.getMealPlan(WEEK)).revision).toBe(3);
  });

  it('rejects changed payload on replay, including another operation ID', async () => {
    const s = await setup();
    await s.invoke('recordMealCooking', s.input);
    const before = await s.state();
    for (const operationId of ['cook-one', 'changed']) {
      await expect(s.invoke('recordMealCooking', { ...s.input, operationId, usages: [{ ...s.input.usages[0], amount: 100 }] })).rejects.toThrow();
    }
    expect(await s.state()).toEqual(before);
  });

  it('does not replay stock changes after a later raw edit or plan deletion', async () => {
    const s = await setup();
    const saved = await s.invoke('recordMealCooking', s.input);
    await s.db.saveIngredient({ ...s.ingredient, quantity: '나중에 직접 수정' });
    await s.plans.clearMealPlans();
    const replay = await s.invoke('recordMealCooking', s.input);
    expect(replay.event).toEqual(saved.event);
    expect(await s.plans.getMealPlan(WEEK)).toBeNull();
    expect((await s.db.getAllIngredients())[0].quantity).toBe('나중에 직접 수정');
    await expect(s.plans.saveMealPlan(s.plan, 'guest', 0)).rejects.toThrow();
    await expect(s.invoke('recordMealCooking', { ...s.input, operationId: 'regenerated', usages: [{ ...s.input.usages[0], amount: 100 }] })).rejects.toThrow();
    expect(await s.events()).toHaveLength(2);
  });

  it('copies mutable request data before opening the asynchronous transaction', async () => {
    const s = await setup();
    expect(s.cooking.recordMealCooking).toBeTypeOf('function');
    const pending = s.cooking.recordMealCooking(s.input);
    s.input.usages[0].amount = 290;
    s.input.completeUsageConfirmed = false;
    await pending;
    expect((await s.snapshot()).inventory[0].amount).toBe(150);
  });

  it.each([
    ['old plan revision', request => { request.expectedPlanRevision = 1; }],
    ['old quantity revision', request => { request.usages[0].expectedRevision = 1; }],
    ['old source', request => { request.usages[0].expectedSourceToken = 'old'; }],
    ['too much stock', request => { request.usages[0].amount = 350; }],
    ['partial usage unconfirmed', request => { request.completeUsageConfirmed = false; }],
    ['wrong week', request => { request.weekStart = '2026-09-28'; }],
    ['wrong scope', request => { request.scope = 'user:other'; }],
    ['no measured usage', request => { request.usages = []; }],
    ['duplicate batch', request => { request.usages.push({ ...request.usages[0] }); }],
  ])('rejects %s without partial changes', async (_name, damage) => {
    const s = await setup();
    const before = await s.state();
    damage(s.input);
    await expect(s.invoke('recordMealCooking', s.input)).rejects.toThrow();
    expect(await s.state()).toEqual(before);
  });

  it('records cooking without an amount while removing affected stock from future certainty', async () => {
    const s = await setup();
    const rawBefore = await s.db.getAllIngredients();
    await s.invoke('recordMealCooking', { ...s.input, usageMode: 'unknown', usages: [], completeUsageConfirmed: false });
    expect(await s.db.getAllIngredients()).toEqual(rawBefore);
    const snapshot = await s.snapshot();
    expect(snapshot.inventory[0]).toMatchObject({ amount: null, quantityStatus: 'unverified' });
    expect(snapshot.confirmedPlans[0].slots[0]).toMatchObject({ status: 'cooked', cooking: { inventoryStatus: 'needs-review', consumptionId: null } });
    expect((await s.events()).map(event => event.kind)).toEqual(['cooking']);
    const allocation = s.allocateMealPlanInventory({ ...snapshot, today: WEEK });
    expect(allocation.shopping.shortages).toEqual([]);
    expect(allocation.shopping.needsReview.length).toBeGreaterThan(0);
  });

  it('invalidates mandatory usage even when its optional-selection flag is false', async () => {
    const s = await setup('guest', plan => {
      for (const slot of plan.slots.filter(slot => slot.status === 'planned')) slot.components[0].ingredients[0].selected = false;
    });
    await s.invoke('recordMealCooking', { ...s.input, usageMode: 'unknown', usages: [], completeUsageConfirmed: false });
    const snapshot = await s.snapshot();
    expect(snapshot.inventory[0]).toMatchObject({ amount: null, quantityStatus: 'unverified' });
    expect(s.allocateMealPlanInventory({ ...snapshot, today: WEEK }).shopping.needsReview.length).toBeGreaterThan(0);
  });

  it.each([
    ['consumption assigned to another dinner', event => ({ ...event, slotId: '2026-09-22:dinner' })],
    ['missing linked consumption', () => null],
  ])('rejects %s before reversal or acknowledgement without changing any store', async (_name, change) => {
    const s = await setup();
    await s.invoke('recordMealCooking', s.input);
    const original = (await s.events()).find(event => event.kind === 'consumption');
    const changed = change(original);
    await s.db.runInventoryReceiptTransaction('readwrite', ({ events }) => changed ? events.put(changed) : events.delete(original.id));
    const before = await s.state();
    await expect(s.invoke('reverseMealConsumption', await s.reversalInput())).rejects.toThrow();
    await expect(s.invoke('recordMealCooking', s.input)).rejects.toThrow();
    expect(await s.state()).toEqual(before);
  });

  it('rejects malformed receipt history before writing cooking', async () => {
    const s = await setup();
    await s.db.runInventoryReceiptTransaction('readwrite', ({ events }) => events.put({ id: 'receipt:broken', kind: 'receipt', scope: 'guest' }));
    const before = await s.state();
    await expect(s.invoke('recordMealCooking', s.input)).rejects.toThrow();
    expect(await s.state()).toEqual(before);
  });

  it('allows a cleared plan to be recreated only after stock and cooking are separately cancelled', async () => {
    const s = await setup();
    await s.invoke('recordMealCooking', s.input);
    await s.plans.clearMealPlans();
    await expect(s.plans.saveMealPlan(s.plan, 'guest', 0)).rejects.toThrow();
    await s.invoke('reverseMealConsumption', await s.reversalInput());
    await expect(s.plans.saveMealPlan(s.plan, 'guest', 0)).rejects.toThrow();
    await s.invoke('cancelMealCooking', { scope: 'guest', weekStart: WEEK, slotId: SLOT, cookingId: 'cooking:cook-one',
      operationId: 'cancel-after-deletion', expectedPlanRevision: 0 });
    expect(await s.plans.getMealPlan(WEEK)).toBeNull();
    await s.plans.saveMealPlan(s.plan, 'guest', 0);
    await s.plans.confirmMealPlan(WEEK, 'guest', 1);
    expect((await s.plans.getMealPlan(WEEK)).confirmed.slots[0].status).toBe('planned');
    expect((await s.snapshot()).inventory[0]).toMatchObject({ quantity: '300g', amount: null, quantityStatus: 'unverified' });
    expect(await s.events()).toHaveLength(4);
  });

  it('reverses only consumption against current stock once and preserves later receipts and metadata', async () => {
    const s = await setup();
    await s.invoke('recordMealCooking', s.input);
    await s.db.saveIngredient({ ...s.ingredient, quantity: '650g', memo: '나중 메모' });
    await s.confirmAmount('chicken', 650);
    const shopping = await import('../../shopping/shoppingRepository');
    const note = await shopping.recordPurchaseNote({ scope: 'guest', operationId: 'purchase-later', actualQuantityText: '500g', memo: '',
      source: { source: 'manual', sourceId: 'manual:later@1', name: '닭고기', quantityText: '500g', context: '직접 입력' } });
    await shopping.applyPurchaseReceipt({ scope: 'guest', operationId: 'receive-later', purchaseNoteId: note.id,
      values: { name: '닭고기', quantityText: '500g', quantityStatus: 'verified', amount: 500, unit: 'g', preparationState: 'raw',
        purchaseDate: WEEK, expiryDate: '2026-09-30', category: '육류', storageType: '냉장', memo: '새 입고' } });
    const request = await s.reversalInput();
    const one = await s.invoke('reverseMealConsumption', request);
    const after = await s.state();
    expect(after.snapshot.inventory.find(item => item.id === 'chicken')).toMatchObject({ quantity: '800g', memo: '나중 메모', amount: null, quantityStatus: 'unverified' });
    expect(after.snapshot.inventory.find(item => item.id === 'receipt-receive-later')).toMatchObject({ amount: 500, quantityStatus: 'verified' });
    expect(after.record.confirmed.slots[0]).toMatchObject({ status: 'cooked', cooking: { inventoryStatus: 'reversed', reversalId: one.event.id } });
    expect((await s.invoke('reverseMealConsumption', request)).event).toEqual(one.event);
    expect((await s.invoke('reverseMealConsumption', { ...request, operationId: 'undo-tab' })).event).toEqual(one.event);
    expect(await s.state()).toEqual(after);
    expect((await shopping.getShoppingWorkspace('guest', WEEK)).receipts).toHaveLength(1);
  });

  it('requires consumption reversal before cancelling the cooking fact and never restores old quantity proof', async () => {
    const s = await setup();
    await s.invoke('recordMealCooking', s.input);
    const cancel = { scope: 'guest', weekStart: WEEK, slotId: SLOT, cookingId: 'cooking:cook-one', operationId: 'cancel-one', expectedPlanRevision: 3 };
    await expect(s.invoke('cancelMealCooking', cancel)).rejects.toThrow();
    await s.invoke('reverseMealConsumption', await s.reversalInput());
    cancel.expectedPlanRevision = 4;
    const cancelled = await s.invoke('cancelMealCooking', cancel);
    expect((await s.plans.getMealPlan(WEEK)).confirmed.slots[0]).toMatchObject({ status: 'planned' });
    expect((await s.plans.getMealPlan(WEEK)).confirmed.slots[0].cooking).toBeUndefined();
    expect((await s.snapshot()).inventory[0]).toMatchObject({ quantity: '300g', amount: null, quantityStatus: 'unverified' });
    const before = await s.state();
    expect((await s.invoke('cancelMealCooking', cancel)).event).toEqual(cancelled.event);
    expect(await s.state()).toEqual(before);
  });

  it('cancels unknown-usage cooking without restoring a former stock confirmation', async () => {
    const s = await setup();
    await s.invoke('recordMealCooking', { ...s.input, usageMode: 'unknown', usages: [], completeUsageConfirmed: false });
    await s.invoke('cancelMealCooking', { scope: 'guest', weekStart: WEEK, slotId: SLOT, cookingId: 'cooking:cook-one', operationId: 'cancel', expectedPlanRevision: 3 });
    expect((await s.snapshot()).inventory[0]).toMatchObject({ amount: null, quantityStatus: 'unverified' });
    expect((await s.plans.getMealPlan(WEEK)).confirmed.slots[0].status).toBe('planned');
  });

  it('keeps identical operation IDs isolated between guest and accounts', async () => {
    const guest = await setup();
    const alice = await setup('user:alice');
    await guest.invoke('recordMealCooking', guest.input);
    expect((await alice.snapshot()).inventory[0].amount).toBe(300);
    await alice.invoke('recordMealCooking', { ...alice.input, usages: [{ ...alice.input.usages[0], amount: 100 }] });
    expect((await alice.snapshot()).inventory[0].amount).toBe(200);
    expect((await guest.snapshot()).inventory[0].amount).toBe(150);
  });

  it.each(['ingredients', 'inventoryQuantities', 'mealPlans', 'inventoryEvents'])('rolls back every store when %s aborts after its write', async storeName => {
    const s = await setup();
    const before = await s.state();
    const raw = await new Promise(resolve => { const request = window.indexedDB.open('fridgemate-db__guest'); request.onsuccess = () => resolve(request.result); });
    const prototype = Object.getPrototypeOf(raw.transaction(storeName).objectStore(storeName));
    const method = storeName === 'inventoryEvents' ? 'add' : 'put';
    const original = prototype[method];
    let fail = true;
    vi.spyOn(prototype, method).mockImplementation(function (...args) {
      const request = original.apply(this, args);
      if (this.name === storeName && fail) { fail = false; request.addEventListener('success', () => this.transaction.abort()); }
      return request;
    });
    await expect(s.invoke('recordMealCooking', s.input)).rejects.toThrow();
    expect(await s.state()).toEqual(before);
    await s.invoke('recordMealCooking', s.input);
    expect((await s.snapshot()).inventory[0].amount).toBe(150);
    raw.close();
  });
});
