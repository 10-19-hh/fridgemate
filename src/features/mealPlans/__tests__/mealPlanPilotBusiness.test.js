import FDBFactory from 'fake-indexeddb/lib/FDBFactory';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const collector = vi.hoisted(() => ({ begin: vi.fn(), finish: vi.fn() }));
vi.mock('../mealPlanPilotCollector', () => ({
  beginMealPlanPilotOperation: (...args) => collector.begin(...args),
  finishMealPlanPilotOperation: (...args) => collector.finish(...args),
}));
const NOW = '2026-09-28T03:00:00.000Z';
const LATER = '2026-09-28T03:02:00.000Z';
const WEEK = '2026-09-28';

async function setup() {
  const db = await import('../../../db/indexedDB');
  const plans = await import('../mealPlanRepository');
  const cooking = await import('../mealCookingRepository');
  const shopping = await import('../../shopping/shoppingRepository');
  const changes = await import('../mealPlanChangesRepository');
  const quantities = await import('../inventoryQuantityRepository');
  const { generateMealPlan } = await import('../mealPlanDomain');
  const plan = generateMealPlan({ scope: 'guest', weekStart: WEEK, now: NOW,
    preferences: { servings: 1, dinnerDays: [0], excludedIngredients: [] } });
  await plans.saveMealPlan(plan, 'guest', 0);
  await plans.confirmMealPlan(WEEK, 'guest', 1);
  await db.saveIngredient({ id: 'private-stock', name: '닭고기', quantity: '300g', consumed: false,
    category: '육류', storageType: '냉장', expiryDate: '2026-10-20', createdAt: NOW, updatedAt: NOW });
  let row = (await quantities.getInventoryQuantitySnapshot()).inventory[0];
  await quantities.saveInventoryQuantity({ scope: 'guest', ingredientId: row.id, expectedRevision: row.quantityRevision,
    expectedSourceToken: row.sourceToken, values: { name: row.name, amount: 300, unit: 'g', preparationState: 'raw' } });
  const stock = async () => (await quantities.getInventoryQuantitySnapshot()).inventory[0];
  row = await stock();
  const input = { scope: 'guest', weekStart: WEEK, slotId: `${WEEK}:dinner`, operationId: 'cook-first',
    expectedPlanRevision: 2, usageMode: 'measured', completeUsageConfirmed: true,
    usages: [{ ingredientId: row.id, expectedRevision: row.quantityRevision, expectedSourceToken: row.sourceToken, amount: 150, unit: 'g' }] };
  return { db, plans, cooking, shopping, changes, stock, input };
}
const batches = () => collector.finish.mock.calls.map(call => call[1]);

beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(NOW));
  Object.defineProperty(window, 'indexedDB', { configurable: true, value: new FDBFactory() });
  collector.begin.mockResolvedValue(Object.freeze({}));
  collector.finish.mockResolvedValue({ status: 'recorded' });
});
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe('pilot records actual committed repository outcomes', () => {
  it('records initial measured cooking and replay with the original event identity and time, without double stock deduction', async () => {
    const s = await setup();
    const committedAmounts = [];
    collector.finish.mockImplementation(async () => { committedAmounts.push((await s.stock()).amount); });
    const first = await s.cooking.recordMealCooking(s.input);
    vi.setSystemTime(new Date(LATER));
    const otherTab = await s.cooking.recordMealCooking({ ...s.input, operationId: 'other-tab' });
    expect(otherTab).toEqual(first);
    expect((await s.stock()).amount).toBe(150);
    expect(batches()).toHaveLength(2);
    expect(batches()[0]).toEqual(batches()[1]);
    expect(batches()[0].map(row => [row.name, row.operationKey, row.occurredAt])).toEqual([
      ['meal_cooked_recorded', 'cook-first', NOW], ['consumption_applied', 'cook-first', NOW],
    ]);
    expect(committedAmounts).toEqual([150, 150]);
    expect(JSON.stringify(batches())).not.toMatch(/private-stock|닭고기|requestKey|sourceToken|amount|usages/);
  });

  it('records correction as an atomic inverse plus replacement batch and preserves its replay and zero usage', async () => {
    const s = await setup();
    await s.cooking.recordMealCooking(s.input);
    const row = await s.stock();
    const correction = { scope: 'guest', weekStart: WEEK, slotId: `${WEEK}:dinner`, operationId: 'zero-correction',
      cookingId: 'cooking:cook-first', expectedConsumptionId: 'consumption:cook-first', expectedPlanRevision: 3,
      completeUsageConfirmed: true, inventory: [{ ingredientId: row.id, expectedRevision: row.quantityRevision,
        expectedSourceToken: row.sourceToken }], usages: [] };
    const result = await s.cooking.correctMealConsumption(correction);
    vi.setSystemTime(new Date(LATER));
    expect(await s.cooking.correctMealConsumption({ ...correction, operationId: 'other-correction' })).toEqual(result);
    expect((await s.stock()).amount).toBe(300);
    expect(batches()).toHaveLength(3);
    expect(batches()[1]).toEqual(batches()[2]);
    expect(batches()[1].map(row => [row.name, row.reversesKey])).toEqual([
      ['consumption_reversed', 'consumption_applied:consumption:cook-first'], ['consumption_applied', undefined],
    ]);
  });

  it('records consumption and cooking cancellations as successful inverse operations with exact original links', async () => {
    const s = await setup();
    await s.cooking.recordMealCooking(s.input);
    const row = await s.stock();
    await s.cooking.reverseMealConsumption({ scope: 'guest', weekStart: WEEK, slotId: `${WEEK}:dinner`,
      operationId: 'reverse', cookingId: 'cooking:cook-first', expectedPlanRevision: 3,
      inventory: [{ ingredientId: row.id, expectedRevision: row.quantityRevision, expectedSourceToken: row.sourceToken }] });
    await s.cooking.cancelMealCooking({ scope: 'guest', weekStart: WEEK, slotId: `${WEEK}:dinner`,
      operationId: 'cancel', cookingId: 'cooking:cook-first', expectedPlanRevision: 4 });
    expect(batches().slice(1).flat().map(row => [row.name, row.status, row.reversesKey])).toEqual([
      ['consumption_reversed', 'success', 'consumption_applied:consumption:cook-first'],
      ['meal_cooked_reversed', 'success', 'meal_cooked_recorded:cooking:cook-first'],
    ]);
    expect((await s.plans.getMealPlan(WEEK)).confirmed.slots[0].status).toBe('planned');
  });

  it('observes only applied purchase receipts, preserving the original ACK on another-tab retry', async () => {
    const s = await setup();
    const note = await s.shopping.recordPurchaseNote({ scope: 'guest', operationId: 'note',
      source: { source: 'manual', sourceId: 'manual:test', name: '민감재료', quantityText: '한 팩', context: '메모' },
      actualQuantityText: '500g', memo: 'private memo' });
    expect(batches()).toEqual([]);
    const input = { scope: 'guest', operationId: 'receipt-first', purchaseNoteId: note.id,
      values: { name: '민감재료', quantityText: '500g', quantityStatus: 'verified', amount: 500, unit: 'g',
        preparationState: 'raw', category: '육류', storageType: '냉장', purchaseDate: WEEK, expiryDate: '', memo: '' } };
    const first = await s.shopping.applyPurchaseReceipt(input);
    vi.setSystemTime(new Date(LATER));
    expect(await s.shopping.applyPurchaseReceipt({ ...input, operationId: 'other-receipt' })).toEqual(first);
    expect(batches()).toEqual([[{ name: 'inventory_purchase_applied', status: 'success',
      sourceKey: 'inventory_purchase_applied:receipt:receipt-first', operationKey: 'receipt-first', occurredAt: NOW }],
    [{ name: 'inventory_purchase_applied', status: 'success',
      sourceKey: 'inventory_purchase_applied:receipt:receipt-first', operationKey: 'receipt-first', occurredAt: NOW }]]);
    expect(await s.db.getAllIngredients()).toHaveLength(2);
  });

  it('records two moved slots only after explicit approval, at the ACK time rather than preview time', async () => {
    const s = await setup();
    const preview = await s.changes.previewMealPlanChange({ scope: 'guest', weekStart: WEEK,
      kind: 'move', slotId: `${WEEK}:dinner`, targetDate: '2026-10-05', mode: 'move', pantryItems: [] });
    expect(batches()).toEqual([]);
    vi.setSystemTime(new Date(LATER));
    const result = await s.changes.confirmMealPlanChange(preview);
    expect(result.records).toHaveLength(2);
    expect(batches()).toHaveLength(1);
    expect(batches()[0].map(row => [row.name, row.planKey, row.slotKey, row.occurredAt])).toEqual([
      ['meal_slot_changed', 'week:2026-09-28', '2026-09-28:dinner', LATER],
      ['meal_slot_changed', 'week:2026-10-05', '2026-10-05:dinner', LATER],
    ]);
    expect(JSON.stringify(batches())).not.toContain(preview.token);
  });

  it('preserves successful business under collector failure and classifies only a real transaction rejection as failure', async () => {
    const s = await setup();
    collector.finish.mockRejectedValue(new Error('pilot write failure'));
    const result = await s.cooking.recordMealCooking(s.input);
    expect(result.event.id).toBe('cooking:cook-first');
    expect((await s.stock()).amount).toBe(150);
    await expect(s.cooking.recordMealCooking({ ...s.input, operationId: 'changed', usages: [{ ...s.input.usages[0], amount: 200 }] })).rejects.toThrow();
    expect((await s.stock()).amount).toBe(150);
    expect(batches()).toHaveLength(2);
    expect(batches()[0].every(row => row.status === 'success')).toBe(true);
    expect(batches()[1]).toEqual([expect.objectContaining({ name: 'meal_cooked_recorded', status: 'failure' })]);
  });
});
