import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiClientError, requestJson } from '../apiClient.js';
import { persistSession } from '../../features/auth/authSessionService.js';

describe('apiClient request correlation', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    persistSession(null, () => {});
  });

  it('retains the server request id on API errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 500,
        headers: new Headers({ 'x-request-id': 'request-header' }),
        json: async () => ({
          message: 'Internal server error.',
          requestId: 'request-body'
        })
      }))
    );

    const error = await requestJson('/ingredients').catch((caught) => caught);

    expect(error).toBeInstanceOf(ApiClientError);
    expect(error).toMatchObject({
      message: 'Internal server error.',
      status: 500,
      path: '/ingredients',
      requestId: 'request-body'
    });
  });

  it('shares one refresh request across simultaneous authenticated 401 responses', async () => {
    persistSession({ user: { id: 'user-1' } }, () => {});
    let finishRefresh;
    const refreshResponse = new Promise((resolve) => {
      finishRefresh = resolve;
    });
    const requestAttempts = new Map();
    const fetchMock = vi.fn((url) => {
      if (url.endsWith('/auth/refresh')) {
        return refreshResponse;
      }

      const attempt = (requestAttempts.get(url) || 0) + 1;
      requestAttempts.set(url, attempt);

      if (attempt === 1) {
        return Promise.resolve({
          ok: false,
          status: 401,
          headers: new Headers(),
          json: async () => ({ message: 'Session expired.' })
        });
      }

      return Promise.resolve({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => ({ path: url })
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const firstRequest = requestJson('/ingredients', {}, { authMode: 'required' });
    const secondRequest = requestJson('/recipes/recommendations', {}, { authMode: 'required' });

    await vi.waitFor(() => {
      expect(fetchMock.mock.calls.filter(([url]) => url.endsWith('/auth/refresh'))).toHaveLength(1);
    });

    finishRefresh({ ok: true, status: 200, json: async () => ({ user: { id: 'user-1' } }) });

    await expect(Promise.all([firstRequest, secondRequest])).resolves.toEqual([
      { path: expect.stringMatching(/\/ingredients$/) },
      { path: expect.stringMatching(/\/recipes\/recommendations$/) }
    ]);
    expect(fetchMock.mock.calls.filter(([url]) => url.endsWith('/auth/refresh'))).toHaveLength(1);
    expect([...requestAttempts.entries()]).toEqual(
      expect.arrayContaining([
        [expect.stringMatching(/\/ingredients$/), 2],
        [expect.stringMatching(/\/recipes\/recommendations$/), 2]
      ])
    );
  });
});
