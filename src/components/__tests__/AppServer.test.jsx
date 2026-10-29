// @vitest-environment node
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom';

let AppServer;
let AuthProvider;
let AnalyticsProvider;
let PantryStaplesProvider;
let UserPreferencesProvider;
let MenuDecisionProvider;
let IngredientsProvider;

beforeAll(async () => {
  vi.stubEnv('VITE_API_URL_OVERRIDE', '');
  vi.stubEnv('VITE_API_URL', '');
  vi.stubEnv('VITE_API_BASE_URL', '');
  vi.stubEnv('VITE_LOCAL_PILOT_ENABLED', 'false');
  ({ default: AppServer } = await import('../../AppServer'));
  ({ AuthProvider } = await import('../../hooks/useAuth'));
  ({ AnalyticsProvider } = await import('../../hooks/useAnalytics'));
  ({ PantryStaplesProvider } = await import('../../hooks/usePantryStaples'));
  ({ UserPreferencesProvider } = await import('../../hooks/useUserPreferences'));
  ({ MenuDecisionProvider } = await import('../../hooks/useMenuDecision'));
  ({ IngredientsProvider } = await import('../../hooks/useIngredients'));
});

afterEach(() => vi.restoreAllMocks());
afterAll(() => vi.unstubAllEnvs());

function render(pathname) {
  return renderToStaticMarkup(
    <StaticRouter location={pathname}>
      <AuthProvider>
        <AnalyticsProvider>
          <PantryStaplesProvider>
            <UserPreferencesProvider>
              <MenuDecisionProvider>
                <IngredientsProvider><AppServer /></IngredientsProvider>
              </MenuDecisionProvider>
            </UserPreferencesProvider>
          </PantryStaplesProvider>
        </AnalyticsProvider>
      </AuthProvider>
    </StaticRouter>
  );
}

it('renders the public home without invalid elements from an unregistered server route', () => {
  const errors = vi.spyOn(console, 'error');
  const html = render('/');

  expect(html).toContain('href="/pilot"');
  expect(errors).not.toHaveBeenCalled();
});

it.each([['false', '파일럿 기록 관리'], ['true', '식단 파일럿 참여']])('renders the real pilot page with build mode %s without claiming browser consent or collection', (enabled, title) => {
  vi.stubEnv('VITE_LOCAL_PILOT_ENABLED', enabled);
  const errors = vi.spyOn(console, 'error');
  const html = render('/pilot');

  expect(html).toMatch(new RegExp(`<h1\\b[^>]*>${title}</h1>`));
  expect(html).toContain('파일럿 상태를 확인하고 있어요.');
  expect(html).not.toContain('앞으로의 이용 기록 수집 중');
  expect(errors).not.toHaveBeenCalled();
});
