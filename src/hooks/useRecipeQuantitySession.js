import { createContext, useContext } from 'react';

export const RecipeQuantityContext = createContext(null);

export function useRecipeQuantitySession() {
  return useContext(RecipeQuantityContext);
}
