import { calculateScaledCooking } from './scaledCooking.js';

/** One confirmation field per compatible ingredient, not per repeated source row. */
export function getQuantityInputs(recipe) {
  const { ingredients } = calculateScaledCooking({ recipe, targetServings: recipe?.servings });
  const groups = new Map();
  for (const line of ingredients) {
    const id = line.foodId && line.preparationState && line.unit
      ? JSON.stringify([line.foodId, line.preparationState, line.unit]) : `unknown:${line.lineId}`;
    if (!groups.has(id)) {
      groups.set(id, {
        id, foodId: line.foodId, preparationState: line.preparationState, unit: line.unit,
        label: line.rawName, lineIds: [], role: line.role, required: false, requestedAmount: 0,
      });
    }
    const group = groups.get(id);
    group.lineIds.push(line.lineId);
    if (line.role === 'core') group.role = 'core';
    group.required ||= line.required;
    group.requestedAmount = group.requestedAmount === null || line.requestedAmount === null
      ? null : group.requestedAmount + line.requestedAmount;
  }
  return [...groups.values()];
}

/** Called only after explicit confirmation; never parses legacy inventory strings. */
export function buildConfirmedAvailability({ inputs, amounts, scope, revision, confirmedAt, mealDate }) {
  const errors = [];
  const items = inputs.map((input) => {
    const raw = amounts[input.id];
    const text = typeof raw === 'string' ? raw.trim() : raw;
    let amount = null;
    if (input.requestedAmount !== null && input.unit && text != null && text !== '') {
      amount = typeof text === 'string' && /^(?:\d+(?:\.\d*)?|\.\d+)$/.test(text) ? Number(text) : NaN;
      if (!Number.isFinite(amount) || (amount === 0 && /[1-9]/.test(text))) {
        errors.push({ inputId: input.id, code: 'invalid_amount' });
      }
    }
    return {
      id: input.id, foodId: input.foodId, preparationState: input.preparationState,
      amount, unit: input.unit, quantityStatus: amount === null ? 'unknown' : 'confirmed',
      availabilityStatus: amount === null ? 'unknown' : 'available',
      confirmedAt: amount === null ? null : confirmedAt,
    };
  });
  return {
    inventory: errors.length ? null : {
      scope, revision, asOf: confirmedAt, mealDate, basis: 'user-confirmed-for-meal', items,
    },
    errors,
  };
}
