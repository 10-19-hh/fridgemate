import { useEffect, useId, useRef, useState } from 'react';
import { createMealConsumptionCorrectionModel, createMealConsumptionCorrectionPayload, getMealConsumptionCorrectionPreview,
  mealConsumptionCorrectionFingerprint } from '../features/mealPlans/mealConsumptionCorrectionForm';

const PREPARATIONS = { raw: '조리 전', cooked: '조리 후', 'as-sold': '구매 상태' };
const number = new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 6 });

export default function MealConsumptionCorrectionForm({ title, consumption, inventory, disabled = false, externalError = '', onCorrect, onClose }) {
  const id = useId();
  const heading = useRef(null);
  const pending = useRef(false);
  const amountInputs = useRef(new Map());
  const confirmationInput = useRef(null);
  const [model] = useState(() => createMealConsumptionCorrectionModel(consumption, inventory));
  const [amounts, setAmounts] = useState(() => Object.fromEntries(model.rows.map(row => [row.ingredientId, row.initialAmount])));
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [errorField, setErrorField] = useState(null);
  const stale = model.fingerprint !== mealConsumptionCorrectionFingerprint(consumption, inventory);
  const blocked = disabled || busy || stale || Boolean(model.blockedReason);
  const invalidField = stale || model.blockedReason || externalError ? null : errorField;
  let preview = []; let previewError = '';
  try { preview = getMealConsumptionCorrectionPreview(model, amounts); } catch (failure) { previewError = failure.message; }
  const message = stale ? '재고나 사용량 기록이 바뀌었어요. 닫고 다시 열어 확인해주세요.' : model.blockedReason || externalError || error;

  useEffect(() => { heading.current?.focus(); }, []);

  async function submit() {
    if (blocked || pending.current) return;
    let payload;
    setError('');
    setErrorField(null);
    try { payload = createMealConsumptionCorrectionPayload(model, amounts, confirmed); }
    catch (failure) {
      const index = model.rows.findIndex(row => row.ingredientId === failure.ingredientId);
      setError(index < 0 ? failure.message : `${index + 1}번 재고 · ${failure.message}`);
      setErrorField({ confirmation: failure.field === 'confirmation', ingredientId: failure.ingredientId });
      if (failure.field === 'confirmation') confirmationInput.current?.focus();
      else amountInputs.current.get(failure.ingredientId)?.focus();
      return;
    }
    pending.current = true; setBusy(true);
    try {
      if (await onCorrect(payload) === false) setError('저장 결과를 확인하지 못했어요. 입력은 유지했으니 안내를 확인한 뒤 다시 시도해 주세요.');
    } catch {
      setError('저장 결과를 확인하지 못했어요. 입력은 유지했으니 조리 목록을 새로 확인한 뒤 다시 시도해 주세요.');
    } finally { pending.current = false; setBusy(false); }
  }

  return <form aria-label={`실제 사용량 정정 · ${title}`} aria-busy={busy} noValidate
    className="min-w-0 space-y-5 border-t-2 border-brand-600 pt-4" onSubmit={event => { event.preventDefault(); void submit(); }}>
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h3 ref={heading} tabIndex={-1} className="text-base font-semibold text-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-700">실제 사용량 정정</h3>
        <p className="mt-1 text-sm leading-6 muted">기존 사용량을 현재 재고에 돌려놓고 정정한 양만 반영해요. 조리한 사실과 시각은 유지돼요.</p></div>
      <button type="button" className="meal-plan-action shrink-0" disabled={disabled || busy} onClick={onClose}>정정하지 않고 돌아가기</button>
    </div>
    <section aria-label="기존 사용량 확인" className="space-y-2 text-sm leading-6">
      <h4 className="font-semibold text-slate-900">기존에 기록한 사용량</h4>
      <ul aria-label="기존에 기록한 사용량">{model.previousLines.map(line => <li key={line.inventoryId}>{line.name} {number.format(line.amount)}{line.unit} · {PREPARATIONS[line.preparationState]}</li>)}</ul>
      {!model.previousLines.length ? <p>기록한 사용량 0 · 재고 차감 없음</p> : null}
    </section>
    <fieldset disabled={blocked} className="min-w-0 space-y-4">
      <legend className="mb-2 text-sm font-semibold text-slate-900">정정할 실제 사용량</legend>
      <p className="text-xs leading-5 muted">기록된 양을 먼저 보여드려요. 새로 쓴 재고는 직접 입력하고, 쓰지 않은 재고는 비워두거나 0으로 적어 주세요. 모두 0이면 재고 차감만 없애고 조리 기록은 유지해요.</p>
      {model.rows.map((row, index) => <div key={row.ingredientId} className="min-w-0 border-b border-brand-100 pb-4">
        <label htmlFor={`${id}-amount-${index}`} className="mb-1 block break-words text-sm font-medium">{row.name} ({index + 1}번 재고) 정정할 사용량 ({row.unit})</label>
        <p id={`${id}-stock-${index}`} className="mb-2 text-xs leading-5 muted">현재 {number.format(row.currentAmount)}{row.unit} · 기존 사용량 {number.format(row.oldAmount)}{row.unit} · {PREPARATIONS[row.preparationState]} · {row.storageType || '보관 장소 미확인'} · 기한 {row.expiryDate || '미확인'}</p>
        <input id={`${id}-amount-${index}`} ref={node => { if (node) amountInputs.current.set(row.ingredientId, node); else amountInputs.current.delete(row.ingredientId); }}
          aria-invalid={invalidField?.ingredientId === row.ingredientId || undefined}
          aria-describedby={`${id}-stock-${index}${invalidField?.ingredientId === row.ingredientId ? ` ${id}-error` : ''}`} className="input min-w-0 w-full sm:max-w-xs"
          type="number" inputMode="decimal" min="0" step="any" value={amounts[row.ingredientId]}
          onChange={event => { const value = event.target.value; setAmounts(current => ({ ...current, [row.ingredientId]: value })); setConfirmed(false); setError(''); setErrorField(null); }} />
      </div>)}
      {model.unavailableCount ? <p className="text-xs leading-5 text-amber-900">수량 미확인·소비 완료 등 입력할 수 없는 재고 {model.unavailableCount}개는 새 사용량 목록에서 제외했어요.</p> : null}
    </fieldset>
    <section aria-label="정정 후 재고 미리보기" className="space-y-2 bg-brand-50 p-4 text-sm leading-6">
      <h4 className="font-semibold text-slate-900">정정 후 재고 미리보기</h4>
      <p className="text-xs muted">현재 재고 + 기존 사용량 − 정정할 사용량 = 정정 후 재고. 저장 전에는 재고를 바꾸지 않아요.</p>
      {previewError ? <p className="text-amber-900">{previewError}</p> : <ul className="space-y-2">{preview.map(row => <li key={row.ingredientId} className="break-words">
        {row.name}: <span className="tabular-nums">{number.format(row.currentAmount)}{row.unit} + {number.format(row.oldAmount)}{row.unit} − {number.format(row.amount)}{row.unit} = {number.format(row.remainingAmount)}{row.unit}</span>
      </li>)}</ul>}
    </section>
    <label className="flex min-h-11 cursor-pointer items-start gap-3 py-2 text-sm leading-6">
      <input ref={confirmationInput} type="checkbox" className="m-0 mt-0.5 h-5 w-5 shrink-0 p-0 accent-brand-700 shadow-none" disabled={blocked} checked={confirmed}
        aria-invalid={invalidField?.confirmation || undefined} aria-describedby={invalidField?.confirmation ? `${id}-error` : undefined}
        onChange={event => { setConfirmed(event.target.checked); setError(''); setErrorField(null); }} />정정할 실제 사용량을 모두 확인했어요
    </label>
    <button type="submit" className="btn-primary min-h-11 w-full sm:w-auto" disabled={blocked}>정정한 사용량으로 재고 반영</button>
    {message ? <p id={`${id}-error`} role="alert" className="text-sm leading-6 text-red-800">{message}</p> : null}
    {busy ? <p role="status" className="text-sm text-brand-700">실제 사용량을 정정하고 있어요.</p> : null}
    <p className="text-xs leading-5 muted">이 기기·현재 계정에만 저장하며 서버 백업이나 다른 기기와의 동기화는 아니에요. 수량 확인은 식품 안전 보장이 아니므로 보관 상태도 직접 확인해 주세요.</p>
  </form>;
}
