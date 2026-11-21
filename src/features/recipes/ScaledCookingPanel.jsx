import { useEffect, useId, useRef, useState } from 'react';
import { validateQuantityRecipe } from './recipeQuantityContract';
import { calculateScaledCooking } from './scaledCooking';
import { buildConfirmedAvailability, getQuantityInputs } from './scaledCookingForm';
import { formatQuantity } from './quantityDisplay';

const STATUS_TITLES = {
  original: '요청한 분량으로 만들 수 있어요',
  scaled: '양을 줄여 만들 수 있어요',
  unavailable: '사용 가능한 본재료가 없어요',
  'needs-confirmation': '본재료 양을 확인해 주세요',
  invalid: '계산할 수 없는 수량이에요',
};
const FOCUS = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#557259] motion-reduce:transition-none';

function PreviewResult({ result }) {
  const labels = new Map(result.ingredients.map((line) => [line.lineId, line.rawName]));
  const labelFor = (lineIds) => [...new Set(lineIds.map((id) => labels.get(id)).filter(Boolean))].join('·');
  const limitingNames = [...new Set(result.limitingIngredients.map((item) => labelFor(item.lineIds)))].join('·');
  const hasQuantities = result.status !== 'invalid';

  return (
    <section aria-label="분량 미리보기 결과" className="space-y-4 border-t border-[#557259]/25 pt-5">
      <div>
        <p className="text-sm font-medium text-[#566258]">본재료 분량</p>
        <h3 className="mt-1 text-xl font-semibold text-[#243428]">{STATUS_TITLES[result.status]}</h3>
        {result.status === 'scaled' ? (
          <p className="mt-2 text-sm leading-6 text-[#566258]">{limitingNames} 양에 맞췄어요. 요청한 인원에게 충분한 한 끼라는 뜻은 아니에요.</p>
        ) : null}
        {result.status === 'unavailable' ? (
          <p className="mt-2 text-sm leading-6 text-[#566258]">본재료 중 이번 요리에 쓸 양이 0인 재료가 있어요.</p>
        ) : null}
        {result.status === 'needs-confirmation' ? (
          <p className="mt-2 text-sm leading-6 text-[#566258]">비어 있는 본재료의 양을 확인하고 다시 계산해 주세요.</p>
        ) : null}
        {result.status === 'invalid' ? (
          <p className="mt-2 text-sm leading-6 text-[#566258]">입력한 수량의 범위와 단위를 다시 확인해 주세요. 너무 작거나 큰 양은 계산할 수 없어요.</p>
        ) : null}
      </div>

      {hasQuantities ? (
        <div>
          <div className="flex justify-between gap-3 border-b border-[#557259]/20 pb-2 text-sm text-[#566258]">
            <span>재료</span><span>제안량</span>
          </div>
          <dl className="divide-y divide-[#557259]/10">
            {result.ingredients.map((line) => (
              <div key={line.lineId} className="flex items-baseline justify-between gap-4 py-3">
                <dt className="min-w-0 break-words text-sm text-[#243428]">{line.rawName}</dt>
                <dd className="shrink-0 text-sm font-semibold tabular-nums text-[#243428]">
                  {formatQuantity({ amount: line.scaledAmount, unit: line.unit }).text}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      ) : null}

      {result.checks.length ? (
        <div className="space-y-2 border-l-2 border-[#f0bf74] pl-3 text-sm leading-6 text-[#566258]">
          <h4 className="font-semibold text-[#243428]">추가로 확인할 재료</h4>
          <ul className="space-y-1">
            {result.checks.map((check, index) => (
              <li key={JSON.stringify(check.lineIds) || index}>
                {labelFor(check.lineIds)}: {check.missingAmount === null ? '확인 필요' : '부족'}
                {!check.required ? ' (선택 재료)' : ''}
              </li>
            ))}
          </ul>
          <p>본재료 분량 계산과 별개예요. 양념·부재료도 확인한 뒤 조리해 주세요.</p>
        </div>
      ) : result.requirementsStatus === 'satisfied' ? (
        <p className="text-sm text-[#566258]">필수 재료의 양을 모두 확인했어요.</p>
      ) : null}
    </section>
  );
}

function ScaledCookingForm({ recipe, scope, confirmation, onConfirm, onInvalidate }) {
  const formId = useId();
  const revision = useRef(0);
  const [targetServings, setTargetServings] = useState(() => confirmation?.targetServings ?? 1);
  const [amounts, setAmounts] = useState(() => confirmation?.amounts ?? {});
  const [localConfirmed, setLocalConfirmed] = useState(null);
  const confirmed = confirmation === undefined ? localConfirmed
    : confirmation?.targetServings === targetServings ? confirmation.inventory : null;
  const [errors, setErrors] = useState([]);
  const [needsReconfirmation, setNeedsReconfirmation] = useState(false);
  const inputs = getQuantityInputs(recipe);
  const coreInputs = inputs.filter((input) => input.role === 'core');
  const otherInputs = inputs.filter((input) => input.role !== 'core');
  const result = confirmed ? calculateScaledCooking({ recipe, targetServings, inventory: confirmed }) : null;
  const reviewNotes = [recipe.reviewNote, ...(Array.isArray(recipe.sourceNotes) ? recipe.sourceNotes : [recipe.sourceNotes])]
    .filter((note) => typeof note === 'string' && note.trim());

  useEffect(() => {
    if (!confirmed) return undefined;
    function invalidateConfirmation() {
      setLocalConfirmed(null);
      onInvalidate?.();
      setNeedsReconfirmation(true);
    }
    function handleVisibility() {
      if (document.visibilityState === 'hidden') invalidateConfirmation();
    }
    window.addEventListener('blur', invalidateConfirmation);
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      window.removeEventListener('blur', invalidateConfirmation);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [confirmed, onInvalidate]);

  function clearConfirmation() {
    setLocalConfirmed(null);
    onInvalidate?.();
    setErrors([]);
    setNeedsReconfirmation(false);
  }

  function handleConfirm(event) {
    event.preventDefault();
    const now = new Date();
    const mealDate = [now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0')].join('-');
    revision.current += 1;
    const next = buildConfirmedAvailability({
      inputs, amounts, scope, revision: `manual:${revision.current}`,
      confirmedAt: now.toISOString(), mealDate,
    });
    setErrors(next.errors);
    if (confirmation === undefined) setLocalConfirmed(next.inventory);
    if (next.inventory) onConfirm?.({ inventory: next.inventory, targetServings, amounts });
    else onInvalidate?.();
    setNeedsReconfirmation(false);
  }

  function renderInput(input) {
    if (input.requestedAmount === null || !input.unit) {
      return <p key={input.id} className="py-2 text-sm leading-6 text-[#566258]">{input.label}: 원문의 필요량이 미확인이어서 직접 확인해 주세요.</p>;
    }
    const index = inputs.indexOf(input);
    const inputId = `${formId}-amount-${index}`;
    const hasError = errors.some((error) => error.inputId === input.id);
    return (
      <div key={input.id} className="grid gap-2 border-b border-[#557259]/10 py-3 sm:grid-cols-[minmax(0,1fr)_10rem] sm:items-center sm:gap-5">
        <label htmlFor={inputId} className="text-sm font-medium leading-6 text-[#243428]">
          {input.label}
        </label>
        <div className="flex items-center gap-2">
          <input
            id={inputId}
            type="text"
            inputMode="decimal"
            autoComplete="off"
            value={amounts[input.id] ?? ''}
            placeholder="미확인"
            aria-label={`${input.label} 사용 가능량 (${input.unit})`}
            aria-invalid={hasError}
            aria-describedby={`${formId}-quantity-help${hasError ? ` ${formId}-errors` : ''}`}
            className={`min-h-11 min-w-0 bg-white text-right tabular-nums ${FOCUS}`}
            onChange={(event) => {
              setAmounts((current) => ({ ...current, [input.id]: event.target.value }));
              clearConfirmation();
            }}
          />
          <span aria-hidden="true" className="min-w-5 text-sm text-[#566258]">{input.unit === 'count' ? '개' : input.unit}</span>
        </div>
      </div>
    );
  }

  return (
    <section aria-labelledby={`${formId}-heading`} className="rounded-lg border border-[#557259]/25 bg-[#f8faf8] p-4 text-left sm:p-5">
      <div className="max-w-prose space-y-2">
        <h2 id={`${formId}-heading`} className="text-xl font-semibold text-[#243428]">이번 요리에 쓸 양으로 계산</h2>
        <p className="text-sm leading-6 text-[#566258]">이 레시피 한 가지의 분량을 계산해요. 밥·반찬을 포함한 한 끼 전체를 구성하지는 않아요.</p>
        {reviewNotes.map((note, index) => <p key={index} className="text-sm leading-6 text-[#566258]">{note}</p>)}
      </div>

      <form onSubmit={handleConfirm} noValidate className="mt-5 space-y-4">
        <div className="max-w-44">
          <label htmlFor={`${formId}-servings`} className="mb-2 block text-sm font-medium text-[#243428]">요리 인원</label>
          <select
            id={`${formId}-servings`}
            value={targetServings}
            className={`min-h-11 ${FOCUS}`}
            onChange={(event) => {
              setTargetServings(Number(event.target.value));
              clearConfirmation();
            }}
          >
            <option value="1">1인</option><option value="2">2인</option>
          </select>
        </div>
        <div className="space-y-1 text-sm leading-6 text-[#566258]">
          <p>다른 끼니에 남겨 둘 양을 빼고 입력하세요. 주간 재고를 자동 배분하지 않습니다.</p>
          <p id={`${formId}-quantity-help`}>빈칸은 미확인, 0은 없음을 뜻해요. 확인한 수량만 숫자로 입력해 주세요.</p>
        </div>
        <fieldset>
          <legend className="text-sm font-semibold text-[#243428]">본재료 사용 가능량</legend>
          {coreInputs.map(renderInput)}
        </fieldset>
        {otherInputs.length ? (
          <div className="space-y-2">
            <details>
              <summary className={`min-h-11 cursor-pointer rounded py-3 text-sm font-medium text-[#243428] ${FOCUS}`}>양념 사용량도 확인하기</summary>
              <div>{otherInputs.map(renderInput)}</div>
            </details>
            <p className="text-sm leading-6 text-[#566258]">입력하지 않은 양념은 미확인으로 남아요. 본재료 계산이 끝나도 따로 확인해 주세요.</p>
          </div>
        ) : null}
        {errors.length ? <p id={`${formId}-errors`} role="alert" className="text-sm font-medium leading-6 text-red-800">표시된 수량을 0 이상의 숫자로 입력해 주세요. 단위·쉼표·지수 표기는 빼 주세요.</p> : null}
        {needsReconfirmation ? <p role="status" className="border-l-2 border-[#f0bf74] pl-3 text-sm leading-6 text-[#566258]">화면을 벗어나 확인이 해제됐어요. 이번 요리에 쓸 양을 다시 확인해 주세요.</p> : null}
        <button type="submit" className={`min-h-11 w-full rounded-md bg-[#557259] px-4 py-3 text-sm font-semibold text-white hover:bg-[#456149] sm:w-auto ${FOCUS}`}>
          확인한 양으로 계산
        </button>
        <p className="text-sm leading-6 text-[#566258]">미리보기만 하며 냉장고·장보기는 바뀌지 않습니다.</p>
      </form>

      <div className="mt-5" aria-live="polite" aria-atomic="true">{result ? <PreviewResult result={result} /> : null}</div>
      <div className="mt-4 space-y-1 text-sm leading-6 text-[#566258]">
        <p>양념은 비율대로 제안합니다. 간은 직접 조절하세요.</p>
        <p>원문의 조리 순서·시간·온도·영양 정보는 원본값이며, 이 미리보기에 맞춰 바뀌지 않아요.</p>
      </div>
    </section>
  );
}

export default function ScaledCookingPanel({ recipe, scope = 'guest', contextKey = '', confirmation, onConfirm, onInvalidate }) {
  if (validateQuantityRecipe(recipe).status !== 'eligible') return null;
  return <ScaledCookingForm key={JSON.stringify([recipe.id, recipe.version, scope, contextKey])}
    recipe={recipe} scope={scope} confirmation={confirmation} onConfirm={onConfirm} onInvalidate={onInvalidate} />;
}
