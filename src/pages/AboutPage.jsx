import { Link } from 'react-router-dom';
import PageHeader from '../components/PageHeader';

function AboutPage() {
  return (
    <div className="section-shell mx-auto w-full max-w-4xl px-4 sm:px-6 lg:px-10">
      <PageHeader
        eyebrow="서비스 소개"
        title="저녁 식단을 정하고, 장보기와 조리까지"
        description="오늘뭐먹지(FridgeMate)는 성인 1~2인의 주간 저녁 식단을 돕는 서비스입니다. 냉장고 재료를 활용해 무엇을 먹을지 정하고, 준비할 재료와 실제 조리 기록을 이어서 관리하세요."
      />

      <div className="space-y-2">
        <div className="flex flex-wrap gap-2">
          <Link to="/meal-plan" className="btn-primary">이번 주 식단 만들기</Link>
          <Link to="/recipes" className="btn-secondary">메뉴부터 둘러보기</Link>
        </div>
        <p className="text-sm leading-6 muted">가입과 재료 등록 없이 시작할 수 있어요. 있는 재료는 나중에 등록해도 됩니다.</p>
      </div>

      <section aria-labelledby="about-workflow-title" className="card text-sm leading-7 text-slate-700">
        <h2 id="about-workflow-title" className="text-base font-semibold text-slate-900">이번 주 식사를 준비하는 순서</h2>
        <ol className="mt-4 list-decimal space-y-4 pl-5 marker:font-semibold marker:text-green-700">
          <li className="pl-1">
            <h3 className="font-semibold text-slate-900">먹을 날과 인원을 정해요</h3>
            <p>저녁을 먹을 날짜, 1~2인 분량, 피하고 싶은 재료를 선택하세요. 제안된 메뉴를 바꾸거나 고정한 뒤 식단을 확정합니다.</p>
          </li>
          <li className="pl-1">
            <h3 className="font-semibold text-slate-900">냉장고를 확인하고 부족한 재료를 준비해요</h3>
            <p>확인된 재고와 재료량을 기준으로 장보기 목록을 살펴보세요. 등록하지 않은 재료는 없다고 단정하지 않고, 보유 여부나 양을 확인하도록 안내합니다.</p>
          </li>
          <li className="pl-1">
            <h3 className="font-semibold text-slate-900">실제로 산 양과 조리한 내용을 기록해요</h3>
            <p>식단 확정이나 장보기 체크만으로 재고가 바뀌지는 않습니다. 구매한 양과 실제 사용량을 직접 확인해 반영하고, 일정이 바뀌면 남은 식단을 조정하세요.</p>
          </li>
        </ol>
      </section>

      <section aria-labelledby="about-records-title" className="card space-y-4 text-sm leading-7 text-slate-700">
        <h2 id="about-records-title" className="text-base font-semibold text-slate-900">재료와 기록을 다루는 원칙</h2>
        <p>공개 레시피에는 원문 재료·조리법과 출처를 표시합니다. 주간 식단용 메뉴 구성은 별도 자료이며, 확인되지 않은 분량은 임의로 채우지 않습니다. 추천은 식품 안전이나 영양·의료 조언을 대신하지 않습니다.</p>
        <p>주간 식단과 입고·조리 이력은 로그인 여부와 관계없이 이 브라우저에 저장됩니다. 다른 기기로 자동 동기화되지 않으며, 브라우저 데이터를 지우면 기록을 잃을 수 있습니다. 비로그인 재료 정보도 이 브라우저에 저장합니다.</p>
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          <Link to="/privacy" className="font-medium text-green-800 underline underline-offset-4">개인정보 처리 안내</Link>
          <Link to="/contact" className="font-medium text-green-800 underline underline-offset-4">의견·오류 제보</Link>
        </div>
      </section>
    </div>
  );
}

export default AboutPage;
