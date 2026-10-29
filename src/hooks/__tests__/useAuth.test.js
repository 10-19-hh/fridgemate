import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const authApiMocks = {
  signup: vi.fn(),
  deleteAccount: vi.fn(),
  login: vi.fn(),
  refreshSession: vi.fn(),
  logout: vi.fn()
};

const ingredientsApiMocks = {
  saveIngredients: vi.fn()
};

const dbMocks = {
  getAllIngredients: vi.fn(),
  replaceIngredients: vi.fn(),
  clearAccountLocalData: vi.fn(),
  deleteDatabase: vi.fn()
};

vi.mock('../../api/authApi.js', () => ({
  signup: (...args) => authApiMocks.signup(...args),
  deleteAccount: (...args) => authApiMocks.deleteAccount(...args),
  login: (...args) => authApiMocks.login(...args),
  refreshSession: (...args) => authApiMocks.refreshSession(...args),
  logout: (...args) => authApiMocks.logout(...args)
}));

vi.mock('../../api/ingredientsApi.js', () => ({
  saveIngredients: (...args) => ingredientsApiMocks.saveIngredients(...args)
}));

vi.mock('../../db/indexedDB.js', () => ({
  getAllIngredients: (...args) => dbMocks.getAllIngredients(...args),
  replaceIngredients: (...args) => dbMocks.replaceIngredients(...args),
  clearAccountLocalData: (...args) => dbMocks.clearAccountLocalData(...args),
  deleteDatabase: (...args) => dbMocks.deleteDatabase(...args)
}));

vi.mock('../../utils/backendConfig.js', () => ({
  apiBaseUrl: 'https://api.example.com',
  isBackendEnabled: () => true,
  getPreferredDataSource: () => 'api'
}));

async function renderUseAuth() {
  vi.resetModules();
  const { AuthProvider, useAuth } = await import('../useAuth.js');
  const wrapper = ({ children }) => createElement(AuthProvider, null, children);
  return renderHook(() => useAuth(), { wrapper });
}

describe('useAuth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    authApiMocks.signup.mockResolvedValue({
      user: { id: 'user-1', email: 'signup@example.com' }
    });
    authApiMocks.login.mockResolvedValue({
      user: { id: 'user-1', email: 'login@example.com' }
    });
    authApiMocks.refreshSession.mockResolvedValue({
      user: {
        id: 'user-1',
        email: 'restored@example.com'
      }
    });
    authApiMocks.logout.mockResolvedValue(null);
    authApiMocks.deleteAccount.mockResolvedValue(null);
    ingredientsApiMocks.saveIngredients.mockResolvedValue([]);
    dbMocks.getAllIngredients.mockResolvedValue([]);
    dbMocks.replaceIngredients.mockResolvedValue(undefined);
    dbMocks.clearAccountLocalData.mockResolvedValue(undefined);
    dbMocks.deleteDatabase.mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    window.localStorage.clear();
  });

  it('ignores a legacy stored identity and restores only the server-verified user', async () => {
    window.localStorage.setItem(
      'fridgemate-auth-session',
      JSON.stringify({
        user: { id: 'user-1', email: 'stale@example.com' }
      })
    );

    const { result } = await renderUseAuth();

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(authApiMocks.refreshSession).toHaveBeenCalledTimes(1);
    expect(result.current.isAuthenticated).toBe(true);
    expect(result.current.user.email).toBe('restored@example.com');
    expect(result.current.storageScope).toBe('user:user-1');
    expect(window.localStorage.getItem('fridgemate-auth-session')).toBeNull();
  });

  it('keeps identity and user storage locked while server verification is pending', async () => {
    let verifySession;
    authApiMocks.refreshSession.mockReturnValue(
      new Promise((resolve) => {
        verifySession = resolve;
      })
    );
    window.localStorage.setItem(
      'fridgemate-auth-session',
      JSON.stringify({ user: { id: 'user-1', email: 'stale@example.com' } })
    );

    const { result } = await renderUseAuth();

    expect(result.current.loading).toBe(true);
    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.user).toBeNull();
    expect(result.current.storageScope).toBe('guest');

    verifySession({ user: { id: 'user-1', email: 'verified@example.com' } });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.user.email).toBe('verified@example.com');
  });

  it('locks the user scope when restoring fails because the server is temporarily unavailable', async () => {
    authApiMocks.refreshSession.mockRejectedValue(new Error('API request could not reach the server.'));
    window.localStorage.setItem(
      'fridgemate-auth-session',
      JSON.stringify({
        user: { id: 'user-1', email: 'stale@example.com' }
      })
    );

    const { result } = await renderUseAuth();

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.user).toBeNull();
    expect(result.current.storageScope).toBe('guest');
    expect(result.current.error).toContain('안전을 위해 로그아웃했습니다');
    expect(window.localStorage.getItem('fridgemate-auth-session')).toBeNull();
  });

  it('clears the stored session when restoring fails with an authorization error', async () => {
    const authError = new Error('Authentication is required.');
    authError.status = 401;
    authApiMocks.refreshSession.mockRejectedValue(authError);
    window.localStorage.setItem(
      'fridgemate-auth-session',
      JSON.stringify({
        user: { id: 'user-1', email: 'stale@example.com' }
      })
    );

    const { result } = await renderUseAuth();

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.isAuthenticated).toBe(false);
    expect(window.localStorage.getItem('fridgemate-auth-session')).toBeNull();
  });

  it('clears the session on logout', async () => {
    const { result } = await renderUseAuth();

    await act(async () => {
      await result.current.login({
        email: 'login@example.com',
        password: 'password123'
      });
    });

    expect(result.current.isAuthenticated).toBe(true);

    await act(async () => {
      await result.current.logout();
    });

    expect(result.current.isAuthenticated).toBe(false);
    expect(window.localStorage.getItem('fridgemate-auth-session')).toBeNull();
    expect(window.localStorage.getItem('fridgemate-auth-logout-pending:v1')).toBeNull();
  });

  it('stays locally logged out and exposes an error when server logout fails', async () => {
    authApiMocks.logout.mockRejectedValue(new Error('API request could not reach the server.'));
    const { result } = await renderUseAuth();

    await act(async () => {
      await result.current.login({
        email: 'login@example.com',
        password: 'password123'
      });
    });

    await act(async () => {
      await result.current.logout();
    });

    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.storageScope).toBe('guest');
    expect(result.current.error).toContain('로그아웃 상태를 다시 확인합니다');
    expect(window.localStorage.getItem('fridgemate-auth-logout-pending:v1')).toBe('1');
  });

  it('exposes a guest import prompt when guest ingredients exist', async () => {
    authApiMocks.refreshSession.mockResolvedValue({
      user: {
        id: 'user-1',
        email: 'restored@example.com'
      }
    });
    dbMocks.getAllIngredients.mockResolvedValue([{ id: 'guest-1', name: 'guest-ingredient' }]);

    window.localStorage.setItem(
      'fridgemate-auth-session',
      JSON.stringify({
        user: { id: 'user-1', email: 'stale@example.com' }
      })
    );

    const { result } = await renderUseAuth();

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await waitFor(() => {
      expect(result.current.guestImportPrompt.available).toBe(true);
    });

    expect(result.current.guestImportPrompt.count).toBe(1);
  });

  it.each([
    ['fridgemate-auth-change:v1', 'another-tab-generation'],
    ['fridgemate-auth-logout-pending:v1', '1'],
    ['fridgemate-auth-session-present:v1', null]
  ])('locks the old local identity when another tab changes %s', async (key, newValue) => {
    const { result } = await renderUseAuth();
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => { await result.current.login({ email: 'login@example.com', password: 'pw' }); });
    expect(result.current.isAuthenticated).toBe(true);
    await act(async () => {
      if (newValue === null) window.localStorage.removeItem(key);
      else window.localStorage.setItem(key, newValue);
      window.dispatchEvent(new StorageEvent('storage', {
        key, oldValue: newValue === null ? '1' : null, newValue, storageArea: window.localStorage
      }));
    });
    expect(result.current.storageScope).toBe('guest');
    expect(result.current.user).toBeNull();
    expect(result.current.loading).toBe(false);
    expect(authApiMocks.logout).not.toHaveBeenCalled();
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ saved: true }) });
    vi.stubGlobal('fetch', fetchMock);
    const { requestJson } = await import('../../api/apiClient.js');
    await expect(requestJson('/user-preferences', { method: 'PUT' }, { authMode: 'required' }))
      .rejects.toMatchObject({ code: 'AUTH_CONTEXT_CHANGED' });
    expect(fetchMock).not.toHaveBeenCalled();

    if (key === 'fridgemate-auth-change:v1') {
      authApiMocks.refreshSession.mockResolvedValue({ user: { id: 'user-2' } });
      await act(async () => { await result.current.refreshSession(); });
      expect(result.current.storageScope).toBe('user:user-2');
    }
  });

  it('does not treat another storage area as a shared authentication change', async () => {
    const { result } = await renderUseAuth();
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => { await result.current.login({}); });
    await act(async () => {
      window.dispatchEvent(new StorageEvent('storage', { key: 'fridgemate-auth-change:v1',
        newValue: 'session-only', storageArea: window.sessionStorage }));
    });
    expect(result.current.storageScope).toBe('user:user-1');
  });

  it('locks the displayed account when automatic refresh returns another account', async () => {
    const { result } = await renderUseAuth();
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => { await result.current.login({}); });
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({ message: 'expired' }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ user: { id: 'user-2' } }) }));
    const { requestJson } = await import('../../api/apiClient.js');
    await act(async () => {
      await expect(requestJson('/user-preferences', { method: 'PUT' }, { authMode: 'required' }))
        .rejects.toMatchObject({ status: 401, message: 'expired' });
    });
    expect(result.current.storageScope).toBe('guest');
    expect(result.current.user).toBeNull();
  });

  it('stops initial loading on logout and ignores the late initial restoration', async () => {
    let finish;
    authApiMocks.refreshSession.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    window.localStorage.setItem('fridgemate-auth-session-present:v1', '1');
    const { result } = await renderUseAuth();
    expect(result.current.loading).toBe(true);
    await act(async () => { await result.current.logout(); });
    expect(result.current.loading).toBe(false);
    await act(async () => { finish({ user: { id: 'user-1' } }); });
    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.storageScope).toBe('guest');
  });

  it.each([
    ['logout', 'user-2'], ['logout', 'user-1'],
    ['deleteAccount', 'user-2'], ['deleteAccount', 'user-1'],
    ['importGuestIngredients', 'user-2'], ['importGuestIngredients', 'user-1'],
    ['dismissGuestImport', 'user-2'], ['dismissGuestImport', 'user-1']
  ])('rejects a retained %s callback before any request or cleanup after logging back in as %s', async (action, nextUserId) => {
    const { result } = await renderUseAuth();
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => { await result.current.login({}); });
    const retained = result.current[action];
    await act(async () => { await result.current.logout(); });
    authApiMocks.login.mockResolvedValue({ user: { id: nextUserId } });
    await act(async () => { await result.current.login({}); });
    vi.clearAllMocks();
    dbMocks.getAllIngredients.mockResolvedValue([{ id: 'guest-1', name: 'kimchi' }]);
    let outcome;
    await act(async () => {
      outcome = await Promise.resolve().then(() => retained(action === 'logout' ? { clearLocalData: true } : 'password')).catch(error => error);
    });
    expect(outcome).toMatchObject({ code: 'AUTH_CONTEXT_CHANGED' });
    expect(result.current.storageScope).toBe(`user:${nextUserId}`);
    expect(authApiMocks.logout).not.toHaveBeenCalled();
    expect(authApiMocks.deleteAccount).not.toHaveBeenCalled();
    expect(dbMocks.clearAccountLocalData).not.toHaveBeenCalled();
    expect(dbMocks.deleteDatabase).not.toHaveBeenCalled();
    expect(dbMocks.getAllIngredients).not.toHaveBeenCalled();
    expect(dbMocks.replaceIngredients).not.toHaveBeenCalled();
    expect(window.localStorage.getItem('fridgemate-guest-import:user-1')).toBeNull();
  });

  it('keeps a retained logout callback valid through an ordinary same-account refresh', async () => {
    const { result } = await renderUseAuth();
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => { await result.current.login({}); });
    const retained = result.current.logout;
    await act(async () => { await result.current.refreshSession(); });
    await act(async () => { await retained(); });
    expect(authApiMocks.logout).toHaveBeenCalledTimes(1);
    expect(result.current.storageScope).toBe('guest');
  });
});
