import { renderToStaticMarkup } from 'react-dom/server';
import { StaticRouter } from 'react-router';
import AppServer from './AppServer';
import { AnalyticsProvider } from './hooks/useAnalytics';
import { AuthProvider } from './hooks/useAuth';
import { IngredientsProvider } from './hooks/useIngredients';
import { PantryStaplesProvider } from './hooks/usePantryStaples';
import { MenuDecisionProvider } from './hooks/useMenuDecision';
import { UserPreferencesProvider } from './hooks/useUserPreferences';
import RecipeQuantityProvider from './features/recipes/RecipeQuantityProvider';

export function render(pathname) {
  return renderToStaticMarkup(
    <StaticRouter location={pathname}>
      <AuthProvider>
        <AnalyticsProvider>
          <PantryStaplesProvider>
            <UserPreferencesProvider>
              <MenuDecisionProvider>
                <IngredientsProvider>
                  <RecipeQuantityProvider><AppServer /></RecipeQuantityProvider>
                </IngredientsProvider>
              </MenuDecisionProvider>
            </UserPreferencesProvider>
          </PantryStaplesProvider>
        </AnalyticsProvider>
      </AuthProvider>
    </StaticRouter>
  );
}
