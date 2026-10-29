import { describe, expect, it } from 'vitest';
import {
  assertInventoryQuantityReview, createInventoryQuantityReview, getInventorySourceToken,
  invalidateInventoryQuantityReview, projectInventoryQuantity,
} from '../inventoryQuantityDomain.js';

const NOW = '2026-09-15T08:00:00.000Z';
function stock(overrides = {}) {
  return { id: 'tofu-1', clientId: 'tofu-client', name: '연두부', quantity: '반 모',
    expiryDate: '2026-09-20', purchaseDate: '2026-09-14', storageType: 'fridge', category: 'protein',
    consumed: false, createdAt: '2026-09-14T00:00:00Z', updatedAt: '2026-09-15T00:00:00Z',
    memo: '남은 두부', ...overrides };
}
const values = { name: '연두부', amount: 150, unit: 'g', preparationState: 'as-sold' };
function review(overrides = {}) {
  return { schemaVersion: 1, id: 'tofu-1', scope: 'guest', revision: 1, status: 'verified',
    sourceToken: getInventorySourceToken(stock()), ingredientKey: 'food:연두부',
    ...values, confirmedAt: NOW, ...overrides };
}
function create(options = {}) {
  return createInventoryQuantityReview({ ingredient: stock(), scope: 'guest', values, revision: 1, now: NOW, ...options });
}

describe('inventory quantity confirmation contract', () => {
  it('records explicitly confirmed quantities separately from the unchanged raw label', () => {
    const original = Object.freeze(stock());
    expect(create({ ingredient: original })).toMatchObject({
      id: 'tofu-1', scope: 'guest', revision: 1, status: 'verified',
      name: '연두부', ingredientKey: 'food:연두부', amount: 150, unit: 'g',
      preparationState: 'as-sold', confirmedAt: NOW,
    });
    expect(original.quantity).toBe('반 모');
    expect(original.memo).toBe('남은 두부');
  });

  it('binds quantity confirmation to the raw source fields but not transient sync metadata', () => {
    const first = getInventorySourceToken(stock());
    expect(typeof first).toBe('string');
    expect(getInventorySourceToken(stock({ syncState: 'clean', lastSyncedAt: NOW }))).toBe(first);
    expect(getInventorySourceToken(stock({ quantity: '한 모' }))).not.toBe(first);
    expect(getInventorySourceToken(stock({ updatedAt: NOW }))).not.toBe(first);
    expect(getInventorySourceToken(stock({ expiryDate: '2026-10-01' }))).not.toBe(first);
  });

  it('supports minimal old records and redacted tombstones for invalidation comparisons', () => {
    expect(typeof getInventorySourceToken({ id: 'old' })).toBe('string');
    expect(getInventorySourceToken({ id: 'old', deletedAt: NOW })).not.toBe(getInventorySourceToken({ id: 'old' }));
  });

  it('projects only a matching confirmation into an allocatable batch', () => {
    expect(projectInventoryQuantity(stock(), review(), 'guest')).toMatchObject({
      quantity: '반 모', memo: '남은 두부', name: '연두부', amount: 150, unit: 'g',
      quantityState: 'verified', quantityStatus: 'verified', quantityRevision: 1,
      quantityName: '연두부', quantityConfirmedAt: NOW, ingredientKey: 'food:연두부',
    });
    expect(projectInventoryQuantity(stock(), review(), 'guest')?.quantityEvidence).toContain('user-confirmation:');
  });

  it('does not trust normalized fields copied onto raw inventory without a sidecar confirmation', () => {
    const forged = stock({ amount: 999, unit: 'g', ingredientKey: 'food:연두부',
      preparationState: 'as-sold', quantityStatus: 'verified', quantityEvidence: 'old-export',
      quantityRevision: 90, quantityState: 'verified' });
    expect(projectInventoryQuantity(forged, null, 'guest')).toMatchObject({
      quantityState: 'unverified', quantityStatus: 'unverified', quantityRevision: 0,
      amount: null, unit: null, ingredientKey: null, preparationState: null, quantityEvidence: null,
    });
  });

  it.each([
    { quantity: '한 모' }, { name: '부침두부' }, { updatedAt: NOW }, { consumed: true },
    { deletedAt: NOW }, { purchaseDate: '2026-09-15' }, { expiryDate: null },
  ])('invalidates old confirmation after raw change %j', (change) => {
    expect(projectInventoryQuantity(stock(change), review(), 'guest')).toMatchObject({
      quantityState: 'stale', quantityStatus: 'unverified', amount: null, quantityRevision: 1,
    });
  });

  it('keeps identity narrow, allowing spaces but not recommendation aliases', () => {
    expect(create({ values: { ...values, name: ' 연 두부 ' } })?.ingredientKey).toBe('food:연두부');
    expect(create({ values: { ...values, name: '두부' } })?.ingredientKey).toBe('food:두부');
    expect(create({ values: { ...values, name: '달걀' } })?.ingredientKey).toBe('food:달걀');
    expect(create({ values: { ...values, name: '계란' } })?.ingredientKey).toBe('food:계란');
  });

  it.each([
    [0, 'g'], [0.001, 'g'], [0.125, 'kg'], [0.25, 'l'], [10, 'ml'], [0.5, '개'],
    [0.0001, 'kg'], [0.0001, 'l'],
  ])('preserves confirmed %s %s without changing raw units', (amount, unit) => {
    expect(create({ values: { ...values, amount, unit } })).toMatchObject({ amount, unit });
  });

  it('revokes quantities with a redacted revision marker, never an old stock snapshot', () => {
    expect(invalidateInventoryQuantityReview(review(), 'guest', 'tofu-1')).toEqual({
      id: 'tofu-1', schemaVersion: 1, scope: 'guest', revision: 2, status: 'unverified',
    });
    expect(invalidateInventoryQuantityReview(null, 'guest', 'new')).toEqual({
      id: 'new', schemaVersion: 1, scope: 'guest', revision: 1, status: 'unverified',
    });
  });

  it('projects a revoked confirmation as unknown while preserving its conflict revision', () => {
    const marker = { id: 'tofu-1', schemaVersion: 1, scope: 'guest', revision: 7, status: 'unverified' };
    expect(projectInventoryQuantity(stock(), marker, 'guest')).toMatchObject({
      quantityState: 'unverified', quantityStatus: 'unverified', quantityRevision: 7, amount: null,
    });
  });

  it.each([
    { amount: null }, { amount: '' }, { amount: '150' }, { amount: -1 }, { amount: NaN },
    { amount: Infinity }, { amount: 0.0001 }, { amount: 9007199254740.992 },
    { amount: 1e-20 }, { amount: Number.MIN_VALUE }, { amount: 1e-20, unit: 'kg' },
    { amount: 0.0000001, unit: 'kg' }, { amount: 0.0000001, unit: 'l' },
    { unit: '팩' }, { unit: ['g'] }, { name: '' }, { name: '   ' }, { name: 3 }, { preparationState: '' },
  ])('rejects unconfirmed or unrepresentable values %j', (change) => {
    expect(() => create({ values: { ...values, ...change } })).toThrow();
  });

  it.each([
    { ingredient: stock({ consumed: true }) }, { ingredient: stock({ deletedAt: NOW }) },
    { scope: '../guest' }, { ingredient: stock({ scope: 'user:alice' }) },
    { revision: 0 }, { revision: 1.5 }, { now: 'yesterday' },
  ])('refuses invalid scope/source/version %j', (change) => {
    expect(() => create(change)).toThrow();
  });

  it.each([
    { scope: 'user:other' }, { id: 'other' }, { schemaVersion: 99 }, { revision: 0 },
    { ingredientKey: 'food:부침두부' }, { confirmedAt: null }, { sourceToken: null }, { status: 'invented' },
  ])('rejects corrupt or foreign stored confirmation %j rather than granting availability', (change) => {
    expect(() => projectInventoryQuantity(stock(), review(change), 'guest')).toThrow();
    expect(() => assertInventoryQuantityReview(review(change), 'guest', 'tofu-1')).toThrow();
  });

  it('refuses to wrap a max revision back to a stale version', () => {
    expect(() => invalidateInventoryQuantityReview(review({ revision: Number.MAX_SAFE_INTEGER }), 'guest', 'tofu-1')).toThrow();
  });

  it.each([null, review()])('rejects a foreign raw inventory record even without a foreign confirmation %j', (confirmation) => {
    expect(() => projectInventoryQuantity(stock({ scope: 'user:alice' }), confirmation, 'guest')).toThrow();
  });
});
