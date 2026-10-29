import { useMemo } from 'react';
import { seedRecipes } from '../data/seedRecipes';
import { useIngredients } from './useIngredients';
import { buildRecipeRecommendations } from '../utils/recommendations';
import { useOptionalUserPreferences } from './useUserPreferences';

export function useLocalRecommendations(pantryItems = []) {
  const { ingredients, loading, readError, loadIngredients } = useIngredients();
  const { preferences } = useOptionalUserPreferences();
  const recommendations = useMemo(
    () => buildRecipeRecommendations(seedRecipes, ingredients, { pantryItems, preferences }),
    [ingredients, pantryItems, preferences]
  );

  return {
    recommendations,
    loading,
    ingredients,
    readError,
    loadIngredients
  };
}
