import { useEffect, useId, useRef, useState } from 'react';
import { confirmMealPlanChange, previewMealPlanChange } from '../features/mealPlans/mealPlanChangesRepository';

const REVIEW_REASONS = {
  'inventory-unverified': '보유 재료 수량 확인 필요',
  'inventory-incompatible': '단위·조리 상태 확인 필요',
  'inventory-expiry-unknown': '보유 재료 기한 확인 필요',
  'inventory-expired': '옮긴 식사일에 재료 기한 확인 필요',
  'prior-demand-unverified': '다른 식단의 미확인 사용량 확인 필요',
  'process-quantity-unverified': '조리 과정에 따로 쓰는 양 확인 필요',
  'overdue-meal-unconfirmed': '지난 끼니의 조리 여부 확인 필요 · 예정 배분 보류',
};

function SlotComparison({ label, slot, allocation }) {
  const requirements = allocation?.slots.find(item => item.id === slot?.id)?.requirements || [];
  const mealTitle = !slot ? '계획 없음' : slot.status === 'skipped' ? '외식·건너뜀'
    : slot.status === 'empty' ? '조건에 맞는 메뉴 없음' : slot.title;
  return <section aria-label={label} className="min-w-0 space-y-1">
    <h4 className="text-xs font-medium text-slate-600">{label}</h4>
    <p className="break-words font-semibold text-slate-900">{mealTitle}</p>
    {slot ? <p className="text-xs muted">{slot.servings}인 · {slot.status === 'cooked' ? '조리 기록 유지' : slot.status === 'planned' ? '식사 계획' : '예정 사용량 없음'}</p> : null}
    {requirements.length ? <ul aria-label={`${label} 필요 재료`} className="space-y-1 text-sm leading-6">
      {requirements.map((item, index) => <li key={index}>{item.label} {item.requiredAmount === null ? '양 확인 필요' : `${item.requiredAmount}${item.unit}`}</li>)}
    </ul> : null}
  </section>;
}

function ShoppingComparison({ label, allocation }) {
  const { shortages = [], needsReview = [], optional = [] } = allocation?.shopping || {};
  return <section aria-label={label} className="min-w-0 space-y-2">
    <h3 className="font-semibold text-slate-900">{label}</h3>
    {needsReview.length ? <p className="text-sm text-amber-900">확인 필요 항목이 있어 전체 구매량은 확정할 수 없어요.</p>
      : <p className="text-sm text-slate-700">{shortages.length ? '등록된 재고 기준 추가 필요량' : '확인된 수량에서 부족분이 없어요.'}</p>}
    {shortages.length ? <ul aria-label={`${label} 부족분`} className="space-y-1 text-sm leading-6">
      {shortages.map((item, index) => <li key={index} className="break-words">{item.label} <span className="font-semibold tabular-nums">{item.amount}{item.unit}</span></li>)}
    </ul> : null}
    {needsReview.length ? <ul aria-label={`${label} 확인 필요`} className="space-y-2 text-sm leading-6">
      {needsReview.map((item, index) => <li key={index} className="break-words"><p>{item.label}</p>
        <p className="text-xs text-amber-900">{item.date} · {REVIEW_REASONS[item.reason] || '원문 재료량과 조리 상태 확인 필요'}</p></li>)}
    </ul> : null}
    {optional.length ? <p className="text-xs muted">선택하지 않은 재료 {optional.length}항목은 필요량에서 제외했어요.</p> : null}
  </section>;
}

function ChangeSession({ scope, weekStart, slotId, kind, today, pantryItems, onChanged, onClose }) {
  const id = useId();
  const pantryKey = JSON.stringify(pantryItems);
  const inputContext = useRef({ pantryKey, today });
  if (inputContext.current.pantryKey !== pantryKey || inputContext.current.today !== today) inputContext.current = { pantryKey, today };
  const overdue = slotId?.slice(0, 10) < today;
  const renderedInputContext = inputContext.current;
  const [inputs, setInputs] = useState({ context: renderedInputContext, targetDate: '', mode: 'move' });
  const targetDate = inputs.context === renderedInputContext ? inputs.targetDate : '';
  const mode = inputs.context === renderedInputContext ? inputs.mode : 'move';
  const [storedState, setState] = useState({ context: renderedInputContext, preview: null, busy: '', stale: false, error: '', notice: '' });
  const mounted = useRef(false);
  const pending = useRef(null);
  const generation = useRef(0);
  const heading = useRef(null);
  // Pantry/day changes discard only the comparison and input, not an in-flight
  // write's lifetime. Its acknowledgement still refreshes this same account.
  const state = storedState.context === renderedInputContext ? storedState : { ...storedState,
    preview: null, stale: true, error: '', notice: '', busy: pending.current?.kind === 'write' ? 'write' : '' };

  useEffect(() => {
    mounted.current = true;
    heading.current?.focus();
    const invalidate = () => {
      generation.current += 1;
      if (pending.current?.kind === 'read') pending.current = null;
      setState(previous => ({ ...previous, preview: null, busy: pending.current ? previous.busy : '', stale: true, error: '', notice: '' }));
    };
    window.addEventListener('focus', invalidate);
    return () => { mounted.current = false; generation.current += 1; pending.current = null; window.removeEventListener('focus', invalidate); };
  }, []);

  function dropOldRead() {
    if (pending.current?.kind === 'read' && pending.current.context !== inputContext.current) pending.current = null;
  }

  function changeInput(field, value) {
    dropOldRead();
    if (pending.current) return;
    generation.current += 1;
    setInputs({ context: renderedInputContext, targetDate, mode, [field]: value });
    setState({ context: renderedInputContext, preview: null, busy: '', stale: false, error: '', notice: '' });
  }

  async function read(event) {
    event.preventDefault();
    dropOldRead();
    if (pending.current || (kind === 'move' && !targetDate)) return;
    const operation = { kind: 'read', context: renderedInputContext };
    const version = generation.current;
    pending.current = operation;
    const current = () => mounted.current && pending.current === operation && generation.current === version && inputContext.current === renderedInputContext;
    setState({ context: renderedInputContext, preview: null, busy: 'read', stale: false, error: '', notice: '' });
    try {
      const input = { scope, weekStart, kind, pantryItems };
      if (kind === 'move') Object.assign(input, { slotId, targetDate, mode });
      const preview = await previewMealPlanChange(input);
      if (!current()) return;
      if (preview?.scope !== scope) throw new Error('변경안의 계정을 확인할 수 없어요. 다시 미리보기 해 주세요.');
      setState({ context: renderedInputContext, preview, busy: 'read', stale: false, error: '',
        notice: preview.canApply ? '변경안이 준비됐어요. 변경 내용을 확인한 뒤 확정해 주세요.' : '적용할 변경안이 없어요. 아래 변경 안내를 확인해 주세요.' });
    } catch (error) {
      if (current()) setState(previous => ({ ...previous, error: error?.message || '변경안을 읽지 못했어요. 다시 미리보기 해 주세요.' }));
    } finally {
      if (pending.current === operation) {
        pending.current = null;
        if (mounted.current) setState(previous => ({ ...previous, busy: '' }));
      }
    }
  }

  async function confirm() {
    if (pending.current || !state.preview?.canApply || state.stale) return;
    const operation = { kind: 'write' };
    const version = generation.current;
    pending.current = operation;
    const current = () => mounted.current && pending.current === operation && generation.current === version && inputContext.current === renderedInputContext;
    setState(previous => ({ ...previous, busy: 'write', error: '', notice: '' }));
    let committed = false;
    try {
      await confirmMealPlanChange(state.preview);
      committed = true;
      // Once acknowledged, this approval must never be offered again, including
      // when focus invalidated the comparison or refreshing the parent fails.
      if (mounted.current) {
        setState(previous => ({ ...previous, preview: null }));
        await onChanged?.();
      }
      if (!current()) return;
      setState(previous => ({ ...previous, notice: '변경안을 확정했어요.' }));
      heading.current?.focus();
    } catch (error) {
      if (current()) setState(previous => ({ ...previous, preview: null,
        error: committed ? '저장은 완료됐지만 화면을 갱신하지 못했어요. 저장된 식단을 다시 불러와 주세요.'
          : error?.message || '변경안을 저장하지 못했어요. 다시 미리보기 후 확인해 주세요.' }));
    } finally {
      if (pending.current === operation) {
        pending.current = null;
        if (mounted.current) setState(previous => ({ ...previous, busy: '' }));
      }
    }
  }

  const preview = state.preview;
  return <section aria-label="식단 변경 미리보기" aria-busy={Boolean(state.busy)} className="border-y-2 border-brand-600 bg-white px-4 py-5 sm:px-6">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <h2 ref={heading} tabIndex={-1} className="text-lg font-semibold text-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-700">식단 변경 미리보기</h2>
      <button type="button" className="meal-plan-action" disabled={state.busy === 'write'} onClick={onClose}>변경 창 닫기</button>
    </div>
    <p className="mt-2 text-sm leading-6 muted">{kind === 'move' ? '날짜를 옮길 메뉴와 그날의 필요 재료를 확인해 주세요.' : '오늘 이후의 남은 메뉴를 다시 제안해요. 조리한 날·외식·고정 메뉴·지난 날짜는 유지해요.'}</p>
    <p className="mt-1 text-xs leading-5 muted">모든 주의 확정 식단에서 필요량·재료 기한·장보기를 다시 계산해요. 실제 재고와 직접 적은 장보기 메모·입고 이력은 바꾸지 않아요.</p>
    <p className="mt-1 text-xs leading-5 muted">미등록 재료는 실제 미보유가 아니라 구매 또는 보유 확인 필요 상태예요. 아래 수량은 등록된 재고를 기준으로 계산해요.</p>
    <p className="mt-1 text-xs leading-5 muted">저장된 초안이 없는 확정본만 변경해요. 미리보기는 저장하지 않으며, 확정하면 관련 주를 함께 이 기기·현재 계정에만 저장해요.</p>
    <form onSubmit={read} className="mt-4 space-y-3">
      {kind === 'move' ? <fieldset disabled={Boolean(state.busy)} className="grid min-w-0 gap-3 sm:grid-cols-2">
        <label htmlFor={`${id}-date`} className="text-sm font-medium">옮길 날짜<input id={`${id}-date`} className="mt-2 min-w-0 w-full" type="date" min={today} value={targetDate} required onChange={event => changeInput('targetDate', event.target.value)} /></label>
        <label htmlFor={`${id}-mode`} className="text-sm font-medium">이동 방식<select id={`${id}-mode`} className="mt-2 w-full" value={mode} onChange={event => changeInput('mode', event.target.value)}>
          <option value="move">빈 날로 이동</option>{!overdue ? <option value="swap">두 메뉴 날짜 바꾸기</option> : null}
        </select></label>
      </fieldset> : null}
      <button className="btn-secondary w-full sm:w-auto" type="submit" disabled={Boolean(state.busy) || (kind === 'move' && !targetDate)}>변경안 미리보기</button>
    </form>
    <p role="status" aria-live="polite" aria-atomic="true" className={state.busy || state.stale || state.notice
      ? `mt-3 text-sm font-medium ${state.stale ? 'text-amber-900' : 'text-brand-700'}` : 'sr-only'}>
      {state.busy ? (state.busy === 'write' ? '관련 식단을 함께 저장하고 있어요.' : '현재 식단과 재고로 변경안을 비교하고 있어요.')
        : state.stale ? '다른 화면의 변경을 확인하려면 다시 미리보기 해 주세요.' : state.notice}
    </p>
    {state.error ? <p role="alert" className="mt-3 text-sm leading-6 text-red-800">{state.error}</p> : null}
    {preview ? <div className="mt-5 space-y-5">
      {preview.notices.length ? <ul className="space-y-1 text-sm leading-6 text-amber-900" aria-label="변경 안내">{preview.notices.map((notice, index) => <li key={index}>{notice}</li>)}</ul> : null}
      <div className="divide-y divide-brand-100">{preview.changes.map(change => <article key={change.date} aria-label={`${change.date} 변경 비교`} className="space-y-3 py-4">
        <h3 className="font-semibold text-slate-900"><time dateTime={change.date}>{change.date}</time> 저녁</h3>
        <div className="grid gap-4 sm:grid-cols-2"><SlotComparison label="변경 전 메뉴" slot={change.before} allocation={preview.beforeAllocation} /><SlotComparison label="변경 후 메뉴" slot={change.after} allocation={preview.afterAllocation} /></div>
      </article>)}</div>
      <div className="grid gap-5 border-t border-brand-100 pt-4 sm:grid-cols-2">
        <ShoppingComparison label="변경 전 전체 장보기" allocation={preview.beforeAllocation} /><ShoppingComparison label="변경 후 전체 장보기" allocation={preview.afterAllocation} />
      </div>
      {preview.canApply ? <button className="btn-primary w-full sm:w-auto" type="button" disabled={Boolean(state.busy)} onClick={confirm}>변경안 확정</button> : null}
    </div> : null}
  </section>;
}

export default function MealPlanChangePanel({ pantryItems = [], ...props }) {
  return <ChangeSession key={JSON.stringify([props.scope, props.weekStart, props.slotId, props.kind])} {...props} pantryItems={pantryItems} />;
}
