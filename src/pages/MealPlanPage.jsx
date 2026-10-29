import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import MealPlanShoppingPreview from '../components/MealPlanShoppingPreview';
import ShoppingNotesPanel from '../components/ShoppingNotesPanel';
import MealPlanEditor from '../components/mealPlans/MealPlanEditor';
import MealPlanOverdueNotice from '../components/mealPlans/MealPlanOverdueNotice';
import { shortDate } from '../components/mealPlans/mealPlanDisplay';
import MealCookingPanel from '../components/MealCookingPanel';
import MealPlanChangePanel from '../components/MealPlanChangePanel';
import { useAuth } from '../hooks/useAuth';
import { useIngredients } from '../hooks/useIngredients';
import { useMealPlan } from '../hooks/useMealPlan';
import { usePantryStaples } from '../hooks/usePantryStaples';
import { PANTRY_STATUS } from '../data/pantryStaples';
import { addCalendarDays, getWeekStart } from '../features/mealPlans/mealPlanDomain';
import { getOverdueMealPlanDraftConflicts } from '../features/mealPlans/mealPlanRepository';

function localDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function useLocalToday() {
  const [today, setToday] = useState(() => localDate(new Date()));
  useEffect(() => {
    let timer;
    function schedule() {
      clearTimeout(timer);
      const now = new Date();
      const midnight = new Date(now);
      midnight.setHours(24, 0, 0, 0);
      timer = setTimeout(refresh, Math.max(1, midnight.getTime() - now.getTime()));
    }
    function refresh() { setToday(localDate(new Date())); schedule(); }
    schedule();
    window.addEventListener('focus', refresh);
    return () => { clearTimeout(timer); window.removeEventListener('focus', refresh); };
  }, []);
  return today;
}

function MealPlanWorkspace() {
  const today = useLocalToday();
  const [weekStart, setWeekStart] = useState(() => getWeekStart());
  const { plan, record, confirmedPlan, hasDraft, recordRevision, loading, ready, saving, error, savePlan, generatePlan, confirmPlan, restoreOverdueDraft, retryLoad, storageScope } = useMealPlan(weekStart);
  const overdueConflicts = getOverdueMealPlanDraftConflicts(record, today);
  const { ingredients, loading: inventoryLoading, error: inventoryError, loadIngredients } = useIngredients();
  const [receiptRevision, setReceiptRevision] = useState(0);
  const [cookingRevision, setCookingRevision] = useState(0);
  const [cookingTarget, setCookingTarget] = useState(null);
  const [changeTarget, setChangeTarget] = useState(null);
  const cookingOpener = useRef(null);
  const changeOpener = useRef(null);
  const pageHeading = useRef(null);
  const cookingOpen = cookingTarget !== null;
  const changeOpen = changeTarget !== null;
  const navigationDisabled = saving || cookingOpen || changeOpen;
  function openChange(kind, slotId, opener) {
    if (saving || cookingOpen || changeOpen) return;
    changeOpener.current = opener; setChangeTarget({ kind, slotId });
  }
  function closeChange() {
    setChangeTarget(null);
    queueMicrotask(() => (changeOpener.current?.isConnected ? changeOpener.current : pageHeading.current)?.focus());
  }
  function openCooking(slotId, opener) { cookingOpener.current = opener; setCookingTarget({ slotId }); }
  function closeCooking() {
    setCookingTarget(null);
    queueMicrotask(() => (cookingOpener.current?.isConnected ? cookingOpener.current : pageHeading.current)?.focus());
  }
  const refreshAfterReceipt = useCallback(async () => {
    setReceiptRevision((revision) => revision + 1);
    await loadIngredients({ force: true });
  }, [loadIngredients]);
  const refreshAfterPlanningWrite = useCallback(async () => {
    setReceiptRevision(revision => revision + 1);
    setCookingRevision(revision => revision + 1);
    retryLoad();
    await loadIngredients({ force: true });
  }, [loadIngredients, retryLoad]);
  const { pantryStaples, pantryOwnership } = usePantryStaples();
  const pantryItems = useMemo(() => pantryStaples.filter((item) => pantryOwnership[item.id] === PANTRY_STATUS.OWNED).map((item) => item.name), [pantryStaples, pantryOwnership]);

  return (
    <div className="meal-plan-page section-shell mx-auto w-full max-w-4xl px-4 sm:px-6 lg:px-10">
      <header className="pb-1 pt-2">
        <p className="kicker">우리 집 저녁 식단</p>
        <h1 ref={pageHeading} tabIndex={-1} className="mt-2 text-2xl font-bold leading-tight tracking-tight text-slate-950 sm:text-3xl">이번 주 저녁, 미리 골라두세요</h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 muted">냉장고에 있는 재료와 우리 집 취향으로 한 주를 채워요. 마음에 드는 날은 고정하고, 나머지는 가볍게 바꿔보세요.</p>
      </header>

      <MealPlanOverdueNotice scope={storageScope} today={today} refreshKey={`${weekStart}:${recordRevision}:${receiptRevision}:${cookingRevision}`} disabled={navigationDisabled} onReviewWeek={week => {
        setWeekStart(week);
        queueMicrotask(() => pageHeading.current?.focus());
      }} />

      <div className="meal-plan-week-nav">
        <div className="flex items-center gap-2">
          <button className="meal-plan-action" type="button" aria-label="이전 주" disabled={navigationDisabled} onClick={() => setWeekStart(addCalendarDays(weekStart, -7))}>←</button>
          <h2 className="whitespace-nowrap text-lg font-semibold tabular-nums">{shortDate(weekStart)} — {shortDate(addCalendarDays(weekStart, 6))}</h2>
          <button className="meal-plan-action" type="button" aria-label="다음 주" disabled={navigationDisabled} onClick={() => setWeekStart(addCalendarDays(weekStart, 7))}>→</button>
        </div>
        <div className="flex w-full items-center gap-2 sm:w-auto">
          <label htmlFor="meal-plan-week" className="sr-only">주 시작일</label>
          <input id="meal-plan-week" className="min-w-0 sm:max-w-[10rem]" type="date" value={weekStart} disabled={navigationDisabled} onChange={(event) => {
            if (event.target.value) setWeekStart(getWeekStart(new Date(`${event.target.value}T12:00:00`)));
          }} />
          <button className="meal-plan-action shrink-0" type="button" disabled={navigationDisabled} onClick={() => setWeekStart(getWeekStart())}>이번 주</button>
        </div>
      </div>
      <button className="meal-plan-action self-start" type="button" disabled={navigationDisabled} onClick={event => openCooking(null, event.currentTarget)}>조리 이력 열기</button>

      {error && <div role="alert" className="rounded-md border border-red-200 bg-red-50 p-4 text-sm leading-6 text-red-900"><p>{error}</p><button type="button" className="mt-2 underline" disabled={saving || loading} onClick={retryLoad}>저장된 식단 다시 불러오기</button></div>}
      {loading ? <p className="py-12 text-center text-sm muted" role="status">식단을 불러오는 중이에요.</p> : ready && (
        <MealPlanEditor key={`${storageScope}:${weekStart}`} {...{ plan, confirmedPlan, hasDraft, weekStart, storageScope, saving, savePlan, generatePlan, confirmPlan, restoreOverdueDraft, overdueConflicts, today, ingredients, inventoryLoading, inventoryError, pantryItems }} editingDisabled={cookingOpen || changeOpen} onOpenCooking={openCooking} onOpenChange={openChange} />
      )}

      {cookingOpen ? <MealCookingPanel scope={storageScope} weekStart={weekStart} slotId={cookingTarget.slotId} onChanged={refreshAfterPlanningWrite} onClose={closeCooking} /> : null}
      {changeOpen ? <MealPlanChangePanel scope={storageScope} weekStart={weekStart} today={today} {...changeTarget} pantryItems={pantryItems} onChanged={refreshAfterPlanningWrite} onClose={closeChange} /> : null}

      <MealPlanShoppingPreview key={`shopping:${storageScope}:${weekStart}`} scope={storageScope} today={today} recordRevision={`${recordRevision}:${receiptRevision}`} disabled={loading || saving || !ready || cookingOpen || changeOpen} />

      <ShoppingNotesPanel scope={storageScope} today={today} resetKey={`${weekStart}:${recordRevision}:${cookingRevision}`} disabled={loading || saving || !ready || cookingOpen || changeOpen} onInventoryApplied={refreshAfterReceipt} />

      <aside className="border-t border-brand-100 pt-5 text-xs leading-6 muted" aria-label="식단 이용 안내">
        <p>식품군은 메뉴에 포함된 재료 구성을 알려줘요. 하루 영양 충족이나 건강 효과를 평가하지 않으며, 열량·탄단지 계산은 아직 제공하지 않아요.</p>
        <p className="mt-1">식단은 현재 브라우저에만 저장돼요. 게스트와 로그인 계정별로 분리되며, 다른 기기 동기화·백업 내보내기에는 포함되지 않아요. 식단을 편집해도 냉장고 수량과 기존 장보기 목록은 바뀌지 않아요.</p>
      </aside>
    </div>
  );
}

export default function MealPlanPage() {
  const { storageScope, loading } = useAuth();
  if (loading) return <p className="py-12 text-center text-sm muted" role="status">계정 정보를 확인하고 있어요.</p>;
  return <MealPlanWorkspace key={storageScope} />;
}
