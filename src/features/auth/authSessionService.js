import * as authApi from '../../api/authApi';
import * as indexedDb from '../../db/indexedDB';
import { clearScopeState } from '../ingredients/ingredientsScopeState';
import { clearImportCorrections } from '../../utils/import/importLearning';
import {
  assertAuthActionOwner, beginAuthChange, beginAuthVerification, captureAuthContext, createAuthContextChangedError, finishAuthChange,
  isAuthContextCurrent, updateAuthIdentity
} from './authSessionContext';
import {
  buildUserStorageScope,
  clearGuestImportDecision,
  clearAccountFeatureStorage,
  clearPendingLogout,
  clearSessionHint,
  clearStoredAuthSession,
  hasPendingLogout,
  hasSessionHint,
  markLogoutPending,
  markSessionPresent
} from './authStorage';

export const SESSION_VERIFICATION_FAILED_MESSAGE =
  '서버에서 세션을 확인하지 못해 안전을 위해 로그아웃했습니다. 연결을 확인한 뒤 다시 로그인해주세요.';
export const LOGOUT_PENDING_MESSAGE =
  '이 기기에서는 로그아웃했지만 서버 처리 결과를 확인하지 못했습니다. 연결이 복구되면 로그아웃 상태를 다시 확인합니다.';
export const LOGOUT_FAILED_MESSAGE =
  '이 기기 화면에서는 로그아웃했지만 서버 처리와 재시도 상태를 확인하지 못했습니다. 브라우저를 닫고 연결 복구 후 다시 로그인해주세요.';
export const LOCAL_DATA_CLEANUP_FAILED_MESSAGE =
  '이 기기의 계정 데이터 일부를 지우지 못했습니다. 이 브라우저의 FridgeMate 사이트 데이터를 직접 삭제해주세요.';

export function createUnavailableAuthError() {
  return new Error('Authentication is unavailable while the app is running in local-only mode.');
}

export function isAuthorizationError(error) {
  return error?.status === 401 || error?.status === 403;
}

export function persistSession(nextSession, setSession) {
  updateAuthIdentity(nextSession?.user?.id);
  clearStoredAuthSession();

  if (nextSession?.user?.id) {
    markSessionPresent();
    setSession(nextSession);
    return;
  }

  clearSessionHint();
  setSession(null);
}

export async function refreshStoredSession({ backendEnabled, setSession, setLoading, setError }) {
  let operation = beginAuthVerification();
  if (operation.transitioning) return null;
  const persistOwnedSession = (nextSession) => {
    persistSession(nextSession, setSession);
    operation = captureAuthContext();
  };
  if (!backendEnabled) {
    persistOwnedSession(null);
    setLoading(false);
    return null;
  }

  setLoading(true);

  try {
    if (hasPendingLogout()) {
      persistOwnedSession(null);

      try {
        await authApi.logout();
        if (!isAuthContextCurrent(operation)) return null;
        clearPendingLogout();
        setError('');
      } catch {
        if (!isAuthContextCurrent(operation)) return null;
        setError(LOGOUT_PENDING_MESSAGE);
      }

      return null;
    }

    if (!hasSessionHint()) {
      persistOwnedSession(null);
      setError('');
      return null;
    }

    const nextSession = await authApi.refreshSession();
    if (!isAuthContextCurrent(operation)) return null;
    if (!nextSession?.user?.id || (operation.userId && nextSession.user.id !== operation.userId)) {
      throw new Error(SESSION_VERIFICATION_FAILED_MESSAGE);
    }

    persistOwnedSession(nextSession);
    setError('');
    return nextSession;
  } catch (nextError) {
    if (!isAuthContextCurrent(operation)) return null;
    persistOwnedSession(null);

    if (isAuthorizationError(nextError)) {
      setError(nextError.message || 'Your session expired. Please log in again.');
      return null;
    }

    setError(SESSION_VERIFICATION_FAILED_MESSAGE);
    return null;
  } finally {
    if (isAuthContextCurrent(operation)) setLoading(false);
  }
}

export async function signupWithSession(credentials, { backendEnabled, setSession, setError, setLoading }) {
  if (!backendEnabled) {
    throw createUnavailableAuthError();
  }

  const operation = beginAuthChange();
  setLoading?.(false);
  try {
    const nextSession = await authApi.signup(credentials);
    if (!isAuthContextCurrent(operation)) throw createAuthContextChangedError();
    clearPendingLogout();
    persistSession(nextSession, setSession);
    finishAuthChange(captureAuthContext());
    setError('');
    return nextSession;
  } finally {
    finishAuthChange(operation);
  }
}

export async function loginWithSession(credentials, { backendEnabled, setSession, setError, setLoading }) {
  if (!backendEnabled) {
    throw createUnavailableAuthError();
  }

  const operation = beginAuthChange();
  setLoading?.(false);
  try {
    const nextSession = await authApi.login(credentials);
    if (!isAuthContextCurrent(operation)) throw createAuthContextChangedError();
    clearPendingLogout();
    persistSession(nextSession, setSession);
    finishAuthChange(captureAuthContext());
    setError('');
    return nextSession;
  } finally {
    finishAuthChange(operation);
  }
}

export async function clearLocalUserData(userId) {
  if (!userId) {
    return false;
  }

  let localCleanupComplete = true;
  const storageScope = buildUserStorageScope(userId);

  for (const cleanupDatabase of [
    () => indexedDb.clearAccountLocalData({ scope: storageScope }),
    () => indexedDb.deleteDatabase({ scope: storageScope })
  ]) {
    try {
      await cleanupDatabase();
    } catch {
      localCleanupComplete = false;
    }
  }

  [
    () => clearGuestImportDecision(userId),
    () => clearAccountFeatureStorage(userId),
    () => clearImportCorrections(storageScope),
    () => clearScopeState(storageScope)
  ].forEach((cleanupStorage) => {
    try {
      if (cleanupStorage() === false) {
        localCleanupComplete = false;
      }
    } catch {
      localCleanupComplete = false;
    }
  });

  return localCleanupComplete;
}

function buildLogoutResult(ok, pending, clearLocalData, localCleanupComplete) {
  if (!clearLocalData) {
    return { ok, pending };
  }

  return { ok, pending, localCleanupComplete };
}

function buildLogoutError(baseMessage, clearLocalData, localCleanupComplete) {
  if (!clearLocalData || localCleanupComplete) {
    return baseMessage;
  }

  return [baseMessage, LOCAL_DATA_CLEANUP_FAILED_MESSAGE].filter(Boolean).join(' ');
}

export async function logoutSession({
  backendEnabled,
  clearLocalData = false,
  user,
  setSession,
  setGuestImportPrompt,
  setError,
  setLoading,
  ownerContext = captureAuthContext(),
  defaultGuestImportPrompt
}) {
  assertAuthActionOwner(ownerContext);
  beginAuthChange();
  setLoading?.(false);
  if (!backendEnabled) {
    clearPendingLogout();
    persistSession(null, setSession);
    const operation = captureAuthContext();
    const localCleanupComplete = clearLocalData ? await clearLocalUserData(user?.id) : true;
    if (!isAuthContextCurrent(operation)) return buildLogoutResult(false, false, clearLocalData, localCleanupComplete);
    finishAuthChange(operation);
    setGuestImportPrompt(defaultGuestImportPrompt);
    setError(buildLogoutError('', clearLocalData, localCleanupComplete));
    return buildLogoutResult(true, false, clearLocalData, localCleanupComplete);
  }

  const logoutFenced = markLogoutPending();
  persistSession(null, setSession);
  const operation = captureAuthContext();
  const localCleanupComplete = clearLocalData ? await clearLocalUserData(user?.id) : true;
  if (!isAuthContextCurrent(operation)) return buildLogoutResult(false, false, clearLocalData, localCleanupComplete);

  try {
    await authApi.logout();
    if (!isAuthContextCurrent(operation)) return buildLogoutResult(false, false, clearLocalData, localCleanupComplete);
    clearPendingLogout();
    persistSession(null, setSession);
    setGuestImportPrompt(defaultGuestImportPrompt);
    setError(buildLogoutError('', clearLocalData, localCleanupComplete));
    return buildLogoutResult(true, false, clearLocalData, localCleanupComplete);
  } catch {
    if (!isAuthContextCurrent(operation)) return buildLogoutResult(false, false, clearLocalData, localCleanupComplete);
    setGuestImportPrompt(defaultGuestImportPrompt);

    if (logoutFenced) {
      setError(buildLogoutError(LOGOUT_PENDING_MESSAGE, clearLocalData, localCleanupComplete));
      return buildLogoutResult(false, true, clearLocalData, localCleanupComplete);
    }

    setError(buildLogoutError(LOGOUT_FAILED_MESSAGE, clearLocalData, localCleanupComplete));
    return buildLogoutResult(false, false, clearLocalData, localCleanupComplete);
  } finally {
    finishAuthChange(operation);
  }
}

export async function deleteAccountWithSession(
  password,
  {
    backendEnabled,
    user,
    setSession,
    setGuestImportPrompt,
    setError,
    ownerContext = captureAuthContext(),
    defaultGuestImportPrompt
  }
) {
  assertAuthActionOwner(ownerContext);
  if (!backendEnabled || !user?.id) {
    throw createUnavailableAuthError();
  }

  const operation = captureAuthContext();
  await authApi.deleteAccount(password);
  if (!isAuthContextCurrent(operation)) throw createAuthContextChangedError();

  const localCleanupComplete = await clearLocalUserData(user.id);
  if (!isAuthContextCurrent(operation)) throw createAuthContextChangedError();

  clearPendingLogout();
  persistSession(null, setSession);
  setGuestImportPrompt(defaultGuestImportPrompt);
  setError(
    localCleanupComplete
      ? ''
      : '계정은 삭제됐지만 이 기기의 로컬 캐시를 모두 지우지 못했습니다. 브라우저 사이트 데이터를 삭제해주세요.'
  );

  return { localCleanupComplete };
}
