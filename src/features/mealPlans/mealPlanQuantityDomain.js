import { validateQuantityRecipe } from '../recipes/recipeQuantityContract.js';
import { calculateScaledCooking } from '../recipes/scaledCooking.js';

const hasText = (value) => typeof value === 'string' && value.trim().length > 0;
const knownText = (value) => hasText(value) && !['unknown', 'unverified', '미확인'].includes(value.trim().toLowerCase());
const revision = (value) => hasText(value) || (Number.isSafeInteger(value) && value >= 0);
const positive = (value) => Number.isFinite(value) && value > 0;
const timestamp = (value) => hasText(value)
  && /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(value)
  && calendarDate(value.slice(0, 10)) && Number.isFinite(Date.parse(value));
const invalidDemand = (code) => ({ status: 'invalid', issues: [{ code }], meal: null });

function calendarDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function sameSelection(ids, lines) {
  return Array.isArray(ids) && ids.length === lines.length && new Set(ids).size === ids.length
    && lines.every((line) => ids.includes(line.id));
}

/**
 * Pure conversion of an explicit quantity choice into future demand.
 * The caller supplies a canonical reviewed recipe and owns approval/storage.
 * A legacy `planned` slot or a preview alone is NOT a confirmed quantity choice.
 */
export function buildConfirmedRecipeMeal(input = {}) {
  const { recipe, scope, planId, planRevision, slotId, componentId, date, locked, quantityChoice } = input || {};
  if (validateQuantityRecipe(recipe).status !== 'eligible') return invalidDemand('recipe_not_eligible');
  if (![recipe.id, recipe.version].every(hasText)
    || recipe.ingredients.some((line) => !hasText(line.id))) return invalidDemand('planning_identity_invalid');
  if (![scope, planId, slotId, componentId].every(hasText) || !revision(planRevision)
    || !calendarDate(date) || typeof locked !== 'boolean') return invalidDemand('invalid_placement');
  const lines = recipe.ingredients.filter((line) => line.selected);
  if (quantityChoice?.status !== 'confirmed' || quantityChoice.recipeId !== recipe.id
    || quantityChoice.recipeVersion !== recipe.version || !timestamp(quantityChoice.confirmedAt)
    || !sameSelection(quantityChoice.selectedLineIds, lines)
    || !positive(quantityChoice.targetServings) || !positive(quantityChoice.scaleFactor)
    || quantityChoice.scaleFactor > 1) return invalidDemand('quantity_choice_unconfirmed');

  const { targetServings, scaleFactor } = quantityChoice;
  const servingFactor = targetServings / recipe.servings;
  if (!positive(servingFactor)) return invalidDemand('numeric_range');
  const demands = lines.map((line) => {
    const verified = line.quantityStatus === 'verified' && positive(line.amount)
      && hasText(line.quantityEvidence) && knownText(line.unit);
    return {
      lineId: line.id, foodId: line.foodId ?? null, preparationState: line.preparationState ?? null,
      amount: verified ? (line.amount * servingFactor) * scaleFactor : null, unit: line.unit ?? null,
      quantityStatus: verified ? 'verified' : 'unknown', required: line.required, selected: true,
    };
  });
  if (demands.some((line) => line.amount !== null && !positive(line.amount))) return invalidDemand('numeric_range');
  return { status: 'valid', issues: [], meal: {
    id: JSON.stringify([planId, slotId, componentId]), scope, planId, planRevision, slotId, componentId,
    date, mealType: 'dinner', status: 'confirmed', locked, recipeId: recipe.id, recipeVersion: recipe.version,
    targetServings, approvedScaleFactor: scaleFactor,
    quantityChoice: { ...quantityChoice, selectedLineIds: [...quantityChoice.selectedLineIds] }, demands,
  } };
}

const invalidPreview = (code) => ({ status: 'invalid', issues: [{ code }], preview: null, planningBasis: null });
const sameFields = (left, right, fields) => fields.every((key) => left[key] === right[key]);
const placementFields = ['id', 'planId', 'planRevision', 'slotId', 'componentId', 'date', 'recipeId', 'recipeVersion'];
const demandFields = ['lineId', 'foodId', 'preparationState', 'amount', 'unit', 'quantityStatus', 'required', 'selected'];
const identityFields = ['foodId', 'preparationState', 'unit'];

function sameAmount(left, right) {
  if (!Number.isFinite(left) || !Number.isFinite(right)) return false;
  if (left === 0 || right === 0) return left === right;
  return Math.abs(left - right) <= Number.EPSILON * Math.max(Math.abs(left), Math.abs(right)) * 4;
}

function validAssignedAmounts(requirement) {
  if (!Array.isArray(requirement.allocations)) return false;
  const ids = new Set();
  let total = 0;
  for (const assignment of requirement.allocations) {
    if (!assignment || !hasText(assignment.inventoryId) || ids.has(assignment.inventoryId)
      || !positive(assignment.amount)) return false;
    ids.add(assignment.inventoryId);
    total += assignment.amount;
  }
  if (!sameAmount(total, requirement.allocatedAmount)) return false;
  if (requirement.status === 'needs-confirmation') return requirement.missingAmount === null;
  if (!Number.isFinite(requirement.missingAmount) || requirement.missingAmount < 0
    || !sameAmount(requirement.requiredAmount, requirement.allocatedAmount + requirement.missingAmount)) return false;
  return requirement.status === 'sufficient' ? requirement.missingAmount === 0 : requirement.missingAmount > 0;
}

function matchesApprovedMeal(recipe, meal) {
  const rebuilt = buildConfirmedRecipeMeal({ ...meal, recipe });
  return rebuilt.status === 'valid' && sameFields(meal, rebuilt.meal,
    [...placementFields, 'scope', 'mealType', 'status', 'locked', 'targetServings', 'approvedScaleFactor'])
    && Array.isArray(meal.demands) && meal.demands.length === rebuilt.meal.demands.length
    && meal.demands.every((line, index) => line && sameFields(line, rebuilt.meal.demands[index], demandFields));
}

function matchesPlanningBasis(basis, meal) {
  return basis && basis.scope === meal.scope && timestamp(basis.asOf)
    && Date.parse(meal.quantityChoice.confirmedAt) <= Date.parse(basis.asOf)
    && calendarDate(basis.fromDate) && meal.date >= basis.fromDate && revision(basis.inventoryRevision)
    && Array.isArray(basis.planVersions)
    && basis.planVersions.every((plan) => plan && hasText(plan.id) && revision(plan.revision))
    && new Set(basis.planVersions.map((plan) => plan.id)).size === basis.planVersions.length
    && basis.planVersions.some((plan) => plan.id === meal.planId && plan.revision === meal.planRevision);
}

function matchesRequirements(requirements, demands) {
  if (!Array.isArray(requirements)) return false;
  const byLine = new Map(demands.map((line) => [line.lineId, line]));
  const seenLines = new Set();
  const seenGroups = new Set();
  for (const requirement of requirements) {
    if (!requirement || !Array.isArray(requirement.lineIds) || !requirement.lineIds.length
      || !['sufficient', 'shortage', 'needs-confirmation'].includes(requirement.status)
      || !Number.isFinite(requirement.allocatedAmount) || requirement.allocatedAmount < 0
      || !validAssignedAmounts(requirement)) return false;
    const knownIdentity = identityFields.every((key) => knownText(requirement[key]));
    const groupKey = knownIdentity ? JSON.stringify(identityFields.map((key) => requirement[key])) : null;
    if ((knownIdentity && seenGroups.has(groupKey)) || (!knownIdentity && requirement.lineIds.length !== 1)) return false;
    if (knownIdentity) seenGroups.add(groupKey);
    let amount = 0;
    let required = false;
    for (const lineId of requirement.lineIds) {
      const line = byLine.get(lineId);
      if (!line || seenLines.has(lineId) || !sameFields(line, requirement, identityFields)) return false;
      seenLines.add(lineId);
      required ||= line.required;
      amount = amount === null || line.amount === null ? null : amount + line.amount;
    }
    if (requirement.required !== required || requirement.requiredAmount !== amount
      || (amount !== null && (!positive(amount) || requirement.allocatedAmount > amount))) return false;
    if ((amount === null || !knownIdentity) && requirement.status !== 'needs-confirmation') return false;
    if (requirement.status === 'needs-confirmation' && requirement.missingAmount !== null) return false;
  }
  return seenLines.size === demands.length;
}

/** Read-only re-preview of one confirmed component; never approves a new amount. */
export function previewAllocatedRecipeMeal(input = {}) {
  const { recipe, meal, allocation } = input || {};
  if (!meal || !matchesApprovedMeal(recipe, meal)) return invalidPreview('approved_meal_changed');
  if (!Array.isArray(allocation?.meals) || allocation.meals.some((entry) => !entry || !hasText(entry.id))
    || new Set(allocation.meals.map((entry) => entry.id)).size !== allocation.meals.length) return invalidPreview('allocation_missing');
  const allocated = allocation.meals.find((entry) => entry.id === meal.id);
  if (allocation?.status !== 'calculated' || !allocated) return invalidPreview('allocation_missing');
  const basis = allocation.basis;
  if (!matchesPlanningBasis(basis, meal) || !sameFields(allocated, meal, placementFields)
    || !matchesRequirements(allocated.requirements, meal.demands)) return invalidPreview('allocation_changed');
  const planningBasis = {
    scope: basis.scope, asOf: basis.asOf, fromDate: basis.fromDate,
    inventoryRevision: basis.inventoryRevision,
    planVersions: basis.planVersions.map((plan) => ({ ...plan })),
    planId: meal.planId, planRevision: meal.planRevision, slotId: meal.slotId,
    componentId: meal.componentId, date: meal.date, recipeId: meal.recipeId, recipeVersion: meal.recipeVersion,
    targetServings: meal.targetServings, approvedScaleFactor: meal.approvedScaleFactor,
  };
  const preview = calculateScaledCooking({ recipe, targetServings: meal.targetServings, inventory: {
    scope: basis.scope, revision: basis.inventoryRevision, asOf: basis.asOf, mealDate: meal.date,
    basis: 'allocated', allocationRevision: JSON.stringify(planningBasis),
    // A group appears once even if the ingredient occurs in both sauce and main.
    // Unknown allocation is not a confirmed zero quantity.
    items: allocated.requirements.map((requirement, index) => ({
      id: `${meal.id}:${index}`, foodId: requirement.foodId, preparationState: requirement.preparationState,
      unit: requirement.unit, amount: requirement.status === 'needs-confirmation' ? null : requirement.allocatedAmount,
      quantityStatus: requirement.status === 'needs-confirmation' ? 'unknown' : 'confirmed',
      availabilityStatus: requirement.status === 'needs-confirmation' ? 'unknown' : 'available',
      confirmedAt: basis.asOf,
    })),
  } });
  if (preview.status === 'invalid') return invalidPreview('invalid_scaled_preview');
  return { status: 'calculated', issues: [], planningBasis, preview };
}
