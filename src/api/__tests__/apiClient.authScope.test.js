import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function response(payload, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => payload };
}

describe('authenticated request ownership', () => {
  let client;
  let sessions;
  let setSession;

  beforeEach(async () => {
    vi.resetModules();
    window.localStorage.clear();
    client = await import('../apiClient.js');
    sessions = await import('../../features/auth/authSessionService.js');
    setSession = vi.fn();
    sessions.persistSession({ user: { id: 'A' } }, setSession);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    window.localStorage.clear();
  });

  function save(path = '/user-preferences', extra = {}) {
    return client.requestJson(path, { method: 'PUT', body: '{"value":"A-owned"}' }, {
      authMode: 'required', ...extra
    }).then((value) => ({ value }), (error) => ({ error }));
  }

  it('does not refresh or replay A data when B becomes current before the first 401 arrives', async () => {
    const first = deferred();
    class OwnedError extends client.ApiClientError {}
    const fetchMock = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue(response({ user: { id: 'B' } }));
    vi.stubGlobal('fetch', fetchMock);
    const pending = save('/user-preferences', { errorClass: OwnedError });
    sessions.persistSession({ user: { id: 'B' } }, setSession);
    first.resolve(response({ message: 'expired' }, 401));
    const { error } = await pending;
    expect(error).toBeInstanceOf(OwnedError);
    expect(error).toMatchObject({ status: 401, code: 'AUTH_CONTEXT_CHANGED' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rejects an old request after A goes through guest and returns as A during refresh', async () => {
    const refresh = deferred();
    const fetchMock = vi.fn().mockResolvedValueOnce(response({ message: 'expired' }, 401))
      .mockReturnValueOnce(refresh.promise).mockResolvedValue(response({ saved: true }));
    vi.stubGlobal('fetch', fetchMock);
    const pending = save();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    sessions.persistSession(null, setSession);
    sessions.persistSession({ user: { id: 'A' } }, setSession);
    refresh.resolve(response({ user: { id: 'A' } }));
    expect((await pending).error).toMatchObject({ code: 'AUTH_CONTEXT_CHANGED' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each([{ user: { id: 'B' } }, {}, { user: { id: '' } }])(
    'does not replay when refresh does not verify the original account: %j', async (payload) => {
      const fetchMock = vi.fn().mockResolvedValueOnce(response({ message: 'original expired', requestId: 'original-request' }, 401))
        .mockResolvedValueOnce(response(payload)).mockResolvedValue(response({ saved: true }));
      vi.stubGlobal('fetch', fetchMock);
      expect((await save()).error).toMatchObject({ status: 401, message: 'original expired', requestId: 'original-request' });
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect((await save()).error).toMatchObject({ code: 'AUTH_CONTEXT_CHANGED' });
      expect(fetchMock).toHaveBeenCalledTimes(2);
    }
  );

  it('shares same-account rotation with explicit session restoration and preserves one retry', async () => {
    const refresh = deferred();
    let attempts = 0;
    const fetchMock = vi.fn((url) => url.endsWith('/auth/refresh') ? refresh.promise
      : Promise.resolve(++attempts === 1 ? response({}, 401) : response({ saved: true })));
    vi.stubGlobal('fetch', fetchMock);
    const pending = save();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const restoring = sessions.refreshStoredSession({ backendEnabled: true, setSession, setLoading: vi.fn(), setError: vi.fn() });
    refresh.resolve(response({ user: { id: 'A', email: 'fresh@example.test' } }));
    expect(await pending).toEqual({ value: { saved: true } });
    expect(await restoring).toEqual({ user: { id: 'A', email: 'fresh@example.test' } });
    expect(fetchMock.mock.calls.filter(([url]) => url.endsWith('/auth/refresh'))).toHaveLength(1);
    expect(fetchMock.mock.calls.filter(([url]) => url.endsWith('/user-preferences'))).toHaveLength(2);
  });

  it('never shares an old-account refresh or lets its cleanup discard the new refresh', async () => {
    const oldRefresh = deferred();
    const newRefresh = deferred();
    const attempts = new Map();
    let refreshCount = 0;
    const fetchMock = vi.fn((url) => {
      if (url.endsWith('/auth/refresh')) return ++refreshCount === 1 ? oldRefresh.promise : newRefresh.promise;
      const count = (attempts.get(url) || 0) + 1;
      attempts.set(url, count);
      return Promise.resolve(response(count === 1 ? {} : { saved: true }, count === 1 ? 401 : 200));
    });
    vi.stubGlobal('fetch', fetchMock);
    const oldRequest = save('/old');
    await vi.waitFor(() => expect(refreshCount).toBe(1));
    sessions.persistSession({ user: { id: 'B' } }, setSession);
    const newRequest = save('/new');
    await vi.waitFor(() => expect(fetchMock.mock.calls.some(([url]) => url.endsWith('/new'))).toBe(true));
    await new Promise((resolve) => setTimeout(resolve, 0));
    const observedBeforeOldCompletes = refreshCount;
    oldRefresh.resolve(response({ user: { id: 'A' } }));
    const oldResult = await oldRequest;
    const otherNewRequest = save('/new-other');
    await new Promise((resolve) => setTimeout(resolve, 0));
    newRefresh.resolve(response({ user: { id: 'B' } }));
    const newResults = await Promise.all([newRequest, otherNewRequest]);
    expect(observedBeforeOldCompletes).toBe(2);
    expect(refreshCount).toBe(2);
    expect(oldResult.error).toMatchObject({ code: 'AUTH_CONTEXT_CHANGED' });
    expect(newResults).toEqual([{ value: { saved: true } }, { value: { saved: true } }]);
    expect(fetchMock.mock.calls.filter(([url]) => url.endsWith('/old'))).toHaveLength(1);
  });

  it('retains the original error class and stops after one refresh retry', async () => {
    class OwnedError extends client.ApiClientError {}
    const fetchMock = vi.fn().mockResolvedValueOnce(response({}, 401))
      .mockResolvedValueOnce(response({ user: { id: 'A' } }))
      .mockResolvedValueOnce(response({ message: 'still expired', requestId: 'retry-request' }, 401));
    vi.stubGlobal('fetch', fetchMock);
    const { error } = await save('/user-preferences', { errorClass: OwnedError });
    expect(error).toBeInstanceOf(OwnedError);
    expect(error).toMatchObject({ status: 401, requestId: 'retry-request' });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('does not expose a successful old-account response after account switching while its body is pending', async () => {
    const body = deferred();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: () => body.promise }));
    const pending = save();
    await Promise.resolve();
    sessions.persistSession({ user: { id: 'B' } }, setSession);
    body.resolve({ privateResult: 'A' });
    expect((await pending).error).toMatchObject({ code: 'AUTH_CONTEXT_CHANGED' });
  });

  it('does not dispatch a new protected request while a login response body is pending', async () => {
    const loginBody = deferred();
    const fetchMock = vi.fn((url) => Promise.resolve(url.endsWith('/auth/login')
      ? { ok: true, status: 200, json: () => loginBody.promise } : response({ saved: true })));
    vi.stubGlobal('fetch', fetchMock);
    const login = sessions.loginWithSession({}, { backendEnabled: true, setSession, setError: vi.fn() });
    const result = await save();
    loginBody.resolve({ user: { id: 'B' } });
    await login;
    expect(result.error).toMatchObject({ code: 'AUTH_CONTEXT_CHANGED' });
    expect(fetchMock.mock.calls.filter(([url]) => url.endsWith('/user-preferences'))).toHaveLength(0);
  });

  it('blocks a new protected request after a remote generation changes before its storage event arrives', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({ saved: true }));
    vi.stubGlobal('fetch', fetchMock);
    window.localStorage.setItem('fridgemate-auth-change:v1', 'remote-login-generation');
    expect((await save()).error).toMatchObject({ code: 'AUTH_CONTEXT_CHANGED' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('releases the transition fence after a rejected login without changing the previous account', async () => {
    const fetchMock = vi.fn((url) => Promise.resolve(url.endsWith('/auth/login')
      ? response({ message: 'invalid credentials' }, 401) : response({ saved: true })));
    vi.stubGlobal('fetch', fetchMock);
    await expect(sessions.loginWithSession({}, { backendEnabled: true, setSession, setError: vi.fn() })).rejects.toMatchObject({ status: 401 });
    expect(await save()).toEqual({ value: { saved: true } });
  });

  it('blocks future dispatch after an unreadable successful refresh while preserving the original error', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(response({ message: 'original expired', requestId: 'original-request' }, 401))
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => { throw new SyntaxError('invalid response'); } })
      .mockResolvedValue(response({ saved: true }));
    vi.stubGlobal('fetch', fetchMock);
    expect((await save()).error).toMatchObject({ status: 401, message: 'original expired', requestId: 'original-request' });
    expect((await save()).error).toMatchObject({ code: 'AUTH_CONTEXT_CHANGED' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each([true, false])('does not dispatch a new protected request after logout succeeds=%s', async (succeeds) => {
    const fetchMock = vi.fn((url) => {
      if (url.endsWith('/auth/logout')) return succeeds ? Promise.resolve(response(null, 204)) : Promise.reject(new Error('offline'));
      return Promise.resolve(response({ saved: true }));
    });
    vi.stubGlobal('fetch', fetchMock);
    await sessions.logoutSession({ backendEnabled: true, user: { id: 'A' }, setSession,
      setError: vi.fn(), setGuestImportPrompt: vi.fn(), defaultGuestImportPrompt: {} });
    expect((await save()).error).toMatchObject({ code: 'AUTH_CONTEXT_CHANGED' });
    expect(fetchMock.mock.calls.filter(([url]) => url.endsWith('/user-preferences'))).toHaveLength(0);
  });

  it('keeps business dispatch blocked while re-verifying a known invalidated identity', async () => {
    const context = await import('../../features/auth/authSessionContext.js');
    context.invalidateAuthContext();
    const refresh = deferred();
    const fetchMock = vi.fn((url) => url.endsWith('/auth/refresh') ? refresh.promise : Promise.resolve(response({ saved: true })));
    vi.stubGlobal('fetch', fetchMock);
    const restoring = sessions.refreshStoredSession({ backendEnabled: true, setSession, setError: vi.fn(), setLoading: vi.fn() });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const pendingResult = await save();
    refresh.resolve(response({ user: { id: 'B' } }));
    expect(await restoring).toEqual({ user: { id: 'B' } });
    expect(pendingResult.error).toMatchObject({ code: 'AUTH_CONTEXT_CHANGED' });
    expect(fetchMock.mock.calls.filter(([url]) => url.endsWith('/user-preferences'))).toHaveLength(0);
    expect(await save()).toEqual({ value: { saved: true } });
  });
});
