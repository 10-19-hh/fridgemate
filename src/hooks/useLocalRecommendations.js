import { useMemo } from 'react';
import { seedRecipes } from '../data/seedRecipes';
import { useIngredients } from './useIngredients';
import { buildRecipeRecommendations } from '../utils/recommendations';
import { getQuantityRecommendationRecipes } from '../features/recipes/quantityRecommendationCatalog';
import { buildQuantityAwareRecommendations } from '../features/recipes/quantityRecommendationBridge';
import { useRecipeQuantitySession } from './useRecipeQuantitySession';
import { useOptionalUserPreferences } from './useUserPreferences';

const localRecipes = [...seedRecipes, ...getQuantityRecommendationRecipes()];

export function useLocalRecommendations(pantryItems = []) {
  const { ingredients, loading, error, readError, loadIngredients } = useIngredients();
  const { preferences } = useOptionalUserPreferences();
  const session = useRecipeQuantitySession();
  const recommendations = useMemo(
    () => {
      if (!session) return buildRecipeRecommendations(seedRecipes, ingredients, { pantryItems, preferences });
      if (!session.context.ready) return [];
      return buildQuantityAwareRecommendations(localRecipes, ingredients, {
        pantryItems, preferences, confirmations: session.confirmations, context: session.context,
      });
    },
    [ingredients, pantryItems, preferences, session]
  );

  return {
    recommendations,
    loading: loading || Boolean(session?.context.loading),
    error,
    readError,
    loadIngredients,
    ingredients: session && !session.context.ready ? [] : ingredients
  };
}
