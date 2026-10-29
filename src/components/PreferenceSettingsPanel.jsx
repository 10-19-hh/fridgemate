import { useUserPreferences } from '../hooks/useUserPreferences';

function parseIngredients(value) {
  return [...new Set(String(value || '').split(',').map((item) => item.trim()).filter(Boolean))];
}

function PreferenceSettingsPanel() {
  const { error, preferences, savePreferences, saving, saveNotice, storageReady, reloadPreferences, scope } = useUserPreferences();
  const disabled = saving || storageReady === false;

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (disabled) return;
    const formData = new FormData(event.currentTarget);
    try {
      await savePreferences({
        ...preferences,
        preferredIngredients: parseIngredients(formData.get('preferredIngredients')),
        dislikedIngredients: parseIngredients(formData.get('dislikedIngredients'))
      });
    } catch {
      // The hook distinguishes local failure, remote failure and acknowledged
      // remote success whose cache write failed. Never replace that outcome.
    }
  };

  return (
    <section className="card space-y-4">
      <div>
        <p className="kicker">추천 취향</p>
        <h3 className="mt-2 text-xl font-semibold text-slate-900">자주 찾는 재료와 피하고 싶은 재료</h3>
        <p className="mt-2 text-sm leading-6 muted">쉼표로 구분해 입력하면 추천 순서에 가볍게 반영합니다.</p>
      </div>
      <form
        key={`${scope}:${preferences.preferredIngredients?.join('|')}::${preferences.dislikedIngredients?.join('|')}`}
        className="space-y-4"
        onSubmit={handleSubmit}
      >
        <div className="grid gap-4 md:grid-cols-2">
          <label className="text-sm font-semibold text-slate-900">
            선호 재료
            <input className="input mt-2 w-full" disabled={disabled} defaultValue={(preferences.preferredIngredients || []).join(', ')} maxLength={500} name="preferredIngredients" />
          </label>
          <label className="text-sm font-semibold text-slate-900">
            비선호 재료
            <input className="input mt-2 w-full" disabled={disabled} defaultValue={(preferences.dislikedIngredients || []).join(', ')} maxLength={500} name="dislikedIngredients" />
          </label>
          <label className="text-sm font-semibold text-slate-900">
            매운맛
            <select
              className="input mt-2 w-full"
              disabled={disabled}
              onChange={(event) => savePreferences({ ...preferences, spiceLevel: event.target.value }, { changedField: 'spiceLevel' }).catch(() => {})}
              value={preferences.spiceLevel}
            >
              <option value="mild">순한맛</option>
              <option value="medium">보통</option>
              <option value="spicy">매운맛</option>
            </select>
          </label>
          <label className="text-sm font-semibold text-slate-900">
            조리 여유
            <select
              className="input mt-2 w-full"
              disabled={disabled}
              onChange={(event) => savePreferences({ ...preferences, cookingTimePreference: event.target.value }, { changedField: 'cookingTimePreference' }).catch(() => {})}
              value={preferences.cookingTimePreference}
            >
              <option value="quick">빠르게</option>
              <option value="flexible">상관없음</option>
              <option value="leisurely">여유 있게</option>
            </select>
          </label>
        </div>
        {saveNotice ? <p role="status" className="text-sm font-medium text-emerald-700">{saveNotice}</p> : null}
        {error ? <p role="alert" className="text-sm font-medium text-rose-700">{error}</p> : null}
        <button className="btn-primary" disabled={disabled} type="submit">
          {saving ? '저장 중...' : '취향 저장'}
        </button>
        {error ? <button className="btn-secondary ml-2" disabled={saving} type="button" onClick={reloadPreferences}>취향 설정 다시 확인</button> : null}
      </form>
    </section>
  );
}

export default PreferenceSettingsPanel;
