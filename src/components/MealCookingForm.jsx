import { useId, useRef, useState } from 'react';
import { createMealCookingFormModel, createMealCookingPayload, mealCookingFormFingerprint } from '../features/mealPlans/mealCookingForm';

const PREPARATIONS = { raw: '조리 전', cooked: '조리 후', 'as-sold': '구매 상태' };
const number = new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 6 });

export default function MealCookingForm({ slot, inventory, disabled = false, externalError = '', onRecord, onClose }) {
  const id = useId();
  const pending = useRef(false);
  const amountInputs = useRef(new Map());
  const confirmationInput = useRef(null);
  const [model] = useState(() => createMealCookingFormModel(slot, inventory));
  const [amounts, setAmounts] = useState(() => Object.fromEntries(model.rows.map(row => [row.ingredientId, row.initialAmount])));
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [errorField, setErrorField] = useState(null);
  const stale = model.fingerprint !== mealCookingFormFingerprint(slot, inventory);
  const blocked = disabled || busy || stale;
  const invalidField = stale || externalError ? null : errorField;

  async function submit(unknown = false) {
    if (blocked || pending.current) return;
    setError('');
    setErrorField(null);
    let payload;
    try {
      payload = unknown ? { usageMode: 'unknown', completeUsageConfirmed: false, usages: [] }
        : createMealCookingPayload(model, amounts, confirmed);
    } catch (failure) {
      const index = model.rows.findIndex(row => row.ingredientId === failure.ingredientId);
      setError(index < 0 ? failure.message : `${index + 1}번 재고 · ${failure.message}`);
      setErrorField({ confirmation: failure.field === 'confirmation', ingredientId: failure.ingredientId });
      if (failure.field === 'confirmation') confirmationInput.current?.focus();
      else amountInputs.current.get(failure.ingredientId)?.focus();
      return;
    }
    pending.current = true;
    setBusy(true);
    try {
      if (await onRecord(payload) === false) setError('저장 결과를 확인하지 못했어요. 아래 안내를 확인한 뒤 다시 시도해 주세요.');
    } catch {
      setError('저장 결과를 확인하지 못했어요. 입력은 유지했으니 목록을 새로 확인한 뒤 다시 시도해 주세요.');
    } finally { pending.current = false; setBusy(false); }
  }

  return <form aria-label={`조리 사용량 · ${slot.title}`} aria-busy={busy} noValidate
    className="mt-4 min-w-0 space-y-5 border-t-2 border-brand-600 pt-4"
    onSubmit={event => { event.preventDefault(); void submit(); }}>
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h4 className="text-base font-semibold text-slate-900">만들어 먹은 양 확인</h4>
        <p className="mt-1 text-sm leading-6 muted">계획된 양은 제안일 뿐이에요. 실제로 쓴 재고와 양을 확인하면 그만큼만 차감해요.</p></div>
      <button type="button" className="btn-secondary min-h-11 shrink-0" disabled={busy} onClick={onClose}>입력 닫기</button>
    </div>
    <section aria-label="계획에서 제안한 양" className="space-y-2">
      <h5 className="text-sm font-semibold text-slate-900">계획에서 제안한 양</h5>
      <ul className="divide-y divide-brand-100 text-sm">
        {model.requirements.map(item => <li key={JSON.stringify([item.ingredientKey, item.preparationState, item.unit])} className="flex flex-wrap justify-between gap-x-3 gap-y-1 py-2">
          <span className="break-words">{item.label} <span className="text-xs muted">{PREPARATIONS[item.preparationState]}</span></span>
          <span className="tabular-nums">{item.amount === null ? `알려진 부분 ${number.format(item.knownAmount)}${item.unit} · 전체 양 확인 필요` : `${number.format(item.amount)}${item.unit}`}</span>
        </li>)}
      </ul>
      {model.unresolved.map((item, index) => <p key={index} className="text-xs leading-5 text-amber-900">{item.label}: 양 확인 필요{item.process ? '. 조리 과정에 쓰는 양은 합계에 넣지 않았어요.' : ''}</p>)}
      {model.optional.map((item, index) => <p key={index} className="text-xs leading-5 muted">{item.label}: 선택 재료 · 사용했다면 실제 쓴 재고에 직접 입력해 주세요.</p>)}
      {!model.requirements.length && !model.unresolved.length ? <p className="text-sm muted">제안할 확인된 필요량이 없어요. 실제 사용량을 직접 확인해 주세요.</p> : null}
    </section>
    <fieldset disabled={blocked} className="min-w-0 space-y-4">
      <legend className="mb-2 text-sm font-semibold text-slate-900">실제로 쓴 재고</legend>
      <p className="text-xs leading-5 muted">같은 재료가 여러 개면 어느 재고를 썼는지 직접 나눠 적어 주세요. 다른 재료를 사용했다면 해당 재고에 적고, 쓰지 않은 재고는 비워두거나 0으로 적어 주세요.</p>
      {model.rows.map((row, index) => <div key={row.ingredientId} className="min-w-0 border-b border-brand-100 pb-4">
        <label htmlFor={`${id}-amount-${index}`} className="mb-1 block break-words text-sm font-medium">{row.name} ({index + 1}번 재고) 실제 사용량 ({row.unit})</label>
        <p id={`${id}-stock-${index}`} className="mb-2 text-xs leading-5 muted">확인된 남은 양 {number.format(row.availableAmount)}{row.unit} · {PREPARATIONS[row.preparationState]} · {row.storageType || '보관 장소 미확인'} · 기한 {row.expiryDate || '미확인'}</p>
        <input id={`${id}-amount-${index}`} ref={node => { if (node) amountInputs.current.set(row.ingredientId, node); else amountInputs.current.delete(row.ingredientId); }}
          aria-invalid={invalidField?.ingredientId === row.ingredientId || undefined}
          aria-describedby={`${id}-stock-${index}${invalidField?.ingredientId === row.ingredientId ? ` ${id}-error` : ''}`} className="input min-w-0 w-full sm:max-w-xs"
          type="number" inputMode="decimal" min="0" step="any" value={amounts[row.ingredientId]}
          onChange={event => { const value = event.target.value; setAmounts(current => ({ ...current, [row.ingredientId]: value })); setConfirmed(false); setError(''); setErrorField(null); }} />
      </div>)}
      {!model.rows.length ? <p className="text-sm leading-6 muted">사용량을 입력할 확인된 재고가 없어요. 냉장고에서 남은 수량을 확인하거나, 아래에서 사용량 없이 조리만 기록할 수 있어요.</p> : null}
      {model.unavailableCount ? <p className="text-xs leading-5 text-amber-900">수량 미확인·소비 완료 등 입력할 수 없는 재고 {model.unavailableCount}개는 실제 사용량 목록에서 제외했어요.</p> : null}
      <p className="text-xs leading-5 muted">확인한 양과 기한은 식품 안전 보장이 아니에요. 보관 상태도 직접 확인해 주세요.</p>
      <label className="flex min-h-11 cursor-pointer items-start gap-3 py-2 text-sm leading-6">
        <input ref={confirmationInput} type="checkbox" className="m-0 mt-0.5 h-5 w-5 shrink-0 p-0 accent-brand-700 shadow-none" checked={confirmed}
          aria-invalid={invalidField?.confirmation || undefined} aria-describedby={invalidField?.confirmation ? `${id}-error` : undefined}
          onChange={event => { setConfirmed(event.target.checked); setError(''); setErrorField(null); }} />실제로 쓴 재고를 모두 확인했어요
      </label>
      <button type="submit" className="btn-primary min-h-11 w-full sm:w-auto" disabled={blocked || !model.rows.length}>실제 사용량으로 조리 기록</button>
    </fieldset>
    <section aria-label="사용량 없이 조리 기록" className="space-y-3 border-t border-brand-100 pt-4">
      <p className="text-sm leading-6 text-amber-900">사용량을 모르면 조리 사실만 기록할 수 있어요. 관련 재고는 미반영·확인 필요 상태가 되어 이후 식단에도 남은 양을 다시 확인해야 해요.</p>
      <button type="button" className="btn-secondary min-h-11 w-full sm:w-auto" disabled={blocked} onClick={() => void submit(true)}>사용량 없이 조리만 기록</button>
    </section>
    {stale || externalError || error ? <p id={`${id}-error`} role="alert" className="text-sm leading-6 text-red-800">{stale ? '재고나 식단이 바뀌었어요. 닫고 다시 열어 확인해주세요.' : externalError || error}</p> : null}
    {busy ? <p role="status" className="text-sm text-brand-700">조리 기록을 저장하고 있어요.</p> : null}
    <p className="text-xs leading-5 muted">조리 기록과 사용량 확인은 이 기기에 저장돼요. 서버 백업이나 다른 기기와의 동기화는 아니에요.</p>
  </form>;
}
