import { getMealQuantityRequirements } from './mealQuantityDomain.js';

const UNITS = new Map([['g', ['g', 1]], ['kg', ['g', 1000]], ['ml', ['ml', 1]], ['l', ['ml', 1000]], ['개', ['개', 1]]]);
const PREPARATIONS = new Set(['raw', 'cooked', 'as-sold']);
const PRECISION = 1000;
const hasText = (value) => typeof value === 'string' && Boolean(value.trim());
const canonicalUnit = (unit) => UNITS.get(unit)?.[0] ?? null;
const identity = (item) => JSON.stringify([item.ingredientKey, item.preparationState, item.unit]);

function isDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function integerAmount(amount, factor = 1) {
  if (!Number.isFinite(amount) || amount < 0) return null;
  const scaled = amount * factor * PRECISION;
  const integer = Math.round(scaled);
  const tolerance = Math.min(1e-7, Number.EPSILON * Math.max(1, Math.abs(scaled)) * 4);
  if ((amount > 0 && integer === 0) || !Number.isSafeInteger(integer)
    || Math.abs(integer - scaled) > tolerance
    || Math.round((integer / PRECISION) * PRECISION) !== integer) return null;
  return integer;
}

function displayAmount(integer) {
  const amount = integer / PRECISION;
  if (!Number.isSafeInteger(integer) || Math.round(amount * PRECISION) !== integer) {
    throw new RangeError('Planning quantity exceeds supported precision.');
  }
  return amount;
}

function validateInput({ scope, confirmedPlans, inventory, today }) {
  if (typeof scope !== 'string' || (scope !== 'guest' && !/^user:[a-zA-Z0-9_-]+$/.test(scope))) throw new TypeError('Invalid planning scope.');
  if (!isDate(today) || !Array.isArray(confirmedPlans) || !Array.isArray(inventory)) throw new TypeError('Invalid planning snapshot.');
  const weeks = new Set();
  const slots = new Set();
  for (const plan of confirmedPlans) {
    if (!plan || plan.scope !== scope || !isDate(plan.weekStart) || weeks.has(plan.weekStart)
      || !Array.isArray(plan.slots)) throw new TypeError('Invalid or duplicate confirmed plan.');
    weeks.add(plan.weekStart);
    for (const slot of plan.slots) {
      if (!slot || !isDate(slot.date) || slot.id !== `${slot.date}:dinner` || slots.has(slot.id)
        || !['planned', 'skipped', 'empty', 'cooked'].includes(slot.status)) throw new TypeError('Invalid or duplicate confirmed slot.');
      slots.add(slot.id);
    }
  }
  const ids = new Set();
  for (const item of inventory) {
    if (!item || !hasText(item.id) || ids.has(item.id)) throw new TypeError('Invalid or duplicate inventory batch.');
    if (item.scope !== undefined && item.scope !== scope) throw new TypeError('Inventory scope does not match the plan.');
    ids.add(item.id);
  }
}

function prepareBatch(item) {
  const unit = UNITS.get(item.unit);
  const amount = unit ? integerAmount(item.amount, unit[1]) : null;
  const verified = item.quantityStatus === 'verified' && hasText(item.quantityEvidence)
    && hasText(item.ingredientKey) && PREPARATIONS.has(item.preparationState) && amount !== null;
  return { ...item, unit: unit?.[0] ?? null, remaining: verified ? amount : null, verified };
}

// Unknown dimensions are wildcards, not interchangeable quantities.
function mayUse(mask, requirement) {
  if (!hasText(mask.ingredientKey)) return true;
  return mask.ingredientKey === requirement.ingredientKey
    && (!PREPARATIONS.has(mask.preparationState) || mask.preparationState === requirement.preparationState)
    && (!canonicalUnit(mask.unit) || canonicalUnit(mask.unit) === requirement.unit);
}

function batchReviewReason(batch, requirement, date) {
  if (!batch.verified) return 'inventory-unverified';
  if (batch.preparationState !== requirement.preparationState || batch.unit !== requirement.unit) return 'inventory-incompatible';
  if (!isDate(batch.expiryDate)) return 'inventory-expiry-unknown';
  if (batch.expiryDate < date) return 'inventory-expired';
  return null;
}

function combinedStatus(statuses) {
  if (statuses.includes('needs-review')) return 'needs-review';
  return statuses.includes('shortage') ? 'shortage' : 'sufficient';
}

/**
 * A read-only allocation of explicit confirmed snapshots, not an inventory write.
 * Raw quantity strings and pantry ownership are deliberately never parsed here.
 * Only evidence-bearing compatible batches can support a numeric allocation.
 */
export function allocateMealPlanInventory(input) {
  validateInput(input);
  const { confirmedPlans, inventory, today } = input;
  const batches = inventory.filter((item) => !item.deletedAt && !item.consumed).map(prepareBatch)
    .sort((a, b) => (isDate(a.expiryDate) ? a.expiryDate : '').localeCompare(isDate(b.expiryDate) ? b.expiryDate : '') || a.id.localeCompare(b.id));
  const plannedSlots = confirmedPlans.flatMap((plan) => plan.slots)
    .filter((slot) => slot.status === 'planned')
    .sort((a, b) => a.date.localeCompare(b.date));
  const masks = [];
  const shortageGroups = new Map();
  const shopping = { source: 'plan', shortages: [], needsReview: [], optional: [] };
  const slots = plannedSlots.map((slot) => {
    const overdue = slot.date < today;
    const quantity = getMealQuantityRequirements(slot, slot.servings);
    const sourceLines = slot.components.flatMap((component) => component.ingredients.map((line) => ({ componentId: component.id, line })));
    const getLine = (ref) => sourceLines.find((item) => item.componentId === ref.componentId && item.line.id === ref.lineId)?.line;
    const context = { slotId: slot.id, date: slot.date, title: slot.title };
    const review = (item) => shopping.needsReview.push({ ...context, ingredientKey: null, unit: null, preparationState: null, knownAmount: null, ...item });
    // This is a conservative hold against the current snapshot, not proof of
    // which batch was allocated or consumed on the original meal date.
    if (overdue) review({ label: slot.title, reason: 'overdue-meal-unconfirmed' });
    // Process-only inputs are outside the measured food-row contract. They must
    // remain visible, and unknown uses may not make later stock look sufficient.
    const processInputs = slot.components.flatMap((component) => {
      if (component.processInputs === undefined) return [];
      if (!Array.isArray(component.processInputs)) throw new TypeError('Invalid process inputs.');
      // Array.from exposes sparse rows rather than silently skipping unknown demand.
      return Array.from(component.processInputs).flatMap((line) => {
        if (!line || typeof line !== 'object' || Array.isArray(line) || !hasText(line.name)) {
          throw new TypeError('Invalid process input.');
        }
        return line.optional === true && line.selected !== true ? [] : [{ componentId: component.id, line }];
      });
    });
    for (const { componentId, line } of processInputs) {
      masks.push(line);
      review({ componentId, lineId: line.id, label: line.name || '조리 과정 재료',
        ingredientKey: line.ingredientKey ?? null, unit: canonicalUnit(line.unit),
        preparationState: PREPARATIONS.has(line.preparationState) ? line.preparationState : null,
        reason: 'process-quantity-unverified' });
    }
    for (const { componentId, line } of sourceLines) {
      if (!overdue && line.optional === true && line.selected !== true) shopping.optional.push({ ...context, componentId, lineId: line.id, label: line.rawName || '이름 확인 필요' });
    }
    // Collect every unknown row before allocating: source order cannot decide availability.
    for (const ref of quantity.unverifiedLines) {
      const line = getLine(ref);
      masks.push(line);
      // Keep unresolved source rows separate. Compatible subtotals remain in
      // requirements; a wildcard is not evidence linking a row to one subtotal.
      review({ ...ref, label: line.rawName || '이름 확인 필요', ingredientKey: line.ingredientKey ?? null,
        unit: canonicalUnit(line.unit), preparationState: PREPARATIONS.has(line.preparationState) ? line.preparationState : null });
    }
    if (!quantity.requirements.length && !quantity.unverifiedLines.length) {
      review({ label: slot.title, reason: 'no-reviewed-requirements' });
    }
    const requirements = quantity.requirements.map((requirement) => {
      const label = getLine(requirement.sourceLines[0])?.rawName || requirement.ingredientKey;
      const required = requirement.amount === null ? null : integerAmount(requirement.amount);
      let remaining = required;
      const allocations = [];
      const reasons = new Set();
      const blocked = masks.some((mask) => mayUse(mask, requirement));
      if (blocked && required !== 0) reasons.add('prior-demand-unverified');
      if (required !== null && !blocked) {
        for (const batch of batches) {
          if (remaining === 0) break;
          // No recommendation aliases or raw-name similarity establish this identity.
          if (hasText(batch.ingredientKey) && batch.ingredientKey !== requirement.ingredientKey) continue;
          if (batch.verified && batch.remaining === 0) continue;
          const reason = batchReviewReason(batch, requirement, slot.date);
          if (reason) { reasons.add(reason); continue; }
          const allocated = Math.min(remaining, batch.remaining);
          if (allocated > 0) {
            batch.remaining -= allocated;
            remaining -= allocated;
            allocations.push({ inventoryId: batch.id, amount: displayAmount(allocated) });
          }
        }
      }
      const needsReview = remaining !== 0 && (required === null || reasons.size > 0);
      const status = overdue || needsReview ? 'needs-review' : remaining > 0 ? 'shortage' : 'sufficient';
      const shortageAmount = overdue || needsReview ? null : displayAmount(remaining);
      if (needsReview && required !== null) {
        for (const reason of reasons) review({ label, reason, ingredientKey: requirement.ingredientKey,
          unit: requirement.unit, preparationState: requirement.preparationState, uncoveredAmount: displayAmount(remaining) });
      }
      if (shortageAmount > 0) {
        const key = identity(requirement);
        const group = shortageGroups.get(key) || { ingredientKey: requirement.ingredientKey, label,
          preparationState: requirement.preparationState, unit: requirement.unit, integerAmount: 0, slotIds: [] };
        group.integerAmount += remaining;
        if (!Number.isSafeInteger(group.integerAmount)) throw new RangeError('Shopping quantity exceeds supported precision.');
        group.slotIds.push(slot.id);
        shortageGroups.set(key, group);
      }
      if (overdue) reasons.add('overdue-meal-unconfirmed');
      return { ...requirement, label, requiredAmount: requirement.amount,
        allocatedAmount: required === null ? 0 : displayAmount(required - remaining),
        shortageAmount, uncoveredAmount: remaining === null ? null : displayAmount(remaining),
        allocations, status, reasons: [...reasons] };
    });
    return { id: slot.id, date: slot.date, title: slot.title, overdue, requirements,
      status: combinedStatus([overdue || quantity.status === 'needs-review' || processInputs.length ? 'needs-review' : 'sufficient', ...requirements.map((req) => req.status)]) };
  });
  shopping.shortages = [...shortageGroups.values()].map(({ integerAmount: amount, ...group }) => ({ ...group, amount: displayAmount(amount) }));
  return { today, status: slots.length ? combinedStatus(slots.map((slot) => slot.status)) : 'empty', slots, shopping };
}
