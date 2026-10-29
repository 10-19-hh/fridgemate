const LEGACY_AUTH_SESSION_KEY = 'fridgemate-auth-session';
const SESSION_PRESENT_KEY = 'fridgemate-auth-session-present:v1';
const LOGOUT_PENDING_KEY = 'fridgemate-auth-logout-pending:v1';
const GUEST_IMPORT_DECISION_PREFIX = 'fridgemate-guest-import';
export const GUEST_STORAGE_SCOPE = 'guest';

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

function readStorageValue(key, fallbackValue = '') {
  const storage = getStorage();

  if (!storage) {
    return fallbackValue;
  }

  try {
    return storage.getItem(key) || fallbackValue;
  } catch {
    return fallbackValue;
  }
}

function writeStorageValue(key, value) {
  const storage = getStorage();

  if (!storage) {
    return false;
  }

  try {
    storage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

function removeStorageValue(key) {
  const storage = getStorage();

  if (!storage) {
    return false;
  }

  try {
    storage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

export function buildUserStorageScope(userId) {
  return userId ? `user:${userId}` : GUEST_STORAGE_SCOPE;
}

export function clearStoredAuthSession() {
  return removeStorageValue(LEGACY_AUTH_SESSION_KEY);
}

export function hasSessionHint() {
  return (
    readStorageValue(SESSION_PRESENT_KEY) === '1' ||
    Boolean(readStorageValue(LEGACY_AUTH_SESSION_KEY))
  );
}

export function markSessionPresent() {
  return writeStorageValue(SESSION_PRESENT_KEY, '1');
}

export function clearSessionHint() {
  return removeStorageValue(SESSION_PRESENT_KEY);
}

export function hasPendingLogout() {
  return readStorageValue(LOGOUT_PENDING_KEY) === '1';
}

export function markLogoutPending() {
  return writeStorageValue(LOGOUT_PENDING_KEY, '1');
}

export function clearPendingLogout() {
  return removeStorageValue(LOGOUT_PENDING_KEY);
}

function getGuestImportDecisionKey(userId) {
  return `${GUEST_IMPORT_DECISION_PREFIX}:${userId}`;
}

export function getGuestImportDecision(userId) {
  if (!userId) {
    return '';
  }

  return readStorageValue(getGuestImportDecisionKey(userId));
}

export function setGuestImportDecision(userId, decision) {
  if (!userId) {
    return;
  }

  writeStorageValue(getGuestImportDecisionKey(userId), decision);
}

export function clearGuestImportDecision(userId) {
  if (!userId) {
    return true;
  }

  return removeStorageValue(getGuestImportDecisionKey(userId));
}

export function clearAccountFeatureStorage(userId) {
  const storage = getStorage();

  if (!userId) return true;
  if (!storage) return false;

  const scope = buildUserStorageScope(userId);
  const exactKeys = [
    `fridgemate-pantry-ownership:v2:${scope}`,
    `fridgemate-user-preferences:v1:${scope}`
  ];
  const prefixes = [`fridgemate-dismissed-recipes:v1:${scope}:`];
  const storedKeys = [];

  try {
    for (let index = 0; index < storage.length; index += 1) {
      const storageKey = storage.key(index);

      if (storageKey) {
        storedKeys.push(storageKey);
      }
    }
  } catch {
    return false;
  }

  const keysToRemove = new Set([
    ...exactKeys,
    ...storedKeys.filter((storageKey) => prefixes.some((prefix) => storageKey.startsWith(prefix)))
  ]);
  let cleanupComplete = true;

  keysToRemove.forEach((storageKey) => {
    try {
      storage.removeItem(storageKey);
    } catch {
      cleanupComplete = false;
    }
  });

  return cleanupComplete;
}
