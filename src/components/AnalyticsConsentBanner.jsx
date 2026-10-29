import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Link } from 'react-router-dom';
import {
  ANALYTICS_CONSENT_OPEN_EVENT,
  getAnalyticsConsent,
  setAnalyticsConsent,
  subscribeToAnalyticsConsent
} from '../utils/analyticsConsent';
import { disableGoogleAnalytics, initializeGoogleAnalytics } from '../utils/googleAnalytics';

function getConsentSnapshot() {
  return getAnalyticsConsent() || 'unset';
}

function AnalyticsConsentBanner() {
  const choice = useSyncExternalStore(subscribeToAnalyticsConsent, getConsentSnapshot, () => 'loading');
  const [settingsRequested, setSettingsRequested] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const panelRef = useRef(null);
  const triggerRef = useRef(null);
  const focusOnOpen = useRef(false);
  const isOpen = choice === 'unset' || settingsRequested;

  useEffect(() => {
    if (choice === 'granted') {
      initializeGoogleAnalytics();
    } else {
      disableGoogleAnalytics();
    }
  }, [choice]);

  useEffect(() => {
    const handleOpen = () => {
      if (!panelRef.current?.contains(document.activeElement)) triggerRef.current = document.activeElement;
      focusOnOpen.current = !panelRef.current;
      setSettingsRequested(true);
      panelRef.current?.focus();
    };
    window.addEventListener(ANALYTICS_CONSENT_OPEN_EVENT, handleOpen);
    return () => window.removeEventListener(ANALYTICS_CONSENT_OPEN_EVENT, handleOpen);
  }, []);

  useEffect(() => {
    if (settingsRequested && focusOnOpen.current) {
      focusOnOpen.current = false;
      panelRef.current?.focus();
    }
  }, [settingsRequested]);

  const saveChoice = (value) => {
    const restoreFocus = panelRef.current?.contains(document.activeElement);
    const savedChoice = setAnalyticsConsent(value);
    if (savedChoice !== value) {
      setSaveError(true);
      setSettingsRequested(true);
      disableGoogleAnalytics();
      return;
    }

    setSaveError(false);
    setSettingsRequested(false);
    if (restoreFocus) {
      const trigger = triggerRef.current;
      const target = trigger?.isConnected && trigger !== document.body ? trigger : document.getElementById('main-content');
      target?.focus();
    }
    triggerRef.current = null;

    if (value === 'granted') {
      initializeGoogleAnalytics();
    } else {
      disableGoogleAnalytics();
    }
  };

  if (!isOpen) return null;

  return (
    <section
      ref={panelRef}
      tabIndex={-1}
      aria-labelledby="analytics-consent-title"
      aria-describedby="analytics-consent-description"
      className="mx-auto my-5 w-[calc(100%-1.5rem)] max-w-2xl scroll-mt-72 rounded-lg border border-slate-300 bg-white p-4 shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-green-700 sm:p-5"
      role="dialog"
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="max-w-xl">
          <p className="kicker">분석 설정</p>
          <h2 id="analytics-consent-title" className="mt-1 text-lg font-semibold text-slate-950">
            서비스 개선을 위한 이용 분석에 동의하시겠어요?
          </h2>
          <p id="analytics-consent-description" className="mt-2 text-sm leading-6 text-slate-600">
            동의한 로그인 사용자에 한해 최소 이용 기록을 자체 서버에 저장할 수 있고, 설정된 경우에만 Google
            Analytics를 불러옵니다. 이메일과 재료명은 분석 이벤트로 수집하지 않으며, 내부 사용자·세션 식별자는
            외부 분석 도구나 학습용 내보내기에 포함하지 않습니다. 선택은 언제든 변경할 수 있습니다.{' '}
            <Link className="font-semibold text-brand-700 underline underline-offset-2" to="/privacy">
              개인정보 처리 안내
            </Link>
          </p>
          {choice === 'granted' || choice === 'denied' ? (
            <p className="mt-2 text-xs font-medium text-slate-500">
              현재 설정: {choice === 'granted' ? '이용 분석 허용' : '필수 기능만 사용'}
            </p>
          ) : null}
          {saveError ? (
            <p className="mt-2 text-sm text-red-700" role="alert">
              선택을 저장하거나 이전 분석 정보를 정리하지 못했습니다. 현재 탭에서는 분석을 중지했습니다.
              다른 탭이나 다시 연 페이지에는 이전 설정이 남아 있을 수 있으니 브라우저 저장소 설정을
              확인한 뒤 다시 선택해 주세요.
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-col-reverse gap-2 sm:flex-row">
          <button
            className="btn-secondary min-h-11 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-700 focus-visible:ring-offset-2"
            onClick={() => saveChoice('denied')}
            type="button"
          >
            필수 기능만
          </button>
          <button
            className="btn-primary min-h-11 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-700 focus-visible:ring-offset-2"
            onClick={() => saveChoice('granted')}
            type="button"
          >
            분석 허용
          </button>
        </div>
      </div>
    </section>
  );
}

export default AnalyticsConsentBanner;
