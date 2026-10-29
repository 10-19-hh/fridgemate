import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import * as Sentry from '@sentry/react';
import App from './App';
import { AnalyticsProvider } from './hooks/useAnalytics';
import { AuthProvider } from './hooks/useAuth';
import { IngredientsProvider } from './hooks/useIngredients';
import { PantryStaplesProvider } from './hooks/usePantryStaples';
import { MenuDecisionProvider } from './hooks/useMenuDecision';
import { UserPreferencesProvider } from './hooks/useUserPreferences';
import { createSentryPrivacyOptions } from './utils/sentryPrivacy';
import { isLocalPilotBuild } from './utils/pilotMode.js';
import { purgeExpiredMealPlanPilots } from './features/mealPlans/mealPlanPilotRetention';
import './index.css';

if (!isLocalPilotBuild() && import.meta.env.VITE_SENTRY_DSN) {
  Sentry.init({
    dsn: import.meta.env.VITE_SENTRY_DSN,
    environment: import.meta.env.MODE,
    ...createSentryPrivacyOptions({ origin: globalThis.location.origin }),
  });
}

// Once per application load, including scopes that are not currently signed in.
// Pilot retention must not block cooking, stock access, or application startup.
void purgeExpiredMealPlanPilots().then(result => {
  if (!result.supported || result.failedScopes > 0) {
    console.warn('파일럿 보관 기간 정리를 완료하지 못했습니다. 다음 실행에서 다시 확인합니다.');
  }
}).catch(() => {
  console.warn('파일럿 보관 기간 정리를 완료하지 못했습니다. 다음 실행에서 다시 확인합니다.');
});

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <AnalyticsProvider>
          <PantryStaplesProvider>
            <UserPreferencesProvider>
              <MenuDecisionProvider>
                <IngredientsProvider>
                  <App />
                </IngredientsProvider>
              </MenuDecisionProvider>
            </UserPreferencesProvider>
          </PantryStaplesProvider>
        </AnalyticsProvider>
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>
);
