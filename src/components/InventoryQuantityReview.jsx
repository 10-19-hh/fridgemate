import { useEffect, useId, useRef, useState } from 'react';
import useSavedFormFocus from './useSavedFormFocus';
import {
  getInventoryQuantitySnapshot, revokeInventoryQuantity, saveInventoryQuantity,
} from '../features/mealPlans/inventoryQuantityRepository';

const UNITS = ['g', 'kg', 'ml', 'l', '개'];
const PREPARATION_LABELS = { raw: '조리 전', cooked: '조리 후', 'as-sold': '구매 상태' };

function QuantityForm({ item, raw, disabled, onSave, onRevoke }) {
  const inputId = useId();
  const verified = item.quantityState === 'verified';
  const [values, setValues] = useState(() => ({
    name: verified ? item.quantityName : raw.name,
    amount: verified ? String(item.amount) : '',
    unit: verified ? item.unit : '',
    preparationState: verified ? item.preparationState : '',
  }));
  const canSave = values.name.trim() && values.amount.trim() !== '' &&
    Number.isFinite(Number(values.amount)) && Number(values.amount) >= 0 &&
    UNITS.includes(values.unit) && Object.hasOwn(PREPARATION_LABELS, values.preparationState);

  function change(field, value) {
    setValues((current) => ({ ...current, [field]: value }));
  }

  return (
    <form aria-label={`${raw.name} 남은 수량 확인`} className="space-y-3 border-t border-brand-100 pt-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (canSave && !disabled) onSave(item, { ...values, name: values.name.trim(), amount: Number(values.amount) });
      }}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="break-words text-sm font-semibold text-slate-900">{raw.name}</h3>
        <span className={`text-xs font-medium ${verified ? 'text-brand-700' : 'text-amber-900'}`}>
          {verified ? '사용자 확인됨' : item.quantityState === 'stale' ? '다시 확인 필요' : '수량 확인 필요'}
        </span>
      </div>
      <p className="text-xs leading-5 muted">원본 수량: {raw.quantity || '기록 없음'} · 원본 기한: {raw.expiryDate || '기록 없음'}</p>
      {!verified ? <p className="text-xs leading-5 muted">아직 확인하지 않았거나 원본 변경 등으로 확인이 해제된 상태예요. 남아 있는 양을 직접 확인해 주세요.</p> : null}
      <fieldset disabled={disabled} className="grid gap-3 sm:grid-cols-3">
        <div className="sm:col-span-3">
          <label htmlFor={`${inputId}-name`} className="mb-1 block text-xs font-medium text-slate-700">계산에 사용할 재료 이름</label>
          <input id={`${inputId}-name`} className="input w-full" value={values.name} required
            onChange={(event) => change('name', event.target.value)} />
        </div>
        <div>
          <label htmlFor={`${inputId}-amount`} className="mb-1 block text-xs font-medium text-slate-700">확인한 남은 양</label>
          <input id={`${inputId}-amount`} className="input w-full" type="number" min="0" step="any" required
            value={values.amount} onChange={(event) => change('amount', event.target.value)} />
        </div>
        <div>
          <label htmlFor={`${inputId}-unit`} className="mb-1 block text-xs font-medium text-slate-700">단위</label>
          <select id={`${inputId}-unit`} className="input w-full" value={values.unit} required
            onChange={(event) => change('unit', event.target.value)}>
            <option value="">선택해 주세요</option>
            {UNITS.map((unit) => <option key={unit} value={unit}>{unit}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor={`${inputId}-preparation`} className="mb-1 block text-xs font-medium text-slate-700">조리 상태</label>
          <select id={`${inputId}-preparation`} className="input w-full" value={values.preparationState} required
            onChange={(event) => change('preparationState', event.target.value)}>
            <option value="">선택해 주세요</option>
            {Object.entries(PREPARATION_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </div>
      </fieldset>
      <div className="flex flex-col gap-2 sm:flex-row">
        <button className="btn-primary w-full sm:w-auto" type="submit" disabled={disabled || !canSave}>확인한 수량 저장</button>
        {verified || item.quantityState === 'stale' ? (
          <button className="btn-secondary w-full sm:w-auto" type="button" disabled={disabled} onClick={() => onRevoke(item)}>수량 확인 취소</button>
        ) : null}
      </div>
    </form>
  );
}

function QuantityReviewSession({ scope, disabled }) {
  const savedFocus = useSavedFormFocus(scope);
  const [state, setState] = useState({ status: 'idle', snapshot: null, busy: false, notice: '', error: '' });
  const mountedRef = useRef(false);
  const operationRef = useRef(null);
  const generationRef = useRef(0);

  useEffect(() => {
    mountedRef.current = true;
    const invalidate = () => {
      generationRef.current += 1;
      setState((current) => current.status === 'idle' ? current : {
        ...current, status: 'stale', snapshot: null, notice: '', error: '',
      });
    };
    window.addEventListener('focus', invalidate);
    return () => {
      mountedRef.current = false;
      operationRef.current = null;
      generationRef.current += 1;
      window.removeEventListener('focus', invalidate);
    };
  }, []);

  async function execute(item, values, revoke = false) {
    if (disabled || operationRef.current) return;
    const focusIntent = item ? savedFocus.begin() : null;
    const operation = {};
    const generation = generationRef.current;
    operationRef.current = operation;
    const current = () => mountedRef.current && operationRef.current === operation && generationRef.current === generation;
    setState((previous) => ({
      ...previous, status: item ? previous.status : 'loading',
      snapshot: item ? previous.snapshot : null, busy: true, notice: '', error: '',
    }));
    try {
      if (item) {
        const input = { scope, ingredientId: item.id, expectedSourceToken: item.sourceToken, expectedRevision: item.quantityRevision };
        if (revoke) await revokeInventoryQuantity(input);
        else await saveInventoryQuantity({ ...input, values });
        if (!current()) return;
      }
      const snapshot = await getInventoryQuantitySnapshot(scope);
      if (!current()) return;
      if (snapshot.scope !== scope || !Array.isArray(snapshot.ingredients) || !Array.isArray(snapshot.inventory)) {
        throw new Error('수량 목록의 계정을 확인할 수 없습니다.');
      }
      savedFocus.complete(focusIntent);
      setState({ status: 'ready', snapshot, busy: true, error: '',
        notice: item ? (revoke ? '수량 확인을 취소했어요.' : '확인한 수량을 저장했어요.') : '' });
    } catch {
      savedFocus.cancel(focusIntent);
      if (current()) setState((previous) => ({ ...previous, status: 'error', notice: '',
        error: item ? '수량 저장 결과를 확인하지 못했어요. 수량 목록 새로고침 후 다시 확인해 주세요.'
          : '수량 목록을 읽지 못했어요. 수량 목록 새로고침 후 다시 확인해 주세요.' }));
    } finally {
      if (operationRef.current === operation) {
        operationRef.current = null;
        if (mountedRef.current) setState((previous) => ({ ...previous, busy: false }));
      }
    }
  }

  const rawById = new Map((state.snapshot?.ingredients || []).map((item) => [item.id, item]));
  const inventory = (state.snapshot?.inventory || []).filter((item) => rawById.has(item.id) && !item.consumed && !item.deletedAt);

  return (
    <section ref={savedFocus.containerRef} aria-label="남은 수량 확인" aria-busy={state.busy} className="rounded-lg border border-brand-100 bg-white p-4 sm:p-5">
      <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 ref={savedFocus.headingRef} tabIndex={-1} className="text-base font-semibold text-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-700">남은 수량 확인</h2>
        <button type="button" className="btn-secondary w-full sm:w-auto" disabled={disabled || state.busy} onClick={() => execute()}>
          {state.status === 'idle' ? '수량 확인 목록 열기' : '수량 목록 새로고침'}
        </button>
      </div>
      <p className="mt-3 text-sm leading-6 muted">직접 확인한 남은 양을 이 기기에만 저장해 식단 계산에 사용해요. 원본 수량 메모는 해석하거나 바꾸지 않으며, 서버 동기화·실제 재고 차감은 하지 않아요.</p>
      <p className="mt-1 text-xs leading-5 muted">사용자 확인은 정밀 검수나 식품 안전 보장이 아니에요. 재료 이름은 정확히 맞춰 주세요. 계란·달걀을 자동으로 합치지 않아요.</p>
      <p className="mt-1 text-xs leading-5 muted">계정·원본 재료가 바뀌거나 다른 화면에서 돌아오면 목록과 작성 중인 입력을 닫아요. 최신 목록을 다시 읽어 주세요.</p>
      {state.busy ? <p role="status" className="mt-3 text-sm text-brand-700">이 기기의 수량 확인 자료를 처리하고 있어요.</p> : null}
      {state.status === 'stale' ? <p role="status" className="mt-3 text-sm text-amber-900">다른 화면의 변경을 반영하려면 수량 목록을 다시 불러 주세요.</p> : null}
      {state.error ? <p role="alert" className="mt-3 text-sm text-red-800">{state.error}</p> : null}
      {state.notice ? <p role="status" className="mt-3 text-sm text-brand-700">{state.notice}</p> : null}
      {state.snapshot ? (
        <div className="mt-4 space-y-5">
          {inventory.length === 0 ? <p className="text-sm muted">확인할 남은 재료가 없어요. 소비 처리된 재료는 제외해요.</p> : null}
          {inventory.map((item) => <QuantityForm key={JSON.stringify([item.id, item.sourceToken, item.quantityRevision])}
            item={item} raw={rawById.get(item.id)} disabled={disabled || state.busy}
            onSave={(entry, values) => execute(entry, values)} onRevoke={(entry) => execute(entry, undefined, true)} />)}
        </div>
      ) : null}
    </section>
  );
}

export default function InventoryQuantityReview({ scope, resetKey = '', disabled = false }) {
  return <QuantityReviewSession key={JSON.stringify([scope, resetKey, disabled])} scope={scope} disabled={disabled} />;
}
