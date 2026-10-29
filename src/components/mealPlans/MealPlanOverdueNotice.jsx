import { useEffect, useMemo, useState } from 'react';
import { getMealPlanningSnapshot } from '../../features/mealPlans/mealPlanRepository';

// Read every confirmed week, including weeks outside the currently open board.
// Draft skips do not release the confirmed allocation until explicitly confirmed.
export default function MealPlanOverdueNotice({ scope, today, refreshKey, disabled, onReviewWeek }) {
  const [attempt, setAttempt] = useState(0);
  const key = JSON.stringify([scope, today, refreshKey, attempt]);
  const currentContext = useMemo(() => ({ key }), [key]);
  const [result, setResult] = useState(null);
  const visible = result?.context === currentContext ? result : null;

  useEffect(() => {
    const refresh = () => setAttempt(value => value + 1);
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, []);

  useEffect(() => {
    let active = true;
    getMealPlanningSnapshot(scope).then(snapshot => {
      if (!active) return;
      if (snapshot.scope !== scope) throw new Error('다른 계정의 식단은 표시하지 않습니다.');
      const weeks = snapshot.confirmedPlans.map(plan => ({ weekStart: plan.weekStart,
        slots: plan.slots.filter(slot => slot.status === 'planned' && slot.date < today) }))
        .filter(week => week.slots.length);
      setResult({ context: currentContext, weeks, error: false });
    }).catch(() => {
      if (active) setResult({ context: currentContext, weeks: [], error: true });
    });
    return () => { active = false; };
  }, [currentContext, scope, today]);

  return <section aria-label="지난 끼니 확인" aria-busy={!visible} className="rounded-lg border border-brand-100 bg-brand-50 p-4">
    <h2 className="text-base font-semibold text-slate-900">지난 끼니 확인</h2>
    <p className="mt-1 text-xs leading-5 muted">지난 확정 끼니는 자동으로 먹은 것으로 처리하지 않아요. 현재 확인된 재고에서 예정량을 보류하며, 조리 기록·건너뛰기 확정·오늘 이후 날짜 이동으로 정리해 주세요.</p>
    {!visible ? <p role="status" className="mt-2 text-sm muted">모든 주의 지난 끼니를 확인하고 있어요.</p>
      : visible.error ? <div role="alert" className="mt-2 text-sm text-red-800">지난 끼니를 확인하지 못했어요. 기존 식단과 재고는 바꾸지 않았어요. <button type="button" className="underline" onClick={() => setAttempt(value => value + 1)}>지난 끼니 다시 확인</button></div>
        : visible.weeks.length ? <ul className="mt-3 space-y-3">
          {visible.weeks.map(week => <li key={week.weekStart}>
            <ul className="space-y-1 text-sm leading-6">{week.slots.map(slot => <li key={slot.id}>
              <time dateTime={slot.date}>{slot.date}</time> · {slot.title}
              <p className="text-xs text-amber-900">조리 여부 확인 필요 · 예정 배분 보류</p>
            </li>)}</ul>
            <button type="button" className="meal-plan-action mt-2" disabled={disabled} onClick={() => onReviewWeek(week.weekStart)}>{week.weekStart} 식단 확인</button>
          </li>)}
        </ul> : <p className="mt-2 text-sm muted">조리 여부를 확인할 지난 끼니가 없어요.</p>}
  </section>;
}
