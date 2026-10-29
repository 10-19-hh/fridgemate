import { describe, expect, it } from 'vitest';
import { mealPlanCatalog } from '../mealPlanCatalog.js';
import { getMealQuantityRequirements } from '../mealQuantityDomain.js';

// Synthetic arithmetic fixtures, NOT reviewed recipes or catalog additions.
function line(overrides = {}) {
  return {
    id: 'main-salt', rawName: '소금', normalizedName: '소금',
    ingredientKey: 'fixture:salt', preparationState: 'as-sold',
    amount: 2, unit: 'g', quantityStatus: 'verified',
    quantityEvidence: 'fixture:main-salt:2g', optional: false, selected: true,
    ...overrides,
  };
}

function mealWith(ingredients, componentOverrides = {}) {
  return {
    components: [{
      id: 'main', source: { id: 'fixture:main' }, recipeVersion: 'fixture-v1',
      servings: 1, servingsStatus: 'verified', ingredients, ...componentOverrides,
    }],
  };
}

function requirement(overrides = {}) {
  return {
    ingredientKey: 'fixture:salt', preparationState: 'as-sold', unit: 'g',
    amount: 2, knownAmount: 2, sourceLines: [{ componentId: 'main', lineId: 'main-salt' }],
    ...overrides,
  };
}

function freezeDeep(value) {
  Object.values(value).forEach((entry) => {
    if (entry && typeof entry === 'object') freezeDeep(entry);
  });
  return Object.freeze(value);
}

describe('verified meal quantity requirements', () => {
  it('returns the reviewed amount without assuming anything about inventory ownership', () => {
    expect(getMealQuantityRequirements(mealWith([line()]), 1)).toEqual({
      status: 'verified', requirements: [requirement()], unverifiedLines: [],
    });
  });

  it('sums main and sauce use instead of applying recommendation name deduplication', () => {
    const meal = mealWith([line(), line({ id: 'sauce-salt', amount: 1, purpose: 'sauce' })]);
    expect(getMealQuantityRequirements(meal, 1)).toEqual({
      status: 'verified',
      requirements: [requirement({ amount: 3, knownAmount: 3, sourceLines: [
        { componentId: 'main', lineId: 'main-salt' },
        { componentId: 'main', lineId: 'sauce-salt' },
      ] })],
      unverifiedLines: [],
    });
  });

  it('combines explicitly reviewed identity even when raw labels differ', () => {
    const meal = mealWith([line(), line({ id: 'salt-en', rawName: 'salt', amount: 1 })]);
    expect(getMealQuantityRequirements(meal, 1)).toMatchObject({
      status: 'verified', requirements: [{ ingredientKey: 'fixture:salt', amount: 3 }],
    });
  });

  it.each([
    ['kg', 0.2, 'g', 200], ['g', 0.125, 'g', 0.125],
    ['l', 0.25, 'ml', 250], ['ml', 50, 'ml', 50], ['개', 0.5, '개', 0.5],
  ])('converts only compatible %s quantities', (unit, amount, expectedUnit, expectedAmount) => {
    expect(getMealQuantityRequirements(mealWith([line({ unit, amount })]), 1)).toMatchObject({
      status: 'verified', requirements: [{ unit: expectedUnit, amount: expectedAmount }],
    });
  });

  it('combines g and kg with the same reviewed identity and preparation', () => {
    const meal = mealWith([line({ amount: 100 }), line({ id: 'second', unit: 'kg', amount: 0.2 })]);
    expect(getMealQuantityRequirements(meal, 1)).toMatchObject({
      status: 'verified', requirements: [{ unit: 'g', amount: 300, knownAmount: 300 }],
    });
  });

  it('does not let binary decimal addition leak into a confirmed quantity', () => {
    const meal = mealWith([line({ amount: 0.1 }), line({ id: 'second', amount: 0.2 })]);
    expect(getMealQuantityRequirements(meal, 1)).toMatchObject({
      requirements: [{ amount: 0.3, knownAmount: 0.3 }],
    });
  });

  it('scales from reviewed component portions, not user plan portions or source labels', () => {
    const meal = mealWith([line({ amount: 300 })], { servings: 3, sourceServings: 99 });
    meal.servings = 99;
    expect(getMealQuantityRequirements(meal, 2)).toMatchObject({
      status: 'verified', requirements: [{ amount: 200 }],
    });
  });

  it('keeps mass, volume and preparation state separate without density or yield assumptions', () => {
    const meal = mealWith([
      line(), line({ id: 'volume', unit: 'ml', amount: 5 }),
      line({ id: 'cooked', preparationState: 'cooked', amount: 7 }),
    ]);
    expect(getMealQuantityRequirements(meal, 1)).toMatchObject({
      status: 'verified', requirements: [
        { unit: 'g', preparationState: 'as-sold', amount: 2 },
        { unit: 'ml', preparationState: 'as-sold', amount: 5 },
        { unit: 'g', preparationState: 'cooked', amount: 7 },
      ],
    });
  });

  it('does not merge foods merely because the recommendation alias has the same name', () => {
    const meal = mealWith([
      line({ rawName: '순두부', normalizedName: '두부', ingredientKey: 'fixture:soft-tofu', amount: 100 }),
      line({ id: 'firm', rawName: '부침두부', normalizedName: '두부', ingredientKey: 'fixture:firm-tofu', amount: 200 }),
    ]);
    expect(getMealQuantityRequirements(meal, 1)).toMatchObject({
      status: 'verified', requirements: [
        { ingredientKey: 'fixture:soft-tofu', amount: 100 },
        { ingredientKey: 'fixture:firm-tofu', amount: 200 },
      ],
    });
  });

  it('only omits unselected optional rows, never required seasonings', () => {
    const meal = mealWith([
      line({ selected: false }),
      line({ id: 'optional-off', optional: true, selected: false, amount: null }),
      line({ id: 'optional-on', optional: true, selected: true, amount: 1 }),
    ]);
    expect(getMealQuantityRequirements(meal, 1)).toMatchObject({
      status: 'verified', requirements: [{ amount: 3, sourceLines: [
        { componentId: 'main', lineId: 'main-salt' },
        { componentId: 'main', lineId: 'optional-on' },
      ] }], unverifiedLines: [],
    });
  });

  it('keeps traceable component references and never changes frozen source rows', () => {
    const meal = mealWith([line()]);
    meal.components.push({ ...structuredClone(meal.components[0]), id: 'sauce' });
    const before = structuredClone(meal);
    freezeDeep(meal);
    const result = getMealQuantityRequirements(meal, 2);
    expect(result).toMatchObject({ requirements: [{ amount: 8, sourceLines: [
      { componentId: 'main', lineId: 'main-salt' },
      { componentId: 'sauce', lineId: 'main-salt' },
    ] }] });
    result.requirements[0].sourceLines[0].lineId = 'changed-output';
    expect(meal).toEqual(before);
  });
});

describe('unknown quantities never become a confirmed zero or total', () => {
  it.each([
    ['missing amount', { amount: null }, 'invalid-amount'],
    ['string amount', { amount: '2' }, 'invalid-amount'],
    ['negative amount', { amount: -1 }, 'invalid-amount'],
    ['NaN amount', { amount: NaN }, 'invalid-amount'],
    ['infinite amount', { amount: Infinity }, 'invalid-amount'],
    ['unreviewed amount', { quantityStatus: 'unverified' }, 'unverified-quantity'],
    ['missing evidence', { quantityEvidence: '' }, 'missing-evidence'],
    ['missing identity', { ingredientKey: null }, 'missing-identity'],
    ['missing preparation', { preparationState: null }, 'missing-preparation'],
    ['unknown preparation label', { preparationState: 'unknown' }, 'unverified-preparation'],
    ['unreviewed preparation label', { preparationState: 'unverified' }, 'unverified-preparation'],
    ['unknown package', { rawAmount: '반 모', unit: '모', amount: 0.5 }, 'unsupported-unit'],
    ['unknown handful', { rawAmount: '한 줌', unit: '줌', amount: 1 }, 'unsupported-unit'],
    ['unresolved cup', { unit: '컵', amount: 1 }, 'unsupported-unit'],
    ['too precise', { amount: 0.0001 }, 'precision-or-range'],
    ['tiny nonzero amount', { amount: 1e-20 }, 'precision-or-range'],
    ['unsafe range', { amount: Number.MAX_SAFE_INTEGER }, 'precision-or-range'],
  ])('reports %s for review', (_name, overrides, reason) => {
    expect(getMealQuantityRequirements(mealWith([line(overrides)]), 1)).toEqual({
      status: 'needs-review', requirements: [],
      unverifiedLines: [{ componentId: 'main', lineId: 'main-salt', reason }],
    });
  });

  it('distinguishes a reviewed explicit zero from missing data', () => {
    expect(getMealQuantityRequirements(mealWith([line({ amount: 0 })]), 1)).toMatchObject({
      status: 'verified', requirements: [{ amount: 0, knownAmount: 0 }], unverifiedLines: [],
    });
  });

  it.each([
    [{ servingsStatus: 'unverified' }, 'unverified-servings'],
    [{ servings: null }, 'unverified-servings'],
    [{ servings: 0 }, 'unverified-servings'],
    [{ servings: '1' }, 'unverified-servings'],
    [{ source: null }, 'missing-source'],
    [{ recipeVersion: null }, 'missing-source'],
  ])('does not substitute source labels for component review %j', (overrides, reason) => {
    expect(getMealQuantityRequirements(mealWith([line()], overrides), 2)).toMatchObject({
      status: 'needs-review', requirements: [], unverifiedLines: [{ reason }],
    });
  });

  it('does not round an unrepresentable portion into a confirmed amount', () => {
    expect(getMealQuantityRequirements(mealWith([line({ amount: 1 })], { servings: 3 }), 1)).toMatchObject({
      status: 'needs-review', requirements: [], unverifiedLines: [{ reason: 'precision-or-range' }],
    });
  });

  it('retains the known subtotal but not a full total when another use has unknown quantity', () => {
    const meal = mealWith([line(), line({ id: 'unknown-sauce', amount: null })]);
    expect(getMealQuantityRequirements(meal, 1)).toMatchObject({
      status: 'needs-review', requirements: [{ amount: null, knownAmount: 2 }],
      unverifiedLines: [{ lineId: 'unknown-sauce', reason: 'invalid-amount' }],
    });
  });

  it('does not let unknown units or preparation hide behind a known subtotal', () => {
    const meal = mealWith([
      line(), line({ id: 'volume', amount: 5, unit: 'ml' }),
      line({ id: 'unknown', unit: null, preparationState: null }),
    ]);
    expect(getMealQuantityRequirements(meal, 1)).toMatchObject({
      status: 'needs-review', requirements: [
        { unit: 'g', amount: null, knownAmount: 2 },
        { unit: 'ml', amount: null, knownAmount: 5 },
      ],
    });
  });

  it('keeps totals uncertain when an unresolved use has an unknown preparation label', () => {
    const meal = mealWith([line(), line({ id: 'unknown', preparationState: 'unknown' })]);
    expect(getMealQuantityRequirements(meal, 1)).toMatchObject({
      status: 'needs-review', requirements: [{ amount: null, knownAmount: 2 }],
      unverifiedLines: [{ reason: 'unverified-preparation' }],
    });
  });

  it('keeps unrelated reviewed quantities usable while disclosing incomplete meal requirements', () => {
    const meal = mealWith([line(), line({ id: 'unknown', ingredientKey: 'fixture:pepper', amount: null })]);
    expect(getMealQuantityRequirements(meal, 1)).toMatchObject({
      status: 'needs-review', requirements: [{ ingredientKey: 'fixture:salt', amount: 2 }],
      unverifiedLines: [{ lineId: 'unknown' }],
    });
  });

  it('does not let an unsafe sum become a confirmed amount', () => {
    const meal = mealWith([
      line({ amount: 5_000_000_000_000 }),
      line({ id: 'second', amount: 5_000_000_000_000 }),
    ]);
    expect(getMealQuantityRequirements(meal, 1)).toMatchObject({
      status: 'needs-review', requirements: [{ amount: null, knownAmount: 5_000_000_000_000 }],
      unverifiedLines: [{ lineId: 'second', reason: 'precision-or-range' }],
    });
  });

  it('does not lose a small use when an integer subtotal cannot round-trip through output units', () => {
    const meal = mealWith([
      line({ amount: 9007199254740.99 }), line({ id: 'small-use', amount: 0.001 }),
    ]);
    expect(getMealQuantityRequirements(meal, 1)).toMatchObject({
      status: 'needs-review', requirements: [{ amount: null, knownAmount: 9007199254740.99 }],
      unverifiedLines: [{ lineId: 'small-use', reason: 'precision-or-range' }],
    });
  });

  it('keeps every current catalog meal unverified without filling its missing amounts', () => {
    const before = JSON.stringify(mealPlanCatalog);
    for (const meal of mealPlanCatalog) {
      const result = getMealQuantityRequirements(meal, 2);
      expect(result.status).toBe('needs-review');
      expect(result.requirements).toEqual([]);
      expect(result.unverifiedLines.length).toBeGreaterThan(0);
    }
    expect(JSON.stringify(mealPlanCatalog)).toBe(before);
  });
});

describe('quantity contract boundaries', () => {
  it.each([0, 3, -1, 1.5, '2', null, NaN])('rejects target servings %s outside the current adult 1–2 range', (servings) => {
    expect(() => getMealQuantityRequirements(mealWith([line()]), servings)).toThrow(RangeError);
  });

  it('rejects a missing or empty component list rather than declaring a complete meal', () => {
    expect(() => getMealQuantityRequirements({}, 1)).toThrow(TypeError);
    expect(() => getMealQuantityRequirements({ components: [] }, 1)).toThrow(TypeError);
  });

  it('rejects ambiguous duplicate component or line IDs instead of silently dropping rows', () => {
    const duplicateComponents = mealWith([line()]);
    duplicateComponents.components.push(structuredClone(duplicateComponents.components[0]));
    expect(() => getMealQuantityRequirements(duplicateComponents, 1)).toThrow(TypeError);
    expect(() => getMealQuantityRequirements(mealWith([line(), line()]), 1)).toThrow(TypeError);
  });

  it('rejects missing source row IDs and malformed line lists', () => {
    expect(() => getMealQuantityRequirements(mealWith([line({ id: null })]), 1)).toThrow(TypeError);
    expect(() => getMealQuantityRequirements(mealWith(null), 1)).toThrow(TypeError);
    expect(() => getMealQuantityRequirements(mealWith([]), 1)).toThrow(TypeError);
  });
});
