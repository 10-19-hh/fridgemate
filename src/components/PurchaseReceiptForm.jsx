import { useId, useRef, useState } from 'react';
import { ingredientCategories, storageTypes } from '../features/ingredients/ingredientFields';

function today() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export default function PurchaseReceiptForm({ note, disabled, onSave }) {
  const id = useId();
  const requestRef = useRef(null);
  const [values, setValues] = useState(() => ({ name: note.source.name, quantityText: note.actualQuantityText,
    unknown: false, amount: '', unit: 'g', preparationState: '', purchaseDate: today(), expiryDate: '', category: '기타', storageType: '', memo: '' }));
  const change = (field, value) => setValues((current) => ({ ...current, [field]: value }));
  const canSave = values.name.trim() && values.quantityText.trim() && values.storageType
    && (values.unknown || (values.amount !== '' && Number(values.amount) > 0 && values.preparationState));
  function submit(event) {
    event.preventDefault();
    if (disabled || !canSave) return;
    const { unknown, ...inputValues } = values;
    const payload = { purchaseNoteId: note.id, values: { ...inputValues,
      quantityStatus: unknown ? 'unverified' : 'verified', amount: unknown ? null : Number(values.amount),
      unit: unknown ? null : values.unit, preparationState: unknown ? null : values.preparationState } };
    const signature = JSON.stringify(payload);
    if (requestRef.current?.signature !== signature) requestRef.current = { signature, operationId: crypto.randomUUID() };
    onSave({ ...payload, operationId: requestRef.current.operationId });
  }
  const input = (field, label, { type = 'text', maxLength, required = false } = {}) => <div>
    <label className="mb-1 block text-sm font-medium" htmlFor={`${id}-${field}`}>{label}</label>
    <input id={`${id}-${field}`} className="input min-w-0 w-full" type={type} maxLength={maxLength} required={required}
      value={values[field]} onChange={(event) => change(field, event.target.value)} />
  </div>;
  const select = (field, label, options) => <div>
    <label className="mb-1 block text-sm font-medium" htmlFor={`${id}-${field}`}>{label}</label>
    <select id={`${id}-${field}`} className="input min-w-0 w-full" value={values[field]} required onChange={(event) => change(field, event.target.value)}>
      <option value="">선택해 주세요</option>
      {options.map(([value, name]) => <option key={value} value={value}>{name}</option>)}
    </select>
  </div>;
  return <details className="mt-3 border-l-2 border-brand-600 pl-3">
    <summary className="min-h-11 cursor-pointer py-3 font-semibold text-brand-700">입고할 양 확인</summary>
    <form aria-label={`구매 반영 · ${note.source.name}`} className="space-y-3 pb-2" onSubmit={submit}>
      <p className="text-xs leading-5 muted">실제로 산 양을 새 재고로 추가해요. 필요량을 복사하지 않으며 같은 구매 메모는 한 번만 반영해요.</p>
      <fieldset disabled={disabled} className="grid min-w-0 gap-3 sm:grid-cols-2">
        {input('name', '입고 품목', { maxLength: 120, required: true })}
        {input('quantityText', '포장 메모', { maxLength: 160, required: true })}
        <label className="flex min-h-11 items-center gap-2 sm:col-span-2"><input className="m-0 h-5 w-5 shrink-0 p-0 accent-brand-700 shadow-none" type="checkbox" checked={values.unknown} onChange={(event) => change('unknown', event.target.checked)} />수량 모름</label>
        {!values.unknown ? <>
          <div><label className="mb-1 block text-sm font-medium" htmlFor={`${id}-amount`}>확인한 구매량</label>
            <input id={`${id}-amount`} className="input min-w-0 w-full" type="number" min="0" step="any" inputMode="decimal" required value={values.amount} onChange={(event) => change('amount', event.target.value)} /></div>
          {select('unit', '입고 단위', ['g', 'kg', 'ml', 'l', '개'].map((unit) => [unit, unit]))}
          {select('preparationState', '입고 상태', [['raw', '조리 전'], ['cooked', '조리 후'], ['as-sold', '구매 상태']])}
        </> : <p className="text-xs text-amber-900 sm:col-span-2">포장 메모만 보존하고 양은 미확인으로 저장해요. 이후 부족량도 확인이 필요할 수 있어요.</p>}
        {select('category', '분류', ingredientCategories.map((category) => [category, category]))}
        {select('storageType', '보관 장소', storageTypes.map((storage) => [storage, storage]))}
        {input('purchaseDate', '구매일', { type: 'date' })}
        {input('expiryDate', '유통기한(모르면 비워두기)', { type: 'date' })}
        {input('memo', '입고 메모', { maxLength: 500 })}
      </fieldset>
      <button className="btn-primary w-full sm:w-auto" type="submit" disabled={disabled || !canSave}>확인한 구매량을 재고에 반영</button>
      <p className="text-xs leading-5 muted">입고 이력·확인 수량은 이 기기에 저장돼요. 로그인 재고의 수동 동기화와 별개이며 식품 안전을 보장하지 않아요.</p>
    </form>
  </details>;
}
