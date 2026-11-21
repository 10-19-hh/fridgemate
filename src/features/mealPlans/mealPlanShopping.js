const hasText = (value) => typeof value === 'string' && value.trim().length > 0;
const knownText = (value) => hasText(value) && !['unknown', 'unverified', '미확인'].includes(value.trim().toLowerCase());
const revision = (value) => hasText(value) || (Number.isSafeInteger(value) && value >= 0);
const nonnegative = (value) => Number.isFinite(value) && value >= 0;
const invalid = (code) => ({ status: 'invalid', issues: [{ code }], basis: null, items: [] });

function sameAmount(left, right) {
  if (left === 0 || right === 0) return left === right;
  return Math.abs(left - right) <= Number.EPSILON * Math.max(Math.abs(left), Math.abs(right)) * 4;
}

function add(left, right) {
  const value = left + right;
  if (!Number.isFinite(value) || (left > 0 && right > 0 && (value === left || value === right))) throw new RangeError('numeric_range');
  return value;
}

function validRequirement(requirement) {
  if (!requirement || !Array.isArray(requirement.lineIds) || !requirement.lineIds.length
    || !requirement.lineIds.every(hasText) || typeof requirement.required !== 'boolean'
    || !['foodId', 'preparationState', 'unit'].every((key) => requirement[key] == null || typeof requirement[key] === 'string')
    || !(requirement.requiredAmount === null || nonnegative(requirement.requiredAmount))
    || !nonnegative(requirement.allocatedAmount)
    || (requirement.requiredAmount !== null && requirement.allocatedAmount > requirement.requiredAmount)) return false;
  if (requirement.status === 'needs-confirmation') return requirement.missingAmount === null;
  if (!nonnegative(requirement.requiredAmount) || !nonnegative(requirement.missingAmount)
    || !sameAmount(requirement.requiredAmount, requirement.allocatedAmount + requirement.missingAmount)) return false;
  return requirement.status === 'sufficient' ? requirement.missingAmount === 0
    : requirement.status === 'shortage' && requirement.missingAmount > 0;
}

function validAllocation(allocation) {
  const basis = allocation?.basis;
  if (allocation?.status !== 'calculated' || !Array.isArray(allocation.meals)
    || !basis || !hasText(basis.scope) || !hasText(basis.asOf) || !hasText(basis.fromDate)
    || !revision(basis.inventoryRevision) || !Array.isArray(basis.planVersions)
    || !basis.planVersions.every((plan) => plan && hasText(plan.id) && revision(plan.revision))
    || new Set(basis.planVersions.map((plan) => plan.id)).size !== basis.planVersions.length) return false;
  const seenMeals = new Set();
  for (const meal of allocation.meals) {
    if (!meal || !['id', 'planId', 'slotId', 'componentId', 'date', 'recipeId', 'recipeVersion'].every((key) => hasText(meal[key]))
      || !basis.planVersions.some((plan) => plan.id === meal.planId && plan.revision === meal.planRevision)
      || seenMeals.has(meal.id) || !Array.isArray(meal.requirements)) return false;
    seenMeals.add(meal.id);
    const seenLines = new Set();
    for (const requirement of meal.requirements) {
      if (!validRequirement(requirement)) return false;
      for (const id of requirement.lineIds) {
        if (seenLines.has(id)) return false;
        seenLines.add(id);
      }
    }
  }
  return true;
}

function deriveItems(allocation) {
  const grouped = new Map();
  for (const meal of allocation.meals) {
    for (const requirement of meal.requirements) {
      const { foodId, preparationState, unit, required, requiredAmount, allocatedAmount, missingAmount, status } = requirement;
      const knownIdentity = [foodId, preparationState, unit].every(knownText);
      const id = JSON.stringify(['meal-plan', allocation.basis.scope, foodId, preparationState, unit, required,
        ...(knownIdentity ? [] : [meal.id, ...requirement.lineIds])]);
      if (!grouped.has(id)) grouped.set(id, {
        id, source: 'meal-plan', foodId, preparationState, unit, required,
        requiredAmount: 0, allocatedAmount: 0, knownMissingAmount: 0, needsConfirmation: false, sources: [],
      });
      const item = grouped.get(id);
      item.requiredAmount = item.requiredAmount === null || requiredAmount === null ? null : add(item.requiredAmount, requiredAmount);
      item.allocatedAmount = add(item.allocatedAmount, allocatedAmount);
      if (missingAmount !== null) item.knownMissingAmount = add(item.knownMissingAmount, missingAmount);
      item.needsConfirmation ||= status === 'needs-confirmation';
      item.sources.push({
        mealId: meal.id, planId: meal.planId, planRevision: meal.planRevision, slotId: meal.slotId,
        componentId: meal.componentId, date: meal.date, recipeId: meal.recipeId, recipeVersion: meal.recipeVersion,
        lineIds: [...requirement.lineIds], requiredAmount, allocatedAmount, missingAmount, status,
      });
    }
  }
  return [...grouped.values()].filter((item) => item.needsConfirmation || item.knownMissingAmount > 0);
}

/**
 * Derived meal-plan demand only. This is NOT a replacement for a user's manual
 * shopping list, purchase history, or consumed-ingredient repurchase records.
 * `knownMissingAmount` is a partial sum whenever `needsConfirmation` is true.
 */
export function deriveMealPlanShopping(allocation) {
  if (!validAllocation(allocation)) return invalid('invalid_allocation');
  try {
    return { status: 'calculated', issues: [], basis: structuredClone(allocation.basis), items: deriveItems(allocation) };
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
    return invalid('numeric_range');
  }
}
