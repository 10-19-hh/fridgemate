import { formatQuantity } from '../features/recipes/quantityDisplay';

const STATUS_TITLES = {
  original: '본재료 분량 확인',
  scaled: '본재료 축소 가능',
  'needs-confirmation': '수량 확인 필요',
  unavailable: '사용 가능한 본재료 없음',
  invalid: '수량 계산 불가'
};

export default function QuantityRecommendationSummary({ result }) {
  const hasPositiveQuantity = (result?.status === 'original' || result?.status === 'scaled')
    && Number.isFinite(result.scaleFactor) && result.scaleFactor > 0 && result.scaleFactor <= 1;
  const status = hasPositiveQuantity || result?.status === 'unavailable' || result?.status === 'invalid'
    ? result.status : 'needs-confirmation';
  const ingredients = result?.ingredients || [];
  const coreIngredients = ingredients.filter((line) => line.role === 'core');
  const labels = new Map(ingredients.map((line) => [line.lineId, line.rawName]));
  const checks = result?.checks || [];

  return (
    <section aria-label="확인한 분량" className="space-y-3 border-t border-[#557259]/25 pt-4 text-left text-sm leading-6 text-[#566258]">
      <h4 className="font-semibold text-[#243428]">{STATUS_TITLES[status]}</h4>
      {hasPositiveQuantity ? (
        <>
          <dl className="divide-y divide-[#557259]/10">
            {coreIngredients.map((line) => (
              <div key={line.lineId} className="flex items-baseline justify-between gap-3 py-2">
                <dt className="min-w-0 break-words">{line.rawName}</dt>
                <dd className="shrink-0 font-semibold tabular-nums text-[#243428]">
                  {formatQuantity({ amount: line.scaledAmount, unit: line.unit }).text}
                </dd>
              </div>
            ))}
          </dl>
          <p>이번 요리에 확인한 양이에요. 요청한 인원에게 충분한 한 끼라는 뜻은 아니에요.</p>
        </>
      ) : status === 'needs-confirmation' ? (
        <p>이번 요리에 사용할 수 있는 본재료와 양념의 양을 확인해 주세요.</p>
      ) : status === 'unavailable' ? (
        <p>본재료 중 이번 요리에 쓸 양이 0인 재료가 있어요.</p>
      ) : (
        <p>입력한 수량과 단위를 다시 확인해 주세요.</p>
      )}
      {checks.length ? (
        <div className="space-y-1 border-l-2 border-[#f0bf74] pl-3">
          <p className="font-medium text-[#243428]">추가로 확인할 재료</p>
          <ul>
            {checks.map((check, index) => (
              <li key={`${(check.lineIds || []).join(':')}:${index}`}>
                {[...new Set((check.lineIds || []).map((id) => labels.get(id)).filter(Boolean))].join('·') || '재료'}: {check.missingAmount == null ? '확인 필요' : '부족'}
                {!check.required ? ' (선택 재료)' : ''}
              </li>
            ))}
          </ul>
          <p>양념·부재료는 본재료 분량과 별도로 확인해 주세요.</p>
        </div>
      ) : hasPositiveQuantity && result.requirementsStatus === 'satisfied' ? (
        <p>제안량에 필요한 필수 재료의 양을 모두 확인했어요.</p>
      ) : hasPositiveQuantity ? (
        <p className="border-l-2 border-[#f0bf74] pl-3">필수 양념·부재료의 양은 추가 확인이 필요해요.</p>
      ) : null}
    </section>
  );
}
