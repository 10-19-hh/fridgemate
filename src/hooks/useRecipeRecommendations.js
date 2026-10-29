import { useEffect, useMemo, useRef, useState } from 'react';
import { getRecipeRecommendations, RecipesApiError } from '../api/recipesApi';
import { seedRecipes } from '../data/seedRecipes';
import { useAuth } from './useAuth';
import { useIngredients } from './useIngredients';
import { isBackendEnabled } from '../utils/backendConfig';
import { buildRecipeRecommendations } from '../utils/recommendations';
import { useOptionalUserPreferences } from './useUserPreferences';

function shouldFallbackToLocalRecommendations(error) {
  return error instanceof RecipesApiError && (!error.status || error.status >= 500);
}

export function useRecipeRecommendations(pantryItems = []) {
  const { isAuthenticated } = useAuth();
  const { ingredients, loading: ingredientsLoading, readError, loadIngredients } = useIngredients();
  const { preferences } = useOptionalUserPreferences();
  const requestIdRef = useRef(0);
  const localRecommendations = useMemo(
    () => buildRecipeRecommendations(seedRecipes, ingredients, { pantryItems, preferences }),
    [ingredients, pantryItems, preferences]
  );
  const [recommendations, setRecommendations] = useState(localRecommendations);
  const [loading, setLoading] = useState(ingredientsLoading);
  const [error, setError] = useState('');
  const [dataSource, setDataSource] = useState(isBackendEnabled() && isAuthenticated ? 'api' : 'local');

  useEffect(() => {
    setRecommendations(localRecommendations);

    if (!isBackendEnabled() || !isAuthenticated) {
      setLoading(ingredientsLoading);
      setError('');
      setDataSource('local');
      return;
    }

    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    let isMounted = true;

    const loadRecommendations = async () => {
      setLoading(true);

      try {
        const nextRecommendations = await getRecipeRecommendations(ingredients, pantryItems, preferences);

        if (!isMounted || requestIdRef.current !== requestId) {
          return;
        }

        setRecommendations(nextRecommendations);
        setError('');
        setDataSource('api');
      } catch (nextError) {
        if (!isMounted || requestIdRef.current !== requestId) {
          return;
        }

        if (!shouldFallbackToLocalRecommendations(nextError)) {
          setError(nextError.message || 'Failed to load recipe recommendations.');
          setRecommendations(localRecommendations);
          setDataSource('local');
          return;
        }

        console.warn('[useRecipeRecommendations] Failed to load via API. Falling back to local recommendations.', nextError);
        setRecommendations(localRecommendations);
        setError('The recommendation API is unstable, so FridgeMate is showing browser-based recommendations.');
        setDataSource('local');
      } finally {
        if (isMounted && requestIdRef.current === requestId) {
          setLoading(false);
        }
      }
    };

    loadRecommendations();

    return () => {
      isMounted = false;
    };
  }, [ingredients, ingredientsLoading, isAuthenticated, localRecommendations, pantryItems, preferences]);

  return {
    recommendations,
    loading,
    error,
    dataSource,
    ingredients,
    readError,
    loadIngredients
  };
}
