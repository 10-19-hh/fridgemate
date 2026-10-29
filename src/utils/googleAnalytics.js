import { getAnalyticsConsent } from './analyticsConsent';
import { isLocalPilotBuild } from './pilotMode.js';

const GA_SCRIPT_SELECTOR = 'script[data-fridgemate-ga]';
const COMMON_EVENT_PARAMETER_KEYS = Object.freeze([
  'api_mode',
  'app_version',
  'device_type',
  'network_state',
  'user_mode'
]);
const EVENT_PARAMETER_KEYS = Object.freeze({
  activation_completed: ['activation_path'],
  ingredient_consumed: ['days_to_expiry_bucket', 'source'],
  ingredient_created: [
    'creation_method',
    'category',
    'storage_type',
    'has_expiry_date',
    'has_purchase_date',
    'quantity_present'
  ],
  ingredient_duplicates_cleaned: ['duplicate_group_count', 'removed_count'],
  ingredient_restored: ['days_to_expiry_bucket'],
  login_completed: ['restored_session', 'source_screen'],
  ocr_import_saved: ['saved_item_count', 'edited_before_save_count', 'session_first_import'],
  ocr_parse_completed: [
    'raw_text_length',
    'parsed_item_count',
    'template_type',
    'confidence_bucket'
  ],
  ocr_review_completed: [
    'parsed_item_count',
    'selected_item_count',
    'edited_item_count',
    'deleted_item_count'
  ],
  ocr_upload_started: ['file_type', 'source_screen'],
  page_view: [],
  recommendation_clicked: ['screen', 'group', 'score', 'missing_core_count'],
  recommendations_viewed: [
    'screen',
    'available_ingredient_count',
    'expiring_soon_count',
    'ready_count',
    'buy_one_more_count',
    'use_soon_count'
  ],
  session_started: ['has_existing_local_data', 'has_restored_session'],
  signup_completed: ['source_screen']
});
const STATIC_ROUTE_TEMPLATES = new Set([
  '/',
  '/about',
  '/account',
  '/contact',
  '/import',
  '/ingredients',
  '/ingredients/new',
  '/login',
  '/privacy',
  '/recipes',
  '/signup'
]);

function getMeasurementId() {
  const measurementId = String(import.meta.env.VITE_GA_MEASUREMENT_ID || '').trim();
  return /^G-[A-Z0-9]+$/u.test(measurementId) ? measurementId : '';
}

function isSafePrimitive(value) {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
}

function looksLikeEmail(value) {
  return typeof value === 'string' && /\S+@\S+\.\S+/u.test(value);
}

export function normalizeGoogleAnalyticsRoute(value) {
  const pathname = String(value || '').split(/[?#]/u, 1)[0] || '/';

  if (STATIC_ROUTE_TEMPLATES.has(pathname)) return pathname;
  if (/^\/ingredients\/[^/]+\/edit$/u.test(pathname)) return '/ingredients/:id/edit';
  return '/other';
}

export function sanitizeGoogleAnalyticsParameters(payload = {}) {
  const eventName = typeof payload.event_name === 'string' ? payload.event_name : '';
  const eventKeys = EVENT_PARAMETER_KEYS[eventName];

  if (!eventKeys) return {};

  const allowedKeys = new Set([...COMMON_EVENT_PARAMETER_KEYS, ...eventKeys]);

  return Object.entries(payload).reduce((parameters, [key, value]) => {
    if (!allowedKeys.has(key)) return parameters;
    if (!isSafePrimitive(value) || looksLikeEmail(value)) return parameters;

    parameters[key] = typeof value === 'string' ? value.slice(0, 100) : value;
    return parameters;
  }, {});
}

function installGtag() {
  window.dataLayer = window.dataLayer || [];
  window.gtag =
    window.gtag ||
    function gtag() {
      window.dataLayer.push(arguments);
    };
}

function clearGoogleAnalyticsCookies() {
  if (typeof document === 'undefined') return;

  const cookieNames = document.cookie
    .split(';')
    .map((cookie) => cookie.split('=', 1)[0].trim())
    .filter((name) => /^_(?:ga(?:_|$)|gat(?:_|$)|gcl_|gid$)/u.test(name));

  for (const name of cookieNames) {
    document.cookie = `${name}=; Max-Age=0; Path=/; SameSite=Lax`;
  }
}

export function initializeGoogleAnalytics() {
  if (isLocalPilotBuild()) return false;
  if (typeof window === 'undefined' || typeof document === 'undefined') return false;
  if (getAnalyticsConsent() !== 'granted') return false;

  const measurementId = getMeasurementId();
  if (!measurementId) return false;

  installGtag();

  if (!document.head.querySelector(GA_SCRIPT_SELECTOR)) {
    const script = document.createElement('script');
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(measurementId)}`;
    script.dataset.fridgemateGa = measurementId;
    document.head.appendChild(script);

    window.gtag('js', new Date());
    window.gtag('consent', 'update', { analytics_storage: 'granted' });
    window.gtag('config', measurementId, {
      send_page_view: false,
      anonymize_ip: true,
      allow_google_signals: false,
      allow_ad_personalization_signals: false
    });
  }

  return true;
}

export function disableGoogleAnalytics() {
  if (typeof window === 'undefined') return;

  if (typeof window.gtag === 'function') {
    window.gtag('consent', 'update', { analytics_storage: 'denied' });
  }

  if (typeof document !== 'undefined') {
    document.querySelectorAll(GA_SCRIPT_SELECTOR).forEach((script) => script.remove());
    clearGoogleAnalyticsCookies();
  }

  window.dataLayer = [];
  delete window.gtag;
}

export function trackGoogleAnalyticsEvent(payload) {
  if (!Object.hasOwn(EVENT_PARAMETER_KEYS, payload?.event_name) || !initializeGoogleAnalytics()) {
    return false;
  }

  const parameters = {
    ...sanitizeGoogleAnalyticsParameters(payload),
    page_path: normalizeGoogleAnalyticsRoute(payload.route)
  };
  if (typeof payload.entry_route === 'string') {
    parameters.entry_route = normalizeGoogleAnalyticsRoute(payload.entry_route);
  }

  window.gtag('event', payload.event_name, parameters);
  return true;
}
