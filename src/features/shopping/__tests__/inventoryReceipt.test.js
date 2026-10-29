import FDBFactory from 'fake-indexeddb/lib/FDBFactory';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const NOW = '2026-09-16T08:00:00.000Z';
const values = { name: '닭고기', quantityText: '500g 한 팩', quantityStatus: 'verified', amount: 500, unit: 'g',
  preparationState: 'raw', purchaseDate: '2026-09-16', expiryDate: '2026-09-23', category: '육류', storageType: '냉장', memo: '실제 포장량' };
const source = { source: 'manual', sourceId: 'manual:chicken@1', name: '닭고기', quantityText: '200g', context: '직접 입력' };

async function setup(scope = 'guest', noteOperation = 'purchase-one') {
  const shopping = await import('../shoppingRepository');
  const db = await import('../../../db/indexedDB');
  const quantities = await import('../../mealPlans/inventoryQuantityRepository');
  const note = await shopping.recordPurchaseNote({ scope, operationId: noteOperation, source, actualQuantityText: '500g 한 팩', memo: '구매 기록' });
  return { shopping, db, quantities, note, input: { scope, operationId: 'receive-one', purchaseNoteId: note.id, values: structuredClone(values) } };
}

describe('explicit purchase receiving', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(NOW));
    Object.defineProperty(window, 'indexedDB', { configurable: true, value: new FDBFactory() });
  });
  afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

  it('receives the actual 500g package once instead of the 200g shopping need', async () => {
    const { shopping, quantities, input } = await setup();
    expect((await quantities.getInventoryQuantitySnapshot()).inventory).toEqual([]);
    // Optional invocation makes the pre-feature failure a missing stock assertion,
    // not an import or absent-function execution error.
    await shopping.applyPurchaseReceipt?.(input);
    const snapshot = await quantities.getInventoryQuantitySnapshot();
    expect(snapshot.inventory).toHaveLength(1);
    expect(snapshot.inventory[0]).toMatchObject({ name: '닭고기', quantity: '500g 한 팩', ingredientKey: 'food:닭고기',
      amount: 500, unit: 'g', preparationState: 'raw', quantityStatus: 'verified', consumed: false, syncState: 'pendingCreate' });
    expect(snapshot.ingredients[0].memo).toBe('실제 포장량');
  });

  it('retries and concurrent tabs return one receipt even when a second tab has a different request id', async () => {
    const { shopping, quantities, input } = await setup();
    expect(shopping.applyPurchaseReceipt).toBeTypeOf('function');
    const [first, duplicate, otherTab] = await Promise.all([
      shopping.applyPurchaseReceipt(input), shopping.applyPurchaseReceipt(input),
      shopping.applyPurchaseReceipt({ ...input, operationId: 'other-tab' }),
    ]);
    expect(duplicate).toEqual(first);
    expect(otherTab).toEqual(first);
    expect((await quantities.getInventoryQuantitySnapshot()).inventory).toHaveLength(1);
    const workspace = await shopping.getShoppingWorkspace('guest', '2026-09-16');
    expect(workspace.receipts).toEqual([first]);
    expect(workspace.purchaseNotes[0].inventoryApplied).toBe(false); // immutable original note
  });

  it('rejects changed payload for an already received note without changing physical stock', async () => {
    const { shopping, quantities, input } = await setup();
    expect(shopping.applyPurchaseReceipt).toBeTypeOf('function');
    await shopping.applyPurchaseReceipt(input);
    const before = await quantities.getInventoryQuantitySnapshot();
    await expect(shopping.applyPurchaseReceipt({ ...input, values: { ...values, amount: 700 } })).rejects.toThrow();
    await expect(shopping.applyPurchaseReceipt({ ...input, operationId: 'other-tab', values: { ...values, amount: 700 } })).rejects.toThrow();
    expect(await quantities.getInventoryQuantitySnapshot()).toEqual(before);
  });

  it('does not reuse one operation id for another purchase note', async () => {
    const { shopping, quantities, input } = await setup();
    expect(shopping.applyPurchaseReceipt).toBeTypeOf('function');
    await shopping.applyPurchaseReceipt(input);
    const other = await setup('guest', 'purchase-two');
    await expect(shopping.applyPurchaseReceipt({ ...input, purchaseNoteId: other.note.id })).rejects.toThrow();
    expect((await quantities.getInventoryQuantitySnapshot()).inventory).toHaveLength(1);
  });

  it('keeps an unknown package as unknown instead of inventing grams from a text label', async () => {
    const { shopping, quantities, input } = await setup();
    expect(shopping.applyPurchaseReceipt).toBeTypeOf('function');
    await shopping.applyPurchaseReceipt({ ...input, values: { ...values, quantityText: '큰 팩', quantityStatus: 'unverified', amount: null, unit: null, preparationState: null } });
    expect((await quantities.getInventoryQuantitySnapshot()).inventory[0]).toMatchObject({ quantity: '큰 팩', amount: null, unit: null, quantityStatus: 'unverified' });
  });

  it('leaves a later raw edit or deletion intact on receipt retries', async () => {
    const { shopping, quantities, db, input } = await setup();
    expect(shopping.applyPurchaseReceipt).toBeTypeOf('function');
    const receipt = await shopping.applyPurchaseReceipt(input);
    const stock = (await db.getAllIngredients())[0];
    await db.saveIngredient({ ...stock, quantity: '사용 후 남은 양 확인 필요' });
    await shopping.applyPurchaseReceipt(input);
    expect((await quantities.getInventoryQuantitySnapshot()).inventory[0]).toMatchObject({ quantity: '사용 후 남은 양 확인 필요', quantityStatus: 'unverified' });
    await db.deleteIngredient(stock.id);
    expect(await shopping.applyPurchaseReceipt(input)).toEqual(receipt);
    expect(await db.getAllIngredients()).toEqual([]);
  });

  it('rejects an absent purchase note and isolates the same operation across accounts', async () => {
    const guest = await setup();
    expect(guest.shopping.applyPurchaseReceipt).toBeTypeOf('function');
    await expect(guest.shopping.applyPurchaseReceipt({ ...guest.input, scope: 'user:alice' })).rejects.toThrow();
    await guest.shopping.applyPurchaseReceipt(guest.input);
    const alice = await setup('user:alice');
    await alice.shopping.applyPurchaseReceipt({ ...alice.input, values: { ...values, amount: 900 } });
    expect((await guest.quantities.getInventoryQuantitySnapshot('guest')).inventory[0].amount).toBe(500);
    expect((await guest.quantities.getInventoryQuantitySnapshot('user:alice')).inventory[0].amount).toBe(900);
    expect((await guest.shopping.getShoppingWorkspace('user:bob', '2026-09-16')).receipts).toEqual([]);
  });

  it.each([
    ['zero', { amount: 0 }], ['negative', { amount: -1 }], ['nonfinite', { amount: Infinity }],
    ['text amount', { amount: '500' }], ['unsupported unit', { unit: '팩' }],
    ['too tiny', { amount: 0.00001 }], ['unknown status', { quantityStatus: 'assumed' }],
    ['unknown with a number', { quantityStatus: 'unverified' }], ['invalid day', { expiryDate: '2026-02-30' }],
    ['invalid storage', { storageType: 'somewhere' }], ['blank name', { name: ' ' }],
  ])('rejects %s input without writing any stock or receipt', async (_label, patch) => {
    const { shopping, db, input } = await setup();
    expect(shopping.applyPurchaseReceipt).toBeTypeOf('function');
    await expect(shopping.applyPurchaseReceipt({ ...input, values: { ...values, ...patch } })).rejects.toThrow();
    expect(await db.getAllIngredients()).toEqual([]);
    expect((await shopping.getShoppingWorkspace('guest', '2026-09-16')).receipts).toEqual([]);
  });

  it('copies mutable input before the asynchronous transaction opens', async () => {
    const { shopping, quantities, input } = await setup();
    expect(shopping.applyPurchaseReceipt).toBeTypeOf('function');
    const pending = shopping.applyPurchaseReceipt(input);
    input.values.amount = 900;
    input.values.name = '수정된 이름';
    await pending;
    expect((await quantities.getInventoryQuantitySnapshot()).inventory[0]).toMatchObject({ name: '닭고기', amount: 500 });
  });

  it('never overwrites stock whose identity collides with the new receipt', async () => {
    const { shopping, db, input } = await setup();
    const old = { id: 'receipt-receive-one', name: '보존할 재고', quantity: '한 통' };
    await db.saveIngredient(old);
    await expect(shopping.applyPurchaseReceipt(input)).rejects.toThrow();
    expect(await db.getAllIngredients()).toEqual([old]);
    expect((await shopping.getShoppingWorkspace('guest', '2026-09-16')).receipts).toEqual([]);
  });

  it.each([
    ['scope', { scope: 'user:alice' }], ['kind', { kind: 'made-up-event' }],
    ['amount', { values: { ...values, amount: -100 } }],
  ])('rejects a damaged receipt %s without treating the purchase as unreceived', async (_label, patch) => {
    const { shopping, db, input } = await setup();
    const receipt = await shopping.applyPurchaseReceipt(input);
    await db.runInventoryReceiptTransaction('readwrite', ({ events }) => events.put({ ...receipt, ...patch }));
    await expect(shopping.getShoppingWorkspace('guest', '2026-09-16')).rejects.toThrow();
    await expect(shopping.applyPurchaseReceipt(input)).rejects.toThrow();
    expect(await db.getAllIngredients()).toHaveLength(1);
  });

  it.each(['ingredients', 'inventoryQuantities', 'inventoryEvents'])('rolls back all receipt writes when %s fails after request success', async (storeName) => {
    const { shopping, quantities, db, input } = await setup();
    expect(shopping.applyPurchaseReceipt).toBeTypeOf('function');
    const raw = await new Promise((resolve, reject) => {
      const request = window.indexedDB.open('fridgemate-db__guest');
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    const prototype = Object.getPrototypeOf(raw.transaction(storeName).objectStore(storeName));
    const add = prototype.add;
    let fail = true;
    vi.spyOn(prototype, 'add').mockImplementation(function (...args) {
      const request = add.apply(this, args);
      if (this.name === storeName && fail) {
        fail = false;
        request.addEventListener('success', () => this.transaction.abort());
      }
      return request;
    });
    await expect(shopping.applyPurchaseReceipt(input)).rejects.toThrow();
    expect((await quantities.getInventoryQuantitySnapshot()).inventory).toEqual([]);
    expect((await quantities.getInventoryQuantitySnapshot()).quantityReviews).toEqual([]);
    expect((await shopping.getShoppingWorkspace('guest', '2026-09-16')).receipts).toEqual([]);
    await shopping.applyPurchaseReceipt(input);
    expect(await db.getAllIngredients()).toHaveLength(1);
    raw.close();
  });
});
