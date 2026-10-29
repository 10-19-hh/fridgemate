import { useEffect, useRef, useState } from 'react';
import { inspectImportCorrections, resetImportCorrections } from '../../utils/import/importLearning';

const CHANGED_MESSAGE = '보정 기록이나 확인 상태가 변경됐어요. 상태를 다시 확인한 뒤 초기화 여부를 선택해 주세요.';
const FAILURE_MESSAGES = {
  changed: CHANGED_MESSAGE,
  invalid: '초기화 확인이 만료됐어요. 상태를 다시 확인한 뒤 초기화 여부를 선택해 주세요.',
  unavailable: '보정 기록을 초기화하지 못했어요. 저장소 접근을 확인한 뒤 상태를 다시 확인해 주세요.',
  partial: '일부 기록이 지워졌을 수 있지만 초기화를 완료하지 못했어요. 상태를 다시 확인해 주세요.'
};

function ImportCorrectionRecoveryPanel({ scope, disabled, canReset }) {
  const [inspection, setInspection] = useState(() => inspectImportCorrections(scope));
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState('');
  const [requiresRecheck, setRequiresRecheck] = useState(false);
  const mounted = useRef(false);
  const confirmation = useRef(null);
  const resetButton = useRef(null);
  const cancelButton = useRef(null);
  const recheckButton = useRef(null);
  const focusTarget = useRef(null);

  useEffect(() => {
    mounted.current = true;
    const inspectAgain = () => {
      const wasConfirming = confirmation.current !== null;
      confirmation.current = null;
      setConfirming(false);
      setInspection(inspectImportCorrections(scope));
      setMessage(wasConfirming ? CHANGED_MESSAGE : '');
      if (wasConfirming) {
        focusTarget.current = 'recheck';
      }
    };
    const onStorage = event => {
      // Ignore another account and sessionStorage. Never render event values.
      if (event.key !== null && event.key !== `fridgemate-import-corrections:v2:${scope}`
        && !(scope === 'guest' && event.key === 'fridgemate-import-corrections')) return;
      try {
        if (event.storageArea && event.storageArea !== window.localStorage) return;
      } catch { /* Reinspection reports access denial without reflecting errors. */ }
      inspectAgain();
    };
    window.addEventListener('storage', onStorage);
    window.addEventListener('focus', inspectAgain);
    return () => {
      mounted.current = false;
      confirmation.current = null;
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('focus', inspectAgain);
    };
  }, [scope]);

  useEffect(() => {
    const target = focusTarget.current;
    focusTarget.current = null;
    if (target === 'reset') resetButton.current?.focus();
    if (target === 'cancel') cancelButton.current?.focus();
    if (target === 'recheck') recheckButton.current?.focus();
  }, [confirming, inspection, message]);

  const isCurrent = () => mounted.current && !disabled && canReset();

  function recheck() {
    if (!isCurrent()) return;
    confirmation.current = null;
    setConfirming(false);
    const next = inspectImportCorrections(scope);
    setInspection(next);
    setRequiresRecheck(false);
    setMessage(next.status === 'ready' ? '보정 기록을 읽을 수 있어요.' : '보정 상태를 다시 확인했어요.');
  }

  function requestReset() {
    if (!isCurrent() || requiresRecheck) return;
    const next = inspectImportCorrections(scope);
    setInspection(next);
    setMessage('');
    if (next.status !== 'damaged') return;
    confirmation.current = next.resetToken;
    setConfirming(true);
    focusTarget.current = 'cancel';
  }

  function cancelReset() {
    if (!isCurrent()) return;
    confirmation.current = null;
    setConfirming(false);
    focusTarget.current = 'reset';
  }

  function confirmReset() {
    if (!isCurrent() || confirmation.current === null) return;
    const resetToken = confirmation.current;
    // A repeated click cannot reuse the confirmation, even before React renders.
    confirmation.current = null;
    setConfirming(false);
    const result = resetImportCorrections({ scope, resetToken }, { isCurrent });
    if (!mounted.current) return;
    setInspection(inspectImportCorrections(scope));
    setRequiresRecheck(result.status !== 'reset');
    setMessage(result.status === 'reset'
      ? '이 기기의 보정 기록을 초기화했어요.'
      : FAILURE_MESSAGES[result.status] || FAILURE_MESSAGES.unavailable);
    focusTarget.current = 'recheck';
  }

  if (inspection.status === 'ready' && !message) return null;

  return (
    <section aria-label="이 기기의 보정 기록" className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-slate-800">
      <h2 className="font-semibold">이 기기의 보정 기록</h2>
      {inspection.status === 'damaged' ? (
        <p className="mt-1 max-w-3xl leading-6">보정 기록 일부가 손상되어 새 보정 학습을 저장할 수 없어요. 기존 기록은 자동으로 지우지 않았어요.</p>
      ) : inspection.status === 'unavailable' ? (
        <p className="mt-1 max-w-3xl leading-6">이 기기의 보정 기록을 확인할 수 없어요. 저장소 접근이 허용되는지 확인해 주세요. 내용을 읽기 전에는 초기화를 진행하지 않아요.</p>
      ) : null}
      {message ? <p aria-live="polite" aria-atomic="true" className="mt-2 leading-6">{message}</p> : null}
      {confirming ? (
        <div className="mt-3 space-y-2 border-t border-amber-200 pt-3" role="group" aria-label="보정 기록 초기화 확인">
          <p className="max-w-3xl leading-6">{scope === 'guest' ? '이 기기의 게스트 보정 기록 전체(이전 버전 기록 포함)' : '이 기기에 저장된 현재 계정의 보정 기록 전체'}를 지워요. 되돌릴 수 없어요.</p>
          <p className="max-w-3xl leading-6">재고·식단·현재 검토 중인 입력은 유지돼요. 서버의 보정 기록은 삭제하지 않아요. 초기화하기 전에 다른 OCR 탭을 닫아 주세요.</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" ref={cancelButton} className="btn-secondary" disabled={disabled} onClick={cancelReset}>취소</button>
            <button type="button" className="btn-secondary" disabled={disabled} onClick={confirmReset}>초기화 확인</button>
          </div>
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap gap-2">
          {inspection.status === 'damaged' && !requiresRecheck ? <button type="button" ref={resetButton} className="btn-secondary" disabled={disabled} onClick={requestReset}>보정 기록 초기화</button> : null}
          <button type="button" ref={recheckButton} className="btn-secondary" disabled={disabled} onClick={recheck}>보정 상태 다시 확인</button>
        </div>
      )}
    </section>
  );
}

export default ImportCorrectionRecoveryPanel;
