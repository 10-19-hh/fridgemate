const hasText = (value) => typeof value === 'string' && value.trim().length > 0;
const hasRevision = (value) => hasText(value) || (Number.isSafeInteger(value) && value >= 0);

function comparisonKey(recommendation) {
  const quantity = recommendation?.quantityResult;
  if (!quantity || !['original', 'scaled'].includes(quantity.status)
    || !Number.isFinite(quantity.scaleFactor) || quantity.scaleFactor <= 0 || quantity.scaleFactor > 1) return null;

  const { rankingScore, homePriority, urgentMatches, missingIngredients, quantityContext } = recommendation;
  if (!Number.isFinite(rankingScore) || !Number.isFinite(homePriority)
    || !Array.isArray(urgentMatches) || !Array.isArray(missingIngredients)) return null;
  if (!quantityContext || !hasText(quantityContext.scope) || !hasRevision(quantityContext.inventoryRevision)
    || !hasText(quantityContext.mealDate) || !Number.isFinite(quantityContext.targetServings)
    || quantityContext.targetServings <= 0) return null;

  return JSON.stringify([
    rankingScore, homePriority, urgentMatches.length, missingIngredients.length,
    quantityContext.scope, quantityContext.inventoryRevision, quantityContext.mealDate, quantityContext.targetServings,
  ]);
}

/**
 * Refines already-ranked recommendations without displacing incomparable items.
 * Source authenticity and binding a result to its context belong to the caller.
 */
export function orderQuantityRecommendations(recommendations = []) {
  const ordered = [...recommendations];
  const cohorts = new Map();

  recommendations.forEach((recommendation, index) => {
    const key = comparisonKey(recommendation);
    if (key === null) return;
    if (!cohorts.has(key)) cohorts.set(key, []);
    cohorts.get(key).push(index);
  });

  for (const positions of cohorts.values()) {
    const rankedPositions = [...positions].sort((left, right) =>
      recommendations[right].quantityResult.scaleFactor - recommendations[left].quantityResult.scaleFactor
        || left - right);
    // Assign only to this cohort's original slots; unknown results stay put.
    positions.forEach((position, index) => {
      ordered[position] = recommendations[rankedPositions[index]];
    });
  }

  return ordered;
}
