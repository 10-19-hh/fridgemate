import { buildRecipeRecommendations, explainRecipeMatch } from '../../utils/recommendations';
import { calculateScaledCooking } from './scaledCooking';
import { getQuantityRecipeForRecommendation } from './quantityRecommendationCatalog';
import { orderQuantityRecommendations } from './quantityRecommendationOrder';

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const hasText = (value) => typeof value === 'string' && value.trim().length > 0;
const hasRevision = (value) => hasText(value) || (Number.isSafeInteger(value) && value >= 0);
const positive = (value) => Number.isFinite(value) && value > 0;

/** A form's manual revision is distinct from the observed stock-context revision. */
export function getQuantityRecommendationResult(candidate, confirmation, context) {
  const recipe = getQuantityRecipeForRecommendation(candidate);
  if (!recipe || !isRecord(confirmation) || !isRecord(context) || !isRecord(confirmation.inventory)) return null;
  const targetServings = context.targetServings === undefined ? confirmation.targetServings : context.targetServings;
  if (!hasText(context.scope) || !hasRevision(context.inventoryRevision) || !hasText(context.mealDate)
    || !positive(targetServings) || confirmation.targetServings !== targetServings
    || confirmation.recipeId !== recipe.id || confirmation.recipeVersion !== recipe.version
    || confirmation.inventoryRevision !== context.inventoryRevision
    || confirmation.inventory.scope !== context.scope || confirmation.inventory.mealDate !== context.mealDate) return null;
  return calculateScaledCooking({ recipe, targetServings, inventory: confirmation.inventory });
}

function compareExistingPriority(left, right) {
  return right.rankingScore - left.rankingScore
    || right.homePriority - left.homePriority
    || right.urgentMatches.length - left.urgentMatches.length
    || left.missingIngredients.length - right.missingIngredients.length;
}

/** Adds quantity evidence without reinterpreting legacy ingredient-kind readiness. */
export function buildQuantityAwareRecommendations(recipes = [], ingredients = [], { pantryItems = [], preferences, confirmations = {}, context } = {}) {
  function withQuantity(candidate) {
    const confirmation = isRecord(confirmations) && Object.hasOwn(confirmations, candidate.id) ? confirmations[candidate.id] : null;
    const candidateContext = context ? { ...context, targetServings: confirmation?.targetServings } : null;
    const quantityResult = getQuantityRecommendationResult(candidate, confirmation, candidateContext);
    const quantityContext = quantityResult ? {
      scope: context.scope, inventoryRevision: context.inventoryRevision, mealDate: context.mealDate,
      targetServings: quantityResult.basis.targetServings,
    } : null;
    return { ...candidate, quantityResult, quantityContext };
  }

  const ranked = buildRecipeRecommendations(recipes, ingredients, { pantryItems, preferences }).map(withQuantity);
  const includedIds = new Set(ranked.map((candidate) => candidate.id));
  for (const recipe of recipes) {
    if (includedIds.has(recipe.id)) continue;
    const checked = withQuantity(recipe);
    if (checked.quantityResult === null) continue;
    // Keep bound confirmations visible, including zero/unknown/invalid outcomes.
    // Their presence is evidence of confirmation, not a claim of cooking readiness.
    // Explain the original recipe, but keep its legacy score/status even if score=0.
    const evaluated = explainRecipeMatch(recipe.id, { recipes: [recipe], fridgeIngredients: ingredients, pantryItems });
    if (!evaluated) continue;
    ranked.push({ ...evaluated, quantityResult: checked.quantityResult, quantityContext: checked.quantityContext });
    includedIds.add(recipe.id);
  }
  ranked.sort(compareExistingPriority);
  return orderQuantityRecommendations(ranked);
}
