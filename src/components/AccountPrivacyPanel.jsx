import { useEffect, useRef, useState } from 'react';
import { exportUserData } from '../api/authApi';
import { captureAuthContext, isAuthContextCurrent } from '../features/auth/authSessionContext';

function AccountPrivacyPanel({ deleteAccount, ownerContext = captureAuthContext() }) {
  const [privacyStatus, setPrivacyStatus] = useState('');
  const [privacyError, setPrivacyError] = useState('');
  const [exportPassword, setExportPassword] = useState('');
  const [deletePassword, setDeletePassword] = useState('');
  const [showDeleteForm, setShowDeleteForm] = useState(false);
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const mounted = useRef(false);
  const panel = useRef(null);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  // Fence browser-side effects, not requests already received by the server.
  const isCurrent = () => mounted.current && panel.current?.isConnected && isAuthContextCurrent(ownerContext)
    && !ownerContext.transitioning && !ownerContext.blocked;

  const handleDataExport = async (event) => {
    event.preventDefault();
    if (pendingRef.current || !isCurrent()) return;
    pendingRef.current = true;
    setPending(true);
    setPrivacyError('');
    setPrivacyStatus('내 데이터를 준비하고 있습니다...');
    const requestPath = window.location.pathname;
    const requestEntry = window.history.state?.key;
    const cancelAfterNavigation = () => {
      // BrowserRouter can retain the previous route while the next lazy page loads.
      if (window.location.pathname === requestPath && window.history.state?.key === requestEntry) return false;
      setExportPassword('');
      setPrivacyStatus('화면 이동으로 다운로드를 취소했습니다. 필요하면 다시 요청해 주세요.');
      return true;
    };

    try {
      const exportData = await exportUserData(exportPassword);
      if (!isCurrent()) return;
      if (cancelAfterNavigation()) return;
      const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
      const downloadUrl = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      try {
        anchor.href = downloadUrl;
        anchor.download = `fridgemate-data-${new Date().toISOString().slice(0, 10)}.json`;
        document.body.appendChild(anchor);
        anchor.click();
      } finally {
        anchor.remove();
        URL.revokeObjectURL(downloadUrl);
      }
      setExportPassword('');
      setPrivacyStatus('내 데이터 파일을 내려받았습니다.');
    } catch (nextError) {
      if (!isCurrent()) return;
      if (cancelAfterNavigation()) return;
      setPrivacyStatus('');
      setPrivacyError(nextError.message || '내 데이터를 내려받지 못했습니다.');
    } finally {
      if (isCurrent()) {
        pendingRef.current = false;
        setPending(false);
      }
    }
  };

  const handleAccountDeletion = async (event) => {
    event.preventDefault();
    if (pendingRef.current || !isCurrent()) return;

    if (!window.confirm('계정과 서버에 저장된 데이터를 영구 삭제할까요? 이 작업은 되돌릴 수 없습니다.')) {
      return;
    }
    if (!isCurrent()) return;

    pendingRef.current = true;
    setPending(true);
    setPrivacyError('');
    setPrivacyStatus('계정과 데이터를 삭제하고 있습니다...');

    try {
      await deleteAccount(deletePassword);
    } catch (nextError) {
      if (!isCurrent()) return;
      setPrivacyStatus('');
      setPrivacyError(nextError.message || '계정을 삭제하지 못했습니다.');
    } finally {
      if (isCurrent()) {
        pendingRef.current = false;
        setPending(false);
      }
    }
  };

  return (
    <section ref={panel} className="card space-y-4">
      <div>
        <p className="kicker">개인정보 관리</p>
        <h3 className="mt-2 text-xl font-semibold text-slate-900">내 데이터 내려받기와 계정 삭제</h3>
        <p className="mt-2 text-sm leading-6 muted">
          서버에 저장된 계정 정보, 재료, 오늘 메뉴, 팬트리, 취향 설정, 추천 및 제품 이벤트를 JSON 파일로 받을 수
          있습니다. 인증 토큰과 비밀번호 해시는 포함하지 않습니다.
        </p>
        <p className="mt-2 text-sm leading-6 muted">주간 식단은 이 기기에만 저장되며 서버 백업과 내 데이터 내려받기에는 포함되지 않습니다.</p>
      </div>

        <div role="status" aria-live="polite" aria-atomic="true" className={privacyStatus ? 'rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900' : 'sr-only'}>
          {privacyStatus}
        </div>
      {privacyError ? (
        <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900">{privacyError}</div>
      ) : null}

      <form className="space-y-3 rounded-lg border border-slate-200 bg-slate-50/60 p-4" onSubmit={handleDataExport}>
        <div>
          <label className="text-sm font-semibold text-slate-900" htmlFor="account-export-password">
            내려받기 전 현재 비밀번호 확인
          </label>
          <input
            autoComplete="current-password"
            disabled={pending}
            className="input mt-2 w-full"
            id="account-export-password"
            maxLength={128}
            onChange={(event) => setExportPassword(event.target.value)}
            required
            type="password"
            value={exportPassword}
          />
        </div>
        <button className="btn-secondary" type="submit" disabled={pending}>
          내 데이터 내려받기
        </button>
      </form>

      <div className="flex flex-wrap gap-3">
        <button
          className="rounded-lg border border-rose-300 px-4 py-2 text-sm font-semibold text-rose-700 hover:bg-rose-50"
          onClick={() => setShowDeleteForm((current) => !current)}
          disabled={pending}
          type="button"
        >
          계정 삭제
        </button>
      </div>

      {showDeleteForm ? (
        <form className="space-y-3 rounded-lg border border-rose-200 bg-rose-50/60 p-4" onSubmit={handleAccountDeletion}>
          <div>
            <label className="text-sm font-semibold text-slate-900" htmlFor="account-delete-password">
              현재 비밀번호
            </label>
            <input
              autoComplete="current-password"
              disabled={pending}
              className="input mt-2 w-full"
              id="account-delete-password"
              maxLength={128}
              onChange={(event) => setDeletePassword(event.target.value)}
              required
              type="password"
              value={deletePassword}
            />
          </div>
          <p className="text-sm leading-6 text-rose-800">
            서버의 계정 및 연결 데이터와 이 기기에 남은 해당 계정의 재료 캐시·주간 식단을 삭제합니다. 삭제 후 복구할 수
            없습니다.
          </p>
          <button className="rounded-lg bg-rose-700 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-800 disabled:opacity-60" type="submit" disabled={pending}>
            영구 삭제 확인
          </button>
        </form>
      ) : null}
    </section>
  );
}

export default AccountPrivacyPanel;
