import { beforeEach, describe, expect, it, vi } from 'vitest';
import FDBFactory from 'fake-indexeddb/lib/FDBFactory';

const authApiMocks = {
  deleteAccount: vi.fn(),
  getCurrentUser: vi.fn(),
  login: vi.fn(),
  logout: vi.fn(),
  refreshSession: vi.fn(),
  signup: vi.fn()
};

const indexedDbMocks = {
  clearAccountLocalData: vi.fn(),
  clearIngredients: vi.fn(),
  clearMenuDecisions: vi.fn(),
  clearMealPlans: vi.fn(),
  deleteDatabase: vi.fn()
};
const scopeStateMocks = {
  clearScopeState: vi.fn()
};

vi.mock('../../../api/authApi.js', () => ({
  deleteAccount: (...args) => authApiMocks.deleteAccount(...args),
  getCurrentUser: (...args) => authApiMocks.getCurrentUser(...args),
  login: (...args) => authApiMocks.login(...args),
  logout: (...args) => authApiMocks.logout(...args),
  refreshSession: (...args) => authApiMocks.refreshSession(...args),
  signup: (...args) => authApiMocks.signup(...args)
}));

vi.mock('../../../db/indexedDB.js', () => ({
  clearAccountLocalData: (...args) => indexedDbMocks.clearAccountLocalData(...args),
  clearIngredients: (...args) => indexedDbMocks.clearIngredients(...args),
  clearMenuDecisions: (...args) => indexedDbMocks.clearMenuDecisions(...args),
  clearMealPlans: (...args) => indexedDbMocks.clearMealPlans(...args),
  deleteDatabase: (...args) => indexedDbMocks.deleteDatabase(...args)
}));

vi.mock('../../ingredients/ingredientsScopeState.js', () => ({
  clearScopeState: (...args) => scopeStateMocks.clearScopeState(...args)
}));

describe('authSessionService', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    window.localStorage.clear();
    indexedDbMocks.clearAccountLocalData.mockResolvedValue(undefined);
    indexedDbMocks.clearIngredients.mockResolvedValue(undefined);
    indexedDbMocks.clearMenuDecisions.mockResolvedValue(undefined);
    indexedDbMocks.clearMealPlans.mockResolvedValue(undefined);
    indexedDbMocks.deleteDatabase.mockResolvedValue(undefined);
    scopeStateMocks.clearScopeState.mockReturnValue(true);
  });

  it.each(['server response', 'local cleanup'])('does not clear the new account when deletion waits for %s', async (phase) => {
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const service = await import('../authSessionService.js');
    let current;
    const options = { backendEnabled: true, user: { id: 'A' }, setSession: vi.fn((value) => { current = value; }),
      setError: vi.fn(), setGuestImportPrompt: vi.fn(), defaultGuestImportPrompt: {} };
    service.persistSession({ user: { id: 'A' } }, options.setSession);
    authApiMocks.deleteAccount.mockReturnValue(phase === 'server response' ? gate : Promise.resolve());
    if (phase === 'local cleanup') indexedDbMocks.clearAccountLocalData.mockReturnValue(gate);
    const deleting = service.deleteAccountWithSession('password', options).catch((error) => error);
    if (phase === 'local cleanup') await vi.waitFor(() => expect(indexedDbMocks.clearAccountLocalData).toHaveBeenCalled());
    authApiMocks.login.mockResolvedValue({ user: { id: 'B' } });
    await service.loginWithSession({}, options);
    release();
    expect(await deleting).toMatchObject({ code: 'AUTH_CONTEXT_CHANGED' });
    expect(current).toEqual({ user: { id: 'B' } });
  });

  it('does not apply a local-only logout completion after the identity has changed during cleanup', async () => {
    let release;
    indexedDbMocks.clearAccountLocalData.mockReturnValue(new Promise((resolve) => { release = resolve; }));
    const service = await import('../authSessionService.js');
    const options = { backendEnabled: false, user: { id: 'A' }, clearLocalData: true,
      setSession: vi.fn(), setError: vi.fn(), setGuestImportPrompt: vi.fn(), defaultGuestImportPrompt: {} };
    service.persistSession({ user: { id: 'A' } }, options.setSession);
    const pending = service.logoutSession(options);
    service.persistSession({ user: { id: 'B' } }, options.setSession);
    release();
    expect(await pending).toMatchObject({ ok: false });
    expect(options.setGuestImportPrompt).not.toHaveBeenCalled();
    expect(options.setError).not.toHaveBeenCalled();
  });

  it('restores a server-verified session without persisting identity in localStorage', async () => {
    authApiMocks.refreshSession.mockResolvedValue({ user: { id: 'user-1', email: 'fresh@example.com' } });
    window.localStorage.setItem(
      'fridgemate-auth-session',
      JSON.stringify({
        user: { id: 'user-1', email: 'stale@example.com' }
      })
    );

    const { refreshStoredSession } = await import('../authSessionService.js');
    const setSession = vi.fn();
    const setLoading = vi.fn();
    const setError = vi.fn();

    const result = await refreshStoredSession({
      backendEnabled: true,
      setSession,
      setLoading,
      setError
    });

    expect(result).toEqual({
      user: { id: 'user-1', email: 'fresh@example.com' }
    });
    expect(setSession).toHaveBeenLastCalledWith(result);
    expect(setLoading).toHaveBeenCalledWith(true);
    expect(setLoading).toHaveBeenLastCalledWith(false);
    expect(setError).toHaveBeenLastCalledWith('');
    expect(window.localStorage.getItem('fridgemate-auth-session')).toBeNull();
    expect(window.localStorage.getItem('fridgemate-auth-session-present:v1')).toBe('1');
  });

  it('does not refresh when no non-PII session hint exists', async () => {
    const { refreshStoredSession } = await import('../authSessionService.js');
    const setSession = vi.fn();
    const setLoading = vi.fn();
    const setError = vi.fn();

    await expect(
      refreshStoredSession({ backendEnabled: true, setSession, setLoading, setError })
    ).resolves.toBeNull();

    expect(authApiMocks.refreshSession).not.toHaveBeenCalled();
    expect(setSession).toHaveBeenLastCalledWith(null);
  });

  it('fails closed when the server cannot verify the current session', async () => {
    authApiMocks.refreshSession.mockRejectedValue(new Error('API request could not reach the server.'));
    window.localStorage.setItem(
      'fridgemate-auth-session',
      JSON.stringify({ user: { id: 'user-1', email: 'stale@example.com' } })
    );

    const { refreshStoredSession, SESSION_VERIFICATION_FAILED_MESSAGE } = await import('../authSessionService.js');
    const setSession = vi.fn();
    const setLoading = vi.fn();
    const setError = vi.fn();

    await expect(
      refreshStoredSession({ backendEnabled: true, setSession, setLoading, setError })
    ).resolves.toBeNull();

    expect(setSession).toHaveBeenLastCalledWith(null);
    expect(setError).toHaveBeenLastCalledWith(SESSION_VERIFICATION_FAILED_MESSAGE);
    expect(window.localStorage.getItem('fridgemate-auth-session')).toBeNull();
    expect(window.localStorage.getItem('fridgemate-auth-session-present:v1')).toBeNull();
  });

  it('clears the session on authorization failure', async () => {
    const authError = new Error('Authentication required');
    authError.status = 401;
    authApiMocks.refreshSession.mockRejectedValue(authError);
    window.localStorage.setItem(
      'fridgemate-auth-session',
      JSON.stringify({
        user: { id: 'user-1', email: 'stale@example.com' }
      })
    );

    const { refreshStoredSession } = await import('../authSessionService.js');
    const setSession = vi.fn();
    const setLoading = vi.fn();
    const setError = vi.fn();

    const result = await refreshStoredSession({
      backendEnabled: true,
      setSession,
      setLoading,
      setError
    });

    expect(result).toBeNull();
    expect(setSession).toHaveBeenLastCalledWith(null);
    expect(setError).toHaveBeenLastCalledWith('Authentication required');
  });

  it('logs in and persists a new session', async () => {
    authApiMocks.login.mockResolvedValue({
      user: { id: 'user-2', email: 'login@example.com' }
    });

    const { loginWithSession } = await import('../authSessionService.js');
    const setSession = vi.fn();
    const setError = vi.fn();

    const result = await loginWithSession(
      { email: 'login@example.com', password: 'pw' },
      {
        backendEnabled: true,
        setSession,
        setError
      }
    );

    expect(result.user.email).toBe('login@example.com');
    expect(setSession).toHaveBeenCalledWith(result);
    expect(setError).toHaveBeenLastCalledWith('');
    expect(window.localStorage.getItem('fridgemate-auth-session')).toBeNull();
    expect(window.localStorage.getItem('fridgemate-auth-session-present:v1')).toBe('1');
  });

  it('locks the local session and leaves a retry fence when server logout fails', async () => {
    authApiMocks.logout.mockRejectedValue(new Error('network down'));

    const { logoutSession, LOGOUT_PENDING_MESSAGE } = await import('../authSessionService.js');
    const setSession = vi.fn();
    const setGuestImportPrompt = vi.fn();
    const setError = vi.fn();
    const defaultGuestImportPrompt = { available: false, count: 0, loading: false };

    const result = await logoutSession({
      backendEnabled: true,
      setSession,
      setGuestImportPrompt,
      setError,
      defaultGuestImportPrompt
    });

    expect(result).toEqual({ ok: false, pending: true });
    expect(setSession).toHaveBeenLastCalledWith(null);
    expect(setError).toHaveBeenLastCalledWith(LOGOUT_PENDING_MESSAGE);
    expect(window.localStorage.getItem('fridgemate-auth-logout-pending:v1')).toBe('1');
  });

  it('removes account-scoped device data during shared-device logout even when server logout is pending', async () => {
    authApiMocks.logout.mockRejectedValue(new Error('network down'));
    window.localStorage.setItem('fridgemate-pantry-ownership:v2:user:user-1', '{}');
    window.localStorage.setItem('fridgemate-import-corrections:v2:user:user-1', '{}');

    const { logoutSession, LOGOUT_PENDING_MESSAGE } = await import('../authSessionService.js');
    const setSession = vi.fn();
    const setError = vi.fn();

    const result = await logoutSession({
      backendEnabled: true,
      clearLocalData: true,
      user: { id: 'user-1' },
      setSession,
      setGuestImportPrompt: vi.fn(),
      setError,
      defaultGuestImportPrompt: {}
    });

    expect(result).toEqual({ ok: false, pending: true, localCleanupComplete: true });
    expect(setSession).toHaveBeenCalledWith(null);
    expect(indexedDbMocks.clearAccountLocalData).toHaveBeenCalledWith({ scope: 'user:user-1' });
    expect(indexedDbMocks.deleteDatabase).toHaveBeenCalledWith({ scope: 'user:user-1' });
    expect(scopeStateMocks.clearScopeState).toHaveBeenCalledWith('user:user-1');
    expect(window.localStorage.getItem('fridgemate-pantry-ownership:v2:user:user-1')).toBeNull();
    expect(window.localStorage.getItem('fridgemate-import-corrections:v2:user:user-1')).toBeNull();
    expect(setError).toHaveBeenLastCalledWith(LOGOUT_PENDING_MESSAGE);
  });

  it('reports a partial shared-device cleanup without keeping the account session open', async () => {
    authApiMocks.logout.mockResolvedValue(null);
    indexedDbMocks.deleteDatabase.mockRejectedValue(new Error('blocked'));

    const { LOCAL_DATA_CLEANUP_FAILED_MESSAGE, logoutSession } = await import('../authSessionService.js');
    const setSession = vi.fn();
    const setError = vi.fn();

    const result = await logoutSession({
      backendEnabled: true,
      clearLocalData: true,
      user: { id: 'user-1' },
      setSession,
      setGuestImportPrompt: vi.fn(),
      setError,
      defaultGuestImportPrompt: {}
    });

    expect(result).toEqual({ ok: true, pending: false, localCleanupComplete: false });
    expect(setSession).toHaveBeenCalledWith(null);
    expect(setError).toHaveBeenLastCalledWith(LOCAL_DATA_CLEANUP_FAILED_MESSAGE);
  });

  it('retries a fenced logout before any session refresh', async () => {
    window.localStorage.setItem('fridgemate-auth-logout-pending:v1', '1');
    authApiMocks.logout.mockResolvedValue(null);

    const { refreshStoredSession } = await import('../authSessionService.js');
    const setSession = vi.fn();
    const setLoading = vi.fn();
    const setError = vi.fn();

    await expect(
      refreshStoredSession({ backendEnabled: true, setSession, setLoading, setError })
    ).resolves.toBeNull();

    expect(authApiMocks.logout).toHaveBeenCalledTimes(1);
    expect(authApiMocks.refreshSession).not.toHaveBeenCalled();
    expect(setSession).toHaveBeenLastCalledWith(null);
    expect(window.localStorage.getItem('fridgemate-auth-logout-pending:v1')).toBeNull();
  });

  it('keeps a failed pending logout fenced and never refreshes the old session', async () => {
    window.localStorage.setItem('fridgemate-auth-logout-pending:v1', '1');
    authApiMocks.logout.mockRejectedValue(new Error('network down'));

    const { refreshStoredSession, LOGOUT_PENDING_MESSAGE } = await import('../authSessionService.js');
    const setSession = vi.fn();
    const setLoading = vi.fn();
    const setError = vi.fn();

    await expect(
      refreshStoredSession({ backendEnabled: true, setSession, setLoading, setError })
    ).resolves.toBeNull();

    expect(authApiMocks.refreshSession).not.toHaveBeenCalled();
    expect(setSession).toHaveBeenLastCalledWith(null);
    expect(setError).toHaveBeenLastCalledWith(LOGOUT_PENDING_MESSAGE);
    expect(window.localStorage.getItem('fridgemate-auth-logout-pending:v1')).toBe('1');
  });

  it('locks the local session even when the logout fence cannot be stored', async () => {
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Storage is unavailable.', 'SecurityError');
    });
    authApiMocks.logout.mockRejectedValue(new Error('network down'));

    try {
      const { logoutSession, LOGOUT_FAILED_MESSAGE } = await import('../authSessionService.js');
      const setSession = vi.fn();
      const setGuestImportPrompt = vi.fn();
      const setError = vi.fn();
      const defaultGuestImportPrompt = { available: false, count: 0, loading: false };

      const result = await logoutSession({
        backendEnabled: true,
        setSession,
        setGuestImportPrompt,
        setError,
        defaultGuestImportPrompt
      });

      expect(result).toEqual({ ok: false, pending: false });
      expect(setSession).toHaveBeenLastCalledWith(null);
      expect(setError).toHaveBeenLastCalledWith(LOGOUT_FAILED_MESSAGE);
    } finally {
      setItemSpy.mockRestore();
    }
  });

  it('clears the account-scoped local cache after server account deletion succeeds', async () => {
    authApiMocks.deleteAccount.mockResolvedValue(null);
    window.localStorage.setItem('fridgemate-auth-session-present:v1', '1');
    window.localStorage.setItem('fridgemate-guest-import:user-1', 'dismissed');
    window.localStorage.setItem('fridgemate-pantry-ownership:v2:user:user-1', '{}');
    window.localStorage.setItem('fridgemate-user-preferences:v1:user:user-1', '{}');
    window.localStorage.setItem('fridgemate-dismissed-recipes:v1:user:user-1:2026-08-30', '[]');
    window.localStorage.setItem('fridgemate-import-corrections:v2:user:user-1', '{}');
    window.localStorage.setItem('fridgemate-import-corrections:v2:user:user-2', '{"keep":true}');
    const { deleteAccountWithSession } = await import('../authSessionService.js');
    const setSession = vi.fn();
    const setGuestImportPrompt = vi.fn();
    const setError = vi.fn();
    const defaultGuestImportPrompt = { available: false, count: 0, loading: false };

    const result = await deleteAccountWithSession('StrongPassphrase123!', {
      backendEnabled: true,
      user: { id: 'user-1', email: 'user@example.com' },
      setSession,
      setGuestImportPrompt,
      setError,
      defaultGuestImportPrompt
    });

    expect(authApiMocks.deleteAccount).toHaveBeenCalledWith('StrongPassphrase123!');
    expect(indexedDbMocks.clearAccountLocalData).toHaveBeenCalledWith({ scope: 'user:user-1' });
    expect(indexedDbMocks.deleteDatabase).toHaveBeenCalledWith({ scope: 'user:user-1' });
    expect(scopeStateMocks.clearScopeState).toHaveBeenCalledWith('user:user-1');
    expect(window.localStorage.getItem('fridgemate-guest-import:user-1')).toBeNull();
    expect(window.localStorage.getItem('fridgemate-auth-session-present:v1')).toBeNull();
    expect(window.localStorage.getItem('fridgemate-pantry-ownership:v2:user:user-1')).toBeNull();
    expect(window.localStorage.getItem('fridgemate-user-preferences:v1:user:user-1')).toBeNull();
    expect(window.localStorage.getItem('fridgemate-dismissed-recipes:v1:user:user-1:2026-08-30')).toBeNull();
    expect(window.localStorage.getItem('fridgemate-import-corrections:v2:user:user-1')).toBeNull();
    expect(window.localStorage.getItem('fridgemate-import-corrections:v2:user:user-2')).toBe('{"keep":true}');
    expect(setSession).toHaveBeenLastCalledWith(null);
    expect(setGuestImportPrompt).toHaveBeenCalledWith(defaultGuestImportPrompt);
    expect(setError).toHaveBeenLastCalledWith('');
    expect(result).toEqual({ localCleanupComplete: true });
  });

  it('reports incomplete cleanup but still removes localStorage data when IndexedDB deletion is blocked', async () => {
    authApiMocks.deleteAccount.mockResolvedValue(null);
    indexedDbMocks.deleteDatabase.mockRejectedValue(new Error('IndexedDB deletion blocked'));
    window.localStorage.setItem('fridgemate-guest-import:user-1', 'dismissed');
    window.localStorage.setItem('fridgemate-import-corrections:v2:user:user-1', '{}');
    const { deleteAccountWithSession } = await import('../authSessionService.js');
    const setSession = vi.fn();
    const setGuestImportPrompt = vi.fn();
    const setError = vi.fn();
    const defaultGuestImportPrompt = { available: false, count: 0, loading: false };

    const result = await deleteAccountWithSession('StrongPassphrase123!', {
      backendEnabled: true,
      user: { id: 'user-1', email: 'user@example.com' },
      setSession,
      setGuestImportPrompt,
      setError,
      defaultGuestImportPrompt
    });

    expect(result).toEqual({ localCleanupComplete: false });
    expect(indexedDbMocks.clearAccountLocalData).toHaveBeenCalledWith({ scope: 'user:user-1' });
    expect(window.localStorage.getItem('fridgemate-guest-import:user-1')).toBeNull();
    expect(window.localStorage.getItem('fridgemate-import-corrections:v2:user:user-1')).toBeNull();
    expect(setSession).toHaveBeenLastCalledWith(null);
    expect(setError).toHaveBeenLastCalledWith(
      '계정은 삭제됐지만 이 기기의 로컬 캐시를 모두 지우지 못했습니다. 브라우저 사이트 데이터를 삭제해주세요.'
    );
  });

  it('continues later cleanup steps after an earlier local database cleanup fails', async () => {
    authApiMocks.deleteAccount.mockResolvedValue(null);
    indexedDbMocks.clearAccountLocalData.mockRejectedValue(new Error('clear failed'));
    window.localStorage.setItem('fridgemate-import-corrections:v2:user:user-1', '{}');
    const { deleteAccountWithSession } = await import('../authSessionService.js');
    const setSession = vi.fn();
    const setError = vi.fn();

    const result = await deleteAccountWithSession('StrongPassphrase123!', {
      backendEnabled: true,
      user: { id: 'user-1' },
      setSession,
      setGuestImportPrompt: vi.fn(),
      setError,
      defaultGuestImportPrompt: {}
    });

    expect(result).toEqual({ localCleanupComplete: false });
    expect(indexedDbMocks.clearAccountLocalData).toHaveBeenCalledWith({ scope: 'user:user-1' });
    expect(indexedDbMocks.deleteDatabase).toHaveBeenCalledWith({ scope: 'user:user-1' });
    expect(window.localStorage.getItem('fridgemate-import-corrections:v2:user:user-1')).toBeNull();
    expect(setSession).toHaveBeenLastCalledWith(null);
    expect(setError).toHaveBeenCalledWith(
      '계정은 삭제됐지만 이 기기의 로컬 캐시를 모두 지우지 못했습니다. 브라우저 사이트 데이터를 삭제해주세요.'
    );
  });

  it('keeps the local session when server account deletion is rejected', async () => {
    const deletionError = Object.assign(new Error('Current password is incorrect.'), { status: 403 });
    authApiMocks.deleteAccount.mockRejectedValue(deletionError);
    const { deleteAccountWithSession } = await import('../authSessionService.js');
    const setSession = vi.fn();

    await expect(
      deleteAccountWithSession('wrong-password', {
        backendEnabled: true,
        user: { id: 'user-1' },
        setSession,
        setGuestImportPrompt: vi.fn(),
        setError: vi.fn(),
        defaultGuestImportPrompt: {}
      })
    ).rejects.toBe(deletionError);

    expect(indexedDbMocks.clearIngredients).not.toHaveBeenCalled();
    expect(indexedDbMocks.clearMenuDecisions).not.toHaveBeenCalled();
    expect(indexedDbMocks.clearMealPlans).not.toHaveBeenCalled();
    expect(indexedDbMocks.clearAccountLocalData).not.toHaveBeenCalled();
    expect(indexedDbMocks.deleteDatabase).not.toHaveBeenCalled();
    expect(setSession).not.toHaveBeenCalled();
  });

  it('reports incomplete local cleanup rather than claiming all private data was removed', async () => {
    authApiMocks.deleteAccount.mockResolvedValue(null);
    indexedDbMocks.clearAccountLocalData.mockRejectedValueOnce(new Error('Storage unavailable'));
    const { deleteAccountWithSession } = await import('../authSessionService.js');
    const setSession = vi.fn();
    const setError = vi.fn();
    const result = await deleteAccountWithSession('password', {
      backendEnabled: true, user: { id: 'user-1' }, setSession, setError,
      setGuestImportPrompt: vi.fn(), defaultGuestImportPrompt: {}
    });
    expect(result).toEqual({ localCleanupComplete: false });
    expect(setSession).toHaveBeenLastCalledWith(null);
    expect(setError).toHaveBeenLastCalledWith(expect.stringContaining('브라우저 사이트 데이터를 삭제'));
  });

  it('preserves pilot consent and observations on ordinary logout while removing the session', async () => {
    const descriptor = Object.getOwnPropertyDescriptor(window, 'indexedDB');
    const factory = new FDBFactory();
    Object.defineProperty(window, 'indexedDB', { configurable: true, value: factory });
    const db = await vi.importActual('../../../db/indexedDB.js');
    for (const method of Object.keys(indexedDbMocks)) indexedDbMocks[method].mockImplementation(db[method]);
    const scopes = ['user:pilot-logout', 'guest'];
    try {
      expect(db.runMealPlanPilotTransaction).toBeTypeOf('function');
      for (const scope of scopes) {
        await db.runMealPlanPilotTransaction('readwrite', store => store.put({ id: 'session', scope,
          consent: true, privateObservations: ['local fixture'] }), scope);
        await db.saveIngredient({ id: 'stock', name: '보존할 재료' }, scope);
      }
      const before = await Promise.all(scopes.map(async scope => ({
        pilot: await db.runMealPlanPilotTransaction('readonly', store => store.getAll(), scope),
        ingredients: await db.getAllIngredients(scope),
      })));
      window.localStorage.setItem('fridgemate-auth-session-present:v1', '1');
      const service = await import('../authSessionService.js');
      const setSession = vi.fn();
      const result = await service.logoutSession({ backendEnabled: false, user: { id: 'pilot-logout' },
        setSession, setError: vi.fn(), setGuestImportPrompt: vi.fn(), defaultGuestImportPrompt: {} });
      expect(result).toEqual({ ok: true, pending: false });
      expect(setSession).toHaveBeenLastCalledWith(null);
      expect(window.localStorage.getItem('fridgemate-auth-session-present:v1')).toBeNull();
      expect(await Promise.all(scopes.map(async scope => ({
        pilot: await db.runMealPlanPilotTransaction('readonly', store => store.getAll(), scope),
        ingredients: await db.getAllIngredients(scope),
      })))).toStrictEqual(before);
    } finally {
      for (const scope of scopes) await db.deleteDatabase(scope);
      if (descriptor) Object.defineProperty(window, 'indexedDB', descriptor);
      else delete window.indexedDB;
    }
  });

  it.each(['account deletion', 'shared-device logout'])(
    'erases private stores during %s despite a corrupt quantity review and a blocked database deletion',
    async (operation) => {
      const descriptor = Object.getOwnPropertyDescriptor(window, 'indexedDB');
      const factory = new FDBFactory();
      Object.defineProperty(window, 'indexedDB', { configurable: true, value: factory });
      const db = await vi.importActual('../../../db/indexedDB.js');
      expect(db.runShoppingTransaction).toBeTypeOf('function');
      for (const method of Object.keys(indexedDbMocks)) indexedDbMocks[method].mockImplementation(db[method]);
      const scopes = ['user:cleanup-target', 'guest', 'user:cleanup-other'];
      let blocker;
      try {
        expect(db.runMealPlanPilotTransaction).toBeTypeOf('function');
        for (const scope of scopes) {
          await db.saveIngredient({ id: 'private-stock', name: '개인 재고', quantity: '반 모' }, scope);
          await db.saveMenuDecision({ decisionDate: '2026-09-15', memo: '개인 메뉴' }, scope);
          await db.runMealPlanTransaction('readwrite', (store) => store.put({ id: 'week:2026-09-14', title: '개인 식단' }), scope);
          await db.runShoppingTransaction('readwrite', (store) => store.put({
            id: 'purchase:private', schemaVersion: 99, scope, memo: '개인 구매 메모'
          }), scope);
          await db.runInventoryReceiptTransaction('readwrite', ({ events }) => events.put({
            id: 'receipt:private', schemaVersion: 99, scope, memo: '개인 입고 이력'
          }), scope);
          await db.runMealPlanPilotTransaction('readwrite', store => store.put({
            id: 'session', schemaVersion: 99, scope, memo: '개인 파일럿 기록'
          }), scope);
        }
        await db.runInventoryQuantityTransaction('readwrite', ({ quantities }) => quantities.put({
          id: 'private-stock', scope: 'user:cleanup-target', schemaVersion: 99,
          revision: 7, status: 'verified', sourceToken: 'private fixture source',
        }), 'user:cleanup-target');
        const guestBefore = await db.readMealPlanningSnapshot('guest');
        const otherBefore = await db.readMealPlanningSnapshot('user:cleanup-other');
        const guestShoppingBefore = await db.runShoppingTransaction('readonly', (store) => store.getAll(), 'guest');
        const otherShoppingBefore = await db.runShoppingTransaction('readonly', (store) => store.getAll(), 'user:cleanup-other');
        const guestEventsBefore = await db.runInventoryReceiptTransaction('readonly', ({ events }) => events.getAll(), 'guest');
        const otherEventsBefore = await db.runInventoryReceiptTransaction('readonly', ({ events }) => events.getAll(), 'user:cleanup-other');
        const guestPilotBefore = await db.runMealPlanPilotTransaction('readonly', store => store.getAll(), 'guest');
        const otherPilotBefore = await db.runMealPlanPilotTransaction('readonly', store => store.getAll(), 'user:cleanup-other');
        blocker = await new Promise((resolve, reject) => {
          const request = factory.open('fridgemate-db__user_cleanup-target');
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        blocker.onversionchange = () => {};
        window.localStorage.setItem('fridgemate-auth-session-present:v1', '1');
        window.localStorage.setItem('fridgemate-import-corrections:v2:user:cleanup-target', '{}');
        const service = await import('../authSessionService.js');
        const setSession = vi.fn();
        const setError = vi.fn();
        const options = { backendEnabled: true, user: { id: 'cleanup-target' }, setSession, setError,
          setGuestImportPrompt: vi.fn(), defaultGuestImportPrompt: {} };
        let result;
        if (operation === 'account deletion') {
          authApiMocks.deleteAccount.mockResolvedValue(null);
          result = await service.deleteAccountWithSession('test-password', options);
          expect(result).toEqual({ localCleanupComplete: false });
          expect(setError).toHaveBeenLastCalledWith(expect.stringContaining('계정은 삭제됐지만'));
        } else {
          authApiMocks.logout.mockRejectedValue(new Error('simulated offline logout'));
          result = await service.logoutSession({ ...options, clearLocalData: true });
          expect(result).toEqual({ ok: false, pending: true, localCleanupComplete: false });
          expect(setError).toHaveBeenLastCalledWith(expect.stringContaining(service.LOGOUT_PENDING_MESSAGE));
          expect(setError).toHaveBeenLastCalledWith(expect.stringContaining(service.LOCAL_DATA_CLEANUP_FAILED_MESSAGE));
          expect(window.localStorage.getItem('fridgemate-auth-logout-pending:v1')).toBe('1');
        }
        expect(setSession).toHaveBeenLastCalledWith(null);
        expect(window.localStorage.getItem('fridgemate-auth-session-present:v1')).toBeNull();
        expect(window.localStorage.getItem('fridgemate-import-corrections:v2:user:cleanup-target')).toBeNull();
        const remaining = await new Promise((resolve, reject) => {
          const transaction = blocker.transaction(['ingredients', 'menuDecisions', 'mealPlans', 'inventoryQuantities', 'shoppingEntries', 'inventoryEvents', 'mealPlanPilot']);
          const requests = ['ingredients', 'menuDecisions', 'mealPlans', 'inventoryQuantities', 'shoppingEntries', 'inventoryEvents', 'mealPlanPilot']
            .map((store) => transaction.objectStore(store).getAll());
          transaction.oncomplete = () => resolve(requests.map((request) => request.result));
          transaction.onerror = () => reject(transaction.error);
        });
        expect(remaining).toEqual([[], [], [], [], [], [], []]);
        expect(await db.readMealPlanningSnapshot('guest')).toEqual(guestBefore);
        expect(await db.readMealPlanningSnapshot('user:cleanup-other')).toEqual(otherBefore);
        expect(await db.runShoppingTransaction('readonly', (store) => store.getAll(), 'guest')).toEqual(guestShoppingBefore);
        expect(await db.runShoppingTransaction('readonly', (store) => store.getAll(), 'user:cleanup-other')).toEqual(otherShoppingBefore);
        expect(await db.runInventoryReceiptTransaction('readonly', ({ events }) => events.getAll(), 'guest')).toEqual(guestEventsBefore);
        expect(await db.runInventoryReceiptTransaction('readonly', ({ events }) => events.getAll(), 'user:cleanup-other')).toEqual(otherEventsBefore);
        expect(await db.runMealPlanPilotTransaction('readonly', store => store.getAll(), 'guest')).toEqual(guestPilotBefore);
        expect(await db.runMealPlanPilotTransaction('readonly', store => store.getAll(), 'user:cleanup-other')).toEqual(otherPilotBefore);
        expect(await db.getMenuDecision('2026-09-15', 'guest')).toEqual({ decisionDate: '2026-09-15', memo: '개인 메뉴' });
        expect(await db.getMenuDecision('2026-09-15', 'user:cleanup-other')).toEqual({ decisionDate: '2026-09-15', memo: '개인 메뉴' });
      } finally {
        blocker?.close();
        for (const scope of scopes) await db.deleteDatabase(scope);
        if (descriptor) Object.defineProperty(window, 'indexedDB', descriptor);
        else delete window.indexedDB;
      }
    }
  );
});
