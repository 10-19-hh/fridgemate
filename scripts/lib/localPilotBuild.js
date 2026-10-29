import process from 'node:process';
import { devNull } from 'node:os';
import { isLocalPilotBuild } from '../../src/utils/pilotMode.js';

export function assertPilotPreviewTarget(env) {
  if (['VERCEL_ENV', 'VERCEL_TARGET_ENV'].some(key => String(env[key] || '').trim().toLowerCase() === 'production')) {
    throw new Error('A local pilot build is not permitted in a production deployment target.');
  }
}

export function getBuildOutputDirectory(env = process.env) {
  return isLocalPilotBuild(env) ? 'dist-pilot' : 'dist';
}

/** Do not inherit credentials, Node injection flags, or unrelated VITE_* values. */
export function createPilotBuildEnvironment(env) {
  assertPilotPreviewTarget(env);
  const keys = ['PATH', 'HOME', 'TMPDIR', 'TMP', 'TEMP', 'SYSTEMROOT', 'WINDIR', 'CI', 'NO_COLOR', 'FORCE_COLOR',
    'VERCEL', 'VERCEL_ENV', 'VERCEL_TARGET_ENV'];
  const result = Object.fromEntries(keys.filter(key => typeof env[key] === 'string').map(key => [key, env[key]]));
  return { ...result,
    VITE_LOCAL_PILOT_ENABLED: 'true', VITE_API_URL: '', VITE_API_URL_OVERRIDE: '', VITE_API_BASE_URL: '',
    VITE_GA_MEASUREMENT_ID: '', VITE_SENTRY_DSN: '',
    VITE_ADSENSE_ENABLED: 'false', VITE_ADSENSE_VERIFICATION_ENABLED: 'false', VITE_ADSENSE_SERVING_ENABLED: 'false',
    VITE_ENABLE_EXTERNAL_AI_DATA_PROCESSING: 'false', VITE_ENABLE_REMOTE_IMPORT_LEARNING: 'false',
    VITE_PUBLIC_SIGNUP_ENABLED: 'false', VITE_ENABLE_OCR: 'true',
    npm_config_userconfig: devNull, npm_config_update_notifier: 'false', npm_config_audit: 'false', npm_config_fund: 'false'
  };
}

/** A separate CLI-selected config; this never changes the Git deployment config. */
export function createPilotVercelConfig(source) {
  const rewrites = source.rewrites || [];
  if (!Array.isArray(rewrites) || rewrites.some(rule => typeof rule.destination !== 'string'
    || !rule.destination.startsWith('/') || rule.destination.startsWith('//'))) {
    throw new Error('Pilot Preview rewrites must stay within the static deployment.');
  }
  const headers = (source.headers || []).map(rule => ({ ...rule,
    headers: rule.headers.filter(header => !['content-security-policy', 'x-robots-tag'].includes(header.key.toLowerCase()))
  })).filter(rule => rule.headers.length);
  const csp = ["default-src 'self'", "base-uri 'self'", "object-src 'none'", "frame-ancestors 'none'", "form-action 'self'",
    "script-src 'self' 'wasm-unsafe-eval'", "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https://www.foodsafetykorea.go.kr", "font-src 'self' data:", "connect-src 'self'",
    "worker-src 'self' blob:", "child-src 'self' blob:", "frame-src 'none'", "manifest-src 'self'", "media-src 'self' blob:",
    'upgrade-insecure-requests'].join('; ');
  headers.push({ source: '/(.*)', headers: [
    { key: 'X-Robots-Tag', value: 'noindex, nofollow, noarchive' },
    { key: 'Content-Security-Policy', value: csp }
  ] });
  return { buildCommand: 'npm run build:pilot', outputDirectory: 'dist-pilot', redirects: [],
    headers, rewrites: structuredClone(rewrites) };
}
