import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { saveImportCorrectionsRemote } from '../api/importCorrectionsApi';
import PageHeader from '../components/PageHeader';
import ImportCorrectionRecoveryPanel from '../components/import/ImportCorrectionRecoveryPanel';
import OcrResultPanel from '../components/import/OcrResultPanel';
import ParsedItemEditor from '../components/import/ParsedItemEditor';
import UploadBox from '../components/import/UploadBox';
import { prepareIngredientImport } from '../features/import/ingredientImportRepository';
import {
  annotateDuplicateImportItems,
  setImportItemsSelected,
  toImportableItems,
  toggleImportItemSelection,
  updateImportItem
} from '../features/import/importSelection';
import { useAuth } from '../hooks/useAuth';
import { useIngredients } from '../hooks/useIngredients';
import { useAnalytics } from '../hooks/useAnalytics';
import { isBackendEnabled } from '../utils/backendConfig';
import { applyImportCorrections, saveImportCorrections } from '../utils/import/importLearning';
import { parseImportText } from '../utils/importParser';
import { validateOcrImageFile } from '../utils/ocr/imageValidation';
import { runOcrWithProvider } from '../utils/ocr/ocrService';

const IMPORT_PAGE_COPY = {
  uploadFirstError: '\u004F\u0043\u0052\uC744 \uC2DC\uC791\uD558\uAE30 \uC804\uC5D0 \uC774\uBBF8\uC9C0\uB97C \uBA3C\uC800 \uC5C5\uB85C\uB4DC\uD574\uC8FC\uC138\uC694.',
  ocrFailed: '\u004F\u0043\u0052 \uCC98\uB9AC\uC5D0 \uC2E4\uD328\uD588\uC5B4\uC694.',
  noSelectedItems:
    '\uAC00\uC838\uC62C \uD56D\uBAA9\uC774 \uC120\uD0DD\uB418\uC9C0 \uC54A\uC558\uC5B4\uC694. \uCD5C\uC18C 1\uAC1C \uC774\uC0C1 \uC120\uD0DD\uD574\uC8FC\uC138\uC694.',
  importFailed: '\uAC00\uC838\uC624\uAE30\uC5D0 \uC2E4\uD328\uD588\uC5B4\uC694. \uB2E4\uC2DC \uC2DC\uB3C4\uD574\uC8FC\uC138\uC694.'
};

function ImportEmptyPanel({ title, description }) {
  return (
    <section className="rounded-lg border border-dashed border-brand-100 bg-white px-5 py-8 text-center shadow-sm">
      <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-brand-50 text-lg text-brand-700">◎</div>
      <h3 className="mt-3 text-xl font-semibold text-slate-900">{title}</h3>
      <p className="mx-auto mt-1.5 max-w-2xl text-sm leading-6 muted">{description}</p>
    </section>
  );
}

function ImportSession({ isAuthenticated, storageScope }) {
  const navigate = useNavigate();
  const { ingredients, importIngredients, loadIngredients, loading: inventoryLoading, error: inventoryError } = useIngredients();
  const { trackEvent } = useAnalytics();
  const [imageFile, setImageFile] = useState(null);
  const [ocrResult, setOcrResult] = useState(null);
  const [showRawText, setShowRawText] = useState(false);
  const [status, setStatus] = useState('idle');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const [reviewItems, setItems] = useState([]);
  const [importMessage, setImportMessage] = useState('');
  const [importSaved, setImportSaved] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [needsImportConfirmation, setNeedsImportConfirmation] = useState(false);
  const mounted = useRef(false);
  const generation = useRef(0);
  const recognizing = useRef(null);
  const saving = useRef(false);
  const saved = useRef(false);
  const prepared = useRef(null);
  const confirmationPending = useRef(false);
  const replacements = useRef(new Map());

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; generation.current += 1; };
  }, []);

  const rawText = ocrResult?.text || '';
  const parseResult = useMemo(() => parseImportText(ocrResult), [ocrResult]);

  // Inventory updates (including a failed save rollback) must not reset manual review edits.
  const items = useMemo(() => annotateDuplicateImportItems(reviewItems, ingredients).map(item => (
    item.replaceExisting ? { ...item, duplicateExistingItems: replacements.current.get(item.id) || [] } : item
  )), [reviewItems, ingredients]);
  const busy = isSaving || isRefreshing;
  const editingDisabled = busy || status === 'processing';

  function trackSafely(name, properties) {
    try { trackEvent(name, properties); } catch { /* Optional analytics cannot block inventory work. */ }
  }

  function canInteract() {
    return mounted.current && !saving.current && !saved.current && recognizing.current === null;
  }

  function canEdit() {
    return canInteract() && !confirmationPending.current;
  }

  function resetReview() {
    prepared.current = null;
    confirmationPending.current = false;
    setNeedsImportConfirmation(false);
    replacements.current.clear();
    saved.current = false;
    setImportSaved(false);
    setItems([]);
    setImportMessage('');
  }

  const handleFileChange = async (event) => {
    if (!mounted.current || saving.current) return;
    const fileInput = event.currentTarget;
    const nextFile = event.target.files?.[0];
    const version = ++generation.current;
    recognizing.current = null;

    setImageFile(null);
    setOcrResult(null);
    resetReview();
    setError('');
    setStatus('idle');
    setShowRawText(false);

    if (!nextFile) return;

    try {
      await validateOcrImageFile(nextFile);
      if (!mounted.current || generation.current !== version) return;
      trackSafely('ocr_upload_started', {
        file_type: nextFile.type || 'unknown',
        source_screen: 'import'
      });
      setImageFile(nextFile);
    } catch (validationError) {
      if (!mounted.current || generation.current !== version) return;
      fileInput.value = '';
      setStatus('error');
      setError(validationError.message);
    }
  };

  const runOcr = async () => {
    if (!mounted.current || saving.current || recognizing.current !== null || confirmationPending.current) return;
    if (!imageFile) {
      setError(IMPORT_PAGE_COPY.uploadFirstError);
      setStatus('error');
      return;
    }

    const version = ++generation.current;
    recognizing.current = version;
    resetReview();
    setOcrResult(null);
    setError('');
    setStatus('processing');
    setProgress(0);

    try {
      const result = await runOcrWithProvider(imageFile, {
        onProgress: (value) => {
          if (mounted.current && generation.current === version) setProgress(value);
        }
      });

      if (!mounted.current || generation.current !== version) return;
      const parsed = parseImportText(result);
      setOcrResult(result);
      setItems(annotateDuplicateImportItems(applyImportCorrections(parsed.candidates, storageScope), ingredients));
      setStatus('success');
      trackSafely('ocr_parse_completed', {
        raw_text_length: result?.text?.length || 0,
        parsed_item_count: parsed.candidates.length,
        template_type: parsed.template?.id || 'unknown',
        confidence_bucket: 'medium'
      });
    } catch (ocrError) {
      if (!mounted.current || generation.current !== version) return;
      setError(ocrError.message || IMPORT_PAGE_COPY.ocrFailed);
      setStatus('error');
    } finally {
      if (recognizing.current === version) recognizing.current = null;
    }
  };

  const handleItemChange = (id, field, value) => {
    if (!canEdit()) return;
    if (field === 'replaceExisting' && (inventoryLoading || inventoryError)) return;
    prepared.current = null;
    const patch = { [field]: value };
    if (field === 'replaceExisting') {
      if (value) replacements.current.set(id, structuredClone(items.find(item => item.id === id)?.duplicateExistingItems || []));
      else replacements.current.delete(id);
    } else if (field === 'name' && replacements.current.has(id)) {
      replacements.current.delete(id);
      patch.replaceExisting = false;
      setImportMessage('이름이 바뀌었어요. 기존 항목 교체 여부를 다시 확인해 주세요.');
    }
    setItems((current) => annotateDuplicateImportItems(updateImportItem(current, id, patch), ingredients));
  };

  const handleToggleItem = (id) => {
    if (!canEdit()) return;
    prepared.current = null;
    setItems((current) => toggleImportItemSelection(current, id));
  };

  const handleApplySuggestion = (id, suggestion) => {
    if (!canEdit()) return;
    prepared.current = null;
    if (replacements.current.delete(id)) setImportMessage('이름이 바뀌었어요. 기존 항목 교체 여부를 다시 확인해 주세요.');
    setItems((current) =>
      annotateDuplicateImportItems(
        updateImportItem(current, id, {
          name: suggestion.correctedName,
          displayName: suggestion.correctedName,
          normalizedName: suggestion.correctedName,
          category: suggestion.category,
          storageType: suggestion.storageType,
          replaceExisting: false,
          learnedCorrection: true
        }),
        ingredients
      )
    );
  };

  const handleSelectAll = (selected) => {
    if (!canEdit()) return;
    prepared.current = null;
    setItems((current) => setImportItemsSelected(current, selected));
  };

  const handleRefreshInventory = async () => {
    if (!canInteract() || inventoryLoading) return;
    saving.current = true;
    setIsRefreshing(true);
    setImportMessage('');
    const version = generation.current;
    const current = () => mounted.current && generation.current === version;
    try {
      const refreshedIngredients = await loadIngredients({ force: true });
      if (!current()) return;
      // Matching IDs are only a hint. The original command must still pass
      // the repository's complete replay/CAS checks before reporting success.
      if (prepared.current && (confirmationPending.current || prepared.current.items.some(item =>
        refreshedIngredients.some(ingredient => ingredient.id === item.id)))) {
        confirmationPending.current = true;
        setNeedsImportConfirmation(true);
        setImportMessage('이전 저장 요청을 유지했어요. 저장 결과를 다시 확인해 주세요.');
        return;
      }
      prepared.current = null;
      replacements.current.clear();
      setItems(items => items.map(item => ({ ...item, replaceExisting: false })));
      setImportMessage('재고를 다시 확인했어요. 기존 항목 교체 여부를 다시 선택해 주세요.');
    } catch {
      if (current()) setImportMessage('재고를 다시 확인하지 못했어요. 후보는 유지됐어요. 다시 시도해 주세요.');
    } finally {
      saving.current = false;
      if (current()) setIsRefreshing(false);
    }
  };

  const handleImport = async () => {
    if (!canInteract() || inventoryLoading || inventoryError) return;
    const selectedRawItems = items.filter((item) => item.selected && item.name.trim());
    const selectedItems = toImportableItems(items);

    if (!selectedItems.length) {
      setImportMessage(IMPORT_PAGE_COPY.noSelectedItems);
      return;
    }

    saving.current = true;
    setIsSaving(true);
    setImportMessage('');
    const version = generation.current;
    const current = () => mounted.current && generation.current === version;
    try {
      if (!prepared.current) {
        const replacementItems = [...new Map(selectedRawItems.filter(item => item.replaceExisting)
          .flatMap(item => replacements.current.get(item.id) || []).map(item => [item.id, item])).values()];
        prepared.current = prepareIngredientImport({ scope: storageScope, items: selectedItems,
          replacements: replacementItems, syncEnabled: isBackendEnabled() && isAuthenticated,
          now: new Date().toISOString() });
      }
      await importIngredients(prepared.current);
      if (!current()) return;
      // ACK comes first. Auxiliary failures must never offer this command again.
      saved.current = true;
      setImportSaved(true);
      let learningSaved = false;
      try { learningSaved = saveImportCorrections(selectedRawItems, storageScope); } catch { /* Best effort. */ }
      if (current() && isBackendEnabled() && isAuthenticated) {
        try { Promise.resolve(saveImportCorrectionsRemote(selectedRawItems)).catch(() => {}); } catch { /* Best effort. */ }
      }
      if (!current()) return;
      trackSafely('ocr_review_completed', {
        parsed_item_count: items.length,
        selected_item_count: selectedItems.length,
        edited_item_count: selectedRawItems.filter((item) => item.name !== item.originalName || item.quantity !== item.originalQuantity).length,
        deleted_item_count: items.length - selectedItems.length
      });
      selectedItems.forEach((item) => {
        trackSafely('ingredient_created', {
          creation_method: 'ocr',
          category: item.category,
          storage_type: item.storageType,
          has_expiry_date: Boolean(item.expiryDate),
          has_purchase_date: Boolean(item.purchaseDate),
          quantity_present: Boolean(String(item.quantity || '').trim())
        });
      });
      trackSafely('ocr_import_saved', {
        saved_item_count: selectedItems.length,
        edited_before_save_count: selectedRawItems.filter(
          (item) => item.name !== item.originalName || item.quantity !== item.originalQuantity
        ).length,
        session_first_import: true
      });
      trackSafely('activation_completed', {
        activation_path: 'ocr_first_import'
      });
      if (!current()) return;
      if (learningSaved) {
        navigate('/ingredients');
      } else {
        setImportMessage(`${selectedItems.length}개 재료를 냉장고에 저장했어요. 다음번 보정 학습은 저장하지 못했어요. 냉장고에서 저장한 재료를 확인할 수 있어요.`);
      }
    } catch (importError) {
      if (current() && !saved.current) setImportMessage(importError.message || IMPORT_PAGE_COPY.importFailed);
    } finally {
      saving.current = false;
      if (current()) setIsSaving(false);
    }
  };

  return (
    <div className="section-shell mx-auto w-full max-w-4xl px-4 sm:px-6 lg:px-10">
      <PageHeader
        eyebrow={'\uC0AC\uC9C4 \uB4F1\uB85D'}
        title={'\uC0AC\uC9C4\uC5D0\uC11C \uC7AC\uB8CC \uD6C4\uBCF4\uB97C \uBA3C\uC800 \uAC00\uC838\uC624\uC138\uC694'}
        description={
          '\uC5C5\uB85C\uB4DC, OCR, \uAC80\uD1A0, \uAC00\uC838\uC624\uAE30 \uC21C\uC11C\uB85C \uC9C4\uD589\uD558\uBA70, \uB9C8\uC9C0\uB9C9 \uB2E8\uACC4\uC5D0\uC11C \uD544\uC694\uD55C \uD56D\uBAA9\uB9CC \uACE0\uB97C \uC218 \uC788\uC2B5\uB2C8\uB2E4.'
        }
        action={
          <Link to="/ingredients" className="btn-secondary">
            {'\uB0C9\uC7A5\uACE0 \uBCF4\uAE30'}
          </Link>
        }
      />

      <UploadBox
        imageFile={imageFile}
        fileName={imageFile?.name}
        disabled={!imageFile || status === 'processing' || busy || needsImportConfirmation}
        fileDisabled={busy}
        onChange={handleFileChange}
        onRunOcr={runOcr}
      />
      <ImportCorrectionRecoveryPanel
        key={importSaved ? 'saved' : 'review'}
        scope={storageScope}
        disabled={editingDisabled}
        canReset={() => mounted.current && !saving.current && recognizing.current === null}
      />

      {isSaving ? <p aria-live="polite" className="text-sm text-brand-700">재료를 저장하고 있어요. 완료될 때까지 기다려 주세요.</p> : null}
      {inventoryLoading ? <p className="text-sm muted">저장된 재고를 확인하고 있어요. 후보를 검토하며 기다려 주세요.</p> : null}
      {inventoryError ? <p role="alert" className="text-sm text-red-800">저장된 재고를 확인하지 못했어요. 후보는 유지돼요. 재고 다시 확인을 눌러 주세요.</p> : null}
      {(inventoryError || parseResult.candidates.length > 0) && !importSaved ? (
        <button type="button" className="btn-secondary" disabled={editingDisabled || inventoryLoading} onClick={handleRefreshInventory}>재고 다시 확인</button>
      ) : null}
      {needsImportConfirmation && !importSaved ? (
        <section className="soft-panel space-y-2">
          <p className="text-sm">이전 요청의 항목이 재고에 보여요. 저장 완료 여부를 같은 요청으로 다시 확인해 주세요. 확인 전에는 후보를 수정할 수 없어요. 새 사진을 선택하면 새 검토를 시작해요.</p>
          <button type="button" className="btn-primary" disabled={editingDisabled || inventoryLoading || Boolean(inventoryError)} onClick={handleImport}>이전 저장 결과 다시 확인</button>
        </section>
      ) : null}

      {/*
        텍스트 붙여넣기 분석은 잠시 비활성화.
        이미지 OCR 경로만 유지한다.
      */}

      <OcrResultPanel
        status={status}
        progress={progress}
        error={error}
        rawText={rawText}
        showRawText={showRawText}
        onToggleRawText={() => setShowRawText((current) => !current)}
      />

      {status === 'idle' && !imageFile ? (
        <ImportEmptyPanel
          title={'\uC544\uC9C1 \uC5C5\uB85C\uB4DC\uD55C \uC774\uBBF8\uC9C0\uAC00 \uC5C6\uC5B4\uC694'}
          description={'\uC8FC\uBB38 \uB0B4\uC5ED \uB610\uB294 \uC601\uC218\uC99D \uC2A4\uD06C\uB9B0\uC0F7\uC744 \uBA3C\uC800 \uC62C\uB824\uC8FC\uC138\uC694.'}
        />
      ) : null}

      {status === 'success' && !parseResult.candidates.length ? (
        <ImportEmptyPanel
          title={'\uC4F8 \uB9CC\uD55C \uC0C1\uD488 \uD56D\uBAA9\uC744 \uCC3E\uC9C0 \uBABB\uD588\uC5B4\uC694'}
          description={
            '\u004F\u0043\u0052 \uACB0\uACFC\uAC00 \uBA54\uD0C0 \uC815\uBCF4\uC774\uAC70\uB098 \uC774\uBBF8\uC9C0 \uD488\uC9C8\uC774 \uB0AE\uC744 \uC218 \uC788\uC5B4\uC694. \uC0C1\uD488\uBA85\uC774 \uB354 \uC120\uBA85\uD55C \uC774\uBBF8\uC9C0\uB85C \uB2E4\uC2DC \uC2DC\uB3C4\uD574\uBCF4\uC138\uC694.'
          }
        />
      ) : null}

      {status === 'success' ? (
        <section className="space-y-3">
          <div className="soft-panel grid gap-2 text-sm text-slate-700 sm:grid-cols-2 xl:grid-cols-[repeat(4,minmax(0,auto))_minmax(0,1fr)] xl:items-center">
          <span className="badge bg-emerald-100 text-emerald-700">{`\uD6C4\uBCF4 \uD56D\uBAA9 ${parseResult.candidates.length}\uAC1C`}</span>
          <span className="badge bg-slate-100 text-slate-700">{`\uC720\uD6A8 \uBB38\uC7A5 ${parseResult.usefulLines.length}\uAC1C`}</span>
          <span className="badge bg-slate-100 text-slate-700">{`\uC81C\uC678 \uBB38\uC7A5 ${parseResult.ignoredLines.length}\uAC1C`}</span>
          <span className="badge bg-slate-100 text-slate-700">{`\uD15C\uD50C\uB9BF ${parseResult.template?.id || 'unknown'}`}</span>
          <span className="badge bg-white text-slate-500">{`source ${parseResult.sourceType || 'unknown'} ${Math.round((parseResult.sourceConfidence || 0) * 100)}%`}</span>
          {importMessage ? (
            <span role="status" aria-label="가져오기 결과" className="rounded-2xl border border-brand-100/80 bg-brand-50/70 px-3 py-2 text-sm font-medium text-brand-700 xl:justify-self-end">
              {importMessage}
            </span>
          ) : null}
          </div>

          {parseResult.warnings?.length ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
              <p className="font-semibold">{'\uD655\uC778\uD558\uBA74 \uC88B\uC740 \uD56D\uBAA9'}</p>
              <ul className="mt-2 space-y-1.5 text-sm leading-6">
                {parseResult.warnings.map((warning, index) => (
                  <li key={`${warning}-${index}`}>{`\u2022 ${warning}`}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>
      ) : null}

      {parseResult.candidates.length > 0 && !importSaved ? (
        <ParsedItemEditor
          items={items}
          disabled={editingDisabled || needsImportConfirmation}
          importDisabled={inventoryLoading || Boolean(inventoryError)}
          replacementDisabled={inventoryLoading || Boolean(inventoryError)}
          onItemChange={handleItemChange}
          onToggleItem={handleToggleItem}
          onSelectAll={() => handleSelectAll(true)}
          onDeselectAll={() => handleSelectAll(false)}
          onApplySuggestion={handleApplySuggestion}
          onImport={handleImport}
        />
      ) : null}
    </div>
  );
}

function ImportPage() {
  const { storageScope, isAuthenticated } = useAuth();
  return <ImportSession key={storageScope} storageScope={storageScope} isAuthenticated={isAuthenticated} />;
}

export default ImportPage;
