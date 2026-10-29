import { compactIngredientTombstone } from '../utils/syncStrategy';
import { getInventorySourceToken, invalidateInventoryQuantityReview } from '../features/mealPlans/inventoryQuantityDomain';

const DB_NAME_PREFIX = 'fridgemate-db';
// Version 2 existed with menu decisions on main and meal plans on the feature branch.
const DB_VERSION = 7;
const INGREDIENT_STORE_NAME = 'ingredients';
const MENU_DECISION_STORE_NAME = 'menuDecisions';
const MEAL_PLAN_STORE_NAME = 'mealPlans';
const INVENTORY_QUANTITY_STORE_NAME = 'inventoryQuantities';
const SHOPPING_STORE_NAME = 'shoppingEntries';
const INVENTORY_EVENT_STORE_NAME = 'inventoryEvents';
const MEAL_PLAN_PILOT_STORE_NAME = 'mealPlanPilot';
const DEFAULT_SCOPE = 'guest';
const databasePromises = new Map();

function resolveScope(scopeOrOptions) {
  if (typeof scopeOrOptions === 'string') {
    return scopeOrOptions.trim() || DEFAULT_SCOPE;
  }

  if (scopeOrOptions && typeof scopeOrOptions === 'object' && typeof scopeOrOptions.scope === 'string') {
    return scopeOrOptions.scope.trim() || DEFAULT_SCOPE;
  }

  return DEFAULT_SCOPE;
}

function getDatabaseName(scopeOrOptions) {
  const scope = resolveScope(scopeOrOptions);
  const safeScope = scope.replace(/[^a-zA-Z0-9_-]/g, '_');
  return `${DB_NAME_PREFIX}__${safeScope}`;
}

function openDatabase(scopeOrOptions) {
  const databaseName = getDatabaseName(scopeOrOptions);

  if (!databasePromises.has(databaseName)) {
    let abandoned = false;
    const databasePromise = new Promise((resolve, reject) => {
      const request = window.indexedDB.open(databaseName, DB_VERSION);

      request.onupgradeneeded = () => {
        if (abandoned) {
          request.transaction.abort();
          return;
        }

        const database = request.result;

        if (!database.objectStoreNames.contains(INGREDIENT_STORE_NAME)) {
          const store = database.createObjectStore(INGREDIENT_STORE_NAME, { keyPath: 'id' });
          store.createIndex('expiryDate', 'expiryDate', { unique: false });
          store.createIndex('category', 'category', { unique: false });
          store.createIndex('storageType', 'storageType', { unique: false });
        }

        if (!database.objectStoreNames.contains(MENU_DECISION_STORE_NAME)) {
          database.createObjectStore(MENU_DECISION_STORE_NAME, { keyPath: 'decisionDate' });
        }

        if (!database.objectStoreNames.contains(MEAL_PLAN_STORE_NAME)) {
          database.createObjectStore(MEAL_PLAN_STORE_NAME, { keyPath: 'id' });
        }
        if (!database.objectStoreNames.contains(INVENTORY_QUANTITY_STORE_NAME)) {
          database.createObjectStore(INVENTORY_QUANTITY_STORE_NAME, { keyPath: 'id' });
        }
        if (!database.objectStoreNames.contains(SHOPPING_STORE_NAME)) {
          database.createObjectStore(SHOPPING_STORE_NAME, { keyPath: 'id' });
        }
        if (!database.objectStoreNames.contains(INVENTORY_EVENT_STORE_NAME)) {
          const store = database.createObjectStore(INVENTORY_EVENT_STORE_NAME, { keyPath: 'id' });
          store.createIndex('purchaseNoteId', 'purchaseNoteId', { unique: true });
        }
        if (!database.objectStoreNames.contains(MEAL_PLAN_PILOT_STORE_NAME)) {
          database.createObjectStore(MEAL_PLAN_PILOT_STORE_NAME, { keyPath: 'id' });
        }
      };

      request.onsuccess = () => {
        const database = request.result;

        if (abandoned) {
          database.close();
          return;
        }

        const releaseConnection = () => {
          database.close();
          if (databasePromises.get(databaseName) === databasePromise) {
            databasePromises.delete(databaseName);
          }
        };
        database.onversionchange = releaseConnection;
        database.onclose = releaseConnection;
        resolve(database);
      };
      request.onblocked = () => {
        abandoned = true;
        reject(new Error('다른 탭에서 이전 저장소를 사용 중입니다. 오늘뭐먹지 탭을 닫은 뒤 다시 시도해주세요.'));
      };
      request.onerror = () => reject(request.error);
    });

    databasePromises.set(databaseName, databasePromise);
    databasePromise.catch(() => {
      if (databasePromises.get(databaseName) === databasePromise) {
        databasePromises.delete(databaseName);
      }
    });
  }

  return databasePromises.get(databaseName);
}

function runStoreTransaction(storeName, mode, handler, scopeOrOptions) {
  return openDatabase(scopeOrOptions).then((database) => {
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(storeName, mode);
      let request;

      try {
        request = handler(transaction.objectStore(storeName), transaction);
      } catch (error) {
        transaction.abort();
        reject(error);
      }

      transaction.oncomplete = () => resolve(request?.result);
      transaction.onerror = () => reject(transaction.error || new Error('로컬 저장에 실패했습니다. 다시 시도해주세요.'));
      transaction.onabort = () => reject(transaction.error || new Error('로컬 저장이 취소됐습니다. 다시 시도해주세요.'));
    });
  });
}

function runTransaction(mode, handler, scopeOrOptions, storeName = INGREDIENT_STORE_NAME) {
  return runStoreTransaction(storeName, mode, handler, scopeOrOptions);
}

export function runMealPlanTransaction(mode, handler, scopeOrOptions) {
  return runStoreTransaction(MEAL_PLAN_STORE_NAME, mode, handler, scopeOrOptions);
}

export function runShoppingTransaction(mode, handler, scopeOrOptions) {
  return runStoreTransaction(SHOPPING_STORE_NAME, mode, handler, scopeOrOptions);
}

// Pilot observation writes are separate from meal, inventory and receipt work.
// A pilot storage failure must never roll back a successful user action.
export function runMealPlanPilotTransaction(mode, handler, scopeOrOptions) {
  return runStoreTransaction(MEAL_PLAN_PILOT_STORE_NAME, mode, handler, scopeOrOptions);
}

function runLinkedStoreTransaction(storeNames, mode, handler, scopeOrOptions, errorMessages) {
  return openDatabase(scopeOrOptions).then((database) => new Promise((resolve, reject) => {
    const transaction = database.transaction(Object.values(storeNames), mode);
    let output;
    transaction.oncomplete = () => resolve(output?.result);
    transaction.onerror = () => reject(transaction.error || new Error(errorMessages.failed));
    transaction.onabort = () => reject(transaction.error || new Error(errorMessages.aborted));
    try {
      const stores = Object.fromEntries(Object.entries(storeNames)
        .map(([alias, name]) => [alias, transaction.objectStore(name)]));
      output = handler(stores, transaction);
    } catch (error) {
      transaction.abort();
      reject(error);
    }
  }));
}

export function runInventoryReceiptTransaction(mode, handler, scopeOrOptions) {
  return runLinkedStoreTransaction({
    ingredients: INGREDIENT_STORE_NAME, quantities: INVENTORY_QUANTITY_STORE_NAME,
    shopping: SHOPPING_STORE_NAME, events: INVENTORY_EVENT_STORE_NAME
  }, mode, handler, scopeOrOptions, {
    failed: '구매 반영 저장에 실패했습니다.', aborted: '구매 반영 저장이 취소됐습니다.'
  });
}

export function runMealCookingTransaction(mode, handler, scopeOrOptions) {
  return runLinkedStoreTransaction({
    ingredients: INGREDIENT_STORE_NAME, quantities: INVENTORY_QUANTITY_STORE_NAME,
    mealPlans: MEAL_PLAN_STORE_NAME, events: INVENTORY_EVENT_STORE_NAME
  }, mode, handler, scopeOrOptions, {
    failed: '조리 기록 저장에 실패했습니다.', aborted: '조리 기록 저장이 취소됐습니다.'
  });
}

export function runInventoryQuantityTransaction(mode, handler, scopeOrOptions) {
  return runLinkedStoreTransaction({
    ingredients: INGREDIENT_STORE_NAME, quantities: INVENTORY_QUANTITY_STORE_NAME
  }, mode, handler, scopeOrOptions, {
    failed: '재고량 저장에 실패했습니다.', aborted: '재고량 저장이 취소됐습니다.'
  });
}

export function readMealPlanningSnapshot(scopeOrOptions) {
  return openDatabase(scopeOrOptions).then((database) => new Promise((resolve, reject) => {
    // Raw stock, quantity reviews and plans share one committed local state.
    const transaction = database.transaction([INGREDIENT_STORE_NAME, MEAL_PLAN_STORE_NAME, INVENTORY_QUANTITY_STORE_NAME], 'readonly');
    let ingredientsRequest;
    let mealPlansRequest;
    let quantityReviewsRequest;
    transaction.onerror = () => reject(transaction.error || new Error('식단과 재고를 불러오지 못했습니다. 다시 시도해주세요.'));
    transaction.onabort = () => reject(transaction.error || new Error('식단과 재고 읽기가 취소됐습니다. 다시 시도해주세요.'));
    transaction.oncomplete = () => resolve({
      ingredients: ingredientsRequest.result.filter((ingredient) => !ingredient.deletedAt),
      mealPlans: mealPlansRequest.result,
      quantityReviews: quantityReviewsRequest.result
    });
    try {
      ingredientsRequest = transaction.objectStore(INGREDIENT_STORE_NAME).getAll();
      mealPlansRequest = transaction.objectStore(MEAL_PLAN_STORE_NAME).getAll();
      quantityReviewsRequest = transaction.objectStore(INVENTORY_QUANTITY_STORE_NAME).getAll();
    } catch (error) {
      transaction.abort();
      reject(error);
    }
  }));
}

export function clearMealPlans(scopeOrOptions) {
  return runMealPlanTransaction('readwrite', (store) => store.clear(), scopeOrOptions);
}

// Account deletion clears private stores together; ordinary ingredient replacement must not erase plans.
export function clearAccountLocalData(scopeOrOptions) {
  return openDatabase(scopeOrOptions).then((database) => new Promise((resolve, reject) => {
    const transaction = database.transaction(
      [INGREDIENT_STORE_NAME, MENU_DECISION_STORE_NAME, MEAL_PLAN_STORE_NAME, INVENTORY_QUANTITY_STORE_NAME, SHOPPING_STORE_NAME, INVENTORY_EVENT_STORE_NAME, MEAL_PLAN_PILOT_STORE_NAME],
      'readwrite'
    );
    transaction.objectStore(INGREDIENT_STORE_NAME).clear();
    transaction.objectStore(MENU_DECISION_STORE_NAME).clear();
    transaction.objectStore(MEAL_PLAN_STORE_NAME).clear();
    transaction.objectStore(INVENTORY_QUANTITY_STORE_NAME).clear();
    transaction.objectStore(SHOPPING_STORE_NAME).clear();
    transaction.objectStore(INVENTORY_EVENT_STORE_NAME).clear();
    transaction.objectStore(MEAL_PLAN_PILOT_STORE_NAME).clear();
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error || new Error('로컬 데이터 삭제가 취소됐습니다.'));
  }));
}

export function getAllIngredients(scopeOrOptions) {
  return runTransaction('readonly', (store) => store.getAll(), scopeOrOptions).then((ingredients = []) =>
    ingredients.filter((ingredient) => !ingredient.deletedAt)
  );
}

function migrateIngredientForSync(ingredient) {
  const id = ingredient.id || ingredient.clientId;
  const migratedAt = ingredient.updatedAt || ingredient.deletedAt || ingredient.createdAt || new Date().toISOString();
  const migratedIngredient = {
    ...ingredient,
    id,
    clientId: ingredient.clientId || id,
    createdAt: ingredient.createdAt || migratedAt,
    updatedAt: migratedAt,
    deletedAt: ingredient.deletedAt || null,
    syncState: ingredient.syncState || (ingredient.deletedAt ? 'pendingDelete' : 'pendingCreate'),
    lastSyncedAt: ingredient.lastSyncedAt || null
  };

  return migratedIngredient.deletedAt
    ? compactIngredientTombstone(migratedIngredient)
    : migratedIngredient;
}

function prepareIngredientForStorage(ingredient) {
  return ingredient?.deletedAt ? compactIngredientTombstone(ingredient) : ingredient;
}

export class IngredientTombstoneConflictError extends Error {
  constructor() {
    super('A deleted ingredient cannot be restored without an explicit restore operation.');
    this.name = 'IngredientTombstoneConflictError';
  }
}

function getIngredientIdentityKeys(ingredient) {
  return [ingredient?.id, ingredient?.clientId].filter(Boolean);
}

function writeIngredientsWithoutResurrection(
  ingredients,
  scopeOrOptions,
  { replace = false, result = null } = {}
) {
  const preparedIngredients = ingredients.map(prepareIngredientForStorage);

  return openDatabase(scopeOrOptions).then((database) =>
    new Promise((resolve, reject) => {
      const transaction = database.transaction([INGREDIENT_STORE_NAME, INVENTORY_QUANTITY_STORE_NAME], 'readwrite');
      const store = transaction.objectStore(INGREDIENT_STORE_NAME);
      const quantities = transaction.objectStore(INVENTORY_QUANTITY_STORE_NAME);
      const readRequest = store.getAll();
      const reviewRequest = quantities.getAll();
      let conflictError = null;

      reviewRequest.onsuccess = () => {
        try {
          const existingIngredients = readRequest.result;
          const deletedKeys = new Set(
            [...existingIngredients, ...preparedIngredients]
              .filter((ingredient) => ingredient.deletedAt)
              .flatMap(getIngredientIdentityKeys)
          );
          const wouldRestoreDeletedIngredient = preparedIngredients.some(
            (ingredient) =>
              !ingredient.deletedAt
              && getIngredientIdentityKeys(ingredient).some((key) => deletedKeys.has(key))
          );
          if (wouldRestoreDeletedIngredient) throw new IngredientTombstoneConflictError();

          const incomingKeys = new Set(preparedIngredients.flatMap(getIngredientIdentityKeys));
          const retainedTombstones = replace
            ? existingIngredients.filter((ingredient) => ingredient.deletedAt
              && !getIngredientIdentityKeys(ingredient).some((key) => incomingKeys.has(key)))
            : [];
          const incoming = [...preparedIngredients, ...retainedTombstones].map(prepareIngredientForStorage);
          const previous = new Map(existingIngredients.map((ingredient) => [ingredient.id, ingredient]));
          const next = replace ? new Map() : new Map(previous);
          const reviews = new Map(reviewRequest.result.map((review) => [review.id, review]));
          incoming.forEach((ingredient) => next.set(ingredient.id, ingredient));
          for (const id of new Set([...previous.keys(), ...next.keys()])) {
            const before = previous.get(id);
            const after = next.get(id);
            if (!before || !after || getInventorySourceToken(before) !== getInventorySourceToken(after)) {
              quantities.put(invalidateInventoryQuantityReview(reviews.get(id), resolveScope(scopeOrOptions), id));
            }
          }
          if (replace) store.clear();
          incoming.forEach((ingredient) => store.put(ingredient));
        } catch (error) {
          conflictError = error;
          transaction.abort();
        }
      };

      transaction.oncomplete = () => resolve(result);
      transaction.onerror = () => reject(conflictError || transaction.error);
      transaction.onabort = () => reject(conflictError || transaction.error);
    })
  );
}

export async function getAllIngredientsForSync(scopeOrOptions) {
  const ingredients = await runTransaction('readonly', (store) => store.getAll(), scopeOrOptions);
  const migratedIngredients = ingredients.map(migrateIngredientForSync);
  const needsMigration = migratedIngredients.some(
    (ingredient, index) => JSON.stringify(ingredient) !== JSON.stringify(ingredients[index])
  );

  if (needsMigration) await saveIngredients(migratedIngredients, scopeOrOptions);
  return migratedIngredients;
}

export async function getIngredientById(id, scopeOrOptions) {
  const ingredient = await runTransaction('readonly', (store) => store.get(id), scopeOrOptions);
  const preparedIngredient = prepareIngredientForStorage(ingredient);

  if (ingredient && JSON.stringify(preparedIngredient) !== JSON.stringify(ingredient)) {
    await saveIngredient(preparedIngredient, scopeOrOptions);
  }
  return preparedIngredient?.deletedAt ? undefined : preparedIngredient;
}

export function saveIngredient(ingredient, scopeOrOptions) {
  const preparedIngredient = prepareIngredientForStorage(ingredient);
  return writeIngredientsWithoutResurrection([preparedIngredient], scopeOrOptions, {
    result: preparedIngredient.id
  });
}

export function saveIngredients(ingredients, scopeOrOptions) {
  return writeIngredientsWithoutResurrection(ingredients, scopeOrOptions);
}

export function clearIngredients(scopeOrOptions) {
  return removeIngredientsWithInvalidation(scopeOrOptions, undefined, true);
}

export function replaceIngredients(ingredients = [], scopeOrOptions) {
  return writeIngredientsWithoutResurrection(ingredients, scopeOrOptions, { replace: true });
}

export function deleteIngredient(id, scopeOrOptions) {
  return removeIngredientsWithInvalidation(scopeOrOptions, id);
}

async function removeIngredientsWithInvalidation(scopeOrOptions, id, clear = false) {
  let validationError;
  try {
    await runInventoryQuantityTransaction('readwrite', ({ ingredients, quantities }, transaction) => {
      const ingredientRequest = ingredients.getAll();
      const reviewRequest = quantities.getAll();
      reviewRequest.onsuccess = () => {
        try {
          const reviews = new Map(reviewRequest.result.map((review) => [review.id, review]));
          const ids = clear
            ? new Set([...ingredientRequest.result.map((ingredient) => ingredient.id), ...reviews.keys()])
            : new Set([id]);
          for (const targetId of ids) {
            quantities.put(invalidateInventoryQuantityReview(reviews.get(targetId), resolveScope(scopeOrOptions), targetId));
          }
          if (clear) ingredients.clear();
          else ingredients.delete(id);
        } catch (error) {
          validationError = error;
          transaction.abort();
        }
      };
      return reviewRequest;
    }, scopeOrOptions);
  } catch (error) {
    throw validationError || error;
  }
}

export function getMenuDecision(decisionDate, scopeOrOptions) {
  return runTransaction(
    'readonly',
    (store) => store.get(decisionDate),
    scopeOrOptions,
    MENU_DECISION_STORE_NAME
  );
}

export function saveMenuDecision(decision, scopeOrOptions) {
  return runTransaction(
    'readwrite',
    (store) => store.put(decision),
    scopeOrOptions,
    MENU_DECISION_STORE_NAME
  );
}

export function deleteMenuDecision(decisionDate, scopeOrOptions) {
  return runTransaction(
    'readwrite',
    (store) => store.delete(decisionDate),
    scopeOrOptions,
    MENU_DECISION_STORE_NAME
  );
}

export function clearMenuDecisions(scopeOrOptions) {
  return runTransaction(
    'readwrite',
    (store) => store.clear(),
    scopeOrOptions,
    MENU_DECISION_STORE_NAME
  );
}

export async function deleteDatabase(scopeOrOptions) {
  const databaseName = getDatabaseName(scopeOrOptions);
  const cachedDatabasePromise = databasePromises.get(databaseName);

  if (cachedDatabasePromise) {
    try {
      const database = await cachedDatabasePromise;
      database.close();
    } catch {
      // A failed open does not prevent a best-effort database deletion.
    } finally {
      if (databasePromises.get(databaseName) === cachedDatabasePromise) {
        databasePromises.delete(databaseName);
      }
    }
  } else {
    databasePromises.delete(databaseName);
  }

  return new Promise((resolve, reject) => {
    const request = window.indexedDB.deleteDatabase(databaseName);
    let settled = false;

    request.onsuccess = () => {
      if (!settled) {
        settled = true;
        resolve();
      }
    };

    request.onerror = () => {
      if (!settled) {
        settled = true;
        reject(request.error || new Error(`Failed to delete IndexedDB database: ${databaseName}`));
      }
    };

    request.onblocked = () => {
      if (!settled) {
        settled = true;
        reject(new Error(`IndexedDB database deletion was blocked: ${databaseName}`));
      }
    };
  });
}
