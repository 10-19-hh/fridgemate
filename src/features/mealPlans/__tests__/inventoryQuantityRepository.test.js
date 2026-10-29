import FDBFactory from 'fake-indexeddb/lib/FDBFactory';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const values = { name: '닭고기', amount: 300, unit: 'g', preparationState: 'raw' };
const stock = { id: 'stock', name: '닭고기', quantity: '반 팩', expiryDate: '2026-09-30', consumed: false };

async function setup(scope = 'guest', ingredient = stock) {
  const repository = await import('../inventoryQuantityRepository.js');
  expect(repository.getInventoryQuantitySnapshot).toBeTypeOf('function');
  expect(repository.saveInventoryQuantity).toBeTypeOf('function');
  expect(repository.revokeInventoryQuantity).toBeTypeOf('function');
  const db = await import('../../../db/indexedDB.js');
  const domain = await import('../inventoryQuantityDomain.js');
  await db.saveIngredient(ingredient, scope);
  const request = {
    scope, ingredientId: ingredient.id, expectedSourceToken: domain.getInventorySourceToken(ingredient), expectedRevision: 1, values
  };
  return { repository, db, domain, request };
}

describe('inventory quantity repository', () => {
  beforeEach(() => {
    vi.resetModules();
    Object.defineProperty(window, 'indexedDB', { configurable: true, value: new FDBFactory() });
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-15T00:00:00.000Z'));
  });
  afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

  it('rejects an array-shaped scope before an empty database can fall back to guest', async () => {
    const repository = await import('../inventoryQuantityRepository.js');
    await expect(repository.getInventoryQuantitySnapshot({ scope: ['user:alice'] })).rejects.toThrow();
  });

  it('does not trust raw top-level quantity proof without a verified sidecar', async () => {
    const raw = { ...stock, amount: 999, unit: 'g', ingredientKey: 'food:닭고기', preparationState: 'raw', quantityStatus: 'verified' };
    const { repository } = await setup('guest', raw);
    const snapshot = await repository.getInventoryQuantitySnapshot('guest');
    expect(snapshot.scope).toBe('guest');
    expect(snapshot.ingredients).toEqual([raw]);
    expect(snapshot.inventory[0].quantityStatus).toBe('unverified');
    expect(snapshot.inventory[0].amount).toBeNull();
    expect(snapshot.quantityReviews).toEqual([{ schemaVersion: 1, id: 'stock', scope: 'guest', revision: 1, status: 'unverified' }]);
  });

  it('saves a scoped review and projects it without changing raw quantity or memo', async () => {
    const raw = { ...stock, memo: '장보기 메모 그대로' };
    const { repository, db, request } = await setup('guest', raw);
    const saved = await repository.saveInventoryQuantity(request);
    expect(saved).toMatchObject({ schemaVersion: 1, id: 'stock', scope: 'guest', revision: 2, status: 'verified', amount: 300, unit: 'g' });
    const snapshot = await repository.getInventoryQuantitySnapshot('guest');
    expect(snapshot.quantityReviews).toEqual([saved]);
    expect(snapshot.inventory[0]).toMatchObject({ id: 'stock', ingredientKey: 'food:닭고기', amount: 300, unit: 'g', quantityStatus: 'verified' });
    expect(await db.getIngredientById('stock')).toEqual(raw);
  });

  it('atomically accepts only one concurrent confirmation using the same revision', async () => {
    const { repository, request } = await setup();
    const results = await Promise.allSettled([
      repository.saveInventoryQuantity(request),
      repository.saveInventoryQuantity({ ...request, values: { ...values, amount: 400 } })
    ]);
    expect(results.map((result) => result.status)).toEqual(['fulfilled', 'rejected']);
    const snapshot = await repository.getInventoryQuantitySnapshot();
    expect(snapshot.inventory[0].amount).toBe(300);
    expect(snapshot.quantityReviews[0].revision).toBe(2);
  });

  it('rejects a changed source even if the caller knows the current review revision', async () => {
    const { repository, db, request } = await setup();
    await db.saveIngredient({ ...stock, quantity: '새로 산 팩' });
    await expect(repository.saveInventoryQuantity({ ...request, expectedRevision: 2 })).rejects.toThrow();
    expect((await repository.getInventoryQuantitySnapshot()).quantityReviews[0]).toMatchObject({ revision: 2, status: 'unverified' });
  });

  it.each(['edit and restore', 'delete and recreate'])('rejects an old confirmation after %s of the same source payload', async (operation) => {
    const { repository, db, request } = await setup();
    if (operation === 'edit and restore') await db.saveIngredient({ ...stock, quantity: 'different' });
    else await db.deleteIngredient('stock');
    await db.saveIngredient(stock);
    await expect(repository.saveInventoryQuantity(request)).rejects.toThrow();
    expect((await repository.getInventoryQuantitySnapshot()).quantityReviews[0]).toMatchObject({ revision: 3, status: 'unverified' });
    await expect(repository.saveInventoryQuantity({ ...request, expectedRevision: 3 })).resolves.toMatchObject({ revision: 4, status: 'verified' });
  });

  it('revokes a confirmed amount with a redacted newer marker and preserves raw stock', async () => {
    const { repository, db, request } = await setup();
    await repository.saveInventoryQuantity(request);
    const revoked = await repository.revokeInventoryQuantity({ ...request, expectedRevision: 2 });
    expect(revoked).toEqual({ schemaVersion: 1, id: 'stock', scope: 'guest', revision: 3, status: 'unverified' });
    expect((await repository.getInventoryQuantitySnapshot()).inventory[0].quantityStatus).toBe('unverified');
    expect(await db.getIngredientById('stock')).toEqual(stock);
    await expect(repository.revokeInventoryQuantity({ ...request, expectedRevision: 2 })).rejects.toThrow();
  });

  it.each([undefined, null, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])('rejects invalid expected revision %s without changing the review', async (expectedRevision) => {
    const { repository, request } = await setup();
    const before = await repository.getInventoryQuantitySnapshot();
    await expect(repository.saveInventoryQuantity({ ...request, expectedRevision })).rejects.toThrow();
    await expect(repository.revokeInventoryQuantity({ ...request, expectedRevision })).rejects.toThrow();
    expect(await repository.getInventoryQuantitySnapshot()).toEqual(before);
  });

  it.each(['consumed', 'deleted', 'missing'])('refuses confirmation and revocation for %s raw stock', async (state) => {
    const { repository, db, request } = await setup();
    if (state === 'consumed') await db.saveIngredient({ ...stock, consumed: true });
    if (state === 'deleted') await db.saveIngredient({ ...stock, deletedAt: '2026-09-15T01:00:00.000Z' });
    if (state === 'missing') await db.deleteIngredient('stock');
    const before = await repository.getInventoryQuantitySnapshot();
    await expect(repository.saveInventoryQuantity({ ...request, expectedRevision: 2 })).rejects.toThrow();
    await expect(repository.revokeInventoryQuantity({ ...request, expectedRevision: 2 })).rejects.toThrow();
    expect(await repository.getInventoryQuantitySnapshot()).toEqual(before);
  });

  it('keeps guest and account quantities separate and rejects malformed scope', async () => {
    const { repository, db, request } = await setup();
    await db.saveIngredient(stock, 'user:alice');
    await repository.saveInventoryQuantity({ ...request, scope: 'user:alice' });
    expect((await repository.getInventoryQuantitySnapshot('guest')).inventory[0].quantityStatus).toBe('unverified');
    expect((await repository.getInventoryQuantitySnapshot('user:alice')).inventory[0].quantityStatus).toBe('verified');
    await expect(repository.getInventoryQuantitySnapshot('user:a:b')).rejects.toThrow();
    await expect(repository.saveInventoryQuantity({ ...request, scope: 'user:a:b' })).rejects.toThrow();
  });

  it.each(['foreign', 'future', 'malformed'])('fails closed on a %s stored review rather than ignoring it', async (kind) => {
    const { repository, db, request } = await setup();
    const review = await repository.saveInventoryQuantity(request);
    const corrupted = { ...review };
    if (kind === 'foreign') corrupted.scope = 'user:alice';
    if (kind === 'future') corrupted.schemaVersion = 9;
    if (kind === 'malformed') corrupted.amount = -1;
    await db.runInventoryQuantityTransaction('readwrite', ({ quantities }) => quantities.put(corrupted), 'guest');
    await expect(repository.getInventoryQuantitySnapshot()).rejects.toThrow();
    await expect(repository.saveInventoryQuantity({ ...request, expectedRevision: 2 })).rejects.toThrow();
    await expect(repository.revokeInventoryQuantity({ ...request, expectedRevision: 2 })).rejects.toThrow();
    expect(await db.runInventoryQuantityTransaction('readonly', ({ quantities }) => quantities.get('stock'))).toEqual(corrupted);
  });

  it('preserves a previous review when the transaction aborts and succeeds on retry', async () => {
    const { repository, db, request } = await setup();
    const first = await repository.saveInventoryQuantity(request);
    const raw = await new Promise((resolve) => {
      const opening = window.indexedDB.open('fridgemate-db__guest');
      opening.onsuccess = () => resolve(opening.result);
    });
    const prototype = Object.getPrototypeOf(raw.transaction('inventoryQuantities').objectStore('inventoryQuantities'));
    const put = prototype.put;
    vi.spyOn(prototype, 'put').mockImplementationOnce(function (...args) {
      const result = put.apply(this, args);
      this.transaction.abort();
      return result;
    });
    await expect(repository.saveInventoryQuantity({ ...request, expectedRevision: 2, values: { ...values, amount: 400 } })).rejects.toThrow();
    expect((await repository.getInventoryQuantitySnapshot()).quantityReviews).toEqual([first]);
    expect(await db.getIngredientById('stock')).toEqual(stock);
    await expect(repository.saveInventoryQuantity({ ...request, expectedRevision: 2 })).resolves.toMatchObject({ revision: 3 });
    raw.close();
  });
});
