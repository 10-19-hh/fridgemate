import { Link, NavLink, useLocation } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { isOcrEnabled, isPublicSignupEnabled } from '../utils/backendConfig';

const navItems = [
  { label: '\uD648', shortLabel: '\uD648', icon: '\u2302', to: '/', match: (pathname) => pathname === '/' },
  { label: '주간 식단', shortLabel: '주간 식단', icon: '▦', to: '/meal-plan', match: (pathname) => pathname === '/meal-plan' },
  {
    label: '\uB0C9\uC7A5\uACE0 \uBCF4\uAE30',
    shortLabel: '\uB0C9\uC7A5\uACE0',
    icon: '\u25A3',
    to: '/ingredients',
    match: (pathname) => pathname === '/ingredients' || /^\/ingredients\/[^/]+\/edit$/.test(pathname)
  },
  { label: '\uC9C1\uC811 \uC785\uB825', shortLabel: '\uCD94\uAC00', icon: '+', to: '/ingredients/new', match: (pathname) => pathname === '/ingredients/new' },
  { label: '\uC0AC\uC9C4\uC73C\uB85C \uB4F1\uB85D', shortLabel: '\uC0AC\uC9C4 \uB4F1\uB85D', icon: '\u25A1', to: '/import', match: (pathname) => pathname.startsWith('/import') },
  { label: '\uBA54\uB274 \uCD94\uCC9C', shortLabel: '\uBA54\uB274 \uCD94\uCC9C', icon: '\u25CE', to: '/recipes', match: (pathname) => pathname.startsWith('/recipes') }
];

function Header() {
  const location = useLocation();
  const ocrEnabled = isOcrEnabled();
  const publicSignupEnabled = isPublicSignupEnabled();
  const { isAuthenticated, logout, user } = useAuth();
  const visibleNavItems = ocrEnabled ? navItems : navItems.filter((item) => item.to !== '/import');

  return (
    <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur-xl">
      <div className="py-3">
        <div className="app-header-frame mx-auto w-full max-w-4xl px-4 sm:px-6 lg:px-10">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0 flex-1">
              <p className="kicker">오늘뭐먹지 (FridgeMate)</p>
              <p className="mt-1 text-lg font-semibold text-slate-900 sm:text-[1.25rem]">
                저녁 식단부터 장보기·조리 기록까지
              </p>
              <p className="max-w-2xl text-sm leading-5.5 muted">
                냉장고 재료를 확인하고, 이번 주에 먹을 메뉴와 준비할 재료를 정해보세요.
              </p>
            </div>

            <div className="flex w-full flex-wrap items-center justify-end gap-2 rounded-lg border border-slate-200 bg-white px-2 py-2 shadow-sm lg:w-auto">
              {isAuthenticated ? (
                <>
                  <span className="max-w-full truncate rounded-full bg-slate-100 px-3 py-2 text-sm font-medium text-slate-600 sm:max-w-[18rem]">
                    {user?.email}
                  </span>
                  <NavLink className="btn-secondary min-h-[2.25rem] px-3 py-2" to="/account">
                    {'\uACC4\uC815'}
                  </NavLink>
                  <button className="btn-primary min-h-[2.25rem] px-3 py-2" onClick={() => logout()} type="button">
                    {'\uB85C\uADF8\uC544\uC6C3'}
                  </button>
                </>
              ) : (
                <>
                  <NavLink className="btn-secondary min-h-[2.25rem] px-3 py-2" to="/login">
                    {'\uB85C\uADF8\uC778'}
                  </NavLink>
                  {publicSignupEnabled ? (
                    <NavLink className="btn-primary min-h-[2.25rem] px-3 py-2" to="/signup">
                      {'\uD68C\uC6D0\uAC00\uC785'}
                    </NavLink>
                  ) : null}
                </>
              )}
            </div>
          </div>
        </div>

        <div className="app-nav-frame mx-auto mt-3 w-full max-w-4xl px-4 sm:px-6 lg:px-10">
          <nav className="primary-nav glass-card touch-pan-x flex w-full max-w-full items-center gap-1.5 overflow-x-auto p-1.5">
            {visibleNavItems.map((item) => {
              const isActive = item.match(location.pathname);

              return (
                <Link
                  key={item.to}
                  to={item.to}
                  aria-current={isActive ? 'page' : undefined}
                  className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-2 text-sm font-medium ${
                    isActive
                      ? 'bg-green-700 text-white shadow-sm'
                      : 'text-stone-600 hover:bg-green-50 hover:text-green-700'
                  }`}
                >
                  <span aria-hidden="true" className="text-[13px] leading-none">
                    {item.icon}
                  </span>
                  <span>{item.shortLabel || item.label}</span>
                </Link>
              );
            })}
          </nav>
        </div>
      </div>
    </header>
  );
}

export default Header;
