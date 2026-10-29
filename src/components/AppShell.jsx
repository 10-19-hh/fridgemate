import Header from './Header';
import ConnectionStatusToast from './ConnectionStatusToast';
import SiteFooter from './SiteFooter';
import AnalyticsConsentBanner from './AnalyticsConsentBanner';
import MealPlanPilotNotice from './MealPlanPilotNotice';

function AppShell({ children }) {
  return (
    <div className="min-h-screen">
      <a href="#main-content" onClick={() => document.getElementById('main-content')?.focus()}
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[60] focus:rounded-lg focus:bg-white focus:px-4 focus:py-3 focus:text-green-900 focus:ring-2 focus:ring-green-700">
        본문 바로가기
      </a>
      <Header />
      <ConnectionStatusToast />
      <main id="main-content" tabIndex={-1} className="app-frame scroll-mt-72">
        <MealPlanPilotNotice />
        {children}
      </main>
      <SiteFooter />
      <AnalyticsConsentBanner />
    </div>
  );
}

export default AppShell;
