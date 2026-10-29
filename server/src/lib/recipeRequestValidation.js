import { createHttpError } from './httpError.js';
import { normalizeIngredientName } from '../../../src/features/ingredients/ingredientDomain.js';
import { normalizeUserPreferenceInput } from '../services/personalizationService.js';
import {
  EXTERNAL_AI_ACTIONS,
  normalizeExternalAiRequestSignal,
  normalizeExternalAiText
} from './externalAiPrivacy.js';

const SEMANTIC_REQUEST_FIELDS = new Set([
  'availableIngredients',
  'expiringIngredients',
  'pantryItems',
  'limit',
  'candidateCount',
  'preferences',
  'externalAi'
]);
const RECOMMENDATION_REQUEST_FIELDS = new Set(['ingredients', 'pantryItems', 'preferences']);
const AI_SUGGESTION_REQUEST_FIELDS = new Set(['ingredients', 'externalAi']);
const MAX_RECIPE_INGREDIENTS = 50;
const MAX_INGREDIENT_NAME_LENGTH = 100;

function hasControlCharacters(value) {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint <= 31 || codePoint === 127;
  });
}

function assertRequestObject(body, name, supportedFields) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw createHttpError(400, `${name} must be an object.`);
  }
  if (Object.keys(body).some((field) => !supportedFields.has(field))) {
    throw createHttpError(400, `${name} contains unsupported fields.`);
  }
}

function normalizeOptionalString(value, name, maxLength = 100) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw createHttpError(400, `${name} is invalid.`);
  }

  const normalized = String(value).trim();
  if (normalized.length > maxLength || hasControlCharacters(normalized)) {
    throw createHttpError(400, `${name} is invalid.`);
  }
  return normalized || null;
}

export function normalizeRecipeIngredients(value, name = 'ingredients', { allowMissing = false } = {}) {
  if (value === undefined && allowMissing) return null;
  if (!Array.isArray(value) || value.length > MAX_RECIPE_INGREDIENTS) {
    throw createHttpError(
      400,
      `${name} must be an array with at most ${MAX_RECIPE_INGREDIENTS} items.`
    );
  }

  return value.map((item) => {
    if (typeof item !== 'string' && (!item || typeof item !== 'object' || Array.isArray(item))) {
      throw createHttpError(400, `${name} contains an invalid ingredient.`);
    }

    const rawName = typeof item === 'string'
      ? item
      : item.name || item.normalizedName || item.rawName;
    const ingredientName = normalizeOptionalString(
      rawName,
      `${name}.name`,
      MAX_INGREDIENT_NAME_LENGTH
    );

    if (!ingredientName) {
      throw createHttpError(400, `${name} contains an invalid ingredient name.`);
    }

    if (typeof item === 'string') return { name: ingredientName };

    return {
      name: ingredientName,
      expiresAt: normalizeOptionalString(item.expiresAt || item.expiryDate, `${name}.expiresAt`, 64),
      expiresSoon: item.expiresSoon === true,
      quantity: normalizeOptionalString(item.quantity, `${name}.quantity`, 100),
      consumed: item.consumed === true,
      deletedAt: normalizeOptionalString(item.deletedAt, `${name}.deletedAt`, 64)
    };
  });
}

function normalizeStringList(value, name, maxItems = 50, { externalAiSafe = false } = {}) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > maxItems) {
    throw createHttpError(400, `${name} must be an array with at most ${maxItems} items.`);
  }

  const normalized = value.map((item) => {
    const rawName = typeof item === 'string' ? item : item?.name;
    const ingredientName = externalAiSafe
      ? normalizeExternalAiText(rawName, `${name}.name`)
      : normalizeOptionalString(rawName, `${name}.name`, 100);
    if (!ingredientName) {
      throw createHttpError(400, `${name} contains an invalid ingredient name.`);
    }
    return ingredientName;
  });

  return [...new Set(normalized)];
}

function normalizeInteger(value, name, fallback, min, max) {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value < min || value > max) {
    throw createHttpError(400, `${name} must be an integer between ${min} and ${max}.`);
  }
  return value;
}

export function normalizeSemanticRecipeRequest(body = {}) {
  assertRequestObject(body, 'Semantic recipe request', SEMANTIC_REQUEST_FIELDS);

  const availableIngredients = normalizeStringList(
    body.availableIngredients,
    'availableIngredients',
    50,
    { externalAiSafe: true }
  );
  const expiringIngredients = normalizeStringList(
    body.expiringIngredients,
    'expiringIngredients',
    50,
    { externalAiSafe: true }
  );
  const pantryItems = normalizeStringList(body.pantryItems, 'pantryItems', 100, {
    externalAiSafe: true
  });
  const limit = normalizeInteger(body.limit, 'limit', 10, 1, 20);
  const candidateCount = normalizeInteger(body.candidateCount, 'candidateCount', 100, limit, 250);
  const preferences = body.preferences ? normalizeUserPreferenceInput(body.preferences) : {};
  const externalAi = normalizeExternalAiRequestSignal(
    body.externalAi,
    EXTERNAL_AI_ACTIONS.semanticRecipes
  );
  const expiringSet = new Set(expiringIngredients.map(normalizeIngredientName));

  if (!availableIngredients.length) {
    throw createHttpError(400, 'availableIngredients must include at least one ingredient.');
  }

  return {
    ingredients: availableIngredients.map((name) => ({
      name,
      expiresAt: expiringSet.has(normalizeIngredientName(name)) ? new Date().toISOString() : null
    })),
    pantryItems,
    limit,
    candidateCount,
    preferences,
    externalAi
  };
}

export function normalizeRecommendationRequest(body = {}) {
  assertRequestObject(body, 'Recipe recommendation request', RECOMMENDATION_REQUEST_FIELDS);
  return {
    ingredients: normalizeRecipeIngredients(body.ingredients, 'ingredients', { allowMissing: true }),
    pantryItems: normalizeStringList(body.pantryItems, 'pantryItems', 100),
    preferences: body.preferences ? normalizeUserPreferenceInput(body.preferences) : {}
  };
}

export function normalizeAiSuggestionRequest(body = {}) {
  assertRequestObject(body, 'AI suggestion request', AI_SUGGESTION_REQUEST_FIELDS);
  const ingredients = normalizeRecipeIngredients(body.ingredients, 'ingredients')
    .filter((ingredient) => ingredient.consumed !== true && !ingredient.deletedAt)
    .map((ingredient) => ({
      name: normalizeExternalAiText(ingredient.name, 'ingredients.name'),
      expiresSoon: ingredient.expiresSoon === true
    }));

  return {
    ingredients,
    externalAi: normalizeExternalAiRequestSignal(
      body.externalAi,
      EXTERNAL_AI_ACTIONS.aiRecipeSuggestions
    )
  };
}
