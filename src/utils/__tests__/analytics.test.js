import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ANALYTICS_ID_STORAGE_KEY,
  ANALYTICS_SESSION_ID_STORAGE_KEY,
  ANALYTICS_SESSION_STARTED_STORAGE_KEY,
  setAnalyticsConsent
} from '../analyticsConsent';
import {
  buildAnalyticsPayload,
  getAnonymousAnalyticsId,
  getAnalyticsSessionId,
  getDaysToExpiryBucket,
  hasTrackedSessionStarted,
  markSessionStartedTracked,
  recordAnalyticsEvent
} from '../analytics';

const { saveProductEventMock } = vi.hoisted(() => ({
  saveProductEventMock: vi.fn()
}));

vi.mock('../../api/productEventsApi', () => ({
  saveProductEvent: saveProductEventMock
}));

describe('analytics utilities', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.__FRIDGEMATE_ANALYTICS_EVENTS__ = [];
    vi.restoreAllMocks();
    saveProductEventMock.mockReset().mockResolvedValue(null);
    setAnalyticsConsent('granted');
  });

  afterEach(() => vi.restoreAllMocks());

  it('reuses stored anonymous and session ids', () => {
    const analyticsId = getAnonymousAnalyticsId();
    const sessionId = getAnalyticsSessionId();

    expect(getAnonymousAnalyticsId()).toBe(analyticsId);
    expect(getAnalyticsSessionId()).toBe(sessionId);
  });

  it('marks session_started once per browser session', () => {
    expect(hasTrackedSessionStarted()).toBe(false);

    markSessionStartedTracked();

    expect(hasTrackedSessionStarted()).toBe(true);
  });

  it('builds payloads with common analytics fields', () => {
    const payload = buildAnalyticsPayload({
      eventName: 'ingredient_created',
      route: '/ingredients/new',
      isAuthenticated: true,
      userId: 'user-123',
      properties: {
        creation_method: 'manual'
      }
    });

    expect(payload.event_name).toBe('ingredient_created');
    expect(payload.route).toBe('/ingredients/new');
    expect(payload.user_mode).toBe('authenticated');
    expect(payload).not.toHaveProperty('user_id');
    expect(payload.creation_method).toBe('manual');
    expect(payload.analytics_id).toBeTruthy();
    expect(payload.session_id).toBeTruthy();
    expect(payload.occurred_at).toBeTruthy();
  });

  it('does not let caller properties override or reintroduce protected envelope fields', () => {
    const payload = buildAnalyticsPayload({
      eventName: 'page_view',
      route: '/ingredients/private-record-id/edit?from=home',
      isAuthenticated: true,
      properties: {
        analytics_id: 'caller-analytics-id',
        api_mode: 'caller-api-mode',
        app_version: 'caller-version',
        client_event_id: 'caller-event-id',
        device_type: 'caller-device',
        event_name: 'caller_event',
        network_state: 'caller-network',
        occurred_at: 'not-a-date',
        page_path: '/private/path?token=secret',
        page_title: 'Private ingredient title',
        route: '/private/override',
        session_id: 'caller-session-id',
        user_id: 'caller-user-id',
        user_mode: 'guest',
        source_screen: 'header'
      }
    });

    expect(payload.event_name).toBe('page_view');
    expect(payload.route).toBe('/ingredients/private-record-id/edit?from=home');
    expect(payload.user_mode).toBe('authenticated');
    expect(payload.client_event_id).not.toBe('caller-event-id');
    expect(payload.analytics_id).not.toBe('caller-analytics-id');
    expect(payload.session_id).not.toBe('caller-session-id');
    expect(payload.occurred_at).not.toBe('not-a-date');
    expect(payload).not.toHaveProperty('user_id');
    expect(payload).not.toHaveProperty('page_path');
    expect(payload).not.toHaveProperty('page_title');
    expect(payload.source_screen).toBe('header');
  });

  it('stores recorded events on window for local inspection', () => {
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent');
    const payload = buildAnalyticsPayload({
      eventName: 'session_started',
      route: '/',
      isAuthenticated: false,
      userId: null
    });

    recordAnalyticsEvent(payload);

    expect(window.__FRIDGEMATE_ANALYTICS_EVENTS__).toHaveLength(1);
    expect(window.__FRIDGEMATE_ANALYTICS_EVENTS__[0].event_name).toBe('session_started');
    expect(dispatchSpy).toHaveBeenCalledTimes(1);
  });

  it.each([null, 'denied'])('does not create or record identifiers when consent is %s', (consent) => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    if (consent) setAnalyticsConsent(consent);

    expect(getAnonymousAnalyticsId()).toBeNull();
    expect(getAnalyticsSessionId()).toBeNull();
    expect(
      buildAnalyticsPayload({ eventName: 'page_view', route: '/', isAuthenticated: false })
    ).toBeNull();
    expect(recordAnalyticsEvent({ event_name: 'page_view' })).toBeNull();
    expect(window.localStorage.getItem(ANALYTICS_ID_STORAGE_KEY)).toBeNull();
    expect(window.sessionStorage.getItem(ANALYTICS_SESSION_ID_STORAGE_KEY)).toBeNull();
    expect(window.__FRIDGEMATE_ANALYTICS_EVENTS__).toHaveLength(0);
    expect(saveProductEventMock).not.toHaveBeenCalled();
  });

  it('clears analytics identifiers and the session marker when consent is withdrawn', () => {
    getAnonymousAnalyticsId();
    getAnalyticsSessionId();
    markSessionStartedTracked();
    window.__FRIDGEMATE_ANALYTICS_EVENTS__ = [
      { analytics_id: 'private-analytics-id', session_id: 'private-session-id' }
    ];

    setAnalyticsConsent('denied');

    expect(window.localStorage.getItem(ANALYTICS_ID_STORAGE_KEY)).toBeNull();
    expect(window.sessionStorage.getItem(ANALYTICS_SESSION_ID_STORAGE_KEY)).toBeNull();
    expect(window.sessionStorage.getItem(ANALYTICS_SESSION_STARTED_STORAGE_KEY)).toBeNull();
    expect(window.__FRIDGEMATE_ANALYTICS_EVENTS__).toEqual([]);
  });

  it.each(['property', 'getItem', 'setItem'])('does not create events when sessionStorage %s is blocked', (failure) => {
    const blocked = () => { throw new DOMException('private storage detail', 'SecurityError'); };
    if (failure === 'property') {
      vi.spyOn(window, 'sessionStorage', 'get').mockImplementation(blocked);
    } else {
      const original = Storage.prototype[failure];
      vi.spyOn(Storage.prototype, failure).mockImplementation(function (...args) {
        if (this === window.sessionStorage) return blocked();
        return original.apply(this, args);
      });
    }

    expect(() => getAnalyticsSessionId()).not.toThrow();
    expect(getAnalyticsSessionId()).toBeNull();
    expect(() => hasTrackedSessionStarted()).not.toThrow();
    expect(hasTrackedSessionStarted()).toBe(false);
    expect(() => markSessionStartedTracked()).not.toThrow();
    const payload = buildAnalyticsPayload({ eventName: 'page_view', route: '/', isAuthenticated: true });
    expect(payload).toBeNull();
    expect(recordAnalyticsEvent(payload)).toBeNull();
    expect(window.__FRIDGEMATE_ANALYTICS_EVENTS__).toEqual([]);
    expect(saveProductEventMock).not.toHaveBeenCalled();
  });

  it.each(['getItem', 'setItem'])('does not create events when local analytics ID %s fails', (failure) => {
    const original = Storage.prototype[failure];
    vi.spyOn(Storage.prototype, failure).mockImplementation(function (key, ...args) {
      if (this === window.localStorage && key === ANALYTICS_ID_STORAGE_KEY) {
        throw new DOMException('private storage detail', 'SecurityError');
      }
      return original.call(this, key, ...args);
    });

    expect(() => getAnonymousAnalyticsId()).not.toThrow();
    expect(getAnonymousAnalyticsId()).toBeNull();
    const payload = buildAnalyticsPayload({ eventName: 'page_view', route: '/', isAuthenticated: true });
    expect(payload).toBeNull();
    expect(recordAnalyticsEvent(payload)).toBeNull();
    expect(window.__FRIDGEMATE_ANALYTICS_EVENTS__).toEqual([]);
    expect(saveProductEventMock).not.toHaveBeenCalled();
  });

  it('does not persist or emit identifiers without a secure random source', () => {
    vi.stubGlobal('crypto', undefined);

    expect(getAnonymousAnalyticsId()).toBeNull();
    expect(getAnalyticsSessionId()).toBeNull();
    expect(
      buildAnalyticsPayload({ eventName: 'page_view', route: '/', isAuthenticated: false })
    ).toBeNull();
    expect(window.localStorage.getItem(ANALYTICS_ID_STORAGE_KEY)).toBeNull();
    expect(window.sessionStorage.getItem(ANALYTICS_SESSION_ID_STORAGE_KEY)).toBeNull();
  });

  it('groups expiry dates into KPI-friendly buckets', () => {
    const today = new Date();
    const formatDate = (offset) => {
      const date = new Date(today);
      date.setDate(date.getDate() + offset);
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    };

    expect(getDaysToExpiryBucket(formatDate(-1))).toBe('expired');
    expect(getDaysToExpiryBucket(formatDate(0))).toBe('today');
    expect(getDaysToExpiryBucket(formatDate(2))).toBe('1_to_3');
    expect(getDaysToExpiryBucket(formatDate(5))).toBe('4_to_7');
    expect(getDaysToExpiryBucket(formatDate(10))).toBe('8_plus');
    expect(getDaysToExpiryBucket('')).toBe('unknown');
  });
});
