import { getPublicRecipePath, publicRecipeCatalog } from './publicRecipeCatalog';
import { getQuantityRecipeForPublicRecipe } from './quantityRecipeCatalog';
import { validateQuantityRecipe } from './recipeQuantityContract';

/** Projects source-reviewed quantities into the existing name-based recommender. */
export function getQuantityRecommendationRecipes() {
  return publicRecipeCatalog.flatMap((publicRecipe) => {
    const recipe = getQuantityRecipeForPublicRecipe(publicRecipe);
    if (!recipe || validateQuantityRecipe(recipe).status !== 'eligible') return [];
    return [{
      id: recipe.id,
      quantitySource: { kind: recipe.source.kind, id: recipe.source.id, version: recipe.version },
      publicRecipePath: getPublicRecipePath(publicRecipe),
      title: recipe.name,
      ingredients: recipe.ingredients.filter((line) => line.selected).map((line) => ({
        rawName: line.rawName,
        ingredientType: !line.required ? 'optional' : line.role === 'seasoning' ? 'seasoning' : 'main',
        section: line.section,
      })),
    }];
  });
}

/** Exact source identity only: a similar title is not a quantity-data join key. */
export function getQuantityRecipeForRecommendation(candidate) {
  const source = candidate?.quantitySource;
  if (!source) return null;
  const publicRecipe = publicRecipeCatalog.find((recipe) => recipe.externalId === source.id);
  const recipe = getQuantityRecipeForPublicRecipe(publicRecipe);
  if (!recipe || recipe.id !== candidate.id || recipe.source.kind !== source.kind
    || recipe.source.id !== source.id || recipe.version !== source.version
    || validateQuantityRecipe(recipe).status !== 'eligible') return null;
  return recipe;
}
