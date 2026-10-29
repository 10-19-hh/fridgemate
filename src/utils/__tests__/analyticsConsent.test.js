import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('analytics consent storage failures', () => {
  let consent;
  let subscriptions;

  beforeEach(async () => {
    vi.restoreAllMocks();
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.__FRIDGEMATE_ANALYTICS_EVENTS__ = [];
    vi.resetModules();
    consent = await import('../analyticsConsent.js');
    subscriptions = [];
  });

  afterEach(() => {
    subscriptions.forEach(unsubscribe => unsubscribe());
    vi.restoreAllMocks();
  });

  it.each(['property', 'getItem'])('treats a blocked localStorage %s read as no consent', (failure) => {
    window.localStorage.setItem(consent.ANALYTICS_CONSENT_STORAGE_KEY, 'granted');
    const blocked = () => { throw new DOMException('private storage detail', 'SecurityError'); };
    if (failure === 'property') vi.spyOn(window, 'localStorage', 'get').mockImplementation(blocked);
    else vi.spyOn(Storage.prototype, 'getItem').mockImplementation(blocked);

    expect(() => consent.getAnalyticsConsent()).not.toThrow();
    expect(consent.getAnalyticsConsent()).toBeNull();
  });

  it('does not report an approval as saved when its write fails', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('private storage detail', 'QuotaExceededError');
    });

    let result;
    expect(() => { result = consent.setAnalyticsConsent('granted'); }).not.toThrow();
    expect(result).toBeNull();
    expect(consent.getAnalyticsConsent()).toBeNull();
  });

  it('requires a readable saved choice before enabling analytics', () => {
    const read = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('private storage detail', 'SecurityError');
    });

    expect(consent.setAnalyticsConsent('granted')).toBeNull();
    read.mockRestore();
    expect(window.localStorage.getItem(consent.ANALYTICS_CONSENT_STORAGE_KEY)).toBe('granted');
    expect(consent.getAnalyticsConsent()).toBeNull();
    expect(consent.setAnalyticsConsent('granted')).toBe('granted');
    expect(consent.getAnalyticsConsent()).toBe('granted');
  });

  it('blocks a leftover approval after failed withdrawal while still clearing identifiers', () => {
    consent.setAnalyticsConsent('granted');
    window.localStorage.setItem(consent.ANALYTICS_ID_STORAGE_KEY, 'synthetic-analytics-id');
    window.sessionStorage.setItem(consent.ANALYTICS_SESSION_ID_STORAGE_KEY, 'synthetic-session-id');
    window.sessionStorage.setItem(consent.ANALYTICS_SESSION_STARTED_STORAGE_KEY, 'true');
    window.__FRIDGEMATE_ANALYTICS_EVENTS__ = [{ event_name: 'page_view' }];
    const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('private storage detail', 'SecurityError');
    });
    const observations = [];
    const onUpdate = () => observations.push(consent.getAnalyticsConsent());
    window.addEventListener(consent.ANALYTICS_CONSENT_UPDATED_EVENT, onUpdate);
    try {
      let result;
      expect(() => { result = consent.setAnalyticsConsent('denied'); }).not.toThrow();
      expect(result).toBeNull();
    } finally {
      window.removeEventListener(consent.ANALYTICS_CONSENT_UPDATED_EVENT, onUpdate);
    }

    expect(observations).toEqual([null]);
    expect(window.localStorage.getItem(consent.ANALYTICS_CONSENT_STORAGE_KEY)).toBe('granted');
    expect(window.localStorage.getItem(consent.ANALYTICS_ID_STORAGE_KEY)).toBeNull();
    expect(window.sessionStorage.getItem(consent.ANALYTICS_SESSION_ID_STORAGE_KEY)).toBeNull();
    expect(window.sessionStorage.getItem(consent.ANALYTICS_SESSION_STARTED_STORAGE_KEY)).toBeNull();
    expect(window.__FRIDGEMATE_ANALYTICS_EVENTS__).toEqual([]);
    write.mockRestore();
    expect(consent.getAnalyticsConsent()).toBeNull();
    expect(consent.setAnalyticsConsent('denied')).toBe('denied');
    expect(consent.getAnalyticsConsent()).toBe('denied');
  });

  it.each([
    ['localStorage', 'fridgemate-analytics-id'],
    ['sessionStorage', 'fridgemate-analytics-session-id'],
    ['sessionStorage', 'fridgemate-analytics-session-started']
  ])('continues withdrawal cleanup when %s removal of %s fails', (storageType, blockedKey) => {
    consent.setAnalyticsConsent('granted');
    const identifiers = [
      ['localStorage', 'fridgemate-analytics-id'],
      ['sessionStorage', 'fridgemate-analytics-session-id'],
      ['sessionStorage', 'fridgemate-analytics-session-started']
    ];
    identifiers.forEach(([type, key]) => window[type].setItem(key, 'synthetic-value'));
    window.__FRIDGEMATE_ANALYTICS_EVENTS__ = [{ event_name: 'page_view' }];
    const removeItem = Storage.prototype.removeItem;
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(function (key) {
      if (this === window[storageType] && key === blockedKey) {
        throw new DOMException('private storage detail', 'SecurityError');
      }
      return removeItem.call(this, key);
    });

    let result;
    expect(() => { result = consent.setAnalyticsConsent('denied'); }).not.toThrow();
    expect(result).toBeNull();
    expect(consent.getAnalyticsConsent()).toBeNull();
    expect(window.localStorage.getItem(consent.ANALYTICS_CONSENT_STORAGE_KEY)).toBe('denied');
    identifiers.forEach(([type, key]) => {
      expect(window[type].getItem(key)).toBe(key === blockedKey ? 'synthetic-value' : null);
    });
    expect(window.__FRIDGEMATE_ANALYTICS_EVENTS__).toEqual([]);
  });

  it('shares change notifications while allowing each mounted consumer to unsubscribe', () => {
    const first = [];
    const second = [];
    const unsubscribeFirst = consent.subscribeToAnalyticsConsent(() => first.push(consent.getAnalyticsConsent()));
    const unsubscribeSecond = consent.subscribeToAnalyticsConsent(() => second.push(consent.getAnalyticsConsent()));
    subscriptions.push(unsubscribeFirst, unsubscribeSecond);
    consent.setAnalyticsConsent('granted');
    unsubscribeFirst();
    window.localStorage.setItem(consent.ANALYTICS_CONSENT_STORAGE_KEY, 'denied');
    window.dispatchEvent(new StorageEvent('storage', {
      key: consent.ANALYTICS_CONSENT_STORAGE_KEY, newValue: 'denied', storageArea: window.localStorage
    }));
    expect(first).toEqual(['granted']);
    expect(second).toEqual(['granted', 'denied']);
    unsubscribeSecond();
    window.sessionStorage.setItem(consent.ANALYTICS_SESSION_ID_STORAGE_KEY, 'no-longer-observed');
    window.dispatchEvent(new StorageEvent('storage', {
      key: consent.ANALYTICS_CONSENT_STORAGE_KEY, newValue: 'denied', storageArea: window.localStorage
    }));
    expect(second).toEqual(['granted', 'denied']);
    expect(window.sessionStorage.getItem(consent.ANALYTICS_SESSION_ID_STORAGE_KEY)).toBe('no-longer-observed');
  });

  it('does not let an external grant undo a cross-tab cleanup failure', () => {
    consent.setAnalyticsConsent('granted');
    subscriptions.push(consent.subscribeToAnalyticsConsent(() => {}));
    const remove = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new DOMException('synthetic private detail', 'SecurityError');
    });
    window.localStorage.setItem(consent.ANALYTICS_CONSENT_STORAGE_KEY, 'denied');
    expect(() => window.dispatchEvent(new StorageEvent('storage', {
      key: consent.ANALYTICS_CONSENT_STORAGE_KEY, newValue: 'denied', storageArea: window.localStorage
    }))).not.toThrow();
    remove.mockRestore();
    window.localStorage.setItem(consent.ANALYTICS_CONSENT_STORAGE_KEY, 'granted');
    window.dispatchEvent(new StorageEvent('storage', {
      key: consent.ANALYTICS_CONSENT_STORAGE_KEY, newValue: 'granted', storageArea: window.localStorage
    }));
    expect(consent.getAnalyticsConsent()).toBeNull();
    expect(consent.setAnalyticsConsent('granted')).toBe('granted');
  });
});
