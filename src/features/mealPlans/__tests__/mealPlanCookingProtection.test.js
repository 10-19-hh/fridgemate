import FDBFactory from 'fake-indexeddb/lib/FDBFactory';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  generateMealPlan, getSlotSummary, replaceMealPlanSlot, setMealPlanSlotSkipped, toggleMealPlanSlotLock,
} from '../mealPlanDomain.js';

const NOW = '2026-09-19T00:00:00.000Z';
const WEEK = '2026-09-14';

function plan() {
  return {
    id: `week:${WEEK}`, schemaVersion: 1, scope: 'guest', weekStart: WEEK,
    preferences: { servings: 1, excludedIngredients: [], dinnerDays: [0, 1, 2, 3, 4, 5, 6] },
    revision: 3, createdAt: NOW, updatedAt: NOW,
    slots: Array.from({ length: 7 }, (_, day) => {
      const date = `2026-09-${14 + day}`;
      return { id: `${date}:dinner`, date, mealType: 'dinner', status: 'planned', locked: false,
        servings: 1, templateKey: 'test:rice', templateVersion: 1, title: '밥', foodGroups: [],
        reason: '재료 확인 전 제안', notice: null, components: [{ id: 'rice', recipeKey: 'test:rice', recipeVersion: '1',
          title: '밥', role: 'staple', source: { kind: 'test', id: 'rice', name: '테스트' },
          sourceServings: 1, servings: 1, servingsStatus: 'verified', nutrition: null, nutritionStatus: 'unverified',
          ingredients: [{ id: 'rice-line', rawName: '밥', normalizedName: '밥', foodCode: null,
            amount: 200, unit: 'g', preparationState: 'cooked', quantityStatus: 'verified', quantityReason: '확인',
            selected: true, optional: false, foodGroups: ['grains'] }] }] };
    }),
  };
}

function cookedPlan(inventoryStatus = 'applied') {
  const value = plan();
  value.slots[0] = { ...value.slots[0], status: 'cooked', cooking: {
    id: 'cooking:first', recordedAt: NOW, inventoryStatus,
    consumptionId: inventoryStatus === 'needs-review' ? null : 'consumption:first',
    reversalId: inventoryStatus === 'reversed' ? 'consumption-reversal:undo' : null,
  } };
  return value;
}

function record(confirmed = cookedPlan(), draft = null) {
  return { id: `week:${WEEK}`, schemaVersion: 2, scope: 'guest', weekStart: WEEK,
    revision: 3, createdAt: NOW, updatedAt: NOW, confirmed, draft, archives: [] };
}

async function seed(value) {
  const db = await import('../../../db/indexedDB.js');
  await db.runMealPlanTransaction('readwrite', store => store.put(value), 'guest');
  return db;
}

async function rawRead(db) {
  return db.runMealPlanTransaction('readonly', store => store.get(`week:${WEEK}`), 'guest');
}

function cookingEvent(overrides = {}) {
  return { schemaVersion: 1, kind: 'cooking', id: 'cooking:first', operationId: 'first', scope: 'guest',
    weekStart: WEEK, slotId: `${WEEK}:dinner`, createdAt: NOW, requestKey: '{"usageMode":"unknown"}',
    inventoryStatus: 'needs-review', consumptionId: null, ...overrides };
}

function cancellation(overrides = {}) {
  return { schemaVersion: 1, kind: 'cooking-reversal', id: 'cooking-reversal:undo', operationId: 'undo', scope: 'guest',
    weekStart: WEEK, slotId: `${WEEK}:dinner`, createdAt: NOW, requestKey: '{"cookingId":"cooking:first"}',
    reversesId: 'cooking:first', ...overrides };
}

function appliedHistory() {
  const requestKey = '{"usageMode":"measured","usages":[{"ingredientId":"rice","amount":150,"unit":"g"}]}';
  return [cookingEvent({ inventoryStatus: 'applied', consumptionId: 'consumption:first', requestKey }), {
    schemaVersion: 1, kind: 'consumption', id: 'consumption:first', operationId: 'first', scope: 'guest',
    weekStart: WEEK, slotId: `${WEEK}:dinner`, createdAt: NOW, requestKey, cookingId: 'cooking:first',
    lines: [{ inventoryId: 'rice', ingredientKey: 'food:밥', name: '밥', amount: 150, unit: 'g', preparationState: 'cooked' }],
  }];
}

function consumptionInverse() {
  return { ...cancellation(), kind: 'consumption-reversal', id: 'consumption-reversal:undo', cookingId: 'cooking:first',
    reversesId: 'consumption:first', lines: [{ inventoryId: 'rice', ingredientKey: 'food:밥', name: '밥',
      amount: 150, unit: 'g', preparationState: 'cooked' }] };
}

async function seedEvents(history, scope = 'guest') {
  const db = await import('../../../db/indexedDB.js');
  await db.runMealCookingTransaction('readwrite', ({ events }) => {
    history.forEach(event => events.put(event));
  }, scope);
  return db;
}

async function readEvents(db, scope = 'guest') {
  return db.runMealCookingTransaction('readonly', ({ events }) => events.getAll(), scope);
}

describe('completed meals stay outside ordinary menu editing', () => {
  it('preserves the complete cooked snapshot when servings, exclusions and dinner days change', () => {
    const previous = cookedPlan();
    const original = structuredClone(previous);
    const next = generateMealPlan({ weekStart: WEEK, previousPlan: previous, confirmedPlan: previous, now: NOW,
      preferences: { servings: 2, dinnerDays: [], excludedIngredients: ['밥'] } });
    expect(next.slots[0]).toEqual(original.slots[0]);
    // AT-18 also preserves the intervening overdue planned meals; changing
    // dinner-day preferences only skips unresolved dates from today onward.
    expect(next.slots.slice(1, 5)).toEqual(original.slots.slice(1, 5));
    expect(next.slots.slice(5).every(slot => slot.status === 'skipped' && slot.servings === 2)).toBe(true);
    expect(previous).toEqual(original);
  });

  it('retains optional undefined fields so regeneration does not change a saved cooked snapshot', () => {
    const previous = cookedPlan();
    previous.slots[0].notice = undefined;
    const next = generateMealPlan({ weekStart: WEEK, previousPlan: previous, now: NOW });
    expect(next.slots[0]).toStrictEqual(previous.slots[0]);
    expect(next.slots[0]).not.toBe(previous.slots[0]);
  });

  it.each([
    ['replacement', value => replaceMealPlanSlot(value, value.slots[0].id, { now: NOW })],
    ['skipping', value => setMealPlanSlotSkipped(value, value.slots[0].id, true, { now: NOW })],
    ['restoring', value => setMealPlanSlotSkipped(value, value.slots[0].id, false, { now: NOW })],
    ['locking', value => toggleMealPlanSlotLock(value, value.slots[0].id, { now: NOW })],
  ])('does not change a cooked meal through %s', (_label, edit) => {
    const value = cookedPlan();
    expect(edit(value)).toBe(value);
  });

  it.each([
    ['applied', /실제 사용량/], ['needs-review', /확인/], ['reversed', /취소/],
  ])('describes %s cooking without presenting future shortages', (status, expectedReason) => {
    const summary = getSlotSummary(cookedPlan(status).slots[0], []);
    expect(summary.reason).toMatch(/조리/);
    expect(summary.reason).toMatch(expectedReason);
    expect(summary.missingIngredients).toEqual([]);
    expect(summary.availableIngredients).toEqual([]);
  });
});

describe('cooking metadata and persistence boundaries', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 8, 19, 12));
    Object.defineProperty(window, 'indexedDB', { configurable: true, value: new FDBFactory() });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it.each(['applied', 'needs-review', 'reversed'])('restores valid %s cooking and archived snapshots', async status => {
    const value = record(cookedPlan(status));
    value.archives = [cookedPlan('needs-review')];
    await seed(value);
    const repository = await import('../mealPlanRepository.js');
    await expect(repository.getMealPlan(WEEK)).resolves.toEqual(value);
    expect((await repository.getMealPlanningSnapshot()).confirmedPlans).toEqual([value.confirmed]);
  });

  it.each([
    ['missing cooking metadata', slot => { delete slot.cooking; }],
    ['missing event identity', slot => { slot.cooking.id = 'cooking:'; }],
    ['wrong event prefix', slot => { slot.cooking.id = 'consumption:first'; }],
    ['unsafe event identity', slot => { slot.cooking.id = 'cooking:with:colon'; }],
    ['invalid recording time', slot => { slot.cooking.recordedAt = '2026-02-30T00:00:00.000Z'; }],
    ['unknown inventory status', slot => { slot.cooking.inventoryStatus = 'done'; }],
    ['missing applied consumption', slot => { slot.cooking.consumptionId = null; }],
    ['wrong consumption prefix', slot => { slot.cooking.consumptionId = 'receipt:first'; }],
    ['applied but reversed event', slot => { slot.cooking.reversalId = 'consumption-reversal:undo'; }],
    ['unconfirmed but consumed', slot => { slot.cooking.inventoryStatus = 'needs-review'; }],
    ['reversed without inverse event', slot => { slot.cooking.inventoryStatus = 'reversed'; }],
    ['unknown cooking fields', slot => { slot.cooking.unknown = true; }],
    ['missing original menu', slot => { slot.components = []; }],
    ['missing menu title', slot => { slot.title = ''; }],
    ['missing template identity', slot => { slot.templateKey = null; }],
    ['planned with cooking metadata', slot => { slot.status = 'planned'; }],
    ['skipped with cooking metadata', slot => { slot.status = 'skipped'; }],
    ['empty with null cooking metadata', slot => { slot.status = 'empty'; slot.cooking = null; }],
  ])('rejects %s without changing stored history', async (_label, corrupt) => {
    const value = record();
    corrupt(value.confirmed.slots[0]);
    const db = await seed(value);
    const repository = await import('../mealPlanRepository.js');
    await expect(repository.getMealPlan(WEEK)).rejects.toThrow();
    expect(await rawRead(db)).toEqual(value);
  });

  it('does not create a cooking record through ordinary draft saving', async () => {
    const repository = await import('../mealPlanRepository.js');
    await expect(repository.saveMealPlan(cookedPlan(), 'guest', 0)).rejects.toThrow(/조리/);
    await expect(repository.getMealPlan(WEEK)).resolves.toBeNull();
  });

  it('saves other dates and confirms a draft while preserving the exact cooked snapshot', async () => {
    const value = record();
    await seed(value);
    const repository = await import('../mealPlanRepository.js');
    const draft = structuredClone(value.confirmed);
    draft.slots[5].title = '수정한 토요일';
    // Key insertion order is not a different cooking record.
    draft.slots[0].cooking = { reversalId: null, consumptionId: 'consumption:first', inventoryStatus: 'applied', recordedAt: NOW, id: 'cooking:first' };
    const saved = await repository.saveMealPlan(draft, 'guest', 3);
    expect(saved.draft.slots[0]).toEqual(value.confirmed.slots[0]);
    expect(saved.confirmed).toEqual(value.confirmed);
    const confirmed = await repository.confirmMealPlan(WEEK, 'guest', 4);
    expect(confirmed.confirmed.slots[0]).toEqual(value.confirmed.slots[0]);
    expect(confirmed.confirmed.slots[5].title).toBe('수정한 토요일');
    expect(confirmed.archives).toEqual([value.confirmed]);
  });

  it.each([
    ['removing completion', value => { value.slots[0] = plan().slots[0]; }],
    ['changing menu', value => { value.slots[0].title = '다른 음식'; }],
    ['changing servings', value => { value.slots[0].servings = 2; }],
    ['changing ingredients', value => { value.slots[0].components[0].ingredients[0].amount = 999; }],
    ['changing cooking identity', value => { value.slots[0].cooking.id = 'cooking:other'; }],
    ['changing inventory status', value => { value.slots[0].cooking = { ...value.slots[0].cooking, inventoryStatus: 'needs-review', consumptionId: null }; }],
    ['forging another completion', value => { value.slots[1] = { ...value.slots[1], status: 'cooked', cooking: { ...value.slots[0].cooking, id: 'cooking:second' } }; }],
  ])('rejects %s through save or confirm and preserves the current record', async (_label, change) => {
    const value = record();
    const candidate = structuredClone(value.confirmed);
    change(candidate);
    const db = await seed(value);
    const repository = await import('../mealPlanRepository.js');
    await expect(repository.saveMealPlan(candidate, 'guest', 3)).rejects.toThrow(/조리/);
    expect(await rawRead(db)).toEqual(value);
    const withStaleDraft = { ...value, draft: candidate };
    await seed(withStaleDraft);
    await expect(repository.confirmMealPlan(WEEK, 'guest', 3)).rejects.toThrow(/조리/);
    expect(await rawRead(db)).toEqual(withStaleDraft);
  });

  it('rejects a forged cooked draft at confirmation even without a previous confirmed plan', async () => {
    const value = record(null, cookedPlan());
    const db = await seed(value);
    const repository = await import('../mealPlanRepository.js');
    await expect(repository.confirmMealPlan(WEEK, 'guest', 3)).rejects.toThrow(/조리/);
    expect(await rawRead(db)).toEqual(value);
  });

  it('blocks a fresh draft after clearing its plan while the cooking event remains active', async () => {
    const db = await seed(record(cookedPlan('needs-review')));
    const history = [cookingEvent()];
    await seedEvents(history);
    const repository = await import('../mealPlanRepository.js');
    await repository.clearMealPlans();
    await expect(repository.saveMealPlan(plan(), 'guest', 0)).rejects.toThrow(/조리/);
    expect(await rawRead(db)).toBeUndefined();
    expect(await readEvents(db)).toEqual(history);
  });

  it('blocks confirming a restored stale draft that would recreate demand for an active cooked meal', async () => {
    const value = record(null, plan());
    const db = await seed(value);
    await seedEvents([cookingEvent()]);
    const repository = await import('../mealPlanRepository.js');
    await expect(repository.confirmMealPlan(WEEK, 'guest', 3)).rejects.toThrow(/조리/);
    expect(await rawRead(db)).toEqual(value);
  });

  it('does not accept a different cooking identity merely because the confirmed slot is cooked', async () => {
    const value = record(cookedPlan('needs-review'));
    value.confirmed.slots[0].cooking.id = 'cooking:other';
    const db = await seed(value);
    await seedEvents([cookingEvent()]);
    const repository = await import('../mealPlanRepository.js');
    await expect(repository.saveMealPlan(value.confirmed, 'guest', 3)).rejects.toThrow(/조리/);
    expect(await rawRead(db)).toEqual(value);
  });

  it('allows other-day edits and confirmation when active cooking still matches the preserved slot', async () => {
    const value = record(cookedPlan('needs-review'));
    const db = await seed(value);
    const history = [cookingEvent()];
    await seedEvents(history);
    const repository = await import('../mealPlanRepository.js');
    const draft = structuredClone(value.confirmed);
    draft.slots[5].title = '다른 날 수정';
    await repository.saveMealPlan(draft, 'guest', 3);
    const result = await repository.confirmMealPlan(WEEK, 'guest', 4);
    expect(result.confirmed.slots[0]).toEqual(value.confirmed.slots[0]);
    expect(result.confirmed.slots[5].title).toBe('다른 날 수정');
    expect(await readEvents(db)).toEqual(history);
  });

  it('allows a fresh plan only after a matching cooking cancellation without rewriting event history', async () => {
    const history = [cookingEvent(), cancellation()];
    const db = await seedEvents(history);
    const before = await readEvents(db);
    const repository = await import('../mealPlanRepository.js');
    await repository.saveMealPlan(plan(), 'guest', 0);
    const result = await repository.confirmMealPlan(WEEK, 'guest', 1);
    expect(result.confirmed.slots[0].status).toBe('planned');
    expect(await readEvents(db)).toEqual(before);
  });

  it('does not treat a consumption reversal as a cancellation of the cooking fact', async () => {
    const history = [...appliedHistory(), consumptionInverse()];
    const db = await seedEvents(history);
    const before = await readEvents(db);
    const repository = await import('../mealPlanRepository.js');
    await expect(repository.saveMealPlan(plan(), 'guest', 0)).rejects.toThrow(/조리/);
    expect(await rawRead(db)).toBeUndefined();
    expect(await readEvents(db)).toEqual(before);
  });

  it('rejects cancellation without the stock inverse on ordinary save and confirmation', async () => {
    const db = await seedEvents([...appliedHistory(), cancellation()]);
    const before = await readEvents(db);
    const repository = await import('../mealPlanRepository.js');
    await expect(repository.saveMealPlan(plan(), 'guest', 0)).rejects.toThrow(/조리|소비/);
    expect(await rawRead(db)).toBeUndefined();
    const restoredDraft = record(null, plan());
    await seed(restoredDraft);
    await expect(repository.confirmMealPlan(WEEK, 'guest', 3)).rejects.toThrow(/조리|소비/);
    expect(await rawRead(db)).toEqual(restoredDraft);
    expect(await readEvents(db)).toEqual(before);
  });

  it('rejects crosslinked consumption for another slot despite a matching active cooked marker', async () => {
    const value = record();
    const db = await seed(value);
    const history = appliedHistory();
    history[1].slotId = '2026-09-15:dinner';
    await seedEvents(history);
    const before = await readEvents(db);
    const repository = await import('../mealPlanRepository.js');
    await expect(repository.saveMealPlan(value.confirmed, 'guest', 3)).rejects.toThrow(/조리|소비/);
    expect(await rawRead(db)).toEqual(value);
    expect(await readEvents(db)).toEqual(before);
  });

  it('keeps ordinary changes working with complete applied cooking and consumption history', async () => {
    const value = record();
    const db = await seed(value);
    await seedEvents(appliedHistory());
    const before = await readEvents(db);
    const repository = await import('../mealPlanRepository.js');
    const draft = structuredClone(value.confirmed);
    draft.slots[5].title = '다른 날 수정';
    await repository.saveMealPlan(draft, 'guest', 3);
    const result = await repository.confirmMealPlan(WEEK, 'guest', 4);
    expect(result.confirmed.slots[0]).toEqual(value.confirmed.slots[0]);
    expect(result.confirmed.slots[5].title).toBe('다른 날 수정');
    expect(await readEvents(db)).toEqual(before);
  });

  it('allows recreating planned demand after both the stock inverse and cooking cancellation', async () => {
    const db = await seedEvents([...appliedHistory(), consumptionInverse(), cancellation()]);
    const before = await readEvents(db);
    const repository = await import('../mealPlanRepository.js');
    await repository.saveMealPlan(plan(), 'guest', 0);
    const result = await repository.confirmMealPlan(WEEK, 'guest', 1);
    expect(result.confirmed.slots[0].status).toBe('planned');
    expect(await readEvents(db)).toEqual(before);
  });

  it('does not let a cancellation from another slot hide active cooking', async () => {
    const db = await seedEvents([cookingEvent(), cancellation({ slotId: '2026-09-15:dinner' })]);
    const repository = await import('../mealPlanRepository.js');
    await expect(repository.saveMealPlan(plan(), 'guest', 0)).rejects.toThrow(/조리/);
    expect(await rawRead(db)).toBeUndefined();
  });

  it('keeps another week’s active cooking from blocking this week', async () => {
    const history = [cookingEvent({ weekStart: '2026-09-21', slotId: '2026-09-21:dinner' })];
    const db = await seedEvents(history);
    const repository = await import('../mealPlanRepository.js');
    await repository.saveMealPlan(plan(), 'guest', 0);
    const result = await repository.confirmMealPlan(WEEK, 'guest', 1);
    expect(result.confirmed.slots[0].status).toBe('planned');
    expect(await readEvents(db)).toEqual(history);
  });

  it('does not read or alter another account’s active cooking', async () => {
    const history = [cookingEvent({ scope: 'user:alice' })];
    const db = await seedEvents(history, 'user:alice');
    const repository = await import('../mealPlanRepository.js');
    await repository.saveMealPlan(plan(), 'guest', 0);
    const result = await repository.confirmMealPlan(WEEK, 'guest', 1);
    expect(result.confirmed.slots[0].status).toBe('planned');
    expect(await readEvents(db, 'user:alice')).toEqual(history);
    expect(await readEvents(db)).toEqual([]);
  });

  it.each([
    ['invalid cooking token', { id: 'cooking:', operationId: '' }],
    ['foreign cooking scope', { scope: 'user:alice' }],
    ['future cooking schema', { schemaVersion: 99 }],
    ['cooking disguised as a receipt ID', { id: 'receipt:first' }],
  ])('fails closed on %s before writing an ordinary draft', async (_label, overrides) => {
    const history = [cookingEvent(overrides)];
    const db = await seedEvents(history);
    const repository = await import('../mealPlanRepository.js');
    await expect(repository.saveMealPlan(plan(), 'guest', 0)).rejects.toThrow();
    expect(await rawRead(db)).toBeUndefined();
    expect(await readEvents(db)).toEqual(history);
  });
});
