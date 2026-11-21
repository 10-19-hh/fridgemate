import { beforeEach, describe, expect, it, vi } from 'vitest';

const { analyticsConsentMock, getAnalyticsSessionIdMock, requestJsonMock } = vi.hoisted(() => ({
  analyticsConsentMock: vi.fn(),
  getAnalyticsSessionIdMock: vi.fn(),
  requestJsonMock: vi.fn()
}));

vi.mock('../apiClient', () => ({
  ApiClientError: class ApiClientError extends Error {},
  requestJson: requestJsonMock
}));

vi.mock('../../utils/backendConfig', () => ({
  isBackendEnabled: () => true
}));

vi.mock('../../utils/analytics', () => ({
  getAnalyticsSessionId: getAnalyticsSessionIdMock
}));

vi.mock('../../utils/analyticsConsent', () => ({
  getAnalyticsConsent: analyticsConsentMock
}));

import { buildRecommendationEventPayload, saveRecommendationEvent } from '../recommendationEventsApi';

describe('recommendationEventsApi', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    analyticsConsentMock.mockReset().mockReturnValue('granted');
    getAnalyticsSessionIdMock.mockReset().mockReturnValue('test-session');
    requestJsonMock.mockReset();
  });

  it('uses explicit local and catalog recipe id namespaces', () => {
    expect(buildRecommendationEventPayload({ id: 'recipe-1' }, 'click').recipeId).toBe('local:recipe-1');
    expect(
      buildRecommendationEventPayload(
        { id: '11111111-1111-4111-8111-111111111111' },
        'impression'
      ).recipeId
    ).toBe('catalog:11111111-1111-4111-8111-111111111111');
    expect(buildRecommendationEventPayload({ id: 'catalog:known-id' }, 'click').recipeId).toBe(
      'catalog:known-id'
    );
  });

  it('keeps recipe quantity confirmations and private context out of analytics payloads', () => {
    const payload = buildRecommendationEventPayload({
      id: 'mfds:29', title: '부추 콩가루 찜', canMakeNow: false,
      quantitySource: { kind: 'mfds-cookrcp01', id: '29', version: '1' },
      quantityResult: { ingredients: [{ scaledAmount: 12.3456789 }], basis: { scope: 'private-user' } },
      quantityContext: { inventoryRevision: '[private raw inventory]', scope: 'private-user' },
      confirmation: { inventory: { items: [{ amount: 12.3456789 }] } },
    }, 'click');
    expect(payload.recipeId).toBe('local:mfds:29');
    const serialized = JSON.stringify(payload);
    for (const privateValue of ['quantitySource', 'quantityResult', 'quantityContext', 'confirmation', 'private-user', 'private raw inventory', '12.3456789']) {
      expect(serialized).not.toContain(privateValue);
    }
  });

  it('sends recommendation events sequentially to avoid connection bursts', async () => {
    let resolveFirstRequest;
    requestJsonMock
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirstRequest = resolve;
          })
      )
      .mockResolvedValueOnce({ id: 'event-2' });

    const firstRequest = saveRecommendationEvent({ id: 'recipe-1' }, 'impression');
    const secondRequest = saveRecommendationEvent({ id: 'recipe-2' }, 'impression');

    await vi.waitFor(() => expect(requestJsonMock).toHaveBeenCalledTimes(1));
    resolveFirstRequest({ id: 'event-1' });
    await firstRequest;
    await vi.waitFor(() => expect(requestJsonMock).toHaveBeenCalledTimes(2));
    await secondRequest;

    expect(requestJsonMock).toHaveBeenLastCalledWith(
      '/recommendation-events',
      expect.any(Object),
      expect.objectContaining({ authMode: 'required' })
    );
  });

  it.each([null, 'denied'])('does not create identifiers or send when consent is %s', async (consent) => {
    analyticsConsentMock.mockReturnValue(consent);

    await expect(saveRecommendationEvent({ id: 'recipe-1' }, 'impression')).resolves.toBeNull();

    expect(getAnalyticsSessionIdMock).not.toHaveBeenCalled();
    expect(requestJsonMock).not.toHaveBeenCalled();
  });

  it('does not send an event when secure randomness is unavailable', async () => {
    vi.stubGlobal('crypto', undefined);

    await expect(saveRecommendationEvent({ id: 'recipe-1' }, 'impression')).resolves.toBeNull();

    expect(requestJsonMock).not.toHaveBeenCalled();
  });
});
