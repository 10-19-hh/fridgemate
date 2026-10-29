import FDBFactory from 'fake-indexeddb/lib/FDBFactory';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const NOW = '2026-09-21T09:00:00.000Z';
const WEEK = '2026-09-21';
const SLOT = `${WEEK}:dinner`;
const STORES = ['ingredients', 'inventoryQuantities', 'mealPlans', 'inventoryEvents'];
let rawConnections = [];

function openRaw(scope = 'guest') {
  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(`fridgemate-db__${scope.replace(':', '_')}`);
    request.onsuccess = () => {
      rawConnections.push(request.result);
      resolve(request.result);
    };
    request.onerror = () => reject(request.error);
  });
}

async function snapshot(scope = 'guest') {
  const database = await openRaw(scope);
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(STORES, 'readonly');
      const reads = STORES.map(name => transaction.objectStore(name).getAll());
      transaction.oncomplete = () => resolve(Object.fromEntries(STORES.map((name, index) => [name, reads[index].result])));
      transaction.onabort = () => reject(transaction.error);
    });
  } finally { database.close(); }
}

function putSnapshot(database, state) {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORES, 'readwrite');
    for (const name of STORES) {
      const store = transaction.objectStore(name);
      store.clear();
      state[name].forEach(row => store.put(row));
    }
    transaction.oncomplete = resolve;
    transaction.onabort = () => reject(transaction.error);
  });
}

async function setup(scope = 'guest', cook = false) {
  const db = await import('../../../db/indexedDB');
  const plans = await import('../mealPlanRepository');
  const quantities = await import('../inventoryQuantityRepository');
  const cooking = await import('../mealCookingRepository');
  const { generateMealPlan } = await import('../mealPlanDomain');
  await db.saveIngredient({ id: 'chicken', name: '닭고기', quantity: '300g', consumed: false,
    memo: '보존 메모', category: '육류', storageType: '냉장', expiryDate: '2026-09-30',
    createdAt: NOW, updatedAt: NOW, syncState: 'synced' }, scope);
  let row = (await quantities.getInventoryQuantitySnapshot(scope)).inventory[0];
  await quantities.saveInventoryQuantity({ scope, ingredientId: row.id, expectedRevision: row.quantityRevision,
    expectedSourceToken: row.sourceToken, values: { name: '닭고기', amount: 300, unit: 'g', preparationState: 'raw' } });
  const plan = generateMealPlan({ scope, weekStart: WEEK,
    preferences: { servings: 1, dinnerDays: [0, 1], excludedIngredients: [] }, now: NOW });
  await plans.saveMealPlan(plan, scope, 0);
  await plans.confirmMealPlan(WEEK, scope, 1);
  row = (await quantities.getInventoryQuantitySnapshot(scope)).inventory[0];
  const input = { scope, weekStart: WEEK, slotId: SLOT, operationId: 'cook-one', expectedPlanRevision: 2,
    usageMode: 'measured', completeUsageConfirmed: true,
    usages: [{ ingredientId: row.id, amount: 150, unit: 'g', expectedRevision: row.quantityRevision, expectedSourceToken: row.sourceToken }] };
  if (cook) await cooking.recordMealCooking(input);
  return { db, plans, quantities, cooking, input };
}

// Keep this assertion outside rejection matchers: a missing export must fail
// negative tests, not look like successful validation of a damaged record.
function workspace(s, scope) {
  expect(s.cooking.getMealCookingWorkspace).toBeTypeOf('function');
  return s.cooking.getMealCookingWorkspace(scope);
}

describe('consistent read-only meal cooking workspace', () => {
  beforeEach(() => {
    rawConnections = [];
    vi.resetModules();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(NOW));
    Object.defineProperty(window, 'indexedDB', { configurable: true, writable: true, value: new FDBFactory() });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    rawConnections.forEach(database => database.close());
    const db = await import('../../../db/indexedDB');
    await Promise.all(['guest', 'user:alice'].map(scope => db.deleteDatabase(scope)));
    vi.useRealTimers();
  });

  it('returns an empty guest workspace without generating a plan', async () => {
    const cooking = await import('../mealCookingRepository');
    expect(await workspace({ cooking })).toEqual({ scope: 'guest', records: [], inventory: [], history: [] });
    expect(await snapshot()).toEqual({ ingredients: [], inventoryQuantities: [], mealPlans: [], inventoryEvents: [] });
  });

  it('projects current quantities and cooking history without changing stored data', async () => {
    const s = await setup('guest', true);
    const before = await snapshot();
    const result = await workspace(s);
    expect(result.scope).toBe('guest');
    expect(result.inventory).toEqual([expect.objectContaining({ id: 'chicken', quantity: '150g', amount: 150,
      unit: 'g', quantityStatus: 'verified', quantityRevision: 3, memo: '보존 메모', sourceToken: expect.any(String) })]);
    expect(result.records).toEqual(before.mealPlans);
    expect(result.history).toEqual(before.inventoryEvents);
    expect(result.history.map(event => event.kind).sort()).toEqual(['consumption', 'cooking']);
    result.inventory[0].amount = 999;
    result.records[0].confirmed.slots[0].title = '반환값만 변경';
    result.history[0].kind = 'changed';
    expect(await snapshot()).toEqual(before);
    expect((await workspace(s)).inventory[0].amount).toBe(150);
  });

  it('projects stale, consumed and deleted stock as unverified without reviving its old amount', async () => {
    const s = await setup();
    const before = await snapshot();
    await s.db.runMealCookingTransaction('readwrite', ({ ingredients, quantities }) => {
      ingredients.put({ ...before.ingredients[0], quantity: '사용자가 바꾼 양' });
      for (const [id, flags] of [['consumed', { consumed: true }], ['deleted', { deletedAt: NOW }]]) {
        const ingredient = { ...before.ingredients[0], id, ...flags };
        ingredients.put(ingredient);
        quantities.put({ ...before.inventoryQuantities[0], id });
      }
    });
    const stored = await snapshot();
    const result = await workspace(s);
    expect(result.inventory).toHaveLength(3);
    for (const row of result.inventory) expect(row).toMatchObject({ amount: null, unit: null, quantityStatus: 'unverified' });
    expect(result.inventory.find(row => row.id === 'consumed').consumed).toBe(true);
    expect(result.inventory.find(row => row.id === 'deleted').deletedAt).toBe(NOW);
    expect(await snapshot()).toEqual(stored);
  });

  it('retains active cooking and consumption history after clearing a plan without restoring it', async () => {
    const s = await setup('guest', true);
    await s.plans.clearMealPlans('guest');
    const before = await snapshot();
    const result = await workspace(s);
    expect(result.records).toEqual([]);
    expect(result.inventory[0]).toMatchObject({ amount: 150, quantityStatus: 'verified' });
    expect(result.history.map(event => event.id).sort()).toEqual(['consumption:cook-one', 'cooking:cook-one']);
    expect(await snapshot()).toEqual(before);
  });

  it('validates receipts but keeps them out of cooking history', async () => {
    const s = await setup('guest', true);
    const shopping = await import('../../shopping/shoppingRepository');
    const note = await shopping.recordPurchaseNote({ scope: 'guest', operationId: 'bought', actualQuantityText: '500g', memo: '',
      source: { source: 'manual', sourceId: 'manual:stock@1', name: '닭고기', quantityText: '500g', context: '직접 입력' } });
    await shopping.applyPurchaseReceipt({ scope: 'guest', operationId: 'received', purchaseNoteId: note.id,
      values: { name: '닭고기', quantityText: '500g', quantityStatus: 'verified', amount: 500, unit: 'g', preparationState: 'raw',
        purchaseDate: WEEK, expiryDate: '2026-09-30', category: '육류', storageType: '냉장', memo: '' } });
    const result = await workspace(s);
    expect(result.history.map(event => event.kind).sort()).toEqual(['consumption', 'cooking']);
    expect(result.inventory.find(row => row.id === 'receipt-received')).toMatchObject({ amount: 500, quantityStatus: 'verified' });
  });

  it('does not mix equal IDs between guest and authenticated workspaces', async () => {
    const guest = await setup('guest', true);
    const alice = await setup('user:alice');
    const result = await workspace(alice, 'user:alice');
    expect(result).toMatchObject({ scope: 'user:alice', history: [], inventory: [expect.objectContaining({ amount: 300 })] });
    expect(result.records[0]).toMatchObject({ scope: 'user:alice', revision: 2 });
    expect((await workspace(guest)).inventory[0].amount).toBe(150);
    expect((await workspace(guest)).history).toHaveLength(2);
  });

  it.each(['', ' guest ', 'user:alice/other', 'user_', null, 42])('rejects invalid scope %s even with an empty database', async scope => {
    const cooking = await import('../mealCookingRepository');
    await expect(workspace({ cooking }, scope)).rejects.toThrow();
  });

  it.each([
    ['corrupt archived plan', state => { state.mealPlans[0].archives = [{}]; }],
    ['foreign plan', state => { state.mealPlans[0].scope = 'user:alice'; }],
    ['foreign raw stock', state => { state.ingredients[0].scope = 'user:alice'; }],
    ['orphaned foreign quantity review', state => { state.inventoryQuantities.push({ schemaVersion: 1, id: 'orphan', scope: 'user:alice', status: 'unverified', revision: 1 }); }],
    ['malformed receipt', state => { state.inventoryEvents.push({ id: 'receipt:broken', kind: 'receipt', scope: 'guest' }); }],
    ['missing linked consumption', state => { state.inventoryEvents = state.inventoryEvents.filter(event => event.kind !== 'consumption'); }],
    ['foreign cooking history', state => { state.inventoryEvents.forEach(event => { event.scope = 'user:alice'; }); }],
    ['unknown event type', state => { state.inventoryEvents.push({ id: 'future:one', kind: 'future', scope: 'guest' }); }],
  ])('rejects %s instead of hiding it or writing repairs', async (_name, damage) => {
    const s = await setup('guest', true);
    const state = await snapshot();
    damage(state);
    const raw = await openRaw();
    await putSnapshot(raw, state);
    raw.close();
    await expect(workspace(s)).rejects.toThrow();
    expect(await snapshot()).toEqual(state);
  });

  it('reads one committed version when cooking is queued between the inventory and history reads', async () => {
    const s = await setup();
    const before = await snapshot();
    await s.cooking.recordMealCooking(s.input);
    const after = await snapshot();
    const raw = await openRaw();
    await putSnapshot(raw, before);
    const prototype = Object.getPrototypeOf(raw.transaction('ingredients').objectStore('ingredients'));
    const getAll = prototype.getAll;
    let queuedWrite;
    const spy = vi.spyOn(prototype, 'getAll').mockImplementation(function (...args) {
      const request = getAll.apply(this, args);
      if (this.name === 'ingredients' && !queuedWrite) queuedWrite = putSnapshot(raw, after);
      return request;
    });
    const first = await workspace(s);
    expect(first.inventory[0].amount).toBe(300);
    expect(first.records[0].confirmed.slots[0].status).toBe('planned');
    expect(first.history).toEqual([]);
    await queuedWrite;
    spy.mockRestore();
    const next = await workspace(s);
    expect(next.inventory[0].amount).toBe(150);
    expect(next.records[0].confirmed.slots[0].status).toBe('cooked');
    expect(next.history.map(event => event.kind).sort()).toEqual(['consumption', 'cooking']);
    raw.close();
  });

  it('rejects a read aborted after its last successful request and permits a clean retry', async () => {
    const s = await setup('guest', true);
    const before = await snapshot();
    const raw = await openRaw();
    const prototype = Object.getPrototypeOf(raw.transaction('inventoryEvents').objectStore('inventoryEvents'));
    const getAll = prototype.getAll;
    let aborted = false;
    const spy = vi.spyOn(prototype, 'getAll').mockImplementation(function (...args) {
      const request = getAll.apply(this, args);
      if (this.name === 'inventoryEvents' && !aborted) request.addEventListener('success', () => {
        aborted = true;
        this.transaction.abort();
      });
      return request;
    });
    await expect(workspace(s)).rejects.toThrow();
    expect(aborted).toBe(true);
    spy.mockRestore();
    expect((await workspace(s)).inventory[0].amount).toBe(150);
    expect(await snapshot()).toEqual(before);
    raw.close();
  });
});
