import { getMealQuantityRequirements } from '../features/mealPlans/mealQuantityDomain';
import { isLocalPilotBuild } from '../utils/pilotMode';

const PREPARATIONS = { raw: '조리 전', cooked: '조리 후', 'as-sold': '구매 상태' };
const number = new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 3 });
const BOOK_URL = 'https://www.foodsafetykorea.go.kr/upload/20170417/20170417053825_1492418305244.pdf';

function sourceHref(source) {
  const page = source?.book?.pdfPage;
  if (source?.book?.url !== BOOK_URL || !Number.isSafeInteger(page) || page < 1) return null;
  const url = `${BOOK_URL}#page=${page}`;
  return source.url === url ? url : null;
}

export default function MealQuantityDetails({ slot }) {
  const pilot = isLocalPilotBuild();
  const reviewed = slot.components.some((component) => component.source.kind === 'mfds-book-source-comparison');
  const editorial = slot.components.every((component) => ['local-recipe', 'editorial-pairing'].includes(component.source.kind));
  if (!reviewed) return (
    <>
      {pilot ? <p role="note" aria-label="메뉴 검수 범위" className="text-xs leading-5 text-amber-900">{editorial ? '편집 조합 · 인분과 식재료량 미검수' : '미검수 · 저장된 출처와 분량을 확인해 주세요.'}</p> : null}
      <p className="muted">재료별 필요량과 실제 분량은 확인되지 않았어요. 여러 날에 같은 재료가 나오면 전체 필요량을 따로 확인해 주세요. 표시된 날짜와 별개로 조리 전 보관 상태도 확인해 주세요.</p>
      {editorial || !pilot ? <p className="text-xs muted">앱 기본 메뉴를 조합한 식단이에요. 인분별 수량과 영양 수치는 아직 검증하지 않았어요.</p> : null}
    </>
  );
  let quantity;
  try { quantity = getMealQuantityRequirements(slot, slot.servings); } catch {
    return <p role="alert" className="text-red-800">저장된 분량 자료를 계산하지 못했어요. 원문을 확인해 주세요.</p>;
  }
  const sourceLine = (reference) => slot.components.find((component) => component.id === reference.componentId)
    ?.ingredients.find((line) => line.id === reference.lineId);
  const foodQuantityReviewed = quantity.status === 'verified'
    && slot.components.every((component) => component.source.kind === 'mfds-book-source-comparison');
  return (
    <div className="space-y-3 border-t border-brand-100 pt-3">
      {pilot ? <p role="note" aria-label="메뉴 검수 범위" className="text-xs leading-5 text-amber-900">{foodQuantityReviewed
        ? '원문 대조 완료(식재료량) · 모든 조리 투입량의 검수는 아니에요. 과정 물과 추가 양념은 따로 확인해 주세요.'
        : '미검수 · 저장된 식재료량을 다시 확인해 주세요.'}</p> : null}
      <h4 className="font-semibold text-slate-900">{slot.servings}인분 식재료 필요량</h4>
      <p className="text-xs leading-5 muted">원문 기준 인분에서 계산한 양이에요. 보유량 확인과 모든 확정 식단의 장보기 계산은 아래 미리보기에서 따로 확인해 주세요.</p>
      {quantity.requirements.length ? (
        <ul aria-label={`${slot.servings}인분 식재료 필요량`} className="divide-y divide-brand-100">
          {quantity.requirements.map((item) => (
            <li key={JSON.stringify([item.ingredientKey, item.preparationState, item.unit])} className="flex items-start justify-between gap-3 py-2">
              <span className="min-w-0"><span className="break-words font-medium">{sourceLine(item.sourceLines[0])?.rawName || item.ingredientKey}</span>
                <span className="ml-2 text-xs muted">{PREPARATIONS[item.preparationState]}</span></span>
              <span className="shrink-0 tabular-nums">{item.amount === null ? `알려진 부분 ${number.format(item.knownAmount)}${item.unit}` : `${number.format(item.amount)}${item.unit}`}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {quantity.unverifiedLines.map((reference) => (
        <p key={`${reference.componentId}:${reference.lineId}`} className="text-amber-900">{sourceLine(reference)?.rawName || '재료'}: 분량 확인 필요</p>
      ))}
      {slot.components.map((component) => {
        const href = sourceHref(component.source);
        return <div key={component.id} className="space-y-2">
          {(component.processInputs || []).map((line) => <p key={line.id} className="text-amber-900">{line.name}: 양 확인 필요. 조리 과정에 쓰는 양은 식재료 합계에 넣지 않았어요.</p>)}
          {(component.methodSummary || []).length ? <div className="text-xs leading-5 muted">
            <p>원문 {component.servings || '미확인'}인분 조리 흐름 요약: {component.methodSummary.join(' ')}</p>
            <p>조리할 때는 위의 {slot.servings}인분 필요량을 확인해 주세요. 양이 없는 조리 과정 재료는 원문에서도 미확인이에요.</p>
          </div> : null}
          <details>
            <summary className="cursor-pointer text-xs font-medium text-slate-700">원문 분량과 대조 근거 보기</summary>
            <div className="mt-2 space-y-1 text-xs leading-5 muted">
              {component.ingredients.map((line) => <p key={line.id}>원문 {component.servings || '미확인'}인분 · {line.rawName} {line.rawAmount || '분량 미확인'} · {line.purpose || '용도 미기재'}</p>)}
              <p>{component.source.comparisonNote}</p>
            </div>
          </details>
          {href ? <a className="inline-block text-xs font-semibold text-brand-700 underline underline-offset-4" href={href} target="_blank" rel="noopener noreferrer">공식 책자 {component.source.book.printedPages.join('–')}쪽 확인</a> : null}
          <p className="text-xs leading-5 muted">{component.source.reviewMethod}</p>
        </div>;
      })}
    </div>
  );
}
