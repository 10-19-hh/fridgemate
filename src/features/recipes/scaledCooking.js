import { validateQuantityRecipe } from './recipeQuantityContract.js';

const hasText = (value) => typeof value === 'string' && value.trim().length > 0;
const unknownMarkers = new Set(['unknown', 'unverified', '미확인']);
const hasKnownText = (value) => hasText(value) && !unknownMarkers.has(value.trim().toLowerCase());
const positive = (value) => Number.isFinite(value) && value > 0;
const hasRevision = (value) => hasText(value) || (Number.isSafeInteger(value) && value >= 0);
const timestamp = (value) => hasText(value) && Number.isFinite(Date.parse(value));
const groupKey = (line) => JSON.stringify([line.foodId, line.preparationState, line.unit]);

function calendarDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function exceedsAvailable(required, available) {
  // Relative machine precision only, NOT a gram cutoff or display rounding.
  // In particular, any positive representable amount still exceeds true zero.
  if (available === 0) return required > 0;
  return required > available && required - available
    > Number.EPSILON * Math.max(Math.abs(required), Math.abs(available)) * 4;
}

function calculationBasis(recipe, targetServings, inventory) {
  return {
    recipeId: recipe?.id ?? null, recipeVersion: recipe?.version ?? null, targetServings,
    inventory: {
      scope: inventory?.scope ?? null, revision: inventory?.revision ?? null,
      asOf: inventory?.asOf ?? null, mealDate: inventory?.mealDate ?? null,
      basis: inventory?.basis ?? null, allocationRevision: inventory?.allocationRevision ?? null,
    },
  };
}

function emptyResult(basis) {
  return {
    status: 'needs-confirmation', scaleFactor: null, requirementsStatus: 'needs-confirmation',
    ingredients: [], limitingIngredients: [], checks: [], issues: [], basis,
  };
}

function validateAvailability(inventory) {
  if (!inventory || !Array.isArray(inventory.items)) return 'needs-confirmation';
  const ids = new Set();
  for (const item of inventory.items) {
    if (!item || !hasText(item.id) || ids.has(item.id)) return 'invalid';
    ids.add(item.id);
    if (item.amount !== null && item.amount !== undefined
      && (!Number.isFinite(item.amount) || item.amount < 0)) return 'invalid';
  }
  if (!hasText(inventory.scope) || !hasRevision(inventory.revision) || !timestamp(inventory.asOf)
    || !calendarDate(inventory.mealDate)) return 'needs-confirmation';
  if (inventory.basis === 'user-confirmed-for-meal') return 'confirmed';
  if (inventory.basis === 'allocated' && hasRevision(inventory.allocationRevision)) return 'confirmed';
  return 'needs-confirmation';
}

function availableQuantity(group, inventoryByFood) {
  if (!hasKnownText(group.foodId) || !hasKnownText(group.preparationState) || !hasKnownText(group.unit)) {
    return { amount: null, reason: 'identity-unknown' };
  }
  const foodItems = inventoryByFood.get(group.foodId) || [];
  if (foodItems.some((item) => item.availabilityStatus !== 'unavailable' && !hasKnownText(item.preparationState))) {
    return { amount: null, reason: 'identity-unknown' };
  }
  const items = foodItems.filter((item) => item.preparationState === group.preparationState);
  if (!items.length) return { amount: null, reason: 'not-recorded' };
  let amount = 0;
  for (const item of items) {
    // These are explicitly unavailable for this meal, not missing inventory.
    if (item.availabilityStatus === 'unavailable') continue;
    if (item.availabilityStatus !== 'available' || item.quantityStatus !== 'confirmed'
      || !timestamp(item.confirmedAt) || item.amount === null || item.amount === undefined) {
      return { amount: null, reason: 'quantity-unknown' };
    }
    if (item.unit !== group.unit) return { amount: null, reason: 'unit-mismatch' };
    amount += item.amount;
  }
  return { amount, reason: Number.isFinite(amount) ? null : 'numeric-range' };
}

function selectedLines(recipe, targetServings) {
  const servingFactor = targetServings / recipe.servings;
  return recipe.ingredients.filter((line) => line.selected).map((line) => ({
    lineId: line.id, foodId: line.foodId ?? null, rawName: line.rawName,
    section: line.section ?? null, preparationState: line.preparationState ?? null,
    role: line.role, required: line.required, unit: line.unit ?? null,
    quantityStatus: line.quantityStatus,
    requestedAmount: line.quantityStatus === 'verified' && positive(line.amount)
      && hasText(line.quantityEvidence) && hasKnownText(line.unit) ? line.amount * servingFactor : null,
    scaledAmount: null,
  }));
}

function groupRequirements(lines) {
  const groups = new Map();
  for (const line of lines) {
    // Unknown identities must not accidentally merge with one another.
    const key = hasKnownText(line.foodId) && hasKnownText(line.preparationState) && hasKnownText(line.unit)
      ? groupKey(line) : `unknown:${line.lineId}`;
    if (!groups.has(key)) {
      groups.set(key, {
        foodId: line.foodId, preparationState: line.preparationState, unit: line.unit,
        lineIds: [], core: false, required: false, requiredAmount: 0,
      });
    }
    const group = groups.get(key);
    group.lineIds.push(line.lineId);
    group.core ||= line.role === 'core';
    group.required ||= line.required;
    group.requiredAmount = group.requiredAmount === null || line.requestedAmount === null
      ? null : group.requiredAmount + line.requestedAmount;
  }
  return [...groups.values()];
}

function checkFor(group, availability, requiredAmount) {
  const known = requiredAmount !== null && availability.amount !== null;
  return {
    foodId: group.foodId, preparationState: group.preparationState, unit: group.unit,
    lineIds: [...group.lineIds], required: group.required, requiredAmount,
    availableAmount: availability.amount,
    missingAmount: known ? Math.max(0, requiredAmount - availability.amount) : null,
    reason: requiredAmount === null ? 'recipe-quantity-unknown'
      : availability.reason || 'insufficient',
  };
}

/**
 * Pure, read-only estimate. `inventory.items[].amount` is usable for this meal,
 * NOT a raw fridge total. A caller must supply either explicit user-confirmed
 * per-meal quantities or a versioned allocation snapshot. This module does not
 * allocate across meals, infer units, review source data, or write consumption.
 * `status` describes core quantities; always also inspect requirementsStatus.
 */
export function calculateScaledCooking({ recipe, targetServings, inventory } = {}) {
  const result = emptyResult(calculationBasis(recipe, targetServings, inventory));
  if (!positive(targetServings)) return { ...result, status: 'invalid', issues: [{ code: 'invalid_target_servings' }] };
  const validation = validateQuantityRecipe(recipe);
  if (validation.status !== 'eligible') {
    return { ...result, status: validation.status === 'invalid' ? 'invalid' : 'needs-confirmation', issues: validation.issues };
  }
  result.ingredients = selectedLines(recipe, targetServings);
  const snapshotStatus = validateAvailability(inventory);
  if (snapshotStatus !== 'confirmed') {
    return { ...result, status: snapshotStatus, issues: [{ code: 'availability_snapshot_unconfirmed' }] };
  }
  const inventoryByFood = new Map();
  for (const item of inventory.items) {
    if (!inventoryByFood.has(item.foodId)) inventoryByFood.set(item.foodId, []);
    inventoryByFood.get(item.foodId).push(item);
  }
  const groups = groupRequirements(result.ingredients).map((group) => ({
    ...group, availability: availableQuantity(group, inventoryByFood),
  }));
  if (groups.some((group) => (group.requiredAmount !== null && !positive(group.requiredAmount))
    || group.availability.reason === 'numeric-range')) {
    return { ...result, status: 'invalid', issues: [{ code: 'numeric_range' }] };
  }
  const coreGroups = groups.filter((group) => group.core);
  const unknownCore = coreGroups.filter((group) => group.availability.amount === null || group.requiredAmount === null);
  if (unknownCore.length) {
    result.checks = unknownCore.map((group) => checkFor(group, group.availability, group.requiredAmount));
    return result;
  }
  const limitingRatio = Math.min(...coreGroups.map((group) => group.availability.amount / group.requiredAmount));
  const scaleFactor = Math.min(1, limitingRatio);
  if (scaleFactor === 0 && coreGroups.every((group) => group.availability.amount > 0)) {
    return { ...result, status: 'invalid', issues: [{ code: 'numeric_range' }] };
  }
  const scaledIngredients = result.ingredients.map((line) => ({
    ...line, scaledAmount: line.requestedAmount === null ? null : line.requestedAmount * scaleFactor,
  }));
  if (scaleFactor > 0 && scaledIngredients.some((line) => line.requestedAmount !== null && !positive(line.scaledAmount))) {
    return { ...result, status: 'invalid', issues: [{ code: 'numeric_range' }] };
  }
  // No product cutoff and no display rounding in the calculation.
  result.scaleFactor = scaleFactor;
  result.status = scaleFactor === 0 ? 'unavailable' : scaleFactor < 1 ? 'scaled' : 'original';
  result.ingredients = scaledIngredients;
  result.limitingIngredients = limitingRatio <= 1 ? coreGroups
    .filter((group) => group.availability.amount / group.requiredAmount === limitingRatio)
    .map((group) => ({
      foodId: group.foodId, preparationState: group.preparationState, lineIds: [...group.lineIds],
      requiredAmount: group.requiredAmount, availableAmount: group.availability.amount, unit: group.unit,
    })) : [];
  result.checks = groups.flatMap((group) => {
    const requiredAmount = group.requiredAmount === null ? null : group.requiredAmount * scaleFactor;
    if (requiredAmount !== null && group.availability.amount !== null && !exceedsAvailable(requiredAmount, group.availability.amount)) return [];
    return [checkFor(group, group.availability, requiredAmount)];
  });
  const requiredChecks = result.checks.filter((check) => check.required);
  result.requirementsStatus = requiredChecks.some((check) => check.missingAmount === null) ? 'needs-confirmation'
    : requiredChecks.length || scaleFactor === 0 ? 'missing' : 'satisfied';
  return result;
}
