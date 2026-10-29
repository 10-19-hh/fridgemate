import { createContext, createElement, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { ingredientCache } from '../features/ingredients/ingredientRepository';
import { useAuth } from './useAuth';
import {
  buildAnalyticsPayload,
  hasTrackedSessionStarted,
  markSessionStartedTracked,
  recordAnalyticsEvent
} from '../utils/analytics';
import {
  getAnalyticsConsent,
  getAnalyticsConsentGeneration,
  subscribeToAnalyticsConsent
} from '../utils/analyticsConsent';

const AnalyticsContext = createContext({
  trackEvent: () => null
});

export function AnalyticsProvider({ children }) {
  const location = useLocation();
  const { isAuthenticated, loading, storageScope } = useAuth();
  const [analyticsConsent, setAnalyticsConsentState] = useState(getAnalyticsConsent);

  useEffect(() => {
    const handleConsentUpdate = () => setAnalyticsConsentState(getAnalyticsConsent());
    return subscribeToAnalyticsConsent(handleConsentUpdate);
  }, []);

  const trackEvent = useCallback(
    (eventName, properties = {}) => {
      if (analyticsConsent !== 'granted') return null;

      const payload = buildAnalyticsPayload({
        eventName,
        route: location.pathname,
        isAuthenticated,
        properties
      });

      return recordAnalyticsEvent(payload);
    },
    [analyticsConsent, isAuthenticated, location.pathname]
  );

  useEffect(() => {
    if (loading || analyticsConsent !== 'granted') return;

    trackEvent('page_view');
  }, [analyticsConsent, loading, location.pathname, trackEvent]);

  useEffect(() => {
    if (loading || analyticsConsent !== 'granted' || hasTrackedSessionStarted()) {
      return;
    }

    let isMounted = true;
    const generation = getAnalyticsConsentGeneration();
    markSessionStartedTracked();

    ingredientCache
      .getAll({ scope: storageScope })
      .then((items) => {
        if (!isMounted || generation !== getAnalyticsConsentGeneration()) {
          return;
        }

        trackEvent('session_started', {
          entry_route: location.pathname,
          has_existing_local_data: Array.isArray(items) && items.length > 0,
          has_restored_session: isAuthenticated
        });
      })
      .catch(() => {
        if (!isMounted || generation !== getAnalyticsConsentGeneration()) {
          return;
        }

        trackEvent('session_started', {
          entry_route: location.pathname,
          has_existing_local_data: false,
          has_restored_session: isAuthenticated
        });
      });

    return () => {
      isMounted = false;
    };
  }, [analyticsConsent, isAuthenticated, loading, location.pathname, storageScope, trackEvent]);

  const value = useMemo(
    () => ({
      trackEvent
    }),
    [trackEvent]
  );

  return createElement(AnalyticsContext.Provider, { value }, children);
}

export function useAnalytics() {
  return useContext(AnalyticsContext);
}
