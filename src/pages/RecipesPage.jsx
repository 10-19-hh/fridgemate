import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import PageHeader from '../components/PageHeader';
import InventoryReadError from '../components/InventoryReadError';
import PublicRecipeExplorer from '../components/PublicRecipeExplorer';
import { getPublicRecipeLinkItems } from '../features/recipes/recipeContentHubs';
import PantryStaplesPanel from '../components/PantryStaplesPanel';
import RecommendationRow from '../components/RecommendationRow';
import StatCard from '../components/StatCard';
import AdSenseSlot from '../components/ads/AdSenseSlot';
import { useAnalytics } from '../hooks/useAnalytics';
import { useDBRecommendations } from '../hooks/useDBRecommendations';
import { useRecipesPageModel } from '../hooks/useRecipesPageModel';
import { isExternalAiUiEnabled } from '../api/externalAiRequest';

function RecipesPage() {
  const { trackEvent } = useAnalytics();
  const lastViewSignatureRef = useRef('');
  const [externalAiConsent, setExternalAiConsent] = useState(false);
  const {
    pantryStaples,
    pantryOwnership,
    pantrySummary,
    cyclePantryStatus,
    pantryError,
    pantrySaving,
    pantryStorageReady,
    pantryCanRetrySave,
    reloadPantryOwnership,
    retryPantrySave,
    ownedPantryItems,
    loading,
    readError,
    loadIngredients,
    ingredients,
    summary,
    missingBasicIngredients,
    activeIngredientCount,
    localRecommendations,
    readyRecommendations,
    buyOneRecommendations,
    useSoonRecommendations,
    ownedPantryCount,
    fridgeInsight,
    sectionStats
  } = useRecipesPageModel();
  const hasInventory = !loading && !readError && activeIngredientCount > 0;
  const recommendationEmptyMessage = !loading && !readError && activeIngredientCount === 0 ? '재료를 등록하면 추천을 시작할 수 있어요' : '';
  const dbRecommendationsState = useDBRecommendations({
    ingredients,
    pantryItems: ownedPantryItems
  });

  const handleExternalAiRequest = async () => {
    if (!externalAiConsent) return;
    setExternalAiConsent(false);
    await dbRecommendationsState.requestExternalAiRecommendations();
  };

  useEffect(() => {
    if (loading || readError) {
      return;
    }

    const nextSignature = [activeIngredientCount, summary.expiringSoon, readyRecommendations.length, buyOneRecommendations.length, useSoonRecommendations.length].join(':');

    if (lastViewSignatureRef.current === nextSignature) {
      return;
    }

    lastViewSignatureRef.current = nextSignature;
    trackEvent('recommendations_viewed', {
      screen: 'recipes',
      available_ingredient_count: activeIngredientCount,
      expiring_soon_count: summary.expiringSoon,
      ready_count: readyRecommendations.length,
      buy_one_more_count: buyOneRecommendations.length,
      use_soon_count: useSoonRecommendations.length
    });
  }, [
    activeIngredientCount,
    buyOneRecommendations.length,
    loading,
    readError,
    readyRecommendations.length,
    summary.expiringSoon,
    trackEvent,
    useSoonRecommendations.length
  ]);

  const handleRecommendationSelect = (group) => (recipe) => {
    trackEvent('recommendation_clicked', {
      screen: 'recipes',
      group,
      score: recipe.score ?? null,
      missing_core_count: recipe.missingCore?.length ?? recipe.missingIngredients?.length ?? recipe.missingCount ?? 0
    });
  };

  return (
    <div className="section-shell mx-auto w-full max-w-4xl px-4 sm:px-6 lg:px-10">
      <PageHeader
        eyebrow={hasInventory ? '내 재료 추천' : '공개 메뉴 탐색'}
        title={hasInventory ? '보유 재료로 만들 메뉴를 확인하세요' : '남은 재료를 골라 조리법까지 살펴보세요'}
        description={hasInventory ? '핵심 재료와 양념을 함께 비교합니다. 분량과 보관 상태는 조리 전에 확인하세요.' : '입력한 재료는 이번 탐색에만 사용해요. 마음에 드는 메뉴에서 준비 재료와 만드는 순서를 확인하세요.'}
      />

      {readError ? <InventoryReadError loading={loading} onRetry={loadIngredients} /> : null}

      {hasInventory ? <>
      <section className="stats-grid">
        <StatCard
          label={'\uC9C0\uAE08 \uB9CC\uB4E4 \uC218 \uC788\uC5B4\uC694'}
          value={sectionStats.ready.value}
          helper={sectionStats.ready.helper}
          emptyMessage={recommendationEmptyMessage}
        />
        <StatCard
          label={'\uD558\uB098\uB9CC \uB354 \uC0AC\uBA74 \uB3FC\uC694'}
          value={sectionStats.buyOne.value}
          tone="warning"
          helper={sectionStats.buyOne.helper}
          emptyMessage={recommendationEmptyMessage}
        />
        <StatCard
          label={'\uBE68\uB9AC \uC368\uC57C \uD560 \uC7AC\uB8CC \uC911\uC2EC'}
          value={sectionStats.useSoon.value}
          tone="danger"
          helper={sectionStats.useSoon.helper}
          emptyMessage={recommendationEmptyMessage}
        />
      </section>

      <section className="card border-l-4 border-l-brand-500 bg-white">
        <div className="adaptive-split">
          <div className="space-y-3">
            <div>
              <p className="kicker">{'\uC9C0\uAE08 \uC0C1\uD0DC \uC694\uC57D'}</p>
              <h3 className="mt-2 text-xl font-semibold text-slate-900 sm:text-2xl">{'\uC9C0\uAE08 \uC7AC\uB8CC\uB85C \uBB34\uC5C7\uC744 \uD560 \uC218 \uC788\uB294\uC9C0 \uBCF4\uC5EC\uC918\uC694'}</h3>
            </div>
            <p className="text-sm leading-5.5 text-slate-700">{fridgeInsight}</p>
            {missingBasicIngredients.length ? (
              <div className="flex flex-wrap gap-2 pt-1">
                {missingBasicIngredients.map((ingredient) => (
                  <span key={ingredient} className="badge bg-white text-slate-600">
                    {ingredient}
                  </span>
                ))}
              </div>
            ) : null}
          </div>

          <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-1">
            <div className="soft-panel">
              <p className="text-xs font-bold text-slate-700">{'\uD604\uC7AC \uB4F1\uB85D \uC7AC\uB8CC'}</p>
              <p className="mt-2 text-xl font-semibold text-slate-900">{loading ? '...' : activeIngredientCount}</p>
              <p className="mt-1 text-xs muted">{'\uBCF4\uC720 \uC911\uC778 \uC7AC\uB8CC \uAE30\uC900'}</p>
            </div>
            <div className="soft-panel border-amber-100/70 bg-amber-50/70">
              <p className="text-xs font-bold text-amber-800">{'\uC720\uD1B5\uAE30\uD55C \uC784\uBC15'}</p>
              <p className="mt-2 text-xl font-semibold text-slate-900">{loading ? '...' : summary.expiringSoon}</p>
              <p className="mt-1 text-xs muted">{'\uC6B0\uC120 \uC18C\uBE44\uD558\uBA74 \uC88B\uC740 \uC7AC\uB8CC'}</p>
            </div>
            <div className="soft-panel border-brand-100/70 bg-white/80">
              <p className="text-xs font-bold text-brand-700">{'\uCD94\uCC9C \uD3ED \uB113\uD788\uAE30'}</p>
              <p className="mt-2 text-sm font-medium leading-6 text-slate-900">
                {missingBasicIngredients.length
                  ? `${missingBasicIngredients.slice(0, 3).join(', ')}\uC744 \uCC44\uC6B0\uBA74 \uCD94\uCC9C\uC774 \uB354 \uB2E4\uC591\uD574\uC838\uC694.`
                  : '\uAE30\uBCF8 \uC7AC\uB8CC\uB294 \uC5B4\uB290 \uC815\uB3C4 \uAC16\uCD94\uC838 \uC788\uC5B4\uC694.'}
              </p>
              <p className="mt-2 text-xs muted">{`\uD32C\uD2B8\uB9AC \uBCF4\uC720 \uC124\uC815 ${ownedPantryCount}\uAC1C`}</p>
            </div>
          </div>
        </div>

        <div className="mt-4">
          <PantryStaplesPanel
            items={pantryStaples}
            pantryOwnership={pantryOwnership}
            pantrySummary={pantrySummary}
            onCycle={cyclePantryStatus}
            error={pantryError}
            disabled={pantrySaving || pantryStorageReady === false}
            onRetry={reloadPantryOwnership}
            onRetrySave={pantryCanRetrySave ? retryPantrySave : undefined}
          />
        </div>
      </section>

      <RecommendationRow
        title={'재료 기반 추천'}
        description={'보유 재료와 양념을 비교해 메뉴를 정렬했어요. 필요한 재료와 조리법을 함께 확인하세요.'}
        recipes={localRecommendations}
        loading={loading}
        source="rule"
        onRecipeSelect={handleRecommendationSelect('local')}
        emptyTitle={'아직 추천할 레시피가 없어요'}
        emptyDescription={
          missingBasicIngredients.length
            ? `${missingBasicIngredients.slice(0, 3).join(', ')} 같은 기본 재료를 추가하면 추천 폭이 넓어져요.`
            : '재료를 추가하면 바로 만들 수 있는 메뉴를 정리해드릴게요.'
        }
        emptyActionLabel={'재료 등록하러 가기'}
        emptyActionTo="/ingredients/new"
      />

      {isExternalAiUiEnabled() && !dbRecommendationsState.hidden && !dbRecommendationsState.needsLogin ? (
        <section className="rounded-lg border border-cyan-200 bg-cyan-50/70 p-4 sm:p-5" aria-labelledby="external-ai-title">
          <h2 id="external-ai-title" className="text-base font-semibold text-slate-900">
            외부 AI 유사도 검색은 선택 사항이에요
          </h2>
          <p id="external-ai-disclosure" className="mt-1.5 text-sm leading-6 text-slate-700">
            실행하면 현재 활성 재료명을 바탕으로 만든 짧은 검색 문자열을 OpenAI에 한 번 전송해 레시피
            유사도를 계산합니다. 수량, 정확한 유통기한, 메모, 이메일은 보내지 않습니다. 기본 추천은 이 기능을
            사용하지 않아도 계속 이용할 수 있습니다. 자세한 내용은{' '}
            <Link className="font-semibold text-brand-700 underline underline-offset-2" to="/privacy">
              개인정보 처리 안내
            </Link>
            에서 확인할 수 있습니다.
          </p>
          <label className="mt-3 flex min-h-11 cursor-pointer items-start gap-3 rounded-md bg-white p-3 text-sm text-slate-800">
            <input
              type="checkbox"
              className="mt-0.5 h-5 w-5 rounded border-slate-300 text-brand-700 focus:ring-brand-600"
              checked={externalAiConsent}
              onChange={(event) => setExternalAiConsent(event.target.checked)}
            />
            <span>이번 요청에 한해 위 항목을 OpenAI로 전송하는 데 동의합니다.</span>
          </label>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button
              type="button"
              className="btn-primary min-h-11"
              aria-describedby="external-ai-disclosure"
              disabled={!externalAiConsent || dbRecommendationsState.loading || activeIngredientCount === 0}
              onClick={handleExternalAiRequest}
            >
              {dbRecommendationsState.loading ? '추천을 찾는 중...' : 'OpenAI로 유사 레시피 찾기'}
            </button>
            {dbRecommendationsState.mode === 'semantic' ? (
              <p className="text-sm text-cyan-900" role="status">외부 AI 유사도를 반영한 결과예요.</p>
            ) : null}
            {dbRecommendationsState.mode === 'rule-fallback' ? (
              <p className="text-sm text-slate-700" role="status">외부 AI 결과를 사용할 수 없어 서버 기본 추천을 표시합니다.</p>
            ) : null}
          </div>
        </section>
      ) : null}

      <RecommendationRow
        title={dbRecommendationsState.mode === 'semantic' ? '외부 AI 유사도 추천' : '서버 카탈로그 추천'}
        description={
          dbRecommendationsState.mode === 'semantic'
            ? '명시적으로 요청한 OpenAI 유사도와 서버의 재료 점수를 함께 반영했어요.'
            : '서버 레시피 카탈로그를 재료 점수로 정렬하며 외부 AI에는 전송하지 않아요.'
        }
        recipes={dbRecommendationsState.recommendations}
        loading={dbRecommendationsState.loading}
        error={dbRecommendationsState.error}
        hidden={dbRecommendationsState.hidden}
        needsLogin={dbRecommendationsState.needsLogin}
        observeRef={dbRecommendationsState.rowRef}
        source={dbRecommendationsState.mode === 'semantic' ? 'hybrid' : 'rule'}
        loginMessage={'로그인하면 서버 카탈로그 추천을 볼 수 있어요'}
        onRecipeSelect={handleRecommendationSelect('ai')}
        emptyTitle={'AI 추천 후보가 아직 없어요'}
        emptyDescription={'DB 레시피 카탈로그에 매칭되는 후보가 생기면 이 행에 표시됩니다.'}
        emptyActionLabel={'재료 등록하러 가기'}
        emptyActionTo="/ingredients/new"
      />
      </> : null}
      <PublicRecipeExplorer />
      {!hasInventory ? <details className="card">
        <summary className="cursor-pointer py-2 font-semibold text-slate-900">보유 양념 설정 · {pantryStorageReady === false ? '확인 필요' : `${ownedPantryCount}개 보유`}</summary>
        <p className="my-3 text-sm leading-6 text-slate-600">냉장고 재료를 등록하지 않아도 양념 보유 상태를 기록할 수 있어요. 저장한 양념은 내 재료 추천과 조리 전 준비 확인에 사용할 수 있습니다.</p>
        <PantryStaplesPanel
          items={pantryStaples}
          pantryOwnership={pantryOwnership}
          pantrySummary={pantrySummary}
          onCycle={cyclePantryStatus}
          error={pantryError}
          disabled={pantrySaving || pantryStorageReady === false}
          onRetry={reloadPantryOwnership}
          onRetrySave={pantryCanRetrySave ? retryPantrySave : undefined}
        />
      </details> : null}
      <section className="card space-y-3" aria-labelledby="all-public-recipes">
        <h2 id="all-public-recipes" className="text-xl font-semibold text-slate-950">전체 공개 레시피</h2>
        <p className="text-sm leading-6 text-slate-600">식품의약품안전처 원문의 재료·조리 순서·이미지·출처를 확인할 수 있어요.</p>
        <details>
          <summary className="cursor-pointer py-3 font-semibold text-brand-800">전체 {getPublicRecipeLinkItems().length}개 조리법 보기</summary>
          <ul className="grid gap-2 py-3 text-sm sm:grid-cols-2">{getPublicRecipeLinkItems().map((item) => <li key={item.id}><Link to={item.path} className="block py-1 text-brand-800 underline underline-offset-2">{item.name}</Link></li>)}</ul>
        </details>
      </section>
      <AdSenseSlot placement="recipes" />
    </div>
  );
}

export default RecipesPage;
