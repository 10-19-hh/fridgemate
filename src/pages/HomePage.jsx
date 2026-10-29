import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import EmptyState from '../components/EmptyState';
import InventoryReadError from '../components/InventoryReadError';
import PublicRecipeExplorer from '../components/PublicRecipeExplorer';
import PageHeader from '../components/PageHeader';
import AdSenseSlot from '../components/ads/AdSenseSlot';
import { useAnalytics } from '../hooks/useAnalytics';
import { useHomePageModel } from '../hooks/useHomePageModel';
import { isOcrEnabled } from '../utils/backendConfig';
import { getCategoryLabel, getStorageLabel, joinIngredientLabels } from '../utils/displayText';
import { getExpiryLabel, getRemainingDays } from '../utils/date';
import { useMenuDecision } from '../hooks/useMenuDecision';
import RecipeExternalLinks from '../components/RecipeExternalLinks';

function RecipePreview({ recipe }) {
  const personalized = recipe.isPersonalized !== false && recipe.inputState !== 'empty';
  const missingCore = recipe.missingCore || recipe.missingIngredients || [];
  const missingGroups = recipe.missingGroups || [];
  const missingSeasonings = recipe.missingSeasonings || [];
  const missingUnknown = recipe.missingUnknownIngredients || [];
  const requiredCount = recipe.totalRequiredIngredients ?? recipe.coreIngredients?.length ?? 0;
  const hasKnownRequirements = recipe.hasKnownRequirements !== false &&
    (requiredCount > 0 || recipe.requiredGroups?.length > 0);
  const matchedCoreCount = recipe.matchedCore?.length ?? recipe.matchedCount ?? 0;
  const matchedRequirements = matchedCoreCount + Number(recipe.matchedRequiredGroupCount || 0);
  const coreComplete = hasKnownRequirements && !missingCore.length && !missingGroups.length;
  const canMakeNow = personalized && recipe.canMakeNow && coreComplete && !missingSeasonings.length && !missingUnknown.length;
  const canMakeWithOneMore = personalized && recipe.canMakeWithOneMore !== false && hasKnownRequirements &&
    matchedRequirements > 0 && missingCore.length + missingGroups.length === 1 && !missingUnknown.length &&
    missingSeasonings.every((item) => missingCore.includes(item));
  const needsSeasonings = personalized && recipe.needsSeasonings !== false && coreComplete &&
    missingSeasonings.length > 0 && !missingUnknown.length;
  const statusLabel = !personalized ? '메뉴 둘러보기'
    : !hasKnownRequirements ? '원문 재료 확인 필요'
    : missingUnknown.length ? '재료 분류 확인 필요'
    : canMakeNow ? '재료 종류 확인됨'
    : canMakeWithOneMore ? '한 가지만 더 준비'
    : needsSeasonings ? '양념 추가 필요'
    : '추가 재료 확인';
  const rate = recipe.matchRate;
  const matchRateLabel = recipe.matchRateLabel ??
    (Number.isFinite(rate) && rate >= 0 && rate <= 1 ? `${Math.round(rate * 100)}%` : '');

  return (
    <article className="soft-panel">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-base font-semibold text-slate-900">{recipe.title || recipe.name}</p>
          <p className="mt-1 text-xs leading-5 muted">{statusLabel}</p>
        </div>
        {personalized && hasKnownRequirements && requiredCount > 0 && matchRateLabel ? (
          <span className="badge bg-slate-900 text-white">{matchRateLabel}</span>
        ) : null}
      </div>
      {personalized ? (
        <p className="mt-2 text-xs leading-5 muted">
          {`보유 재료: ${joinIngredientLabels(recipe.matchedIngredients || recipe.matchedCore || []) || '확인된 재료가 없어요'}`}
        </p>
      ) : null}
      {missingCore.length ? <p className="mt-1 text-xs leading-5 text-rose-700">{`핵심 재료: ${joinIngredientLabels(missingCore)}`}</p> : null}
      {missingGroups.length ? <p className="mt-1 text-xs leading-5 text-rose-700">{`필수 조합: ${missingGroups.join(', ')}`}</p> : null}
      {missingSeasonings.length ? <p className="mt-1 text-xs leading-5 text-rose-700">{`양념: ${joinIngredientLabels(missingSeasonings)}`}</p> : null}
      {missingUnknown.length ? <p className="mt-1 text-xs leading-5 text-amber-700">{`분류 확인: ${joinIngredientLabels(missingUnknown)}`}</p> : null}
      {canMakeNow || canMakeWithOneMore ? <p className="mt-1 text-xs leading-5 muted">원문 분량과 재료 상태도 확인하세요.</p> : null}
    </article>
  );
}

function HomePage() {
  const ocrEnabled = isOcrEnabled();
  const { trackEvent } = useAnalytics();
  const lastViewSignatureRef = useRef('');
  const { loading, readError, loadIngredients, summary, topRecommendations, upcomingItems, urgentCount } = useHomePageModel();
  const {
    cancelMenu,
    completeMenu,
    decision,
    error: menuDecisionError,
    recordExternalOpen,
    retrySync,
    syncing: menuDecisionSyncing
  } = useMenuDecision();
  const showDashboard = !loading && !readError && summary.total > 0;
  const isEmptyDashboard = !loading && !readError && summary.total === 0 && urgentCount === 0 && topRecommendations.length === 0;
  const summaryItems = [
    {
      label: '\uC804\uCCB4 \uC7AC\uB8CC',
      value: loading ? '...' : isEmptyDashboard ? '--' : summary.total,
      className: 'border-green-100 bg-green-50/70'
    },
    {
      label: '\uC6B0\uC120 \uCC98\uB9AC',
      value: loading ? '...' : isEmptyDashboard ? '\uD655\uC778 \uC804' : urgentCount,
      className: 'border-amber-100 bg-amber-50/70'
    },
    {
      label: '\uC624\uB298 \uD560 \uC77C',
      value: loading ? '...' : isEmptyDashboard ? '\uC5C6\uC74C' : topRecommendations.length,
      className: 'border-rose-100 bg-rose-50/70'
    }
  ];

  useEffect(() => {
    if (loading || readError) {
      return;
    }

    const nextSignature = [summary.total, urgentCount, topRecommendations.length].join(':');

    if (lastViewSignatureRef.current === nextSignature) {
      return;
    }

    lastViewSignatureRef.current = nextSignature;
    trackEvent('recommendations_viewed', {
      screen: 'home',
      available_ingredient_count: summary.total,
      expiring_soon_count: urgentCount,
      ready_count: topRecommendations.length,
      buy_one_more_count: 0,
      use_soon_count: 0
    });
  }, [loading, readError, summary.total, topRecommendations.length, trackEvent, urgentCount]);

  return (
    <div className="section-shell mx-auto w-full max-w-4xl px-4 sm:px-6 lg:px-10">
      <PageHeader
        eyebrow={showDashboard ? '내 냉장고' : '우리 집 저녁 식단'}
        title={showDashboard ? '먼저 쓸 재료와 오늘 메뉴를 확인하세요' : '이번 주 저녁부터 정해볼까요?'}
        description={showDashboard ? '등록한 재료로 식단을 만들고, 정확한 분량과 조리법을 확인하세요. 추가 재료 등록은 건너뛸 수 있어요.' : '가입 없이 먹을 날짜와 인원을 정해 식단을 만들어요. 재료 등록은 일부만 하거나 건너뛸 수 있고, 아래에서 메뉴 하나만 둘러봐도 좋아요.'}
        action={
          <>
            <Link to="/meal-plan" className="btn-primary">
              이번 주 식단 만들기
            </Link>
            <Link to="/ingredients/new" className="btn-secondary">
              {'\uC7AC\uB8CC \uCD94\uAC00'}
            </Link>
            {ocrEnabled ? (
              <Link to="/import" className="btn-secondary">
                {'\uC0AC\uC9C4 \uAC00\uC838\uC624\uAE30'}
              </Link>
            ) : null}
          </>
        }
      />

      {readError ? <InventoryReadError loading={loading} onRetry={loadIngredients} /> : null}

      {decision && decision.status !== 'cancelled' ? (
        <section className="border-y border-emerald-200 bg-emerald-50/70 px-4 py-5 sm:px-6" aria-labelledby="today-menu-title">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="kicker">오늘 선택한 메뉴</p>
              <h2 id="today-menu-title" className="mt-1.5 text-xl font-semibold text-slate-950">
                {decision.recipeName}
              </h2>
              <p className="mt-1 text-sm text-slate-600">
                {decision.status === 'completed' ? '오늘 먹은 메뉴로 기록했어요.' : '홈에서 바로 조리법을 확인하고 완료할 수 있어요.'}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {decision.status !== 'completed' ? (
                <button className="btn-primary" disabled={menuDecisionSyncing} onClick={completeMenu} type="button">
                  먹었어요
                </button>
              ) : null}
              <button className="btn-secondary" disabled={menuDecisionSyncing} onClick={cancelMenu} type="button">
                선택 취소
              </button>
              {decision.syncState === 'pending' || decision.syncState === 'error' ? (
                <button className="btn-secondary" disabled={menuDecisionSyncing} onClick={retrySync} type="button">
                  서버 저장 다시 시도
                </button>
              ) : null}
            </div>
          </div>
          <RecipeExternalLinks
            recipeName={decision.recipeName}
            onOpen={() => recordExternalOpen({
              id: decision.recipeKey,
              title: decision.recipeName,
              _recommendationSource: decision.recommendationSource
            }, { screen: 'home' })}
          />
          {menuDecisionError ? <p className="mt-3 text-sm font-medium text-rose-700">{menuDecisionError}</p> : null}
        </section>
      ) : null}

      {showDashboard ? <>
      <section className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {summaryItems.map((item) => (
          <div key={item.label} className={`rounded-lg border px-4 py-4 text-center shadow-sm ${item.className}`}>
            <p className="text-2xl font-semibold leading-none text-stone-800">{item.value}</p>
            <p className="mt-1.5 text-[11px] font-semibold text-stone-500">{item.label}</p>
          </div>
        ))}
      </section>

      <section className="card space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="kicker">{'\uC624\uB298 \uBA3C\uC800 \uBCFC \uBAA9\uB85D'}</p>
            <h3 className="mt-1.5 text-lg font-semibold text-slate-900 sm:text-xl">{'\uC720\uD1B5\uAE30\uD55C \uC784\uBC15 \uB9AC\uC2A4\uD2B8'}</h3>
            <p className="mt-1.5 text-sm leading-5.5 muted">
              {'\uACE7 \uC368\uC57C \uD558\uB294 \uC7AC\uB8CC\uB97C \uC55E\uCABD\uC5D0 \uC815\uB82C\uD574 \uC18C\uBE44 \uC21C\uC11C\uB97C \uBE60\uB974\uAC8C \uC815\uD558\uAC8C \uD569\uB2C8\uB2E4.'}
            </p>
          </div>
          <Link to="/ingredients" className="btn-secondary">
            {'\uC804\uCCB4 \uC7AC\uB8CC \uBCF4\uAE30'}
          </Link>
        </div>

        <div className="content-grid-2 gap-2.5">
          {!loading && !upcomingItems.length ? (
            <EmptyState
              compact
              className="md:col-span-2"
              icon="🧺"
              title={'\uC544\uC9C1 \uC800\uC7A5\uB41C \uC7AC\uB8CC\uAC00 \uC5C6\uC5B4\uC694'}
              description={'\uCCAB \uC7AC\uB8CC\uB97C \uCD94\uAC00\uD558\uBA74 \uC720\uD1B5\uAE30\uD55C \uAD00\uB9AC\uC640 \uC74C\uC2DD\uBB3C \uB0AD\uBE44 \uC904\uC774\uAE30\uB97C \uBC14\uB85C \uC2DC\uC791\uD560 \uC218 \uC788\uC5B4\uC694.'}
              actionLabel={'\uCCAB \uC7AC\uB8CC \uCD94\uAC00\uD558\uAE30'}
              actionTo="/ingredients/new"
            />
          ) : null}

          {upcomingItems.map((ingredient) => (
            <div key={ingredient.id} className="soft-panel flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-base font-semibold text-slate-900">{ingredient.name}</p>
                <p className="mt-1 text-sm muted">
                  {`${getCategoryLabel(ingredient.category)} / ${getStorageLabel(ingredient.storageType)} / \uC720\uD1B5\uAE30\uD55C ${ingredient.expiryDate || '-'}`}
                </p>
              </div>
              <span className="badge bg-white text-slate-700">{getExpiryLabel(getRemainingDays(ingredient.expiryDate))}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="card space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="kicker">{'\uC624\uB298 \uACE0\uB97C \uBA54\uB274'}</p>
            <h3 className="mt-1.5 text-lg font-semibold text-slate-900 sm:text-xl">{'\uCD94\uCC9C \uB808\uC2DC\uD53C \uBBF8\uB9AC\uBCF4\uAE30'}</h3>
            <p className="mt-1.5 text-sm leading-5.5 muted">
              {'\uBC14\uB85C \uD560 \uC218 \uC788\uB294 \uAC83\uBD80\uD130 \uBBF8\uB9AC \uBCF4\uACE0, \uC0C1\uC138 \uD310\uB2E8\uC740 \uB808\uC2DC\uD53C \uD398\uC774\uC9C0\uC5D0\uC11C \uC774\uC5B4\uAC00\uC138\uC694.'}
            </p>
          </div>
          <Link to="/recipes" className="btn-secondary">
            {'\uB808\uC2DC\uD53C \uCD94\uCC9C \uBCF4\uAE30'}
          </Link>
        </div>

        <div>
          {!loading && !topRecommendations.length ? (
            <EmptyState
              compact
              className="md:col-span-2 xl:col-span-3"
              icon="🍳"
              title={'\uC544\uC9C1 \uCD94\uCC9C \uAC00\uB2A5\uD55C \uB808\uC2DC\uD53C\uAC00 \uC5C6\uC5B4\uC694'}
              description={'\uBCF4\uC720 \uC911\uC778 \uC7AC\uB8CC\uB97C \uCD94\uAC00\uD558\uBA74 \uC5EC\uAE30\uC5D0 \uC798 \uB9DE\uB294 \uB808\uC2DC\uD53C\uAC00 \uB098\uD0C0\uB0A9\uB2C8\uB2E4.'}
              actionLabel={'\uC7AC\uB8CC \uB4F1\uB85D\uD558\uB7EC \uAC00\uAE30'}
              actionTo="/ingredients/new"
            />
          ) : null}

          <div className="content-grid-3">
            {topRecommendations.map((recipe) => (
              <RecipePreview key={recipe.id} recipe={recipe} />
            ))}
          </div>
        </div>
      </section>

      </> : null}
      <PublicRecipeExplorer compact />
      <AdSenseSlot placement="home" />
    </div>
  );
}

export default HomePage;
