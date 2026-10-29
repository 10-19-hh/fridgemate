import { useEffect, useId, useRef, useState } from 'react';
import {
  applyPurchaseReceipt, getShoppingWorkspace, recordPurchaseNote, removeManualShoppingItem, saveManualShoppingItem,
} from '../features/shopping/shoppingRepository';
import PurchaseReceiptForm from './PurchaseReceiptForm';
import useSavedFormFocus from './useSavedFormFocus';

const SOURCE_LABELS = { plan: '식단', manual: '직접 입력', repurchase: '재구매' };
const INPUT = 'input min-w-0 w-full';

function todayString() {
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
}

function ManualForm({ item, disabled, onSave, onRemove }) {
  const inputId = useId();
  const [id] = useState(() => item?.id || `manual:${crypto.randomUUID()}`);
  const [values, setValues] = useState(() => ({ name: item?.name || '', quantityText: item?.quantityText || '', memo: item?.memo || '', checked: item?.checked || false }));
  const canSave = values.name.trim().length > 0;
  const change = (field, value) => setValues((current) => ({ ...current, [field]: value }));
  return (
    <form aria-label={item ? `${item.name} 수동 항목` : '수동 장보기 추가'} className="space-y-3 border-t border-brand-100 pt-4"
      onSubmit={(event) => { event.preventDefault(); if (!disabled && canSave) onSave({ id, expectedRevision: item?.revision || 0, values }); }}>
      <fieldset disabled={disabled} className="grid min-w-0 gap-3 sm:grid-cols-2">
        <div><label className="mb-1 block text-sm font-medium" htmlFor={`${inputId}-name`}>품목 이름</label>
          <input id={`${inputId}-name`} className={INPUT} maxLength={80} value={values.name} required onChange={(event) => change('name', event.target.value)} /></div>
        <div><label className="mb-1 block text-sm font-medium" htmlFor={`${inputId}-quantity`}>필요량 메모</label>
          <input id={`${inputId}-quantity`} className={INPUT} maxLength={160} placeholder="예: 한 팩, 양 확인 필요" value={values.quantityText} onChange={(event) => change('quantityText', event.target.value)} /></div>
        <div className="sm:col-span-2"><label className="mb-1 block text-sm font-medium" htmlFor={`${inputId}-memo`}>내 메모</label>
          <input id={`${inputId}-memo`} className={INPUT} maxLength={500} value={values.memo} onChange={(event) => change('memo', event.target.value)} /></div>
        <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm"><input className="m-0 h-5 w-5 shrink-0 cursor-pointer p-0 accent-brand-700 shadow-none" type="checkbox" checked={values.checked} onChange={(event) => change('checked', event.target.checked)} />장보기 체크</label>
      </fieldset>
      <div className="flex flex-col gap-2 sm:flex-row">
        <button className="btn-primary w-full sm:w-auto" type="submit" disabled={disabled || !canSave}>{item ? '수동 항목 저장' : '수동 항목 추가'}</button>
        {item ? <button className="btn-secondary w-full sm:w-auto" type="button" disabled={disabled} onClick={() => onRemove(item)}>수동 항목 제거</button> : null}
      </div>
    </form>
  );
}

function PurchaseForm({ sources, disabled, onSave }) {
  const inputId = useId();
  const [sourceIndex, setSourceIndex] = useState('');
  const [actualQuantityText, setActualQuantityText] = useState('');
  const [memo, setMemo] = useState('');
  const requestRef = useRef(null);
  const source = sourceIndex === '' ? null : sources[Number(sourceIndex)];
  const canSave = source && actualQuantityText.trim();
  function submit(event) {
    event.preventDefault();
    if (disabled || !canSave) return;
    const payload = { source, actualQuantityText, memo };
    const signature = JSON.stringify(payload);
    if (requestRef.current?.signature !== signature) requestRef.current = { signature, operationId: crypto.randomUUID() };
    onSave({ ...payload, operationId: requestRef.current.operationId });
  }
  return (
    <form aria-label="구매 메모 작성" className="space-y-3" onSubmit={submit}>
      <fieldset disabled={disabled} className="min-w-0 space-y-3">
        <div><label className="mb-1 block text-sm font-medium" htmlFor={`${inputId}-source`}>구매한 품목의 출처</label>
          <select id={`${inputId}-source`} className={INPUT} value={sourceIndex} onChange={(event) => setSourceIndex(event.target.value)} required>
            <option value="">품목과 출처를 선택해 주세요</option>
            {sources.map((entry, index) => <option value={index} key={`${entry.source}:${entry.sourceId}`}>
              {SOURCE_LABELS[entry.source]}: {entry.name}{entry.quantityText ? ` (${entry.quantityText})` : ''}
            </option>)}
          </select></div>
        {source ? <div className="break-words rounded-md bg-brand-50 px-3 py-2 text-sm leading-6">
          <p>필요량 메모: {source.quantityText || '양 확인 필요'}</p>
          {typeof source.context === 'string' && source.context ? <p className="text-xs muted">{source.context}</p> : null}
        </div> : null}
        <div><label className="mb-1 block text-sm font-medium" htmlFor={`${inputId}-actual`}>실제로 산 양</label>
          <input id={`${inputId}-actual`} className={INPUT} maxLength={160} required placeholder="예: 500g 한 팩" value={actualQuantityText} onChange={(event) => setActualQuantityText(event.target.value)} />
          <p className="mt-1 text-xs leading-5 muted">필요량과 다를 수 있어요. 포장에 적힌 양을 직접 기록해 주세요.</p></div>
        <div><label className="mb-1 block text-sm font-medium" htmlFor={`${inputId}-memo`}>구매 메모</label>
          <input id={`${inputId}-memo`} className={INPUT} maxLength={500} value={memo} onChange={(event) => setMemo(event.target.value)} /></div>
      </fieldset>
      <button className="btn-primary w-full sm:w-auto" type="submit" disabled={disabled || !canSave}>구매 메모 저장</button>
      {!sources.length ? <p className="text-sm muted">기록할 품목이 없어요. 수동 항목을 추가하거나 확정 식단·재구매 목록을 확인해 주세요.</p> : null}
    </form>
  );
}

function ShoppingNotesSession({ scope, today, disabled, onInventoryApplied, savedFocus, headingRef }) {
  const dayContext = useRef({ today });
  if (dayContext.current.today !== today) dayContext.current = { today };
  const renderedDay = dayContext.current;
  const [storedState, setState] = useState({ day: renderedDay, status: 'idle', snapshot: null, busy: false, notice: '', error: '', revision: 0 });
  // A date boundary invalidates only the read/form, not a committed receipt's
  // acknowledgement. Do not key/remount the write session on today's date.
  const state = storedState.day === renderedDay ? storedState : { ...storedState,
    status: storedState.status === 'idle' ? 'idle' : 'stale', snapshot: null, notice: '', error: '' };
  const mountedRef = useRef(false);
  const operationRef = useRef(null);
  const generationRef = useRef(0);
  useEffect(() => {
    mountedRef.current = true;
    const invalidate = () => {
      generationRef.current += 1;
      setState((current) => current.status === 'idle' ? current : { ...current, status: 'stale', snapshot: null, notice: '', error: '' });
    };
    window.addEventListener('focus', invalidate);
    return () => { mountedRef.current = false; generationRef.current += 1; operationRef.current = null; window.removeEventListener('focus', invalidate); };
  }, []);

  async function execute(kind = 'read', payload) {
    if (disabled || operationRef.current) return;
    const focusIntent = kind !== 'read' ? savedFocus.begin() : null;
    const operation = {};
    const generation = generationRef.current;
    operationRef.current = operation;
    const current = () => mountedRef.current && operationRef.current === operation && generationRef.current === generation && dayContext.current === renderedDay;
    setState({ ...state, day: renderedDay, status: kind === 'read' ? 'loading' : state.status,
      snapshot: kind === 'read' ? null : state.snapshot, busy: true, notice: '', error: '' });
    try {
      if (kind === 'manual') await saveManualShoppingItem({ scope, ...payload });
      else if (kind === 'remove') await removeManualShoppingItem({ scope, id: payload.id, expectedRevision: payload.revision });
      else if (kind === 'purchase') await recordPurchaseNote({ scope, ...payload });
      else if (kind === 'receipt') {
        await applyPurchaseReceipt({ scope, ...payload });
        // Focus/day changes invalidate the form, not an acknowledged inventory write.
        // Account/reset changes still unmount this session and discard its callback.
        if (mountedRef.current && operationRef.current === operation) await onInventoryApplied?.(focusIntent);
      }
      if (!current()) return;
      const snapshot = await getShoppingWorkspace(scope, todayString());
      if (!current()) return;
      if (snapshot.scope !== scope || !Array.isArray(snapshot.manualItems) || !Array.isArray(snapshot.purchaseNotes)
        || !Array.isArray(snapshot.receipts) || !Array.isArray(snapshot.sources)) throw new Error('장보기 계정을 확인할 수 없습니다.');
      savedFocus.complete(focusIntent);
      setState((previous) => ({ day: renderedDay, status: 'ready', snapshot, busy: true, error: '', revision: previous.revision + 1,
        notice: kind === 'manual' ? '수동 항목을 저장했어요.' : kind === 'remove' ? '수동 항목을 제거했어요.' : kind === 'purchase' ? '구매 메모를 저장했어요.' : kind === 'receipt' ? '구매를 재고에 반영했어요.' : '' }));
    } catch {
      savedFocus.cancel(focusIntent);
      if (current()) setState((previous) => ({ ...previous, status: 'error', notice: '', error: kind === 'read'
        ? '장보기 메모를 읽지 못했어요. 장보기 메모 새로고침으로 다시 확인해 주세요.'
        : '저장 결과를 확인하지 못했어요. 같은 입력으로 다시 저장하거나 장보기 메모 새로고침으로 기록을 확인해 주세요.' }));
    } finally {
      if (operationRef.current === operation) {
        operationRef.current = null;
        if (mountedRef.current) setState((previous) => ({ ...previous, busy: false }));
      }
    }
  }

  return (
    <section aria-label="장보기 메모" aria-busy={state.busy} className="min-w-0 rounded-lg border border-brand-100 bg-white p-4 sm:p-5">
      <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 ref={headingRef} tabIndex={-1} className="text-base font-semibold text-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-700">장보기 메모</h2>
        <button className="btn-secondary w-full sm:w-auto" type="button" disabled={disabled || state.busy} onClick={() => execute()}>{state.status === 'idle' ? '장보기 메모 열기' : '장보기 메모 새로고침'}</button>
      </div>
      <p className="mt-3 text-sm leading-6 muted">식단·직접 입력·재구매의 출처를 나눠 기록해요. 이름이 같아도 서로 다른 장보기 의도일 수 있어 합치지 않아요.</p>
      <p className="mt-1 text-xs leading-5 text-amber-900">체크와 구매 메모는 실제 재고에 반영하지 않아요. 구매 이력에서 입고할 양을 확인해 별도로 반영해 주세요. 이력과 확인 수량은 이 기기에만 남아요.</p>
      <p className="mt-1 text-xs leading-5 muted">계정이나 자료가 바뀌거나 다른 화면에서 돌아오면 작성 중인 입력을 닫아요. 최신 목록을 다시 읽어 주세요.</p>
      {state.busy ? <p role="status" className="mt-3 text-sm text-brand-700">장보기 메모를 처리하고 있어요.</p> : null}
      {state.status === 'stale' ? <p role="status" className="mt-3 text-sm text-amber-900">다른 화면의 변경을 확인하려면 장보기 메모를 다시 불러 주세요.</p> : null}
      {state.error ? <p role="alert" className="mt-3 text-sm text-red-800">{state.error}</p> : null}
      {state.notice ? <p role="status" className="mt-3 text-sm text-brand-700">{state.notice}</p> : null}
      {state.snapshot ? <div key={state.revision} className="mt-5 space-y-6">
        {state.snapshot.overdueMeals?.length ? <section aria-label="보류 중인 지난 끼니" className="space-y-2 text-sm leading-6 text-amber-900">
          <h3 className="font-semibold">보류 중인 지난 끼니</h3>
          <p>조리 여부 확인 필요 · 예정 배분 보류. 지난 끼니 자체를 구매 품목으로 추가하지 않아요. 식단 화면에서 조리 기록·건너뛰기 확정·날짜 이동으로 정리해 주세요.</p>
          <ul>{state.snapshot.overdueMeals.map(meal => <li key={meal.slotId}>{meal.date} · {meal.title}</li>)}</ul>
        </section> : null}
        <section aria-label="직접 적은 장보기" className="space-y-4">
          <h3 className="text-sm font-semibold text-slate-900">직접 적은 장보기</h3>
          <p className="text-xs leading-5 muted">식단을 바꿔도 직접 적은 항목과 체크는 남아요. 체크 변경도 저장 버튼으로 확정해 주세요.</p>
          {state.snapshot.manualItems.length === 0 ? <p className="text-sm muted">직접 적은 항목이 없어요.</p> : null}
          {state.snapshot.manualItems.map((item) => <ManualForm key={item.id} item={item} disabled={disabled || state.busy} onSave={(input) => execute('manual', input)} onRemove={(entry) => execute('remove', entry)} />)}
          <ManualForm disabled={disabled || state.busy} onSave={(input) => execute('manual', input)} />
        </section>
        <section aria-label="구매 내용 기록" className="space-y-3 border-t border-brand-100 pt-5">
          <h3 className="text-sm font-semibold text-slate-900">실제로 산 양 기록</h3>
          <PurchaseForm sources={state.snapshot.sources} disabled={disabled || state.busy} onSave={(input) => execute('purchase', input)} />
        </section>
        <section aria-label="구매 메모 이력" className="space-y-3 border-t border-brand-100 pt-5">
          <h3 className="text-sm font-semibold text-slate-900">구매 메모 이력</h3>
          <p className="text-xs leading-5 muted">메뉴나 원래 항목이 사라져도 기록 당시의 품목·출처·구매량은 남아요.</p>
          {state.snapshot.purchaseNotes.length ? <ul className="divide-y divide-brand-100">
            {state.snapshot.purchaseNotes.map((note) => {
              const receipt = state.snapshot.receipts?.find((item) => item.purchaseNoteId === note.id);
              return <li key={note.id} className="space-y-1 break-words py-3 text-sm leading-6">
              <p className="font-medium text-slate-900">{SOURCE_LABELS[note.source.source]}: {note.source.name}</p>
              <p>실제로 산 양: {note.actualQuantityText}</p>
              <p className="text-xs muted">기록 당시 필요량: {note.source.quantityText || '양 확인 필요'}</p>
              {note.memo ? <p>{note.memo}</p> : null}
              <p className="text-xs muted">{note.createdAt.slice(0, 10)} · {receipt ? '입고 기록 있음' : '재고 미반영'}</p>
              {receipt ? <p className="text-sm text-brand-700">{receipt.values.quantityStatus === 'verified'
                ? `입고 당시 ${receipt.values.amount}${receipt.values.unit} · 현재 남은 양은 냉장고에서 확인해 주세요.`
                : '입고 당시 수량 미확인 · 냉장고에서 남은 양을 확인해 주세요.'}</p>
                : <PurchaseReceiptForm note={note} disabled={disabled || state.busy} onSave={(input) => execute('receipt', input)} />}
            </li>;
            })}
          </ul> : <p className="text-sm muted">아직 구매 메모가 없어요.</p>}
        </section>
      </div> : null}
    </section>
  );
}

export default function ShoppingNotesPanel({ scope, resetKey = '', today = todayString(), disabled = false, onInventoryApplied }) {
  const { containerRef, headingRef, begin, complete, cancel } = useSavedFormFocus(scope);
  const [receiptNotice, setReceiptNotice] = useState(null);
  async function refreshAfterReceipt(focusIntent) {
    setReceiptNotice({ scope, text: '입고 기록을 저장했어요. 장보기 메모를 다시 열면 기록을 확인할 수 있어요.' });
    try { await onInventoryApplied?.(); }
    catch { setReceiptNotice({ scope, text: '입고는 저장됐지만 목록을 갱신하지 못했어요. 화면을 새로고침해 주세요.' }); }
    complete(focusIntent);
  }
  return <div ref={containerRef}>
    {receiptNotice?.scope === scope ? <p role="status" className="text-sm leading-6 text-brand-700">{receiptNotice.text}</p> : null}
    <ShoppingNotesSession key={JSON.stringify([scope, resetKey, disabled])} scope={scope} today={today} disabled={disabled}
      onInventoryApplied={refreshAfterReceipt} headingRef={headingRef} savedFocus={{ begin, complete, cancel }} />
  </div>;
}
