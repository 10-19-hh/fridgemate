import { lazy, Suspense } from 'react';
import AppShell from './components/AppShell';
import AppRoutes from './components/AppRoutes';
import RouteMetadata from './components/RouteMetadata';
import { isOcrEnabled } from './utils/backendConfig';

const pages = {
  AboutPage: lazy(() => import('./pages/AboutPage')),
  AccountPage: lazy(() => import('./pages/AccountPage')),
  ContactPage: lazy(() => import('./pages/ContactPage')),
  HomePage: lazy(() => import('./pages/HomePage')),
  GuidePage: lazy(() => import('./pages/GuidePage')),
  ImportPage: lazy(() => import('./pages/ImportPage')),
  IngredientHubPage: lazy(() => import('./pages/IngredientHubPage')),
  IngredientFormPage: lazy(() => import('./pages/IngredientFormPage')),
  IngredientsPage: lazy(() => import('./pages/IngredientsPage')),
  LoginPage: lazy(() => import('./pages/LoginPage')),
  MealPlanPage: lazy(() => import('./pages/MealPlanPage')),
  MealPlanPilotPage: lazy(() => import('./pages/MealPlanPilotPage')),
  NotFoundPage: lazy(() => import('./pages/NotFoundPage')),
  PrivacyPage: lazy(() => import('./pages/PrivacyPage')),
  PublicRecipePage: lazy(() => import('./pages/PublicRecipePage')),
  RecipesPage: lazy(() => import('./pages/RecipesPage')),
  SignupPage: lazy(() => import('./pages/SignupPage'))
};

function PageLoadingFallback() {
  return (
    <div
      className="section-shell mx-auto min-h-[40vh] w-full max-w-4xl px-4 sm:px-6 lg:px-10"
      aria-busy="true"
      aria-label="페이지 불러오는 중"
    >
      <div className="h-5 w-24 animate-pulse rounded bg-slate-200" />
      <div className="mt-4 h-9 w-full max-w-xl animate-pulse rounded bg-slate-200" />
      <div className="mt-8 h-40 animate-pulse rounded-lg bg-slate-100" />
    </div>
  );
}

function App() {
  return (
    <AppShell>
      <RouteMetadata />
      <Suspense fallback={<PageLoadingFallback />}>
        <AppRoutes pages={pages} ocrEnabled={isOcrEnabled()} />
      </Suspense>
    </AppShell>
  );
}

export default App;
