import FDBFactory from 'fake-indexeddb/lib/FDBFactory';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

function createIngredient(id, overrides = {}) {
  return {
    id,
    name: `ingredient-${id}`,
    category: 'vegetable',
    storageType: 'fridge',
    quantity: '1 item',
    purchaseDate: '2026-03-18',
    expiryDate: '2026-03-25',
    memo: '',
    consumed: false,
    ...overrides
  };
}

async function loadIndexedDbModule() {
  vi.resetModules();
  const factory = new FDBFactory();

  Object.defineProperty(window, 'indexedDB', {
    configurable: true,
    writable: true,
    value: factory
  });
  vi.stubGlobal('indexedDB', factory);

  return import('../indexedDB.js');
}

function openRawDatabase(name) {
  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(name);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function writeRawIngredient(databaseName, ingredient) {
  const database = await openRawDatabase(databaseName);
  try {
    await new Promise((resolve, reject) => {
      const transaction = database.transaction('ingredients', 'readwrite');
      transaction.objectStore('ingredients').put(ingredient);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally {
    database.close();
  }
}

function marker(id, revision = 1, scope = 'guest') {
  return { schemaVersion: 1, id, scope, revision, status: 'unverified' };
}

function getReviews(db, scope = 'guest') {
  expect(db.runInventoryQuantityTransaction).toBeTypeOf('function');
  return db.runInventoryQuantityTransaction('readonly', ({ quantities }) => quantities.getAll(), scope);
}

function putReview(db, review) {
  expect(db.runInventoryQuantityTransaction).toBeTypeOf('function');
  return db.runInventoryQuantityTransaction('readwrite', ({ quantities }) => quantities.put(review), review.scope);
}

async function seedPrivateStores(db, scope) {
  await db.saveIngredient(createIngredient('stock'), scope);
  await db.saveMenuDecision({ decisionDate: '2026-09-21', memo: '메뉴 기록' }, scope);
  await db.runMealPlanTransaction('readwrite', (store) => store.put({ id: 'week:2026-09-21', title: '식단 기록' }), scope);
  // Cleanup must erase private records even when a newer or damaged schema cannot be read by a repository.
  await db.runShoppingTransaction('readwrite', (store) => store.put({ id: 'manual:private', schemaVersion: 99, memo: '장보기 기록' }), scope);
  await db.runInventoryReceiptTransaction('readwrite', ({ events }) => events.put({ id: 'receipt:private', schemaVersion: 99, memo: '입고 기록' }), scope);
  expect(db.runMealPlanPilotTransaction).toBeTypeOf('function');
  await db.runMealPlanPilotTransaction('readwrite', store => store.put({ id: 'session', schemaVersion: 99, memo: '개인 파일럿 기록' }), scope);
}

async function privateStoreContents(db, scope) {
  return {
    ...(await db.readMealPlanningSnapshot(scope)),
    menuDecision: await db.getMenuDecision('2026-09-21', scope),
    shoppingEntries: await db.runShoppingTransaction('readonly', (store) => store.getAll(), scope),
    inventoryEvents: await db.runInventoryReceiptTransaction('readonly', ({ events }) => events.getAll(), scope),
    mealPlanPilot: await db.runMealPlanPilotTransaction('readonly', store => store.getAll(), scope)
  };
}

describe('indexedDB utilities', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('upgrades v6 without changing its six stores or receipt uniqueness and starts with an empty pilot store', async () => {
    const db = await loadIndexedDbModule();
    const names = ['ingredients', 'inventoryQuantities', 'mealPlans', 'menuDecisions', 'shoppingEntries', 'inventoryEvents'];
    const old = await new Promise((resolve, reject) => {
      const request = window.indexedDB.open('fridgemate-db__guest', 6);
      request.onupgradeneeded = () => names.forEach(name => {
        const store = request.result.createObjectStore(name, { keyPath: name === 'menuDecisions' ? 'decisionDate' : 'id' });
        if (name === 'inventoryEvents') store.createIndex('purchaseNoteId', 'purchaseNoteId', { unique: true });
      });
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    const records = names.map(name => name === 'menuDecisions'
      ? { decisionDate: '2026-09-21', private: name }
      : { id: `${name}-old`, private: name, ...(name === 'inventoryEvents' ? { purchaseNoteId: 'purchase:keep' } : {}) });
    await new Promise((resolve, reject) => {
      const transaction = old.transaction(names, 'readwrite');
      names.forEach((name, index) => transaction.objectStore(name).put(records[index]));
      transaction.oncomplete = resolve; transaction.onabort = () => reject(transaction.error);
    });
    old.close();
    await db.getAllIngredients();
    const current = await openRawDatabase('fridgemate-db__guest');
    try {
      expect(current.version).toBe(7);
      expect(current.objectStoreNames.contains('mealPlanPilot')).toBe(true);
      const contents = await new Promise((resolve, reject) => {
        const transaction = current.transaction([...names, 'mealPlanPilot']);
        const reads = [...names, 'mealPlanPilot'].map(name => transaction.objectStore(name).getAll());
        transaction.oncomplete = () => resolve(reads.map(read => read.result));
        transaction.onabort = () => reject(transaction.error);
      });
      expect(contents).toStrictEqual([...records.map(record => [record]), []]);
      expect(current.transaction('inventoryEvents').objectStore('inventoryEvents').index('purchaseNoteId').unique).toBe(true);
      let duplicateError;
      await expect(db.runInventoryReceiptTransaction('readwrite', ({ events }) => {
        const request = events.add({ id: 'receipt:duplicate', purchaseNoteId: 'purchase:keep' });
        request.addEventListener('error', () => { duplicateError = request.error.name; });
        return request;
      })).rejects.toThrow();
      expect(duplicateError).toBe('ConstraintError');
      expect(await db.runInventoryReceiptTransaction('readonly', ({ events }) => events.getAll())).toEqual([records[5]]);
    } finally { current.close(); }
  });

  it('persists pilot session data only in the requested scope and resolves after transaction completion', async () => {
    const db = await loadIndexedDbModule();
    expect(db.runMealPlanPilotTransaction).toBeTypeOf('function');
    for (const scope of ['guest', 'user:alice', 'user:bob']) {
      await db.runMealPlanPilotTransaction('readwrite', store => store.put({ id: 'session', scope }), scope);
    }
    let complete = false;
    const saved = await db.runMealPlanPilotTransaction('readwrite', (store, transaction) => {
      transaction.addEventListener('complete', () => { complete = true; });
      return store.put({ id: 'session', scope: 'user:alice', revision: 2 });
    }, { scope: 'user:alice' });
    expect(complete).toBe(true);
    expect(saved).toBe('session');
    expect(await db.runMealPlanPilotTransaction('readonly', store => store.getAll(), 'user:alice'))
      .toEqual([{ id: 'session', scope: 'user:alice', revision: 2 }]);
    expect(await db.runMealPlanPilotTransaction('readonly', store => store.getAll()))
      .toEqual([{ id: 'session', scope: 'guest' }]);
    expect(await db.runMealPlanPilotTransaction('readonly', store => store.getAll(), 'user:bob'))
      .toEqual([{ id: 'session', scope: 'user:bob' }]);
    expect(await db.getAllIngredients()).toEqual([]);
  });

  it('does not report a pilot write as successful when the transaction aborts after the request', async () => {
    const db = await loadIndexedDbModule();
    expect(db.runMealPlanPilotTransaction).toBeTypeOf('function');
    const original = { id: 'session', revision: 1 };
    await db.runMealPlanPilotTransaction('readwrite', store => store.put(original));
    await expect(db.runMealPlanPilotTransaction('readwrite', (store, transaction) => {
      const request = store.put({ id: 'session', revision: 2 });
      request.addEventListener('success', () => transaction.abort());
      return request;
    })).rejects.toThrow();
    expect(await db.runMealPlanPilotTransaction('readonly', store => store.get('session'))).toEqual(original);
  });

  it('keeps pilot readonly operations from writing or reaching business stores', async () => {
    const db = await loadIndexedDbModule();
    expect(db.runMealPlanPilotTransaction).toBeTypeOf('function');
    await expect(db.runMealPlanPilotTransaction('readonly', store => store.put({ id: 'session' })))
      .rejects.toMatchObject({ name: 'ReadOnlyError' });
    await expect(db.runMealPlanPilotTransaction('readwrite', (_store, transaction) => transaction.objectStore('ingredients')))
      .rejects.toMatchObject({ name: 'NotFoundError' });
    expect(await db.runMealPlanPilotTransaction('readonly', store => store.getAll())).toEqual([]);
  });

  it('upgrades v5 without converting old purchase notes into receipts or losing existing data', async () => {
    const db = await loadIndexedDbModule();
    const names = ['ingredients', 'inventoryQuantities', 'mealPlans', 'menuDecisions', 'shoppingEntries'];
    const old = await new Promise((resolve, reject) => {
      const request = window.indexedDB.open('fridgemate-db__guest', 5);
      request.onupgradeneeded = () => names.forEach((name) => request.result.createObjectStore(name, { keyPath: name === 'menuDecisions' ? 'decisionDate' : 'id' }));
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    const records = names.map((name) => name === 'menuDecisions' ? { decisionDate: '2026-09-21', private: name } : { id: `${name}-old`, private: name });
    await new Promise((resolve, reject) => {
      const transaction = old.transaction(names, 'readwrite');
      names.forEach((name, index) => transaction.objectStore(name).put(records[index]));
      transaction.oncomplete = resolve; transaction.onabort = () => reject(transaction.error);
    });
    old.close();
    await db.getAllIngredients();
    const current = await openRawDatabase('fridgemate-db__guest');
    expect(current.objectStoreNames.contains('inventoryEvents')).toBe(true);
    const contents = await new Promise((resolve, reject) => {
      const transaction = current.transaction([...names, 'inventoryEvents']);
      const requests = [...names, 'inventoryEvents'].map((name) => transaction.objectStore(name).getAll());
      transaction.oncomplete = () => resolve(requests.map((request) => request.result));
      transaction.onabort = () => reject(transaction.error);
    });
    expect(contents).toEqual([...records.map((record) => [record]), []]);
    current.close();
  });

  it('upgrades v3 preserving all old stores without inventing reviewed amounts', async () => {
    const db = await loadIndexedDbModule();
    const old = await new Promise((resolve, reject) => {
      const request = window.indexedDB.open('fridgemate-db__guest', 3);
      request.onupgradeneeded = () => {
        request.result.createObjectStore('ingredients', { keyPath: 'id' });
        request.result.createObjectStore('mealPlans', { keyPath: 'id' });
        request.result.createObjectStore('menuDecisions', { keyPath: 'decisionDate' });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const ingredient = createIngredient('legacy');
    const plan = { id: 'week:2026-09-14', schemaVersion: 1 };
    const decision = { decisionDate: '2026-09-14', recipeId: 'keep' };
    await new Promise((resolve, reject) => {
      const transaction = old.transaction(['ingredients', 'mealPlans', 'menuDecisions'], 'readwrite');
      transaction.objectStore('ingredients').put(ingredient);
      transaction.objectStore('mealPlans').put(plan);
      transaction.objectStore('menuDecisions').put(decision);
      transaction.oncomplete = resolve;
      transaction.onabort = () => reject(transaction.error);
    });
    old.close();
    expect(await db.readMealPlanningSnapshot('guest')).toEqual({ ingredients: [ingredient], mealPlans: [plan], quantityReviews: [] });
    expect(await db.getMenuDecision('2026-09-14')).toEqual(decision);
    const upgraded = await openRawDatabase('fridgemate-db__guest');
    expect(upgraded.version).toBe(7);
    expect(Array.from(upgraded.objectStoreNames)).toEqual(['ingredients', 'inventoryEvents', 'inventoryQuantities', 'mealPlanPilot', 'mealPlans', 'menuDecisions', 'shoppingEntries']);
    upgraded.close();
  });

  it('upgrades v4 with all existing records unchanged and a separate empty shopping store', async () => {
    const db = await loadIndexedDbModule();
    const old = await new Promise((resolve, reject) => {
      const request = window.indexedDB.open('fridgemate-db__guest', 4);
      request.onupgradeneeded = () => {
        for (const name of ['ingredients', 'mealPlans', 'inventoryQuantities']) request.result.createObjectStore(name, { keyPath: 'id' });
        request.result.createObjectStore('menuDecisions', { keyPath: 'decisionDate' });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const ingredient = createIngredient('old-stock', { consumed: true, memo: '기존 재구매 메모' });
    const mealPlan = { id: 'week:2026-09-21', schemaVersion: 2, memo: '확정 식단 보존' };
    const quantityReview = marker('old-stock', 8);
    const menuDecision = { decisionDate: '2026-09-21', recipeId: 'keep' };
    await new Promise((resolve, reject) => {
      const transaction = old.transaction(['ingredients', 'mealPlans', 'inventoryQuantities', 'menuDecisions'], 'readwrite');
      transaction.objectStore('ingredients').put(ingredient);
      transaction.objectStore('mealPlans').put(mealPlan);
      transaction.objectStore('inventoryQuantities').put(quantityReview);
      transaction.objectStore('menuDecisions').put(menuDecision);
      transaction.oncomplete = resolve;
      transaction.onabort = () => reject(transaction.error);
    });
    old.close();
    expect(await db.readMealPlanningSnapshot()).toEqual({ ingredients: [ingredient], mealPlans: [mealPlan], quantityReviews: [quantityReview] });
    expect(await db.getMenuDecision(menuDecision.decisionDate)).toEqual(menuDecision);
    const upgraded = await openRawDatabase('fridgemate-db__guest');
    expect(upgraded.version).toBe(7);
    expect(Array.from(upgraded.objectStoreNames)).toEqual(['ingredients', 'inventoryEvents', 'inventoryQuantities', 'mealPlanPilot', 'mealPlans', 'menuDecisions', 'shoppingEntries']);
    upgraded.close();
    expect(db.runShoppingTransaction).toBeTypeOf('function');
    expect(await db.runShoppingTransaction('readonly', (store) => store.getAll())).toEqual([]);
    const manual = { id: 'manual:milk', name: '우유', quantityText: '1팩' };
    expect(await db.runShoppingTransaction('readwrite', (store) => store.put(manual))).toBe(manual.id);
    expect(await db.runShoppingTransaction('readonly', (store) => store.get(manual.id))).toEqual(manual);
    expect(await db.readMealPlanningSnapshot()).toEqual({ ingredients: [ingredient], mealPlans: [mealPlan], quantityReviews: [quantityReview] });
  });

  it('isolates shopping entries with the same id across guest and account scopes', async () => {
    const db = await loadIndexedDbModule();
    expect(db.runShoppingTransaction).toBeTypeOf('function');
    for (const scope of ['guest', 'user:alice', 'user:bob']) {
      await db.runShoppingTransaction('readwrite', (store) => store.put({ id: 'manual:milk', scope, name: scope }), { scope });
    }
    expect(await db.runShoppingTransaction('readonly', (store) => store.getAll())).toEqual([{ id: 'manual:milk', scope: 'guest', name: 'guest' }]);
    expect(await db.runShoppingTransaction('readonly', (store) => store.getAll(), 'user:alice')).toEqual([{ id: 'manual:milk', scope: 'user:alice', name: 'user:alice' }]);
    await db.runShoppingTransaction('readwrite', (store) => store.delete('manual:milk'), 'user:alice');
    expect(await db.runShoppingTransaction('readonly', (store) => store.getAll(), 'user:alice')).toEqual([]);
    expect(await db.runShoppingTransaction('readonly', (store) => store.getAll(), 'user:bob')).toEqual([{ id: 'manual:milk', scope: 'user:bob', name: 'user:bob' }]);
    expect(await db.getAllIngredients()).toEqual([]);
  });

  it('rejects an aborted shopping write even after its request succeeds and preserves the old entry', async () => {
    const db = await loadIndexedDbModule();
    expect(db.runShoppingTransaction).toBeTypeOf('function');
    const original = { id: 'manual:milk', memo: '원래 메모' };
    await db.runShoppingTransaction('readwrite', (store) => store.put(original));
    await expect(db.runShoppingTransaction('readwrite', (store, transaction) => {
      const request = store.put({ ...original, memo: '저장되면 안 됨' });
      request.addEventListener('success', () => transaction.abort());
      return request;
    })).rejects.toThrow();
    expect(await db.runShoppingTransaction('readonly', (store) => store.get(original.id))).toEqual(original);
  });

  it('clears all seven private stores including damaged shopping, receipt and pilot data only for the requested account', async () => {
    const db = await loadIndexedDbModule();
    expect(db.runShoppingTransaction).toBeTypeOf('function');
    for (const scope of ['guest', 'user:alice', 'user:bob']) await seedPrivateStores(db, scope);
    const guestBefore = await privateStoreContents(db, 'guest');
    const bobBefore = await privateStoreContents(db, 'user:bob');
    await db.clearAccountLocalData({ scope: 'user:alice' });
    expect(await privateStoreContents(db, 'user:alice')).toEqual({
      ingredients: [], mealPlans: [], quantityReviews: [], menuDecision: undefined, shoppingEntries: [], inventoryEvents: [], mealPlanPilot: []
    });
    expect(await privateStoreContents(db, 'guest')).toEqual(guestBefore);
    expect(await privateStoreContents(db, 'user:bob')).toEqual(bobBefore);
  });

  it.each(['shoppingEntries', 'inventoryEvents', 'mealPlanPilot'])('rolls back every private store when %s cleanup aborts and clears them together on retry', async (storeName) => {
    const db = await loadIndexedDbModule();
    expect(db.runShoppingTransaction).toBeTypeOf('function');
    await seedPrivateStores(db, 'user:alice');
    const before = await privateStoreContents(db, 'user:alice');
    const raw = await openRawDatabase('fridgemate-db__user_alice');
    const prototype = Object.getPrototypeOf(raw.transaction('shoppingEntries').objectStore('shoppingEntries'));
    const clear = prototype.clear;
    let abortOnce = true;
    vi.spyOn(prototype, 'clear').mockImplementation(function (...args) {
      const request = clear.apply(this, args);
      if (this.name === storeName && abortOnce) {
        abortOnce = false;
        request.addEventListener('success', () => this.transaction.abort());
      }
      return request;
    });
    await expect(db.clearAccountLocalData('user:alice')).rejects.toThrow();
    expect(await privateStoreContents(db, 'user:alice')).toEqual(before);
    await db.clearAccountLocalData('user:alice');
    expect(await privateStoreContents(db, 'user:alice')).toEqual({
      ingredients: [], mealPlans: [], quantityReviews: [], menuDecision: undefined, shoppingEntries: [], inventoryEvents: [], mealPlanPilot: []
    });
    raw.close();
  });

  it.each([
    ['name', 'new name'], ['quantity', '300g'], ['expiryDate', '2026-10-01'], ['purchaseDate', '2026-09-15'],
    ['category', 'meat'], ['storageType', 'freezer'], ['clientId', 'new-client'], ['consumed', true],
    ['createdAt', '2026-09-01T00:00:00.000Z'], ['updatedAt', '2026-09-15T00:00:00.000Z'],
    ['deletedAt', '2026-09-15T00:00:00.000Z']
  ])('invalidates quantity confirmation atomically when raw %s changes', async (field, value) => {
    const db = await loadIndexedDbModule();
    const original = createIngredient('stock');
    await db.saveIngredient(original);
    expect(await getReviews(db)).toEqual([marker('stock')]);
    await putReview(db, marker('stock', 7));
    await db.saveIngredient({ ...original, [field]: value });
    expect(await getReviews(db)).toEqual([marker('stock', 8)]);
  });

  it('keeps confirmations for identical source fields and sync metadata only changes', async () => {
    const db = await loadIndexedDbModule();
    const original = createIngredient('stock');
    await db.saveIngredient(original);
    await putReview(db, marker('stock', 7));
    await db.saveIngredient({ ...original, syncState: 'clean', lastSyncedAt: '2026-09-15T00:00:00.000Z', memo: 'different shopping note' });
    expect(await getReviews(db)).toEqual([marker('stock', 7)]);
    await db.saveIngredient(original);
    expect(await getReviews(db)).toEqual([marker('stock', 7)]);
  });

  it.each(['save', 'saveMany', 'replace', 'delete', 'clear'])('retains monotonic redacted markers across %s and restoration of the same source', async (operation) => {
    const db = await loadIndexedDbModule();
    const original = createIngredient('stock');
    await db.saveIngredient(original);
    await putReview(db, marker('stock', 7));
    if (operation === 'save') await db.saveIngredient({ ...original, quantity: '2 items' });
    if (operation === 'saveMany') await db.saveIngredients([{ ...original, quantity: '2 items' }]);
    if (operation === 'replace') await db.replaceIngredients([]);
    if (operation === 'delete') await db.deleteIngredient('stock');
    if (operation === 'clear') await db.clearIngredients();
    expect(await getReviews(db)).toEqual([marker('stock', 8)]);
    await db.saveIngredient(original);
    expect(await getReviews(db)).toEqual([marker('stock', 9)]);
    expect(await db.getIngredientById('stock')).toEqual(original);
  });

  it('invalidates each batch id once and preserves unaffected review history during replacement', async () => {
    const db = await loadIndexedDbModule();
    await db.saveIngredients([createIngredient('changed'), createIngredient('removed'), createIngredient('same')]);
    await putReview(db, marker('changed', 3));
    await putReview(db, marker('removed', 4));
    await putReview(db, marker('same', 5));
    await db.replaceIngredients([createIngredient('same'), createIngredient('changed', { quantity: '2 items' }), createIngredient('new')]);
    expect(await getReviews(db)).toEqual([marker('changed', 4), marker('new'), marker('removed', 5), marker('same', 5)]);
    expect((await db.getAllIngredients()).map((ingredient) => ingredient.id)).toEqual(['changed', 'new', 'same']);
  });

  it('aborts both raw stock and invalidation if writing a review fails', async () => {
    const db = await loadIndexedDbModule();
    const original = createIngredient('stock');
    await db.saveIngredient(original);
    await putReview(db, marker('stock', 7));
    const raw = await openRawDatabase('fridgemate-db__guest');
    const prototype = Object.getPrototypeOf(raw.transaction('inventoryQuantities').objectStore('inventoryQuantities'));
    const put = prototype.put;
    vi.spyOn(prototype, 'put').mockImplementation(function (...args) {
      if (this.name === 'inventoryQuantities') throw new DOMException('No storage space', 'QuotaExceededError');
      return put.apply(this, args);
    });
    await expect(db.saveIngredient({ ...original, quantity: 'new quantity' })).rejects.toThrow();
    expect(await db.getIngredientById('stock')).toEqual(original);
    expect(await getReviews(db)).toEqual([marker('stock', 7)]);
    raw.close();
  });

  it('clears quantity data on account deletion but not for other scopes', async () => {
    const db = await loadIndexedDbModule();
    for (const scope of ['guest', 'user:alice', 'user:bob']) await db.saveIngredient(createIngredient('stock'), scope);
    expect(await getReviews(db, 'user:alice')).toEqual([marker('stock', 1, 'user:alice')]);
    await db.clearAccountLocalData('user:alice');
    expect(await getReviews(db, 'user:alice')).toEqual([]);
    expect(await getReviews(db, 'user:bob')).toEqual([marker('stock', 1, 'user:bob')]);
    expect(await getReviews(db)).toEqual([marker('stock')]);
  });

  it('reads an empty meal-planning snapshot without inventing inventory or plans', async () => {
    const db = await loadIndexedDbModule();
    expect(db.readMealPlanningSnapshot).toBeTypeOf('function');
    expect(await db.readMealPlanningSnapshot('guest')).toEqual({ ingredients: [], mealPlans: [], quantityReviews: [] });
  });

  it('reads scoped planning data without migrating raw ingredients and retains consumed items', async () => {
    const db = await loadIndexedDbModule();
    const active = createIngredient('active', { quantity: '반 모' });
    const consumed = createIngredient('consumed', { consumed: true, quantity: '다음 구매 2봉', memo: '재구매 메모' });
    const tombstone = createIngredient('deleted', { deletedAt: '2026-09-15T00:00:00.000Z' });
    const guestPlan = { id: 'week:2026-09-14', schemaVersion: 1, legacy: true };
    const userPlan = { id: 'week:2026-09-14', schemaVersion: 2, scope: 'user:alice' };
    await db.saveIngredients([active, consumed]);
    await writeRawIngredient('fridgemate-db__guest', tombstone);
    await db.runMealPlanTransaction('readwrite', (store) => store.put(guestPlan), 'guest');
    await db.saveIngredient(createIngredient('private'), 'user:alice');
    await db.runMealPlanTransaction('readwrite', (store) => store.put(userPlan), 'user:alice');
    expect(db.readMealPlanningSnapshot).toBeTypeOf('function');
    const guest = await db.readMealPlanningSnapshot('guest');
    expect(guest).toMatchObject({ ingredients: [active, consumed], mealPlans: [guestPlan], quantityReviews: expect.any(Array) });
    expect(await db.readMealPlanningSnapshot('user:alice')).toMatchObject({
      ingredients: [createIngredient('private')], mealPlans: [userPlan]
    });
    const raw = await openRawDatabase('fridgemate-db__guest');
    const stored = await new Promise((resolve, reject) => {
      const request = raw.transaction('ingredients').objectStore('ingredients').getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    expect(stored).toEqual([active, consumed, tombstone]);
    expect(await db.runMealPlanTransaction('readonly', (store) => store.getAll())).toEqual([guestPlan]);
    expect(raw.version).toBe(7);
    raw.close();
    guest.ingredients[0].quantity = 'mutated only in the returned snapshot';
    expect((await db.readMealPlanningSnapshot('guest')).ingredients[0].quantity).toBe('반 모');
  });

  it('never mixes inventory and plans across a write queued between the two reads', async () => {
    const db = await loadIndexedDbModule();
    const beforeIngredient = createIngredient('stock', { quantity: '100g' });
    const afterIngredient = createIngredient('stock', { quantity: '200g' });
    const beforePlan = { id: 'week:2026-09-14', revision: 1 };
    const afterPlan = { id: 'week:2026-09-14', revision: 2 };
    await db.saveIngredient(beforeIngredient);
    await db.runMealPlanTransaction('readwrite', (store) => store.put(beforePlan));
    const raw = await openRawDatabase('fridgemate-db__guest');
    const prototype = Object.getPrototypeOf(raw.transaction('ingredients').objectStore('ingredients'));
    const getAll = prototype.getAll;
    let queuedWrite;
    vi.spyOn(prototype, 'getAll').mockImplementation(function (...args) {
      const request = getAll.apply(this, args);
      if (this.name === 'ingredients' && !queuedWrite) {
        queuedWrite = new Promise((resolve, reject) => {
          const transaction = raw.transaction(['ingredients', 'mealPlans'], 'readwrite');
          transaction.objectStore('ingredients').put(afterIngredient);
          transaction.objectStore('mealPlans').put(afterPlan);
          transaction.oncomplete = resolve;
          transaction.onabort = () => reject(transaction.error);
        });
      }
      return request;
    });
    expect(db.readMealPlanningSnapshot).toBeTypeOf('function');
    const snapshot = await db.readMealPlanningSnapshot('guest');
    expect(snapshot).toMatchObject({ ingredients: [beforeIngredient], mealPlans: [beforePlan], quantityReviews: expect.any(Array) });
    await queuedWrite;
    expect(await db.readMealPlanningSnapshot('guest')).toMatchObject({ ingredients: [afterIngredient], mealPlans: [afterPlan] });
    raw.close();
  });

  it('rejects an aborted planning read even after both requests succeeded and allows retry', async () => {
    const db = await loadIndexedDbModule();
    const ingredient = createIngredient('keep');
    const mealPlan = { id: 'week:2026-09-14', revision: 1 };
    await db.saveIngredient(ingredient);
    await db.runMealPlanTransaction('readwrite', (store) => store.put(mealPlan));
    const raw = await openRawDatabase('fridgemate-db__guest');
    const prototype = Object.getPrototypeOf(raw.transaction('mealPlans').objectStore('mealPlans'));
    const getAll = prototype.getAll;
    let abortOnce = true;
    vi.spyOn(prototype, 'getAll').mockImplementation(function (...args) {
      const request = getAll.apply(this, args);
      if (this.name === 'mealPlans' && abortOnce) {
        abortOnce = false;
        request.addEventListener('success', () => this.transaction.abort());
      }
      return request;
    });
    expect(db.readMealPlanningSnapshot).toBeTypeOf('function');
    await expect(db.readMealPlanningSnapshot('guest')).rejects.toThrow();
    expect(await db.readMealPlanningSnapshot('guest')).toMatchObject({ ingredients: [ingredient], mealPlans: [mealPlan] });
    raw.close();
  });

  it('saves and reads a single ingredient in the default guest scope', async () => {
    const db = await loadIndexedDbModule();
    const ingredient = createIngredient('single');

    await db.saveIngredient(ingredient);

    const savedIngredient = await db.getIngredientById('single');
    const allIngredients = await db.getAllIngredients();

    expect(savedIngredient).toEqual(ingredient);
    expect(allIngredients).toHaveLength(1);
    expect(allIngredients[0]).toEqual(ingredient);
  });

  it('saves and reads multiple ingredients', async () => {
    const db = await loadIndexedDbModule();
    const ingredients = [
      createIngredient('bulk-1', { name: 'green-onion' }),
      createIngredient('bulk-2', { name: 'milk', category: 'dairy' }),
      createIngredient('bulk-3', { name: 'pear', category: 'fruit' })
    ];

    await db.saveIngredients(ingredients);

    const allIngredients = await db.getAllIngredients();

    expect(allIngredients).toHaveLength(3);
    expect(allIngredients.map((item) => item.id).sort()).toEqual(['bulk-1', 'bulk-2', 'bulk-3']);
  });

  it('updates an existing ingredient when saving with the same id', async () => {
    const db = await loadIndexedDbModule();

    await db.saveIngredient(createIngredient('update-me', { quantity: '1 item', memo: 'before' }));
    await db.saveIngredient(createIngredient('update-me', { quantity: '3 items', memo: 'after' }));

    const updatedIngredient = await db.getIngredientById('update-me');
    const allIngredients = await db.getAllIngredients();

    expect(updatedIngredient).toMatchObject({
      id: 'update-me',
      quantity: '3 items',
      memo: 'after'
    });
    expect(allIngredients).toHaveLength(1);
  });

  it('deletes an ingredient', async () => {
    const db = await loadIndexedDbModule();

    await db.saveIngredient(createIngredient('delete-me'));
    await db.deleteIngredient('delete-me');

    expect(await db.getIngredientById('delete-me')).toBeUndefined();
    expect(await db.getAllIngredients()).toEqual([]);
  });

  it('returns undefined for a missing id and allows deleting a missing id safely', async () => {
    const db = await loadIndexedDbModule();

    await db.saveIngredient(createIngredient('keep-me'));

    expect(await db.getIngredientById('missing-id')).toBeUndefined();
    await expect(db.deleteIngredient('missing-id')).resolves.toBeUndefined();

    const allIngredients = await db.getAllIngredients();
    expect(allIngredients).toHaveLength(1);
    expect(allIngredients[0].id).toBe('keep-me');
  });

  it('treats saving a missing id as creating a new ingredient', async () => {
    const db = await loadIndexedDbModule();

    await db.saveIngredient(createIngredient('new-id', { name: 'new-ingredient' }));

    expect(await db.getIngredientById('new-id')).toMatchObject({
      id: 'new-id',
      name: 'new-ingredient'
    });
    expect(await db.getAllIngredients()).toHaveLength(1);
  });

  it('starts empty again after reinitializing the database factory', async () => {
    const firstDb = await loadIndexedDbModule();
    await firstDb.saveIngredient(createIngredient('persisted'));
    expect(await firstDb.getAllIngredients()).toHaveLength(1);

    const freshDb = await loadIndexedDbModule();
    expect(await freshDb.getAllIngredients()).toEqual([]);
  });

  it('replaces the local snapshot with the latest ingredient list', async () => {
    const db = await loadIndexedDbModule();

    await db.saveIngredients([createIngredient('old-1'), createIngredient('old-2')]);
    await db.replaceIngredients([
      createIngredient('new-1', { name: 'garlic' }),
      createIngredient('new-2', { name: 'onion' })
    ]);

    const allIngredients = await db.getAllIngredients();

    expect(allIngredients.map((item) => item.id).sort()).toEqual(['new-1', 'new-2']);
  });

  it('keeps guest and authenticated scopes isolated', async () => {
    const db = await loadIndexedDbModule();

    await db.saveIngredient(createIngredient('guest-1', { name: 'guest-item' }), { scope: 'guest' });
    await db.saveIngredient(createIngredient('user-1', { name: 'user-item' }), { scope: 'user:user-1' });

    const guestIngredients = await db.getAllIngredients({ scope: 'guest' });
    const userIngredients = await db.getAllIngredients({ scope: 'user:user-1' });

    expect(guestIngredients.map((item) => item.id)).toEqual(['guest-1']);
    expect(userIngredients.map((item) => item.id)).toEqual(['user-1']);
  });

  it('migrates legacy authenticated records and preserves pending metadata across reads', async () => {
    const db = await loadIndexedDbModule();
    await db.saveIngredient(createIngredient('legacy'), { scope: 'user:user-1' });

    const firstRead = await db.getAllIngredientsForSync({ scope: 'user:user-1' });
    const secondRead = await db.getAllIngredientsForSync({ scope: 'user:user-1' });

    expect(firstRead[0]).toMatchObject({
      id: 'legacy',
      clientId: 'legacy',
      deletedAt: null,
      syncState: 'pendingCreate',
      lastSyncedAt: null
    });
    expect(secondRead).toEqual(firstRead);
  });

  it('keeps tombstones in sync storage but hides them from normal local reads', async () => {
    const db = await loadIndexedDbModule();
    const tombstone = createIngredient('deleted', {
      clientId: 'deleted',
      updatedAt: '2026-08-26T10:00:00.000Z',
      deletedAt: '2026-08-26T10:00:00.000Z',
      syncState: 'pendingDelete'
    });
    await db.saveIngredient(tombstone, { scope: 'user:user-1' });

    expect(await db.getAllIngredients({ scope: 'user:user-1' })).toEqual([]);
    expect(await db.getIngredientById('deleted', { scope: 'user:user-1' })).toBeUndefined();
    expect(await db.getAllIngredientsForSync({ scope: 'user:user-1' })).toEqual([{
      id: 'deleted',
      clientId: 'deleted',
      updatedAt: '2026-08-26T10:00:00.000Z',
      deletedAt: '2026-08-26T10:00:00.000Z',
      syncState: 'pendingDelete'
    }]);
  });

  it('scrubs a legacy full tombstone on first sync read and keeps the rewrite idempotent', async () => {
    const db = await loadIndexedDbModule();
    const scope = { scope: 'user:user-legacy' };
    await db.saveIngredient(createIngredient('legacy-delete'), scope);
    await writeRawIngredient('fridgemate-db__user_user-legacy', createIngredient('legacy-delete', {
      clientId: 'legacy-delete',
      memo: 'private legacy memo',
      createdAt: '2026-08-01T00:00:00.000Z',
      deletedAt: '2026-08-26T10:00:00.000Z'
    }));

    const firstRead = await db.getAllIngredientsForSync(scope);
    const secondRead = await db.getAllIngredientsForSync(scope);

    expect(firstRead).toEqual([{
      id: 'legacy-delete',
      clientId: 'legacy-delete',
      updatedAt: '2026-08-26T10:00:00.000Z',
      deletedAt: '2026-08-26T10:00:00.000Z',
      syncState: 'pendingDelete'
    }]);
    expect(secondRead).toEqual(firstRead);
  });

  it('rejects stale active writes and replacement snapshots over an existing tombstone', async () => {
    const db = await loadIndexedDbModule();
    const scope = { scope: 'user:user-1' };
    await db.saveIngredient(createIngredient('deleted', {
      clientId: 'stable-delete-key',
      updatedAt: '2026-08-26T10:00:00.000Z',
      deletedAt: '2026-08-26T10:00:00.000Z',
      syncState: 'clean'
    }), scope);

    await expect(db.saveIngredient(createIngredient('deleted', {
      clientId: 'stable-delete-key',
      name: 'must-not-return',
      updatedAt: '2026-08-26T11:00:00.000Z'
    }), scope)).rejects.toThrow(/cannot be restored/u);
    await expect(db.replaceIngredients([createIngredient('server-active', {
      clientId: 'stable-delete-key',
      name: 'must-not-return',
      updatedAt: '2026-08-26T12:00:00.000Z'
    })], scope)).rejects.toThrow(/cannot be restored/u);

    await expect(db.replaceIngredients([], scope)).resolves.toBeNull();

    expect(await db.getAllIngredientsForSync(scope)).toEqual([{
      id: 'deleted',
      clientId: 'stable-delete-key',
      updatedAt: '2026-08-26T10:00:00.000Z',
      deletedAt: '2026-08-26T10:00:00.000Z',
      syncState: 'clean'
    }]);
  });

  it('stores menu decisions in the upgraded database without affecting ingredients', async () => {
    const db = await loadIndexedDbModule();
    const decision = {
      decisionDate: '2026-08-30',
      clientId: 'decision-1',
      recipeKey: 'local:recipe-1',
      status: 'selected'
    };

    await db.saveIngredient(createIngredient('ingredient-1'));
    await db.saveMenuDecision(decision);

    expect(await db.getMenuDecision('2026-08-30')).toEqual(decision);
    expect(await db.getAllIngredients()).toHaveLength(1);
    await db.deleteMenuDecision('2026-08-30');
    expect(await db.getMenuDecision('2026-08-30')).toBeUndefined();
  });

  it('isolates guest and authenticated menu decisions', async () => {
    const db = await loadIndexedDbModule();
    await db.saveMenuDecision({ decisionDate: '2026-08-30', clientId: 'guest' }, { scope: 'guest' });
    await db.saveMenuDecision({ decisionDate: '2026-08-30', clientId: 'user' }, { scope: 'user:user-1' });

    expect(await db.getMenuDecision('2026-08-30', { scope: 'guest' })).toMatchObject({ clientId: 'guest' });
    expect(await db.getMenuDecision('2026-08-30', { scope: 'user:user-1' })).toMatchObject({ clientId: 'user' });
  });

  it('closes and deletes an authenticated scope database without deleting guest data', async () => {
    const db = await loadIndexedDbModule();
    await db.saveIngredient(createIngredient('guest-1'), { scope: 'guest' });
    await db.saveIngredient(createIngredient('user-1'), { scope: 'user:user-1' });
    await db.saveIngredient(createIngredient('user-2'), { scope: 'user:user-2' });

    await expect(db.deleteDatabase({ scope: 'user:user-1' })).resolves.toBeUndefined();

    const databaseNames = (await window.indexedDB.databases()).map(({ name }) => name);
    expect(databaseNames).not.toContain('fridgemate-db__user_user-1');
    expect(databaseNames).toContain('fridgemate-db__guest');
    expect(databaseNames).toContain('fridgemate-db__user_user-2');
    expect(await db.getAllIngredients({ scope: 'guest' })).toHaveLength(1);
    expect(await db.getAllIngredients({ scope: 'user:user-2' })).toHaveLength(1);
    expect(await db.getAllIngredients({ scope: 'user:user-1' })).toEqual([]);
  });

  it('can clear scoped records before another connection blocks database deletion', async () => {
    const db = await loadIndexedDbModule();
    await db.saveIngredient(createIngredient('user-1'), { scope: 'user:user-1' });
    await db.saveMenuDecision(
      { decisionDate: '2026-08-30', clientId: 'decision-1' },
      { scope: 'user:user-1' }
    );
    await db.runMealPlanTransaction('readwrite', (store) => store.put({ id: 'week:2026-09-14' }), { scope: 'user:user-1' });
    const blockingConnection = await new Promise((resolve, reject) => {
      const request = window.indexedDB.open('fridgemate-db__user_user-1');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });

    try {
      await db.clearIngredients({ scope: 'user:user-1' });
      await db.clearMenuDecisions({ scope: 'user:user-1' });
      await db.clearMealPlans({ scope: 'user:user-1' });

      expect(await db.getAllIngredients({ scope: 'user:user-1' })).toEqual([]);
      expect(await db.getMenuDecision('2026-08-30', { scope: 'user:user-1' })).toBeUndefined();
      expect(await db.runMealPlanTransaction('readonly', (store) => store.getAll(), { scope: 'user:user-1' })).toEqual([]);
      await expect(db.deleteDatabase({ scope: 'user:user-1' })).rejects.toThrow(/blocked/i);
    } finally {
      blockingConnection.close();
    }
  });
});
