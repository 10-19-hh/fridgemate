import { getActiveIngredients } from '../ingredients/ingredientSelectors';

export const BASIC_RECIPE_INGREDIENTS = ['계란', '양파', '대파', '두부', '버섯'];

function normalizeName(name) {
  return String(name || '').trim().toLowerCase();
}

export function getMissingBasicIngredients(ingredients = [], basics = BASIC_RECIPE_INGREDIENTS, limit = 5) {
  const ownedIngredients = new Set(getActiveIngredients(ingredients).map((ingredient) => normalizeName(ingredient.name)));

  return basics.filter((ingredient) => !ownedIngredients.has(normalizeName(ingredient))).slice(0, limit);
}

export function getSectionHelperText(count, emptyText, lowText, positiveText) {
  if (!count) {
    return emptyText;
  }

  if (count <= 2) {
    return lowText;
  }

  return positiveText;
}

export function getQuantityRecommendationGroup(recommendation) {
  const result = recommendation.quantityResult;
  if (!recommendation.quantitySource && !result) return null;
  if (result?.status === 'unavailable' || result?.status === 'invalid') return 'quantityUnavailable';
  const hasPositiveQuantity = (result?.status === 'original' || result?.status === 'scaled')
    && Number.isFinite(result.scaleFactor) && result.scaleFactor > 0 && result.scaleFactor <= 1;
  return hasPositiveQuantity && result.requirementsStatus === 'satisfied'
    ? 'quantityReady' : 'quantityNeedsConfirmation';
}

export function splitRecommendationsByReadiness(recommendations = []) {
  return recommendations.reduce(
    (groups, recommendation) => {
      const quantityGroup = getQuantityRecommendationGroup(recommendation);
      if (quantityGroup) {
        groups[quantityGroup].push(recommendation);
        return groups;
      }

      if (recommendation.isPersonalized === false) return groups;
      const missingCore = recommendation.missingCore || recommendation.missingIngredients || [];
      const missingGroups = recommendation.missingGroups || [];
      const missingSeasonings = recommendation.missingSeasonings || [];
      const missingUnknown = recommendation.missingUnknownIngredients || [];
      const knownRequirements = recommendation.hasKnownRequirements !== false &&
        !(recommendation.totalRequiredIngredients === 0 && !recommendation.requiredGroups?.length);
      const coreComplete = knownRequirements && missingCore.length === 0 && missingGroups.length === 0;

      if (recommendation.canMakeNow && coreComplete && !missingSeasonings.length && !missingUnknown.length) {
        groups.ready.push(recommendation);
        return groups;
      }

      const matchedCoreCount = Array.isArray(recommendation.matchedCore)
        ? recommendation.matchedCore.length
        : Number(recommendation.matchedCount || 0);

      const canCompleteWithOne = knownRequirements && missingCore.length + missingGroups.length === 1 &&
        matchedCoreCount + Number(recommendation.matchedRequiredGroupCount || 0) > 0 &&
        missingSeasonings.every((item) => missingCore.includes(item)) && !missingUnknown.length;

      if (recommendation.canMakeWithOneMore !== false && canCompleteWithOne) {
        groups.buyOneMore.push(recommendation);
        return groups;
      }

      const usesExpiringIngredient = recommendation.useSoon || recommendation.urgentMatches?.length ||
        recommendation.expiringMatchedIngredients?.length;

      if (usesExpiringIngredient && recommendation.score > 0) {
        groups.useSoon.push(recommendation);
        return groups;
      }

      if (recommendation.needsSeasonings !== false && coreComplete && missingSeasonings.length && !missingUnknown.length &&
        matchedCoreCount + Number(recommendation.matchedRequiredGroupCount || 0) > 0) {
        groups.needsSeasonings.push(recommendation);
        return groups;
      }

      groups.other.push(recommendation);

      return groups;
    },
    {
      ready: [],
      buyOneMore: [],
      useSoon: [],
      needsSeasonings: [],
      other: [],
      quantityReady: [],
      quantityNeedsConfirmation: [],
      quantityUnavailable: []
    }
  );
}
