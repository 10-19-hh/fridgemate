import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import MealCookingForm from './MealCookingForm';
import MealConsumptionCorrectionForm from './MealConsumptionCorrectionForm';
import { cancelMealCooking, correctMealConsumption, getMealCookingWorkspace, recordMealCooking, reverseMealConsumption } from '../features/mealPlans/mealCookingRepository';
import { getMealCookingState } from '../features/mealPlans/mealCookingEvents';

const MESSAGES = {
  measured: '조리와 실제 사용량을 저장했어요.',
  unknown: '조리만 기록했어요. 남은 재고량을 다시 확인해 주세요.',
  reverse: '재고 반영만 취소했어요. 조리 기록은 유지돼요.',
  cancel: '조리 기록을 취소했어요. 재고는 변경하지 않았어요.',
  correct: '실제 사용량을 정정했어요. 조리 기록은 유지돼요.',
};

function CookingSession({ scope, weekStart, slotId, onChanged, onClose }) {
  const [state, setState] = useState({ snapshot: null, loading: true, busy: false, stale: false, error: '', notice: '', revision: 0 });
  const [confirmation, setConfirmation] = useState(null);
  const [correction, setCorrection] = useState(null);
  const mounted = useRef(false);
  const pending = useRef(null);
  const generation = useRef(0);
  const retry = useRef(null);
  const heading = useRef(null);
  const confirmationHeading = useRef(null);
  const confirmationOpener = useRef(null);
  const correctionOpener = useRef(null);

  useEffect(() => {
    if (confirmation) confirmationHeading.current?.focus();
  }, [confirmation]);

  function reviewCancellation(kind, event, opener) {
    setCorrection(null);
    confirmationOpener.current = opener;
    setConfirmation({ kind, event });
  }

  const read = useCallback(async () => {
    if (pending.current) return;
    const operation = { kind: 'read' };
    const version = generation.current;
    pending.current = operation;
    const current = () => mounted.current && pending.current === operation && generation.current === version;
    setState(previous => ({ ...previous, snapshot: null, loading: true, stale: false, error: '', notice: '' }));
    setConfirmation(null);
    setCorrection(null);
    try {
      const snapshot = await getMealCookingWorkspace(scope);
      if (!current()) return;
      if (snapshot.scope !== scope) throw new Error('조리 기록의 계정을 확인해주세요.');
      retry.current = null;
      setState(previous => ({ ...previous, snapshot, loading: false, revision: previous.revision + 1 }));
    } catch (error) {
      if (current()) setState(previous => ({ ...previous, loading: false, error: error?.message || '조리 기록을 읽지 못했어요. 다시 불러와 주세요.' }));
    } finally {
      if (pending.current === operation) pending.current = null;
    }
  }, [scope]);

  useEffect(() => {
    mounted.current = true;
    heading.current?.focus();
    read();
    const invalidate = () => {
      generation.current += 1;
      if (pending.current?.kind === 'read') pending.current = null;
      setConfirmation(null);
      setCorrection(null);
      setState(previous => ({ ...previous, snapshot: null, loading: false, stale: true, notice: '', error: '' }));
    };
    window.addEventListener('focus', invalidate);
    return () => { mounted.current = false; generation.current += 1; pending.current = null; window.removeEventListener('focus', invalidate); };
  }, [read]);

  const snapshot = state.snapshot;
  const record = snapshot?.records.find(item => item.weekStart === weekStart);
  const slot = record?.confirmed?.slots.find(item => item.id === slotId);
  const histories = snapshot?.history || [];
  const cookingEvents = histories.filter(event => event.kind === 'cooking').sort((left, right) => right.slotId.localeCompare(left.slotId) || right.createdAt.localeCompare(left.createdAt));
  const confirmsEmptyReversal = confirmation?.kind === 'reverse'
    && getMealCookingState(histories, confirmation.event.id)?.consumption?.lines.length === 0;

  async function execute(kind, payload) {
    if (pending.current || !snapshot || state.stale) return false;
    const operation = {};
    const version = generation.current;
    const current = () => mounted.current && pending.current === operation && generation.current === version;
    pending.current = operation;
    setState(previous => ({ ...previous, busy: true, error: '', notice: '' }));
    let committed = false;
    try {
      const event = kind === 'record' ? null : kind === 'correct' ? payload.event : payload;
      const targetWeek = event?.weekStart || weekStart;
      const targetRecord = snapshot.records.find(item => item.weekStart === targetWeek);
      const input = { scope, weekStart: targetWeek, slotId: event?.slotId || slotId, expectedPlanRevision: targetRecord?.revision ?? 0 };
      if (kind === 'record') Object.assign(input, payload);
      else {
        input.cookingId = event.id;
        if (kind === 'correct') Object.assign(input, payload.input);
        if (kind === 'reverse') {
          const { consumption } = getMealCookingState(histories, event.id);
          input.expectedConsumptionId = consumption.id;
          input.inventory = consumption.lines.map(line => {
            const row = snapshot.inventory.find(item => item.id === line.inventoryId);
            if (row?.quantityStatus !== 'verified' || row.consumed || row.deletedAt) throw new Error('원래 사용한 재고의 남은 양을 냉장고에서 먼저 확인해 주세요.');
            return { ingredientId: row.id, expectedRevision: row.quantityRevision, expectedSourceToken: row.sourceToken };
          });
        }
      }
      const signature = JSON.stringify([kind, input]);
      if (retry.current?.signature !== signature) retry.current = { signature, operationId: crypto.randomUUID() };
      input.operationId = retry.current.operationId;
      if (kind === 'record') await recordMealCooking(input);
      else if (kind === 'correct') await correctMealConsumption(input);
      else if (kind === 'reverse') await reverseMealConsumption(input);
      else await cancelMealCooking(input);
      committed = true;
      // Acknowledged stock changes invalidate dependent UI even if focus has
      // discarded this panel's old form or its follow-up read will fail.
      if (mounted.current) {
        try { await onChanged?.(); } catch {
          if (current()) setState(previous => ({ ...previous, error: '저장은 완료됐지만 다른 화면을 갱신하지 못했어요. 새로고침해 주세요.' }));
        }
      }
      if (!current()) return false;
      setConfirmation(null);
      setCorrection(null);
      const next = await getMealCookingWorkspace(scope);
      if (!current()) return false;
      setState(previous => ({ ...previous, snapshot: next, revision: previous.revision + 1,
        notice: MESSAGES[kind === 'record' ? payload.usageMode : kind] }));
      heading.current?.focus();
      return true;
    } catch (error) {
      if (current()) setState(previous => ({ ...previous,
        snapshot: committed ? null : previous.snapshot,
        error: committed ? '저장은 완료됐지만 결과를 다시 읽지 못했어요. 조리 목록을 새로고침해 주세요.'
          : error?.message || '조리 저장 결과를 확인하지 못했어요. 입력을 확인한 뒤 다시 시도해 주세요.' }));
      return false;
    } finally {
      if (pending.current === operation) {
        pending.current = null;
        if (mounted.current) setState(previous => ({ ...previous, busy: false }));
      }
    }
  }

  return <section aria-label="조리와 재고 기록" aria-busy={state.loading || state.busy} className="border-y-2 border-brand-600 bg-white px-4 py-5 sm:px-6">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <h2 ref={heading} tabIndex={-1} className="text-lg font-semibold text-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-700">조리와 재고 기록</h2>
      <button type="button" className="meal-plan-action" disabled={state.busy} onClick={onClose}>조리 창 닫기</button>
    </div>
    <p className="mt-2 text-sm leading-6 muted">조리한 사실과 재고 반영은 따로 기록해요. 이 기기·현재 계정에만 저장하며, 서버 백업에 포함되지 않아요.</p>
    {state.notice ? <p role="status" className="mt-3 text-sm font-medium text-brand-700">{state.notice}</p> : null}
    {state.error && slot?.status !== 'planned' && !correction ? <p role="alert" className="mt-3 text-sm leading-6 text-red-800">{state.error}</p> : null}
    {state.stale ? <p role="status" className="mt-3 text-sm text-amber-900">다른 화면의 변경을 확인하려면 조리 목록을 새로고침해 주세요. 작성 중인 입력은 닫았어요.</p> : null}
    {state.loading ? <p role="status" className="mt-3 text-sm muted">식단과 재고·조리 이력을 확인하고 있어요.</p> : null}
    <button className="meal-plan-action mt-3" type="button" disabled={state.loading || state.busy} onClick={read}>조리 목록 새로고침</button>
    {snapshot ? <div className="mt-5 space-y-6">
      {slot?.status === 'planned' && !correction ? <MealCookingForm key={state.revision} slot={slot} inventory={snapshot.inventory}
        disabled={state.busy} externalError={state.error} onRecord={input => execute('record', input)} onClose={onClose} /> : null}
      {slotId && !slot ? <p className="text-sm leading-6 text-amber-900">해당 확정 식단을 찾지 못했어요. 아래 남은 이력을 확인하거나 식단을 다시 불러와 주세요.</p> : null}
      <section aria-label="저장된 조리 이력">
        <h3 className="text-base font-semibold text-slate-900">저장된 조리 이력</h3>
        {!cookingEvents.length ? <p className="mt-3 text-sm muted">아직 조리 기록이 없어요.</p> : null}
        {cookingEvents.map(event => {
          const { cancelled, inventoryStatus, consumption } = getMealCookingState(histories, event.id);
          const reversed = inventoryStatus === 'reversed';
          const needsReverse = inventoryStatus === 'applied';
          const targetSlot = snapshot.records.find(item => item.weekStart === event.weekStart)?.confirmed?.slots.find(item => item.id === event.slotId);
          return <article key={event.id} aria-label={`${event.slotId.slice(0, 10)} 조리 이력`} className="space-y-2 border-t border-brand-100 py-4 text-sm leading-6">
            <h4 className="font-semibold text-slate-900"><time dateTime={event.slotId.slice(0, 10)}>{event.slotId.slice(0, 10)}</time> 저녁 · {cancelled ? '조리 취소됨' : '조리 기록됨'}</h4>
            {targetSlot?.cooking?.id === event.id ? <p>{targetSlot.title}</p> : <p className="text-xs muted">{targetSlot ? '현재 메뉴와 별도로 보관한 조리 기록이에요.' : '식단이 삭제되어도 조리와 소비 이력은 남아요.'}</p>}
            <p className="text-brand-700">{reversed ? (consumption.lines.length ? '재고 반영 취소됨 · 남은 양 확인 필요' : '재고 반영 취소됨 · 재고 변경 없음') : inventoryStatus === 'applied' ? '실제 사용량 재고 반영됨' : '재고 미반영 · 남은 양 확인 필요'}</p>
            {consumption ? <ul aria-label="기록한 실제 사용량">{consumption.lines.map(line => <li key={line.inventoryId}>{line.name} {line.amount}{line.unit}</li>)}</ul> : null}
            {consumption && !consumption.lines.length ? <p>기록한 사용량 0 · 재고 차감 없음</p> : null}
            {!cancelled ? <div className="flex flex-wrap gap-2">
              {needsReverse ? <button type="button" className="meal-plan-action" disabled={state.busy}
                onClick={click => { correctionOpener.current = click.currentTarget; setConfirmation(null); setCorrection(event); setState(previous => ({ ...previous, error: '', notice: '' })); }}>실제 사용량 정정</button> : null}
              {needsReverse ? <button type="button" className="meal-plan-action" disabled={state.busy} onClick={click => reviewCancellation('reverse', event, click.currentTarget)}>재고 반영 취소</button> : null}
              <button type="button" className="meal-plan-action" disabled={state.busy || needsReverse} onClick={click => reviewCancellation('cancel', event, click.currentTarget)}>조리 기록 취소</button>
            </div> : null}
            {needsReverse && !cancelled ? <p className="text-xs muted">조리 기록도 취소하려면 먼저 재고 반영을 취소해 주세요.</p> : null}
          </article>;
        })}
      </section>
      {correction ? <MealConsumptionCorrectionForm key={`${state.revision}:${correction.id}`}
        title={`${correction.slotId.slice(0, 10)} 저녁`} consumption={getMealCookingState(histories, correction.id).consumption}
        inventory={snapshot.inventory} disabled={state.busy} externalError={state.error}
        onCorrect={input => execute('correct', { event: correction, input })}
        onClose={() => { setCorrection(null); setState(previous => ({ ...previous, error: '' })); correctionOpener.current?.focus(); }} /> : null}
      {confirmation ? <section aria-label="취소 내용 확인" className="border-l-4 border-amber-300 bg-amber-50 p-4 text-sm leading-6">
        <h3 ref={confirmationHeading} tabIndex={-1} className="font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-700">{confirmation.kind === 'reverse' ? '재고 반영만 취소할까요?' : '조리 기록을 취소할까요?'}</h3>
        <p>{confirmation.kind === 'reverse' ? (confirmsEmptyReversal ? '기록한 사용량이 0이라 재고량과 수량 확인 상태는 바꾸지 않아요. 조리 기록은 남아요.'
          : '기록한 소비량만 현재 재고에 더해요. 나중에 입고한 재고는 유지하고, 남은 양은 다시 확인이 필요해요. 조리 기록은 남아요.')
          : '이 끼니를 다시 예정으로 돌려요. 삭제한 식단은 만들지 않고, 재고량과 수량 확인 상태도 되돌리지 않아요.'}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button className="btn-primary" type="button" disabled={state.busy} onClick={() => execute(confirmation.kind, confirmation.event)}>{confirmation.kind === 'reverse' ? '재고 반영 취소 확인' : '조리 기록 취소 확인'}</button>
          <button className="meal-plan-action" type="button" disabled={state.busy} onClick={() => { setConfirmation(null); confirmationOpener.current?.focus(); }}>취소하지 않고 돌아가기</button>
        </div>
      </section> : null}
      <Link className="inline-block text-sm font-semibold text-brand-700 underline" to="/ingredients">냉장고에서 남은 수량 확인</Link>
    </div> : null}
  </section>;
}

export default function MealCookingPanel(props) {
  return <CookingSession key={`${props.scope}:${props.weekStart}:${props.slotId || 'history'}`} {...props} />;
}
