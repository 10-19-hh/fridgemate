import { getPlanningInventoryBasis } from './mealPlanningStock.js';

const hasText = (value) => typeof value === 'string' && value.trim().length > 0;
const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const validScope = (scope) => scope === 'guest' || (typeof scope === 'string' && /^user:[a-zA-Z0-9_-]+$/.test(scope));
const compareText = (left, right) => left < right ? -1 : left > right ? 1 : 0;
const DAY_MS = 24 * 60 * 60 * 1000;

function assert(condition, message = '식단과 정량 승인 자료의 형식을 확인할 수 없습니다.') {
  if (!condition) throw new TypeError(message);
}

function calendarDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? date : null;
}

function assertSlot(plan, slot) {
  assert(isRecord(slot));
  const date = calendarDate(slot.date);
  const day = date ? (date.getTime() - calendarDate(plan.weekStart).getTime()) / DAY_MS : -1;
  assert(Number.isInteger(day) && day >= 0 && day <= 6
    && slot.id === `${slot.date}:dinner` && slot.mealType === 'dinner'
    && ['planned', 'skipped', 'empty'].includes(slot.status)
    && typeof slot.locked === 'boolean' && [1, 2].includes(slot.servings)
    && (slot.templateKey === null || hasText(slot.templateKey))
    && (slot.templateVersion === null || (Number.isSafeInteger(slot.templateVersion) && slot.templateVersion > 0))
    && Array.isArray(slot.components) && slot.components.every(isRecord));
  getPlanningInventoryBasis([slot]);
}

function assertPlan(plan) {
  assert(isRecord(plan) && plan.schemaVersion === 1 && validScope(plan.scope));
  const start = calendarDate(plan.weekStart);
  assert(start && start.getUTCDay() === 1 && plan.id === `week:${plan.weekStart}`
    && Number.isSafeInteger(plan.revision) && plan.revision >= 1);
  const preferences = plan.preferences;
  assert(isRecord(preferences) && [1, 2].includes(preferences.servings)
    && Array.isArray(preferences.excludedIngredients)
    && preferences.excludedIngredients.every((name) => typeof name === 'string')
    && Array.isArray(preferences.dinnerDays)
    && preferences.dinnerDays.every((day) => Number.isInteger(day) && day >= 0 && day <= 6)
    && new Set(preferences.dinnerDays).size === preferences.dinnerDays.length
    && Array.isArray(plan.slots));
  // The repository checks its complete seven-day shape; reconciliation also
  // needs to represent a removed slot without treating it as a new approval.
  const ids = new Set();
  for (const slot of plan.slots) {
    assertSlot(plan, slot);
    assert(!ids.has(slot.id));
    ids.add(slot.id);
  }
  getPlanningInventoryBasis([plan]);
}

function slotBasis(plan, slot) {
  const day = (calendarDate(slot.date).getUTCDay() + 6) % 7;
  return getPlanningInventoryBasis([{
    id: slot.id, date: slot.date, mealType: slot.mealType, status: slot.status,
    servings: slot.servings, templateKey: slot.templateKey, templateVersion: slot.templateVersion,
    components: slot.components,
    excludedIngredients: [...plan.preferences.excludedIngredients].sort(compareText),
    dinnerIncluded: plan.preferences.dinnerDays.includes(day),
  }]);
}

/** Placement token, not approval: display text, locks and unrelated slots do not rebind it. */
export function getPlanningSlotBasis(plan, slot) {
  assertPlan(plan);
  assertSlot(plan, slot);
  return slotBasis(plan, slot);
}

function assertState(state, scope) {
  assert(isRecord(state) && state.id === 'state' && state.schemaVersion === 1
    && state.scope === scope && Number.isSafeInteger(state.revision) && state.revision >= 0
    && (state.stockInventoryBasis === null || typeof state.stockInventoryBasis === 'string')
    && Array.isArray(state.stockConfirmations) && Array.isArray(state.commitments));
  for (const commitment of state.commitments) {
    assert(isRecord(commitment) && hasText(commitment.planId) && hasText(commitment.slotId)
      && hasText(commitment.slotBasis) && ['active', 'suspended'].includes(commitment.status)
      && (commitment.scope === undefined || commitment.scope === scope));
  }
  getPlanningInventoryBasis([state]);
}

function menuBasis(slot) {
  return getPlanningInventoryBasis([{
    id: slot.id, templateKey: slot.templateKey, templateVersion: slot.templateVersion,
    components: slot.components,
  }]);
}

function assertLockedSlotsUnchanged(previousPlan, nextById) {
  for (const previousSlot of previousPlan.slots) {
    if (!previousSlot.locked) continue;
    const nextSlot = nextById.get(previousSlot.id);
    assert(nextSlot && !(nextSlot.status === 'skipped' && previousSlot.status !== 'skipped')
      && menuBasis(previousSlot) === menuBasis(nextSlot),
    '잠긴 메뉴는 먼저 잠금을 해제한 뒤 변경하거나 건너뛰어 주세요.');
  }
}

/**
 * Reconciles existing choices only; restoring a menu never restores approval.
 * No inventory, shopping list or persistence writes occur here.
 */
/** Persistence-boundary guard: a slot that stays locked cannot change menu or be skipped; unlocking first is allowed. */
export function assertPlanLocksPreserved(previousPlan, nextPlan) {
  const nextById = new Map(nextPlan.slots.map((slot) => [slot.id, slot]));
  for (const previousSlot of previousPlan.slots) {
    if (!previousSlot.locked) continue;
    const nextSlot = nextById.get(previousSlot.id);
    assert(nextSlot && (!nextSlot.locked || (nextSlot.status === previousSlot.status
      && menuBasis(previousSlot) === menuBasis(nextSlot))),
    '잠긴 메뉴는 먼저 잠금을 해제한 뒤 변경하거나 건너뛰어 주세요.');
  }
}

export function reconcilePlanningCommitments(state, previousPlan, nextPlan, { enforceLocks = true } = {}) {
  assertPlan(previousPlan);
  assertState(state, previousPlan.scope);
  let nextById;
  if (nextPlan !== null) {
    assertPlan(nextPlan);
    assert(nextPlan.id === previousPlan.id && nextPlan.scope === previousPlan.scope);
    nextById = new Map(nextPlan.slots.map((slot) => [slot.id, slot]));
    if (enforceLocks) assertLockedSlotsUnchanged(previousPlan, nextById);
  }

  const result = structuredClone(state);
  let changed = false;
  result.commitments = result.commitments.map((commitment) => {
    if (commitment.planId !== previousPlan.id || commitment.status !== 'active') return commitment;
    const nextSlot = nextById?.get(commitment.slotId);
    if (nextSlot && commitment.slotBasis === slotBasis(nextPlan, nextSlot)) return commitment;
    changed = true;
    return {
      ...commitment, status: 'suspended',
      suspensionReason: nextPlan === null ? 'plan_removed' : nextSlot?.status === 'skipped' ? 'skipped' : 'slot_changed',
    };
  });
  if (changed) {
    assert(Number.isSafeInteger(result.revision + 1), '정량 승인 자료의 변경 번호가 너무 큽니다.');
    result.revision += 1;
  }
  return result;
}
