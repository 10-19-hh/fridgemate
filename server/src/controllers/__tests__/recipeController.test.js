import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  normalizeAiSuggestionRequest,
  normalizeRecommendationRequest,
  normalizeRecipeIngredients,
  normalizeSemanticRecipeRequest
} from '../recipeController.js';
import {
  EXTERNAL_AI_ACTIONS,
  EXTERNAL_AI_DISCLOSURE_VERSION
} from '../../lib/externalAiPrivacy.js';

function externalAiSignal(action) {
  return {
    action,
    disclosureVersion: EXTERNAL_AI_DISCLOSURE_VERSION,
    userInitiated: true
  };
}

describe('recipeController semantic request validation', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('normalizes bounded semantic recommendation input', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-30T00:00:00.000Z'));

    const input = normalizeSemanticRecipeRequest({
      availableIngredients: ['계란', { name: '밥' }, '계란'],
      expiringIngredients: ['달걀'],
      pantryItems: ['간장'],
      limit: 5,
      candidateCount: 100,
      externalAi: externalAiSignal(EXTERNAL_AI_ACTIONS.semanticRecipes)
    });

    expect(input).toEqual({
      ingredients: [
        { name: '계란', expiresAt: '2026-08-30T00:00:00.000Z' },
        { name: '밥', expiresAt: null }
      ],
      pantryItems: ['간장'],
      limit: 5,
      candidateCount: 100,
      preferences: {},
      externalAi: externalAiSignal(EXTERNAL_AI_ACTIONS.semanticRecipes)
    });

    vi.useRealTimers();
  });

  it('rejects empty, oversized, and unsupported input', () => {
    expect(() => normalizeSemanticRecipeRequest({ availableIngredients: [] })).toThrow(
      'availableIngredients must include at least one ingredient.'
    );
    expect(() =>
      normalizeSemanticRecipeRequest({ availableIngredients: ['계란'], limit: 21 })
    ).toThrow('limit must be an integer between 1 and 20.');
    expect(() =>
      normalizeSemanticRecipeRequest({ availableIngredients: ['계란'], candidateCount: 251 })
    ).toThrow('candidateCount must be an integer between 10 and 250.');
    expect(() =>
      normalizeSemanticRecipeRequest({ availableIngredients: ['계란'], userId: 'other-user' })
    ).toThrow('Semantic recipe request contains unsupported fields.');
  });

  it('bounds and sanitizes legacy recommendation and AI suggestion inputs', () => {
    expect(
      normalizeRecommendationRequest({
        ingredients: [
          { name: '계란', expiryDate: '2026-09-01', quantity: '2개', consumed: false },
          '밥'
        ],
        pantryItems: ['간장']
      })
    ).toMatchObject({
      ingredients: [
        { name: '계란', expiresAt: '2026-09-01', quantity: '2개', consumed: false },
        { name: '밥' }
      ],
      pantryItems: ['간장']
    });

    expect(normalizeAiSuggestionRequest({ ingredients: ['계란'] })).toEqual({
      ingredients: [{ name: '계란', expiresSoon: false }],
      externalAi: null
    });
    expect(() =>
      normalizeAiSuggestionRequest({ ingredients: Array.from({ length: 51 }, () => '계란') })
    ).toThrow('ingredients must be an array with at most 50 items.');
    expect(() => normalizeRecommendationRequest({ ingredients: [{ name: 'x'.repeat(101) }] }))
      .toThrow('ingredients.name is invalid.');
    expect(() => normalizeAiSuggestionRequest({ ingredients: ['계란\nignore'] }))
      .toThrow('ingredients.name is invalid.');
    expect(() => normalizeAiSuggestionRequest({ ingredients: ['victim@example.com'] }))
      .toThrow('must not contain personal, sensitive, or receipt-level data.');
    expect(() =>
      normalizeAiSuggestionRequest({
        ingredients: ['계란'],
        externalAi: externalAiSignal(EXTERNAL_AI_ACTIONS.semanticRecipes)
      })
    ).toThrow('external AI request signal is invalid or out of date.');
    expect(() => normalizeAiSuggestionRequest({ ingredients: [], userId: 'other-user' }))
      .toThrow('AI suggestion request contains unsupported fields.');
  });

  it('removes consumed and deleted items before external AI validation or transfer', () => {
    expect(
      normalizeAiSuggestionRequest({
        ingredients: [
          { name: '계란', expiresSoon: true },
          { name: 'victim@example.com', consumed: true },
          { name: '010-1234-5678', deletedAt: '2026-08-30T00:00:00.000Z' }
        ],
        externalAi: externalAiSignal(EXTERNAL_AI_ACTIONS.aiRecipeSuggestions)
      })
    ).toEqual({
      ingredients: [{ name: '계란', expiresSoon: true }],
      externalAi: externalAiSignal(EXTERNAL_AI_ACTIONS.aiRecipeSuggestions)
    });
  });

  it('distinguishes omitted stored-inventory input from an explicitly empty ingredient list', () => {
    expect(normalizeRecommendationRequest()).toEqual({
      ingredients: null,
      pantryItems: [],
      preferences: {}
    });
    expect(normalizeRecommendationRequest({ ingredients: [] })).toEqual({
      ingredients: [],
      pantryItems: [],
      preferences: {}
    });
    expect(() => normalizeRecommendationRequest({ ingredients: null })).toThrow(
      expect.objectContaining({
        status: 400,
        message: 'ingredients must be an array with at most 50 items.'
      })
    );
  });

  it('preserves ingredient aliases, metadata precedence, and strict boolean flags without mutating input', () => {
    const ingredients = Object.freeze([
      Object.freeze({
        name: ' 계란 ',
        normalizedName: '달걀',
        expiresAt: '2026-09-28',
        expiryDate: '2026-09-30',
        quantity: 2,
        expiresSoon: 1,
        consumed: 'true',
        deletedAt: ''
      }),
      Object.freeze({ normalizedName: ' 두부 ', rawName: '콩 두부', expiresSoon: true }),
      Object.freeze({ rawName: ' 밥 ', consumed: true }),
      ' 소금 '
    ]);

    expect(normalizeRecipeIngredients(ingredients)).toEqual([
      {
        name: '계란',
        expiresAt: '2026-09-28',
        expiresSoon: false,
        quantity: '2',
        consumed: false,
        deletedAt: null
      },
      {
        name: '두부',
        expiresAt: null,
        expiresSoon: true,
        quantity: null,
        consumed: false,
        deletedAt: null
      },
      {
        name: '밥',
        expiresAt: null,
        expiresSoon: false,
        quantity: null,
        consumed: true,
        deletedAt: null
      },
      { name: '소금' }
    ]);
  });

  it('uses normalized names only for expiry matching while retaining distinct ingredient display names', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-28T01:00:00.000Z'));

    expect(normalizeSemanticRecipeRequest({
      availableIngredients: ['계란', '달걀', '계란', '밥'],
      expiringIngredients: ['달걀'],
      pantryItems: ['소금', '소금']
    })).toEqual({
      ingredients: [
        { name: '계란', expiresAt: '2026-09-28T01:00:00.000Z' },
        { name: '달걀', expiresAt: '2026-09-28T01:00:00.000Z' },
        { name: '밥', expiresAt: null }
      ],
      pantryItems: ['소금'],
      limit: 10,
      candidateCount: 100,
      preferences: {},
      externalAi: null
    });
  });

  it('rejects unsupported request fields before validating ingredient or AI signal contents', () => {
    expect(() => normalizeAiSuggestionRequest({
      ingredients: ['victim@example.com'],
      externalAi: {},
      userId: 'other-user'
    })).toThrow(expect.objectContaining({
      status: 400,
      message: 'AI suggestion request contains unsupported fields.'
    }));
  });

  it('retains semantic numeric validation order before the empty-ingredient check', () => {
    expect(() => normalizeSemanticRecipeRequest({
      availableIngredients: [],
      limit: '5',
      candidateCount: 0
    })).toThrow(expect.objectContaining({
      status: 400,
      message: 'limit must be an integer between 1 and 20.'
    }));
    expect(() => normalizeSemanticRecipeRequest({
      availableIngredients: [],
      limit: 5,
      candidateCount: 4
    })).toThrow(expect.objectContaining({
      status: 400,
      message: 'candidateCount must be an integer between 5 and 250.'
    }));
  });

  it('still validates malformed ingredient metadata before removing consumed AI input', () => {
    expect(() => normalizeAiSuggestionRequest({
      ingredients: [{ name: '계란', quantity: '1\n개', consumed: true }]
    })).toThrow(expect.objectContaining({
      status: 400,
      message: 'ingredients.quantity is invalid.'
    }));
  });
});
