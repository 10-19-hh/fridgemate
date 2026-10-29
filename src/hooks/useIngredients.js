import { createContext, createElement, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  createCrudActions,
  createLoadIngredientsAction,
  createPullAction,
  createPushAction,
  createRepositoryCommandRunner
} from '../features/ingredients/ingredientsActions';
import {
  createEmptySyncSummary,
  getScopeState,
  getStoredLastSyncedAt
} from '../features/ingredients/ingredientsScopeState';
import { isBackendEnabled } from '../utils/backendConfig';
import { commitIngredientImport } from '../features/import/ingredientImportRepository';
import { getPendingIngredients } from '../utils/syncStrategy';
import { useAuth } from './useAuth';

const IngredientsContext = createContext(null);

export function IngredientsProvider({ children }) {
  const { isAuthenticated, storageScope } = useAuth();
  const backendSyncAvailable = isBackendEnabled() && isAuthenticated;
  const useApi = false;
  const initialScopeState = getScopeState(storageScope);
  const scopeSnapshotReady = initialScopeState.loaded && !initialScopeState.writeRecords?.size;
  const [displayScope, setDisplayScope] = useState(storageScope);
  const [ingredients, setIngredients] = useState(() => (scopeSnapshotReady ? initialScopeState.items : []));
  const [loading, setLoading] = useState(() => !scopeSnapshotReady);
  const [error, setError] = useState('');
  const [readError, setReadError] = useState('');
  const [dataSource, setDataSource] = useState('indexeddb');
  const [syncSummary, setSyncSummary] = useState(() => initialScopeState.syncSummary || createEmptySyncSummary());
  const [syncStatus, setSyncStatus] = useState('idle');
  const [lastSyncedAt, setLastSyncedAt] = useState(() => getStoredLastSyncedAt(storageScope));
  const [syncError, setSyncError] = useState(null);
  const [hasUnsyncedChanges, setHasUnsyncedChanges] = useState(false);
  const isSyncing = syncStatus === 'syncing';
  const ingredientsRef = useRef(ingredients);
  const scopeRef = useRef(storageScope);
  const importMountedRef = useRef(true);
  const importSessionRef = useRef({ scope: storageScope, syncEnabled: backendSyncAvailable });
  if (importSessionRef.current.scope !== storageScope || importSessionRef.current.syncEnabled !== backendSyncAvailable) {
    importSessionRef.current = { scope: storageScope, syncEnabled: backendSyncAvailable };
  }
  const importSession = importSessionRef.current;
  const isCurrentLoadSession = useCallback(() => importMountedRef.current
    && importSessionRef.current === importSession, [importSession]);

  useEffect(() => {
    importMountedRef.current = true;
    return () => { importMountedRef.current = false; };
  }, []);

  const clearError = useCallback(() => {
    setError('');
  }, []);

  const commitIngredients = useCallback((nextValue, targetScope = scopeRef.current, { fullSnapshot = false } = {}) => {
    const scopeState = getScopeState(targetScope);
    const currentItems = targetScope === scopeRef.current ? ingredientsRef.current : scopeState.items;
    const nextIngredients = typeof nextValue === 'function' ? nextValue(currentItems) : nextValue;

    scopeState.items = nextIngredients;
    if (fullSnapshot) {
      scopeState.loaded = true;
      scopeState.writeVersion = (scopeState.writeVersion || 0) + 1;
    }

    if (targetScope === scopeRef.current) {
      ingredientsRef.current = nextIngredients;
      setIngredients(nextIngredients);
    }
  }, []);

  const commitSyncSummary = useCallback((nextSummary, targetScope = scopeRef.current) => {
    const scopeState = getScopeState(targetScope);
    scopeState.syncSummary = nextSummary;

    if (targetScope === scopeRef.current) {
      setSyncSummary(nextSummary);
    }
  }, []);

  useEffect(() => {
    const nextScopeState = getScopeState(storageScope);
    const ready = nextScopeState.loaded && !nextScopeState.writeRecords?.size;
    setDisplayScope(storageScope);
    scopeRef.current = storageScope;
    ingredientsRef.current = nextScopeState.items;
    setIngredients(ready ? nextScopeState.items : []);
    setLoading(!ready);
    setError('');
    setDataSource('indexeddb');
    setReadError('');
    setSyncSummary(nextScopeState.syncSummary || createEmptySyncSummary());
    setSyncStatus('idle');
    setSyncError(null);
    setHasUnsyncedChanges(false);
    setLastSyncedAt(getStoredLastSyncedAt(storageScope));
  }, [storageScope]);

  useEffect(() => {
    ingredientsRef.current = ingredients;
  }, [ingredients]);

  const runRepositoryCommand = useMemo(
    () =>
      createRepositoryCommandRunner({
        useApi,
        setDataSource,
        setError
      }),
    [useApi]
  );

  const markDirty = useCallback(() => {
    setSyncStatus('dirty');
    setHasUnsyncedChanges(true);
    setSyncError(null);
  }, []);

  const importIngredients = useCallback(async (command) => {
    const cache = getScopeState(storageScope);
    const isCurrent = () => importMountedRef.current && importSessionRef.current === importSession
      && getScopeState(storageScope) === cache;
    if (!isCurrent() || command?.scope !== storageScope || command?.syncEnabled !== backendSyncAvailable) {
      throw new Error('가져오기 검토의 계정이나 저장 상태가 바뀌었어요. 다시 확인해 주세요.');
    }
    // The transaction owns validation and rollback. Do not optimistically remove
    // replacement targets or turn a later refresh failure into a failed import.
    // A return to this account while its acknowledgement is delayed must read
    // storage, not reuse the pre-import cache. Keep the currently shown rows.
    cache.loaded = false;
    const result = await commitIngredientImport(command, { isCurrent });
    if (isCurrent()) {
      const pendingUploads = backendSyncAvailable ? getPendingIngredients(result.syncSnapshot) : [];
      commitIngredients(result.ingredients, storageScope, { fullSnapshot: true });
      commitSyncSummary({ ...createEmptySyncSummary(), pendingUploads,
        nextSnapshot: backendSyncAvailable ? result.syncSnapshot : [] }, storageScope);
      setDataSource('indexeddb');
      setHasUnsyncedChanges(pendingUploads.length > 0);
      setSyncStatus(pendingUploads.length > 0 ? 'dirty' : 'idle');
      setSyncError(null);
    } else {
      // A late acknowledgement may not repopulate a removed/replaced scope cache.
      // If the old cache is reused later, require a fresh storage read instead.
      cache.loaded = false;
    }
    return result;
  }, [backendSyncAvailable, commitIngredients, commitSyncSummary, importSession, storageScope]);

  const loadIngredients = useMemo(
    () =>
      createLoadIngredientsAction({
        storageScope,
        useApi,
        syncEnabled: backendSyncAvailable,
        scopeRef,
        isCurrentSession: isCurrentLoadSession,
        commitIngredients,
        commitSyncSummary,
        runRepositoryCommand,
        setLoading,
        setReadError,
        setHasUnsyncedChanges,
        setSyncStatus
      }),
    [backendSyncAvailable, commitIngredients, commitSyncSummary, isCurrentLoadSession, runRepositoryCommand, storageScope, useApi]
  );

  useEffect(() => {
    const scopeState = getScopeState(storageScope);

    if (scopeState.loaded && !scopeState.writeRecords?.size) {
      setLoading(false);
      return;
    }

    // The request owner settles loading; a stale initial read cannot end a new one.
    loadIngredients().catch(() => {});
  }, [loadIngredients, storageScope]);

  const { addIngredient, updateIngredient, addIngredients, removeIngredient, findIngredient } = useMemo(
    () =>
      createCrudActions({
        storageScope,
        syncEnabled: backendSyncAvailable,
        commitIngredients,
        commitSyncSummary,
        runRepositoryCommand,
        markDirty,
        isCurrentSession: isCurrentLoadSession,
        setError
      }),
    [backendSyncAvailable, commitIngredients, commitSyncSummary, isCurrentLoadSession, markDirty, runRepositoryCommand, storageScope]
  );

  const pushIngredientsToServer = useMemo(
    () =>
      createPushAction({
        isAuthenticated: backendSyncAvailable,
        storageScope,
        isCurrentSession: isCurrentLoadSession,
        commitIngredients,
        commitSyncSummary,
        setSyncStatus,
        setHasUnsyncedChanges,
        setLastSyncedAt,
        setSyncError,
        setError
      }),
    [backendSyncAvailable, commitIngredients, commitSyncSummary, isCurrentLoadSession, storageScope]
  );

  const pullIngredientsFromServer = useMemo(
    () =>
      createPullAction({
        isAuthenticated: backendSyncAvailable,
        storageScope,
        isCurrentSession: isCurrentLoadSession,
        commitIngredients,
        commitSyncSummary,
        setSyncStatus,
        setHasUnsyncedChanges,
        setSyncError,
        setError
      }),
    [backendSyncAvailable, commitIngredients, commitSyncSummary, isCurrentLoadSession, storageScope]
  );

  const value = useMemo(
    () => ({
      ingredients: displayScope === storageScope ? ingredients : scopeSnapshotReady ? initialScopeState.items : [],
      loading: displayScope === storageScope ? loading : !scopeSnapshotReady,
      isSyncing: displayScope === storageScope && isSyncing,
      error: displayScope === storageScope ? error : '',
      readError: displayScope === storageScope ? readError : '',
      dataSource: displayScope === storageScope ? dataSource : 'indexeddb',
      syncSummary: displayScope === storageScope ? syncSummary : initialScopeState.syncSummary,
      syncStatus: displayScope === storageScope ? syncStatus : 'idle',
      lastSyncedAt: displayScope === storageScope ? lastSyncedAt : null,
      syncError: displayScope === storageScope ? syncError : null,
      hasUnsyncedChanges: displayScope === storageScope && hasUnsyncedChanges,
      clearError,
      markIngredientsDirty: markDirty,
      loadIngredients,
      syncIngredientsToServer: pushIngredientsToServer,
      pushIngredientsToServer,
      pullIngredientsFromServer,
      addIngredient,
      addIngredients,
      importIngredients,
      updateIngredient,
      removeIngredient,
      findIngredient
    }),
    [
      addIngredient,
      addIngredients,
      clearError,
      dataSource,
      displayScope,
      error,
      readError,
      findIngredient,
      hasUnsyncedChanges,
      ingredients,
      initialScopeState,
      importIngredients,
      isSyncing,
      lastSyncedAt,
      loadIngredients,
      loading,
      markDirty,
      pullIngredientsFromServer,
      pushIngredientsToServer,
      removeIngredient,
      storageScope,
      scopeSnapshotReady,
      syncError,
      syncSummary,
      syncStatus,
      updateIngredient
    ]
  );

  return createElement(IngredientsContext.Provider, { value }, children);
}

export function useIngredients() {
  const context = useContext(IngredientsContext);

  if (!context) {
    throw new Error('useIngredients must be used within IngredientsProvider.');
  }

  return context;
}
