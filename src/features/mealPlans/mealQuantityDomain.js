const UNITS = new Map([
  ['g', { unit: 'g', factor: 1 }],
  ['kg', { unit: 'g', factor: 1000 }],
  ['ml', { unit: 'ml', factor: 1 }],
  ['l', { unit: 'ml', factor: 1000 }],
  ['개', { unit: '개', factor: 1 }],
]);
const PRECISION = 1000;
const PREPARATION_STATES = new Set(['raw', 'cooked', 'as-sold']);

function hasText(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function validateStructure(meal, targetServings) {
  if (targetServings !== 1 && targetServings !== 2) {
    throw new RangeError('Target servings must be 1 or 2.');
  }
  if (!Array.isArray(meal?.components) || meal.components.length === 0) {
    throw new TypeError('A meal must have source components.');
  }
  const componentIds = new Set();
  for (const component of meal.components) {
    if (!hasText(component?.id) || componentIds.has(component.id)) {
      throw new TypeError('Component IDs must be present and unique within a meal.');
    }
    componentIds.add(component.id);
    if (!Array.isArray(component.ingredients) || component.ingredients.length === 0) {
      throw new TypeError('A component must have source ingredient rows.');
    }
    const lineIds = new Set();
    for (const line of component.ingredients) {
      if (!hasText(line?.id) || lineIds.has(line.id)) {
        throw new TypeError('Ingredient IDs must be present and unique within a component.');
      }
      lineIds.add(line.id);
    }
  }
}

function getReviewReason(component, line) {
  if (!hasText(component.source?.id) || !hasText(component.recipeVersion)) return 'missing-source';
  if (component.servingsStatus !== 'verified'
    || !Number.isFinite(component.servings) || component.servings <= 0) return 'unverified-servings';
  if (!hasText(line.ingredientKey)) return 'missing-identity';
  if (!hasText(line.preparationState)) return 'missing-preparation';
  if (!PREPARATION_STATES.has(line.preparationState)) return 'unverified-preparation';
  if (line.quantityStatus !== 'verified') return 'unverified-quantity';
  if (!hasText(line.quantityEvidence)) return 'missing-evidence';
  if (!Number.isFinite(line.amount) || line.amount < 0) return 'invalid-amount';
  if (!UNITS.has(line.unit)) return 'unsupported-unit';
  return null;
}

function scaledIntegerAmount(component, line, targetServings) {
  const scaled = line.amount * UNITS.get(line.unit).factor * PRECISION
    * targetServings / component.servings;
  const integer = Math.round(scaled);
  // Accept only floating-point representation noise, not rounded recipe amounts.
  const tolerance = Math.min(1e-7, Number.EPSILON * Math.max(1, Math.abs(scaled)) * 4);
  if (line.amount > 0 && integer === 0) return null;
  if (!isRepresentableAmount(integer) || Math.abs(scaled - integer) > tolerance) return null;
  return integer;
}

function isRepresentableAmount(integer) {
  return Number.isSafeInteger(integer)
    && Math.round((integer / PRECISION) * PRECISION) === integer;
}

/**
 * Derive quantities from reviewed component portions without changing source rows.
 * This is not an inventory allocator or a claim that a meal can be cooked.
 * Recommendation aliases deliberately do not establish quantitative compatibility.
 */
export function getMealQuantityRequirements(meal, targetServings) {
  validateStructure(meal, targetServings);
  const groups = new Map();
  const unresolved = [];
  let includedLines = 0;

  for (const component of meal.components) {
    for (const line of component.ingredients) {
      if (line.optional === true && line.selected !== true) continue;
      includedLines += 1;
      const reference = { componentId: component.id, lineId: line.id };
      const reason = getReviewReason(component, line);
      if (reason) {
        unresolved.push({ line, reference, reason });
        continue;
      }

      const amount = scaledIntegerAmount(component, line, targetServings);
      const unit = UNITS.get(line.unit).unit;
      const key = JSON.stringify([line.ingredientKey, line.preparationState, unit]);
      const group = groups.get(key);
      const total = (group?.integerAmount ?? 0) + (amount ?? 0);
      if (amount === null || !isRepresentableAmount(total)) {
        unresolved.push({ line, reference, reason: 'precision-or-range' });
        continue;
      }
      if (group) {
        group.integerAmount = total;
        group.sourceLines.push(reference);
      } else {
        groups.set(key, {
          ingredientKey: line.ingredientKey, preparationState: line.preparationState,
          unit, integerAmount: amount, sourceLines: [reference],
        });
      }
    }
  }

  const requirements = [...groups.values()].map((group) => {
    // Without a known preparation state/unit, another use of this same food
    // may belong to this group. Disclose a subtotal instead of assuming it away.
    const incomplete = unresolved.some(({ line }) => line.ingredientKey === group.ingredientKey
      && (!PREPARATION_STATES.has(line.preparationState) || line.preparationState === group.preparationState)
      && (!UNITS.has(line.unit) || UNITS.get(line.unit).unit === group.unit));
    const knownAmount = group.integerAmount / PRECISION;
    return {
      ingredientKey: group.ingredientKey, preparationState: group.preparationState,
      unit: group.unit, amount: incomplete ? null : knownAmount, knownAmount,
      sourceLines: group.sourceLines,
    };
  });

  return {
    status: unresolved.length || includedLines === 0 ? 'needs-review' : 'verified',
    requirements,
    unverifiedLines: unresolved.map(({ reference, reason }) => ({ ...reference, reason })),
  };
}
