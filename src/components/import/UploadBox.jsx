import { useEffect, useRef, useState } from 'react';

const MAX_PREVIEW_DIMENSION = 1600;

function UploadBox({ imageFile, fileName, disabled, fileDisabled = false, onChange, onRunOcr }) {
  const canvasRef = useRef(null);
  const [previewedFile, setPreviewedFile] = useState(null);
  const previewReady = Boolean(imageFile) && previewedFile === imageFile;

  useEffect(() => {
    const canvas = canvasRef.current;
    let cancelled = false;

    if (!canvas || !imageFile || typeof globalThis.createImageBitmap !== 'function') return undefined;

    globalThis
      .createImageBitmap(imageFile)
      .then((bitmap) => {
        if (cancelled) {
          bitmap.close();
          return;
        }

        const scale = Math.min(1, MAX_PREVIEW_DIMENSION / Math.max(bitmap.width, bitmap.height));
        const width = Math.max(1, Math.round(bitmap.width * scale));
        const height = Math.max(1, Math.round(bitmap.height * scale));
        const context = canvas.getContext('2d', { alpha: false });
        if (!context) {
          bitmap.close();
          return;
        }

        canvas.width = width;
        canvas.height = height;
        context.drawImage(bitmap, 0, 0, width, height);
        bitmap.close();
        setPreviewedFile(imageFile);
      })
      .catch(() => {
        if (!cancelled) setPreviewedFile(null);
      });

    return () => {
      cancelled = true;
    };
  }, [imageFile]);

  return (
    <section className="card">
      <div className="grid gap-3.5 lg:grid-cols-[1fr_0.95fr] lg:items-start">
        <div className="space-y-3">
          <div>
            <p className="kicker">{'1. \uC0AC\uC9C4 \uC62C\uB9AC\uAE30'}</p>
            <h3 className="mt-2 text-lg font-semibold text-slate-900 sm:text-[1.35rem]">
              {'\uC8FC\uBB38 \uB0B4\uC5ED \uB610\uB294 \uC601\uC218\uC99D \uC0AC\uC9C4'}
            </h3>
            <p className="mt-1.5 text-sm leading-5.5 muted">{'\uC0C1\uD488\uBA85\uACFC \uC218\uB7C9\uC774 \uBCF4\uC774\uB294 \uAD6C\uC5ED\uB9CC \uCEA1\uCC98\uD558\uBA74 \uC815\uD655\uB3C4\uAC00 \uB354 \uC88B\uC544\uC9D1\uB2C8\uB2E4.'}</p>
          </div>

          <div className="flex flex-wrap gap-2">
            <span className="summary-chip">{'1. \uC774\uBBF8\uC9C0 \uC120\uD0DD'}</span>
            <span className="summary-chip">{'2. OCR \uC2E4\uD589'}</span>
            <span className="summary-chip">{'3. \uD56D\uBAA9 \uAC80\uD1A0'}</span>
            <span className="summary-chip">{'4. \uAC00\uC838\uC624\uAE30'}</span>
          </div>

          <label className="relative flex cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-brand-100 bg-brand-50/40 px-4 py-6 text-center hover:border-brand-500 hover:bg-brand-50/70 focus-within:ring-2 focus-within:ring-green-700 focus-within:ring-offset-2">
            <span className="text-sm font-semibold text-slate-800">{'\uC0AC\uC9C4 \uACE0\uB974\uAE30'}</span>
            <span className="mt-1 text-xs muted">{'PNG, JPG, WEBP · 최대 8MB · 총 1,200만 픽셀 이하'}</span>
            <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" disabled={fileDisabled} onChange={onChange} />
          </label>

          <div className="flex flex-wrap items-center gap-2.5">
            <button type="button" className="btn-primary" onClick={onRunOcr} disabled={disabled}>
              {'\uC0AC\uC9C4\uC5D0\uC11C \uC7AC\uB8CC \uCC3E\uAE30'}
            </button>
            {fileName ? <p className="text-sm muted">{`\uC120\uD0DD\uD55C \uD30C\uC77C: ${fileName}`}</p> : null}
          </div>

          <p className="text-xs leading-5 text-slate-500">
            {
              '\uC8FC\uBB38 \uB0B4\uC5ED\uC5D0\uC11C \uC0C1\uD488\uBA85\uACFC \uC218\uB7C9\uC774 \uD070 \uAD6C\uC5ED\uB9CC \uCEA1\uCC98\uD558\uBA74 OCR \uC815\uD655\uB3C4\uAC00 \uB354 \uC88B\uC544\uC9C8 \uC218 \uC788\uC5B4\uC694.'
            }
          </p>
        </div>

        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
          <canvas
            ref={canvasRef}
            role="img"
            aria-label={'\uC5C5\uB85C\uB4DC\uD55C \uC2A4\uD06C\uB9B0\uC0F7 \uBBF8\uB9AC\uBCF4\uAE30'}
            hidden={!previewReady}
            className={previewReady ? 'max-h-[20rem] w-full object-contain' : 'hidden'}
          />
          {!previewReady ? (
            <div className="flex min-h-[12.5rem] items-center justify-center bg-slate-50/70 px-5 text-center text-sm muted">
              {'\uC774\uBBF8\uC9C0\uB97C \uC62C\uB9AC\uBA74 \uC5EC\uAE30\uC5D0 \uBBF8\uB9AC\uBCF4\uAE30\uAC00 \uD45C\uC2DC\uB429\uB2C8\uB2E4.'}
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}

export default UploadBox;
