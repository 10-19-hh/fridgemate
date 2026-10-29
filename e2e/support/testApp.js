export const DEFAULT_USER = {
  id: 'user-1',
  email: 'user@example.com'
};

function scrubIngredientTombstone(ingredient) {
  if (!ingredient.deletedAt) return ingredient;
  return {
    id: ingredient.id,
    clientId: ingredient.clientId || ingredient.id,
    updatedAt: ingredient.updatedAt || ingredient.deletedAt,
    deletedAt: ingredient.deletedAt
  };
}

export function createMockApiBackend({ ingredients = [] } = {}) {
  return {
    ingredients: [...ingredients],
    syncFailureStatus: null,
    menuDecision: null,
    menuDecisionFailureStatus: null
  };
}

export function createIngredient(id, overrides = {}) {
  return {
    id,
    name: `ingredient-${id}`,
    category: '채소',
    storageType: '냉장',
    quantity: '1개',
    purchaseDate: '2026-04-14',
    expiryDate: '2026-04-20',
    memo: '',
    consumed: false,
    updatedAt: '2026-04-14T09:00:00.000Z',
    ...overrides
  };
}

export async function seedBrowserState(
  page,
  { session = null, scope = 'guest', ingredients = [], ocrResult = null, analyticsConsent = 'denied' } = {}
) {
  await page.addInitScript(
    ({ nextSession, nextScope, nextIngredients, nextOcrResult, nextAnalyticsConsent }) => {
      const seedKey = '__fridgemate-e2e-seeded__';

      function getDatabaseName(scopeName) {
        const safeScope = String(scopeName || 'guest').replace(/[^a-zA-Z0-9_-]/g, '_');
        return `fridgemate-db__${safeScope}`;
      }

      function deleteDatabase(name) {
        return new Promise((resolve, reject) => {
          const request = window.indexedDB.deleteDatabase(name);
          request.onsuccess = () => resolve();
          request.onerror = () => reject(request.error);
          request.onblocked = () => reject(new DOMException('', 'BlockedError'));
        });
      }

      function openDatabase(name) {
        return new Promise((resolve, reject) => {
          const request = window.indexedDB.open(name);

          request.onupgradeneeded = () => {
            const database = request.result;

            if (!database.objectStoreNames.contains('ingredients')) {
              const store = database.createObjectStore('ingredients', { keyPath: 'id' });
              store.createIndex('expiryDate', 'expiryDate', { unique: false });
              store.createIndex('category', 'category', { unique: false });
              store.createIndex('storageType', 'storageType', { unique: false });
            }

            if (!database.objectStoreNames.contains('menuDecisions')) {
              database.createObjectStore('menuDecisions', { keyPath: 'decisionDate' });
            }
          };

          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
      }

      async function seedIngredients(scopeName, items) {
        if (!items.length) {
          return;
        }

        const database = await openDatabase(getDatabaseName(scopeName));

        try {
          await new Promise((resolve, reject) => {
            const transaction = database.transaction('ingredients', 'readwrite');
            const store = transaction.objectStore('ingredients');
            transaction.oncomplete = () => resolve();
            transaction.onerror = () => reject(transaction.error);
            transaction.onabort = () => reject(transaction.error);
            try {
              items.forEach((ingredient) => store.put(ingredient));
            } catch (error) {
              transaction.abort();
              reject(error);
            }
          });
        } finally {
          database.close();
        }
      }

      window.__FRIDGEMATE_TEST__ = window.__FRIDGEMATE_TEST__ || {};
      window.__FRIDGEMATE_TEST__.setupComplete = false;
      window.__FRIDGEMATE_TEST__.setupError = null;

      if (nextOcrResult) {
        window.__FRIDGEMATE_TEST__.extractTextFromImage = async (_file, options = {}) => {
          if (typeof options.onProgress === 'function') {
            options.onProgress(1);
          }

          return nextOcrResult;
        };
      }

      async function seed() {
        if (window.sessionStorage.getItem(seedKey) === 'done') {
          window.__FRIDGEMATE_TEST__.setupComplete = true;
          return;
        }

        window.localStorage.clear();
        if (nextAnalyticsConsent) {
          window.localStorage.setItem('fridgemate-analytics-consent', nextAnalyticsConsent);
        }

        if (nextSession) {
          window.localStorage.setItem('fridgemate-auth-session', JSON.stringify(nextSession));
        }

        await Promise.all([deleteDatabase(getDatabaseName('guest')), deleteDatabase(getDatabaseName('user:user-1'))]);
        await seedIngredients(nextScope, nextIngredients);
        window.sessionStorage.setItem(seedKey, 'done');
        window.__FRIDGEMATE_TEST__.setupComplete = true;
      }

      seed().catch(error => {
        window.__FRIDGEMATE_TEST__.setupError = error?.name || 'Error';
      });
    },
    {
      nextSession: session,
      nextScope: scope,
      nextIngredients: ingredients,
      nextOcrResult: ocrResult,
      nextAnalyticsConsent: analyticsConsent
    }
  );

  // Prepare storage on an inert same-origin document before a fast production
  // bundle can read it. Waiting after app navigation is too late for its cache.
  const seedDocument = '**/__fridgemate-e2e-seed__';
  await page.route(seedDocument, route => route.fulfill({
    status: 200, contentType: 'text/html', body: '<!doctype html><html><body></body></html>'
  }));
  try {
    await page.goto('/__fridgemate-e2e-seed__');
    await page.waitForFunction(() => window.__FRIDGEMATE_TEST__?.setupComplete === true
      || Boolean(window.__FRIDGEMATE_TEST__?.setupError));
    const setupError = await page.evaluate(() => window.__FRIDGEMATE_TEST__.setupError);
    if (setupError) throw new Error(`Browser fixture setup failed: ${setupError}`);
  } finally {
    await page.unroute(seedDocument);
  }
}

export async function gotoAndWait(page, path = '/') {
  await page.goto(path);
  await page.waitForFunction(() => window.__FRIDGEMATE_TEST__?.setupComplete !== false);
}

export async function waitForIngredientNames(page, scope, expectedNames) {
  await page.waitForFunction(
    async ({ scopeName, names }) => {
      function getDatabaseName(value) {
        const safeScope = String(value || 'guest').replace(/[^a-zA-Z0-9_-]/g, '_');
        return `fridgemate-db__${safeScope}`;
      }

      function openDatabase(name) {
        return new Promise((resolve, reject) => {
          const request = window.indexedDB.open(name);
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
      }

      const database = await openDatabase(getDatabaseName(scopeName));
      const ingredients = await new Promise((resolve, reject) => {
        const transaction = database.transaction('ingredients', 'readonly');
        const request = transaction.objectStore('ingredients').getAll();
        request.onsuccess = () => resolve(request.result || []);
        request.onerror = () => reject(request.error);
      });
      database.close();

      const currentNames = ingredients
        .filter((ingredient) => !ingredient.deletedAt)
        .map((ingredient) => ingredient.name)
        .sort();
      return JSON.stringify(currentNames) === JSON.stringify([...names].sort());
    },
    { scopeName: scope, names: expectedNames }
  );
}

export async function readBrowserIngredients(page, scope) {
  return page.evaluate(async (scopeName) => {
    const safeScope = String(scopeName || 'guest').replace(/[^a-zA-Z0-9_-]/g, '_');
    const request = window.indexedDB.open(`fridgemate-db__${safeScope}`);
    const database = await new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const ingredients = await new Promise((resolve, reject) => {
      const transaction = database.transaction('ingredients', 'readonly');
      const getAllRequest = transaction.objectStore('ingredients').getAll();
      getAllRequest.onsuccess = () => resolve(getAllRequest.result || []);
      getAllRequest.onerror = () => reject(getAllRequest.error);
    });
    database.close();
    return ingredients;
  }, scope);
}

export async function writeBrowserIngredients(page, scope, ingredients) {
  await page.evaluate(
    async ({ scopeName, items }) => {
      const safeScope = String(scopeName || 'guest').replace(/[^a-zA-Z0-9_-]/g, '_');
      const request = window.indexedDB.open(`fridgemate-db__${safeScope}`);
      const database = await new Promise((resolve, reject) => {
        request.onupgradeneeded = () => {
          if (!request.result.objectStoreNames.contains('ingredients')) {
            request.result.createObjectStore('ingredients', { keyPath: 'id' });
          }
          if (!request.result.objectStoreNames.contains('menuDecisions')) {
            request.result.createObjectStore('menuDecisions', { keyPath: 'decisionDate' });
          }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      await new Promise((resolve, reject) => {
        const transaction = database.transaction('ingredients', 'readwrite');
        const store = transaction.objectStore('ingredients');
        store.clear();
        items.forEach((ingredient) => store.put(ingredient));
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
      });
      database.close();
    },
    { scopeName: scope, items: ingredients }
  );
}

export async function mockApiSession(
  page,
  { user = DEFAULT_USER, ingredients = [], restoreSession = false, backend = null } = {}
) {
  const ingredientBackend = backend || createMockApiBackend({ ingredients });
  const state = {
    sessionActive: restoreSession,
    user
  };
  const exposedState = {
    get ingredients() {
      return ingredientBackend.ingredients;
    },
    get sessionActive() {
      return state.sessionActive;
    },
    backend: ingredientBackend
  };

  const jsonResponse = (route, body, status = 200) =>
    route.fulfill({
      status,
      contentType: 'application/json',
      body: JSON.stringify(body)
    });

  await page.route('**/api/auth/me', (route) =>
    state.sessionActive ? jsonResponse(route, state.user) : jsonResponse(route, { message: 'Authentication is required.' }, 401)
  );
  await page.route('**/api/auth/refresh', (route) =>
    state.sessionActive
      ? jsonResponse(route, { user: state.user })
      : jsonResponse(route, { message: 'The current session is no longer valid.' }, 401)
  );
  await page.route('**/api/auth/logout', (route) => {
    state.sessionActive = false;
    return route.fulfill({ status: 204, body: '' });
  });
  await page.route('**/api/auth/login', async (route) => {
    const credentials = JSON.parse(route.request().postData() || '{}');
    state.sessionActive = true;
    state.user = {
      ...state.user,
      email: credentials.email || state.user.email
    };
    await jsonResponse(route, {
      token: 'test-token',
      user: state.user
    });
  });

  await page.route('**/api/ingredients/bulk', async (route) => {
    const payload = JSON.parse(route.request().postData() || '{}');
    const items = Array.isArray(payload.items) ? payload.items : [];
    const savedItems = items.map((ingredient, index) => ({
      ...ingredient,
      updatedAt: `2026-04-14T09:00:0${index}.000Z`
    }));
    ingredientBackend.ingredients = [...savedItems, ...ingredientBackend.ingredients];
    await jsonResponse(route, savedItems);
  });

  await page.route('**/api/ingredients/sync', async (route) => {
    if (route.request().method() === 'GET') {
      await jsonResponse(route, { items: ingredientBackend.ingredients });
      return;
    }

    if (ingredientBackend.syncFailureStatus) {
      await jsonResponse(route, { message: 'Temporary sync failure.' }, ingredientBackend.syncFailureStatus);
      return;
    }

    const payload = JSON.parse(route.request().postData() || '{}');
    const changes = Array.isArray(payload.changes) ? payload.changes : [];
    const now = Date.now();

    if (changes.some((ingredient) => Date.parse(ingredient.updatedAt) > now + 5 * 60 * 1000)) {
      await jsonResponse(route, { message: 'Ingredient updatedAt is too far in the future.' }, 400);
      return;
    }

    const savedItems = changes.map((ingredient, index) => {
      const { userId: _userId, ...safeIngredient } = ingredient;
      return scrubIngredientTombstone({
        ...safeIngredient,
        updatedAt: ingredient.updatedAt || `2026-04-14T11:00:${String(index).padStart(2, '0')}.000Z`
      });
    });
    let appliedCount = 0;
    savedItems.forEach((ingredient) => {
      const syncKey = ingredient.clientId || ingredient.id;
      const existingIndex = ingredientBackend.ingredients.findIndex((item) => (item.clientId || item.id) === syncKey);

      if (existingIndex === -1) {
        ingredientBackend.ingredients.push(ingredient);
        appliedCount += 1;
      } else if (ingredientBackend.ingredients[existingIndex].deletedAt && !ingredient.deletedAt) {
        return;
      } else if (
        Date.parse(ingredient.updatedAt) > Date.parse(ingredientBackend.ingredients[existingIndex].updatedAt || 0)
      ) {
        ingredientBackend.ingredients[existingIndex] = ingredient;
        appliedCount += 1;
      }
    });
    await jsonResponse(route, {
      items: ingredientBackend.ingredients.map(scrubIngredientTombstone),
      appliedCount
    });
  });

  await page.route('**/api/ingredients', async (route) => {
    if (route.request().method() === 'GET') {
      await jsonResponse(route, ingredientBackend.ingredients.filter((ingredient) => !ingredient.deletedAt));
      return;
    }

    await route.fallback();
  });

  await page.route('**/api/ingredients/*', async (route) => {
    const request = route.request();
    const id = request.url().split('/').pop();

    if (id === 'sync') {
      await route.fallback();
      return;
    }

    if (request.method() === 'PATCH') {
      const existingIngredient = ingredientBackend.ingredients.find((ingredient) => ingredient.id === id);

      if (!existingIngredient) {
        await jsonResponse(route, { message: 'Ingredient not found.' }, 404);
        return;
      }

      const payload = JSON.parse(request.postData() || '{}');
      const savedIngredient = {
        ...payload,
        id,
        updatedAt: '2026-04-14T10:00:00.000Z'
      };
      ingredientBackend.ingredients = [
        savedIngredient,
        ...ingredientBackend.ingredients.filter((ingredient) => ingredient.id !== id)
      ];
      await jsonResponse(route, savedIngredient);
      return;
    }

    if (request.method() === 'GET') {
      const ingredient = ingredientBackend.ingredients.find((item) => item.id === id && !item.deletedAt);
      await jsonResponse(route, ingredient || { message: 'Not found.' }, ingredient ? 200 : 404);
      return;
    }

    if (request.method() === 'DELETE') {
      const existingIngredient = ingredientBackend.ingredients.find((ingredient) => ingredient.id === id);

      if (!existingIngredient) {
        await jsonResponse(route, { message: 'Ingredient not found.' }, 404);
        return;
      }

      ingredientBackend.ingredients = ingredientBackend.ingredients.filter((ingredient) => ingredient.id !== id);
      await route.fulfill({ status: 204, body: '' });
      return;
    }

    await route.fallback();
  });

  await page.route('**/api/menu-decisions?*', async (route) => {
    await jsonResponse(route, ingredientBackend.menuDecision);
  });

  await page.route('**/api/menu-decisions/*', async (route) => {
    const request = route.request();
    if (ingredientBackend.menuDecisionFailureStatus) {
      await jsonResponse(route, { message: 'Temporary menu decision failure.' }, ingredientBackend.menuDecisionFailureStatus);
      return;
    }

    const payload = JSON.parse(request.postData() || '{}');
    const url = new URL(request.url());
    const pathParts = url.pathname.split('/').filter(Boolean);
    const isComplete = pathParts.at(-1) === 'complete';
    const decisionDate = isComplete ? pathParts.at(-2) : pathParts.at(-1);

    if (request.method() === 'PUT') {
      ingredientBackend.menuDecision = {
        id: 'decision-1',
        ...payload,
        decisionDate,
        status: 'selected',
        completedAt: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        userId: state.user.id
      };
      await jsonResponse(route, ingredientBackend.menuDecision);
      return;
    }

    if (request.method() === 'PATCH' && isComplete && ingredientBackend.menuDecision) {
      ingredientBackend.menuDecision = {
        ...ingredientBackend.menuDecision,
        status: 'completed',
        completedAt: payload.completedAt,
        updatedAt: new Date().toISOString()
      };
      await jsonResponse(route, ingredientBackend.menuDecision);
      return;
    }

    if (request.method() === 'DELETE' && ingredientBackend.menuDecision) {
      ingredientBackend.menuDecision = {
        ...ingredientBackend.menuDecision,
        status: 'cancelled',
        completedAt: null,
        updatedAt: new Date().toISOString()
      };
      await jsonResponse(route, ingredientBackend.menuDecision);
      return;
    }

    await jsonResponse(route, { message: 'Menu decision not found.' }, 404);
  });

  await page.route('**/api/pantry-ownership', async (route) => {
    if (route.request().method() === 'GET') await jsonResponse(route, []);
    else await jsonResponse(route, JSON.parse(route.request().postData() || '{}').items || []);
  });
  await page.route('**/api/user-preferences', async (route) => {
    const defaults = {
      preferredIngredients: [],
      dislikedIngredients: [],
      spiceLevel: 'medium',
      cookingTimePreference: 'flexible'
    };
    await jsonResponse(route, route.request().method() === 'GET'
      ? defaults
      : { ...defaults, ...JSON.parse(route.request().postData() || '{}') });
  });
  await page.route('**/api/recommendation-events', (route) => route.fulfill({ status: 204, body: '' }));
  await page.route('**/api/product-events', (route) => route.fulfill({ status: 204, body: '' }));
  await page.route('**/api/recipes/recommendations', (route) => jsonResponse(route, []));

  return exposedState;
}
