import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { getMealPlanPilotCapture, subscribeMealPlanPilotCapture } from '../features/mealPlans/mealPlanPilotCollector';

function ScopedPilotNotice({ scope }) {
  const [capture, setCapture] = useState(null);
  const previouslyActive = useRef(false);

  useEffect(() => {
    let current = true;
    let requestId = 0;
    const refresh = async () => {
      if (!current) return;
      const request = ++requestId;
      try {
        const next = await getMealPlanPilotCapture(scope);
        if (!current || request !== requestId) return;
        previouslyActive.current = next.status === 'active';
        setCapture(next);
      } catch {
        if (!current || request !== requestId) return;
        setCapture(previouslyActive.current ? { status: 'unknown' } : null);
      }
    };
    refresh();
    // One shared focus listener lives in the collector subscription.
    const unsubscribe = subscribeMealPlanPilotCapture(scope, refresh);
    return () => {
      current = false;
      unsubscribe();
    };
  }, [scope]);

  const paused = capture?.status === 'active' && capture.captureState === 'paused';
  if (!paused && capture?.status !== 'unknown') return null;

  return (
    <section aria-label="파일럿 기록 상태" className="mx-auto mb-4 w-full max-w-4xl px-4 sm:px-6 lg:px-10">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm leading-6 text-amber-900">
        <p aria-live="polite">{paused
          ? '파일럿 기록이 일시 중지됐어요. 식단·조리·입고 기능은 계속 사용할 수 있어요.'
          : '참여 중이던 파일럿 기록 상태를 확인하지 못했어요. 식단·조리·입고 기능은 계속 사용할 수 있어요.'}</p>
        <Link to="/pilot" className="inline-flex min-h-11 items-center font-semibold underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-700">파일럿 상태 확인</Link>
      </div>
    </section>
  );
}

function MealPlanPilotNotice() {
  const { pathname } = useLocation();
  const { storageScope, loading } = useAuth();
  if (loading || pathname === '/pilot') return null;
  return <ScopedPilotNotice key={storageScope} scope={storageScope} />;
}

export default MealPlanPilotNotice;
