import { useCallback, useEffect, useState } from 'react';
import { RecipeQuantityContext } from '../../hooks/useRecipeQuantitySession';

export function RecipeQuantitySessionProvider({ context, children }) {
  const contextKey = JSON.stringify([context.scope, context.inventoryRevision, context.mealDate, context.ready]);
  const [state, setState] = useState(() => ({ contextKey, epoch: 0, records: {} }));
  // Reset this provider's data, not the route tree. The render guard also prevents
  // an old scope's values from appearing before an effect could clear them.
  if (state.contextKey !== contextKey) {
    setState({ contextKey, epoch: state.epoch + 1, records: {} });
  }
  const confirmations = state.contextKey === contextKey && context.ready ? state.records : {};
  const invalidateAll = useCallback(() => {
    setState((previous) => ({ ...previous, epoch: previous.epoch + 1, records: {} }));
  }, []);

  useEffect(() => {
    function handleVisibility() {
      if (document.visibilityState === 'hidden') invalidateAll();
    }
    window.addEventListener('blur', invalidateAll);
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      window.removeEventListener('blur', invalidateAll);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [invalidateAll]);

  function confirm(record) {
    if (!context.ready || !record || typeof record.recipeId !== 'string' || !record.recipeId.trim()
      || typeof record.recipeVersion !== 'string' || !record.recipeVersion.trim()
      || record.inventoryRevision !== context.inventoryRevision
      || !Number.isFinite(record.targetServings) || record.targetServings <= 0
      || record.inventory?.scope !== context.scope || record.inventory?.mealDate !== context.mealDate) return;
    const snapshot = structuredClone(record);
    setState((previous) => {
      if (previous.contextKey !== contextKey || previous.epoch !== state.epoch) return previous;
      return { ...previous, records: { ...previous.records, [snapshot.recipeId]: snapshot } };
    });
  }

  function invalidate(recipeId) {
    setState((previous) => {
      if (previous.contextKey !== contextKey || previous.epoch !== state.epoch) return previous;
      const records = { ...previous.records };
      delete records[recipeId];
      return { ...previous, epoch: previous.epoch + 1, records };
    });
  }

  return (
    <RecipeQuantityContext.Provider value={{ context, confirmations, confirm, invalidate, invalidateAll }}>
      {children}
    </RecipeQuantityContext.Provider>
  );
}
