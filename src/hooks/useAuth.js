import { createContext, createElement, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  buildUserStorageScope,
  GUEST_STORAGE_SCOPE
} from '../features/auth/authStorage';
import {
  deleteAccountWithSession,
  loginWithSession,
  logoutSession,
  refreshStoredSession,
  signupWithSession
} from '../features/auth/authSessionService';
import {
  dismissGuestImportPrompt,
  importGuestIngredientsForUser,
  inspectGuestImportPrompt
} from '../features/auth/guestImportService';
import { isBackendEnabled } from '../utils/backendConfig';
import {
  AUTH_CHANGE_KEY, AUTH_CONTEXT_INVALIDATED_EVENT, captureAuthContext, invalidateAuthContext, isAuthContextCurrent
} from '../features/auth/authSessionContext';

const defaultGuestImportPrompt = {
  available: false,
  count: 0,
  loading: false
};

const defaultAuthContext = {
  backendEnabled: isBackendEnabled(),
  deleteAccount: async () => ({ localCleanupComplete: false }),
  dismissGuestImport: () => {},
  error: '',
  guestImportPrompt: defaultGuestImportPrompt,
  importGuestIngredients: async () => [],
  isAuthenticated: false,
  loading: false,
  login: async () => null,
  logout: async () => {},
  refreshSession: async () => null,
  signup: async () => null,
  storageScope: GUEST_STORAGE_SCOPE,
  token: '',
  user: null
};

const AuthContext = createContext(defaultAuthContext);
const inFlightSessionRefreshes = new WeakMap();

export function AuthProvider({ children }) {
  const backendEnabled = isBackendEnabled();
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(() => backendEnabled);
  const [error, setError] = useState('');
  const [guestImportPrompt, setGuestImportPrompt] = useState(defaultGuestImportPrompt);

  const user = session?.user || null;
  const token = '';
  const isAuthenticated = Boolean(user?.id);
  const storageScope = user?.id ? buildUserStorageScope(user.id) : GUEST_STORAGE_SCOPE;
  const { userId: ownerId, generation: ownerGeneration, changeToken: ownerChangeToken } = captureAuthContext();
  const actionOwner = useMemo(() => ({
    userId: ownerId, generation: ownerGeneration, changeToken: ownerChangeToken
  }), [ownerId, ownerGeneration, ownerChangeToken]);

  const refreshSession = useCallback(() => {
    const existingRefresh = inFlightSessionRefreshes.get(setSession);

    if (existingRefresh && isAuthContextCurrent(existingRefresh.context)) {
      return existingRefresh.promise;
    }

    const refreshEntry = { context: captureAuthContext(), promise: null };
    const refreshPromise = refreshStoredSession({
      backendEnabled,
      setSession,
      setLoading,
      setError
    }).finally(() => {
      if (inFlightSessionRefreshes.get(setSession) === refreshEntry) {
        inFlightSessionRefreshes.delete(setSession);
      }
    });

    refreshEntry.context = captureAuthContext();
    refreshEntry.promise = refreshPromise;
    inFlightSessionRefreshes.set(setSession, refreshEntry);
    return refreshPromise;
  }, [backendEnabled]);

  useEffect(() => {
    refreshSession();
  }, [backendEnabled, refreshSession]);

  useEffect(() => {
    const lockDisplayedSession = () => {
      setSession(null);
      setLoading(false);
      setGuestImportPrompt(defaultGuestImportPrompt);
      setError('계정 상태가 바뀌었거나 확인되지 않습니다. 현재 계정을 다시 확인해주세요.');
    };
    const handleAuthStorage = (event) => {
      try {
        if (event.storageArea !== window.localStorage) return;
      } catch {
        return;
      }
      const keys = [AUTH_CHANGE_KEY, 'fridgemate-auth-logout-pending:v1', 'fridgemate-auth-session-present:v1'];
      if (event.key !== null && !keys.includes(event.key)) return;
      if (event.oldValue === event.newValue && event.key !== null) return;
      invalidateAuthContext();
    };
    window.addEventListener('storage', handleAuthStorage);
    window.addEventListener(AUTH_CONTEXT_INVALIDATED_EVENT, lockDisplayedSession);
    return () => {
      window.removeEventListener('storage', handleAuthStorage);
      window.removeEventListener(AUTH_CONTEXT_INVALIDATED_EVENT, lockDisplayedSession);
    };
  }, []);

  useEffect(() => {
    let isMounted = true;

    inspectGuestImportPrompt({
      isAuthenticated,
      user,
      setGuestImportPrompt: (nextValue) => {
        if (isMounted) {
          setGuestImportPrompt(nextValue);
        }
      },
      defaultGuestImportPrompt
    }).catch(() => {
      if (isMounted) {
        setGuestImportPrompt(defaultGuestImportPrompt);
      }
    });

    return () => {
      isMounted = false;
    };
  }, [isAuthenticated, user]);

  const signup = useCallback(
    async (credentials) => {
      return signupWithSession(credentials, {
        backendEnabled,
        setSession,
        setLoading,
        setError
      });
    },
    [backendEnabled]
  );

  const login = useCallback(
    async (credentials) => {
      return loginWithSession(credentials, {
        backendEnabled,
        setSession,
        setLoading,
        setError
      });
    },
    [backendEnabled]
  );

  const logout = useCallback(
    async (options = {}) =>
      logoutSession({
        backendEnabled,
        clearLocalData: options?.clearLocalData === true,
        ownerContext: actionOwner,
        user,
        setSession,
        setLoading,
        setGuestImportPrompt,
        setError,
        defaultGuestImportPrompt
      }),
    [actionOwner, backendEnabled, user]
  );

  const deleteAccount = useCallback(
    async (password) =>
      deleteAccountWithSession(password, {
        backendEnabled,
        ownerContext: actionOwner,
        user,
        setSession,
        setGuestImportPrompt,
        setError,
        defaultGuestImportPrompt
      }),
    [actionOwner, backendEnabled, user]
  );

  const importGuestIngredients = useCallback(
    async () =>
      importGuestIngredientsForUser({
        backendEnabled,
        ownerContext: actionOwner,
        user,
        setGuestImportPrompt,
        setError,
        defaultGuestImportPrompt
      }),
    [actionOwner, backendEnabled, user]
  );

  const dismissGuestImport = useCallback(
    () =>
      dismissGuestImportPrompt({
        ownerContext: actionOwner,
        user,
        setGuestImportPrompt,
        defaultGuestImportPrompt
      }),
    [actionOwner, user]
  );

  const value = useMemo(
    () => ({
      backendEnabled,
      deleteAccount,
      dismissGuestImport,
      error,
      guestImportPrompt,
      importGuestIngredients,
      isAuthenticated,
      loading,
      login,
      logout,
      refreshSession,
      signup,
      storageScope,
      token,
      user
    }),
    [
      backendEnabled,
      deleteAccount,
      dismissGuestImport,
      error,
      guestImportPrompt,
      importGuestIngredients,
      isAuthenticated,
      loading,
      login,
      logout,
      refreshSession,
      signup,
      storageScope,
      token,
      user
    ]
  );

  return createElement(AuthContext.Provider, { value }, children);
}

export function useAuth() {
  return useContext(AuthContext);
}
