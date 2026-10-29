import { useMemo } from 'react';
import { PANTRY_STATUS } from '../data/pantryStaples';
import {
  getMissingBasicIngredients,
  getSectionHelperText,
  splitRecommendationsByReadiness
} from '../features/recipes/recommendationSections';
import { usePantryStaples } from './usePantryStaples';
import { useLocalRecommendations } from './useLocalRecommendations';
import { getDashboardSummary } from '../utils/date';

function getFridgeInsight({ activeIngredientCount, recommendationCoverage, expiringSoon }) {
  if (!activeIngredientCount) {
    return '등록된 재료가 아직 없어요. 기본 재료를 먼저 추가하면 바로 만들 수 있는 메뉴와 장보기 후보가 정리됩니다.';
  }

  if (activeIngredientCount < 4) {
    return '등록된 재료가 적어서 추천 폭이 좁아요. 자주 쓰는 기본 재료를 몇 가지만 더 채우면 후보가 늘어납니다.';
  }

  if (!recommendationCoverage) {
    return '조합은 아직 적지만, 핵심 재료와 자주 쓰는 기본 조미료를 함께 갖추면 바로 만들 수 있는 메뉴가 늘어날 가능성이 커요.';
  }

  if (expiringSoon > 0) {
    return '유통기한이 가까운 재료가 있어서 소비 우선순위를 기준으로 추천을 조금 더 위에 올려두었어요.';
  }

  return '지금 있는 재료만으로도 몇 가지 후보를 바로 살펴볼 수 있어요.';
}

function buildSectionStats({ loading, readyRecommendations, buyOneRecommendations, useSoonRecommendations }) {
  return {
    ready: {
      value: loading ? '...' : readyRecommendations.length,
      helper: loading
        ? '추천을 정리 중이에요'
        : getSectionHelperText(readyRecommendations.length, '아직 없어요', '바로 해볼 수 있어요', '오늘 바로 고를 수 있어요')
    },
    buyOne: {
      value: loading ? '...' : buyOneRecommendations.length,
      helper: loading
        ? '추천을 정리 중이에요'
        : getSectionHelperText(buyOneRecommendations.length, '일부 재료가 맞는 후보만 보여줘요', '하나만 채우면 돼요', '장보기 효율이 좋아요')
    },
    useSoon: {
      value: loading ? '...' : useSoonRecommendations.length,
      helper: loading
        ? '추천을 정리 중이에요'
        : getSectionHelperText(useSoonRecommendations.length, '아직 후보가 적어요', '먼저 처리할 재료가 보여요', '소비 순서를 잡기 좋아요')
    }
  };
}

export function useRecipesPageModel() {
  const { pantryStaples, pantryOwnership, pantrySummary, cyclePantryStatus, syncError: pantryError,
    saving: pantrySaving, storageReady: pantryStorageReady, canRetrySave: pantryCanRetrySave,
    reloadPantryOwnership, retryPantrySave } = usePantryStaples();
  const ownedPantryItems = useMemo(
    () =>
      pantryStaples
        .filter((staple) => pantryOwnership[staple.id] === PANTRY_STATUS.OWNED)
        .map((staple) => staple.name),
    [pantryOwnership, pantryStaples]
  );
  const { recommendations, loading, ingredients, readError, loadIngredients } = useLocalRecommendations(ownedPantryItems);
  const summary = useMemo(() => getDashboardSummary(ingredients), [ingredients]);
  const missingBasicIngredients = useMemo(() => getMissingBasicIngredients(ingredients), [ingredients]);
  const activeIngredientCount = useMemo(() => ingredients.filter((ingredient) => !ingredient.consumed).length, [ingredients]);
  const recommendationGroups = useMemo(() => splitRecommendationsByReadiness(recommendations), [recommendations]);
  const readyRecommendations = recommendationGroups.ready;
  const buyOneRecommendations = recommendationGroups.buyOneMore;
  const useSoonRecommendations = recommendationGroups.useSoon;
  const recommendationCoverage = useMemo(
    () => readyRecommendations.length + buyOneRecommendations.length,
    [buyOneRecommendations.length, readyRecommendations.length]
  );
  const ownedPantryCount = useMemo(
    () => pantryStaples.filter((staple) => pantryOwnership[staple.id] === PANTRY_STATUS.OWNED).length,
    [pantryOwnership, pantryStaples]
  );
  const fridgeInsight = useMemo(
    () =>
      getFridgeInsight({
        activeIngredientCount,
        recommendationCoverage,
        expiringSoon: summary.expiringSoon
      }),
    [activeIngredientCount, recommendationCoverage, summary.expiringSoon]
  );
  const sectionStats = useMemo(
    () =>
      buildSectionStats({
        loading,
        readyRecommendations,
        buyOneRecommendations,
        useSoonRecommendations
      }),
    [buyOneRecommendations, loading, readyRecommendations, useSoonRecommendations]
  );

  return {
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
    localRecommendations: recommendations,
    readyRecommendations,
    buyOneRecommendations,
    useSoonRecommendations,
    ownedPantryCount,
    fridgeInsight,
    sectionStats
  };
}
