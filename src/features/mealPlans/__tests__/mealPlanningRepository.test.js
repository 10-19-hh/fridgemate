import FDBFactory from 'fake-indexeddb/lib/FDBFactory';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const asOf = '2026-09-16T09:00:00+09:00';


// Plans are stored as draft/confirmed records; quantity approvals only follow the confirmed plan.
async function commitPlan(plans, plan, scope = 'guest') {
  const current = await plans.getMealPlan(plan.weekStart, scope);
  const saved = await plans.saveMealPlan(plan, scope, current?.revision ?? 0);
  return plans.confirmMealPlan(plan.weekStart, scope, saved.revision);
}

async function setup(scope = 'guest') {
  const db = await import('../../../db/indexedDB.js');
  const repository = await import('../mealPlanningRepository.js');
  const plans = await import('../mealPlanRepository.js');
  const { generateMealPlan } = await import('../mealPlanDomain.js');
  const plan = generateMealPlan({ weekStart: '2026-09-14', scope, now: asOf });
  await commitPlan(plans, plan, scope);
  const ingredient = { id: 'tomato', name: '방울토마토', quantity: '반 팩', consumed: false,
    expiryDate: '2026-09-30', updatedAt: asOf, memo: '기존 메모' };
  await db.saveIngredient(ingredient, scope);
  return { db, repository, plans, plan, ingredient, scope };
}

async function confirmation(ingredient, overrides = {}) {
  const { getPlanningInventoryBasis } = await import('../mealPlanningStock.js');
  return { ingredientId: ingredient.id, sourceBasis: getPlanningInventoryBasis([ingredient]),
    foodId: 'cherry-tomato', preparationState: 'raw', amount: 75, unit: 'g',
    quantityStatus: 'confirmed', availabilityStatus: 'available', expiryStatus: 'dated',
    expiryDate: '2026-09-30', confirmedAt: asOf, ...overrides };
}

async function storedState(db, scope = 'guest') {
  return db.runMealPlanningTransaction('readonly', ({ mealPlanningState }) => mealPlanningState.get('state'), scope);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-16T00:00:00Z'));
  vi.resetModules();
  Object.defineProperty(window, 'indexedDB', { configurable: true, value: new FDBFactory() });
});

describe('planning snapshot and stock approval storage', () => {
  it('reads all weeks and preserves raw quantities without auto-confirming a legacy plan', async () => {
    const { repository, plans, ingredient, db } = await setup();
    const { generateMealPlan } = await import('../mealPlanDomain.js');
    await commitPlan(plans, generateMealPlan({ weekStart: '2026-09-21', now: asOf }));
    const snapshot = await repository.getMealPlanningSnapshot({ scope: 'guest', asOf });
    expect(snapshot).toMatchObject({ scope: 'guest', fromDate: '2026-09-16',
      state: { schemaVersion: 1, revision: 0, commitments: [], stockConfirmations: [] },
      shopping: { status: 'calculated', items: [] },
    });
    expect(snapshot.plans.map((plan) => plan.id)).toEqual(['week:2026-09-14', 'week:2026-09-21']);
    expect(snapshot.ingredients).toEqual([ingredient]);
    expect(await db.runMealPlanningTransaction('readonly', ({ mealPlanningState }) => mealPlanningState.get('state'))).toBeUndefined();
  });

  it('isolates the same ids between scopes and rejects unsafe scope aliases', async () => {
    const { repository } = await setup();
    const other = await repository.getMealPlanningSnapshot({ scope: 'user:alice', asOf });
    expect(other).toMatchObject({ scope: 'user:alice', ingredients: [], plans: [] });
    await expect(repository.getMealPlanningSnapshot({ scope: 'user:a:b', asOf })).rejects.toThrow('계정');
  });

  it('saves explicit quantities separately and reloads them without changing fridge or repurchase data', async () => {
    const { repository, db, ingredient, plan, plans } = await setup();
    const manual = { id: 'manual-milk', name: '우유', consumed: true, quantity: '1개', memo: '직접 적은 메모' };
    await db.saveIngredient(manual);
    const snapshot = await repository.getMealPlanningSnapshot({ scope: 'guest', asOf });
    const saved = await repository.saveMealPlanningStock({ scope: 'guest', snapshot,
      confirmations: [await confirmation(ingredient)], asOf });
    expect(saved).toMatchObject({ state: { revision: 1, commitments: [], stockConfirmations: [
      { ingredientId: 'tomato', amount: 75, unit: 'g' },
    ] }, inventory: { items: [{ id: 'tomato', amount: 75 }] } });
    const reloaded = await repository.getMealPlanningSnapshot({ scope: 'guest', asOf });
    expect(reloaded.inventory.items).toEqual(saved.inventory.items);
    expect(await db.getIngredientById('tomato')).toEqual(ingredient);
    expect(await db.getIngredientById('manual-milk')).toEqual(manual);
    expect((await plans.getMealPlan('2026-09-14')).confirmed).toMatchObject({ id: plan.id, slots: plan.slots });
  });

  it.each(['stock edited', 'stock added', 'week edited', 'week added', 'week removed', 'day changed'])
    ('rejects a stale stock approval when %s without writing a partial state', async (kind) => {
      const { repository, db, ingredient, plans, plan } = await setup();
      const snapshot = await repository.getMealPlanningSnapshot({ scope: 'guest', asOf });
      if (kind === 'stock edited') await db.saveIngredient({ ...ingredient, quantity: '다른 양' });
      if (kind === 'stock added') await db.saveIngredient({ id: 'new', name: '양파' });
      if (kind === 'week edited') await commitPlan(plans, { ...plan, revision: 2 });
      if (kind === 'week added') {
        const { generateMealPlan } = await import('../mealPlanDomain.js');
        await commitPlan(plans, generateMealPlan({ weekStart: '2026-09-21', now: asOf }));
      }
      if (kind === 'week removed') await plans.clearMealPlans();
      await expect(repository.saveMealPlanningStock({ scope: 'guest', snapshot,
        confirmations: [await confirmation(ingredient)],
        asOf: kind === 'day changed' ? '2026-09-17T09:00:00+09:00' : asOf,
      })).rejects.toThrow('변경');
      expect(await storedState(db)).toBeUndefined();
    });

  it('serializes competing approvals so an old planning revision cannot overwrite the first one', async () => {
    const { repository, db, ingredient } = await setup();
    const snapshot = await repository.getMealPlanningSnapshot({ scope: 'guest', asOf });
    const first = await confirmation(ingredient, { amount: 75 });
    const second = await confirmation(ingredient, { amount: 30 });
    const results = await Promise.allSettled([
      repository.saveMealPlanningStock({ scope: 'guest', snapshot, confirmations: [first], asOf }),
      repository.saveMealPlanningStock({ scope: 'guest', snapshot, confirmations: [second], asOf }),
    ]);
    expect(results.map((result) => result.status)).toEqual(['fulfilled', 'rejected']);
    expect((await storedState(db)).stockConfirmations[0].amount).toBe(75);
  });

  it('does not reuse saved confirmed quantities after any raw stock change', async () => {
    const { repository, db, ingredient } = await setup();
    const snapshot = await repository.getMealPlanningSnapshot({ scope: 'guest', asOf });
    await repository.saveMealPlanningStock({ scope: 'guest', snapshot, confirmations: [await confirmation(ingredient)], asOf });
    await db.saveIngredient({ ...ingredient, quantity: '새 수량' });
    const changed = await repository.getMealPlanningSnapshot({ scope: 'guest', asOf });
    expect(changed.issues).toContainEqual({ code: 'stock_confirmation_stale' });
    expect(changed.allocation).toBeNull();
    expect(changed.shopping).toBeNull();
    expect((await storedState(db)).stockConfirmations[0].amount).toBe(75);
  });

  it('rejects a different account snapshot and invalid quantities before writing', async () => {
    const { repository, db, ingredient } = await setup();
    const snapshot = await repository.getMealPlanningSnapshot({ scope: 'guest', asOf });
    await expect(repository.saveMealPlanningStock({ scope: 'user:alice', snapshot, confirmations: [], asOf })).rejects.toThrow('계정');
    await expect(repository.saveMealPlanningStock({ scope: 'guest', snapshot,
      confirmations: [await confirmation(ingredient, { amount: -1 })], asOf })).rejects.toThrow('확인');
    expect(await storedState(db)).toBeUndefined();
    expect(await storedState(db, 'user:alice')).toBeUndefined();
  });

  it('preserves corrupt and future stored state rather than resetting or overwriting it', async () => {
    const { repository, db } = await setup();
    for (const record of [{ id: 'state', schemaVersion: 99 }, { id: 'state', schemaVersion: 1, scope: 'guest', revision: -1 }]) {
      await db.runMealPlanningTransaction('readwrite', ({ mealPlanningState }) => mealPlanningState.put(record));
      await expect(repository.getMealPlanningSnapshot({ scope: 'guest', asOf })).rejects.toThrow();
      expect(await storedState(db)).toEqual(record);
    }
  });
});

const recipeChange = (overrides = {}) => ({ type: 'set', planId: 'week:2026-09-14',
  slotId: '2026-09-16:dinner', recipeId: 'mfds:31', recipeVersion: '2026-09-15.1',
  mode: 'available', ...overrides });

async function withConfirmedCore(amount = 75) {
  const context = await setup();
  const onion = { id: 'onion', name: '양파', quantity: '일부' };
  const chives = { id: 'chives', name: '부추', quantity: '일부' };
  await context.db.saveIngredient(onion);
  await context.db.saveIngredient(chives);
  const confirmations = [await confirmation(context.ingredient, { amount }),
    await confirmation(onion, { foodId: 'onion', amount: 50 }),
    await confirmation(chives, { foodId: 'chives', amount: 50 })];
  const snapshot = await context.repository.saveMealPlanningStock({ scope: 'guest',
    snapshot: await context.repository.getMealPlanningSnapshot({ asOf }), confirmations, asOf });
  return { ...context, snapshot };
}

describe('explicit recipe-component quantity approval', () => {
  it('previews half quantities without writing and only approval creates the component demand', async () => {
    const { repository, db, plans, plan, ingredient, snapshot } = await withConfirmedCore();
    const preview = repository.previewMealPlanningChange({ snapshot, change: recipeChange() });
    expect(preview).toMatchObject({ status: 'ready', cookingPreview: { scaleFactor: 0.5 },
      proposedCommitment: { recipeId: 'mfds:31', quantityChoice: { targetServings: 1, scaleFactor: 0.5 } } });
    expect((await storedState(db)).commitments).toEqual([]);
    const result = await repository.approveMealPlanningChange({ scope: 'guest', preview, asOf });
    expect(result.state.revision).toBe(2);
    expect(result.state.commitments).toHaveLength(1);
    expect(result.allocation.meals).toHaveLength(1);
    expect(result.allocation.meals[0].requirements).toEqual(expect.arrayContaining([
      expect.objectContaining({ foodId: 'cherry-tomato', requiredAmount: 75, allocatedAmount: 75, missingAmount: 0 }),
      expect.objectContaining({ foodId: 'onion', requiredAmount: 5 }),
      expect.objectContaining({ foodId: 'chives', requiredAmount: 5 }),
    ]));
    expect(result.shopping.items).toContainEqual(expect.objectContaining({ foodId: 'whole-sesame-seeds', requiredAmount: null, needsConfirmation: true }));
    expect((await repository.getMealPlanningSnapshot({ asOf })).allocation.meals).toEqual(result.allocation.meals);
    expect(await db.getIngredientById('tomato')).toEqual(ingredient);
    expect((await plans.getMealPlan('2026-09-14')).confirmed).toMatchObject({ id: plan.id, slots: plan.slots });
  });

  it('uses the same stock across different weeks and only reduces the second demand after approval', async () => {
    const { repository, snapshot, plans, db } = await withConfirmedCore(225);
    await repository.approveMealPlanningChange({ preview: repository.previewMealPlanningChange({ snapshot,
      change: recipeChange({ mode: 'original' }) }), asOf });
    const { generateMealPlan } = await import('../mealPlanDomain.js');
    await commitPlan(plans, generateMealPlan({ weekStart: '2026-09-21', now: asOf }));
    const current = await repository.getMealPlanningSnapshot({ asOf });
    const second = recipeChange({ planId: 'week:2026-09-21', slotId: '2026-09-21:dinner' });
    const original = repository.previewMealPlanningChange({ snapshot: current, change: { ...second, mode: 'original' } });
    expect(original.shopping.items).toContainEqual(expect.objectContaining({ foodId: 'cherry-tomato', requiredAmount: 300,
      allocatedAmount: 225, knownMissingAmount: 75, needsConfirmation: false }));
    const preview = repository.previewMealPlanningChange({ snapshot: current, change: second });
    expect(preview.cookingPreview.scaleFactor).toBe(0.5);
    expect((await storedState(db)).commitments).toHaveLength(1);
    const result = await repository.approveMealPlanningChange({ preview, asOf });
    expect(result.allocation.meals.map((meal) => meal.requirements.find((line) => line.foodId === 'cherry-tomato').requiredAmount)).toEqual([150, 75]);
    expect(result.shopping.items.some((item) => item.foodId === 'cherry-tomato')).toBe(false);
  });

  it('keeps original quantities as an explicit alternative when inventory is unknown', async () => {
    const { repository } = await setup();
    const snapshot = await repository.getMealPlanningSnapshot({ asOf });
    const available = repository.previewMealPlanningChange({ snapshot, change: recipeChange() });
    expect(available.status).toBe('invalid');
    expect(available.issues).toContainEqual({ code: 'quantity_unavailable' });
    const original = repository.previewMealPlanningChange({ snapshot, change: recipeChange({ mode: 'original' }) });
    expect(original.status).toBe('ready');
    const saved = await repository.approveMealPlanningChange({ preview: original, asOf });
    expect(saved.shopping.items).toContainEqual(expect.objectContaining({ foodId: 'cherry-tomato', requiredAmount: 150,
      knownMissingAmount: 0, needsConfirmation: true }));
  });

  it('rejects stale or altered previews and preserves the last approved state', async () => {
    const { repository, db, snapshot, ingredient } = await withConfirmedCore();
    const preview = repository.previewMealPlanningChange({ snapshot, change: recipeChange() });
    const altered = structuredClone(preview);
    if (altered.proposedCommitment) altered.proposedCommitment.quantityChoice.scaleFactor = 1;
    await expect(repository.approveMealPlanningChange({ preview: altered, asOf })).rejects.toThrow();
    await db.saveIngredient({ ...ingredient, quantity: '수정' });
    await expect(repository.approveMealPlanningChange({ preview, asOf })).rejects.toThrow('변경');
    expect((await storedState(db)).commitments).toEqual([]);
  });

  it.each([
    ['past date', { slotId: '2026-09-15:dinner' }],
    ['unreviewed version', { recipeVersion: 'other' }],
    ['unreviewed recipe', { recipeId: 'mfds:999' }],
  ])('does not approve %s', async (_, overrides) => {
    const { repository, snapshot, db } = await withConfirmedCore();
    const preview = repository.previewMealPlanningChange({ snapshot, change: recipeChange(overrides) });
    expect(preview.status).toBe('invalid');
    await expect(repository.approveMealPlanningChange({ preview, asOf })).rejects.toThrow();
    expect((await storedState(db)).commitments).toEqual([]);
  });

  it.each(['locked', 'skipped', 'excluded'])('rejects a %s slot or recipe at preview', async (kind) => {
    const { repository, plans, plan } = await withConfirmedCore();
    const updated = structuredClone(plan);
    updated.revision = 2;
    if (kind === 'locked') updated.slots[2].locked = true;
    if (kind === 'skipped') updated.slots[2].status = 'skipped';
    if (kind === 'excluded') updated.preferences.excludedIngredients = ['부추'];
    await commitPlan(plans, updated);
    const snapshot = await repository.getMealPlanningSnapshot({ asOf });
    const preview = repository.previewMealPlanningChange({ snapshot, change: recipeChange({ mode: 'original' }) });
    expect(preview.status).toBe('invalid');
  });

  it('removes only the approved component and preserves raw repurchase records', async () => {
    const { repository, db, snapshot } = await withConfirmedCore();
    const approved = await repository.approveMealPlanningChange({ preview: repository.previewMealPlanningChange({ snapshot,
      change: recipeChange({ mode: 'original' }) }), asOf });
    const manual = { id: 'milk-note', name: '우유', consumed: true, memo: '직접 적은 메모' };
    await db.saveIngredient(manual);
    const current = await repository.getMealPlanningSnapshot({ asOf });
    const preview = repository.previewMealPlanningChange({ snapshot: current,
      change: { type: 'remove', planId: 'week:2026-09-14', slotId: '2026-09-16:dinner' } });
    expect(preview.status).toBe('ready');
    const saved = await repository.approveMealPlanningChange({ preview, asOf });
    expect(saved.state.commitments).toEqual([]);
    expect(saved.state.revision).toBe(approved.state.revision + 1);
    expect(await db.getIngredientById('milk-note')).toEqual(manual);
  });

  it('does not double-approve a repeated request or use a preview from another account', async () => {
    const { repository, snapshot, db } = await withConfirmedCore();
    const preview = repository.previewMealPlanningChange({ snapshot, change: recipeChange() });
    expect(preview.status).toBe('ready');
    await expect(repository.approveMealPlanningChange({ scope: 'user:alice', preview, asOf })).rejects.toThrow('계정');
    const outcomes = await Promise.allSettled([
      repository.approveMealPlanningChange({ preview, asOf }), repository.approveMealPlanningChange({ preview, asOf }),
    ]);
    expect(outcomes.map((entry) => entry.status)).toEqual(['fulfilled', 'rejected']);
    expect((await storedState(db)).commitments).toHaveLength(1);
    expect(await storedState(db, 'user:alice')).toBeUndefined();
  });

  it('accepts an unchanged preview later that day but not after the local date rolls over', async () => {
    const { repository, snapshot } = await withConfirmedCore();
    const preview = repository.previewMealPlanningChange({ snapshot, change: recipeChange() });
    expect(preview.status).toBe('ready');
    await expect(repository.approveMealPlanningChange({ preview, asOf: '2026-09-16T15:00:00Z' })).rejects.toThrow('변경');
    const saved = await repository.approveMealPlanningChange({ preview, asOf: '2026-09-16T01:00:00Z' });
    expect(saved.state.commitments[0].quantityChoice.confirmedAt).toBe(asOf);
    expect(saved.state.commitments[0].quantityChoice.scaleFactor).toBe(0.5);
  });

  it('preserves the approved half portion when stock confirmation later increases', async () => {
    const { repository, snapshot, ingredient } = await withConfirmedCore();
    const preview = repository.previewMealPlanningChange({ snapshot, change: recipeChange() });
    expect(preview.status).toBe('ready');
    const saved = await repository.approveMealPlanningChange({ preview, asOf });
    const confirmations = saved.state.stockConfirmations.map((entry) => ({ ...entry }));
    confirmations[0] = await confirmation(ingredient, { amount: 300 });
    const increased = await repository.saveMealPlanningStock({ snapshot: saved, confirmations, asOf });
    expect(increased.allocation.meals[0].requirements.find((line) => line.foodId === 'cherry-tomato').requiredAmount).toBe(75);
  });

  it('does not substitute edited snapshot amounts for the persisted stock at approval', async () => {
    const { repository, snapshot, db } = await withConfirmedCore();
    const altered = structuredClone(snapshot);
    altered.state.stockConfirmations.find((entry) => entry.ingredientId === 'tomato').amount = 150;
    const preview = repository.previewMealPlanningChange({ snapshot: altered, change: recipeChange() });
    expect(preview.status).toBe('ready');
    await expect(repository.approveMealPlanningChange({ preview, asOf })).rejects.toThrow('변경');
    expect((await storedState(db)).commitments).toEqual([]);
  });

  it('requires explicit reconfirmation after a quantity-affecting plan edit instead of silently freeing stock', async () => {
    const { repository, snapshot, plans, plan } = await withConfirmedCore();
    await repository.approveMealPlanningChange({ preview: repository.previewMealPlanningChange({ snapshot,
      change: recipeChange() }), asOf });
    const edited = structuredClone(plan);
    edited.revision += 1;
    edited.slots[2].servings = 2;
    await commitPlan(plans, edited);
    const changed = await repository.getMealPlanningSnapshot({ asOf });
    expect(changed.state.commitments[0]).toMatchObject({ status: 'suspended', suspensionReason: 'slot_changed',
      quantityChoice: { targetServings: 1, scaleFactor: 0.5 } });
    expect(changed.issues).toContainEqual({ code: 'commitment_reconfirmation_required', commitmentId: changed.state.commitments[0].id });
    expect(changed.allocation).toBeNull();
    expect(changed.shopping).toBeNull();
    const preview = repository.previewMealPlanningChange({ snapshot: changed, change: recipeChange() });
    expect(preview.proposedCommitment.quantityChoice).toMatchObject({ targetServings: 2, scaleFactor: 0.25 });
    const saved = await repository.approveMealPlanningChange({ preview, asOf });
    expect(saved.allocation.meals[0].requirements.find((line) => line.foodId === 'cherry-tomato').requiredAmount).toBe(75);
  });

  it('retains approved demand after an unrelated day edit or lock, and forbids quantity edits while locked', async () => {
    const { repository, snapshot, plans, plan } = await withConfirmedCore();
    await repository.approveMealPlanningChange({ preview: repository.previewMealPlanningChange({ snapshot, change: recipeChange() }), asOf });
    const { setMealPlanSlotSkipped, toggleMealPlanSlotLock } = await import('../mealPlanDomain.js');
    const edited = toggleMealPlanSlotLock(setMealPlanSlotSkipped(plan, plan.slots[3].id, true), plan.slots[2].id);
    await commitPlan(plans, edited);
    const current = await repository.getMealPlanningSnapshot({ asOf });
    expect(current.state.commitments[0].status).toBe('active');
    expect(current.allocation.meals[0]).toMatchObject({ planRevision: edited.revision });
    expect(current.allocation.meals[0].requirements.find((line) => line.foodId === 'cherry-tomato').requiredAmount).toBe(75);
    expect(repository.previewMealPlanningChange({ snapshot: current, change: recipeChange() }).status).toBe('invalid');
    expect(repository.previewMealPlanningChange({ snapshot: current, change: recipeChange({ type: 'remove' }) }).status).toBe('invalid');
  });

  it('releases only planned demand on skip and does not restore quantity approval with the menu', async () => {
    const { repository, snapshot, plans, plan, db, ingredient } = await withConfirmedCore();
    await repository.approveMealPlanningChange({ preview: repository.previewMealPlanningChange({ snapshot, change: recipeChange() }), asOf });
    const { setMealPlanSlotSkipped } = await import('../mealPlanDomain.js');
    const skipped = setMealPlanSlotSkipped(plan, plan.slots[2].id, true);
    await commitPlan(plans, skipped);
    expect((await repository.getMealPlanningSnapshot({ asOf })).shopping.items).toEqual([]);
    await commitPlan(plans, setMealPlanSlotSkipped(skipped, plan.slots[2].id, false));
    const restored = await repository.getMealPlanningSnapshot({ asOf });
    expect(restored.state.commitments[0].status).toBe('suspended');
    expect(restored.allocation.meals).toEqual([]);
    expect(await db.getIngredientById('tomato')).toEqual(ingredient);
  });

  it('reports failed persistence without a partially approved portion', async () => {
    const { repository, snapshot, db } = await withConfirmedCore();
    const preview = repository.previewMealPlanningChange({ snapshot, change: recipeChange() });
    expect(preview.status).toBe('ready');
    const { default: FDBObjectStore } = await import('fake-indexeddb/lib/FDBObjectStore');
    const put = FDBObjectStore.prototype.put;
    const fault = vi.spyOn(FDBObjectStore.prototype, 'put').mockImplementation(function (...args) {
      if (this.name === 'mealPlanningState') throw new DOMException('용량 부족', 'QuotaExceededError');
      return put.apply(this, args);
    });
    try {
      await expect(repository.approveMealPlanningChange({ preview, asOf })).rejects.toThrow('용량 부족');
    } finally { fault.mockRestore(); }
    expect((await storedState(db)).revision).toBe(1);
    expect((await storedState(db)).commitments).toEqual([]);
  });

  it('does not render an invalid numeric allocation as an empty, sufficient shopping list', async () => {
    const { repository, snapshot, ingredient } = await withConfirmedCore();
    const approved = await repository.approveMealPlanningChange({ preview: repository.previewMealPlanningChange({ snapshot,
      change: recipeChange() }), asOf });
    const confirmations = approved.state.stockConfirmations.map((entry) => ({ ...entry }));
    confirmations[0] = await confirmation(ingredient, { amount: Number.MAX_VALUE });
    const invalid = await repository.saveMealPlanningStock({ snapshot: approved, confirmations, asOf });
    expect(invalid.issues).toContainEqual({ code: 'allocation_calculation_failed' });
    expect(invalid.shopping).toBeNull();
    expect(invalid.allocation).toBeNull();
  });
});
