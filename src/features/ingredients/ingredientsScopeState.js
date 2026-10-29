import { SYNC_STRATEGY } from '../../utils/syncStrategy';

const scopeStateCache = new Map();
const LAST_SYNCED_AT_STORAGE_PREFIX = 'fridgemate-last-synced-at:v2';
const LEGACY_LAST_SYNCED_AT_STORAGE_KEY = 'fridgemate-last-synced-at';

function getStorage() {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function getLastSyncedAtStorageKey(scope) {
  return `${LAST_SYNCED_AT_STORAGE_PREFIX}:${scope}`;
}

export function createEmptySyncSummary() {
  return {
    strategy: SYNC_STRATEGY,
    pendingUploads: [],
    pendingDownloads: [],
    conflicts: [],
    nextSnapshot: []
  };
}

export function getScopeState(scope) {
  if (!scopeStateCache.has(scope)) {
    scopeStateCache.set(scope, {
      items: [],
      loaded: false,
      promise: null,
      syncSummary: createEmptySyncSummary()
    });
  }

  return scopeStateCache.get(scope);
}

export function clearScopeState(scope) {
  scopeStateCache.delete(scope);

  const storage = getStorage();
  if (!storage) return false;

  try {
    storage.removeItem(getLastSyncedAtStorageKey(scope));
    storage.removeItem(LEGACY_LAST_SYNCED_AT_STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}

export function getStoredLastSyncedAt(scope) {
  const storage = getStorage();
  if (!storage) return null;

  try {
    storage.removeItem(LEGACY_LAST_SYNCED_AT_STORAGE_KEY);
    return storage.getItem(getLastSyncedAtStorageKey(scope));
  } catch {
    return null;
  }
}

export function setStoredLastSyncedAt(scope, value) {
  const storage = getStorage();
  if (!storage) return false;

  try {
    storage.removeItem(LEGACY_LAST_SYNCED_AT_STORAGE_KEY);
    storage.setItem(getLastSyncedAtStorageKey(scope), value);
    return true;
  } catch {
    return false;
  }
}

export function buildScopeOptions(scope) {
  return { scope };
}
