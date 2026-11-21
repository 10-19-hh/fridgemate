import { useEffect, useRef, useState } from 'react';
import { publicRecipeCatalog, getPublicRecipePath } from '../recipes/publicRecipeCatalog.js';
import { getQuantityRecipeForPublicRecipe } from '../recipes/quantityRecipeCatalog.js';
import { formatQuantity } from '../recipes/quantityDisplay.js';
import { getPlanningInventoryBasis } from './mealPlanningStock.js';
import { getMealPlanningSnapshot, saveMealPlanningStock, previewMealPlanningChange,
  approveMealPlanningChange } from './mealPlanningRepository.js';

const recipes = publicRecipeCatalog.flatMap((source) => {
  const recipe = getQuantityRecipeForPublicRecipe(source);
  return recipe ? [{ ...recipe, path: getPublicRecipePath(source) }] : [];
});
const identity = (line) => [line.foodId, line.preparationState, line.unit].join('|');
const ingredientOptions = [...new Map(recipes.flatMap((recipe) => recipe.ingredients)
  .filter((line) => line.foodId && line.preparationState && line.unit)
  .map((line) => [identity(line), line])).values()];
const names = new Map(recipes.flatMap((recipe) => recipe.ingredients).map((line) => [identity(line), line.rawName]));
const states = { raw: '생재료', minced: '다진 상태', liquid: '액체', ground: '가루',
  'raw-ground': '날가루', 'as-supplied': '원문 상태' };
const textAmount = (amount, unit) => formatQuantity({ amount, unit }).text;

function stockForm(snapshot) {
  return Object.fromEntries(snapshot.ingredients.filter((row) => !row.consumed && !row.deletedAt).map((row) => {
    const confirmation = snapshot.state.stockConfirmations.find((entry) => entry.ingredientId === row.id);
    const current = confirmation?.sourceBasis === getPlanningInventoryBasis([row]);
    return [row.id, {
      identity: confirmation ? identity(confirmation) : '',
      amount: confirmation?.quantityStatus === 'confirmed' ? confirmation.amount ?? '' : '',
      available: Boolean(current && confirmation?.availabilityStatus === 'available'),
      expiryStatus: confirmation?.expiryStatus || (row.expiryDate ? 'dated' : 'unknown'),
      expiryDate: confirmation?.expiryDate || row.expiryDate || '',
    }];
  }));
}

function issueText(issues) {
  const code = issues?.[0]?.code;
  if (code === 'quantity_unavailable') return '사용 가능한 본재료의 양을 확인할 수 없거나 0이에요. 재고를 확인하거나 원래 분량을 선택해 주세요.';
  if (code === 'excluded_ingredient') return '피하고 싶은 재료가 포함된 반찬이에요. 다른 반찬을 선택해 주세요.';
  if (code === 'slot_locked') return '메뉴 고정을 먼저 해제해 주세요.';
  if (code === 'allocation_calculation_failed') return '수량을 계산할 수 없어요. 단위와 입력한 양을 다시 확인해 주세요.';
  if (code === 'stock_confirmation_stale') return '냉장고 내용이 변경됐어요. 재고 확인값을 다시 저장해 주세요.';
  if (code === 'commitment_reconfirmation_required' || code === 'commitment_confirmation_stale') {
    return '기존 반찬의 인원이나 메뉴가 바뀌었어요. 중지된 반찬을 다시 승인하거나 제외해 주세요.';
  }
  return '날짜·반찬·재고 확인 상태를 확인해 주세요. 필요하면 최신 자료를 다시 불러와 주세요.';
}

function StockRow({ row, value, disabled, onChange }) {
  const line = ingredientOptions.find((item) => identity(item) === value.identity);
  const update = (patch) => onChange({ ...value, ...patch });
  return (
    <fieldset className="space-y-3 border-t border-brand-100 py-4" aria-label={`냉장고 ${row.name}`} disabled={disabled}>
      <legend className="pt-4 text-sm font-semibold">{row.name} <span className="font-normal muted">등록 메모: {row.quantity || '수량 미입력'}</span></legend>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm">계산할 재료
          <select className="mt-1" value={value.identity} onChange={(event) => update({ identity: event.target.value, amount: '', available: false })}>
            <option value="">이번 계산에 사용하지 않음</option>
            {ingredientOptions.map((item) => <option key={identity(item)} value={identity(item)}>{item.rawName} / {states[item.preparationState] || item.preparationState} / {item.unit}</option>)}
          </select>
        </label>
        <label className="text-sm">확인한 보유량
          <input className="mt-1" type="number" min="0" step="any" inputMode="decimal" disabled={!line}
            value={value.amount} placeholder={line ? `${line.unit} · 모르면 비워두세요` : '먼저 재료 선택'}
            onChange={(event) => update({ amount: event.target.value })} />
        </label>
        <label className="text-sm">기한 확인
          <select className="mt-1" value={value.expiryStatus} disabled={!line} onChange={(event) => update({ expiryStatus: event.target.value })}>
            <option value="unknown">기한 미확인</option><option value="dated">날짜 확인</option><option value="no-expiry">표시 기한 없음 확인</option>
          </select>
        </label>
        {value.expiryStatus === 'dated' && <label className="text-sm">확인한 기한
          <input className="mt-1" type="date" disabled={!line} value={value.expiryDate} onChange={(event) => update({ expiryDate: event.target.value })} />
        </label>}
      </div>
      <label className="flex min-h-11 items-center gap-2 text-sm"><input className="h-4 w-4 shrink-0 p-0 shadow-none accent-green-700" type="checkbox" disabled={!line}
        checked={value.available} onChange={(event) => update({ available: event.target.checked })} />쓸 수 있는 상태임을 확인</label>
    </fieldset>
  );
}

function Shopping({ shopping }) {
  return (
    <section aria-label="정량 반찬 장보기" className="mt-6 border-t border-brand-100 pt-4">
      <h3 className="font-semibold">정량 반찬 장보기</h3>
      <p className="mt-1 text-xs leading-5 muted">승인한 반찬만 계산해요. 기존 저녁 메뉴 전체나 직접 적은 장보기 목록을 대신하지 않아요. 구매·입고는 자동 반영되지 않아요.</p>
      {!shopping ? <p className="mt-2 text-sm">재확인이 필요해 장보기 계산을 보류했어요.</p>
        : shopping.items.length ? <ul className="mt-3 space-y-2 text-sm">{shopping.items.map((item) => <li key={item.id}>
          <span className="font-medium">{names.get(identity(item)) || '재료 확인 필요'}</span>: {' '}
          {item.needsConfirmation ? `${item.knownMissingAmount > 0 ? `확인된 부족분 ${textAmount(item.knownMissingAmount, item.unit)} · ` : ''}수량·보유 확인 필요`
            : `부족 ${textAmount(item.knownMissingAmount, item.unit)}`}
        </li>)}</ul> : <p className="mt-2 text-sm">현재 승인한 정량 반찬에서 확인된 부족분이 없어요.</p>}
    </section>
  );
}

function PlanningEditor({ scope, weekStart, onReload }) {
  const [snapshot, setSnapshot] = useState(null);
  const [form, setForm] = useState({});
  const [dirty, setDirty] = useState(false);
  const [recipeId, setRecipeId] = useState('');
  const [slotId, setSlotId] = useState('');
  const [mode, setMode] = useState('available');
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const alive = useRef(false);
  const pending = useRef(false);

  useEffect(() => {
    let active = true;
    alive.current = true;
    getMealPlanningSnapshot({ scope }).then((value) => {
      if (active) { setSnapshot(value); setForm(stockForm(value)); }
    }).catch((reason) => { if (active) setError(reason.message); });
    const invalidate = () => setPreview(null);
    window.addEventListener('blur', invalidate);
    return () => { active = false; alive.current = false; window.removeEventListener('blur', invalidate); };
  }, [scope]);

  async function perform(operation, success) {
    if (pending.current || !alive.current) return;
    pending.current = true;
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await operation();
      if (!alive.current) return;
      setSnapshot(result); setForm(stockForm(result)); setDirty(false); setPreview(null); setNotice(success);
    } catch (reason) {
      if (alive.current) { setError(reason.message || '저장하지 못했어요. 다시 확인해 주세요.'); setPreview(null); }
    } finally { pending.current = false; if (alive.current) setBusy(false); }
  }

  function changeSelection(setter, value) { setter(value); setPreview(null); setError(''); setNotice(''); }

  function saveStock(event) {
    event.preventDefault();
    const confirmedAt = new Date().toISOString();
    const confirmations = snapshot.ingredients.flatMap((row) => {
      const value = form[row.id];
      const line = ingredientOptions.find((entry) => identity(entry) === value?.identity);
      if (!line) return [];
      return [{ ingredientId: row.id, sourceBasis: getPlanningInventoryBasis([row]), foodId: line.foodId,
        preparationState: line.preparationState, unit: line.unit,
        amount: value.amount === '' ? null : Number(value.amount), quantityStatus: value.amount === '' ? 'unknown' : 'confirmed',
        availabilityStatus: value.available ? 'available' : 'unknown', expiryStatus: value.expiryStatus,
        expiryDate: value.expiryStatus === 'dated' ? value.expiryDate : null, confirmedAt }];
    });
    perform(() => saveMealPlanningStock({ scope, snapshot, confirmations }), '재고 확인값을 저장했어요. 실제 냉장고 수량은 바꾸지 않았어요.');
  }

  function propose(change) {
    setError(''); setNotice('');
    const parts = new Intl.DateTimeFormat('en', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
    const datePart = (type) => parts.find((part) => part.type === type).value;
    const today = `${datePart('year')}-${datePart('month')}-${datePart('day')}`;
    if (today !== snapshot.fromDate) {
      setPreview(null); setError('날짜가 바뀌었어요. 최신 자료를 다시 불러와 주세요.'); return;
    }
    const result = previewMealPlanningChange({ snapshot, change });
    setPreview(result.status === 'ready' ? result : null);
    if (result.status !== 'ready') setError(issueText(result.issues));
  }

  const plan = snapshot?.plans.find((entry) => entry.weekStart === weekStart);
  const recipe = recipes.find((entry) => entry.id === recipeId);
  const commitments = snapshot?.state.commitments.filter((entry) => entry.planId === `week:${weekStart}`) || [];
  const approvedRecipe = recipes.find((entry) => entry.id === preview?.proposedCommitment?.recipeId);
  const requirements = preview?.allocation?.meals.find((entry) => entry.id === preview.proposedCommitment?.id)?.requirements || [];

  return (
    <section aria-label="정량 반찬 계획" className="mt-4 border-t border-brand-100 pt-5">
      <h2 className="text-lg font-semibold">반찬 한 가지, 있는 양에 맞춰 계획하기</h2>
      <p className="mt-2 text-sm leading-6 muted">한 끼 전체가 아닌 반찬 한 가지의 예정량만 계산해요. 기존 메뉴는 바꾸지 않으며, 실제 냉장고 수량도 차감하지 않아요.</p>
      <p className="mt-1 text-xs leading-5 muted">원문 분량을 AI가 대조한 3개 반찬이에요. 실조리·영양 전문가 검증은 하지 않았어요. 이 기기에만 저장돼요.</p>
      {error && <p role="alert" className="mt-3 text-sm text-red-800">{error}</p>}
      {notice && <p role="status" className="mt-3 text-sm text-brand-700">{notice}</p>}
      <button type="button" className="meal-plan-action mt-3" disabled={busy} onClick={onReload}>최신 자료 다시 불러오기</button>
      {!snapshot ? <p className="mt-3 text-sm" role="status">{error ? '저장된 자료를 확인한 뒤 다시 시도해 주세요.' : '재고와 모든 주의 예정량을 불러오고 있어요.'}</p> : <>
        {snapshot.issues.length > 0 && <p className="mt-3 text-sm text-amber-900">{issueText(snapshot.issues)}</p>}
        <details className="mt-4" open={dirty || undefined}>
          <summary className="cursor-pointer text-sm font-semibold">계산에 사용할 냉장고 재고 확인</summary>
          <p className="mt-2 text-xs leading-5 muted">이름·조리 상태·단위를 직접 연결해 주세요. 등록 메모는 숫자로 자동 변환하지 않아요. 모르는 양은 비워두고, 실제로 없는 경우만 0을 입력하세요. 표시 기한이 식품 안전을 보장하지는 않아요.</p>
          <form onSubmit={saveStock}>
            {snapshot.ingredients.filter((row) => form[row.id]).map((row) => <StockRow key={row.id} row={row} value={form[row.id]} disabled={busy}
              onChange={(value) => { setForm((previous) => ({ ...previous, [row.id]: value })); setDirty(true); setPreview(null); setNotice(''); }} />)}
            {!Object.keys(form).length && <p className="my-3 text-sm">냉장고에 등록된 재료가 없어요. 원래 분량으로 계획한 뒤 보유·구매 여부를 확인할 수 있어요.</p>}
            <button type="submit" className="meal-plan-action mt-2" disabled={busy}>재고 확인값 저장</button>
          </form>
        </details>
        {plan ? <fieldset className="mt-5 space-y-4" disabled={busy}>
          <legend className="text-sm font-semibold">예정할 반찬 선택</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm">계획할 날짜<select className="mt-1" value={slotId} onChange={(event) => changeSelection(setSlotId, event.target.value)}>
              <option value="">날짜 선택</option>
              {plan.slots.filter((slot) => slot.status === 'planned' && !slot.locked && slot.date >= snapshot.fromDate).map((slot) => <option key={slot.id} value={slot.id}>{slot.date} 저녁 · {slot.servings}인 기준</option>)}
            </select></label>
            <label className="text-sm">추가할 반찬<select className="mt-1" value={recipeId} onChange={(event) => changeSelection(setRecipeId, event.target.value)}>
              <option value="">반찬 선택</option>{recipes.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select></label>
          </div>
          {recipe && <a className="text-sm text-brand-700 underline" href={recipe.path} target="_blank" rel="noreferrer">{recipe.name} 원문·조리법 확인</a>}
          <div className="space-y-2 text-sm">
            <label className="flex min-h-11 items-center gap-2"><input className="h-4 w-4 shrink-0 p-0 shadow-none accent-green-700" type="radio" name="portion-mode" value="available" checked={mode === 'available'} onChange={() => changeSelection(setMode, 'available')} />보유량에 맞춘 분량 제안</label>
            <label className="flex min-h-11 items-center gap-2"><input className="h-4 w-4 shrink-0 p-0 shadow-none accent-green-700" type="radio" name="portion-mode" value="original" checked={mode === 'original'} onChange={() => changeSelection(setMode, 'original')} />원래 분량 유지·부족분 확인</label>
          </div>
          {dirty && <p className="text-sm text-amber-900">변경한 재고 확인값을 먼저 저장해 주세요.</p>}
          <button type="button" className="meal-plan-action" disabled={dirty || !slotId || !recipe}
            onClick={() => propose({ type: 'set', planId: plan.id, slotId, recipeId, recipeVersion: recipe.version, mode })}>분량 미리보기</button>
        </fieldset> : <p className="mt-4 text-sm">먼저 이 주의 식단 초안을 만들어 주세요.</p>}
        {preview && <section aria-label="승인 전 분량" className="mt-5 border-l-4 border-brand-500 bg-brand-50 p-4">
          <h3 className="font-semibold">{approvedRecipe ? approvedRecipe.name : '반찬 예정량 제외'}</h3>
          {approvedRecipe ? <>
            <p className="mt-1 text-sm">{preview.change.slotId.slice(0, 10)} · {preview.proposedCommitment.quantityChoice.targetServings}인 기준 레시피의 {preview.change.mode === 'available' ? '보유량에 맞춘' : '원래'} 반찬 분량</p>
            <ul className="mt-3 space-y-1 text-sm">{requirements.map((line, index) => <li key={index} className="flex justify-between gap-4"><span>{names.get(identity(line)) || '재료 확인 필요'}</span><span>{textAmount(line.requiredAmount, line.unit)}</span></li>)}</ul>
            <p className="mt-3 text-xs leading-5">양념은 비율대로 제안하되 간은 직접 맞춰 주세요. 미확인 양념·부재료와 조리 상태를 확인해야 하며, 표시 분량은 한 끼 충족을 뜻하지 않아요.</p>
          </> : <p className="mt-2 text-sm">이 반찬의 예정량만 제외해요. 실제 재고와 직접 적은 장보기는 그대로예요.</p>}
          <button type="button" className="btn-primary mt-4" disabled={busy || dirty} onClick={() => perform(() => approveMealPlanningChange({ scope, preview }),
            '반찬 예정량을 저장하고 정량 반찬 장보기를 갱신했어요.')}>
            {approvedRecipe ? '이 분량을 식단에 승인' : '반찬 제외 승인'}
          </button>
        </section>}
        <section aria-label="승인한 정량 반찬" className="mt-6">
          <h3 className="font-semibold">승인한 정량 반찬</h3>
          {!commitments.length && <p className="mt-2 text-sm muted">아직 승인한 반찬이 없어요. 미리보기만으로는 예정량이 저장되지 않아요.</p>}
          <ul className="mt-2 space-y-3">{commitments.map((item) => <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-brand-100 py-2 text-sm">
            <div><time>{item.slotId.slice(0, 10)}</time><p className="font-medium">{recipes.find((entry) => entry.id === item.recipeId)?.name || '원문 재확인 필요'}</p>
              <p className="text-xs muted">{item.status === 'active' ? '예정량 승인됨 · 조리·소비 기록 아님' : '승인 중지됨 · 메뉴 복원만으로 재승인되지 않아요'}</p>
              {item.status === 'active' && <details className="mt-2">
                <summary className="cursor-pointer">승인한 재료량</summary>
                <ul className="mt-2 space-y-1">{snapshot.meals.find((meal) => meal.id === item.id)?.demands.map((line) => <li key={line.lineId}>
                  {names.get(identity(line)) || '재료 확인 필요'}: <span>{textAmount(line.amount, line.unit)}</span>
                </li>) || <li>수량 재확인 필요</li>}</ul>
              </details>}
            </div>
            <button type="button" className="meal-plan-action" disabled={busy || dirty || plan?.slots.find((slot) => slot.id === item.slotId)?.locked}
              onClick={() => propose({ type: 'remove', planId: item.planId, slotId: item.slotId })}>제외 미리보기</button>
          </li>)}</ul>
        </section>
        <Shopping shopping={snapshot.shopping} />
      </>}
    </section>
  );
}

export default function MealPlanningPanel({ scope, weekStart }) {
  const [reload, setReload] = useState(0);
  return <PlanningEditor key={`${scope}:${weekStart}:${reload}`} scope={scope} weekStart={weekStart} onReload={() => setReload((value) => value + 1)} />;
}
