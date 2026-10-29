import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import MealQuantityDetails from '../MealQuantityDetails';
import { shortDate } from './mealPlanDisplay';
import { isLocalPilotBuild } from '../../utils/pilotMode';
import { MEAL_PLAN_REASON_OPTIONS } from '../../features/mealPlans/mealPlanFeedback';
import {
  generateMealPlan,
  getSlotSummary,
  replaceMealPlanSlot,
  setMealPlanSlotSkipped,
  toggleMealPlanSlotLock
} from '../../features/mealPlans/mealPlanDomain';

const DAYS = ['월', '화', '수', '목', '금', '토', '일'];
const DEFAULT_PREFERENCES = { servings: 1, excludedIngredients: [], dinnerDays: [0, 1, 2, 3, 4, 5, 6] };

function parseExcludedIngredients(value) {
  return [...new Set(value.split(/[,，\n]/).map((name) => name.trim()).filter(Boolean))];
}

function MealSlot({ slot, dayIndex, ingredients, pantryItems, disabled, overdue, canCook, canChange, onCook, onMove, onReplace, onLock, onSkip }) {
  const selectionContext = `${slot.date}|${slot.templateKey}|${slot.status}`;
  const currentContextRef = useRef(null);
  const [selection, setSelection] = useState(() => ({ context: selectionContext, reasonCode: '' }));
  const reasonCode = selection.context === selectionContext ? selection.reasonCode : '';
  if (selection.context !== selectionContext) {
    setSelection({ context: selectionContext, reasonCode: '' });
  }
  const summary = getSlotSummary(slot, ingredients, pantryItems);
  const planned = slot.status === 'planned';
  const cooked = slot.status === 'cooked';
  const reason = planned && !slot.notice && summary.availableIngredients.length > 0 && summary.expiringIngredients.length === 0
    ? `등록·보유 확인된 ${summary.availableIngredients.slice(0, 2).join('·')} 재료명으로 고른 메뉴예요. 필요한 분량은 확인해 주세요.${summary.unverifiedExpiryIngredients?.length ? ' 기한 미확인 재료는 조리일까지 사용할 수 있는지 확인해 주세요.' : ''}`
    : summary.reason || slot.reason;

  async function changeMeal(event, action) {
    const opener = event.currentTarget;
    const ownerDocument = opener.ownerDocument;
    const wasFocused = ownerDocument.activeElement === opener;
    let movedFocus = false;
    const rememberFocus = focusEvent => {
      if (focusEvent.target !== opener && focusEvent.target !== ownerDocument.body) movedFocus = true;
    };
    if (wasFocused) ownerDocument.addEventListener('focusin', rememberFocus);
    let savedPlan;
    try {
      savedPlan = await action(reasonCode || 'not_answered');
    } catch (error) {
      ownerDocument.removeEventListener('focusin', rememberFocus);
      throw error;
    }
    const savedSlot = savedPlan?.slots.find(item => item.id === slot.id);
    if (!wasFocused || !savedSlot || movedFocus || !opener.isConnected) {
      ownerDocument.removeEventListener('focusin', rememberFocus);
      return;
    }
    const savedContext = `${savedSlot.date}|${savedSlot.templateKey}|${savedSlot.status}`;
    // Chromium blurs a focused button when saving temporarily disables it.
    // Restore only after the saved menu has rendered and no other focus won.
    ownerDocument.defaultView.requestAnimationFrame(() => {
      ownerDocument.removeEventListener('focusin', rememberFocus);
      if (!movedFocus && opener.isConnected && !opener.disabled
        && currentContextRef.current === savedContext && ownerDocument.activeElement === ownerDocument.body) {
        opener.focus({ preventScroll: true });
      }
    });
  }

  return (
    <article ref={node => { currentContextRef.current = node ? selectionContext : null; }} className={`meal-plan-day ${planned || cooked ? '' : 'meal-plan-day-muted'}`} aria-label={`${slot.date} 저녁 식단`}>
      <div className="meal-plan-date">
        <span className="text-sm font-semibold">{DAYS[dayIndex]}요일</span>
        <time dateTime={slot.date} className="text-2xl font-semibold tabular-nums tracking-tight">{shortDate(slot.date)}</time>
        <span className="text-xs muted">저녁 · {slot.servings}인</span>
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <h3 className="text-lg font-semibold leading-7 text-slate-900">
            {planned || cooked ? slot.title : slot.status === 'skipped' ? '외식하거나 쉬는 날' : '조건에 맞는 메뉴가 없어요'}
          </h3>
          {slot.locked && <span className="text-xs font-semibold text-brand-700">고정한 메뉴</span>}
          {cooked ? <span className="text-xs font-semibold text-brand-700">조리 기록됨</span> : null}
        </div>
        {overdue ? <p className="mt-2 text-sm leading-6 text-amber-900">조리 여부 확인 필요 · 예정 배분 보류</p> : null}
        {(planned || cooked) && (
          <>
            <p className="mt-1 text-sm leading-6 muted">{slot.components.map((component) => component.title).join(' + ')}</p>
            <p className="mt-2 text-sm leading-6 text-brand-700">{reason}</p>
            <div className="mt-3 flex flex-wrap items-center gap-2" aria-label="포함된 식품군">
              {summary.foodGroups.map((group) => <span key={group.id} className="meal-plan-group">{group.label}</span>)}
            </div>
            <p className="mt-2 text-xs leading-5 muted">{summary.compositionHint}</p>
            <details className="meal-plan-ingredients mt-3">
              <summary className="cursor-pointer text-sm font-medium text-slate-700">
                {cooked ? '조리 당시 메뉴와 원문 재료' : `재료 확인 · ${summary.missingIngredients.length ? `구매 또는 보유 확인 필요 ${summary.missingIngredients.length}가지` : summary.unverifiedExpiryIngredients?.length ? '기한 확인 필요' : '재료명 일치'} · 수량 확인 필요`}
              </summary>
              <div className="mt-3 space-y-2 text-sm leading-6">
                {summary.availableIngredients.length > 0 && <p><span className="font-semibold">등록·보유 확인된 재료명: </span>{summary.availableIngredients.join(', ')}</p>}
                {summary.missingIngredients.length > 0 && <p><span className="font-semibold">구매 또는 보유 확인 필요: </span>{summary.missingIngredients.join(', ')}</p>}
                {summary.expiringIngredients.length > 0 && <p><span className="font-semibold">식사일에 기한이 가까운 재료: </span>{summary.expiringIngredients.join(', ')}</p>}
                {summary.unverifiedExpiryIngredients?.length > 0 && <p><span className="font-semibold">기한 확인: </span>{summary.unverifiedExpiryIngredients.join(', ')}</p>}
                {planned ? <p className="text-xs leading-5 muted">등록·보유 확인된 재료명만 비교한 결과예요. 실제 보유량과 필요한 분량은 별도로 확인해 주세요.</p> : null}
                <MealQuantityDetails slot={slot} />
              </div>
            </details>
          </>
        )}
        {!planned && !cooked && <p className="mt-2 text-sm leading-6 muted">{slot.reason || '이 날은 메뉴 추천에서 제외했어요.'}</p>}
        {isLocalPilotBuild() && !cooked && slot.status !== 'skipped' ? <label className="mt-4 block max-w-sm text-xs font-medium text-slate-700">
          교체·건너뛰기 이유 (선택)
          <select className="mt-1 min-h-11 disabled:cursor-not-allowed disabled:opacity-50" value={reasonCode} disabled={disabled || slot.locked}
            onChange={event => setSelection({ context: selectionContext, reasonCode: event.target.value })}>
            <option value="">선택하지 않음</option>
            {MEAL_PLAN_REASON_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label> : null}
        <div className="mt-4 flex flex-wrap gap-2">
          {planned && (
            <>
              <button className="meal-plan-action" type="button" disabled={disabled || slot.locked || overdue} onClick={event => changeMeal(event, onReplace)}>메뉴 교체</button>
              <button className="meal-plan-action" type="button" disabled={disabled} aria-pressed={slot.locked} onClick={onLock}>{slot.locked ? '고정 해제' : '메뉴 고정'}</button>
              {canChange ? <button className="meal-plan-action" type="button" disabled={disabled || slot.locked} onClick={onMove}>날짜 이동</button> : null}
            </>
          )}
          {!cooked ? <button className="meal-plan-action" type="button" disabled={disabled || slot.locked} onClick={event => changeMeal(event, onSkip)}>{slot.status === 'skipped' ? '식단에 포함' : planned && overdue ? '만들지 않았어요' : '외식·건너뛰기'}</button> : null}
          {cooked || (planned && canCook) ? <button className={cooked ? 'meal-plan-action' : 'btn-primary'} type="button" disabled={disabled} onClick={onCook}>{cooked ? '조리 기록 확인' : '만들어 먹었어요'}</button> : null}
        </div>
      </div>
    </article>
  );
}

function ConfirmedPlanSummary({ plan }) {
  return (
    <section className="rounded-lg border border-brand-100 bg-brand-50 p-4" aria-label="현재 확정된 식단">
      <h2 className="text-sm font-semibold text-slate-900">현재 확정된 식단</h2>
      <p className="mt-1 text-xs leading-5 muted">아래 확정본은 읽기 전용이에요. 수정 중인 메뉴는 그 아래 식단표에서 확인해 주세요.</p>
      <ul className="mt-3 divide-y divide-brand-100">
        {plan.slots.map((slot, index) => (
          <li key={slot.id} className="grid grid-cols-[6rem_minmax(0,1fr)_auto] items-start gap-3 py-2 text-sm leading-6">
            <time dateTime={slot.date} className="tabular-nums text-slate-700">{shortDate(slot.date)} {DAYS[index]}요일</time>
            <span className="min-w-0 text-slate-900">{['planned', 'cooked'].includes(slot.status) ? slot.title : slot.status === 'skipped' ? '외식하거나 쉬는 날' : '조건에 맞는 메뉴가 없어요'}{slot.status === 'cooked' ? ' · 조리 기록됨' : ''}</span>
            <span className="whitespace-nowrap text-slate-700">{slot.servings}인</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function MealPlanEditor({ plan, confirmedPlan, hasDraft, weekStart, storageScope, saving, savePlan, generatePlan, confirmPlan, restoreOverdueDraft, overdueConflicts, today, ingredients, inventoryLoading, inventoryError, pantryItems, editingDisabled, onOpenCooking, onOpenChange }) {
  const confirmationHeadingRef = useRef(null);
  const [preferences, setPreferences] = useState(() => plan?.preferences || DEFAULT_PREFERENCES);
  const [excludedText, setExcludedText] = useState(() => preferences.excludedIngredients.join(', '));
  const [notice, setNotice] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(() => !plan);
  const currentPreferences = { ...preferences, excludedIngredients: parseExcludedIngredients(excludedText) };
  const settingsDirty = Boolean(plan) && JSON.stringify(currentPreferences) !== JSON.stringify(plan.preferences);
  const busy = saving || inventoryLoading || Boolean(inventoryError) || editingDisabled;
  const options = { ingredients, pantryItems, confirmedPlan };
  const overdueIds = new Set(confirmedPlan?.slots.filter(slot => slot.status === 'planned' && slot.date < today).map(slot => slot.id));
  const needsRestore = hasDraft && overdueConflicts.length > 0;
  const canChange = Boolean(confirmedPlan) && !hasDraft;
  const hasRemaining = plan?.slots.some(slot => slot.date >= today && !slot.locked && ['planned', 'empty'].includes(slot.status));

  async function persist(nextPlan, successMessage, save = savePlan, feedback) {
    setNotice('');
    const savedPlan = feedback ? await save(nextPlan, feedback) : await save(nextPlan);
    if (savedPlan) {
      setPreferences(savedPlan.preferences);
      setExcludedText(savedPlan.preferences.excludedIngredients.join(', '));
      setNotice(successMessage);
    }
    return savedPlan;
  }

  async function handleGenerate(event) {
    event.preventDefault();
    if (busy) return;
    const createPlan = () => generateMealPlan({
      weekStart,
      scope: storageScope,
      preferences: currentPreferences,
      ...options,
      previousPlan: plan
    });
    const savedPlan = await persist(createPlan, '이 기기에 저장됨 · 재료와 분량을 확인해 주세요.', generatePlan);
    if (savedPlan) setSettingsOpen(false);
  }

  async function handleReplace(slot, reasonCode) {
    const nextPlan = replaceMealPlanSlot(plan, slot.id, options);
    const nextSlot = nextPlan.slots.find((item) => item.id === slot.id);
    if (nextSlot.templateKey === slot.templateKey) {
      setNotice(isLocalPilotBuild()
        ? '검수 기준과 제외 재료 조건에 맞는 다른 메뉴가 없어요. 기존 메뉴를 유지해요.'
        : '지금 조건에 맞는 다른 메뉴가 없어요. 피하고 싶은 재료를 조정해 보세요.');
      return;
    }
    return persist(nextPlan, `${shortDate(slot.date)} 메뉴를 바꿨어요.`, savePlan,
      isLocalPilotBuild() ? { slotId: slot.id, changeType: 'replace', reasonCode } : undefined);
  }

  async function handleSkip(slot, reasonCode) {
    const skipping = slot.status !== 'skipped';
    const nextPlan = setMealPlanSlotSkipped(plan, slot.id, skipping, options);
    const nextSlot = nextPlan.slots.find(item => item.id === slot.id);
    if (!skipping && nextSlot.status !== 'planned') {
      setNotice(nextSlot.notice || nextSlot.reason);
      return;
    }
    const feedback = isLocalPilotBuild() && skipping ? { slotId: slot.id,
      changeType: slot.status === 'planned' && overdueIds.has(slot.id) ? 'not_cooked' : 'skip', reasonCode } : undefined;
    return persist(nextPlan, skipping ? '이 날의 저녁은 건너뛰어요.' : '식단에 다시 포함했어요.', savePlan, feedback);
  }

  async function handleConfirm() {
    if (busy || settingsDirty || !hasDraft || needsRestore) return;
    setNotice('');
    const confirmed = await confirmPlan();
    if (confirmed) {
      setNotice('식단을 확정했어요.');
      confirmationHeadingRef.current?.focus({ preventScroll: true });
    }
  }

  async function handleRestore() {
    if (busy || !needsRestore) return;
    setNotice('');
    const restored = await restoreOverdueDraft();
    if (restored) {
      setPreferences(restored.preferences);
      setExcludedText(restored.preferences.excludedIngredients.join(', '));
      setNotice('지난 확정 끼니를 유지해 초안을 복구했어요. 미래 날짜의 수정은 유지했어요.');
    }
  }

  return (
    <>
      {isLocalPilotBuild() ? <aside aria-label="파일럿 메뉴 기준" className="border-l-2 border-brand-500 pl-4 text-sm leading-6 text-slate-700">
        <h2 className="font-semibold text-slate-900">원문 대조 완료(식재료량) 메뉴로 시작해요</h2>
        <p className="mt-1">원문 인분과 식재료량을 대조한 단품만 새로 추천해요. 과정 물과 추가 양념은 확인이 필요하며, 기본 양념도 실제 보유량을 확인해 주세요.</p>
        <p className="mt-1">후보가 적어 같은 메뉴가 반복될 수 있어요. 기존에 저장한 식단은 유지하며, 파일럿 참여 동의와 관계없이 같은 메뉴 기준을 적용해요.</p>
      </aside> : null}
      <form className="meal-plan-settings" onSubmit={handleGenerate}>
        <details open={settingsOpen} onToggle={(event) => setSettingsOpen(event.currentTarget.open)}>
          <summary className="cursor-pointer text-base font-semibold text-slate-900">
            식단 조건 <span className="ml-2 text-sm font-normal muted">{preferences.servings}인 · 집밥 {preferences.dinnerDays.length}일</span>
          </summary>
        <fieldset disabled={busy} className="mt-4 min-w-0">
          <legend className="sr-only">어떤 저녁을 준비할까요?</legend>
          <div className="mt-4 grid gap-4 sm:grid-cols-[8rem_minmax(0,1fr)]">
            <label className="text-sm font-medium" htmlFor="meal-plan-servings">식사 인원
              <select id="meal-plan-servings" className="mt-2" value={preferences.servings} onChange={(event) => setPreferences({ ...preferences, servings: Number(event.target.value) })}>
                <option value="1">1인</option><option value="2">2인</option>
              </select>
            </label>
            <label className="text-sm font-medium" htmlFor="meal-plan-excluded">피하고 싶은 재료
              <input id="meal-plan-excluded" className="mt-2" value={excludedText} maxLength={240} placeholder="예: 버섯, 가지" aria-describedby="meal-plan-excluded-help" onChange={(event) => setExcludedText(event.target.value)} />
            </label>
          </div>
          <p id="meal-plan-excluded-help" className="mt-2 text-xs leading-5 muted">쉼표로 구분해 주세요. 취향을 반영하는 기능이며, 알레르기 안전성을 보장하는 필터는 아니에요.</p>
          <fieldset className="mt-4">
            <legend className="mb-2 text-sm font-medium">집에서 저녁 먹는 날</legend>
            <div className="grid grid-cols-7 gap-1.5 sm:gap-2">
              {DAYS.map((day, index) => (
                <label key={day} className={`meal-plan-day-choice ${preferences.dinnerDays.includes(index) ? 'is-selected' : ''}`}>
                  <input type="checkbox" aria-label={`${day}요일 저녁`} checked={preferences.dinnerDays.includes(index)} onChange={(event) => {
                    const dinnerDays = event.target.checked ? [...preferences.dinnerDays, index].sort() : preferences.dinnerDays.filter((value) => value !== index);
                    setPreferences({ ...preferences, dinnerDays });
                  }} />
                  <span>{day}</span>
                </label>
              ))}
            </div>
          </fieldset>
        </fieldset>
        </details>
        <div className="mt-5 flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="max-w-sm text-xs leading-5 muted">{plan ? '고정한 메뉴는 유지해요. 조건을 바꾸면 고정 메뉴도 직접 확인해 주세요.' : '재료를 등록하지 않아도 초안을 만들 수 있어요. 필요한 재료는 구매 또는 보유 여부를 확인해 주세요.'}</p>
          <button className="btn-primary w-full shrink-0 sm:w-auto" type="submit" disabled={busy}>{saving ? '저장 중…' : plan ? '고정하지 않은 메뉴 다시 추천' : '한 주 식단 만들기'}</button>
        </div>
      </form>

      {inventoryError && <p role="alert" className="text-sm text-red-800">재료를 불러오지 못했어요. 기존 식단은 유지돼요. <Link to="/ingredients" className="underline">냉장고에서 확인해 주세요.</Link></p>}
      {inventoryLoading && <p className="text-sm muted">냉장고 재료를 확인하고 있어요.</p>}
      {settingsDirty && <p className="text-sm text-amber-900">조건이 변경됐어요. 다시 추천을 눌러 저장한 뒤 메뉴를 편집하거나 식단을 확정해 주세요.</p>}
      <p role="status" aria-live="polite" className="text-sm text-brand-700">{saving ? '식단을 저장하고 있어요.' : notice || (plan ? '이 기기에 저장됨' : '')}</p>

      {plan && (
        <section className="border-y border-brand-100 py-4" aria-label="식단 확정 상태">
          <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 ref={confirmationHeadingRef} tabIndex={-1} className="text-base font-semibold text-brand-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4">{confirmedPlan ? hasDraft ? '수정 초안' : '확정됨' : '초안'}</h2>
              <p className="mt-1 text-sm leading-6 text-slate-700">
                {confirmedPlan ? hasDraft ? '이전 확정본을 유지하고 있어요. 수정 초안을 확정해야 바뀌어요.' : '이 식단이 현재 확정본이에요. 메뉴를 바꾸면 수정 초안으로 저장해요.' : '이 기기에 저장된 초안이에요. 메뉴를 확인한 뒤 직접 확정해 주세요.'}
              </p>
            </div>
            {hasDraft && <button className="btn-primary w-full shrink-0 sm:w-auto" type="button" disabled={busy || settingsDirty || needsRestore} onClick={handleConfirm}>{confirmedPlan ? '수정 초안으로 확정본 교체' : '이 식단 확정'}</button>}
          </div>
          <p className="mt-3 text-xs leading-5 muted">확정은 먹을 메뉴를 정하는 단계예요. 재료 수량이나 식품 안전 검수가 완료됐다는 뜻은 아니에요.</p>
          {hasDraft ? <p className="mt-1 text-xs leading-5 muted">만들어 먹은 메뉴를 기록하려면 먼저 초안을 확정해 주세요.</p> : null}
          {needsRestore ? <div className="mt-3 space-y-2 text-sm leading-6 text-amber-900">
            <p>날짜가 지난 확정 끼니와 초안이 달라요. 지난 끼니를 복구한 뒤 조리 기록·건너뛰기·날짜 이동을 선택해 주세요. 미래 날짜의 수정은 유지해요.</p>
            <button type="button" className="meal-plan-action" disabled={busy} onClick={handleRestore}>지난 끼니를 유지해 초안 복구</button>
          </div> : null}
        </section>
      )}
      {hasDraft && confirmedPlan && <ConfirmedPlanSummary plan={confirmedPlan} />}
      {canChange ? <div className="space-y-2">
        <button className="meal-plan-action" type="button" disabled={busy || settingsDirty || !hasRemaining}
          onClick={event => onOpenChange('readjust', null, event.currentTarget)}>이번 주 남은 식단 다시 맞추기</button>
        <p className="text-xs leading-5 muted">완료·고정·외식·지난 날짜는 유지해요. 변경할 메뉴와 모든 주의 장보기 차이를 먼저 보고 확정할 수 있어요.</p>
      </div> : hasDraft ? <p className="text-xs leading-5 muted">날짜 이동과 남은 식단 재조정은 초안을 먼저 확정한 뒤 이용해 주세요.</p> : null}

      {plan ? (
        <section className="meal-plan-board" aria-label="한 주 저녁 식단표">
          {isLocalPilotBuild() ? <p className="text-xs leading-5 muted">이유는 선택 사항이에요. 파일럿 기록에 동의한 경우에만 이 브라우저에 저장해요.</p> : null}
          {plan.slots.map((slot, index) => (
            <MealSlot key={`${storageScope}:${weekStart}:${slot.id}`} slot={slot} dayIndex={index} ingredients={inventoryError ? [] : ingredients} pantryItems={pantryItems} disabled={busy || settingsDirty}
              overdue={overdueIds.has(slot.id)}
              canCook={Boolean(confirmedPlan) && !hasDraft} onCook={event => onOpenCooking(slot.id, event.currentTarget)}
              canChange={canChange} onMove={event => onOpenChange('move', slot.id, event.currentTarget)}
              onReplace={reasonCode => handleReplace(slot, reasonCode)}
              onLock={() => persist(toggleMealPlanSlotLock(plan, slot.id), slot.locked ? '메뉴 고정을 해제했어요.' : '다시 추천해도 이 메뉴는 유지해요.')}
              onSkip={reasonCode => handleSkip(slot, reasonCode)}
            />
          ))}
        </section>
      ) : (
        <section className="meal-plan-empty" aria-label="아직 식단이 없어요">
          <div aria-hidden="true" className="mb-5 grid w-full max-w-sm grid-cols-7 border-y border-brand-100 py-4">
            {DAYS.map((day) => <div key={day} className="border-r border-brand-100 text-center last:border-0"><span className="text-xs text-brand-700">{day}</span><div className="mt-4 text-xl text-brand-500">—</div></div>)}
          </div>
          <h2 className="text-lg font-semibold text-slate-900">이번 주 메뉴 고민, 여기서 시작해요</h2>
          <p className="mt-2 max-w-md text-sm leading-6 muted">먹을 날을 고르면 냉장고 재료를 우선해서 제안해요. 마음에 들지 않는 메뉴는 하나씩 바꿀 수 있어요.</p>
          <Link to="/ingredients" className="mt-4 text-sm font-semibold text-brand-700 underline underline-offset-4">냉장고 재료부터 확인하기</Link>
        </section>
      )}
    </>
  );
}
