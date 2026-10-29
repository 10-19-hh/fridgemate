import FDBFactory from 'fake-indexeddb/lib/FDBFactory';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const NOW = '2026-09-12T00:00:00.000Z';

function createPlan(scope = 'guest', overrides = {}) {
  return {
    id: 'week:2026-09-14', schemaVersion: 1, scope, weekStart: '2026-09-14',
    preferences: { servings: 1, excludedIngredients: [], dinnerDays: [0, 1, 2, 3, 4, 5, 6] },
    revision: 1, createdAt: '2026-09-12T00:00:00.000Z', updatedAt: '2026-09-12T00:00:00.000Z',
    slots: Array.from({ length: 7 }, (_, index) => {
      const date = `2026-09-${14 + index}`;
      return {
        id: `${date}:dinner`, date, mealType: 'dinner', status: 'empty', locked: false,
        servings: 1, templateKey: null, templateVersion: null, title: '', components: [], foodGroups: [], reason: '후보 없음'
      };
    }),
    ...overrides
  };
}

function openRaw(version, upgrade) {
  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open('fridgemate-db__guest', version);
    request.onupgradeneeded = () => upgrade?.(request.result);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function rawWrite(database, storeName, item) {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(storeName, 'readwrite');
    transaction.objectStore(storeName).put(item);
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
  });
}

function rawRead(database, id = 'week:2026-09-14') {
  return new Promise((resolve, reject) => {
    const request = database.transaction('mealPlans').objectStore('mealPlans').get(id);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function createEnvelope(plan = createPlan(), overrides = {}) {
  return {
    id: plan.id, schemaVersion: 2, scope: plan.scope, weekStart: plan.weekStart,
    revision: plan.revision, createdAt: plan.createdAt, updatedAt: plan.updatedAt,
    draft: structuredClone(plan), confirmed: null, archives: [], ...overrides
  };
}

function createWeekPlan(weekStart, scope = 'guest') {
  const plan = createPlan(scope, { id: `week:${weekStart}`, weekStart });
  plan.slots = plan.slots.map((slot, index) => {
    const date = new Date(`${weekStart}T12:00:00.000Z`);
    date.setUTCDate(date.getUTCDate() + index);
    const day = date.toISOString().slice(0, 10);
    return { ...slot, id: `${day}:dinner`, date: day };
  });
  return plan;
}

describe('meal plan persistence', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(NOW));
    Object.defineProperty(window, 'indexedDB', { configurable: true, value: new FDBFactory() });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('returns an empty scoped planning snapshot', async () => {
    const repository = await import('../mealPlanRepository.js');
    expect(repository.getMealPlanningSnapshot).toBeTypeOf('function');
    expect(await repository.getMealPlanningSnapshot()).toEqual({ scope: 'guest', ingredients: [], inventory: [], quantityReviews: [], confirmedPlans: [] });
  });

  it('reads all confirmed weeks in date order without exposing drafts or archives or changing legacy records', async () => {
    const repository = await import('../mealPlanRepository.js');
    const db = await import('../../../db/indexedDB.js');
    await repository.getMealPlan('2026-09-14');
    const raw = await openRaw();
    const past = createWeekPlan('2026-09-07');
    const current = createWeekPlan('2026-09-14');
    const future = createWeekPlan('2026-09-28');
    const legacy = createWeekPlan('2026-09-21');
    const draftOnly = createEnvelope(createWeekPlan('2026-10-05'));
    const currentDraft = createPlan('guest', { revision: 3, preferences: { servings: 2, excludedIngredients: ['두부'], dinnerDays: [0] } });
    const records = [
      createEnvelope(past, { draft: null, confirmed: past }),
      createEnvelope(current, { revision: 3, draft: currentDraft, confirmed: current, archives: [createPlan('guest', { revision: 2 })] }),
      legacy,
      createEnvelope(future, { draft: null, confirmed: future }),
      draftOnly
    ];
    for (const record of [...records].reverse()) await rawWrite(raw, 'mealPlans', record);
    const ingredients = [
      { id: 'active', name: '두부', quantity: '반 모', consumed: false },
      { id: 'repurchase', name: '우유', quantity: '다음 구매 2통', consumed: true, memo: '메모 유지' }
    ];
    await db.saveIngredients(ingredients);
    expect(repository.getMealPlanningSnapshot).toBeTypeOf('function');
    const snapshot = await repository.getMealPlanningSnapshot();
    expect(snapshot).toEqual({
      scope: 'guest', ingredients, confirmedPlans: [past, current, future],
      inventory: ingredients.map((ingredient) => expect.objectContaining({ ...ingredient, quantityStatus: 'unverified', amount: null })),
      quantityReviews: ingredients.map((ingredient) => ({ schemaVersion: 1, id: ingredient.id, scope: 'guest', revision: 1, status: 'unverified' }))
    });
    expect(snapshot.confirmedPlans.map((plan) => plan.weekStart)).toEqual(['2026-09-07', '2026-09-14', '2026-09-28']);
    expect(await db.runMealPlanTransaction('readonly', (store) => store.getAll())).toEqual(records);
    expect(await db.getAllIngredients()).toEqual(ingredients);
    raw.close();
  });

  it('keeps planning snapshots scoped and rejects invalid scope names before reading', async () => {
    const repository = await import('../mealPlanRepository.js');
    const db = await import('../../../db/indexedDB.js');
    for (const scope of ['guest', 'user:alice', 'user:bob']) {
      await repository.saveMealPlan(createPlan(scope), scope, 0);
      await repository.confirmMealPlan('2026-09-14', scope, 1);
      await db.saveIngredient({ id: 'same-id', name: scope, quantity: '1개' }, scope);
    }
    expect(repository.getMealPlanningSnapshot).toBeTypeOf('function');
    const snapshot = await repository.getMealPlanningSnapshot('user:alice');
    expect(snapshot).toEqual({
      scope: 'user:alice', ingredients: [{ id: 'same-id', name: 'user:alice', quantity: '1개' }],
      confirmedPlans: [createPlan('user:alice')],
      inventory: [expect.objectContaining({ id: 'same-id', name: 'user:alice', quantityStatus: 'unverified', amount: null })],
      quantityReviews: [{ schemaVersion: 1, id: 'same-id', scope: 'user:alice', revision: 1, status: 'unverified' }]
    });
    await expect(repository.getMealPlanningSnapshot('user:a:b')).rejects.toThrow('계정');
    await expect(repository.getMealPlanningSnapshot('')).rejects.toThrow('계정');
  });

  it('rejects an array-valued scope even when the guest database is empty', async () => {
    const repository = await import('../mealPlanRepository.js');
    await expect(repository.getMealPlanningSnapshot({ scope: ['user:alice'] })).rejects.toThrow('계정');
    expect(await repository.getMealPlanningSnapshot({ scope: 'user:alice' })).toEqual({
      scope: 'user:alice', ingredients: [], inventory: [], quantityReviews: [], confirmedPlans: []
    });
  });

  it.each([
    ['a future schema', (record) => { record.schemaVersion = 9; }],
    ['a foreign scope', (record) => { record.scope = 'user:alice'; }],
    ['a mismatched key', (record) => { record.id = 'week:2026-09-21'; }],
    ['a missing week', (record) => { delete record.weekStart; }],
    ['an impossible empty-envelope date', (record) => { record.id = 'week:2026-02-30'; record.weekStart = '2026-02-30'; }],
    ['a non-Monday empty-envelope date', (record) => { record.id = 'week:2026-09-15'; record.weekStart = '2026-09-15'; }],
    ['a corrupt ignored draft', (record) => { record.draft = createPlan('guest', { slots: [] }); }],
    ['a sparse ignored archive', (record) => { record.archives = new Array(1); }],
    ['a future confirmed snapshot', (record) => { record.confirmed = createPlan('guest', { schemaVersion: 7 }); }]
  ])('rejects a planning snapshot containing %s rather than hiding it', async (_label, corrupt) => {
    const repository = await import('../mealPlanRepository.js');
    await repository.getMealPlan('2026-09-14');
    const raw = await openRaw();
    const record = createEnvelope(createPlan(), { draft: null });
    corrupt(record);
    await rawWrite(raw, 'mealPlans', record);
    expect(repository.getMealPlanningSnapshot).toBeTypeOf('function');
    await expect(repository.getMealPlanningSnapshot()).rejects.toThrow();
    expect(await rawRead(raw, record.id)).toEqual(record);
    raw.close();
  });

  it('accepts a valid empty envelope without inventing a confirmed plan', async () => {
    const repository = await import('../mealPlanRepository.js');
    await repository.getMealPlan('2026-09-14');
    const raw = await openRaw();
    const record = createEnvelope(createPlan(), { draft: null });
    await rawWrite(raw, 'mealPlans', record);
    expect(repository.getMealPlanningSnapshot).toBeTypeOf('function');
    expect(await repository.getMealPlanningSnapshot()).toEqual({ scope: 'guest', ingredients: [], inventory: [], quantityReviews: [], confirmedPlans: [] });
    expect(await rawRead(raw)).toEqual(record);
    raw.close();
  });

  it('uses only a current quantity review for planning and preserves raw quantity proof and memo', async () => {
    const repository = await import('../mealPlanRepository.js');
    const quantities = await import('../inventoryQuantityRepository.js');
    const { getInventorySourceToken } = await import('../inventoryQuantityDomain.js');
    const db = await import('../../../db/indexedDB.js');
    const ingredient = {
      id: 'stock', name: '닭고기', quantity: '반 팩', memo: '다음에 2팩 구매', consumed: false,
      amount: 999, unit: 'g', ingredientKey: 'food:닭고기', preparationState: 'raw',
      quantityStatus: 'verified', quantityEvidence: 'untrusted raw proof'
    };
    await db.saveIngredient(ingredient);
    const unverified = await repository.getMealPlanningSnapshot();
    expect(unverified.ingredients).toEqual([ingredient]);
    expect(unverified.inventory).toEqual([expect.objectContaining({
      id: 'stock', quantity: '반 팩', memo: '다음에 2팩 구매', quantityStatus: 'unverified',
      amount: null, unit: null, ingredientKey: null, preparationState: null, quantityEvidence: null
    })]);

    const saved = await quantities.saveInventoryQuantity({
      scope: 'guest', ingredientId: 'stock', expectedSourceToken: getInventorySourceToken(ingredient), expectedRevision: 1,
      values: { name: '닭고기', amount: 300, unit: 'g', preparationState: 'raw' }
    });
    const verified = await repository.getMealPlanningSnapshot();
    expect(verified.inventory).toEqual([expect.objectContaining({
      id: 'stock', quantityStatus: 'verified', quantityState: 'verified', amount: 300, unit: 'g',
      ingredientKey: 'food:닭고기', preparationState: 'raw', quantityRevision: 2,
      quantityEvidence: `user-confirmation:2:${NOW}`
    })]);
    expect(verified.quantityReviews).toEqual([saved]);
    expect(verified.ingredients).toEqual([ingredient]);
    expect(await db.getAllIngredients()).toEqual([ingredient]);
  });

  it('does not use an old review after the raw quantity changes or the ingredient is consumed', async () => {
    const repository = await import('../mealPlanRepository.js');
    const { createInventoryQuantityReview } = await import('../inventoryQuantityDomain.js');
    const db = await import('../../../db/indexedDB.js');
    const ingredient = { id: 'stock', name: '닭고기', quantity: '반 팩', consumed: false };
    await db.saveIngredient(ingredient);
    const raw = await openRaw();
    const review = createInventoryQuantityReview({
      ingredient, scope: 'guest', values: { name: '닭고기', amount: 300, unit: 'g', preparationState: 'raw' }, revision: 2, now: NOW
    });
    await rawWrite(raw, 'inventoryQuantities', review);
    // Simulate an imported stale sidecar: reads must not trust it even without a normal write's invalidation marker.
    const changed = { ...ingredient, quantity: '다른 팩' };
    await rawWrite(raw, 'ingredients', changed);
    const stale = await repository.getMealPlanningSnapshot();
    expect(stale.ingredients).toEqual([changed]);
    expect(stale.quantityReviews).toEqual([review]);
    expect(stale.inventory).toEqual([expect.objectContaining({ quantityState: 'stale', quantityStatus: 'unverified', amount: null })]);

    const consumed = { ...ingredient, consumed: true, memo: '재구매 메모' };
    await rawWrite(raw, 'ingredients', consumed);
    const unavailable = await repository.getMealPlanningSnapshot();
    expect(unavailable.ingredients).toEqual([consumed]);
    expect(unavailable.inventory).toEqual([expect.objectContaining({ consumed: true, memo: '재구매 메모', quantityStatus: 'unverified', amount: null })]);
    raw.close();
  });

  it('keeps valid orphan and deleted quantity markers without inventing inventory', async () => {
    const repository = await import('../mealPlanRepository.js');
    const db = await import('../../../db/indexedDB.js');
    await db.saveIngredient({ id: 'deleted', name: '두부', deletedAt: NOW });
    const marker = { schemaVersion: 1, id: 'orphan', scope: 'guest', revision: 4, status: 'unverified' };
    await db.runInventoryQuantityTransaction('readwrite', ({ quantities }) => quantities.put(marker));
    expect(await repository.getMealPlanningSnapshot()).toEqual({
      scope: 'guest', ingredients: [], inventory: [], confirmedPlans: [],
      quantityReviews: [{ schemaVersion: 1, id: 'deleted', scope: 'guest', revision: 1, status: 'unverified' }, marker]
    });
  });

  it.each([
    ['foreign orphan marker', { id: 'orphan', scope: 'user:alice' }],
    ['future orphan marker', { id: 'orphan', schemaVersion: 8 }],
    ['invalid orphan revision', { id: 'orphan', revision: 0 }],
    ['foreign deleted marker', { id: 'deleted', scope: 'user:alice' }],
    ['future deleted marker', { id: 'deleted', schemaVersion: 8 }],
    ['malformed verified orphan', { id: 'orphan', status: 'verified', amount: -1 }]
  ])('rejects a %s even when no active ingredient refers to it', async (_label, overrides) => {
    const repository = await import('../mealPlanRepository.js');
    const db = await import('../../../db/indexedDB.js');
    await db.saveIngredient({ id: 'deleted', name: '두부', deletedAt: NOW });
    const review = { schemaVersion: 1, id: 'orphan', scope: 'guest', revision: 1, status: 'unverified', ...overrides };
    await db.runInventoryQuantityTransaction('readwrite', ({ quantities }) => quantities.put(review));
    await expect(repository.getMealPlanningSnapshot()).rejects.toThrow();
    expect(await db.runInventoryQuantityTransaction('readonly', ({ quantities }) => quantities.get(review.id))).toEqual(review);
  });

  it('rejects raw inventory from a different scope rather than projecting its quantity', async () => {
    const repository = await import('../mealPlanRepository.js');
    const db = await import('../../../db/indexedDB.js');
    const ingredient = { id: 'foreign', scope: 'user:alice', name: '두부', quantity: '한 모' };
    await db.saveIngredient(ingredient);
    await expect(repository.getMealPlanningSnapshot()).rejects.toThrow('범위');
    expect(await db.getAllIngredients()).toEqual([ingredient]);
  });

  it('projects raw stock, reviewed amount and confirmed plans from one committed snapshot', async () => {
    const repository = await import('../mealPlanRepository.js');
    const { createInventoryQuantityReview } = await import('../inventoryQuantityDomain.js');
    const db = await import('../../../db/indexedDB.js');
    const beforeIngredient = { id: 'stock', name: '닭고기', quantity: '전날 반 팩', consumed: false };
    const afterIngredient = { ...beforeIngredient, quantity: '새로 산 한 팩' };
    const beforePlan = createPlan();
    const afterPlan = createPlan('guest', { revision: 3, preferences: { servings: 2, excludedIngredients: [], dinnerDays: [0] } });
    const beforeReview = createInventoryQuantityReview({
      ingredient: beforeIngredient, scope: 'guest', values: { name: '닭고기', amount: 300, unit: 'g', preparationState: 'raw' }, revision: 2, now: NOW
    });
    const afterReview = createInventoryQuantityReview({
      ingredient: afterIngredient, scope: 'guest', values: { name: '닭고기', amount: 600, unit: 'g', preparationState: 'raw' }, revision: 4, now: NOW
    });
    await db.saveIngredient(beforeIngredient);
    const raw = await openRaw();
    await rawWrite(raw, 'mealPlans', createEnvelope(beforePlan, { draft: null, confirmed: beforePlan }));
    await rawWrite(raw, 'inventoryQuantities', beforeReview);
    const prototype = Object.getPrototypeOf(raw.transaction('ingredients').objectStore('ingredients'));
    const getAll = prototype.getAll;
    let queuedWrite;
    vi.spyOn(prototype, 'getAll').mockImplementation(function (...args) {
      const request = getAll.apply(this, args);
      if (this.name === 'ingredients' && !queuedWrite) {
        queuedWrite = new Promise((resolve, reject) => {
          const transaction = raw.transaction(['ingredients', 'mealPlans', 'inventoryQuantities'], 'readwrite');
          transaction.objectStore('ingredients').put(afterIngredient);
          transaction.objectStore('mealPlans').put(createEnvelope(afterPlan, { draft: null, confirmed: afterPlan }));
          transaction.objectStore('inventoryQuantities').put(afterReview);
          transaction.oncomplete = resolve;
          transaction.onabort = () => reject(transaction.error);
        });
      }
      return request;
    });
    const before = await repository.getMealPlanningSnapshot();
    expect(before.ingredients).toEqual([beforeIngredient]);
    expect(before.confirmedPlans).toEqual([beforePlan]);
    expect(before.quantityReviews).toEqual([beforeReview]);
    expect(before.inventory).toEqual([expect.objectContaining({ quantityStatus: 'verified', amount: 300 })]);
    await queuedWrite;
    const after = await repository.getMealPlanningSnapshot();
    expect(after.ingredients).toEqual([afterIngredient]);
    expect(after.confirmedPlans).toEqual([afterPlan]);
    expect(after.quantityReviews).toEqual([afterReview]);
    expect(after.inventory).toEqual([expect.objectContaining({ quantityStatus: 'verified', amount: 600 })]);
    raw.close();
  });

  it('rejects an aborted three-store read rather than returning an empty planning snapshot', async () => {
    const repository = await import('../mealPlanRepository.js');
    const db = await import('../../../db/indexedDB.js');
    const ingredient = { id: 'keep', name: '두부', quantity: '반 모' };
    await db.saveIngredient(ingredient);
    const raw = await openRaw();
    const prototype = Object.getPrototypeOf(raw.transaction('inventoryQuantities').objectStore('inventoryQuantities'));
    const getAll = prototype.getAll;
    let abortOnce = true;
    vi.spyOn(prototype, 'getAll').mockImplementation(function (...args) {
      const request = getAll.apply(this, args);
      if (this.name === 'inventoryQuantities' && abortOnce) {
        abortOnce = false;
        request.addEventListener('success', () => this.transaction.abort());
      }
      return request;
    });
    await expect(repository.getMealPlanningSnapshot()).rejects.toThrow();
    const retry = await repository.getMealPlanningSnapshot();
    expect(retry.ingredients).toEqual([ingredient]);
    expect(retry.inventory).toEqual([expect.objectContaining({ id: 'keep', quantityStatus: 'unverified', amount: null })]);
    raw.close();
  });

  it('upgrades v1 without changing existing ingredients', async () => {
    const old = await openRaw(1, (database) => database.createObjectStore('ingredients', { keyPath: 'id' }));
    const ingredient = { id: 'old-tofu', quantity: '반 모', consumed: false };
    await rawWrite(old, 'ingredients', ingredient);
    old.close();
    const { getMealPlan, saveMealPlan } = await import('../mealPlanRepository.js');
    const { getAllIngredients } = await import('../../../db/indexedDB.js');

    expect(await getMealPlan('2026-09-14', 'guest')).toBeNull();
    await saveMealPlan(createPlan(), 'guest', 0);
    expect(await getAllIngredients()).toEqual([ingredient]);
    const upgraded = await openRaw();
    expect(upgraded.version).toBe(7);
    expect(Array.from(upgraded.objectStoreNames)).toEqual(['ingredients', 'inventoryEvents', 'inventoryQuantities', 'mealPlanPilot', 'mealPlans', 'menuDecisions', 'shoppingEntries']);
    upgraded.close();
  });

  it('upgrades main v2 while preserving ingredients and menu decisions', async () => {
    const old = await openRaw(2, (database) => {
      database.createObjectStore('ingredients', { keyPath: 'id' });
      database.createObjectStore('menuDecisions', { keyPath: 'decisionDate' });
    });
    const ingredient = { id: 'main-tofu', quantity: '반 모', consumed: false };
    const decision = { decisionDate: '2026-09-14', recipeId: 'recipe-1', status: 'selected' };
    await rawWrite(old, 'ingredients', ingredient);
    await rawWrite(old, 'menuDecisions', decision);
    old.close();
    const repository = await import('../mealPlanRepository.js');
    const db = await import('../../../db/indexedDB.js');

    expect(await repository.getMealPlan('2026-09-14')).toBeNull();
    const plan = createPlan();
    await repository.saveMealPlan(plan, 'guest', 0);
    expect(await repository.getMealPlan('2026-09-14')).toEqual(createEnvelope(plan));
    expect(await db.getAllIngredients()).toEqual([ingredient]);
    expect(await db.getMenuDecision('2026-09-14')).toEqual(decision);
    const upgraded = await openRaw();
    expect(upgraded.version).toBe(7);
    expect(Array.from(upgraded.objectStoreNames)).toEqual(['ingredients', 'inventoryEvents', 'inventoryQuantities', 'mealPlanPilot', 'mealPlans', 'menuDecisions', 'shoppingEntries']);
    upgraded.close();
  });

  it('upgrades feature v2 while preserving ingredients and saved meal plan snapshots', async () => {
    const old = await openRaw(2, (database) => {
      database.createObjectStore('ingredients', { keyPath: 'id' });
      database.createObjectStore('mealPlans', { keyPath: 'id' });
    });
    const ingredient = { id: 'feature-tofu', quantity: '한 모', consumed: false };
    const plan = createPlan('guest', { revision: 4 });
    await rawWrite(old, 'ingredients', ingredient);
    await rawWrite(old, 'mealPlans', plan);
    old.close();
    const repository = await import('../mealPlanRepository.js');
    const db = await import('../../../db/indexedDB.js');

    expect(await repository.getMealPlan('2026-09-14')).toEqual(createEnvelope(plan));
    expect(await db.getAllIngredients()).toEqual([ingredient]);
    expect(await db.getMenuDecision('2026-09-14')).toBeUndefined();
    const decision = { decisionDate: '2026-09-14', recipeId: 'recipe-1', status: 'selected' };
    await db.saveMenuDecision(decision);
    expect(await db.getMenuDecision('2026-09-14')).toEqual(decision);
    expect(await repository.getMealPlan('2026-09-14')).toEqual(createEnvelope(plan));
    const upgraded = await openRaw();
    expect(upgraded.version).toBe(7);
    expect(Array.from(upgraded.objectStoreNames)).toEqual(['ingredients', 'inventoryEvents', 'inventoryQuantities', 'mealPlanPilot', 'mealPlans', 'menuDecisions', 'shoppingEntries']);
    expect(await rawRead(upgraded)).toEqual(plan);
    upgraded.close();
  });

  it('keeps guest, users, and weeks separate and clears only the requested plans', async () => {
    const repository = await import('../mealPlanRepository.js');
    const db = await import('../../../db/indexedDB.js');
    for (const scope of ['guest', 'user:alice', 'user:bob']) {
      await repository.saveMealPlan(createPlan(scope), scope, 0);
    }
    await db.saveIngredient({ id: 'keep-me' });
    expect(await repository.getMealPlan('2026-09-21', 'guest')).toBeNull();
    await repository.clearMealPlans('user:alice');
    expect(await repository.getMealPlan('2026-09-14', 'user:alice')).toBeNull();
    expect((await repository.getMealPlan('2026-09-14', 'guest')).scope).toBe('guest');
    expect((await repository.getMealPlan('2026-09-14', 'user:bob')).scope).toBe('user:bob');
    expect(await db.getAllIngredients()).toEqual([{ id: 'keep-me' }]);
  });

  it('refuses cross-scope writes and malformed plans without overwriting a saved week', async () => {
    const repository = await import('../mealPlanRepository.js');
    const original = createPlan();
    await repository.saveMealPlan(original, 'guest', 0);
    await expect(repository.saveMealPlan(createPlan('user:alice'), 'guest', 1)).rejects.toThrow('다른 계정');
    await expect(repository.saveMealPlan(createPlan('guest', { slots: [], revision: 2 }), 'guest', 1)).rejects.toThrow('형식');
    await expect(repository.getMealPlan('2026-02-30')).rejects.toThrow('날짜');
    await expect(repository.getMealPlan('2026-09-14', 'user:a:b')).rejects.toThrow('계정');
    expect(await repository.getMealPlan('2026-09-14')).toEqual(createEnvelope(original));
  });

  it('refuses reading or overwriting future or corrupt stored data', async () => {
    const repository = await import('../mealPlanRepository.js');
    await repository.getMealPlan('2026-09-14');
    const raw = await openRaw();
    for (const invalid of [createPlan('guest', { schemaVersion: 7 }), createPlan('guest', { slots: [{}] })]) {
      await rawWrite(raw, 'mealPlans', invalid);
      await expect(repository.getMealPlan('2026-09-14')).rejects.toThrow();
      await expect(repository.saveMealPlan(createPlan('guest', { revision: 9 }), 'guest', 1)).rejects.toThrow();
      const stored = await new Promise((resolve) => {
        const request = raw.transaction('mealPlans').objectStore('mealPlans').get(invalid.id);
        request.onsuccess = () => resolve(request.result);
      });
      expect(stored).toEqual(invalid);
    }
    raw.close();
  });

  it('atomically rejects stale revisions from another tab', async () => {
    const repository = await import('../mealPlanRepository.js');
    await repository.saveMealPlan(createPlan(), 'guest', 0);
    const first = createPlan('guest', { revision: 2, updatedAt: '2026-09-12T01:00:00.000Z' });
    const stale = createPlan('guest', { revision: 2, preferences: { servings: 2, excludedIngredients: [], dinnerDays: [0] } });
    const results = await Promise.allSettled([repository.saveMealPlan(first, 'guest', 1), repository.saveMealPlan(stale, 'guest', 1)]);
    expect(results.map((result) => result.status)).toEqual(['fulfilled', 'rejected']);
    expect(await repository.getMealPlan('2026-09-14')).toEqual(createEnvelope({ ...first, updatedAt: NOW }));
  });

  it('roundtrips generated snapshots and rejects malformed nested ingredients before UI use', async () => {
    const repository = await import('../mealPlanRepository.js');
    const { generateMealPlan } = await import('../mealPlanDomain.js');
    const generated = generateMealPlan({ weekStart: '2026-09-14', scope: 'guest', now: '2026-09-12T00:00:00.000Z' });
    await repository.saveMealPlan(generated, 'guest', 0);
    expect(await repository.getMealPlan('2026-09-14')).toEqual(createEnvelope(generated));
    const raw = await openRaw();
    for (const malformed of [null, { selected: true, rawName: {} }, { selected: true, rawName: '두부', foodGroups: 'proteinFoods' }]) {
      const corrupted = structuredClone(generated);
      corrupted.slots[0].components[0].ingredients = [malformed];
      await rawWrite(raw, 'mealPlans', corrupted);
      await expect(repository.getMealPlan('2026-09-14')).rejects.toThrow('형식');
    }
    const unknownStatus = structuredClone(generated);
    unknownStatus.slots[0].status = 'cooked';
    await rawWrite(raw, 'mealPlans', unknownStatus);
    await expect(repository.getMealPlan('2026-09-14')).rejects.toThrow('형식');
    raw.close();
  });

  it('preserves previous data when the new draft cannot be cloned', async () => {
    const repository = await import('../mealPlanRepository.js');
    const previous = await repository.saveMealPlan(createPlan(), 'guest', 0);
    await expect(repository.saveMealPlan(createPlan('guest', { revision: 2, invalid: () => {} }), 'guest', 1)).rejects.toThrow();
    expect((await repository.getMealPlan('2026-09-14')).revision).toBe(1);
    expect(await repository.getMealPlan('2026-09-14')).toEqual(previous);
  });

  it('rejects non-text notices on read and write without replacing stored data', async () => {
    const repository = await import('../mealPlanRepository.js');
    const original = createPlan();
    await repository.saveMealPlan(original, 'guest', 0);
    const malformed = createPlan('guest', { revision: 2 });
    malformed.slots[0].notice = { message: 'Not a renderable notice' };
    await expect(repository.saveMealPlan(malformed, 'guest', 1)).rejects.toThrow('형식');
    expect(await repository.getMealPlan('2026-09-14')).toEqual(createEnvelope(original));

    const raw = await openRaw();
    await rawWrite(raw, 'mealPlans', malformed);
    await expect(repository.getMealPlan('2026-09-14')).rejects.toThrow('형식');
    await expect(repository.saveMealPlan(createPlan('guest', { revision: 3 }), 'guest', 2)).rejects.toThrow('형식');
    const stored = await new Promise((resolve) => {
      const request = raw.transaction('mealPlans').objectStore('mealPlans').get(malformed.id);
      request.onsuccess = () => resolve(request.result);
    });
    expect(stored).toEqual(malformed);
    raw.close();
  });

  it('stores only a draft and assigns revisions and timestamps without trusting the caller', async () => {
    const repository = await import('../mealPlanRepository.js');
    const input = createPlan('guest', {
      revision: 900, createdAt: '2099-01-01T00:00:00.000Z', updatedAt: '2099-01-02T00:00:00.000Z'
    });
    const saved = await repository.saveMealPlan(input, 'guest', 0);
    expect(saved).toEqual(createEnvelope());
    expect(input.revision).toBe(900);
    expect(input.createdAt).toBe('2099-01-01T00:00:00.000Z');
    vi.setSystemTime(new Date('2026-09-13T01:00:00.000Z'));
    const updated = await repository.saveMealPlan(input, 'guest', 1);
    expect(updated).toMatchObject({
      revision: 2, createdAt: NOW, updatedAt: '2026-09-13T01:00:00.000Z',
      draft: { revision: 2, createdAt: NOW, updatedAt: '2026-09-13T01:00:00.000Z' },
      confirmed: null, archives: []
    });
    expect(await repository.getMealPlan('2026-09-14')).toEqual(updated);
  });

  it.each([undefined, null, -1, 1.5, NaN, Number.MAX_SAFE_INTEGER + 1])(
    'requires an explicit nonnegative safe expectedRevision, rejecting %s without a write', async (expectedRevision) => {
      const repository = await import('../mealPlanRepository.js');
      await expect(repository.saveMealPlan(createPlan(), 'guest', expectedRevision)).rejects.toThrow();
      expect(await repository.getMealPlan('2026-09-14')).toBeNull();
      expect(repository.confirmMealPlan).toBeTypeOf('function');
      await expect(repository.confirmMealPlan('2026-09-14', 'guest', expectedRevision)).rejects.toThrow();
      expect(await repository.getMealPlan('2026-09-14')).toBeNull();
    }
  );

  it('rejects a stale edit even when its caller-supplied plan revision is higher', async () => {
    const repository = await import('../mealPlanRepository.js');
    const saved = await repository.saveMealPlan(createPlan(), 'guest', 0);
    await expect(repository.saveMealPlan(createPlan('guest', { revision: 999 }), 'guest', 0)).rejects.toThrow('다른 화면');
    await expect(repository.saveMealPlan(createPlan('guest', { revision: 999 }), 'guest', 2)).rejects.toThrow('다른 화면');
    expect(await repository.getMealPlan('2026-09-14')).toEqual(saved);
  });

  it('converts a legacy record on explicit draft save without confirming or discarding its contents', async () => {
    const repository = await import('../mealPlanRepository.js');
    await repository.getMealPlan('2026-09-14');
    const raw = await openRaw();
    const legacy = createPlan('guest', { revision: 4, createdAt: '2026-09-10T00:00:00.000Z' });
    await rawWrite(raw, 'mealPlans', legacy);
    expect(await repository.getMealPlan('2026-09-14')).toEqual(createEnvelope(legacy));
    expect(await rawRead(raw)).toEqual(legacy);
    const saved = await repository.saveMealPlan(legacy, 'guest', 4);
    expect(saved).toEqual(createEnvelope({ ...legacy, revision: 5, updatedAt: NOW }));
    expect(await rawRead(raw)).toEqual(saved);
    raw.close();
  });

  it('confirms only the saved draft and preserves its snapshot revision and unreviewed quantities', async () => {
    const repository = await import('../mealPlanRepository.js');
    const { generateMealPlan } = await import('../mealPlanDomain.js');
    const generated = generateMealPlan({ weekStart: '2026-09-14', scope: 'guest', now: NOW });
    const saved = await repository.saveMealPlan(generated, 'guest', 0);
    expect(repository.confirmMealPlan).toBeTypeOf('function');
    vi.setSystemTime(new Date('2026-09-13T01:00:00.000Z'));
    const confirmed = await repository.confirmMealPlan('2026-09-14', 'guest', 1);
    expect(confirmed).toEqual({
      ...saved, revision: 2, updatedAt: '2026-09-13T01:00:00.000Z', draft: null, confirmed: saved.draft
    });
    expect(confirmed.confirmed.revision).toBe(1);
    expect(confirmed.confirmed.slots[0].components[0].ingredients[0].quantityStatus).toBe('unverified');
    expect(await repository.getMealPlan('2026-09-14')).toEqual(confirmed);
  });

  it('keeps the effective confirmed plan while editing and archives each explicitly replaced snapshot', async () => {
    const repository = await import('../mealPlanRepository.js');
    await repository.saveMealPlan(createPlan(), 'guest', 0);
    expect(repository.confirmMealPlan).toBeTypeOf('function');
    const first = await repository.confirmMealPlan('2026-09-14', 'guest', 1);
    const changed = createPlan('guest', { preferences: { servings: 2, excludedIngredients: ['두부'], dinnerDays: [1] } });
    const editing = await repository.saveMealPlan(changed, 'guest', 2);
    expect(editing).toMatchObject({ revision: 3, confirmed: first.confirmed, archives: [] });
    expect(editing.draft.preferences).toEqual({ servings: 2, excludedIngredients: ['두부'], dinnerDays: [1] });
    expect(editing.draft.revision).toBe(3);
    const second = await repository.confirmMealPlan('2026-09-14', 'guest', 3);
    expect(second).toMatchObject({ revision: 4, draft: null, confirmed: editing.draft, archives: [first.confirmed] });
    const nextDraft = await repository.saveMealPlan(createPlan(), 'guest', 4);
    expect(nextDraft.archives).toEqual([first.confirmed]);
    const third = await repository.confirmMealPlan('2026-09-14', 'guest', 5);
    expect(third).toMatchObject({ revision: 6, draft: null, confirmed: nextDraft.draft, archives: [first.confirmed, second.confirmed] });
    expect(await repository.getMealPlan('2026-09-14')).toEqual(third);
  });

  it('confirms a legacy snapshot only after an explicit matching-revision command', async () => {
    const repository = await import('../mealPlanRepository.js');
    await repository.getMealPlan('2026-09-14');
    const raw = await openRaw();
    const legacy = createPlan('guest', { revision: 4 });
    await rawWrite(raw, 'mealPlans', legacy);
    expect(repository.confirmMealPlan).toBeTypeOf('function');
    const confirmed = await repository.confirmMealPlan('2026-09-14', 'guest', 4);
    expect(confirmed).toEqual(createEnvelope(legacy, { revision: 5, draft: null, confirmed: legacy }));
    expect(await rawRead(raw)).toEqual(confirmed);
    raw.close();
  });

  it('rejects repeated or missing-draft confirmation without changing the stored record', async () => {
    const repository = await import('../mealPlanRepository.js');
    expect(repository.confirmMealPlan).toBeTypeOf('function');
    await expect(repository.confirmMealPlan('2026-09-14', 'guest', 0)).rejects.toThrow('초안');
    expect(await repository.getMealPlan('2026-09-14')).toBeNull();
    await repository.saveMealPlan(createPlan(), 'guest', 0);
    const confirmed = await repository.confirmMealPlan('2026-09-14', 'guest', 1);
    await expect(repository.confirmMealPlan('2026-09-14', 'guest', 2)).rejects.toThrow('초안');
    expect(await repository.getMealPlan('2026-09-14')).toEqual(confirmed);
  });

  it('serializes save and confirm commands using the same expected revision', async () => {
    const repository = await import('../mealPlanRepository.js');
    await repository.saveMealPlan(createPlan(), 'guest', 0);
    expect(repository.confirmMealPlan).toBeTypeOf('function');
    const outcomes = await Promise.allSettled([
      repository.confirmMealPlan('2026-09-14', 'guest', 1),
      repository.saveMealPlan(createPlan('guest', { revision: 99 }), 'guest', 1)
    ]);
    expect(outcomes.map((result) => result.status)).toEqual(['fulfilled', 'rejected']);
    expect(outcomes[1].reason.message).toContain('다른 화면');
    expect(await repository.getMealPlan('2026-09-14')).toMatchObject({ revision: 2, draft: null, confirmed: createPlan(), archives: [] });
  });

  it.each([
    ['future envelope version', (record) => { record.schemaVersion = 3; }],
    ['cross-scope envelope', (record) => { record.scope = 'user:alice'; }],
    ['wrong envelope week', (record) => { record.weekStart = '2026-09-21'; }],
    ['invalid envelope revision', (record) => { record.revision = 0; }],
    ['invalid envelope timestamp', (record) => { record.updatedAt = 'not a date'; }],
    ['missing draft field', (record) => { delete record.draft; }],
    ['missing confirmed field', (record) => { delete record.confirmed; }],
    ['invalid archives collection', (record) => { record.archives = {}; }],
    ['missing archived snapshot in a sparse array', (record) => { delete record.archives[0]; }],
    ['missing date slot in a sparse draft', (record) => { delete record.draft.slots[3]; }],
    ['missing date slot in a sparse confirmed snapshot', (record) => { delete record.confirmed.slots[3]; }],
    ['missing date slot in a sparse archived snapshot', (record) => { delete record.archives[0].slots[3]; }],
    ['draft revision ahead of its record', (record) => { record.draft.revision = 6; }],
    ['confirmed revision ahead of its record', (record) => { record.confirmed.revision = 6; }],
    ['archived revision ahead of its record', (record) => { record.archives[0].revision = 6; }],
    ['cross-scope draft', (record) => { record.draft.scope = 'user:alice'; }],
    ['wrong draft week', (record) => { record.draft.weekStart = '2026-09-21'; }],
    ['future draft version', (record) => { record.draft.schemaVersion = 4; }],
    ['malformed confirmed snapshot', (record) => { record.confirmed.slots = []; }],
    ['cross-scope archived snapshot', (record) => { record.archives[0].scope = 'user:alice'; }],
    ['future archived version', (record) => { record.archives[0].schemaVersion = 4; }]
  ])('rejects %s in every repository operation without overwriting it', async (_label, corrupt) => {
    const repository = await import('../mealPlanRepository.js');
    await repository.getMealPlan('2026-09-14');
    const raw = await openRaw();
    const record = createEnvelope(createPlan('guest', { revision: 5 }), {
      confirmed: createPlan('guest', { revision: 3 }), archives: [createPlan()]
    });
    corrupt(record);
    await rawWrite(raw, 'mealPlans', record);
    await expect(repository.getMealPlan('2026-09-14')).rejects.toThrow();
    await expect(repository.saveMealPlan(createPlan(), 'guest', 5)).rejects.toThrow();
    expect(repository.confirmMealPlan).toBeTypeOf('function');
    await expect(repository.confirmMealPlan('2026-09-14', 'guest', 5)).rejects.toThrow();
    expect(await rawRead(raw)).toEqual(record);
    raw.close();
  });

  it.each(['all seven missing', 'one date missing'])('rejects sparse legacy slots: %s', async (missingSlots) => {
    const repository = await import('../mealPlanRepository.js');
    await repository.getMealPlan('2026-09-14');
    const raw = await openRaw();
    const legacy = createPlan();
    if (missingSlots === 'all seven missing') legacy.slots = new Array(7);
    else delete legacy.slots[3];
    await expect(repository.saveMealPlan(legacy, 'guest', 0)).rejects.toThrow('형식');
    expect(await repository.getMealPlan('2026-09-14')).toBeNull();
    await rawWrite(raw, 'mealPlans', legacy);
    await expect(repository.getMealPlan('2026-09-14')).rejects.toThrow('형식');
    await expect(repository.saveMealPlan(createPlan(), 'guest', 1)).rejects.toThrow('형식');
    await expect(repository.confirmMealPlan('2026-09-14', 'guest', 1)).rejects.toThrow('형식');
    expect(await rawRead(raw)).toEqual(legacy);
    raw.close();
  });

  it.each([
    ['excluded ingredients', (plan) => { plan.preferences.excludedIngredients = new Array(1); }],
    ['dinner days', (plan) => { plan.preferences.dinnerDays = new Array(1); }],
    ['meal components', (plan) => { plan.slots[0].components = new Array(1); }],
    ['component ingredients', (plan) => { plan.slots[0].components[0].ingredients = new Array(1); }],
    ['slot food groups', (plan) => { plan.slots[0].foodGroups = new Array(1); }],
    ['ingredient food groups', (plan) => { plan.slots[0].components[0].ingredients[0].foodGroups = new Array(1); }]
  ])('rejects sparse %s on draft save and in stored snapshots', async (_label, corrupt) => {
    const repository = await import('../mealPlanRepository.js');
    const { generateMealPlan } = await import('../mealPlanDomain.js');
    const plan = generateMealPlan({ weekStart: '2026-09-14', scope: 'guest', now: NOW });
    corrupt(plan);
    await expect(repository.saveMealPlan(plan, 'guest', 0)).rejects.toThrow('형식');
    expect(await repository.getMealPlan('2026-09-14')).toBeNull();
    const raw = await openRaw();
    const record = createEnvelope(plan);
    await rawWrite(raw, 'mealPlans', record);
    await expect(repository.getMealPlan('2026-09-14')).rejects.toThrow('형식');
    await expect(repository.saveMealPlan(createPlan(), 'guest', 1)).rejects.toThrow('형식');
    await expect(repository.confirmMealPlan('2026-09-14', 'guest', 1)).rejects.toThrow('형식');
    expect(await rawRead(raw)).toEqual(record);
    raw.close();
  });

  it.each(['save', 'confirm'])('preserves draft, confirmed and archives when the %s transaction aborts', async (operation) => {
    const repository = await import('../mealPlanRepository.js');
    await repository.getMealPlan('2026-09-14');
    const raw = await openRaw();
    const previous = createEnvelope(createPlan('guest', { revision: 5 }), {
      confirmed: createPlan('guest', { revision: 3 }), archives: [createPlan()]
    });
    await rawWrite(raw, 'mealPlans', previous);
    const prototype = Object.getPrototypeOf(raw.transaction('mealPlans').objectStore('mealPlans'));
    const put = prototype.put;
    vi.spyOn(prototype, 'put').mockImplementationOnce(function (value) {
      const request = put.call(this, value);
      this.transaction.abort();
      return request;
    });
    if (operation === 'confirm') expect(repository.confirmMealPlan).toBeTypeOf('function');
    await expect(operation === 'save'
      ? repository.saveMealPlan(createPlan(), 'guest', 5)
      : repository.confirmMealPlan('2026-09-14', 'guest', 5)).rejects.toThrow();
    expect(await rawRead(raw)).toEqual(previous);
    // A retry must succeed, proving the failure was the aborted write, not invalid input.
    const retried = operation === 'save'
      ? await repository.saveMealPlan(createPlan(), 'guest', 5)
      : await repository.confirmMealPlan('2026-09-14', 'guest', 5);
    expect(retried.revision).toBe(6);
    expect(retried.confirmed).toEqual(operation === 'save' ? previous.confirmed : previous.draft);
    expect(retried.archives).toEqual(operation === 'save' ? previous.archives : [...previous.archives, previous.confirmed]);
    expect(await rawRead(raw)).toEqual(retried);
    raw.close();
  });

  it('rejects revision exhaustion instead of writing an unsafe revision', async () => {
    const repository = await import('../mealPlanRepository.js');
    await repository.getMealPlan('2026-09-14');
    const raw = await openRaw();
    const previous = createEnvelope(createPlan('guest', { revision: Number.MAX_SAFE_INTEGER }));
    await rawWrite(raw, 'mealPlans', previous);
    await expect(repository.saveMealPlan(createPlan(), 'guest', Number.MAX_SAFE_INTEGER)).rejects.toThrow();
    expect(repository.confirmMealPlan).toBeTypeOf('function');
    await expect(repository.confirmMealPlan('2026-09-14', 'guest', Number.MAX_SAFE_INTEGER)).rejects.toThrow();
    expect(await rawRead(raw)).toEqual(previous);
    raw.close();
  });

  it('reports a blocked upgrade and allows retry after the older tab closes', async () => {
    const old = await openRaw(1, (database) => database.createObjectStore('ingredients', { keyPath: 'id' }));
    const repository = await import('../mealPlanRepository.js');
    await expect(repository.getMealPlan('2026-09-14')).rejects.toThrow('다른 탭');
    old.close();
    await expect(repository.getMealPlan('2026-09-14')).resolves.toBeNull();
  });

  it('allows retry after browser access to IndexedDB fails synchronously', async () => {
    const repository = await import('../mealPlanRepository.js');
    const spy = vi.spyOn(window.indexedDB, 'open').mockImplementationOnce(() => {
      throw new DOMException('Storage access denied', 'SecurityError');
    });
    await expect(repository.getMealPlan('2026-09-14')).rejects.toThrow('Storage access denied');
    await expect(repository.getMealPlan('2026-09-14')).resolves.toBeNull();
    spy.mockRestore();
  });

  it('releases cached connections on versionchange and reopens after database deletion', async () => {
    const repository = await import('../mealPlanRepository.js');
    await repository.saveMealPlan(createPlan(), 'guest', 0);
    await new Promise((resolve, reject) => {
      const request = window.indexedDB.deleteDatabase('fridgemate-db__guest');
      request.onsuccess = resolve;
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('Connection was not released'));
    });
    await expect(repository.getMealPlan('2026-09-14')).resolves.toBeNull();
  });

  it('account deletion clears that account’s ingredients, plans and menu decisions but preserves guests', async () => {
    const repository = await import('../mealPlanRepository.js');
    const db = await import('../../../db/indexedDB.js');
    await repository.saveMealPlan(createPlan('user:alice'), 'user:alice', 0);
    await db.saveIngredient({ id: 'alice-stock' }, 'user:alice');
    await db.saveMenuDecision({ decisionDate: '2026-09-14', recipeId: 'alice-recipe' }, 'user:alice');
    await repository.saveMealPlan(createPlan(), 'guest', 0);
    await db.saveIngredient({ id: 'guest-stock' });
    const guestDecision = { decisionDate: '2026-09-14', recipeId: 'guest-recipe' };
    await db.saveMenuDecision(guestDecision);
    await db.clearAccountLocalData({ scope: 'user:alice' });
    expect(await repository.getMealPlan('2026-09-14', 'user:alice')).toBeNull();
    expect(await db.getAllIngredients('user:alice')).toEqual([]);
    expect(await db.getMenuDecision('2026-09-14', 'user:alice')).toBeUndefined();
    expect(await repository.getMealPlan('2026-09-14')).not.toBeNull();
    expect(await db.getAllIngredients()).toEqual([{ id: 'guest-stock' }]);
    expect(await db.getMenuDecision('2026-09-14')).toEqual(guestDecision);
  });

  it.each([
    ['required alias', false, 'preferences'], ['unselected optional alias', true, 'preferences'],
    ['alias resolved by unlocking and replacing', false, 'replacement'],
  ])('blocks confirmation of a locked %s exclusion conflict without losing the editable draft', async (_label, optional, resolution) => {
    const repository = await import('../mealPlanRepository.js');
    const { generateMealPlan, toggleMealPlanSlotLock, replaceMealPlanSlot } = await import('../mealPlanDomain.js');
    const db = await import('../../../db/indexedDB.js');
    const plan = generateMealPlan({ scope: 'guest', weekStart: '2026-09-14', now: NOW,
      preferences: { servings: 1, dinnerDays: [0], excludedIngredients: [] } });
    const component = plan.slots[0].components[0];
    component.ingredients = [{ ...component.ingredients[0], rawName: '달걀', normalizedName: '계란', optional, selected: !optional }];
    plan.slots[0].components = [component];
    plan.slots[0].locked = true;
    await db.saveIngredient({ id: 'keep', name: '계란', quantity: '3개' });
    await repository.saveMealPlan(plan, 'guest', 0);
    const original = await repository.confirmMealPlan(plan.weekStart, 'guest', 1);
    const draft = generateMealPlan({ scope: 'guest', weekStart: plan.weekStart, previousPlan: original.confirmed,
      preferences: { ...plan.preferences, excludedIngredients: ['계란'] }, now: NOW });
    expect(draft.slots[0].notice).toContain('제외 재료');
    await repository.saveMealPlan(draft, 'guest', 2);
    const before = await repository.getMealPlan(plan.weekStart);
    const inventory = await repository.getMealPlanningSnapshot();
    await expect(repository.confirmMealPlan(plan.weekStart, 'guest', 3)).rejects.toThrow('제외');
    expect(await repository.getMealPlan(plan.weekStart)).toEqual(before);
    expect(await repository.getMealPlanningSnapshot()).toEqual(inventory);
    let resolved = structuredClone(before.draft);
    if (resolution === 'replacement') {
      resolved = replaceMealPlanSlot(toggleMealPlanSlotLock(resolved, resolved.slots[0].id), resolved.slots[0].id);
      expect(resolved.slots[0].templateKey).not.toBe(before.draft.slots[0].templateKey);
    } else resolved.preferences.excludedIngredients = [];
    await repository.saveMealPlan(resolved, 'guest', 3);
    const saved = await repository.confirmMealPlan(plan.weekStart, 'guest', 4);
    expect(saved).toMatchObject({ revision: 5, draft: null, archives: [original.confirmed] });
    if (resolution === 'replacement') {
      expect(saved.confirmed.preferences.excludedIngredients).toEqual(['계란']);
      expect(saved.confirmed.slots[0].locked).toBe(false);
    } else expect(saved.confirmed.slots[0].components[0].ingredients[0].rawName).toBe('달걀');
  });

  it.each(['skipped', 'cooked'])('allows changed exclusions while preserving a historical %s meal', async status => {
    const repository = await import('../mealPlanRepository.js');
    const { generateMealPlan, setMealPlanSlotSkipped } = await import('../mealPlanDomain.js');
    const { recordMealCooking } = await import('../mealCookingRepository.js');
    const plan = generateMealPlan({ scope: 'guest', weekStart: '2026-09-14', now: NOW,
      preferences: { servings: 1, dinnerDays: [0], excludedIngredients: [] } });
    plan.slots[0].components[0].ingredients[0].rawName = '달걀';
    plan.slots[0].components[0].ingredients[0].normalizedName = '계란';
    await repository.saveMealPlan(plan, 'guest', 0);
    await repository.confirmMealPlan(plan.weekStart, 'guest', 1);
    if (status === 'cooked') await recordMealCooking({ scope: 'guest', weekStart: plan.weekStart,
      slotId: '2026-09-14:dinner', operationId: 'past-cooked', expectedPlanRevision: 2,
      usageMode: 'unknown', completeUsageConfirmed: false, usages: [] });
    const original = await repository.getMealPlan(plan.weekStart);
    const draft = status === 'skipped' ? setMealPlanSlotSkipped(original.confirmed, '2026-09-14:dinner', true)
      : structuredClone(original.confirmed);
    draft.preferences.excludedIngredients = ['계란'];
    const snapshot = structuredClone(draft.slots[0]);
    await repository.saveMealPlan(draft, 'guest', original.revision);
    const confirmed = await repository.confirmMealPlan(plan.weekStart, 'guest', original.revision + 1);
    expect(confirmed.confirmed.slots[0]).toEqual(snapshot);
    expect(confirmed.confirmed.slots[0].status).toBe(status);
  });
});
