import { getAiRecipeSuggestions, getRecipeRecommendations } from '../services/recipeService.js';
import {
  normalizeAiSuggestionRequest,
  normalizeRecommendationRequest,
  normalizeSemanticRecipeRequest
} from '../lib/recipeRequestValidation.js';

export {
  normalizeAiSuggestionRequest,
  normalizeRecommendationRequest,
  normalizeRecipeIngredients,
  normalizeSemanticRecipeRequest
} from '../lib/recipeRequestValidation.js';

export async function getRecipeRecommendationsHandler(request, response, next) {
  try {
    const {
      ingredients: bodyIngredients,
      pantryItems,
      preferences
    } = normalizeRecommendationRequest(request.body || {});
    const recommendations = await getRecipeRecommendations({
      userId: request.auth.userId,
      ingredients: bodyIngredients,
      pantryItems,
      preferences
    });

    response.json(recommendations);
  } catch (error) {
    next(error);
  }
}

export async function getAiRecipeSuggestionsHandler(request, response, next) {
  try {
    const { ingredients, externalAi } = normalizeAiSuggestionRequest(request.body || {});
    const suggestions = await getAiRecipeSuggestions(ingredients, { externalAi });
    response.json(suggestions);
  } catch (error) {
    next(error);
  }
}

export async function getSemanticRecipeRecommendationsHandler(request, response, next) {
  try {
    const input = normalizeSemanticRecipeRequest(request.body);
    const recommendations = await getRecipeRecommendations({
      userId: request.auth.userId,
      ...input,
      requireSemantic: true
    });
    const mode = recommendations.some((recipe) => recipe._recommendationSource === 'hybrid')
      ? 'semantic'
      : 'rule-fallback';

    response.json({
      mode,
      recommendations,
      meta: {
        limit: input.limit,
        candidateCount: input.candidateCount
      }
    });
  } catch (error) {
    next(error);
  }
}
