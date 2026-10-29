import FDBFactory from 'fake-indexeddb/lib/FDBFactory';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const STORE_NAMES = ['ingredients', 'inventoryQuantities', 'mealPlans', 'inventoryEvents'];
const BEFORE = {
  ingredients: [{ id: 'chicken', name: '닭고기', quantity: '300g', consumed: false }],
  inventoryQuantities: [{ id: 'chicken', amount: 300, unit: 'g', revision: 2 }],
  mealPlans: [{ id: 'week:2026-09-14', status: 'planned', revision: 4 }],
  inventoryEvents: [{ id: 'receipt:old', kind: 'receipt', purchaseNoteId: 'purchase:old' }]
};
const AFTER = {
  ingredients: [{ id: 'chicken', name: '닭고기', quantity: '150g', consumed: false }],
  inventoryQuantities: [{ id: 'chicken', amount: 150, unit: 'g', revision: 3 }],
  mealPlans: [{ id: 'week:2026-09-14', status: 'cooked', revision: 5 }],
  inventoryEvents: [{ id: 'consumption:cook-one', kind: 'consumption', amount: 150 }, ...BEFORE.inventoryEvents]
};

function openRawDatabase(scope = 'guest') {
  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(`fridgemate-db__${scope}`);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function seed(db, scope = 'guest') {
  await db.getAllIngredients(scope);
  const database = await openRawDatabase(scope);
  try {
    await new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAMES, 'readwrite');
      for (const name of STORE_NAMES) {
        BEFORE[name].forEach((record) => transaction.objectStore(name).put(record));
      }
      transaction.oncomplete = resolve;
      transaction.onabort = () => reject(transaction.error);
    });
  } finally {
    database.close();
  }
}

// Independent reads prove what was committed rather than querying through the helper under test.
async function snapshot(scope = 'guest') {
  const database = await openRawDatabase(scope);
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAMES, 'readonly');
      const requests = STORE_NAMES.map((name) => transaction.objectStore(name).getAll());
      transaction.oncomplete = () => resolve(Object.fromEntries(STORE_NAMES.map((name, index) => [name, requests[index].result])));
      transaction.onabort = () => reject(transaction.error);
    });
  } finally {
    database.close();
  }
}

function writeCooking(stores) {
  stores.ingredients.put(AFTER.ingredients[0]);
  stores.quantities.put(AFTER.inventoryQuantities[0]);
  stores.mealPlans.put(AFTER.mealPlans[0]);
  return stores.events.add(AFTER.inventoryEvents[0]);
}

function run(db, ...args) {
  expect(db.runMealCookingTransaction).toBeTypeOf('function');
  return db.runMealCookingTransaction(...args);
}

describe('atomic meal cooking transaction', () => {
  let db;

  beforeEach(async () => {
    vi.resetModules();
    const factory = new FDBFactory();
    Object.defineProperty(window, 'indexedDB', { configurable: true, writable: true, value: factory });
    vi.stubGlobal('indexedDB', factory);
    db = await import('../indexedDB.js');
    await seed(db);
  });

  afterEach(async () => {
    await Promise.all(['guest', 'user-alice', 'user-bob'].map((scope) => db.deleteDatabase(scope)));
    vi.unstubAllGlobals();
  });

  it('commits inventory, reviewed quantity, meal state and event before resolving the final result', async () => {
    let transactionCompleted = false;
    const result = await run(db, 'readwrite', (stores, transaction) => {
      const output = { result: 'not yet written' };
      const lastWrite = writeCooking(stores);
      lastWrite.onsuccess = () => { output.result = { eventId: 'consumption:cook-one', amount: 150 }; };
      transaction.addEventListener('complete', () => { transactionCompleted = true; });
      return output;
    });

    expect(transactionCompleted).toBe(true);
    expect(result).toEqual({ eventId: 'consumption:cook-one', amount: 150 });
    expect(await snapshot()).toEqual(AFTER);
  });

  it('rolls back every queued write when the handler throws synchronously', async () => {
    const error = new Error('The cooking record no longer matches the confirmed meal.');
    await expect(run(db, 'readwrite', (stores) => {
      writeCooking(stores);
      throw error;
    })).rejects.toBe(error);

    expect(await snapshot()).toEqual(BEFORE);
  });

  it('rolls back even successful requests when the handler aborts after reading or writing', async () => {
    let eventWriteSucceeded = false;
    await expect(run(db, 'readwrite', (stores, transaction) => {
      const lastWrite = writeCooking(stores);
      lastWrite.onsuccess = () => {
        eventWriteSucceeded = true;
        transaction.abort();
      };
      return { result: 'must not be returned' };
    })).rejects.toThrow();

    expect(eventWriteSucceeded).toBe(true);
    expect(await snapshot()).toEqual(BEFORE);
  });

  it('rejects an asynchronous event write failure without leaving partial cooking state', async () => {
    let eventWriteSucceeded = false;
    let writeErrorName;
    await expect(run(db, 'readwrite', (stores) => {
      writeCooking(stores).onsuccess = () => { eventWriteSucceeded = true; };
      const duplicate = stores.events.add({ id: 'receipt:old', kind: 'consumption', amount: 999 });
      duplicate.onerror = () => { writeErrorName = duplicate.error.name; };
      return { result: 'must not be returned' };
    })).rejects.toThrow();

    expect(eventWriteSucceeded).toBe(true);
    expect(writeErrorName).toBe('ConstraintError');
    expect(await snapshot()).toEqual(BEFORE);
  });

  it('reads the result of the actual IndexedDB request after completion', async () => {
    expect(await run(db, 'readonly', ({ mealPlans }) => mealPlans.get('week:2026-09-14')))
      .toEqual({ id: 'week:2026-09-14', status: 'planned', revision: 4 });
    expect(await snapshot()).toEqual(BEFORE);
  });

  it('honors readonly mode instead of reporting a successful write', async () => {
    await expect(run(db, 'readonly', (stores) => writeCooking(stores))).rejects.toMatchObject({ name: 'ReadOnlyError' });
    expect(await snapshot()).toEqual(BEFORE);
  });

  it('keeps all four stores separate for guest and accounts while accepting existing scoped options', async () => {
    await seed(db, 'user-alice');
    await seed(db, 'user-bob');
    await run(db, 'readwrite', writeCooking, { scope: ' user-alice ' });

    expect(await snapshot('user-alice')).toEqual(AFTER);
    expect(await snapshot('user-bob')).toEqual(BEFORE);
    expect(await snapshot()).toEqual(BEFORE);
    expect(await run(db, 'readonly', ({ quantities }) => quantities.get('chicken'), ' user-alice '))
      .toEqual({ id: 'chicken', amount: 150, unit: 'g', revision: 3 });
  });
});
