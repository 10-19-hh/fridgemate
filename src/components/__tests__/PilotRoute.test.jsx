import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import AppRoutes from '../AppRoutes';
import SiteFooter from '../SiteFooter';
import RouteMetadata from '../RouteMetadata';
import { getRouteMetadata, PUBLIC_ROUTES } from '../../utils/routeMetadata';

const Placeholder = () => <h1>다른 화면</h1>;
const Pilot = () => <h1>식단 파일럿 참여</h1>;
const pages = Object.fromEntries(['AboutPage', 'AccountPage', 'ContactPage', 'HomePage', 'GuidePage', 'ImportPage',
  'IngredientHubPage', 'IngredientFormPage', 'IngredientsPage', 'LoginPage', 'MealPlanPage', 'NotFoundPage',
  'PrivacyPage', 'PublicRecipePage', 'RecipesPage', 'SignupPage'].map(name => [name, Placeholder]));
pages.MealPlanPilotPage = Pilot;
afterEach(() => { cleanup(); vi.unstubAllEnvs(); });

it('exposes a guest-accessible pilot route and a distinct footer link without changing analysis settings', () => {
  vi.stubEnv('VITE_LOCAL_PILOT_ENABLED', 'false');
  render(<MemoryRouter initialEntries={['/pilot']}><AppRoutes pages={pages} ocrEnabled={false} /><SiteFooter /></MemoryRouter>);
  expect(screen.queryByRole('heading', { name: '식단 파일럿 참여' })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: '파일럿 기록 관리' })).toHaveAttribute('href', '/pilot');
  expect(screen.getByRole('button', { name: '분석 설정' })).toBeInTheDocument();
});

it('marks pilot settings as a functional noindex route and excludes them from the public sitemap', async () => {
  expect(getRouteMetadata('/pilot')).toMatchObject({ indexable: false, notFound: false });
  expect(PUBLIC_ROUTES).not.toContain('/pilot');
  document.head.innerHTML = '<title>Base</title><meta name="robots" content="index,follow"><link rel="canonical">';
  render(<MemoryRouter initialEntries={['/pilot']}><RouteMetadata /></MemoryRouter>);
  await waitFor(() => expect(document.querySelector('meta[name="robots"]')).toHaveAttribute('content', 'noindex,follow'));
  expect(document.querySelector('link[rel="canonical"]')).toHaveAttribute('href', 'https://xn--wh1bs8l5xa003adme.com/pilot');
});
