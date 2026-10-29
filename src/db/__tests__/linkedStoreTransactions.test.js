import FDBFactory from 'fake-indexeddb/lib/FDBFactory';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const CASES = [
  {
    name: 'runInventoryReceiptTransaction',
    stores: { ingredients: 'ingredients', quantities: 'inventoryQuantities', shopping: 'shoppingEntries', events: 'inventoryEvents' },
    failedMessage: '구매 반영 저장에 실패했습니다.',
    abortedMessage: '구매 반영 저장이 취소됐습니다.',
  },
  {
    name: 'runMealCookingTransaction',
    stores: { ingredients: 'ingredients', quantities: 'inventoryQuantities', mealPlans: 'mealPlans', events: 'inventoryEvents' },
    failedMessage: '조리 기록 저장에 실패했습니다.',
    abortedMessage: '조리 기록 저장이 취소됐습니다.',
  },
  {
    name: 'runInventoryQuantityTransaction',
    stores: { ingredients: 'ingredients', quantities: 'inventoryQuantities' },
    failedMessage: '재고량 저장에 실패했습니다.',
    abortedMessage: '재고량 저장이 취소됐습니다.',
  },
];

function openRawDatabase(scope) {
  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(`fridgemate-db__${scope.replace(':', '_')}`);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// Read independently of the linked-store wrappers to observe committed state.
async function readStores(scope, names) {
  const database = await openRawDatabase(scope);
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(names, 'readonly');
      const requests = names.map(name => transaction.objectStore(name).getAll());
      transaction.oncomplete = () => resolve(requests.map(request => request.result));
      transaction.onabort = () => reject(transaction.error);
    });
  } finally {
    database.close();
  }
}

describe.each(CASES)('$name preserves the linked-store contract', ({ name, stores, failedMessage, abortedMessage }) => {
  let db;
  const scope = 'user:alice';
  const names = Object.values(stores);
  const rows = names.map(storeName => ({ id: `${storeName}:row`, value: 'saved' }));

  beforeEach(async () => {
    vi.resetModules();
    const factory = new FDBFactory();
    Object.defineProperty(window, 'indexedDB', { configurable: true, writable: true, value: factory });
    vi.stubGlobal('indexedDB', factory);
    db = await import('../indexedDB.js');
    await db.getAllIngredients(scope);
    await db.getAllIngredients('guest');
  });

  afterEach(async () => {
    await Promise.all([db.deleteDatabase(scope), db.deleteDatabase('guest')]);
    vi.unstubAllGlobals();
  });

  function writeRows(linkedStores) {
    let lastRequest;
    Object.keys(stores).forEach((alias, index) => {
      lastRequest = linkedStores[alias].add(rows[index]);
    });
    return lastRequest;
  }

  it('exposes the correct stores and resolves a late result only after an account-scoped commit', async () => {
    let completed = false;
    const result = await db[name]('readwrite', (linkedStores, transaction) => {
      expect(Object.keys(linkedStores)).toEqual(Object.keys(stores));
      const output = { result: 'not committed' };
      writeRows(linkedStores).onsuccess = () => { output.result = 'saved'; };
      transaction.addEventListener('complete', () => { completed = true; });
      return output;
    }, { scope: ' user:alice ' });

    expect(completed).toBe(true);
    expect(result).toBe('saved');
    expect(await readStores(scope, names)).toEqual(rows.map(row => [row]));
    expect(await readStores('guest', names)).toEqual(names.map(() => []));
  });

  it('returns the actual request result after a successful transaction', async () => {
    const result = await db[name]('readwrite', linkedStores => writeRows(linkedStores), scope);
    expect(result).toBe(rows.at(-1).id);
    expect(await readStores(scope, names)).toEqual(rows.map(row => [row]));
  });

  it('rejects writes in readonly transactions without changing any stored rows', async () => {
    await db[name]('readwrite', linkedStores => writeRows(linkedStores), scope);

    await expect(db[name]('readonly', linkedStores => linkedStores.ingredients.put({
      ...rows[0],
      value: 'must not persist'
    }), scope)).rejects.toMatchObject({ name: 'ReadOnlyError' });

    expect(await readStores(scope, names)).toEqual(rows.map(row => [row]));
  });

  it('preserves the original synchronous error and rolls back every queued store write', async () => {
    const error = new Error('caller validation failed');
    await expect(db[name]('readwrite', linkedStores => {
      writeRows(linkedStores);
      throw error;
    }, scope)).rejects.toBe(error);

    expect(await readStores(scope, names)).toEqual(names.map(() => []));
  });

  it('reports the operation-specific cancellation and rolls back successful requests', async () => {
    let requestSucceeded = false;
    await expect(db[name]('readwrite', (linkedStores, transaction) => {
      writeRows(linkedStores).onsuccess = () => {
        requestSucceeded = true;
        transaction.abort();
      };
      return { result: 'must not resolve' };
    }, scope)).rejects.toThrow(abortedMessage);

    expect(requestSucceeded).toBe(true);
    expect(await readStores(scope, names)).toEqual(names.map(() => []));
  });

  it('reports the operation-specific request failure without leaving partial writes', async () => {
    let requestError;
    await expect(db[name]('readwrite', linkedStores => {
      writeRows(linkedStores);
      const duplicate = linkedStores.ingredients.add(rows[0]);
      duplicate.onerror = () => { requestError = duplicate.error.name; };
      return { result: 'must not resolve' };
    }, scope)).rejects.toThrow(failedMessage);

    expect(requestError).toBe('ConstraintError');
    expect(await readStores(scope, names)).toEqual(names.map(() => []));
  });
});
