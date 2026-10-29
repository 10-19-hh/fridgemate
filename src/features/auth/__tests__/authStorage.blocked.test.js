import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as authApi from '../../../api/authApi';
import { refreshStoredSession } from '../authSessionService';

vi.mock('../../../api/authApi', () => ({
  refreshSession: vi.fn(),
  logout: vi.fn()
}));

describe('session initialization with browser storage access blocked', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    // A previously persisted identity or hint must not bypass unavailable storage.
    window.localStorage.setItem('fridgemate-auth-session-present:v1', '1');
    window.localStorage.setItem('fridgemate-auth-session', JSON.stringify({ user: { id: 'old-user' } }));
    for (const storageType of ['localStorage', 'sessionStorage']) {
      vi.spyOn(window, storageType, 'get').mockImplementation(() => {
        throw new DOMException('Storage access denied', 'SecurityError');
      });
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  it.each([false, true])('settles as guest without an auth API call when backendEnabled is %s', async (backendEnabled) => {
    const setSession = vi.fn();
    const setLoading = vi.fn();
    const setError = vi.fn();

    await expect(refreshStoredSession({ backendEnabled, setSession, setLoading, setError })).resolves.toBeNull();

    expect(setSession).toHaveBeenLastCalledWith(null);
    expect(setLoading).toHaveBeenLastCalledWith(false);
    expect(authApi.refreshSession).not.toHaveBeenCalled();
    expect(authApi.logout).not.toHaveBeenCalled();
  });
});
