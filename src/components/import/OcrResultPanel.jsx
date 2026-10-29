function OcrResultPanel({ status, progress, error, rawText, showRawText, onToggleRawText }) {
  const progressPercent = Math.round((progress || 0) * 100);
  const isIdle = status === 'idle' && !rawText && !error;
  const announcement = (
    <p role="status" className="sr-only" aria-label="사진 인식 상태" aria-live="polite" aria-atomic="true">
      {status === 'processing' ? '사진에서 재료 찾는 중' : status === 'success'
        ? (rawText ? '사진 읽기가 끝났어요. 가져올 후보를 확인해 주세요.' : '사진을 읽기는 했지만 재료로 보이는 내용을 찾지 못했어요.')
        : ''}
    </p>
  );

  if (isIdle) {
    return (<>
      {announcement}
      <section className="soft-panel flex flex-col gap-1.5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="kicker">{'2. OCR \uACB0\uACFC'}</p>
          <p className="mt-1 text-sm text-slate-700">{'\uC774\uBBF8\uC9C0\uB97C \uC62C\uB9AC\uACE0 \uC2E4\uD589\uD558\uBA74 \uC5EC\uAE30\uC5D0 \uC77D\uC740 \uACB0\uACFC\uAC00 \uB098\uC635\uB2C8\uB2E4.'}</p>
        </div>
        <span className="badge bg-slate-100 text-slate-600">{'\uB300\uAE30 \uC911'}</span>
      </section></>
    );
  }

  return (<>
    {announcement}
    <section className="card space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="kicker">{'2. \uC77D\uC740 \uB0B4\uC6A9 \uD655\uC778'}</p>
          <h3 className="mt-2 text-lg font-semibold text-slate-900 sm:text-[1.35rem]">{'\uC77D\uC740 \uACB0\uACFC\uB97C \uBA3C\uC800 \uD655\uC778\uD558\uC138\uC694'}</h3>
        </div>
        {rawText ? (
          <button type="button" className="btn-secondary" onClick={onToggleRawText}>
            {showRawText ? '\uC6D0\uBCF8 \uC77D\uAE30 \uACB0\uACFC \uC228\uAE30\uAE30' : '\uC6D0\uBCF8 \uC77D\uAE30 \uACB0\uACFC \uBCF4\uAE30'}
          </button>
        ) : null}
      </div>

      {status === 'processing' ? (
        <div className="soft-panel">
          <div className="flex items-center justify-between text-sm font-medium text-slate-700">
            <span>{'\uC0AC\uC9C4\uC5D0\uC11C \uC7AC\uB8CC \uCC3E\uB294 \uC911'}</span>
            <span>{progressPercent}%</span>
          </div>
          <div role="progressbar" aria-label="사진 인식 진행률" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progressPercent} className="mt-2 h-2 overflow-hidden rounded-full bg-slate-200">
            <div className="h-full rounded-full bg-brand-600" style={{ width: `${progressPercent}%` }} />
          </div>
        </div>
      ) : null}

      {status === 'error' ? (
        <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
          {`\uC0AC\uC9C4\uC744 \uC77D\uB294 \uB370 \uC2E4\uD328\uD588\uC5B4\uC694. ${error || '\uB354 \uC120\uBA85\uD55C \uC0AC\uC9C4\uC73C\uB85C \uB2E4\uC2DC \uC2DC\uB3C4\uD574\uBCF4\uC138\uC694.'}`}
        </div>
      ) : null}

      {status === 'success' && !rawText ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          {'\uC0AC\uC9C4\uC744 \uC77D\uAE30\uB294 \uD588\uC9C0\uB9CC \uC7AC\uB8CC\uB85C \uBCF4\uC774\uB294 \uB0B4\uC6A9\uC744 \uCC3E\uC9C0 \uBABB\uD588\uC5B4\uC694.'}
        </div>
      ) : null}

      {showRawText && rawText ? (
        <pre className="max-h-56 overflow-auto rounded-lg bg-slate-950 p-3 text-xs text-slate-100">{rawText}</pre>
      ) : null}
    </section></>
  );
}

export default OcrResultPanel;
