import FDBFactory from 'fake-indexeddb/lib/FDBFactory';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const NOW = '2026-09-21T09:00:00.000Z';
const WEEK = '2026-09-21';
const SLOT = `${WEEK}:dinner`;
const STORES = ['ingredients', 'inventoryQuantities', 'mealPlans', 'inventoryEvents'];

async function openRaw() {
  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open('fridgemate-db__guest');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function snapshot() {
  const database = await openRaw();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(STORES, 'readonly');
      const requests = STORES.map(name => transaction.objectStore(name).getAll());
      transaction.oncomplete = () => resolve(Object.fromEntries(STORES.map((name, index) => [name, requests[index].result])));
      transaction.onabort = () => reject(transaction.error);
    });
  } finally { database.close(); }
}

async function abortAfterWrite(storeName) {
  const database = await openRaw();
  const prototype = Object.getPrototypeOf(database.transaction(storeName).objectStore(storeName));
  const method = storeName === 'inventoryEvents' ? 'add' : 'put';
  const original = prototype[method];
  let writesAborted = 0;
  const spy = vi.spyOn(prototype, method).mockImplementation(function (...args) {
    const request = original.apply(this, args);
    if (this.name === storeName && writesAborted === 0) {
      request.addEventListener('success', () => {
        writesAborted += 1;
        this.transaction.abort();
      });
    }
    return request;
  });
  database.close();
  return { abortedCount: () => writesAborted, restore: () => spy.mockRestore() };
}

async function setup() {
  const db = await import('../../../db/indexedDB');
  const plans = await import('../mealPlanRepository');
  const quantities = await import('../inventoryQuantityRepository');
  const cooking = await import('../mealCookingRepository');
  const { generateMealPlan } = await import('../mealPlanDomain');
  await db.saveIngredient({ id: 'chicken', name: '닭고기', quantity: '300g', consumed: false,
    memo: '보존할 메모', category: '육류', storageType: '냉장', expiryDate: '2026-09-30',
    createdAt: NOW, updatedAt: NOW, syncState: 'synced' });
  let row = (await quantities.getInventoryQuantitySnapshot('guest')).inventory[0];
  await quantities.saveInventoryQuantity({ scope: 'guest', ingredientId: row.id,
    expectedRevision: row.quantityRevision, expectedSourceToken: row.sourceToken,
    values: { name: '닭고기', amount: 300, unit: 'g', preparationState: 'raw' } });
  const plan = generateMealPlan({ scope: 'guest', weekStart: WEEK,
    preferences: { servings: 1, dinnerDays: [0], excludedIngredients: [] }, now: NOW });
  await plans.saveMealPlan(plan, 'guest', 0);
  await plans.confirmMealPlan(WEEK, 'guest', 1);
  row = (await quantities.getInventoryQuantitySnapshot('guest')).inventory[0];
  await cooking.recordMealCooking({ scope: 'guest', weekStart: WEEK, slotId: SLOT, operationId: 'cook-one',
    expectedPlanRevision: 2, usageMode: 'measured', completeUsageConfirmed: true,
    usages: [{ ingredientId: row.id, amount: 150, unit: 'g', expectedRevision: row.quantityRevision,
      expectedSourceToken: row.sourceToken }] });
  row = (await quantities.getInventoryQuantitySnapshot('guest')).inventory[0];
  const reversal = { scope: 'guest', weekStart: WEEK, slotId: SLOT, operationId: 'undo-one',
    cookingId: 'cooking:cook-one', expectedPlanRevision: 3,
    inventory: [{ ingredientId: row.id, expectedRevision: row.quantityRevision, expectedSourceToken: row.sourceToken }] };
  const cancellation = { scope: 'guest', weekStart: WEEK, slotId: SLOT, operationId: 'cancel-one',
    cookingId: 'cooking:cook-one', expectedPlanRevision: 4 };
  return { db, plans, cooking, reversal, cancellation };
}

describe('meal consumption and cooking cancellation rollback', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(NOW));
    Object.defineProperty(window, 'indexedDB', { configurable: true, writable: true, value: new FDBFactory() });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    const db = await import('../../../db/indexedDB');
    await db.deleteDatabase('guest');
    vi.useRealTimers();
  });

  it.each(STORES)('rolls back consumption reversal after a successful %s write and retries exactly once', async storeName => {
    const s = await setup();
    const before = await snapshot();
    const failure = await abortAfterWrite(storeName);
    await expect(s.cooking.reverseMealConsumption(s.reversal)).rejects.toThrow();
    expect(failure.abortedCount()).toBe(1);
    expect(await snapshot()).toEqual(before);
    failure.restore();

    const result = await s.cooking.reverseMealConsumption(s.reversal);
    const after = await snapshot();
    expect(after.ingredients[0]).toMatchObject({ quantity: '300g', memo: '보존할 메모' });
    expect(after.inventoryQuantities[0]).toMatchObject({ status: 'unverified' });
    expect(after.mealPlans[0].confirmed.slots[0]).toMatchObject({ status: 'cooked', cooking: {
      inventoryStatus: 'reversed', reversalId: 'consumption-reversal:undo-one' } });
    expect(after.inventoryEvents).toHaveLength(before.inventoryEvents.length + 1);
    expect(result.event.id).toBe('consumption-reversal:undo-one');
    expect((await s.cooking.reverseMealConsumption(s.reversal)).event).toEqual(result.event);
    expect(await snapshot()).toEqual(after);
  });

  it.each(['mealPlans', 'inventoryEvents'])('rolls back cooking cancellation after a successful %s write and retries exactly once', async storeName => {
    const s = await setup();
    await s.cooking.reverseMealConsumption(s.reversal);
    const before = await snapshot();
    const failure = await abortAfterWrite(storeName);
    await expect(s.cooking.cancelMealCooking(s.cancellation)).rejects.toThrow();
    expect(failure.abortedCount()).toBe(1);
    expect(await snapshot()).toEqual(before);
    failure.restore();

    const result = await s.cooking.cancelMealCooking(s.cancellation);
    const after = await snapshot();
    expect(after.ingredients).toEqual(before.ingredients);
    expect(after.inventoryQuantities).toEqual(before.inventoryQuantities);
    expect(after.mealPlans[0].confirmed.slots[0].status).toBe('planned');
    expect(after.mealPlans[0].confirmed.slots[0].cooking).toBeUndefined();
    expect(after.inventoryEvents).toHaveLength(before.inventoryEvents.length + 1);
    expect(result.event.id).toBe('cooking-reversal:cancel-one');
    expect((await s.cooking.cancelMealCooking(s.cancellation)).event).toEqual(result.event);
    expect(await snapshot()).toEqual(after);
  });

  it('can reverse consumption after plan deletion without recreating the plan or applying the inverse twice', async () => {
    const s = await setup();
    await s.plans.clearMealPlans('guest');
    const request = { ...s.reversal, expectedPlanRevision: 0 };
    const result = await s.cooking.reverseMealConsumption(request);
    const after = await snapshot();
    expect(result.record).toBeNull();
    expect(after.mealPlans).toEqual([]);
    expect(after.ingredients[0]).toMatchObject({ quantity: '300g', memo: '보존할 메모' });
    expect(after.inventoryQuantities[0]).toMatchObject({ status: 'unverified' });
    expect(after.inventoryEvents).toHaveLength(3);
    expect((await s.cooking.reverseMealConsumption(request)).event).toEqual(result.event);
    expect(await snapshot()).toEqual(after);
  });
});
