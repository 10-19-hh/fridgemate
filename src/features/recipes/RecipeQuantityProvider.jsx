import { useMemo } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { useIngredients } from '../../hooks/useIngredients';
import { RecipeQuantitySessionProvider } from './RecipeQuantitySession';
import { useQuantityMealDate } from '../../hooks/useQuantityMealDate';

export default function RecipeQuantityProvider({ children }) {
  const { storageScope, loading: authLoading } = useAuth();
  const { ingredients, inventoryScope, loading: inventoryLoading, error } = useIngredients();
  const mealDate = useQuantityMealDate();
  // An internal invalidation key, never an autofill, storage or analytics payload.
  const matchesScope = inventoryScope === storageScope;
  const inventoryRevision = matchesScope ? JSON.stringify(ingredients) : 'unavailable';
  const ready = matchesScope && !authLoading && !inventoryLoading && !error;
  const loading = !matchesScope || authLoading || inventoryLoading;
  const context = useMemo(() => ({ scope: storageScope, inventoryRevision, mealDate, ready, loading }),
    [storageScope, inventoryRevision, mealDate, ready, loading]);
  return <RecipeQuantitySessionProvider context={context}>{children}</RecipeQuantitySessionProvider>;
}
