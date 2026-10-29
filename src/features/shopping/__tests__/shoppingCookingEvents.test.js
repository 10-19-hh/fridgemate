import FDBFactory from 'fake-indexeddb/lib/FDBFactory';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const common = { schemaVersion: 1, scope: 'guest', slotId: '2026-09-16:dinner', weekStart: '2026-09-14',
  createdAt: '2026-09-19T08:00:00.000Z', requestKey: '{"actual":150}' };
const lines = [{ inventoryId: 'stock', name: '닭고기', ingredientKey: 'food:닭고기', amount: 150, unit: 'g', preparationState: 'raw' }];
const cooking = () => ({ ...common, kind: 'cooking', id: 'cooking:one', operationId: 'one', inventoryStatus: 'applied', consumptionId: 'consumption:one' });
async function setup() {
  const shopping = await import('../shoppingRepository');
  const db = await import('../../../db/indexedDB');
  return { shopping, db };
}
async function store(db, records, scope = 'guest') {
  return db.runInventoryReceiptTransaction('readwrite', ({ events }) => {
    for (const record of records) events.put(record);
  }, scope);
}

describe('purchase history beside cooking events', () => {
  beforeEach(() => {
    vi.resetModules();
    Object.defineProperty(window, 'indexedDB', { configurable: true, value: new FDBFactory() });
  });

  it('loads only receipts while preserving all four cooking event kinds and purchase history', async () => {
    const { shopping, db } = await setup();
    const note = await shopping.recordPurchaseNote({ scope: 'guest', operationId: 'buy',
      source: { source: 'manual', sourceId: 'manual:stock@1', name: '닭고기', quantityText: '200g', context: '직접 입력' },
      actualQuantityText: '500g 한 팩', memo: '보존' });
    const receipt = await shopping.applyPurchaseReceipt({ scope: 'guest', operationId: 'receive', purchaseNoteId: note.id,
      values: { name: '닭고기', quantityText: '500g', quantityStatus: 'verified', amount: 500, unit: 'g', preparationState: 'raw',
        category: '육류', storageType: '냉장', purchaseDate: '2026-09-19', expiryDate: '2026-09-25', memo: '' } });
    const records = [cooking(),
      { ...common, kind: 'consumption', id: 'consumption:one', operationId: 'one', cookingId: 'cooking:one', lines },
      { ...common, kind: 'consumption-reversal', id: 'consumption-reversal:undo', operationId: 'undo', cookingId: 'cooking:one', reversesId: 'consumption:one', lines },
      { ...common, kind: 'cooking-reversal', id: 'cooking-reversal:cancel', operationId: 'cancel', reversesId: 'cooking:one' }];
    await store(db, records);
    await expect(shopping.getShoppingWorkspace('guest', '2026-09-19')).resolves.toMatchObject({ receipts: [receipt], purchaseNotes: [note] });
    const saved = await db.runInventoryReceiptTransaction('readonly', ({ events }) => events.getAll());
    expect(saved).toHaveLength(5);
    for (const record of records) expect(saved).toContainEqual(record);
    expect(await db.getAllIngredients()).toHaveLength(1);
  });

  it.each([
    ['receipt prefix disguised as cooking', { id: 'receipt:one' }],
    ['cooking prefix disguised as receipt', { kind: 'receipt' }],
    ['foreign scope', { scope: 'user:alice' }],
    ['unknown namespace', { kind: 'other', id: 'other:one' }],
    ['empty operation suffix', { id: 'cooking:', operationId: '' }],
    ['inconsistent applied consumption', { consumptionId: 'consumption:other' }],
    ['receipt index contamination', { purchaseNoteId: 'purchase:contamination' }],
  ])('rejects %s rather than hiding damaged records', async (_label, patch) => {
    const { shopping, db } = await setup();
    const damaged = { ...cooking(), ...patch };
    await store(db, [damaged]);
    await expect(shopping.getShoppingWorkspace('guest', '2026-09-19')).rejects.toThrow();
    expect(await db.runInventoryReceiptTransaction('readonly', ({ events }) => events.getAll())).toEqual([damaged]);
  });

  it('does not surface another account cooking or purchase records', async () => {
    const { shopping, db } = await setup();
    await store(db, [{ ...cooking(), scope: 'user:alice' }], 'user:alice');
    await expect(shopping.getShoppingWorkspace('guest', '2026-09-19')).resolves.toMatchObject({ receipts: [], purchaseNotes: [] });
    await expect(shopping.getShoppingWorkspace('user:alice', '2026-09-19')).resolves.toMatchObject({ receipts: [], purchaseNotes: [] });
  });
});
