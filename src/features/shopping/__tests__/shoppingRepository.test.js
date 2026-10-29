import FDBFactory from 'fake-indexeddb/lib/FDBFactory';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const TODAY = '2026-09-21';
const NOW = '2026-09-16T03:00:00.000Z';
const values = { name: '우유', quantityText: '1L 두 통', memo: '작은 통 두 개', checked: false };
const source = { source: 'plan', sourceId: 'plan:week-1-r1:양파', name: '양파', quantityText: '200g', context: '9월 21일 저녁' };
const purchase = { scope: 'guest', operationId: 'purchase-1', source, actualQuantityText: '500g 한 팩', memo: '직접 구매' };

async function setup() {
  return { repository: await import('../shoppingRepository'), db: await import('../../../db/indexedDB') };
}

describe('source-separated shopping persistence', () => {
  beforeEach(() => {
    vi.resetModules();
    Object.defineProperty(window, 'indexedDB', { configurable: true, value: new FDBFactory() });
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(NOW));
  });
  afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

  it('starts with empty scoped manual items and history without writing ingredient records', async () => {
    const { repository, db } = await setup();
    expect(await repository.getShoppingWorkspace('guest', TODAY)).toEqual({
      scope: 'guest', manualItems: [], purchaseNotes: [], receipts: [], sources: [], overdueMeals: [], checkedAt: NOW,
    });
    expect(await db.getAllIngredients()).toEqual([]);
  });

  it('preserves distinct manual intentions with the same name, free-text quantities and reloads', async () => {
    const { repository, db } = await setup();
    await repository.saveManualShoppingItem({ scope: 'guest', id: 'manual:a', expectedRevision: 0, values });
    await repository.saveManualShoppingItem({ scope: 'guest', id: 'manual:b', expectedRevision: 0,
      values: { ...values, quantityText: '반 통', memo: '별도 용도' } });
    const result = await repository.getShoppingWorkspace('guest', TODAY);
    expect(result.manualItems).toEqual([
      expect.objectContaining({ id: 'manual:a', name: '우유', quantityText: '1L 두 통', revision: 1 }),
      expect.objectContaining({ id: 'manual:b', name: '우유', quantityText: '반 통', revision: 1 }),
    ]);
    expect(result.sources.map((item) => item.source)).toEqual(['manual', 'manual']);
    expect(new Set(result.sources.map((item) => item.sourceId)).size).toBe(2);
    expect(await db.getAllIngredients()).toEqual([]);
  });

  it('saves check and edits only after an exact revision match and keeps raw stock unchanged', async () => {
    const { repository, db } = await setup();
    const raw = { id: 'milk', name: '우유', quantity: '1개', consumed: true, memo: '재구매 메모' };
    await db.saveIngredient(raw);
    const saved = await repository.saveManualShoppingItem({ scope: 'guest', id: 'manual:a', expectedRevision: 0, values });
    expect(saved.revision).toBe(1);
    const checked = await repository.saveManualShoppingItem({ scope: 'guest', id: saved.id, expectedRevision: 1,
      values: { ...values, checked: true, memo: '체크만 저장' } });
    expect(checked).toMatchObject({ revision: 2, checked: true, memo: '체크만 저장' });
    await expect(repository.saveManualShoppingItem({ scope: 'guest', id: saved.id, expectedRevision: 1, values })).rejects.toThrow();
    expect((await repository.getShoppingWorkspace('guest', TODAY)).manualItems).toEqual([checked]);
    expect(await db.getAllIngredients()).toEqual([raw]);
  });

  it('allows only one of two concurrent edits and keeps the winner', async () => {
    const { repository } = await setup();
    await repository.saveManualShoppingItem({ scope: 'guest', id: 'manual:a', expectedRevision: 0, values });
    const results = await Promise.allSettled(['first', 'second'].map((memo) => repository.saveManualShoppingItem({
      scope: 'guest', id: 'manual:a', expectedRevision: 1, values: { ...values, memo },
    })));
    expect(results.map((item) => item.status)).toEqual(['fulfilled', 'rejected']);
    expect((await repository.getShoppingWorkspace('guest', TODAY)).manualItems[0].memo).toBe('first');
  });

  it('keeps purchase quantity separate from required quantity and records a repeated request only once', async () => {
    const { repository, db } = await setup();
    const first = await repository.recordPurchaseNote(purchase);
    vi.setSystemTime(new Date('2026-09-17T03:00:00.000Z'));
    const retry = await repository.recordPurchaseNote({ ...purchase, source: { ...source } });
    expect(first).toMatchObject({ actualQuantityText: '500g 한 팩', source: { quantityText: '200g' }, inventoryApplied: false, createdAt: NOW });
    expect(retry).toEqual(first);
    expect((await repository.getShoppingWorkspace('guest', TODAY)).purchaseNotes).toEqual([first]);
    expect(await db.getAllIngredients()).toEqual([]);
    await expect(repository.recordPurchaseNote({ ...purchase, actualQuantityText: '다른 팩' })).rejects.toThrow();
  });

  it('serializes concurrent retries into one immutable purchase note', async () => {
    const { repository } = await setup();
    const results = await Promise.all([repository.recordPurchaseNote(purchase), repository.recordPurchaseNote(purchase)]);
    expect(results[0]).toMatchObject({ id: 'purchase:purchase-1', inventoryApplied: false });
    expect(results[0]).toEqual(results[1]);
    expect((await repository.getShoppingWorkspace('guest', TODAY)).purchaseNotes).toHaveLength(1);
  });

  it('keeps snapshots after manual source removal and blocks stale edits and id reuse', async () => {
    const { repository } = await setup();
    await repository.saveManualShoppingItem({ scope: 'guest', id: 'manual:a', expectedRevision: 0, values });
    const before = await repository.getShoppingWorkspace('guest', TODAY);
    expect(before.sources).toHaveLength(1);
    const saved = await repository.recordPurchaseNote({ ...purchase, source: before.sources[0] });
    await repository.removeManualShoppingItem({ scope: 'guest', id: 'manual:a', expectedRevision: 1 });
    const after = await repository.getShoppingWorkspace('guest', TODAY);
    expect(after.manualItems).toEqual([]);
    expect(after.sources).toEqual([]);
    expect(after.purchaseNotes).toEqual([saved]);
    for (const expectedRevision of [0, 1, 2]) {
      await expect(repository.saveManualShoppingItem({ scope: 'guest', id: 'manual:a', expectedRevision, values })).rejects.toThrow();
    }
  });

  it('keeps plan, manual and repurchase sources distinct even for the same ingredient', async () => {
    const { repository, db } = await setup();
    const { generateMealPlan } = await import('../../mealPlans/mealPlanDomain');
    const { saveMealPlan, confirmMealPlan } = await import('../../mealPlans/mealPlanRepository');
    const plan = generateMealPlan({ weekStart: TODAY, now: NOW,
      preferences: { servings: 2, dinnerDays: [0], excludedIngredients: [] },
      ingredients: ['밥', '시금치', '마', '두유', '소금', '버터', '후춧가루'].map((name) => ({ name })) });
    const draft = await saveMealPlan(plan, 'guest', 0);
    await confirmMealPlan(TODAY, 'guest', draft.revision);
    await db.saveIngredient({ id: 'rice', name: '밥', quantity: '두 공기', consumed: true });
    await repository.saveManualShoppingItem({ scope: 'guest', id: 'manual:rice', expectedRevision: 0,
      values: { ...values, name: '밥', quantityText: '1팩' } });
    const workspace = await repository.getShoppingWorkspace('guest', TODAY);
    expect(workspace.sources).toEqual(expect.any(Array));
    const sources = workspace.sources.filter((item) => item.name === '밥');
    expect(sources.map((item) => item.source).sort()).toEqual(['manual', 'plan', 'repurchase']);
    expect(sources.find((item) => item.source === 'plan').quantityText).toBe('360g');
    expect(sources.find((item) => item.source === 'manual').quantityText).toBe('1팩');
    expect(sources.find((item) => item.source === 'repurchase').quantityText).toBe('두 공기');
    expect(new Set(sources.map((item) => item.sourceId)).size).toBe(3);
  });

  it('keeps overdue meals in a read-only confirmation list instead of purchase options', async () => {
    const { repository, db } = await setup();
    const { generateMealPlan } = await import('../../mealPlans/mealPlanDomain');
    const { saveMealPlan, confirmMealPlan } = await import('../../mealPlans/mealPlanRepository');
    const plan = generateMealPlan({ weekStart: TODAY, now: NOW, preferences: { servings: 1, dinnerDays: [0] } });
    await saveMealPlan(plan, 'guest', 0);
    await confirmMealPlan(TODAY, 'guest', 1);
    const workspace = await repository.getShoppingWorkspace('guest', '2026-09-22');
    // A meal is a confirmation task, not a grocery item that can be received.
    expect(workspace.sources).toEqual([]);
    expect(workspace.overdueMeals).toEqual([{ slotId: `${TODAY}:dinner`, date: TODAY, title: plan.slots[0].title }]);
    expect(await db.getAllIngredients()).toEqual([]);
  });

  it('recalculates only plan rows when a dinner is skipped and preserves manual, purchased notes and physical inventory', async () => {
    const { repository, db } = await setup();
    const { generateMealPlan, setMealPlanSlotSkipped } = await import('../../mealPlans/mealPlanDomain');
    const { saveMealPlan, confirmMealPlan } = await import('../../mealPlans/mealPlanRepository');
    const plan = generateMealPlan({ weekStart: TODAY, now: NOW, preferences: { servings: 1, dinnerDays: [0] },
      ingredients: ['밥', '시금치', '마', '두유', '소금', '버터', '후춧가루'].map((name) => ({ name })) });
    const draft = await saveMealPlan(plan, 'guest', 0);
    const confirmed = await confirmMealPlan(TODAY, 'guest', draft.revision);
    await repository.saveManualShoppingItem({ scope: 'guest', id: 'manual:milk', expectedRevision: 0, values });
    const bought = { id: 'bought-onion', name: '양파', quantity: '500g 한 팩', consumed: false, memo: '이미 산 재고' };
    await db.saveIngredient(bought);
    const before = await repository.getShoppingWorkspace('guest', TODAY);
    expect(before.sources).toEqual(expect.any(Array));
    const note = await repository.recordPurchaseNote({ ...purchase, source: before.sources.find((item) => item.source === 'plan') });
    const edited = setMealPlanSlotSkipped(confirmed.confirmed, plan.slots[0].id, true, { now: NOW });
    const next = await saveMealPlan(edited, 'guest', confirmed.revision);
    await confirmMealPlan(TODAY, 'guest', next.revision);
    const after = await repository.getShoppingWorkspace('guest', TODAY);
    expect(after.sources.some((item) => item.source === 'plan')).toBe(false);
    expect(after.manualItems).toEqual(before.manualItems);
    expect(after.purchaseNotes).toEqual([note]);
    expect(await db.getAllIngredients()).toEqual([bought]);
  });

  it('isolates identical item and operation IDs in guest and two account scopes', async () => {
    const { repository } = await setup();
    for (const scope of ['guest', 'user:alice', 'user:bob']) {
      await repository.saveManualShoppingItem({ scope, id: 'manual:a', expectedRevision: 0, values: { ...values, memo: scope } });
      await repository.recordPurchaseNote({ ...purchase, scope, memo: scope });
    }
    const result = await repository.getShoppingWorkspace('user:alice', TODAY);
    expect(result.manualItems).toEqual([expect.objectContaining({ scope: 'user:alice', memo: 'user:alice' })]);
    expect(result.purchaseNotes).toEqual([expect.objectContaining({ scope: 'user:alice', memo: 'user:alice' })]);
  });

  it.each([['empty', ''], ['array', ['user:alice']], ['object', { scope: 'user:alice' }], ['unsafe', 'user:a:b']])('rejects %s scope before reading or writing', async (_label, scope) => {
    const { repository } = await setup();
    await expect(repository.getShoppingWorkspace(scope, TODAY)).rejects.toThrow();
    await expect(repository.saveManualShoppingItem({ scope, id: 'manual:a', expectedRevision: 0, values })).rejects.toThrow();
    await expect(repository.recordPurchaseNote({ ...purchase, scope })).rejects.toThrow();
  });

  it.each([
    ['empty name', { ...values, name: '  ' }], ['object quantity', { ...values, quantityText: {} }],
    ['overlong memo', { ...values, memo: 'x'.repeat(501) }], ['string check', { ...values, checked: 'false' }],
  ])('rejects %s without creating an entry', async (_label, invalid) => {
    const { repository } = await setup();
    await expect(repository.saveManualShoppingItem({ scope: 'guest', id: 'manual:a', expectedRevision: 0, values: invalid })).rejects.toThrow();
    expect((await repository.getShoppingWorkspace('guest', TODAY)).manualItems).toEqual([]);
  });

  it('rejects malformed sources, missing actual quantity and unsafe versions instead of inventing a purchase amount', async () => {
    const { repository } = await setup();
    for (const input of [{ ...purchase, actualQuantityText: '' }, { ...purchase, operationId: '../x' },
      { ...purchase, source: { ...source, source: 'inventory' } }]) {
      await expect(repository.recordPurchaseNote(input)).rejects.toThrow();
    }
    for (const expectedRevision of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
      await expect(repository.saveManualShoppingItem({ scope: 'guest', id: 'manual:a', expectedRevision, values })).rejects.toThrow();
    }
  });

  it('rejects corrupted stored scope or versions without deleting private records', async () => {
    const { repository, db } = await setup();
    const saved = await repository.saveManualShoppingItem({ scope: 'guest', id: 'manual:a', expectedRevision: 0, values });
    expect(saved).toMatchObject({ id: 'manual:a', revision: 1 });
    for (const broken of [{ ...saved, scope: 'user:bob' }, { ...saved, schemaVersion: 999 }, { ...saved, checked: 'yes' }]) {
      await db.runShoppingTransaction('readwrite', (store) => store.put(broken));
      await expect(repository.getShoppingWorkspace('guest', TODAY)).rejects.toThrow();
      expect(await db.runShoppingTransaction('readonly', (store) => store.get(saved.id))).toEqual(broken);
    }
  });

  it('does not announce a committed purchase when the transaction aborts after its write request succeeds', async () => {
    const { repository, db } = await setup();
    let prototype;
    await db.runShoppingTransaction('readonly', (store) => { prototype = Object.getPrototypeOf(store); return store.getAll(); });
    const put = prototype.put;
    const fault = vi.spyOn(prototype, 'put').mockImplementationOnce(function (...args) {
      const request = put.apply(this, args);
      request.addEventListener('success', () => this.transaction.abort());
      return request;
    });
    await expect(repository.recordPurchaseNote(purchase)).rejects.toThrow();
    fault.mockRestore();
    expect((await repository.getShoppingWorkspace('guest', TODAY)).purchaseNotes).toEqual([]);
    await repository.recordPurchaseNote(purchase);
    expect((await repository.getShoppingWorkspace('guest', TODAY)).purchaseNotes).toHaveLength(1);
  });

  it('captures purchase source and quantity before asynchronous database work', async () => {
    const { repository } = await setup();
    const input = structuredClone(purchase);
    const pending = repository.recordPurchaseNote(input);
    input.source.name = '나중에 바뀐 이름';
    input.actualQuantityText = '999kg';
    const saved = await pending;
    expect(saved).toMatchObject({ source: { name: '양파', quantityText: '200g' }, actualQuantityText: '500g 한 팩' });
  });
});
