import { Link } from 'react-router-dom';
import { openAnalyticsConsentSettings } from '../utils/analyticsConsent';
import { isLocalPilotBuild } from '../utils/pilotMode';

function SiteFooter() {
  return (
    <footer className="app-footer">
      <div className="mx-auto flex w-full max-w-4xl flex-wrap items-center justify-between gap-3 px-4 sm:px-6 lg:px-10">
        <p>오늘뭐먹지 (FridgeMate)</p>
        <nav aria-label="사이트 안내" className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <Link to="/about" className="font-medium text-slate-600 hover:text-slate-900">
            서비스 소개
          </Link>
          <Link to="/contact" className="font-medium text-slate-600 hover:text-slate-900">
            문의
          </Link>
          <Link to="/privacy" className="font-medium text-slate-600 hover:text-slate-900">
            개인정보 처리 안내
          </Link>
          <Link to="/guides/fridge-cleanout" className="font-medium text-slate-600 hover:text-slate-900">
            냉장고 활용 가이드
          </Link>
          <Link to="/pilot" className="min-h-11 inline-flex items-center font-medium text-slate-600 hover:text-slate-900">
            {isLocalPilotBuild() ? '식단 파일럿' : '파일럿 기록 관리'}
          </Link>
          <button
            className="min-h-11 font-medium text-slate-600 underline-offset-2 hover:text-slate-900 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-700"
            onClick={openAnalyticsConsentSettings}
            type="button"
          >
            분석 설정
          </button>
        </nav>
      </div>
    </footer>
  );
}

export default SiteFooter;
