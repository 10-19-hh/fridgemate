const compareText = (left, right) => left < right ? -1 : left > right ? 1 : 0;
const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const hasText = (value) => typeof value === 'string' && value.trim().length > 0;
const hasRevision = (value) => hasText(value) || (Number.isSafeInteger(value) && value >= 0);
const nullableText = (value) => value == null || typeof value === 'string';
const validAmount = (value) => value == null || (Number.isFinite(value) && value >= 0);
const identityKey = (line) => JSON.stringify([line.foodId, line.preparationState, line.unit]);
const hasKnownText = (value) => typeof value === 'string' && value.trim().length > 0
  && !['unknown', 'unverified', '미확인'].includes(value.trim().toLowerCase());
const knownIdentity = (line) => ['foodId', 'preparationState', 'unit'].every((key) => hasKnownText(line[key]));
const compatible = (batch, group) => ['foodId', 'preparationState', 'unit']
  .every((key) => !hasKnownText(batch[key]) || batch[key] === group[key]);

function calendarDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function timestamp(value) {
  return typeof value === 'string'
    && /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(value)
    && calendarDate(value.slice(0, 10)) && Number.isFinite(Date.parse(value));
}

function validateInput({ scope, asOf, fromDate, inventory, meals }) {
  if (!hasText(scope) || !timestamp(asOf) || !calendarDate(fromDate)) return [{ code: 'invalid_context' }];
  if (!isRecord(inventory) || inventory.scope !== scope || !hasRevision(inventory.revision)
    || !Array.isArray(inventory.items) || !Array.isArray(meals)) return [{ code: 'invalid_inventory_or_meals' }];
  const inventoryIds = new Set();
  for (const item of inventory.items) {
    if (!isRecord(item) || !hasText(item.id) || !validAmount(item.amount)
      || !['foodId', 'preparationState', 'unit'].every((key) => nullableText(item[key]))
      || !['confirmed', 'unknown'].includes(item.quantityStatus)
      || !['available', 'unknown', 'unavailable'].includes(item.availabilityStatus)
      || !['dated', 'no-expiry', 'unknown'].includes(item.expiryStatus)
      || (item.expiryDate != null && !calendarDate(item.expiryDate))
      || (item.expiryStatus === 'dated' && !calendarDate(item.expiryDate))
      || (item.expiryStatus === 'no-expiry' && item.expiryDate != null)
      || (item.confirmedAt != null && !timestamp(item.confirmedAt))) return [{ code: 'invalid_inventory_item' }];
    if (inventoryIds.has(item.id)) return [{ code: 'duplicate_inventory_id', inventoryId: item.id }];
    inventoryIds.add(item.id);
  }
  const mealIds = new Set();
  const planVersions = new Map();
  for (const meal of meals) {
    if (!isRecord(meal) || !['id', 'planId', 'slotId', 'componentId', 'recipeId', 'recipeVersion'].every((key) => hasText(meal[key]))
      || meal.scope !== scope || !hasRevision(meal.planRevision) || !calendarDate(meal.date)
      || meal.mealType !== 'dinner' || typeof meal.locked !== 'boolean'
      || !['confirmed', 'draft', 'skipped', 'cooked', 'archived'].includes(meal.status)
      || !Array.isArray(meal.demands)) return [{ code: 'invalid_meal' }];
    if (mealIds.has(meal.id)) return [{ code: 'duplicate_meal_id', mealId: meal.id }];
    mealIds.add(meal.id);
    if (planVersions.has(meal.planId) && planVersions.get(meal.planId) !== meal.planRevision) return [{ code: 'conflicting_plan_revision', planId: meal.planId }];
    planVersions.set(meal.planId, meal.planRevision);
    const lineIds = new Set();
    for (const line of meal.demands) {
      if (!isRecord(line) || !hasText(line.lineId) || !validAmount(line.amount)
        || !['foodId', 'preparationState', 'unit'].every((key) => nullableText(line[key]))
        || !['verified', 'unknown'].includes(line.quantityStatus)
        || typeof line.required !== 'boolean' || typeof line.selected !== 'boolean') return [{ code: 'invalid_demand', mealId: meal.id }];
      if (lineIds.has(line.lineId)) return [{ code: 'duplicate_line_id', mealId: meal.id, lineId: line.lineId }];
      lineIds.add(line.lineId);
    }
  }
  return [];
}

function addQuantity(left, right) {
  const sum = left + right;
  if (!Number.isFinite(sum) || (left > 0 && right > 0 && (sum === left || sum === right))) throw new RangeError('numeric_range');
  return sum;
}

function subtractQuantity(left, right) {
  const difference = left - right;
  // Reject a reservation that Number cannot subtract; never silently keep it free.
  if (!Number.isFinite(difference) || difference < 0 || (right > 0 && difference === left)) throw new RangeError('numeric_range');
  return difference;
}

function groupDemands(demands) {
  const groups = new Map();
  for (const line of demands.filter((line) => line.selected)) {
    const key = knownIdentity(line) ? identityKey(line) : `unknown:${line.lineId}`;
    if (!groups.has(key)) groups.set(key, {
      foodId: line.foodId, preparationState: line.preparationState, unit: line.unit,
      lineIds: [], required: false, lines: [],
    });
    const group = groups.get(key);
    group.lineIds.push(line.lineId);
    group.required ||= line.required;
    group.lines.push(line);
  }
  return [...groups.values()].map(({ lines, ...group }) => ({ ...group,
    requiredAmount: lines.some((line) => line.quantityStatus !== 'verified' || line.amount == null) ? null
      : [...lines].sort((left, right) => compareText(left.lineId, right.lineId)).reduce((sum, line) => addQuantity(sum, line.amount), 0),
  }));
}

function batchState(batch, date, asOf) {
  if (batch.expiryStatus === 'dated' && batch.expiryDate < date) return 'expired';
  if (batch.availabilityStatus === 'unavailable') return 'zero';
  if (!knownIdentity(batch)) return 'identity-unknown';
  if (batch.quantityStatus !== 'confirmed' || batch.amount == null || !batch.confirmedAt
    || !Number.isFinite(Date.parse(batch.confirmedAt)) || Date.parse(batch.confirmedAt) > Date.parse(asOf)) return 'quantity-unknown';
  if (batch.amount === 0) return 'zero';
  if (batch.availabilityStatus !== 'available') return 'availability-unknown';
  if (batch.expiryStatus === 'unknown') return 'expiry-unknown';
  return 'available';
}

function allocateRequirement(group, batches, date, asOf, blocked) {
  const reasons = new Set();
  if (group.requiredAmount === null) reasons.add('demand-unknown');
  if (!knownIdentity(group)) reasons.add('identity-unknown');
  if (blocked) reasons.add('earlier-demand-unknown');
  if (reasons.size) return { ...group, allocatedAmount: 0, missingAmount: null,
    status: 'needs-confirmation', allocations: [], reasons: [...reasons] };
  if (group.requiredAmount === 0) return { ...group, allocatedAmount: 0, missingAmount: 0,
    status: 'sufficient', allocations: [], reasons: [] };

  const candidates = batches.filter((batch) => compatible(batch, group)
    && (knownIdentity(batch) || batch.availabilityStatus !== 'unavailable'));
  if (!candidates.length) reasons.add('not-recorded');
  let remaining = group.requiredAmount;
  let allocatedAmount = 0;
  const allocations = [];
  for (const batch of candidates) {
    const state = batchState(batch, date, asOf);
    if (state === 'zero') continue;
    if (state !== 'available') {
      reasons.add(state);
      continue;
    }
    const amount = Math.min(remaining, batch.remaining);
    if (amount <= 0) continue;
    allocations.push({ inventoryId: batch.id, amount });
    remaining = subtractQuantity(remaining, amount);
    allocatedAmount = addQuantity(allocatedAmount, amount);
    batch.remaining = subtractQuantity(batch.remaining, amount);
  }
  const status = reasons.size ? 'needs-confirmation' : remaining > 0 ? 'shortage' : 'sufficient';
  if (status === 'shortage') reasons.add('insufficient');
  return { ...group, allocatedAmount, missingAmount: status === 'needs-confirmation' ? null : remaining,
    status, allocations, reasons: [...reasons] };
}

/** Reserves quantities in memory only; never changes physical stock or menus. */
export function allocatePlannedMeals(input) {
  const { scope, asOf, fromDate, inventory, meals = [] } = isRecord(input) ? input : {};
  const basis = { scope: hasText(scope) ? scope : null, asOf: hasText(asOf) ? asOf : null,
    fromDate: hasText(fromDate) ? fromDate : null, inventoryRevision: hasRevision(inventory?.revision) ? inventory.revision : null,
    planVersions: [] };
  const issues = validateInput({ scope, asOf, fromDate, inventory, meals });
  if (issues.length) return { status: 'invalid', issues, basis, meals: [] };
  const plans = new Map(meals.map((meal) => [meal.planId, meal.planRevision]));
  basis.planVersions = [...plans].sort(([left], [right]) => compareText(left, right)).map(([id, revision]) => ({ id, revision }));
  try {
    return { status: 'calculated', issues: [], basis, meals: allocateValidMeals({ asOf, fromDate, inventory, meals }) };
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
    return { status: 'invalid', issues: [{ code: 'numeric_range' }], basis, meals: [] };
  }
}

function allocateValidMeals({ asOf, fromDate, inventory, meals }) {
  const batches = inventory.items.map((item) => ({ ...item, remaining: item.amount }))
    .sort((left, right) => {
      const leftDated = left.expiryStatus === 'dated';
      const rightDated = right.expiryStatus === 'dated';
      if (leftDated !== rightDated) return leftDated ? -1 : 1;
      return (leftDated ? compareText(left.expiryDate, right.expiryDate) : 0) || compareText(left.id, right.id);
    });
  const totals = new Map();
  for (const item of batches) {
    if (!knownIdentity(item) || item.quantityStatus !== 'confirmed' || item.availabilityStatus !== 'available' || item.amount == null) continue;
    const key = identityKey(item);
    totals.set(key, addQuantity(totals.get(key) ?? 0, item.amount));
  }
  const active = meals.filter((meal) => meal.status === 'confirmed' && meal.date >= fromDate)
    .sort((left, right) => compareText(left.date, right.date) || compareText(left.id, right.id));
  const blockedFoods = new Set();
  let allBlocked = false;
  const allocatedMeals = active.map((meal) => {
    const groups = groupDemands(meal.demands);
    // A meal's ingredient order must not change how its unknown demand blocks stock.
    for (const group of groups) {
      if (!knownIdentity(group) || group.requiredAmount === null) {
        if (hasKnownText(group.foodId)) blockedFoods.add(group.foodId);
        else allBlocked = true;
      }
    }
    return {
      id: meal.id, planId: meal.planId, planRevision: meal.planRevision, slotId: meal.slotId,
      componentId: meal.componentId, date: meal.date, recipeId: meal.recipeId, recipeVersion: meal.recipeVersion,
      requirements: groups.map((group) => allocateRequirement(group, batches, meal.date, asOf, allBlocked || blockedFoods.has(group.foodId))),
    };
  });
  return allocatedMeals;
}
