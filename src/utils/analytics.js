import { getRemainingDays } from './date';
import { isBackendEnabled } from './backendConfig';
import { trackGoogleAnalyticsEvent } from './googleAnalytics';
import {
  ANALYTICS_EVENT_STORE_KEY,
  ANALYTICS_ID_STORAGE_KEY,
  ANALYTICS_SESSION_ID_STORAGE_KEY,
  ANALYTICS_SESSION_STARTED_STORAGE_KEY,
  getAnalyticsConsent
} from './analyticsConsent';
import { saveProductEvent } from '../api/productEventsApi';
import { createSecureId } from './secureId';

const ANALYTICS_EVENT_NAME = 'fridgemate:analytics';
const PROTECTED_ANALYTICS_PROPERTY_KEYS = new Set([
  'analytics_id',
  'api_mode',
  'app_version',
  'client_event_id',
  'device_type',
  'event_name',
  'network_state',
  'occurred_at',
  'page_path',
  'page_title',
  'route',
  'session_id',
  'user_id',
  'user_mode'
]);

function getStorage(type) {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    return window[type];
  } catch {
    return null;
  }
}

function createId() {
  return createSecureId('fm');
}

function getOrCreateStoredValue(key, storageType) {
  if (getAnalyticsConsent() !== 'granted') {
    return null;
  }

  const storage = getStorage(storageType);

  if (!storage) return null;

  try {
    const existingValue = storage.getItem(key);
    if (existingValue) return existingValue;

    const nextValue = createId();
    if (!nextValue) return null;
    storage.setItem(key, nextValue);
    return nextValue;
  } catch {
    return null;
  }
}

export function getAnonymousAnalyticsId() {
  return getOrCreateStoredValue(ANALYTICS_ID_STORAGE_KEY, 'localStorage');
}

export function getAnalyticsSessionId() {
  return getOrCreateStoredValue(ANALYTICS_SESSION_ID_STORAGE_KEY, 'sessionStorage');
}

export function hasTrackedSessionStarted() {
  if (getAnalyticsConsent() !== 'granted') return false;
  const storage = getStorage('sessionStorage');
  try {
    return storage?.getItem(ANALYTICS_SESSION_STARTED_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

export function markSessionStartedTracked() {
  if (getAnalyticsConsent() !== 'granted') return;
  const storage = getStorage('sessionStorage');

  if (!storage) {
    return;
  }

  try {
    storage.setItem(ANALYTICS_SESSION_STARTED_STORAGE_KEY, 'true');
  } catch {
    // Optional analytics storage must not interrupt the user's current action.
  }
}

export function getDeviceType() {
  if (typeof window === 'undefined') {
    return 'desktop';
  }

  return window.innerWidth < 768 ? 'mobile' : 'desktop';
}

export function getNetworkState() {
  if (typeof navigator === 'undefined') {
    return 'online';
  }

  return navigator.onLine === false ? 'offline' : 'online';
}

export function getApiMode() {
  return isBackendEnabled() ? 'backend_enabled' : 'local_only';
}

export function getDaysToExpiryBucket(expiryDate) {
  const remainingDays = getRemainingDays(expiryDate);

  if (remainingDays === null) {
    return 'unknown';
  }

  if (remainingDays < 0) {
    return 'expired';
  }

  if (remainingDays === 0) {
    return 'today';
  }

  if (remainingDays <= 3) {
    return '1_to_3';
  }

  if (remainingDays <= 7) {
    return '4_to_7';
  }

  return '8_plus';
}

function getAnalyticsEventProperties(properties) {
  if (!properties || typeof properties !== 'object' || Array.isArray(properties)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(properties).filter(([key]) => !PROTECTED_ANALYTICS_PROPERTY_KEYS.has(key))
  );
}

export function buildAnalyticsPayload({ eventName, route, isAuthenticated, properties = {} }) {
  if (getAnalyticsConsent() !== 'granted') {
    return null;
  }

  const clientEventId = createId();
  const sessionId = getAnalyticsSessionId();
  const analyticsId = getAnonymousAnalyticsId();

  if (!clientEventId || !sessionId || !analyticsId) {
    return null;
  }

  return {
    ...getAnalyticsEventProperties(properties),
    client_event_id: clientEventId,
    event_name: eventName,
    occurred_at: new Date().toISOString(),
    session_id: sessionId,
    analytics_id: analyticsId,
    user_mode: isAuthenticated ? 'authenticated' : 'guest',
    route: route || '/',
    device_type: getDeviceType(),
    api_mode: getApiMode(),
    network_state: getNetworkState(),
    app_version: import.meta.env.VITE_APP_VERSION || null
  };
}

export function recordAnalyticsEvent(payload) {
  if (getAnalyticsConsent() !== 'granted' || !payload) {
    return null;
  }

  if (typeof window === 'undefined') {
    return payload;
  }

  const events = window[ANALYTICS_EVENT_STORE_KEY] || [];
  events.push(payload);
  window[ANALYTICS_EVENT_STORE_KEY] = events;
  window.dispatchEvent(new CustomEvent(ANALYTICS_EVENT_NAME, { detail: payload }));
  trackGoogleAnalyticsEvent(payload);

  if (getAnalyticsConsent() === 'granted' && isBackendEnabled()) {
    saveProductEvent(payload).catch(() => {});
  }

  if (import.meta.env.DEV) {
    console.info('[analytics]', payload.event_name, payload);
  }

  return payload;
}
