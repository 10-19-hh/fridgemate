import { useMemo } from 'react';
import { PANTRY_STATUS } from '../data/pantryStaples';
import { getUpcomingIngredients } from '../features/ingredients/ingredientSelectors';
import { usePantryStaples } from './usePantryStaples';
import { useRecipeRecommendations } from './useRecipeRecommendations';
import { getDashboardSummary } from '../utils/date';

export function useHomePageModel() {
  const { pantryStaples, pantryOwnership } = usePantryStaples();
  const ownedPantryItems = useMemo(
    () =>
      (pantryStaples || [])
        .filter((staple) => pantryOwnership?.[staple.id] === PANTRY_STATUS.OWNED)
        .map((staple) => staple.name),
    [pantryOwnership, pantryStaples]
  );
  const { recommendations, ingredients, loading, readError, loadIngredients } = useRecipeRecommendations(ownedPantryItems);
  const summary = useMemo(() => getDashboardSummary(ingredients), [ingredients]);
  const topRecommendations = useMemo(
    () => recommendations.filter((recipe) => recipe.score > 0).slice(0, 3),
    [recommendations]
  );
  const upcomingItems = useMemo(() => getUpcomingIngredients(ingredients, 4), [ingredients]);
  const urgentCount = summary.expired + summary.expiringSoon;

  return {
    loading,
    readError,
    loadIngredients,
    summary,
    topRecommendations,
    upcomingItems,
    urgentCount
  };
}
