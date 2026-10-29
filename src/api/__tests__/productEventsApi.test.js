import { beforeEach, describe, expect, it, vi } from 'vitest';

const { analyticsConsentMock, backendEnabledMock, requestJsonMock } = vi.hoisted(() => ({
  analyticsConsentMock: vi.fn(),
  backendEnabledMock: vi.fn(),
  requestJsonMock: vi.fn()
}));

vi.mock('../apiClient', () => ({
  requestJson: requestJsonMock
}));

vi.mock('../../utils/analyticsConsent', async (importOriginal) => ({
  ...await importOriginal(),
  getAnalyticsConsent: analyticsConsentMock
}));

vi.mock('../../utils/backendConfig', () => ({
  isBackendEnabled: backendEnabledMock
}));

import {
  buildProductEventPayload,
  normalizeProductEventRoute,
  saveProductEvent
} from '../productEventsApi';

const ANALYTICS_PAYLOAD = {
  client_event_id: 'event-1',
  event_name: 'page_view',
  occurred_at: '2026-08-30T00:00:00.000Z',
  session_id: 'raw-session-id',
  analytics_id: 'raw-analytics-id',
  user_id: 'raw-user-id',
  user_mode: 'authenticated',
  route: '/recipes',
  device_type: 'desktop',
  network_state: 'online',
  recipe_name: 'free-form recipe name'
};

describe('productEventsApi', () => {
  beforeEach(() => {
    analyticsConsentMock.mockReset().mockReturnValue('granted');
    backendEnabledMock.mockReset().mockReturnValue(true);
    requestJsonMock.mockReset().mockResolvedValue({ created: true });
  });

  it('omits raw user, session, and analytics identifiers from the server payload', () => {
    const payload = buildProductEventPayload(ANALYTICS_PAYLOAD);

    expect(payload).not.toHaveProperty('userId');
    expect(payload).not.toHaveProperty('sessionId');
    expect(payload).not.toHaveProperty('analyticsId');
    expect(JSON.stringify(payload)).not.toMatch(/raw-(?:user|session|analytics)-id/u);
    expect(payload.properties).not.toHaveProperty('user_mode');
    expect(payload.properties).not.toHaveProperty('recipe_name');
  });

  it('replaces dynamic or unknown routes with non-identifying templates', () => {
    expect(normalizeProductEventRoute('/ingredients/private-record-id/edit?from=home')).toBe(
      '/ingredients/:id/edit'
    );
    expect(normalizeProductEventRoute('/private/person@example.com')).toBe('/other');
  });

  it.each([null, 'denied'])('does not send product events when consent is %s', async (consent) => {
    analyticsConsentMock.mockReturnValue(consent);

    await expect(saveProductEvent(ANALYTICS_PAYLOAD)).resolves.toBeNull();

    expect(requestJsonMock).not.toHaveBeenCalled();
  });

  it('uses authenticated request handling after consent', async () => {
    await saveProductEvent(ANALYTICS_PAYLOAD);

    expect(requestJsonMock).toHaveBeenCalledWith(
      '/product-events',
      expect.objectContaining({ method: 'POST' }),
      { authMode: 'required' }
    );
  });

  it('keeps guest analytics browser-local instead of generating authenticated 401 traffic', async () => {
    await expect(saveProductEvent({ ...ANALYTICS_PAYLOAD, user_mode: 'guest' })).resolves.toBeNull();
    expect(requestJsonMock).not.toHaveBeenCalled();
  });
});
