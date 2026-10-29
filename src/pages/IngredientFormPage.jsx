import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import PageHeader from '../components/PageHeader';
import { useAnalytics } from '../hooks/useAnalytics';
import { useAuth } from '../hooks/useAuth';
import { useIngredients } from '../hooks/useIngredients';
import { defaultIngredientForm, ingredientCategories, storageTypes } from '../utils/ingredientOptions';

function IngredientFormPage() {
  const { ingredientId } = useParams();
  const { storageScope } = useAuth();

  return <IngredientForm key={JSON.stringify([storageScope, ingredientId])} ingredientId={ingredientId} />;
}

function IngredientForm({ ingredientId }) {
  const navigate = useNavigate();
  const { trackEvent } = useAnalytics();
  const { addIngredient, clearError, findIngredient, updateIngredient } = useIngredients();
  const [form, setForm] = useState(defaultIngredientForm);
  const [loading, setLoading] = useState(Boolean(ingredientId));
  const [loadError, setLoadError] = useState('');
  const [reloadAttempt, setReloadAttempt] = useState(0);
  const [submitError, setSubmitError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const memoRef = useRef(null);
  const activeRef = useRef(false);
  const submittingRef = useRef(false);
  const isEditMode = Boolean(ingredientId);
  const disabled = loading || Boolean(loadError) || submitting;

  useLayoutEffect(() => {
    activeRef.current = true;
    return () => { activeRef.current = false; };
  }, []);

  useEffect(() => {
    if (!memoRef.current) {
      return;
    }

    memoRef.current.style.height = 'auto';
    memoRef.current.style.height = `${memoRef.current.scrollHeight}px`;
  }, [form.memo]);

  useEffect(() => {
    if (!ingredientId) {
      return;
    }

    let cancelled = false;
    setLoading(true);
    setLoadError('');
    const loadIngredient = async () => {
      try {
        const ingredient = await findIngredient(ingredientId);
        if (cancelled) return;

        if (ingredient) {
          setForm({ ...defaultIngredientForm, ...ingredient });
        } else {
          setLoadError('수정할 재료를 찾을 수 없어요. 목록을 확인하거나 다시 불러와 주세요.');
        }
      } catch {
        if (!cancelled) setLoadError('재료 정보를 불러오지 못했어요. 저장소 접근을 확인한 뒤 다시 불러와 주세요.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void loadIngredient();
    return () => { cancelled = true; };
  }, [findIngredient, ingredientId, reloadAttempt]);

  const handleChange = (event) => {
    if (disabled || submittingRef.current || !activeRef.current) return;
    const { name, value, type, checked } = event.target;

    if (submitError) {
      setSubmitError('');
    }

    clearError();

    setForm((current) => ({
      ...current,
      [name]: type === 'checkbox' ? checked : value
    }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (disabled || submittingRef.current || !activeRef.current || (isEditMode && form.id !== ingredientId)) return;
    submittingRef.current = true;
    setSubmitError('');
    setSubmitting(true);

    try {
      if (isEditMode) {
        await updateIngredient(form);
      } else {
        await addIngredient(form);
        if (!activeRef.current) return;
        trackEvent('ingredient_created', {
          creation_method: 'manual',
          category: form.category,
          storage_type: form.storageType,
          has_expiry_date: Boolean(form.expiryDate),
          has_purchase_date: Boolean(form.purchaseDate),
          quantity_present: Boolean(String(form.quantity || '').trim())
        });
        trackEvent('activation_completed', {
          activation_path: 'manual_first_ingredient'
        });
      }

      if (!activeRef.current) return;
      navigate('/ingredients');
    } catch {
      if (activeRef.current) setSubmitError('재료를 저장하지 못했어요. 입력한 내용은 유지돼요. 다시 저장해주세요.');
    } finally {
      if (activeRef.current) {
        submittingRef.current = false;
        setSubmitting(false);
      }
    }
  };

  return (
    <div className="section-shell mx-auto w-full max-w-4xl px-4 sm:px-6 lg:px-10">
      <PageHeader
        eyebrow={isEditMode ? '\uC7AC\uB8CC \uC218\uC815' : '\uC7AC\uB8CC \uCD94\uAC00'}
        title={isEditMode ? '\uC7AC\uB8CC \uC815\uBCF4\uB97C \uB2E4\uC2DC \uC815\uB9AC\uD558\uC138\uC694' : '\uC0C8 \uC7AC\uB8CC\uB97C \uAE30\uB85D\uD558\uC138\uC694'}
        description={
          '\uD544\uC218 \uC815\uBCF4\uB294 \uC774\uB984\uACFC \uC218\uB7C9\uC785\uB2C8\uB2E4. \uB0A0\uC9DC\uC640 \uBA54\uBAA8\uB294 \uD544\uC694\uD560 \uB54C\uB9CC \uCD94\uAC00\uD558\uC138\uC694.'
        }
        action={
          <Link to="/ingredients" className="btn-secondary">
            {'\uBAA9\uB85D\uC73C\uB85C \uB3CC\uC544\uAC00\uAE30'}
          </Link>
        }
      />

      {loadError || submitError ? (
        <div className="card border border-rose-200 bg-rose-50 text-sm text-rose-700">
          <p role="alert">{loadError || submitError}</p>
          {loadError ? (
            <button type="button" className="btn-secondary mt-3" disabled={loading}
              onClick={() => setReloadAttempt((current) => current + 1)}>
              재료 다시 불러오기
            </button>
          ) : null}
        </div>
      ) : null}

      <form className="card space-y-5" onSubmit={handleSubmit}>
        <fieldset disabled={disabled} className="grid grid-cols-1 gap-4 md:grid-cols-2 md:gap-6">
          <section className="soft-panel space-y-4">
            <div>
              <p className="kicker">{'\uAE30\uBCF8 \uC815\uBCF4'}</p>
              <h3 className="mt-2 text-lg font-semibold text-slate-900">{'\uC774\uB984, \uC218\uB7C9, \uBD84\uB958\uB97C \uBA3C\uC800 \uC801\uC5B4\uC8FC\uC138\uC694'}</h3>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <label className="space-y-1.5 text-sm font-medium text-slate-700">
                {'\uC774\uB984 *'}
                <input name="name" value={form.name} onChange={handleChange} placeholder={'\uC6B0\uC720'} required />
              </label>

              <label className="space-y-1.5 text-sm font-medium text-slate-700">
                {'\uC218\uB7C9 *'}
                <input name="quantity" value={form.quantity} onChange={handleChange} placeholder={'1\uD1B5'} required />
              </label>

              <label className="space-y-1.5 text-sm font-medium text-slate-700">
                {'\uCE74\uD14C\uACE0\uB9AC'}
                <select name="category" value={form.category} onChange={handleChange}>
                  {ingredientCategories.map((category) => (
                    <option key={category} value={category}>
                      {category}
                    </option>
                  ))}
                </select>
              </label>

              <label className="space-y-1.5 text-sm font-medium text-slate-700">
                {'\uBCF4\uAD00 \uBC29\uC2DD'}
                <select name="storageType" value={form.storageType} onChange={handleChange}>
                  {storageTypes.map((storageType) => (
                    <option key={storageType} value={storageType}>
                      {storageType}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </section>

          <section className="soft-panel space-y-4">
            <div>
              <p className="kicker">{'\uB0A0\uC9DC'}</p>
              <h3 className="mt-2 text-lg font-semibold text-slate-900">{'\uAD6C\uB9E4\uC77C\uACFC \uC720\uD1B5\uAE30\uD55C\uC744 \uD544\uC694\uD55C \uB9CC\uD07C\uB9CC \uAE30\uB85D\uD558\uC138\uC694'}</h3>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <label className="space-y-1.5 text-sm font-medium text-slate-700">
                {'\uAD6C\uB9E4\uC77C'}
                <input name="purchaseDate" type="date" value={form.purchaseDate} onChange={handleChange} />
              </label>

              <label className="space-y-1.5 text-sm font-medium text-slate-700">
                {'\uC720\uD1B5\uAE30\uD55C'}
                <input name="expiryDate" type="date" value={form.expiryDate} onChange={handleChange} />
              </label>

              <label className="space-y-1.5 text-sm font-medium text-slate-700 md:col-span-2">
                {'\uBA54\uBAA8 (\uC120\uD0DD)'}
                <textarea
                  ref={memoRef}
                  name="memo"
                  rows={1}
                  className="min-h-[2.7rem] resize-none overflow-hidden"
                  value={form.memo}
                  onChange={handleChange}
                  placeholder={'\uBCF4\uAD00 \uD301\uC774\uB098 \uC0AC\uC6A9 \uC608\uC815 \uBA54\uBAA8'}
                />
              </label>
            </div>
          </section>
        </fieldset>

        <div className="flex flex-col gap-3 border-t border-white/70 pt-1 sm:flex-row sm:flex-wrap">
          <button type="submit" className="btn-primary w-full sm:w-auto" disabled={disabled}>
            {loading
              ? '\uBD88\uB7EC\uC624\uB294 \uC911...'
              : submitting
                ? '\uC800\uC7A5 \uC911...'
                : isEditMode
                  ? '\uC218\uC815 \uC800\uC7A5'
                  : '\uC7AC\uB8CC \uCD94\uAC00'}
          </button>
          <Link to="/ingredients" className="btn-secondary w-full sm:w-auto">
            {'\uCDE8\uC18C'}
          </Link>
        </div>
      </form>
    </div>
  );
}

export default IngredientFormPage;
