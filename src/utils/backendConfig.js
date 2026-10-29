import { isLocalPilotBuild } from './pilotMode.js';

function normalizeUrl(value) {
  return String(value || '').trim().replace(/\/$/, '');
}

const CANONICAL_API_URL = 'https://api.xn--wh1bs8l5xa003adme.com/api';
const CANONICAL_HOSTS = new Set([
  'xn--wh1bs8l5xa003adme.com',
  'www.xn--wh1bs8l5xa003adme.com'
]);

function getBrowserHostname() {
  return typeof window === 'undefined' ? '' : String(window.location.hostname || '').toLowerCase();
}

export function resolveApiBaseUrl(configuredUrl, hostname = getBrowserHostname()) {
  if (isLocalPilotBuild()) return '';
  const normalizedHostname = String(hostname || '').trim().toLowerCase();

  if (normalizedHostname.endsWith('.vercel.app')) {
    return '';
  }

  const normalizedConfiguredUrl = normalizeUrl(configuredUrl);

  if (normalizedConfiguredUrl) {
    return normalizedConfiguredUrl;
  }

  return CANONICAL_HOSTS.has(normalizedHostname) ? CANONICAL_API_URL : '';
}

export function resolvePublicSignupEnabled(configuredValue, isProduction = false) {
  if (configuredValue === undefined || configuredValue === null || configuredValue === '') {
    return !isProduction;
  }

  return String(configuredValue).trim().toLowerCase() === 'true';
}

function parseBooleanEnv(value, defaultValue = true) {
  if (value === undefined || value === null || value === '') {
    return defaultValue;
  }

  const normalized = String(value).trim().toLowerCase();

  if (['false', '0', 'off', 'no'].includes(normalized)) {
    return false;
  }

  if (['true', '1', 'on', 'yes'].includes(normalized)) {
    return true;
  }

  return defaultValue;
}

const rawApiBaseUrl =
  import.meta.env.VITE_API_URL_OVERRIDE ||
  import.meta.env.VITE_API_URL ||
  import.meta.env.VITE_API_BASE_URL ||
  '';

export const apiBaseUrl = resolveApiBaseUrl(rawApiBaseUrl);
export const ocrEnabled = parseBooleanEnv(import.meta.env.VITE_ENABLE_OCR, true);
export const publicSignupEnabled = resolvePublicSignupEnabled(
  import.meta.env.VITE_PUBLIC_SIGNUP_ENABLED,
  import.meta.env.PROD
);

export function isBackendEnabled() {
  return Boolean(apiBaseUrl);
}

export function getPreferredDataSource() {
  return isBackendEnabled() ? 'api' : 'indexeddb';
}

export function isOcrEnabled() {
  return ocrEnabled;
}

export function isPublicSignupEnabled() {
  return publicSignupEnabled;
}
