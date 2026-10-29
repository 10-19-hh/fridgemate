import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ login: vi.fn(), signup: vi.fn(), logout: vi.fn(), refreshSession: vi.fn() }));
vi.mock('../../../api/authApi.js', () => api);

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

describe('auth session operation ownership', () => {
  let service;
  let current;
  let options;
  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    window.localStorage.clear();
    service = await import('../authSessionService.js');
    current = null;
    options = { backendEnabled: true, setSession: vi.fn((value) => { current = value; }),
      setLoading: vi.fn(), setError: vi.fn(), setGuestImportPrompt: vi.fn(), defaultGuestImportPrompt: {} };
    service.persistSession({ user: { id: 'A' } }, options.setSession);
    api.logout.mockResolvedValue(null);
  });
  afterEach(() => window.localStorage.clear());

  it('does not restore A from a refresh that finishes after logout', async () => {
    const refresh = deferred();
    api.refreshSession.mockReturnValue(refresh.promise);
    const pending = service.refreshStoredSession(options);
    await service.logoutSession({ ...options, user: { id: 'A' } });
    refresh.resolve({ user: { id: 'A' } });
    expect(await pending).toBeNull();
    expect(current).toBeNull();
    expect(window.localStorage.getItem('fridgemate-auth-session-present:v1')).toBeNull();
  });

  it.each(['success', 'failure'])('ignores an old refresh %s after B logs in', async (outcome) => {
    const refresh = deferred();
    api.refreshSession.mockReturnValue(refresh.promise);
    const pending = service.refreshStoredSession(options);
    api.login.mockResolvedValue({ user: { id: 'B' } });
    await service.loginWithSession({}, options);
    options.setSession.mockClear();
    options.setError.mockClear();
    options.setLoading.mockClear();
    if (outcome === 'success') refresh.resolve({ user: { id: 'A' } });
    else refresh.reject(new Error('old network failure'));
    expect(await pending).toBeNull();
    expect(current).toEqual({ user: { id: 'B' } });
    expect(options.setSession).not.toHaveBeenCalled();
    expect(options.setError).not.toHaveBeenCalled();
    expect(options.setLoading).not.toHaveBeenCalled();
    expect(window.localStorage.getItem('fridgemate-auth-session-present:v1')).toBe('1');
  });

  it('does not let an older login override the newer login', async () => {
    const oldLogin = deferred();
    api.login.mockReturnValueOnce(oldLogin.promise).mockResolvedValueOnce({ user: { id: 'B' } });
    const pending = service.loginWithSession({}, options).catch((error) => error);
    await service.loginWithSession({}, options);
    oldLogin.resolve({ user: { id: 'A' } });
    expect(await pending).toMatchObject({ code: 'AUTH_CONTEXT_CHANGED' });
    expect(current).toEqual({ user: { id: 'B' } });
  });

  it('does not let a slow logout completion clear the next login', async () => {
    const logout = deferred();
    api.logout.mockReturnValue(logout.promise);
    const pending = service.logoutSession({ ...options, user: { id: 'A' } });
    api.login.mockResolvedValue({ user: { id: 'B' } });
    await service.loginWithSession({}, options);
    options.setError.mockClear();
    logout.resolve(null);
    await pending;
    expect(current).toEqual({ user: { id: 'B' } });
    expect(options.setError).not.toHaveBeenCalled();
    expect(window.localStorage.getItem('fridgemate-auth-session-present:v1')).toBe('1');
  });

  it('rejects a known-account refresh that returns a different account', async () => {
    api.refreshSession.mockResolvedValue({ user: { id: 'B' } });
    expect(await service.refreshStoredSession(options)).toBeNull();
    expect(current).toBeNull();
    expect(options.setError).toHaveBeenCalledWith(expect.stringMatching(/세션|계정/));
  });

  it('allows the first server-verified restoration when there is no known identity', async () => {
    service.persistSession(null, options.setSession);
    window.localStorage.setItem('fridgemate-auth-session-present:v1', '1');
    api.refreshSession.mockResolvedValue({ user: { id: 'A' } });
    expect(await service.refreshStoredSession(options)).toEqual({ user: { id: 'A' } });
    expect(current).toEqual({ user: { id: 'A' } });
    expect(options.setLoading).toHaveBeenLastCalledWith(false);
  });

  it('does not start an automatic restoration while a new login is pending', async () => {
    const login = deferred();
    api.login.mockReturnValue(login.promise);
    api.refreshSession.mockResolvedValue({ user: { id: 'A' } });
    const pending = service.loginWithSession({}, options).catch((error) => error);
    const restored = await service.refreshStoredSession(options);
    login.resolve({ user: { id: 'B' } });
    const loggedIn = await pending;
    expect(restored).toBeNull();
    expect(api.refreshSession).not.toHaveBeenCalled();
    expect(loggedIn).toEqual({ user: { id: 'B' } });
    expect(current).toEqual({ user: { id: 'B' } });
  });
});
