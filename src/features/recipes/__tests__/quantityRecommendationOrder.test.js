import { describe, expect, it } from 'vitest';
import { orderQuantityRecommendations } from '../quantityRecommendationOrder';

function recommendation(id, scaleFactor, overrides = {}) {
  return {
    id, rankingScore: 100, homePriority: 3, urgentMatches: ['양파'], missingIngredients: ['돼지고기'],
    quantityResult: {
      status: scaleFactor === 1 ? 'original' : 'scaled', scaleFactor,
      requirementsStatus: 'satisfied', ingredients: [], limitingIngredients: [], checks: [], issues: [],
    },
    quantityContext: { scope: 'guest', inventoryRevision: 'stock-v1', mealDate: '2026-09-15', targetServings: 1 },
    ...overrides,
  };
}

const ids = (items) => items.map((item) => item.id);

function deepFreeze(value) {
  Object.values(value).forEach((nested) => {
    if (nested && typeof nested === 'object') deepFreeze(nested);
  });
  return Object.freeze(value);
}

describe('quantity recommendation ordering within existing rank and confirmation cohorts', () => {
  it('swaps only confirmed candidate positions around an unknown recommendation', () => {
    const input = [
      recommendation('A', 0.2),
      recommendation('unknown', null, { quantityResult: { status: 'needs-confirmation', scaleFactor: null } }),
      recommendation('B', 0.8),
    ];
    const output = orderQuantityRecommendations(input);
    expect(ids(output)).toEqual(['B', 'unknown', 'A']);
    expect(output[1]).toBe(input[1]);
  });

  it('orders original and scaled portions descending while retaining equal-ratio input order', () => {
    const input = [
      recommendation('small', 0.2), recommendation('equal-first', 0.8),
      recommendation('equal-second', 0.8), recommendation('original', 1),
    ];
    expect(ids(orderQuantityRecommendations(input))).toEqual(['original', 'equal-first', 'equal-second', 'small']);
  });

  it('keeps unreviewed, zero, malformed and non-computable results in their exact positions', () => {
    const pinned = [
      recommendation('unreviewed', undefined, { quantityResult: undefined }),
      recommendation('unknown', null, { quantityResult: { status: 'needs-confirmation', scaleFactor: null } }),
      recommendation('zero', 0), recommendation('negative', -1), recommendation('nan', NaN),
      recommendation('infinity', Infinity), recommendation('too-large', 1.01),
      recommendation('missing-ratio', undefined), recommendation('string-ratio', '0.9'),
      recommendation('invalid', 1, { quantityResult: { status: 'invalid', scaleFactor: 1 } }),
      recommendation('unavailable', 1, { quantityResult: { status: 'unavailable', scaleFactor: 1 } }),
    ];
    const input = [recommendation('small', 0.2), ...pinned, recommendation('large', 0.8)];
    const output = orderQuantityRecommendations(input);
    expect(output[0].id).toBe('large');
    expect(output.at(-1).id).toBe('small');
    pinned.forEach((item, index) => expect(output[index + 1]).toBe(item));
    expect(output).toHaveLength(input.length);
  });

  it('does not displace any different existing priority tuple', () => {
    const higherPriorityTuples = [
      { rankingScore: 101 }, { homePriority: 4 },
      { urgentMatches: ['양파', '당근'] }, { missingIngredients: [] },
    ];
    for (const tuple of higherPriorityTuples) {
      const input = [recommendation('priority-first', 0.01, tuple), recommendation('small', 0.2), recommendation('large', 0.8)];
      expect(ids(orderQuantityRecommendations(input))).toEqual(['priority-first', 'large', 'small']);
    }
  });

  it('does not compare different scopes, revisions, meal dates or target servings', () => {
    const differentContexts = [
      { scope: 'user:alice' }, { inventoryRevision: 'stock-v2' },
      { mealDate: '2026-09-16' }, { targetServings: 2 },
    ];
    for (const difference of differentContexts) {
      const other = recommendation('different-context', 1);
      other.quantityContext = { ...other.quantityContext, ...difference };
      const input = [recommendation('small', 0.2), other, recommendation('large', 0.8)];
      expect(ids(orderQuantityRecommendations(input))).toEqual(['large', 'different-context', 'small']);
    }
  });

  it('pins incomplete comparison metadata instead of supplying zero or one defaults', () => {
    const base = (id, ratio) => recommendation(id, ratio, {
      rankingScore: 0, homePriority: 0, urgentMatches: [], missingIngredients: [],
      quantityContext: { scope: 'guest', inventoryRevision: 0, mealDate: '2026-09-15', targetServings: 1 },
    });
    const omit = [
      ['rankingScore'], ['homePriority'], ['urgentMatches'], ['missingIngredients'], ['quantityContext'],
      ['quantityContext', 'scope'], ['quantityContext', 'inventoryRevision'],
      ['quantityContext', 'mealDate'], ['quantityContext', 'targetServings'],
    ];
    for (const [field, nestedField] of omit) {
      const incomplete = base('incomplete', 1);
      if (nestedField) delete incomplete[field][nestedField];
      else delete incomplete[field];
      expect(ids(orderQuantityRecommendations([base('small', 0.2), incomplete, base('large', 0.8)])))
        .toEqual(['large', 'incomplete', 'small']);
    }
  });

  it('does not coerce malformed tuple or context values into a comparable cohort', () => {
    const malformed = [
      { rankingScore: '100' }, { rankingScore: NaN }, { homePriority: Infinity },
      { urgentMatches: { length: 1 } }, { missingIngredients: null },
      { quantityContext: {} }, { quantityContext: null },
    ];
    for (const overrides of malformed) {
      const fixed = recommendation('malformed', 1, overrides);
      expect(ids(orderQuantityRecommendations([recommendation('small', 0.2), fixed, recommendation('large', 0.8)])))
        .toEqual(['large', 'malformed', 'small']);
    }
  });

  it('retains arbitrarily small positive candidates and compares unrounded ratios', () => {
    const input = [
      recommendation('tiny', 1e-20), recommendation('almost-half', 0.50009),
      recommendation('larger-tiny', 2e-20), recommendation('just-larger', 0.5001),
    ];
    expect(ids(orderQuantityRecommendations(input))).toEqual(['just-larger', 'almost-half', 'larger-tiny', 'tiny']);
  });

  it('returns a new array without mutating frozen inputs or cloning the recommendation objects', () => {
    const input = deepFreeze([recommendation('small', 0.2), recommendation('large', 0.8)]);
    const before = structuredClone(input);
    const output = orderQuantityRecommendations(input);
    expect(output).not.toBe(input);
    expect(output[0]).toBe(input[1]);
    expect(output[1]).toBe(input[0]);
    expect(input).toEqual(before);
  });

  it('is deterministic and idempotent without filtering empty or unchanged inputs', () => {
    const input = [recommendation('A', 0.2), recommendation('B', 0.8), recommendation('C', 0.8)];
    expect(ids(orderQuantityRecommendations(input))).toEqual(['B', 'C', 'A']);
    expect(ids(orderQuantityRecommendations(input))).toEqual(['B', 'C', 'A']);
    expect(ids(orderQuantityRecommendations(orderQuantityRecommendations(input)))).toEqual(['B', 'C', 'A']);
    expect(orderQuantityRecommendations()).toEqual([]);
    const empty = [];
    expect(orderQuantityRecommendations(empty)).not.toBe(empty);
  });
});
