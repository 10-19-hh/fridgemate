import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getRemainingDays } from '../../utils/date.js';

class MockIngredientsApiError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = 'IngredientsApiError';
    this.status = options.status;
    this.path = options.path;
    this.cause = options.cause;
  }
}

const apiMocks = {
  getAllIngredients: vi.fn(),
  getIngredientById: vi.fn(),
  saveIngredient: vi.fn(),
  saveIngredients: vi.fn(),
  pushIngredientsToServer: vi.fn(),
  pullIngredientsFromServer: vi.fn(),
  deleteIngredient: vi.fn()
};

const dbMocks = {
  getAllIngredients: vi.fn(),
  getAllIngredientsForSync: vi.fn(),
  getIngredientById: vi.fn(),
  saveIngredient: vi.fn(),
  saveIngredients: vi.fn(),
  replaceIngredients: vi.fn(),
  deleteIngredient: vi.fn()
};

const backendState = {
  enabled: false,
  preferredDataSource: 'indexeddb'
};

const authState = {
  isAuthenticated: false,
  loading: false,
  storageScope: 'guest'
};

vi.mock('../../api/ingredientsApi.js', () => ({
  IngredientsApiError: MockIngredientsApiError,
  getAllIngredients: (...args) => apiMocks.getAllIngredients(...args),
  getIngredientById: (...args) => apiMocks.getIngredientById(...args),
  saveIngredient: (...args) => apiMocks.saveIngredient(...args),
  saveIngredients: (...args) => apiMocks.saveIngredients(...args),
  pushIngredientsToServer: (...args) => apiMocks.pushIngredientsToServer(...args),
  pullIngredientsFromServer: (...args) => apiMocks.pullIngredientsFromServer(...args),
  deleteIngredient: (...args) => apiMocks.deleteIngredient(...args)
}));

vi.mock('../../db/indexedDB.js', () => ({
  getAllIngredients: (...args) => dbMocks.getAllIngredients(...args),
  getAllIngredientsForSync: (...args) => dbMocks.getAllIngredientsForSync(...args),
  getIngredientById: (...args) => dbMocks.getIngredientById(...args),
  saveIngredient: (...args) => dbMocks.saveIngredient(...args),
  saveIngredients: (...args) => dbMocks.saveIngredients(...args),
  replaceIngredients: (...args) => dbMocks.replaceIngredients(...args),
  deleteIngredient: (...args) => dbMocks.deleteIngredient(...args)
}));

vi.mock('../../utils/backendConfig.js', () => ({
  apiBaseUrl: '',
  isBackendEnabled: () => backendState.enabled,
  getPreferredDataSource: () => backendState.preferredDataSource
}));

vi.mock('../useAuth.js', () => ({
  useAuth: () => authState
}));

function createDeferred() {
  let resolve;
  let reject;

  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
}

function createIngredient(id, overrides = {}) {
  return {
    id,
    clientId: id,
    name: `ingredient-${id}`,
    category: 'vegetable',
    storageType: 'fridge',
    quantity: '1 unit',
    purchaseDate: '2026-03-18',
    expiryDate: '2026-03-25',
    memo: '',
    consumed: false,
    ...overrides
  };
}

function sortByExpiryLikePage(ingredients) {
  return [...ingredients].sort((a, b) => {
    const left = getRemainingDays(a.expiryDate);
    const right = getRemainingDays(b.expiryDate);
    const leftValue = left === null ? Number.MAX_SAFE_INTEGER : left;
    const rightValue = right === null ? Number.MAX_SAFE_INTEGER : right;

    return leftValue - rightValue;
  });
}

function setGuestMode() {
  authState.isAuthenticated = false;
  authState.storageScope = 'guest';
}

function setAuthenticatedMode(userId = 'user-1') {
  authState.isAuthenticated = true;
  authState.storageScope = `user:${userId}`;
}

async function renderUseIngredients() {
  vi.resetModules();
  const { IngredientsProvider, useIngredients } = await import('../useIngredients.js');
  const wrapper = ({ children }) => createElement(IngredientsProvider, null, children);

  return renderHook(() => useIngredients(), { wrapper });
}

function resetMockState() {
  vi.clearAllMocks();
  backendState.enabled = false;
  backendState.preferredDataSource = 'indexeddb';
  setGuestMode();

  apiMocks.getAllIngredients.mockResolvedValue([]);
  apiMocks.getIngredientById.mockResolvedValue(undefined);
  apiMocks.saveIngredient.mockImplementation(async (ingredient) => ingredient);
  apiMocks.saveIngredients.mockImplementation(async (ingredients) => ingredients);
  apiMocks.pushIngredientsToServer.mockImplementation(async (changes) => ({ items: changes, appliedCount: changes.length }));
  apiMocks.pullIngredientsFromServer.mockResolvedValue([]);
  apiMocks.deleteIngredient.mockResolvedValue(undefined);

  dbMocks.getAllIngredients.mockResolvedValue([]);
  dbMocks.getAllIngredientsForSync.mockResolvedValue([]);
  dbMocks.getIngredientById.mockResolvedValue(undefined);
  dbMocks.saveIngredient.mockImplementation(async () => undefined);
  dbMocks.saveIngredients.mockImplementation(async () => undefined);
  dbMocks.replaceIngredients.mockImplementation(async () => undefined);
  dbMocks.deleteIngredient.mockResolvedValue(undefined);
}

describe('useIngredients', () => {
  beforeEach(() => {
    resetMockState();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  describe('basic CRUD flow', () => {
    it('starts with an empty list and loading state before the initial fetch resolves', async () => {
      const deferred = createDeferred();
      dbMocks.getAllIngredients.mockReturnValue(deferred.promise);

      const { result } = await renderUseIngredients();

      expect(result.current.ingredients).toEqual([]);
      expect(result.current.loading).toBe(true);
      expect(result.current.dataSource).toBe('indexeddb');

      deferred.resolve([]);

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.ingredients).toEqual([]);
      expect(dbMocks.getAllIngredients).toHaveBeenCalledWith({ scope: 'guest' });
    });

    it('adds, updates, and removes ingredients through the hook', async () => {
      const { result } = await renderUseIngredients();

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      const ingredient = createIngredient('crud-1', { name: 'green-onion', quantity: '1 bunch' });

      await act(async () => {
        await result.current.addIngredient(ingredient);
      });

      expect(result.current.ingredients).toEqual([ingredient]);
      expect(dbMocks.saveIngredient).toHaveBeenCalledWith(ingredient, { scope: 'guest' });
      expect(apiMocks.saveIngredient).not.toHaveBeenCalled();
      expect(result.current.syncStatus).toBe('dirty');
      expect(result.current.hasUnsyncedChanges).toBe(true);

      const updatedIngredient = { ...ingredient, quantity: '2 bunches', memo: 'updated' };

      await act(async () => {
        await result.current.updateIngredient(updatedIngredient);
      });

      expect(result.current.ingredients[0]).toMatchObject({
        id: 'crud-1',
        quantity: '2 bunches',
        memo: 'updated'
      });
      expect(apiMocks.saveIngredient).not.toHaveBeenCalled();
      expect(result.current.syncStatus).toBe('dirty');

      await act(async () => {
        await result.current.removeIngredient('crud-1');
      });

      expect(result.current.ingredients).toEqual([]);
      expect(dbMocks.deleteIngredient).toHaveBeenCalledWith('crud-1', { scope: 'guest' });
      expect(apiMocks.deleteIngredient).not.toHaveBeenCalled();
      expect(result.current.syncStatus).toBe('dirty');
    });
  });

  describe('authenticated local-first updates', () => {
    it('restores persisted pending state after the provider starts again', async () => {
      backendState.enabled = true;
      setAuthenticatedMode();
      const pendingIngredient = createIngredient('pending-restart', {
        updatedAt: '2026-08-26T10:00:00.000Z',
        syncState: 'pendingUpdate'
      });
      dbMocks.getAllIngredients.mockResolvedValue([pendingIngredient]);
      dbMocks.getAllIngredientsForSync.mockResolvedValue([pendingIngredient]);

      const { result } = await renderUseIngredients();
      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(result.current.ingredients).toEqual([pendingIngredient]);
      expect(result.current.syncStatus).toBe('dirty');
      expect(result.current.hasUnsyncedChanges).toBe(true);
    });

    it('stores authenticated adds locally without calling the API', async () => {
      backendState.enabled = true;
      backendState.preferredDataSource = 'api';
      setAuthenticatedMode();

      const { result } = await renderUseIngredients();

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      const ingredient = createIngredient('optimistic-1', { name: 'tofu' });

      await act(async () => {
        await result.current.addIngredient(ingredient);
      });

      expect(result.current.ingredients[0]).toMatchObject({
        id: 'optimistic-1',
        name: 'tofu',
        syncState: 'pendingCreate'
      });
      expect(dbMocks.saveIngredient).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'optimistic-1', clientId: 'optimistic-1', syncState: 'pendingCreate' }),
        { scope: 'user:user-1' }
      );
      expect(apiMocks.saveIngredient).not.toHaveBeenCalled();
      expect(result.current.syncStatus).toBe('dirty');
      expect(result.current.hasUnsyncedChanges).toBe(true);
    });

    it('rolls back an add only when the local write fails', async () => {
      backendState.enabled = true;
      backendState.preferredDataSource = 'api';
      setAuthenticatedMode();
      dbMocks.saveIngredient.mockRejectedValue(new Error('IndexedDB write failed.'));

      const { result } = await renderUseIngredients();

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      const ingredient = createIngredient('rollback-1', { name: 'bad-item' });
      let caughtError;
      let addPromise;

      act(() => {
        addPromise = result.current.addIngredient(ingredient);
      });

      expect(result.current.ingredients.map((item) => item.id)).toContain('rollback-1');

      await act(async () => {
        try {
          await addPromise;
        } catch (error) {
          caughtError = error;
        }
      });

      expect(caughtError.message).toBe('IndexedDB write failed.');
      expect(result.current.ingredients.map((item) => item.id)).not.toContain('rollback-1');
      expect(apiMocks.saveIngredient).not.toHaveBeenCalled();
    });

    it('stores an authenticated deletion as a pending tombstone', async () => {
      backendState.enabled = true;
      setAuthenticatedMode();
      const ingredient = createIngredient('delete-local', {
        updatedAt: '2026-08-26T09:00:00.000Z',
        syncState: 'clean'
      });
      dbMocks.getAllIngredients.mockResolvedValue([ingredient]);
      dbMocks.getAllIngredientsForSync.mockResolvedValue([ingredient]);
      const { result } = await renderUseIngredients();
      await waitFor(() => expect(result.current.loading).toBe(false));

      await act(async () => {
        await result.current.removeIngredient('delete-local');
      });

      expect(result.current.ingredients).toEqual([]);
      expect(dbMocks.deleteIngredient).not.toHaveBeenCalled();
      const [savedTombstone, saveOptions] = dbMocks.saveIngredient.mock.calls.find(
        ([savedIngredient]) => savedIngredient.id === 'delete-local'
      );
      expect(savedTombstone).toEqual({
        id: 'delete-local',
        clientId: 'delete-local',
        updatedAt: expect.any(String),
        deletedAt: expect.any(String),
        syncState: 'pendingDelete'
      });
      expect(savedTombstone.updatedAt).toBe(savedTombstone.deletedAt);
      expect(saveOptions).toEqual({ scope: 'user:user-1' });
    });
  });

  describe('storage fallback', () => {
    it('uses IndexedDB directly when the user is in guest mode', async () => {
      backendState.enabled = true;
      backendState.preferredDataSource = 'api';
      setGuestMode();
      dbMocks.getAllIngredients.mockResolvedValue([createIngredient('local-1', { name: 'cooking-oil' })]);

      const { result } = await renderUseIngredients();

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(apiMocks.getAllIngredients).not.toHaveBeenCalled();
      expect(dbMocks.getAllIngredients).toHaveBeenCalledWith({ scope: 'guest' });
      expect(result.current.dataSource).toBe('indexeddb');
      expect(result.current.ingredients[0].name).toBe('cooking-oil');
    });

    it('loads the authenticated IndexedDB cache without an automatic API request', async () => {
      backendState.enabled = true;
      backendState.preferredDataSource = 'api';
      setAuthenticatedMode();
      const cachedIngredients = [createIngredient('fallback-1', { name: 'kimchi', syncState: 'clean' })];
      dbMocks.getAllIngredients.mockResolvedValue(cachedIngredients);
      dbMocks.getAllIngredientsForSync.mockResolvedValue(cachedIngredients);

      const { result } = await renderUseIngredients();

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(apiMocks.getAllIngredients).not.toHaveBeenCalled();
      expect(dbMocks.getAllIngredients).toHaveBeenCalledWith({ scope: 'user:user-1' });
      expect(result.current.dataSource).toBe('indexeddb');
      expect(result.current.ingredients[0].name).toBe('kimchi');
      expect(result.current.error).toBe('');
    });

    it('does not call the API when creating an authenticated ingredient', async () => {
      backendState.enabled = true;
      backendState.preferredDataSource = 'api';
      setAuthenticatedMode();

      const { result } = await renderUseIngredients();

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      const ingredient = createIngredient('fallback-add-1', { name: 'pear' });

      await act(async () => {
        await result.current.addIngredient(ingredient);
      });

      expect(apiMocks.saveIngredient).not.toHaveBeenCalled();
      expect(dbMocks.saveIngredient).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'fallback-add-1'
        }),
        { scope: 'user:user-1' }
      );
      expect(result.current.dataSource).toBe('indexeddb');
      expect(result.current.ingredients.map((item) => item.id)).toContain('fallback-add-1');
    });
  });

  describe('manual server sync', () => {
    it('sends only pending record changes when syncIngredientsToServer is requested', async () => {
      backendState.enabled = true;
      backendState.preferredDataSource = 'api';
      setAuthenticatedMode();
      const localIngredients = [
        createIngredient('sync-1', {
          name: 'api-loaded-item',
          updatedAt: '2026-05-01T10:00:00.000Z',
          syncState: 'pendingCreate'
        })
      ];
      dbMocks.getAllIngredients.mockResolvedValue(localIngredients);
      dbMocks.getAllIngredientsForSync.mockResolvedValue(localIngredients);
      apiMocks.pushIngredientsToServer.mockResolvedValue({ items: localIngredients, appliedCount: 1 });

      const { result } = await renderUseIngredients();

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(apiMocks.pushIngredientsToServer).not.toHaveBeenCalled();

      let response;
      await act(async () => {
        response = await result.current.syncIngredientsToServer();
      });

      expect(response.ok).toBe(true);
      expect(response.syncedCount).toBe(1);
      expect(apiMocks.pushIngredientsToServer).toHaveBeenCalledTimes(1);
      expect(apiMocks.pushIngredientsToServer).toHaveBeenCalledWith([
        expect.objectContaining({ id: 'sync-1', clientId: 'sync-1' })
      ]);
      expect(window.localStorage.getItem('fridgemate-last-synced-at:v2:user:user-1')).toBeTruthy();
      expect(window.localStorage.getItem('fridgemate-last-synced-at')).toBeNull();
      expect(result.current.syncStatus).toBe('synced');
      expect(result.current.hasUnsyncedChanges).toBe(false);
      expect(dbMocks.replaceIngredients).toHaveBeenCalledWith(
        [expect.objectContaining({ id: 'sync-1', syncState: 'clean' })],
        { scope: 'user:user-1' }
      );
    });

    it('sets syncStatus to error when manual sync fails', async () => {
      backendState.enabled = true;
      backendState.preferredDataSource = 'api';
      setAuthenticatedMode();
      const ingredient = createIngredient('sync-fail-1', { name: 'api-write-item' });
      dbMocks.getAllIngredients.mockResolvedValue([ingredient]);
      dbMocks.getAllIngredientsForSync.mockResolvedValue([
        { ...ingredient, updatedAt: '2026-08-26T10:00:00.000Z', syncState: 'pendingUpdate' }
      ]);
      apiMocks.pushIngredientsToServer.mockRejectedValue(new MockIngredientsApiError('Server down.', { status: 500 }));

      const { result } = await renderUseIngredients();

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      let response;
      await act(async () => {
        response = await result.current.syncIngredientsToServer();
      });

      expect(response).toEqual({ ok: false, message: 'Server down.' });
      expect(result.current.syncStatus).toBe('error');
      expect(result.current.hasUnsyncedChanges).toBe(true);
      expect(result.current.syncError).toBe('Server down.');
      expect(dbMocks.replaceIngredients).not.toHaveBeenCalled();
    });

    it('keeps pending state and reports a 4xx sync failure as incomplete', async () => {
      backendState.enabled = true;
      setAuthenticatedMode();
      const pending = createIngredient('invalid', {
        updatedAt: '2026-08-26T10:00:00.000Z',
        syncState: 'pendingUpdate'
      });
      dbMocks.getAllIngredients.mockResolvedValue([pending]);
      dbMocks.getAllIngredientsForSync.mockResolvedValue([pending]);
      apiMocks.pushIngredientsToServer.mockRejectedValue(
        new MockIngredientsApiError('Ingredient payload is invalid.', { status: 400 })
      );
      const { result } = await renderUseIngredients();
      await waitFor(() => expect(result.current.loading).toBe(false));

      let response;
      await act(async () => {
        response = await result.current.syncIngredientsToServer();
      });

      expect(response.ok).toBe(false);
      expect(result.current.syncStatus).toBe('error');
      expect(result.current.hasUnsyncedChanges).toBe(true);
      expect(dbMocks.replaceIngredients).not.toHaveBeenCalled();
    });

    it('does not sync to the server when the user is not authenticated', async () => {
      backendState.enabled = true;
      setGuestMode();

      const { result } = await renderUseIngredients();

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      let response;
      await act(async () => {
        response = await result.current.syncIngredientsToServer();
      });

      expect(response).toEqual({ ok: false, message: '로그인이 필요합니다.' });
      expect(apiMocks.pushIngredientsToServer).not.toHaveBeenCalled();
      expect(result.current.syncStatus).toBe('error');
    });

    it('pulls server ingredients into the local cache on request', async () => {
      backendState.enabled = true;
      backendState.preferredDataSource = 'api';
      setAuthenticatedMode();
      const remoteIngredients = [createIngredient('remote-1', { name: 'server-item' })];
      apiMocks.pullIngredientsFromServer.mockResolvedValue({ items: remoteIngredients });

      const { result } = await renderUseIngredients();

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      let response;
      await act(async () => {
        response = await result.current.pullIngredientsFromServer();
      });

      expect(response).toEqual({ ok: true, syncedCount: 1 });
      expect(apiMocks.pullIngredientsFromServer).toHaveBeenCalledTimes(1);
      expect(dbMocks.replaceIngredients).toHaveBeenCalledWith(
        [expect.objectContaining({ id: 'remote-1', syncState: 'clean' })],
        { scope: 'user:user-1' }
      );
      expect(result.current.ingredients).toEqual([expect.objectContaining({ id: 'remote-1', syncState: 'clean' })]);
      expect(result.current.syncStatus).toBe('synced');
    });

    it('does not overwrite a newer pending local update during server pull', async () => {
      backendState.enabled = true;
      setAuthenticatedMode();
      const pendingLocal = createIngredient('shared', {
        name: 'newer-local',
        updatedAt: '2026-08-26T12:00:00.000Z',
        syncState: 'pendingUpdate'
      });
      const olderRemote = createIngredient('server-id', {
        clientId: 'shared',
        name: 'older-server',
        updatedAt: '2026-08-26T11:00:00.000Z'
      });
      dbMocks.getAllIngredients.mockResolvedValue([pendingLocal]);
      dbMocks.getAllIngredientsForSync.mockResolvedValue([pendingLocal]);
      apiMocks.pullIngredientsFromServer.mockResolvedValue({ items: [olderRemote] });
      const { result } = await renderUseIngredients();
      await waitFor(() => expect(result.current.loading).toBe(false));

      await act(async () => {
        await result.current.pullIngredientsFromServer();
      });

      expect(result.current.ingredients[0]).toMatchObject({ name: 'newer-local', syncState: 'pendingUpdate' });
      expect(result.current.hasUnsyncedChanges).toBe(true);
      expect(result.current.syncStatus).toBe('dirty');
    });
  });

  describe('manual sync session ownership', () => {
    async function readySync() {
      backendState.enabled = true;
      setAuthenticatedMode('sync-owner');
      window.localStorage.removeItem('fridgemate-last-synced-at:v2:user:sync-owner');
      const view = await renderUseIngredients();
      await waitFor(() => expect(view.result.current.loading).toBe(false));
      return view;
    }
    async function changeAccount(view, account = 'sync-other') {
      setAuthenticatedMode(account); view.rerender();
      await waitFor(() => expect(view.result.current.loading).toBe(false));
    }

    it.each(['pushIngredientsToServer', 'pullIngredientsFromServer'])('rejects a retained %s callback before dispatch in another account', async action => {
      const view = await readySync();
      const oldAction = view.result.current[action];
      await changeAccount(view);
      let result;
      await act(async () => { result = await oldAction(); });
      expect(result.ok).toBe(false);
      expect(apiMocks[action]).not.toHaveBeenCalled();
      expect(view.result.current.error).toBe('');
      expect(view.result.current.syncStatus).toBe('idle');
    });

    it.each([false, true])('does not dispatch an old upload after its local read spans an account change (return=%s)', async returnToOwner => {
      const view = await readySync();
      const read = createDeferred();
      dbMocks.getAllIngredientsForSync.mockReturnValueOnce(read.promise);
      let pending;
      act(() => { pending = view.result.current.pushIngredientsToServer(); });
      await changeAccount(view);
      if (returnToOwner) await changeAccount(view, 'sync-owner');
      let result;
      await act(async () => {
        read.resolve([createIngredient('private-a', { syncState: 'pendingCreate' })]);
        result = await pending;
      });
      expect(result.ok).toBe(false);
      expect(apiMocks.pushIngredientsToServer).not.toHaveBeenCalled();
      expect(dbMocks.replaceIngredients).not.toHaveBeenCalled();
      expect(view.result.current.ingredients).toEqual([]);
      expect(view.result.current.error).toBe('');
      expect(view.result.current.syncStatus).toBe('idle');
    });

    it.each(['pushIngredientsToServer', 'pullIngredientsFromServer'])('does not persist a late %s response after switching accounts', async action => {
      const view = await readySync();
      const request = createDeferred();
      apiMocks[action].mockReturnValueOnce(request.promise);
      let pending;
      act(() => { pending = view.result.current[action](); });
      await waitFor(() => expect(apiMocks[action]).toHaveBeenCalledOnce());
      await changeAccount(view);
      let result;
      await act(async () => {
        request.resolve({ items: [createIngredient('private-a')], appliedCount: 1 });
        result = await pending;
      });
      expect(result.ok).toBe(false);
      expect(dbMocks.replaceIngredients).not.toHaveBeenCalled();
      expect(view.result.current.ingredients).toEqual([]);
      expect(view.result.current.syncStatus).toBe('idle');
      expect(view.result.current.error).toBe('');
      expect(window.localStorage.getItem('fridgemate-last-synced-at:v2:user:sync-owner')).toBeNull();
    });

    it.each(['pushIngredientsToServer', 'pullIngredientsFromServer'])('does not show an old %s failure in the current account', async action => {
      const view = await readySync();
      const request = createDeferred();
      apiMocks[action].mockReturnValueOnce(request.promise);
      let pending;
      act(() => { pending = view.result.current[action](); });
      await waitFor(() => expect(apiMocks[action]).toHaveBeenCalledOnce());
      await changeAccount(view);
      await act(async () => { request.reject(new MockIngredientsApiError('private old failure', { status: 403 })); await pending; });
      expect(view.result.current.error).toBe('');
      expect(view.result.current.syncError).toBeNull();
      expect(view.result.current.syncStatus).toBe('idle');
      expect(dbMocks.replaceIngredients).not.toHaveBeenCalled();
    });

    it.each(['pushIngredientsToServer', 'pullIngredientsFromServer'])('ignores a completed old %s cache acknowledgement without claiming to cancel storage', async action => {
      const view = await readySync();
      const cache = createDeferred();
      dbMocks.replaceIngredients.mockReturnValueOnce(cache.promise);
      let pending;
      act(() => { pending = view.result.current[action](); });
      await waitFor(() => expect(dbMocks.replaceIngredients).toHaveBeenCalledOnce());
      await changeAccount(view);
      let result;
      await act(async () => { cache.resolve(); result = await pending; });
      expect(result.ok).toBe(false);
      expect(view.result.current.error).toBe('');
      expect(view.result.current.syncStatus).toBe('idle');
      expect(window.localStorage.getItem('fridgemate-last-synced-at:v2:user:sync-owner')).toBeNull();
    });
  });

  describe('derived filtering and sorting from hook data', () => {
    it('returns data that consumers can filter by category, sort by expiry, and split by consumed status', async () => {
      setGuestMode();
      dbMocks.getAllIngredients.mockResolvedValue([
        createIngredient('sort-1', {
          name: 'milk',
          category: 'dairy',
          expiryDate: '2026-01-18',
          consumed: false
        }),
        createIngredient('sort-2', {
          name: 'green-onion',
          category: 'vegetable',
          expiryDate: '2026-01-25',
          consumed: false
        }),
        createIngredient('sort-3', {
          name: 'kimchi',
          category: 'vegetable',
          expiryDate: '2026-01-16',
          consumed: true
        }),
        createIngredient('sort-4', {
          name: 'pear',
          category: 'vegetable',
          expiryDate: '2026-01-17',
          consumed: false
        })
      ]);

      const { result } = await renderUseIngredients();

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      const vegetables = result.current.ingredients.filter((ingredient) => ingredient.category === 'vegetable');
      const sortedByExpiry = sortByExpiryLikePage(result.current.ingredients);
      const consumedItems = result.current.ingredients.filter((ingredient) => ingredient.consumed);
      const activeItems = result.current.ingredients.filter((ingredient) => !ingredient.consumed);

      expect(vegetables.map((ingredient) => ingredient.name)).toEqual(['green-onion', 'kimchi', 'pear']);
      expect(sortedByExpiry.map((ingredient) => ingredient.name)).toEqual(['kimchi', 'pear', 'milk', 'green-onion']);
      expect(consumedItems.map((ingredient) => ingredient.name)).toEqual(['kimchi']);
      expect(activeItems.map((ingredient) => ingredient.name)).toEqual(['milk', 'green-onion', 'pear']);
    });
  });
});
