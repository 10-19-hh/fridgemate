import FDBFactory from 'fake-indexeddb/lib/FDBFactory';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const modules = import.meta.glob('../ingredientImportRepository.js');
const now = '2026-09-28T02:00:00.000Z';
const old = { id: 'old', clientId: 'old-client', name: '두부', quantity: '반 팩', memo: '남겨둔 메모', consumed: false };
const candidate = { id: 'new', name: '두부', quantity: '2팩', category: '기타', storageType: '냉장', purchaseDate: '2026-09-28', expiryDate: '', memo: '', consumed: false };

async function setup() {
  const load = modules['../ingredientImportRepository.js'];
  const repository = load ? await load() : {};
  // Before implementation these assertions, not an import error, establish RED.
  expect(repository.prepareIngredientImport).toBeTypeOf('function');
  expect(repository.commitIngredientImport).toBeTypeOf('function');
  const db = await import('../../../db/indexedDB.js');
  return { ...repository, db };
}

function input(overrides = {}) {
  return { scope: 'guest', items: [candidate], replacements: [], syncEnabled: false, now, ...overrides };
}

async function snapshot(db, scope = 'guest') {
  return db.runInventoryQuantityTransaction('readonly', ({ ingredients, quantities }) => {
    const output = { result: {} };
    const stock = ingredients.getAll();
    const reviews = quantities.getAll();
    stock.onsuccess = () => { output.result.ingredients = stock.result; };
    reviews.onsuccess = () => { output.result.reviews = reviews.result; };
    return output;
  }, scope);
}

async function storePrototype() {
  const database = await new Promise((resolve, reject) => {
    const opening = window.indexedDB.open('fridgemate-db__guest');
    opening.onsuccess = () => resolve(opening.result);
    opening.onerror = () => reject(opening.error);
  });
  const prototype = Object.getPrototypeOf(database.transaction('ingredients').objectStore('ingredients'));
  database.close();
  return prototype;
}

describe('atomic reviewed ingredient import', () => {
  beforeEach(() => {
    vi.resetModules();
    Object.defineProperty(window, 'indexedDB', { configurable: true, value: new FDBFactory() });
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(now));
  });
  afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

  it('prepares a copied, fixed allowlisted payload without importing OCR or credential metadata', async () => {
    const { prepareIngredientImport } = await setup();
    const source = input({ items: [{ ...candidate, rawLine: 'PRIVATE OCR', accessToken: 'PRIVATE TOKEN', learnedCorrection: true,
      correctionSuggestions: [{ source: 'PRIVATE' }], userId: 'OTHER USER' }], replacements: [old] });
    const command = prepareIngredientImport(source);
    source.items[0].name = '바뀜';
    source.replacements[0] = { ...old, memo: '바뀜' };
    expect(command).toEqual({ scope: 'guest', syncEnabled: false, now,
      items: [{ ...candidate, clientId: 'new', createdAt: now, updatedAt: now }], replacements: [old] });
  });

  it('adds and replaces only reviewed rows atomically and invalidates both quantity proofs', async () => {
    const { prepareIngredientImport, commitIngredientImport, db } = await setup();
    const laterSameName = { ...old, id: 'unselected', clientId: 'unselected', memo: '나중에 추가' };
    await db.saveIngredients([old, laterSameName]);
    const command = prepareIngredientImport(input({ replacements: [old] }));
    const result = await commitIngredientImport(command);
    expect(result).toEqual({ ingredients: [command.items[0], laterSameName], syncSnapshot: [command.items[0], laterSameName],
      importedItems: command.items, replayed: false });
    expect(await snapshot(db)).toEqual({ ingredients: result.ingredients, reviews: [
      { schemaVersion: 1, id: 'new', scope: 'guest', revision: 1, status: 'unverified' },
      { schemaVersion: 1, id: 'old', scope: 'guest', revision: 2, status: 'unverified' },
      { schemaVersion: 1, id: 'unselected', scope: 'guest', revision: 1, status: 'unverified' },
    ] });
  });

  it('retains only compact pending tombstones in backend sync mode', async () => {
    const { prepareIngredientImport, commitIngredientImport, db } = await setup();
    const original = { ...old, userId: 'alice' };
    await db.saveIngredient(original, 'user:alice');
    const command = prepareIngredientImport(input({ scope: 'user:alice', replacements: [original], syncEnabled: true }));
    const result = await commitIngredientImport(command);
    expect(command.items[0]).toEqual({ ...candidate, clientId: 'new', createdAt: now, updatedAt: now,
      deletedAt: null, syncState: 'pendingCreate', lastSyncedAt: now });
    expect(result.ingredients).toEqual(command.items);
    expect(result.syncSnapshot).toEqual([command.items[0], { id: 'old', clientId: 'old-client', userId: 'alice',
      updatedAt: now, deletedAt: now, syncState: 'pendingDelete' }]);
  });

  it.each(['memo', 'quantity', 'missing'])('rejects a changed replacement %s without partial writes', async (change) => {
    const { prepareIngredientImport, commitIngredientImport, db } = await setup();
    await db.saveIngredient(old);
    const command = prepareIngredientImport(input({ replacements: [old] }));
    if (change === 'missing') await db.deleteIngredient(old.id);
    else await db.saveIngredient({ ...old, [change]: '다른 값' });
    const before = await snapshot(db);
    await expect(commitIngredientImport(command)).rejects.toThrow('바뀌었');
    expect(await snapshot(db)).toEqual(before);
  });

  it.each([false, true])('replays concurrent/repeated confirmed commands without another write (sync=%s)', async (syncEnabled) => {
    const { prepareIngredientImport, commitIngredientImport, db } = await setup();
    await db.saveIngredient(old);
    const command = prepareIngredientImport(input({ replacements: [old], syncEnabled }));
    const results = await Promise.all([commitIngredientImport(command), commitIngredientImport(command)]);
    expect(results.map((result) => result.replayed)).toEqual([false, true]);
    const before = await snapshot(db);
    const prototype = await storePrototype();
    const put = vi.spyOn(prototype, 'put');
    const add = vi.spyOn(prototype, 'add');
    const remove = vi.spyOn(prototype, 'delete');
    expect((await commitIngredientImport(command)).replayed).toBe(true);
    expect(put).not.toHaveBeenCalled();
    expect(add).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
    expect(await snapshot(db)).toEqual(before);
  });

  it('preserves a later confirmed quantity on replay instead of invalidating it', async () => {
    const { prepareIngredientImport, commitIngredientImport, db } = await setup();
    const command = prepareIngredientImport(input());
    await commitIngredientImport(command);
    const { saveInventoryQuantity } = await import('../../mealPlans/inventoryQuantityRepository.js');
    const { getInventorySourceToken } = await import('../../mealPlans/inventoryQuantityDomain.js');
    const review = await saveInventoryQuantity({ scope: 'guest', ingredientId: 'new', expectedRevision: 1,
      expectedSourceToken: getInventorySourceToken(command.items[0]),
      values: { name: '두부', amount: 600, unit: 'g', preparationState: 'raw' } });
    expect((await commitIngredientImport(command)).replayed).toBe(true);
    expect((await snapshot(db)).reviews).toEqual([review]);
  });

  it.each(['partial', 'edited', 'deleted'])('does not overwrite or resurrect a %s previous import', async (kind) => {
    const { prepareIngredientImport, commitIngredientImport, db } = await setup();
    const command = prepareIngredientImport(input({ items: [candidate, { ...candidate, id: 'new-2' }] }));
    if (kind === 'partial') await db.saveIngredient(command.items[0]);
    else {
      await commitIngredientImport(command);
      if (kind === 'edited') await db.saveIngredient({ ...command.items[0], memo: '변경' });
      else await db.deleteIngredient(command.items[0].id);
    }
    const before = await snapshot(db);
    await expect(commitIngredientImport(command)).rejects.toThrow();
    expect(await snapshot(db)).toEqual(before);
  });

  it.each([
    { id: 'new', clientId: 'alias' }, { id: 'other', clientId: 'new' },
    { id: 'new', clientId: 'alias', deletedAt: now }, { id: 'other', clientId: 'new', deletedAt: now },
  ])('rejects live or deleted id/clientId collisions: %j', async (identity) => {
    const { prepareIngredientImport, commitIngredientImport, db } = await setup();
    await db.saveIngredient({ ...old, ...identity });
    const before = await snapshot(db);
    await expect(commitIngredientImport(prepareIngredientImport(input()))).rejects.toThrow();
    expect(await snapshot(db)).toEqual(before);
  });

  it('rejects an orphan revision after deletion rather than resurrecting a removed id', async () => {
    const { prepareIngredientImport, commitIngredientImport, db } = await setup();
    await db.saveIngredient(candidate);
    await db.deleteIngredient('new');
    const before = await snapshot(db);
    await expect(commitIngredientImport(prepareIngredientImport(input()))).rejects.toThrow();
    expect(await snapshot(db)).toEqual(before);
  });

  it.each([
    { scope: ['guest'] }, { scope: 'user:a:b' }, { items: [] }, { items: Array(1) },
    { items: [candidate, candidate] }, { items: [{ ...candidate, clientId: 'other' }] },
    { replacements: [old, old] }, { replacements: [{ ...old, clientId: 'new' }] },
    { replacements: [{ ...old, deletedAt: now }] }, { now: 'yesterday' }, { syncEnabled: 'true' },
  ])('rejects invalid preparation without exposing input (%j)', async (overrides) => {
    const { prepareIngredientImport } = await setup();
    expect(() => prepareIngredientImport(input(overrides))).toThrow();
  });

  it('rejects modified command fields rather than storing credentials added after preparation', async () => {
    const { prepareIngredientImport, commitIngredientImport, db } = await setup();
    const command = prepareIngredientImport(input());
    command.items[0].accessToken = 'PRIVATE TOKEN';
    await expect(commitIngredientImport(command)).rejects.toThrow();
    expect(await snapshot(db)).toEqual({ ingredients: [], reviews: [] });
  });

  it('compares sparse legacy metadata without overlooking a newly filled slot', async () => {
    const { prepareIngredientImport, commitIngredientImport, db } = await setup();
    const original = { ...old, legacyMetadata: Array(1) };
    await db.saveIngredient(original);
    const command = prepareIngredientImport(input({ replacements: [original] }));
    await db.saveIngredient({ ...original, legacyMetadata: ['new private note'] });
    const before = await snapshot(db);
    await expect(commitIngredientImport(command)).rejects.toThrow('바뀌었');
    expect(await snapshot(db)).toEqual(before);
  });

  it('compares legacy metadata when a formerly present array slot becomes sparse', async () => {
    const { prepareIngredientImport, commitIngredientImport, db } = await setup();
    const original = { ...old, legacyMetadata: ['previous note'] };
    await db.saveIngredient(original);
    const command = prepareIngredientImport(input({ replacements: [original] }));
    await db.saveIngredient({ ...original, legacyMetadata: Array(1) });
    const before = await snapshot(db);
    await expect(commitIngredientImport(command)).rejects.toThrow('바뀌었');
    expect(await snapshot(db)).toEqual(before);
  });

  it('rejects candidates explicitly marked as belonging to another scope before stripping metadata', async () => {
    const { prepareIngredientImport } = await setup();
    expect(() => prepareIngredientImport(input({ items: [{ ...candidate, scope: 'user:other' }] }))).toThrow();
    expect(prepareIngredientImport(input({ items: [{ ...candidate, scope: 'guest' }] })).items[0]).not.toHaveProperty('scope');
  });

  it('compares own fields on legacy metadata arrays, not only indexed elements', async () => {
    const { prepareIngredientImport, commitIngredientImport, db } = await setup();
    const metadata = ['same'];
    metadata.note = 'original';
    const original = { ...old, metadata };
    await db.saveIngredient(original);
    const command = prepareIngredientImport(input({ replacements: [original] }));
    const changedMetadata = ['same'];
    changedMetadata.note = 'changed';
    await db.saveIngredient({ ...old, metadata: changedMetadata });
    const before = await snapshot(db);
    await expect(commitIngredientImport(command)).rejects.toThrow('바뀌었');
    expect(await snapshot(db)).toEqual(before);
  });

  it('generates a missing identity only once during preparation and never during retries', async () => {
    const { prepareIngredientImport, commitIngredientImport } = await setup();
    const random = vi.spyOn(crypto, 'randomUUID').mockReturnValue('generated-id');
    const command = prepareIngredientImport(input({ items: [{ name: '두부', quantity: '2팩' }] }));
    expect(command.items[0]).toEqual({ id: 'generated-id', clientId: 'generated-id', name: '두부', quantity: '2팩',
      consumed: false, createdAt: now, updatedAt: now });
    await commitIngredientImport(command);
    vi.setSystemTime(new Date('2026-09-29T02:00:00.000Z'));
    const result = await commitIngredientImport(command);
    expect(result.replayed).toBe(true);
    expect(result.importedItems[0].createdAt).toBe(now);
    expect(random).toHaveBeenCalledTimes(1);
  });

  it.each(['foreign', 'malformed'])('preserves all records when the touched quantity review is %s', async (kind) => {
    const { prepareIngredientImport, commitIngredientImport, db } = await setup();
    await db.saveIngredient(old);
    const review = { schemaVersion: 1, id: 'old', scope: kind === 'foreign' ? 'user:other' : 'guest',
      status: 'unverified', revision: kind === 'malformed' ? -1 : 1 };
    await db.runInventoryQuantityTransaction('readwrite', ({ quantities }) => quantities.put(review));
    const before = await snapshot(db);
    await expect(commitIngredientImport(prepareIngredientImport(input({ replacements: [old] })))).rejects.toThrow();
    expect(await snapshot(db)).toEqual(before);
  });

  it('captures the submitted command before asynchronous reads and keeps scopes separate', async () => {
    const { prepareIngredientImport, commitIngredientImport, db } = await setup();
    await db.saveIngredient(old, 'user:alice');
    const command = prepareIngredientImport(input({ scope: 'user:alice', replacements: [old] }));
    const pending = commitIngredientImport(command);
    command.scope = 'guest';
    command.items[0].name = '변경';
    command.replacements[0].memo = '변경';
    const result = await pending;
    expect(result.importedItems[0].name).toBe('두부');
    expect((await snapshot(db, 'user:alice')).ingredients).toEqual(result.ingredients);
    expect(await snapshot(db)).toEqual({ ingredients: [], reviews: [] });
  });

  it.each([false, true])('aborts a stale session before writes or replay acknowledgement (replay=%s)', async (replay) => {
    const { prepareIngredientImport, commitIngredientImport, db } = await setup();
    const command = prepareIngredientImport(input());
    if (replay) await commitIngredientImport(command);
    const before = await snapshot(db);
    await expect(commitIngredientImport(command, { isCurrent: () => false })).rejects.toThrow();
    expect(await snapshot(db)).toEqual(before);
  });

  it('checks the session after queued database reads, not only before opening the database', async () => {
    const { prepareIngredientImport, commitIngredientImport, db } = await setup();
    await db.saveIngredient(old);
    const prototype = await storePrototype();
    const getAll = prototype.getAll;
    let current = true;
    let reads = 0;
    vi.spyOn(prototype, 'getAll').mockImplementation(function (...args) {
      const request = getAll.apply(this, args);
      request.addEventListener('success', () => { reads += 1; if (reads === 2) current = false; });
      return request;
    });
    const guard = vi.fn(() => current);
    await expect(commitIngredientImport(prepareIngredientImport(input({ replacements: [old] })), { isCurrent: guard })).rejects.toThrow();
    expect(guard).toHaveBeenCalledTimes(1);
    expect((await snapshot(db)).ingredients).toEqual([old]);
  });

  it('does not acknowledge success when a final successful request is followed by transaction abort', async () => {
    const { prepareIngredientImport, commitIngredientImport, db } = await setup();
    await db.saveIngredient(old);
    const before = await snapshot(db);
    const prototype = await storePrototype();
    const put = prototype.put;
    vi.spyOn(prototype, 'put').mockImplementation(function (...args) {
      const request = put.apply(this, args);
      if (this.name === 'inventoryQuantities' && args[0].id === 'old') {
        request.addEventListener('success', () => this.transaction.abort());
      }
      return request;
    });
    await expect(commitIngredientImport(prepareIngredientImport(input({ replacements: [old] })))).rejects.toThrow();
    expect(await snapshot(db)).toEqual(before);
  });

  it('never reflects raw database or callback error details', async () => {
    const { prepareIngredientImport, commitIngredientImport, db } = await setup();
    const command = prepareIngredientImport(input());
    await expect(commitIngredientImport(command, { isCurrent: () => { throw new Error('PRIVATE USER'); } }))
      .rejects.toThrow('가져오기를 시작한 계정 상태가 바뀌었습니다. 다시 확인해주세요.');
    const prototype = await storePrototype();
    vi.spyOn(prototype, 'add').mockImplementation(() => { throw new Error('PRIVATE USER'); });
    await expect(commitIngredientImport(command))
      .rejects.toThrow('재료 가져오기를 저장하지 못했습니다. 같은 내용을 다시 시도해주세요.');
    expect(await snapshot(db)).toEqual({ ingredients: [], reviews: [] });
  });

  it.each(['add', 'delete', 'quantity', 'tombstone'])('rolls back every store when the %s write aborts and retries the same command', async (stage) => {
    const { prepareIngredientImport, commitIngredientImport, db } = await setup();
    await db.saveIngredient(old);
    const command = prepareIngredientImport(input({ replacements: [old], syncEnabled: stage === 'tombstone' }));
    const before = await snapshot(db);
    const prototype = await storePrototype();
    const method = stage === 'add' ? 'add' : stage === 'delete' ? 'delete' : 'put';
    const original = prototype[method];
    const spy = vi.spyOn(prototype, method).mockImplementation(function (...args) {
      const result = original.apply(this, args);
      const matches = stage !== 'quantity' && stage !== 'tombstone'
        || this.name === (stage === 'quantity' ? 'inventoryQuantities' : 'ingredients');
      if (matches) this.transaction.abort();
      return result;
    });
    await expect(commitIngredientImport(command)).rejects.toThrow();
    spy.mockRestore();
    expect(await snapshot(db)).toEqual(before);
    expect((await commitIngredientImport(command)).replayed).toBe(false);
    expect((await commitIngredientImport(command)).replayed).toBe(true);
  });
});
