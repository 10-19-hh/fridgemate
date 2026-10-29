import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveApiBaseUrl } from '../backendConfig.js';
import { getAdSenseConfig } from '../adsenseConfig.js';
import { initializeGoogleAnalytics } from '../googleAnalytics.js';
import { setAnalyticsConsent } from '../analyticsConsent.js';
import { isExternalAiUiEnabled, createExternalAiRequestSignal } from '../../api/externalAiRequest.js';
import { getImportCorrectionSuggestions, saveImportCorrectionsRemote } from '../../api/importCorrectionsApi.js';
import { requestJson } from '../../api/apiClient.js';

describe('explicit local pilot outbound isolation', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_LOCAL_PILOT_ENABLED', 'true');
    window.localStorage.clear();
    document.head.querySelectorAll('script[data-fridgemate-ga]').forEach(script => script.remove());
    delete window.gtag;
    delete window.dataLayer;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    window.localStorage.clear();
    document.head.querySelectorAll('script[data-fridgemate-ga]').forEach(script => script.remove());
    delete window.gtag;
    delete window.dataLayer;
  });

  // A missing pilot guard would re-enable the canonical production fallback.
  it.each(['true', ' TRUE ', 'TrUe'])('disables the canonical fallback for the explicit flag %s', flag => {
    vi.stubEnv('VITE_LOCAL_PILOT_ENABLED', flag);
    expect(resolveApiBaseUrl('', 'xn--wh1bs8l5xa003adme.com')).toBe('');
  });

  it('ignores an explicitly configured backend on a custom pilot origin', () => {
    expect(resolveApiBaseUrl('https://synthetic.invalid/api', 'pilot.example.invalid')).toBe('');
  });

  // Truthy aliases must not silently change ordinary builds to pilot mode.
  it.each(['false', '', '1', 'yes', 'on'])('preserves the normal canonical fallback for %s', flag => {
    vi.stubEnv('VITE_LOCAL_PILOT_ENABLED', flag);
    expect(resolveApiBaseUrl('', 'xn--wh1bs8l5xa003adme.com'))
      .toBe('https://api.xn--wh1bs8l5xa003adme.com/api');
  });

  it('blocks even direct API calls before fetch, including same-origin relative paths', async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ accepted: true }) });
    vi.stubGlobal('fetch', fetch);
    await expect(requestJson('/auth/signup', { method: 'POST' }, { authMode: 'never' }))
      .rejects.toMatchObject({ code: 'LOCAL_PILOT_ONLY' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('does not activate advertising or ownership verification despite inherited publisher configuration', () => {
    const config = getAdSenseConfig({ VITE_LOCAL_PILOT_ENABLED: 'true', VITE_ADSENSE_ENABLED: 'true',
      VITE_ADSENSE_VERIFICATION_ENABLED: 'true', VITE_ADSENSE_SERVING_ENABLED: 'true',
      VITE_ADSENSE_CLIENT: 'ca-pub-1234567890123456', VITE_ADSENSE_HOME_SLOT: '1234567890' });
    expect(config).toMatchObject({ requested: false, servingRequested: false, verificationEnabled: false, enabled: false });
  });

  it('does not install GA when the user consented and a measurement ID is configured', () => {
    vi.stubEnv('VITE_GA_MEASUREMENT_ID', 'G-PILOTFIXTURE');
    setAnalyticsConsent('granted');
    expect(initializeGoogleAnalytics()).toBe(false);
    expect(document.head.querySelector('script[data-fridgemate-ga]')).toBeNull();
    expect(window.gtag).toBeUndefined();
  });

  it('ignores external AI activation and a disclosed user action', () => {
    vi.stubEnv('VITE_ENABLE_EXTERNAL_AI_DATA_PROCESSING', 'true');
    expect(isExternalAiUiEnabled()).toBe(false);
    expect(createExternalAiRequestSignal('semantic_recipe_recommendations', { userInitiated: true })).toBeNull();
  });

  it('keeps correction suggestions and learning local despite inherited remote switches', async () => {
    vi.stubEnv('VITE_ENABLE_EXTERNAL_AI_DATA_PROCESSING', 'true');
    vi.stubEnv('VITE_ENABLE_REMOTE_IMPORT_LEARNING', 'true');
    const fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ accepted: true }) });
    vi.stubGlobal('fetch', fetch);
    const items = [{ id: 'fixture-item', name: '우유' }];
    await expect(getImportCorrectionSuggestions(items, { userInitiated: true })).resolves.toEqual({ suggestions: {} });
    await expect(saveImportCorrectionsRemote(items, { userInitiated: true })).resolves.toEqual({ savedCount: 0 });
    expect(fetch).not.toHaveBeenCalled();
  });
});
