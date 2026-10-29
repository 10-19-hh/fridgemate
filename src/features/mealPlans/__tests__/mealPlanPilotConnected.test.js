import { webcrypto } from 'node:crypto';
import FDBFactory from 'fake-indexeddb/lib/FDBFactory';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const NOW = '2026-09-28T03:00:00.000Z';
const WEEK = '2026-09-28';
async function setup({ consent = true } = {}) {
  const db = await import('../../../db/indexedDB');
  const plans = await import('../mealPlanRepository');
  const cooking = await import('../mealCookingRepository');
  const shopping = await import('../../shopping/shoppingRepository');
  const quantities = await import('../inventoryQuantityRepository');
  const pilot = await import('../mealPlanPilotConsent');
  const collector = await import('../mealPlanPilotCollector');
  const { generateMealPlan } = await import('../mealPlanDomain');
  await plans.saveMealPlan(generateMealPlan({ scope: 'guest', weekStart: WEEK, now: NOW,
    preferences: { servings: 1, dinnerDays: [0], excludedIngredients: [] } }), 'guest', 0);
  await plans.confirmMealPlan(WEEK, 'guest', 1);
  await db.saveIngredient({ id: 'private-batch', name: '닭고기', quantity: '300g', memo: 'private memo',
    consumed: false, category: '육류', storageType: '냉장', expiryDate: '2026-10-20', createdAt: NOW, updatedAt: NOW });
  const stock = async () => (await quantities.getInventoryQuantitySnapshot()).inventory.find(row => row.id === 'private-batch');
  let row = await stock();
  await quantities.saveInventoryQuantity({ scope: 'guest', ingredientId: row.id, expectedRevision: row.quantityRevision,
    expectedSourceToken: row.sourceToken, values: { name: row.name, amount: 300, unit: 'g', preparationState: 'raw' } });
  row = await stock();
  const check = value => ({ ingredientId: value.id, expectedRevision: value.quantityRevision, expectedSourceToken: value.sourceToken });
  const input = { scope: 'guest', weekStart: WEEK, slotId: `${WEEK}:dinner`, operationId: 'private-first', expectedPlanRevision: 2,
    usageMode: 'measured', completeUsageConfirmed: true, usages: [{ ...check(row), amount: 150, unit: 'g' }] };
  const grant = async () => {
    vi.stubEnv('VITE_LOCAL_PILOT_ENABLED', 'true');
    const state = await pilot.grantMealPlanPilotConsent({ scope: 'guest', expectedVersion: null, accepted: true, policyVersion: 'local-pilot-35d-v1' });
    await collector.resumeMealPlanPilotCapture({ scope: 'guest', expectedVersion: state.version });
    return state;
  };
  const state = consent ? await grant() : null;
  const rows = () => db.runMealPlanPilotTransaction('readonly', store => store.getAll());
  return { db, plans, cooking, shopping, collector, pilot, stock, check, input, grant, state, rows };
}

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(NOW));
  vi.stubGlobal('crypto', webcrypto);
  Object.defineProperty(window, 'indexedDB', { configurable: true, value: new FDBFactory() });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.useRealTimers(); });

describe('real scoped collector with real business transactions', () => {
  it('exports linked pseudonyms once across cooking, receipt, correction and a different-request replay', async () => {
    const s = await setup();
    await s.cooking.recordMealCooking(s.input);
    vi.setSystemTime(new Date('2026-09-28T03:01:00.000Z'));
    await s.cooking.recordMealCooking({ ...s.input, operationId: 'another-private-attempt' });
    const note = await s.shopping.recordPurchaseNote({ scope: 'guest', operationId: 'private-note',
      source: { source: 'manual', sourceId: 'manual:private-note', name: '닭고기', quantityText: '500g', context: '직접입력' }, actualQuantityText: '500g', memo: '' });
    const receipt = { scope: 'guest', operationId: 'private-receipt', purchaseNoteId: note.id,
      values: { name: '닭고기', quantityText: '500g', quantityStatus: 'verified', amount: 500, unit: 'g', preparationState: 'raw',
        purchaseDate: WEEK, expiryDate: '2026-10-20', category: '육류', storageType: '냉장', memo: '' } };
    await s.shopping.applyPurchaseReceipt(receipt);
    await s.shopping.applyPurchaseReceipt({ ...receipt, operationId: 'receipt-retry' });
    const correction = { scope: 'guest', weekStart: WEEK, slotId: `${WEEK}:dinner`, operationId: 'private-correction',
      cookingId: 'cooking:private-first', expectedConsumptionId: 'consumption:private-first', expectedPlanRevision: 3,
      completeUsageConfirmed: true, inventory: [s.check(await s.stock())], usages: [{ ...s.check(await s.stock()), amount: 100, unit: 'g' }] };
    await s.cooking.correctMealConsumption(correction);
    vi.setSystemTime(new Date('2026-09-28T03:02:00.000Z'));
    await s.cooking.correctMealConsumption({ ...correction, operationId: 'correction-retry' });
    const physical = await (await import('../inventoryQuantityRepository')).getInventoryQuantitySnapshot();
    expect(physical.inventory.reduce((sum, row) => sum + row.amount, 0)).toBe(700);
    const output = await s.pilot.prepareMealPlanPilotExport({ scope: 'guest', expectedVersion: s.state.version });
    expect(output.dataset.events).toHaveLength(5);
    const names = output.dataset.events.map(event => event.name).sort();
    expect(names).toEqual(['consumption_applied', 'consumption_applied', 'consumption_reversed', 'inventory_purchase_applied', 'meal_cooked_recorded']);
    const original = output.dataset.events.find(event => event.name === 'consumption_applied' && event.occurredAt === NOW);
    expect(output.dataset.events.find(event => event.name === 'consumption_reversed').reversesEventId).toBe(original.id);
    expect(JSON.stringify(output)).not.toMatch(/private-|닭고기|requestKey|sourceToken|quantity|memo|2026-09-28:dinner/);
    expect(await s.collector.getMealPlanPilotCapture()).toMatchObject({ captureState: 'collecting', pendingCount: 0, eventCount: 5 });
  });

  it('keeps a before-consent cooking reversal valid business but marks missing observation instead of backfilling history', async () => {
    const s = await setup({ consent: false });
    await s.cooking.recordMealCooking(s.input);
    expect(await s.rows()).toEqual([]);
    await s.grant();
    const result = await s.cooking.reverseMealConsumption({ scope: 'guest', weekStart: WEEK, slotId: `${WEEK}:dinner`,
      operationId: 'private-reverse', cookingId: 'cooking:private-first', expectedPlanRevision: 3,
      inventory: [s.check(await s.stock())] });
    expect(result.event.kind).toBe('consumption-reversal');
    // Nonzero reversal restores the raw amount but requires a fresh physical count.
    expect((await s.db.getAllIngredients())[0].quantity).toBe('300g');
    expect((await s.stock()).quantityStatus).toBe('unverified');
    expect(await s.collector.getMealPlanPilotCapture()).toMatchObject({ captureState: 'paused', eventCount: 0 });
    expect((await s.rows())[0].events).toEqual([]);
  });

  it('records a real rejected transaction as failure without changing inventory or collecting private exception text', async () => {
    const s = await setup();
    await expect(s.cooking.recordMealCooking({ ...s.input, expectedPlanRevision: 999 })).rejects.toThrow();
    expect((await s.stock()).amount).toBe(300);
    const [row] = await s.rows();
    expect(row.events).toHaveLength(1);
    expect(row.events[0]).toMatchObject({ name: 'meal_cooked_recorded', status: 'failure' });
    expect(row.capture.pending).toEqual([]);
    expect(JSON.stringify(row.events)).not.toMatch(/private|다시|300|quantity/);
  });

  it('never prevents physical cooking when only pilot writes are unavailable', async () => {
    const s = await setup();
    await s.db.runMealPlanPilotTransaction('readonly', store => {
      const put = Object.getPrototypeOf(store).put;
      vi.spyOn(Object.getPrototypeOf(store), 'put').mockImplementation(function (...args) {
        if (this.name === 'mealPlanPilot') { this.transaction.abort(); throw new DOMException('quota', 'QuotaExceededError'); }
        return put.apply(this, args);
      });
    });
    const result = await s.cooking.recordMealCooking(s.input);
    expect(result.event.id).toBe('cooking:private-first');
    expect((await s.stock()).amount).toBe(150);
    vi.restoreAllMocks();
    expect((await s.rows())[0].events).toEqual([]);
    expect(await s.collector.getMealPlanPilotCapture()).toMatchObject({ captureState: 'paused' });
  });
});
