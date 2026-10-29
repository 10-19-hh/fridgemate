import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const payload = (id) => ({
  client_event_id: id,
  event_name: 'page_view',
  occurred_at: '2026-09-28T00:00:00.000Z',
  user_mode: 'authenticated',
  route: '/recipes',
  device_type: 'desktop',
  network_state: 'online'
});

// Real consent -> real product queue -> real requestJson; only the network is fake.
describe('product event consent cancellation', () => {
  let consent;
  let saveProductEvent;
  let fetchMock;
  let requests;
  let jobs;

  const flush = async () => {
    for (let index = 0; index < 12; index += 1) await Promise.resolve();
  };
  const send = (id) => {
    const job = saveProductEvent(payload(id));
    jobs.push(job);
    return job;
  };
  const receiveStorage = (newValue, key = 'fridgemate-analytics-consent', storageArea = window.localStorage) => {
    if (key === null) storageArea.clear();
    else if (newValue === null) storageArea.removeItem(key);
    else storageArea.setItem(key, newValue);
    window.dispatchEvent(new StorageEvent('storage', { key, newValue, storageArea }));
  };

  beforeEach(async () => {
    vi.restoreAllMocks();
    vi.resetModules();
    window.localStorage.clear();
    window.sessionStorage.clear();
    vi.stubEnv('VITE_API_URL_OVERRIDE', 'https://synthetic.invalid/api');
    requests = [];
    jobs = [];
    fetchMock = vi.fn((url, options) => new Promise((resolve) => {
      requests.push({ url, options, complete: () => resolve(new Response(null, { status: 204 })) });
    }));
    vi.stubGlobal('fetch', fetchMock);
    consent = await import('../../utils/analyticsConsent.js');
    ({ saveProductEvent } = await import('../productEventsApi.js'));
    consent.setAnalyticsConsent('granted');
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    consent.setAnalyticsConsent('denied');
    // Release even a broken old implementation's queue; never leave pending work/listeners between tests.
    for (let index = 0; index < jobs.length + 2; index += 1) {
      requests.forEach(request => request.complete());
      await flush();
    }
    await Promise.allSettled(jobs);
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('keeps normal authenticated events ordered and preserves their results', async () => {
    const first = send('first');
    const second = send('second');
    await flush();
    expect(requests).toHaveLength(1);
    expect(requests[0].url).toBe('https://synthetic.invalid/api/product-events');
    expect(requests[0].options.credentials).toBe('include');
    expect(JSON.parse(requests[0].options.body).clientEventId).toBe('first');
    requests[0].complete();
    await expect(first).resolves.toEqual({});
    await flush();
    expect(requests).toHaveLength(2);
    expect(JSON.parse(requests[1].options.body).clientEventId).toBe('second');
    requests[1].complete();
    await expect(second).resolves.toEqual({});
  });

  it('rechecks stored consent just before dispatch even before a storage notification arrives', async () => {
    const result = send('not-dispatched');
    window.localStorage.setItem(consent.ANALYTICS_CONSENT_STORAGE_KEY, 'denied');
    await flush();
    expect(fetchMock).not.toHaveBeenCalled();
    await expect(result).resolves.toBeNull();
  });

  it('does not dispatch an enqueued event when the next consent read is blocked', async () => {
    const result = send('not-dispatched');
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('synthetic private detail', 'SecurityError');
    });
    await flush();
    expect(fetchMock).not.toHaveBeenCalled();
    await expect(result).resolves.toBeNull();
  });

  it('cancels an event withdrawn before its first dispatch', async () => {
    const result = send('cancelled');
    consent.setAnalyticsConsent('denied');
    await flush();
    expect(fetchMock).not.toHaveBeenCalled();
    await expect(result).resolves.toBeNull();
  });

  it('aborts an in-flight event and settles queued events without waiting for its response', async () => {
    const first = send('in-flight');
    await flush();
    const second = send('queued');
    let queuedResult = 'pending';
    second.then(result => { queuedResult = result; });
    consent.setAnalyticsConsent('denied');
    await flush();
    expect(requests[0].options.signal?.aborted).toBe(true);
    expect(queuedResult).toBeNull();
    await expect(first).resolves.toBeNull();
    requests[0].complete();
    await flush();
    expect(requests).toHaveLength(1);
  });

  it('does not revive pre-withdrawal events when the user approves again before dispatch', async () => {
    const old = send('old-generation');
    consent.setAnalyticsConsent('denied');
    consent.setAnalyticsConsent('granted');
    const current = send('current-generation');
    await flush();
    expect(requests.map(request => JSON.parse(request.options.body).clientEventId)).toEqual(['current-generation']);
    await expect(old).resolves.toBeNull();
    requests[0].complete();
    await expect(current).resolves.toEqual({});
  });

  it('allows a fresh consent generation even if the cancelled network request ignores abort', async () => {
    const old = send('stubborn-in-flight');
    await flush();
    send('old-queued');
    consent.setAnalyticsConsent('denied');
    consent.setAnalyticsConsent('granted');
    const current = send('fresh');
    await flush();
    expect(requests.map(request => JSON.parse(request.options.body).clientEventId)).toEqual(['stubborn-in-flight', 'fresh']);
    await expect(old).resolves.toBeNull();
    requests[1].complete();
    await expect(current).resolves.toEqual({});
    requests[0].complete();
    await flush();
    expect(requests).toHaveLength(2);
  });

  it.each([
    ['denial', 'denied', 'fridgemate-analytics-consent'],
    ['removal', null, 'fridgemate-analytics-consent'],
    ['clear', null, null]
  ])('cancels in-flight and queued events after another tab sends %s', async (_label, value, key) => {
    const first = send('in-flight');
    await flush();
    const queued = send('queued');
    let result = 'pending';
    queued.then(value => { result = value; });
    receiveStorage(value, key);
    await flush();
    expect(requests[0].options.signal?.aborted).toBe(true);
    expect(result).toBeNull();
    await expect(first).resolves.toBeNull();
    requests[0].complete();
    await flush();
    expect(requests).toHaveLength(1);
  });

  it('invalidates the old generation when a denial notification follows a newer stored approval', async () => {
    const old = send('old-generation');
    window.dispatchEvent(new StorageEvent('storage', {
      key: consent.ANALYTICS_CONSENT_STORAGE_KEY,
      newValue: 'denied',
      storageArea: window.localStorage
    }));
    await flush();
    expect(fetchMock).not.toHaveBeenCalled();
    await expect(old).resolves.toBeNull();
  });

  it('ignores unrelated keys and sessionStorage notifications', async () => {
    const result = send('allowed');
    receiveStorage('denied', 'unrelated-key');
    receiveStorage('denied', consent.ANALYTICS_CONSENT_STORAGE_KEY, window.sessionStorage);
    await flush();
    expect(requests).toHaveLength(1);
    requests[0].complete();
    await expect(result).resolves.toEqual({});
  });

  it('keeps a failed withdrawal blocked after another tab announces approval', async () => {
    const old = send('cancelled');
    const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('synthetic private detail', 'SecurityError');
    });
    expect(consent.setAnalyticsConsent('denied')).toBeNull();
    write.mockRestore();
    receiveStorage('granted');
    const later = send('still-blocked');
    await flush();
    expect(fetchMock).not.toHaveBeenCalled();
    await expect(old).resolves.toBeNull();
    await expect(later).resolves.toBeNull();
  });

  it('settles an actual abort rejection as cancellation instead of surfacing a network error', async () => {
    let signal;
    fetchMock.mockImplementationOnce((_url, options) => new Promise((_resolve, reject) => {
      signal = options.signal;
      signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
    }));
    const result = send('abortable');
    await flush();
    consent.setAnalyticsConsent('denied');
    await expect(result).resolves.toBeNull();
    expect(signal.aborted).toBe(true);
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('preserves ordinary request errors and allows the next still-consented event', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Synthetic network failure'));
    const failed = send('failed');
    const next = send('next');
    await expect(failed).rejects.toMatchObject({ name: 'ApiClientError' });
    await flush();
    expect(requests.map(request => JSON.parse(request.options.body).clientEventId)).toEqual(['next']);
    requests[0].complete();
    await expect(next).resolves.toEqual({});
  });
});
