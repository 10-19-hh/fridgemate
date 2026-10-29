import {
  findIngredientInRepository,
  ingredientCache,
  loadIngredientsFromRepository,
  pullIngredientsFromServerInRepository,
  pushIngredientsToServerInRepository
} from './ingredientRepository';
import {
  buildScopeOptions,
  createEmptySyncSummary,
  getScopeState,
  setStoredLastSyncedAt
} from './ingredientsScopeState';
import {
  getPendingIngredients,
  getVisibleIngredients,
  markIngredientAsPending,
  markIngredientAsSynced,
  SYNC_STATE,
  syncIngredientSnapshot
} from '../../utils/syncStrategy';

const FALLBACK_WARNING_MESSAGE =
  'The API connection is unstable, so FridgeMate is temporarily using the authenticated local cache.';
const STALE_READ_MESSAGE = '재고 조회를 시작한 계정이나 요청이 바뀌었습니다. 다시 확인해주세요.';
const STALE_SYNC_MESSAGE = '동기화를 시작한 계정이 바뀌었습니다. 현재 계정에서 다시 시도해주세요.';
const READ_ERROR_MESSAGE = '재고를 불러오지 못했어요. 다시 불러와 주세요.';
const WRITE_ERROR_MESSAGE = '재료를 저장하지 못했어요. 기존 재고는 유지돼요. 다시 시도해주세요.';
const DELETE_ERROR_MESSAGE = '재료를 삭제하지 못했어요. 기존 재고는 유지돼요. 다시 시도해주세요.';

export function ensureIngredientId(ingredient) {
  const id = ingredient.id || crypto.randomUUID();
  return {
    ...ingredient,
    id,
    clientId: ingredient.clientId || id
  };
}

export function upsertIngredient(items, nextIngredient) {
  const nextItems = [...items];
  const existingIndex = nextItems.findIndex((item) => item.id === nextIngredient.id);

  if (existingIndex === -1) {
    nextItems.unshift(nextIngredient);
    return nextItems;
  }

  nextItems[existingIndex] = nextIngredient;
  return nextItems;
}

export function restoreIngredient(items, ingredient, index) {
  const nextItems = [...items];
  const existingIndex = nextItems.findIndex((item) => item.id === ingredient.id);

  if (existingIndex !== -1) {
    nextItems[existingIndex] = ingredient;
    return nextItems;
  }

  const safeIndex = index < 0 ? 0 : Math.min(index, nextItems.length);
  nextItems.splice(safeIndex, 0, ingredient);
  return nextItems;
}

export function createRepositoryCommandRunner({ useApi, setDataSource, setError }) {
  return async function runRepositoryCommand(actionLabel, repositoryOperation, { isCurrent = () => true } = {}) {
    try {
      const { result, source, usedFallback } = await repositoryOperation();
      if (!isCurrent()) throw new Error(STALE_READ_MESSAGE);

      if (!useApi) {
        setDataSource('indexeddb');
        setError('');
        return { result, source, usedFallback };
      }

      if (usedFallback) {
        console.warn(`[useIngredients] ${actionLabel} failed via API. Falling back to IndexedDB.`);
        setDataSource('indexeddb');
        setError(FALLBACK_WARNING_MESSAGE);
        return { result, source, usedFallback };
      }

      setDataSource(source);
      setError('');
      return { result, source, usedFallback };
    } catch (nextError) {
      if (!isCurrent()) throw new Error(STALE_READ_MESSAGE);
      setError(!useApi ? READ_ERROR_MESSAGE : nextError.message || 'Failed to process ingredient data.');
      throw nextError;
    }
  };
}

async function syncIndexedDbCache(actionLabel, operation) {
  try {
    await operation();
  } catch (nextError) {
    console.warn(`[useIngredients] Failed to update IndexedDB cache after ${actionLabel}.`, nextError);
  }
}

export function createLoadIngredientsAction({
  storageScope,
  useApi,
  syncEnabled,
  scopeRef,
  isCurrentSession,
  commitIngredients,
  commitSyncSummary,
  runRepositoryCommand,
  setLoading,
  setReadError,
  setHasUnsyncedChanges,
  setSyncStatus
}) {
  return async function loadIngredients({ force = false } = {}) {
    const scopeState = getScopeState(storageScope);
    const isSameSession = () => isCurrentSession() && scopeRef.current === storageScope
      && getScopeState(storageScope) === scopeState;
    if (!isSameSession()) throw new Error(STALE_READ_MESSAGE);

    if (!force && scopeState.loaded && !scopeState.writeRecords?.size) {
      const hasPendingChanges = scopeState.syncSummary.pendingUploads.length > 0;
      setHasUnsyncedChanges(hasPendingChanges);
      if (hasPendingChanges) setSyncStatus('dirty');
      setLoading(false);
      setReadError('');
      return scopeState.items;
    }

    if (!force && scopeState.promise && scopeState.loadRequest?.isCurrent()) {
      const request = scopeState.loadRequest;
      const isCurrent = () => isSameSession() && request.isCurrent();
      setLoading(true);
      try {
        const { items, sync } = await scopeState.promise;
        if (!isCurrent()) throw new Error(STALE_READ_MESSAGE);
        // Another mounted provider may share the read but owns its own UI state.
        commitIngredients(items, storageScope, { fullSnapshot: true });
        commitSyncSummary(sync, storageScope);
        const hasPendingChanges = sync.pendingUploads.length > 0;
        setHasUnsyncedChanges(hasPendingChanges);
        if (hasPendingChanges) setSyncStatus('dirty');
        setReadError('');
        return items;
      } catch (nextError) {
        if (isSameSession() && scopeState.loadRequest === request && !request.isCurrent()) {
          // The shared read's owner left. Read again in this still-active session;
          // never reuse the snapshot captured for the abandoned owner.
          return loadIngredients({ force: true });
        }
        if (isCurrent()) setReadError(READ_ERROR_MESSAGE);
        throw nextError;
      } finally {
        if (isCurrent()) setLoading(false);
      }
    }

    const request = { isCurrent: () => isSameSession() && scopeState.loadRequest === request };
    scopeState.loadRequest = request;
    // A different account session must not reuse the pre-refresh cached rows.
    scopeState.loaded = false;
    setLoading(true);

    const readSnapshot = async () => {
      const writeVersion = scopeState.writeVersion || 0;
      const changedWhileReading = () => (scopeState.writeVersion || 0) !== writeVersion;
      try {
        const response = await loadIngredientsFromRepository({ scope: storageScope, useApi });
        if (!request.isCurrent()) throw new Error(STALE_READ_MESSAGE);
        if (changedWhileReading()) return readSnapshot();
        let items = response.result || [];
        let nextSyncSummary = createEmptySyncSummary();

        if (response.source === 'api') {
          const localIngredients = await ingredientCache.getAllForSync(buildScopeOptions(storageScope));
          if (!request.isCurrent()) throw new Error(STALE_READ_MESSAGE);
          nextSyncSummary = await syncIngredientSnapshot({ localIngredients, remoteIngredients: items });
          if (!request.isCurrent()) throw new Error(STALE_READ_MESSAGE);
          if (changedWhileReading()) return readSnapshot();
          items = getVisibleIngredients(nextSyncSummary.nextSnapshot);
          await syncIndexedDbCache('loadIngredients', () =>
            ingredientCache.replaceAll(nextSyncSummary.nextSnapshot, buildScopeOptions(storageScope))
          );
        } else if (syncEnabled) {
          const localIngredients = await ingredientCache.getAllForSync(buildScopeOptions(storageScope));
          if (!request.isCurrent()) throw new Error(STALE_READ_MESSAGE);
          nextSyncSummary = { ...createEmptySyncSummary(),
            pendingUploads: getPendingIngredients(localIngredients), nextSnapshot: localIngredients };
          items = getVisibleIngredients(localIngredients);
        }
        if (!request.isCurrent()) throw new Error(STALE_READ_MESSAGE);
        // Keep one shared request owner, but never publish a snapshot or error
        // taken before a successful local mutation in that same session.
        if (changedWhileReading()) return readSnapshot();
        return { ...response, result: { items, sync: nextSyncSummary } };
      } catch (nextError) {
        if (request.isCurrent() && changedWhileReading()) return readSnapshot();
        throw nextError;
      }
    };
    const task = runRepositoryCommand('loadIngredients', readSnapshot,
      { isCurrent: request.isCurrent }).then(({ result }) => result);

    scopeState.promise = task;

    try {
      const { items, sync } = await task;
      if (!request.isCurrent()) throw new Error(STALE_READ_MESSAGE);
      commitIngredients(items, storageScope, { fullSnapshot: true });
      commitSyncSummary(sync, storageScope);
      const hasPendingChanges = sync.pendingUploads.length > 0;
      setHasUnsyncedChanges(hasPendingChanges);
      if (hasPendingChanges) setSyncStatus('dirty');
      setReadError('');

      return items;
    } catch (nextError) {
      if (request.isCurrent()) setReadError(READ_ERROR_MESSAGE);
      throw nextError;
    } finally {
      if (scopeState.promise === task) scopeState.promise = null;

      if (request.isCurrent()) {
        setLoading(false);
      }
    }
  };
}

export function createCrudActions({
  storageScope,
  syncEnabled,
  commitIngredients,
  commitSyncSummary,
  runRepositoryCommand,
  markDirty,
  isCurrentSession,
  setError
}) {
  const scopeState = getScopeState(storageScope);
  const isCurrent = () => isCurrentSession() && getScopeState(storageScope) === scopeState;
  const assertCurrent = () => {
    if (!isCurrent()) throw new Error(STALE_READ_MESSAGE);
  };
  const commitCurrent = next => {
    if (isCurrent()) commitIngredients(next, storageScope);
  };
  const beginWrite = (nextItems, removedIds = []) => {
    assertCurrent();
    setError('');
    const token = {};
    const records = scopeState.writeRecords ||= new Map();
    const changes = new Map(nextItems.map(item => [item.id, item]));
    removedIds.forEach(id => changes.set(id, null));
    const operations = [...changes].map(([id, next]) => {
      if (!records.has(id)) {
        const index = scopeState.items.findIndex(item => item.id === id);
        records.set(id, { confirmed: scopeState.items[index] || null, index,
          sequence: 0, confirmedSequence: 0, pending: new Map() });
      }
      const record = records.get(id);
      const sequence = ++record.sequence;
      record.pending.set(token, sequence);
      return { id, next, record, sequence };
    });
    return {
      settle(success) {
        let reportFailure = false;
        for (const { id, next, record, sequence } of operations) {
          if (success && sequence > record.confirmedSequence) {
            record.confirmed = next;
            record.confirmedSequence = sequence;
          }
          record.pending.delete(token);
          const hasNewerPending = [...record.pending.values()].some(pending => pending > sequence);
          if (!hasNewerPending) {
            // A failed optimistic edit is never the rollback baseline for the
            // next edit. Restore only the last confirmed value in this chain.
            commitCurrent(current => record.confirmed
              ? restoreIngredient(current, record.confirmed, record.index)
              : current.filter(item => item.id !== id));
            if (!success && record.confirmedSequence <= sequence) reportFailure = true;
          }
          if (!record.pending.size) records.delete(id);
        }
        return reportFailure;
      }
    };
  };
  const reportWriteFailure = (error, message, mutation) => {
    const visibleFailure = mutation.settle(false);
    if (isCurrent() && visibleFailure) setError(message);
    else if (!isCurrent()) scopeState.loaded = false;
    throw error;
  };
  const prepareLocalIngredient = (ingredient, pendingState) => {
    if (!syncEnabled) return ingredient;

    const now = new Date().toISOString();
    return markIngredientAsPending(
      {
        ...ingredient,
        createdAt: ingredient.createdAt || now,
        updatedAt: now,
        deletedAt: null
      },
      pendingState
    );
  };

  const refreshLocalSyncSummary = async () => {
    assertCurrent();
    if (!syncEnabled) {
      commitSyncSummary(createEmptySyncSummary(), storageScope);
      return;
    }

    try {
      const localIngredients = await ingredientCache.getAllForSync(buildScopeOptions(storageScope));
      assertCurrent();
      commitSyncSummary(
        {
          ...createEmptySyncSummary(),
          pendingUploads: getPendingIngredients(localIngredients),
          nextSnapshot: localIngredients
        },
        storageScope
      );
    } catch (nextError) {
      console.warn('[useIngredients] Failed to refresh local sync metadata.', nextError);
    }
  };

  const saveLocalIngredient = async (ingredient) => {
    await ingredientCache.save(ingredient, buildScopeOptions(storageScope));
    assertCurrent();
    scopeState.writeVersion = (scopeState.writeVersion || 0) + 1;
    await refreshLocalSyncSummary();
    assertCurrent();
    markDirty();
  };

  const saveLocalIngredients = async (ingredients) => {
    await ingredientCache.saveMany(ingredients, buildScopeOptions(storageScope));
    assertCurrent();
    scopeState.writeVersion = (scopeState.writeVersion || 0) + 1;
    await refreshLocalSyncSummary();
    assertCurrent();
    markDirty();
  };

  const removeLocalIngredient = async (id) => {
    await ingredientCache.remove(id, buildScopeOptions(storageScope));
    assertCurrent();
    scopeState.writeVersion = (scopeState.writeVersion || 0) + 1;
    commitSyncSummary(createEmptySyncSummary(), storageScope);
    markDirty();
  };

  return {
    async addIngredient(ingredient) {
      assertCurrent();
      const optimisticIngredient = prepareLocalIngredient(
        ensureIngredientId({ ...ingredient }),
        SYNC_STATE.PENDING_CREATE
      );
      const mutation = beginWrite([optimisticIngredient]);
      commitCurrent((current) => upsertIngredient(current, optimisticIngredient));

      try {
        await saveLocalIngredient(optimisticIngredient);
        mutation.settle(true);
        return optimisticIngredient;
      } catch (nextError) {
        reportWriteFailure(nextError, WRITE_ERROR_MESSAGE, mutation);
      }
    },

    async updateIngredient(ingredient) {
      assertCurrent();
      const existingIngredient = scopeState.items.find((item) => item.id === ingredient.id);
      const pendingState =
        existingIngredient?.syncState === SYNC_STATE.PENDING_CREATE
          ? SYNC_STATE.PENDING_CREATE
          : SYNC_STATE.PENDING_UPDATE;
      const optimisticIngredient = prepareLocalIngredient(ensureIngredientId({ ...ingredient }), pendingState);
      const mutation = beginWrite([optimisticIngredient]);

      commitCurrent((current) => upsertIngredient(current, optimisticIngredient));

      try {
        await saveLocalIngredient(optimisticIngredient);
        mutation.settle(true);
        return optimisticIngredient;
      } catch (nextError) {
        reportWriteFailure(nextError, WRITE_ERROR_MESSAGE, mutation);
      }
    },

    async addIngredients(items) {
      assertCurrent();
      const optimisticIngredients = items.map((ingredient) =>
        prepareLocalIngredient(ensureIngredientId({ ...ingredient }), SYNC_STATE.PENDING_CREATE)
      );
      const mutation = beginWrite(optimisticIngredients);

      commitCurrent((current) =>
        optimisticIngredients.reduce((nextItems, ingredient) => upsertIngredient(nextItems, ingredient), current)
      );

      try {
        await saveLocalIngredients(optimisticIngredients);
        mutation.settle(true);
        return optimisticIngredients;
      } catch (nextError) {
        reportWriteFailure(nextError, WRITE_ERROR_MESSAGE, mutation);
      }
    },

    async removeIngredient(id) {
      assertCurrent();
      const previousIndex = scopeState.items.findIndex((ingredient) => ingredient.id === id);
      const previousIngredient = previousIndex >= 0 ? scopeState.items[previousIndex] : null;
      const mutation = beginWrite([], [id]);

      commitCurrent((current) => current.filter((ingredient) => ingredient.id !== id));

      try {
        if (syncEnabled && previousIngredient) {
          const deletedAt = new Date().toISOString();
          const tombstone = {
            id: previousIngredient.id,
            clientId: previousIngredient.clientId || previousIngredient.id,
            updatedAt: deletedAt,
            deletedAt
          };
          if (Object.hasOwn(previousIngredient, 'userId')) {
            tombstone.userId = previousIngredient.userId;
          }
          await saveLocalIngredient(
            markIngredientAsPending(
              tombstone,
              SYNC_STATE.PENDING_DELETE
            )
          );
        } else {
          await removeLocalIngredient(id);
        }
        mutation.settle(true);
      } catch (nextError) {
        reportWriteFailure(nextError, DELETE_ERROR_MESSAGE, mutation);
      }
    },

    async findIngredient(id) {
      assertCurrent();
      // Pending writes and failed/unfinished reads are not a confirmed cache.
      const existingIngredient = scopeState.loaded && !scopeState.writeRecords?.has(id)
        ? scopeState.items.find((ingredient) => ingredient.id === id) : null;

      if (existingIngredient) {
        return existingIngredient;
      }

      const { result: foundIngredient, source } = await runRepositoryCommand('findIngredient', () =>
        findIngredientInRepository({
          id,
          scope: storageScope,
          useApi: false
        }), { isCurrent }
      );
      assertCurrent();

      const committedIngredient =
        source === 'api' && foundIngredient ? markIngredientAsSynced(foundIngredient) : foundIngredient;

      if (source === 'api' && committedIngredient) {
        await syncIndexedDbCache('findIngredient', () =>
          ingredientCache.save(committedIngredient, buildScopeOptions(storageScope))
        );
      }

      if (committedIngredient) {
        assertCurrent();
        commitCurrent((current) => upsertIngredient(current, committedIngredient));
      }

      return committedIngredient;
    }
  };
}

export function createPushAction({
  isAuthenticated,
  storageScope,
  isCurrentSession = () => true,
  commitIngredients,
  commitSyncSummary,
  setSyncStatus,
  setHasUnsyncedChanges,
  setLastSyncedAt,
  setSyncError,
  setError
}) {
  const scopeState = getScopeState(storageScope);
  const isCurrent = () => isCurrentSession() && getScopeState(storageScope) === scopeState;
  const assertCurrent = () => {
    if (!isCurrent()) throw new Error(STALE_SYNC_MESSAGE);
  };

  return async function pushIngredientsToServer() {
    if (!isCurrent()) return { ok: false, message: STALE_SYNC_MESSAGE };
    if (!isAuthenticated) {
      const message = '로그인이 필요합니다.';
      setSyncStatus('error');
      setHasUnsyncedChanges(true);
      setSyncError(message);
      setError(message);
      return { ok: false, message };
    }

    setSyncStatus('syncing');
    setSyncError(null);
    setError('');

    try {
      const localIngredients = await ingredientCache.getAllForSync(buildScopeOptions(storageScope));
      assertCurrent();
      const pendingIngredients = getPendingIngredients(localIngredients);
      const response = await pushIngredientsToServerInRepository(
        pendingIngredients.map(({ lastSyncedAt, syncState, ...ingredient }) => ({
          ...ingredient,
          clientId: ingredient.clientId || ingredient.id
        }))
      );
      assertCurrent();
      const remoteIngredients = Array.isArray(response) ? response : response.items || [];
      const syncSummary = await syncIngredientSnapshot({ localIngredients, remoteIngredients });
      assertCurrent();
      const now = new Date().toISOString();
      const nextSnapshot = syncSummary.nextSnapshot;
      const nextIngredients = getVisibleIngredients(nextSnapshot);
      const hasPendingChanges = syncSummary.pendingUploads.length > 0;

      await ingredientCache.replaceAll(nextSnapshot, buildScopeOptions(storageScope));
      assertCurrent();
      commitIngredients(nextIngredients, storageScope, { fullSnapshot: true });
      commitSyncSummary(syncSummary, storageScope);
      setStoredLastSyncedAt(storageScope, now);
      setLastSyncedAt(now);
      setSyncStatus(hasPendingChanges ? 'dirty' : 'synced');
      setHasUnsyncedChanges(hasPendingChanges);
      setSyncError(null);

      return {
        ok: true,
        syncedCount: Number.isInteger(response?.appliedCount) ? response.appliedCount : pendingIngredients.length,
        lastSyncedAt: now
      };
    } catch (nextError) {
      if (!isCurrent()) return { ok: false, message: STALE_SYNC_MESSAGE };
      const message = nextError.message || 'API request could not reach the server.';
      setSyncStatus('error');
      setHasUnsyncedChanges(true);
      setSyncError(message);
      setError(message);
      return { ok: false, message };
    }
  };
}

export function createPullAction({
  isAuthenticated,
  storageScope,
  isCurrentSession = () => true,
  commitIngredients,
  commitSyncSummary,
  setSyncStatus,
  setHasUnsyncedChanges,
  setSyncError,
  setError
}) {
  const scopeState = getScopeState(storageScope);
  const isCurrent = () => isCurrentSession() && getScopeState(storageScope) === scopeState;
  const assertCurrent = () => {
    if (!isCurrent()) throw new Error(STALE_SYNC_MESSAGE);
  };

  return async function pullIngredientsFromServer() {
    if (!isCurrent()) return { ok: false, message: STALE_SYNC_MESSAGE };
    if (!isAuthenticated) {
      const message = '로그인이 필요합니다.';
      setSyncStatus('error');
      setSyncError(message);
      setError(message);
      return { ok: false, message };
    }

    setSyncStatus('syncing');
    setSyncError(null);
    setError('');

    try {
      const response = await pullIngredientsFromServerInRepository();
      assertCurrent();
      const remoteIngredients = Array.isArray(response) ? response : response.items || [];
      const localIngredients = await ingredientCache.getAllForSync(buildScopeOptions(storageScope));
      assertCurrent();
      const syncSummary = await syncIngredientSnapshot({ localIngredients, remoteIngredients });
      assertCurrent();
      const nextSnapshot = syncSummary.nextSnapshot;
      const nextIngredients = getVisibleIngredients(nextSnapshot);
      const hasPendingChanges = syncSummary.pendingUploads.length > 0;

      await ingredientCache.replaceAll(nextSnapshot, buildScopeOptions(storageScope));
      assertCurrent();
      commitIngredients(nextIngredients, storageScope, { fullSnapshot: true });
      commitSyncSummary(syncSummary, storageScope);
      setSyncStatus(hasPendingChanges ? 'dirty' : 'synced');
      setHasUnsyncedChanges(hasPendingChanges);
      setSyncError(null);

      return {
        ok: true,
        syncedCount: nextIngredients.length
      };
    } catch (nextError) {
      if (!isCurrent()) return { ok: false, message: STALE_SYNC_MESSAGE };
      const message = nextError.message || 'API request could not reach the server.';
      setSyncStatus('error');
      setSyncError(message);
      setError(message);
      return { ok: false, message };
    }
  };
}
