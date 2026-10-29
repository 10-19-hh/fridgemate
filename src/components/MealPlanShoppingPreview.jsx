import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { getMealPlanningSnapshot } from '../features/mealPlans/mealPlanRepository';
import { allocateMealPlanInventory } from '../features/mealPlans/mealPlanAllocation';
import { createMealPlanPilotOperation, runMealPlanPilotAction } from '../features/mealPlans/mealPlanPilotActions';

const PREPARATION_LABELS = { raw: '조리 전', cooked: '조리 후', 'as-sold': '구매 상태' };
const REVIEW_REASONS = {
  'inventory-unverified': '보유 재료의 수량 확인이 필요해요.',
  'inventory-incompatible': '재료의 단위와 조리 상태를 확인해 주세요.',
  'inventory-expiry-unknown': '보유 재료의 기한 확인이 필요해요.',
  'inventory-expired': '식사일에 사용할 재료의 기한을 확인해 주세요.',
  'prior-demand-unverified': '함께 계산하는 식단에 사용량이 확인되지 않은 재료가 있어요.',
  'process-quantity-unverified': '조리 과정에 따로 쓰는 양은 원문을 보고 확인해 주세요.',
};

function localDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function PreviewList({ title, count, open = false, children }) {
  return (
    <details className="border-t border-brand-100 pt-3" open={open}>
      <summary className="cursor-pointer text-sm text-slate-900">
        <h3 className="inline font-semibold">{title}</h3>
        <span className="ml-2 text-xs muted" aria-hidden="true">{count}항목</span>
      </summary>
      <ul className="mt-2 divide-y divide-brand-100" aria-label={title}>{children}</ul>
    </details>
  );
}

function PreviewSession({ scope, disabled }) {
  const [state, setState] = useState({ status: 'idle', result: null, checkedAt: null });
  const mountedRef = useRef(false);
  const requestRef = useRef(null);

  useEffect(() => {
    mountedRef.current = true;
    const invalidate = () => {
      requestRef.current = null;
      setState((current) => current.status === 'idle' ? current : { status: 'stale', result: null, checkedAt: null });
    };
    window.addEventListener('focus', invalidate);
    return () => {
      mountedRef.current = false;
      requestRef.current = null;
      window.removeEventListener('focus', invalidate);
    };
  }, []);

  async function checkShopping() {
    if (disabled || requestRef.current) return;
    const request = {};
    requestRef.current = request;
    setState({ status: 'loading', result: null, checkedAt: null });
    try {
      const pilot = createMealPlanPilotOperation('shopping_list_recalculated');
      const isCurrent = () => mountedRef.current && requestRef.current === request;
      const calculated = await runMealPlanPilotAction({ scope, ...pilot, isCurrent }, async () => {
        let snapshot;
        try { snapshot = await getMealPlanningSnapshot(scope); }
        catch (error) { if (!isCurrent()) return null; throw error; }
        if (!isCurrent()) return null;
        if (snapshot.scope !== scope) throw new Error('Planning scope changed.');
        const checkedAt = new Date();
        const result = allocateMealPlanInventory({
          scope, confirmedPlans: snapshot.confirmedPlans,
          inventory: snapshot.inventory, today: localDate(checkedAt),
        });
        return { result, checkedAt };
      }, value => [{ name: 'shopping_list_recalculated', status: value ? 'success' : 'cancelled',
        sourceKey: `shopping_list_recalculated:${pilot.operationKey}`, operationKey: pilot.operationKey,
        occurredAt: value?.checkedAt.toISOString() ?? new Date().toISOString() }]);
      if (calculated && isCurrent()) setState({ status: 'ready', ...calculated });
    } catch {
      if (mountedRef.current && requestRef.current === request) {
        setState({ status: 'error', result: null, checkedAt: null });
      }
    } finally {
      if (requestRef.current === request) requestRef.current = null;
    }
  }

  const { result, checkedAt } = state;
  const shopping = result?.shopping;
  const overdue = shopping?.needsReview.filter(item => item.reason === 'overdue-meal-unconfirmed') || [];
  const reviewIngredients = shopping?.needsReview.filter(item => item.reason !== 'overdue-meal-unconfirmed') || [];
  const slotDates = new Map((result?.slots || []).map((slot) => [slot.id, slot.date]));
  const loading = state.status === 'loading';

  return (
    <section className="rounded-lg border border-brand-100 bg-white p-4 sm:p-5" aria-label="식단 장보기 미리보기" aria-busy={loading}>
      <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-slate-900">식단 장보기 미리보기</h2>
          <p className="mt-1 text-xs leading-5 text-brand-700">출처: 식단 · 읽기 전용</p>
        </div>
        <button type="button" className="btn-secondary w-full shrink-0 sm:w-auto" disabled={disabled || loading} onClick={checkShopping}>
          {state.status === 'idle' ? '식단 장보기 확인' : '다시 계산'}
        </button>
      </div>
      <p className="mt-3 max-w-2xl text-sm leading-6 muted">오늘부터 모든 주의 확정 식단과 아직 확인하지 않은 지난 끼니의 보류량을 함께 확인해요. 초안은 제외하며 냉장고 수량·직접 입력한 메모·재구매 목록을 바꾸지 않아요.</p>
      <p className="mt-1 text-xs leading-5 muted">구매 완료 처리나 조리 전 안전 확인을 대신하지 않아요. 다른 화면에서 수정했다면 다시 계산해 주세요.</p>
      <p className="mt-1 text-xs leading-5 muted">미등록 재료는 실제 미보유가 아니라 구매 또는 보유 확인 필요 상태예요. 아래 수량은 등록된 재고를 기준으로 계산해요.</p>

      {loading ? <p role="status" className="mt-3 text-sm text-brand-700">저장된 식단과 재료를 함께 확인하고 있어요.</p> : null}
      {state.status === 'stale' ? <p role="status" className="mt-3 text-sm text-amber-900">다른 화면의 변경을 반영하려면 다시 계산해 주세요.</p> : null}
      {state.status === 'error' ? <p role="alert" className="mt-3 text-sm text-red-800">저장된 식단과 재료를 확인하지 못했어요. 다시 계산해 주세요.</p> : null}

      {result ? (
        <div className="mt-4 space-y-3">
          <p className="text-xs leading-5 muted">
            이 기기에서 <time dateTime={checkedAt.toISOString()}>{checkedAt.toLocaleString('ko-KR')}</time>에 읽은 저장 상태예요.
            {' '}브라우저 현지 날짜 {result.today}부터 모든 확정 식단과 지난 미완료 끼니의 보류량을 반영했어요.
          </p>
          <p role="status" className="text-sm leading-6 text-slate-700">
            {result.status === 'empty' ? '오늘 이후 확정된 식단이 없어요.'
              : result.status === 'needs-review' ? '미확인 항목이 있어 전체 구매량은 계산되지 않았어요.'
                : result.status === 'sufficient' ? '확인된 수량에서 부족분은 없어요. 조리 전 실제 수량과 상태를 확인해 주세요.'
                  : '등록된 재고 기준으로 추가 필요량이 있어요. 구매 전에 실제 보유량을 확인해 주세요.'}
          </p>
          {shopping.shortages.length > 0 ? (
            <PreviewList title="등록된 재고 기준 추가 필요량" count={shopping.shortages.length} open>
              {shopping.shortages.map((item) => (
                <li key={JSON.stringify([item.ingredientKey, item.preparationState, item.unit])} className="py-2 text-sm leading-6">
                  <div className="flex items-start justify-between gap-3">
                    <span className="min-w-0 break-words font-medium text-slate-900">{item.label}</span>
                    <span className="shrink-0 font-semibold tabular-nums text-brand-700">{item.amount}{item.unit}</span>
                  </div>
                  <p className="text-xs leading-5 muted">{PREPARATION_LABELS[item.preparationState]} · {item.slotIds.map((id) => slotDates.get(id)).join(', ')}</p>
                </li>
              ))}
            </PreviewList>
          ) : null}
          {overdue.length > 0 ? <PreviewList title="배분을 보류한 지난 끼니" count={overdue.length} open>
            {overdue.map(item => <li key={item.slotId} className="py-2 text-sm leading-6">
              <p>{item.date} · {item.title}</p>
              <p className="text-xs text-amber-900">조리 여부 확인 필요 · 예정 배분 보류</p>
            </li>)}
          </PreviewList> : null}
          {reviewIngredients.length > 0 ? (
            <PreviewList title="확인이 필요한 재료" count={reviewIngredients.length}>
              {reviewIngredients.map((item, index) => (
                <li key={`${item.slotId}:${index}`} className="py-2 text-sm leading-6">
                  <p className="break-words font-medium text-slate-900">{item.label}</p>
                  <p className="text-xs leading-5 muted">{item.date} · {item.title}</p>
                  <p className="text-xs leading-5 text-slate-700">{REVIEW_REASONS[item.reason] || '레시피의 재료량과 조리 상태를 확인해 주세요.'}</p>
                </li>
              ))}
            </PreviewList>
          ) : null}
          {shopping.optional.length > 0 ? (
            <PreviewList title="선택 재료" count={shopping.optional.length}>
              {shopping.optional.map((item) => (
                <li key={`${item.slotId}:${item.componentId}:${item.lineId}`} className="py-2 text-sm leading-6">
                  <p className="break-words font-medium text-slate-900">{item.label}</p>
                  <p className="text-xs leading-5 muted">{item.date} · {item.title} · 선택하지 않아 필요량에서 제외했어요.</p>
                </li>
              ))}
            </PreviewList>
          ) : null}
        </div>
      ) : null}
      <Link to="/ingredients" className="mt-4 inline-block text-sm font-semibold text-brand-700 underline underline-offset-4">냉장고 목록</Link>
    </section>
  );
}

export default function MealPlanShoppingPreview({ scope, recordRevision, today = localDate(new Date()), disabled = false }) {
  return <PreviewSession key={`${scope}:${recordRevision}:${today}`} scope={scope} disabled={disabled} />;
}
