import { useCallback, useEffect, useRef, useState } from 'react';
import PageHeader from '../components/PageHeader';
import { useAuth } from '../hooks/useAuth';
import { grantMealPlanPilotConsent, prepareMealPlanPilotExport, withdrawMealPlanPilotConsent } from '../features/mealPlans/mealPlanPilotConsent';
import { getMealPlanPilotCapture, resumeMealPlanPilotCapture, subscribeMealPlanPilotCapture } from '../features/mealPlans/mealPlanPilotCollector';
import { LOCAL_PILOT_POLICY } from '../features/mealPlans/mealPlanPilotPolicy';
import { isLocalPilotBuild } from '../utils/pilotMode';

const READ_FAILURE = '파일럿 상태를 확인하지 못했어요. 상태를 다시 확인해 주세요.';
const dateText = value => new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));

function PilotSession({ scope }) {
  const pilotEnabled = isLocalPilotBuild();
  const [capture, setCapture] = useState(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [withdrawVersion, setWithdrawVersion] = useState(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const mounted = useRef(false);
  const epoch = useRef(0);
  const readId = useRef(0);
  const reading = useRef(false);
  const busy = useRef(false);
  const focusTarget = useRef(null);
  const withdrawButton = useRef(null);
  const recheckButton = useRef(null);
  const cancelButton = useRef(null);

  const refresh = useCallback(async () => {
    if (!mounted.current || busy.current) return;
    const request = ++readId.current;
    reading.current = true;
    setLoading(true);
    setAccepted(false);
    setWithdrawVersion(null);
    setError('');
    setMessage('');
    try {
      const next = await getMealPlanPilotCapture(scope);
      if (mounted.current && request === readId.current) setCapture(next);
    } catch {
      if (mounted.current && request === readId.current) {
        setCapture(null);
        setError(READ_FAILURE);
      }
    } finally {
      if (mounted.current && request === readId.current) {
        reading.current = false;
        setLoading(false);
      }
    }
  }, [scope]);

  useEffect(() => {
    mounted.current = true;
    epoch.current += 1;
    refresh();
    // The scoped subscription includes the collector's shared focus fallback.
    const unsubscribe = subscribeMealPlanPilotCapture(scope, refresh);
    return () => {
      mounted.current = false;
      epoch.current += 1;
      readId.current += 1;
      unsubscribe();
    };
  }, [scope, refresh]);

  useEffect(() => {
    if (loading || working) return;
    const target = focusTarget.current;
    focusTarget.current = null;
    if (target === 'withdraw') withdrawButton.current?.focus();
    if (target === 'recheck') recheckButton.current?.focus();
    if (target === 'cancel') cancelButton.current?.focus();
  }, [loading, working, withdrawVersion, capture, message, error]);

  async function perform(action, failure) {
    if (!mounted.current || busy.current || reading.current || !capture) return;
    busy.current = true;
    setWorking(true);
    setError('');
    setMessage('');
    setAccepted(false);
    setWithdrawVersion(null);
    const startedIn = epoch.current;
    const isCurrent = () => mounted.current && epoch.current === startedIn;
    let result;
    try {
      result = await action(isCurrent);
    } catch {
      result = { error: failure };
    }
    if (!isCurrent()) return;
    try {
      const next = await getMealPlanPilotCapture(scope);
      if (!isCurrent()) return;
      setCapture(next);
    } catch {
      if (!isCurrent()) return;
      setCapture(null);
      result = { error: result?.error || READ_FAILURE };
    }
    if (!isCurrent()) return;
    setMessage(result?.message || '');
    setError(result?.error || '');
    busy.current = false;
    setWorking(false);
    focusTarget.current = 'recheck';
  }

  function join() {
    if (!pilotEnabled || !accepted || !capture || capture.status === 'active') return;
    perform(async isCurrent => {
      const granted = await grantMealPlanPilotConsent({ scope, expectedVersion: capture.version,
        policyVersion: LOCAL_PILOT_POLICY, accepted: true }, { isCurrent });
      if (!isCurrent()) return;
      try {
        await resumeMealPlanPilotCapture({ scope, expectedVersion: granted.version }, { isCurrent });
      } catch {
        return { error: '동의는 저장했지만 파일럿 기록을 시작하지 못했어요. 상태를 확인한 뒤 앞으로 기록을 재개해 주세요.' };
      }
      return { message: '이 기기의 파일럿 기록을 시작했어요.' };
    }, '파일럿 동의를 저장하지 못했어요. 상태를 다시 확인한 뒤 동의해 주세요.');
  }

  function resume() {
    if (!pilotEnabled || capture?.status !== 'active') return;
    perform(async isCurrent => {
      await resumeMealPlanPilotCapture({ scope, expectedVersion: capture.version }, { isCurrent });
      return { message: '앞으로의 파일럿 기록을 재개했어요. 이전에 빠진 행동 기록은 복원하지 않았어요.' };
    }, '파일럿 기록을 재개하지 못했어요. 상태를 다시 확인해 주세요.');
  }

  function download() {
    if (capture?.status !== 'active') return;
    const version = capture.version;
    perform(async isCurrent => {
      const before = await getMealPlanPilotCapture(scope);
      if (!isCurrent()) return;
      if (before.status !== 'active' || before.version !== version) throw new Error();
      const exported = await prepareMealPlanPilotExport({ scope, expectedVersion: version }, { isCurrent });
      if (!isCurrent()) return;
      const current = await getMealPlanPilotCapture(scope);
      if (!isCurrent()) return;
      if (current.status !== 'active' || current.version !== version) throw new Error();
      let url;
      let anchor;
      try {
        url = URL.createObjectURL(new Blob([JSON.stringify(exported, null, 2)], { type: 'application/json' }));
        if (!isCurrent()) return;
        anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = `fridgemate-local-pilot-${exported.dataset.exportedAt.slice(0, 10)}.json`;
        document.body.appendChild(anchor);
        anchor.click();
      } finally {
        anchor?.remove();
        if (url) URL.revokeObjectURL(url);
      }
      return { message: '파일럿 기록 다운로드를 요청했어요. 브라우저의 다운로드 목록과 저장 위치를 확인해 주세요.' };
    }, '파일럿 기록을 내려받지 못했어요. 참여 상태와 보관 기간을 다시 확인해 주세요.');
  }

  function confirmWithdrawal() {
    if (withdrawVersion === null) return;
    const version = withdrawVersion;
    perform(async isCurrent => {
      await withdrawMealPlanPilotConsent(scope, { expectedVersion: version, isCurrent });
      return { message: '참여를 철회하고 이 기기의 해당 파일럿 기록을 삭제했어요. 재고·식단·조리 기록은 그대로예요.' };
    }, '참여 철회와 기록 삭제를 완료하지 못했어요. 상태를 다시 확인한 뒤 진행해 주세요.');
  }

  const disabled = loading || working;
  const active = capture?.status === 'active';
  const captureAnnouncement = loading || !capture ? '' : active
    ? `파일럿 ${capture.captureState === 'collecting' ? '기록 수집 중' : '기록 일시 중지'}. 누락 구간 ${capture.gapCount}개, 처리 확인 중 ${capture.pendingCount}개.`
    : capture.status === 'withdrawn' ? '파일럿 참여 철회 상태예요.'
      : capture.status === 'expired' ? '파일럿 보관 기간이 끝났어요.' : '파일럿에 참여하지 않고 있어요.';

  return (
    <div className="section-shell mx-auto w-full max-w-4xl px-4 sm:px-6 lg:px-10">
      <p role="status" className="sr-only" aria-label="파일럿 상태 알림" aria-live="polite" aria-atomic="true">{captureAnnouncement}</p>
      <PageHeader title={pilotEnabled ? '식단 파일럿 참여' : '파일럿 기록 관리'} description="식단 기능을 개선하기 위한 별도의 선택이에요. 참여하지 않아도 재고·식단·조리 기능은 그대로 사용할 수 있어요." />
      {!pilotEnabled ? <p className="text-sm leading-6 muted">이 환경에서는 신규 참여나 기록 재개를 지원하지 않아요. 기존 기록의 내려받기와 참여 철회만 할 수 있어요.</p> : null}
      <section className="card space-y-4" aria-label="파일럿 기록 안내">
        <h2 className="text-lg font-semibold">이 기기에만 보관하고, 직접 내려받아요</h2>
        <ul className="list-disc space-y-2 pl-5 text-sm leading-6 text-slate-700">
          <li>이번 파일럿 기록은 메뉴 결정과 실제 조리 흐름의 사용성 검증에만 사용해요. 연구나 모델 학습 용도로 사용하지 않아요.</li>
          <li>브라우저 데이터를 지우거나 기기·브라우저·접속 주소가 바뀌면 이 기록에 접근할 수 없어요. 자동으로 다른 기기에 복원하지 않아요.</li>
          <li>식단 생성·확정·변경, 장보기 계산, 입고·조리·사용량 반영과 취소의 최소 이용 기록을 저장해요. 재료명·메모·OCR 원문·계정 식별자는 파일럿 내보내기에 넣지 않아요.</li>
          <li>메뉴를 교체하거나 건너뛸 때 선택한 이유도 기록해요. 취향·재료·비용·난이도·일정·메뉴 반복 등의 선택 항목만 저장하며, 이유를 고르지 않아도 이용할 수 있어요.</li>
          <li>동의 시점부터 35일이 지나면 세션 전체를 삭제해요. 앱이 닫혀 있었다면 다음 앱 실행이나 파일럿 상태 확인 때 정리해요.</li>
          <li>기록은 현재 브라우저의 게스트 또는 계정별 공간에 저장돼요. 자동으로 서버나 외부 분석 서비스에 보내지 않으며, 일반 분석 설정 및 서버 개인정보 내려받기와는 별개예요.</li>
          <li>내려받은 파일은 앱에서 회수하거나 삭제할 수 없어요. 공유 여부와 보관은 직접 결정해 주세요.</li>
          <li>파일럿 저장이 실패해도 재고·식단·조리 저장은 유지돼요. 빠진 관측은 안내하며, 뒤늦게 과거 행동을 만들어 복원하지 않아요.</li>
        </ul>
        <p className="text-sm leading-6 muted">측정 단위는 사람이나 실제 계정 수가 아닌 브라우저별 기록이에요. 이 기기에서 처음 관측한 생성이 서비스의 첫 사용이었다고 가정하지 않아요.</p>
      </section>

      <section className="card space-y-4" aria-label="파일럿 참여 설정" aria-busy={disabled}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">{scope === 'guest' ? '현재 브라우저의 게스트 기록' : '현재 계정의 이 브라우저 기록'}</h2>
          <button ref={recheckButton} type="button" className="btn-secondary min-h-11" disabled={disabled} onClick={refresh}>파일럿 상태 다시 확인</button>
        </div>
        {loading ? <p className="text-sm muted">파일럿 상태를 확인하고 있어요.</p> : null}
        {message ? <p role="status" aria-label="파일럿 작업 결과" className="rounded-lg bg-brand-50 p-3 text-sm leading-6 text-brand-700">{message}</p> : null}
        {error ? <p role="alert" className="rounded-lg bg-amber-50 p-3 text-sm leading-6 text-amber-900">{error}</p> : null}

        {active ? (
          <>
            <dl className="grid gap-3 text-sm sm:grid-cols-2">
              <div><dt className="muted">시작</dt><dd className="mt-1 font-medium">{dateText(capture.startedAt)}</dd></div>
              <div><dt className="muted">보관 종료</dt><dd className="mt-1 font-medium">{dateText(capture.expiresAt)}</dd></div>
              <div><dt className="muted">저장된 최소 기록</dt><dd className="mt-1 font-medium">{capture.eventCount}개</dd></div>
              <div><dt className="muted">수집 상태</dt><dd className="mt-1 font-medium">{capture.captureState === 'collecting' ? '앞으로의 이용 기록 수집 중' : '기록 일시 중지'}</dd></div>
            </dl>
            <p className="text-sm leading-6 muted">{pilotEnabled
              ? '새로고침 후나 다른 탭에서 이어 쓸 때는 기록 상태를 확인해 주세요. 일시 중지 상태라면 앞으로 기록 재개를 선택해야 해요. 재개 전 누락된 행동은 복원하지 않아요.'
              : '이 환경에서 이용한 행동은 파일럿 기록에 추가하지 않아요. 기존 기록은 내려받거나 참여 철회로 삭제할 수 있어요.'}</p>
            {capture.captureState === 'paused' || capture.gapCount > 0 || capture.pendingCount > 0 ? (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm leading-6 text-amber-900">
                <p>파일럿 관측이 완전하지 않을 수 있어요. 기록 누락 구간 {capture.gapCount}개, 처리 확인 중 {capture.pendingCount}개예요. 식단·조리·입고 자체의 실패를 뜻하지는 않아요.</p>
                <p>재개해도 이전 누락은 남으며 과거 행동을 복원하지 않아요. 내려받기는 현재 확인된 기록만 포함해요.</p>
              </div>
            ) : null}
            <div className="flex flex-wrap gap-2">
              {pilotEnabled && capture.captureState === 'paused' ? <button className="btn-primary min-h-11" type="button" disabled={disabled} onClick={resume}>앞으로 기록 재개</button> : null}
              <button className="btn-secondary min-h-11" type="button" disabled={disabled} onClick={download}>파일럿 기록 내려받기</button>
              <button ref={withdrawButton} className="btn-secondary min-h-11" type="button" disabled={disabled} onClick={() => {
                if (busy.current || reading.current) return;
                setWithdrawVersion(capture.version);
                focusTarget.current = 'cancel';
              }}>참여 철회 및 기록 삭제</button>
            </div>
            {withdrawVersion !== null ? (
              <div className="space-y-3 rounded-lg border border-rose-200 bg-rose-50 p-4" role="group" aria-label="파일럿 참여 철회 확인">
                <p className="text-sm leading-6">이 브라우저의 현재 참여를 철회하고 해당 파일럿 기록을 모두 삭제할까요? 되돌릴 수 없으며, 재고·식단·조리 기록과 이미 내려받은 파일은 삭제하지 않아요.</p>
                <div className="flex flex-wrap gap-2">
                  <button ref={cancelButton} className="btn-secondary min-h-11" type="button" disabled={disabled} onClick={() => { setWithdrawVersion(null); focusTarget.current = 'withdraw'; }}>취소</button>
                  <button className="btn-secondary min-h-11" type="button" disabled={disabled} onClick={confirmWithdrawal}>철회 및 삭제 확인</button>
                </div>
              </div>
            ) : null}
          </>
        ) : capture && pilotEnabled ? (
          <>
            <p className="text-sm leading-6">{capture.status === 'expired' ? '보관 기간이 끝나 이전 파일럿 기록을 삭제했어요. 다시 참여하려면 새로 동의해 주세요.' : capture.status === 'withdrawn' ? '현재 참여하지 않고 있어요. 새 동의는 이전 기록을 복원하지 않아요.' : '현재 참여하지 않고 있어요. 체크하고 시작하기 전에는 파일럿 기록을 수집하지 않아요.'}</p>
            <label className="flex items-start gap-3 text-sm leading-6">
              <input type="checkbox" className="mt-1 w-auto shrink-0" checked={accepted} disabled={disabled} onChange={event => setAccepted(event.target.checked)} />
              <span>이 기기에 식단 파일럿 기록을 저장하는 데 동의해요</span>
            </label>
            <button className="btn-primary min-h-11" type="button" disabled={disabled || !accepted} onClick={join}>동의하고 기록 시작</button>
          </>
        ) : null}
      </section>
    </div>
  );
}

function MealPlanPilotPage() {
  const { storageScope, loading } = useAuth();
  if (loading) return <div className="section-shell" aria-busy="true">현재 계정 상태를 확인하고 있어요.</div>;
  return <PilotSession key={storageScope} scope={storageScope} />;
}

export default MealPlanPilotPage;
