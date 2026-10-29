import {
  createInventoryQuantityReview, projectInventoryQuantity, validateInventoryQuantityValues,
} from './inventoryQuantityDomain';

const INVALID = '소비 요청 또는 기록의 형식을 확인해주세요.';
const STALE = '재고가 바뀌었거나 수량 확인이 필요합니다. 목록을 새로고침해주세요.';
const UNIT_FACTORS = { g: 1, kg: 1000, ml: 1, l: 1000, 개: 1 };
const CANONICAL_UNITS = { g: 'g', kg: 'g', ml: 'ml', l: 'ml', 개: '개' };
const TOKEN = /^[A-Za-z0-9_-]{1,120}$/;
const text = value => typeof value === 'string' && value.trim().length > 0;

function assertMetadata({ scope, operationId, slotId, now } = {}) {
  const date = typeof slotId === 'string' ? slotId.slice(0, 10) : '';
  const midnight = new Date(`${date}T00:00:00.000Z`);
  if (typeof scope !== 'string' || (scope !== 'guest' && !/^user:[A-Za-z0-9_-]+$/.test(scope))
    || typeof operationId !== 'string' || !TOKEN.test(operationId)
    || typeof slotId !== 'string' || !/^\d{4}-\d{2}-\d{2}:dinner$/.test(slotId)
    || !Number.isFinite(midnight.getTime()) || midnight.toISOString().slice(0, 10) !== date
    || typeof now !== 'string' || !Number.isFinite(Date.parse(now)) || new Date(now).toISOString() !== now) {
    throw new Error(INVALID);
  }
}

function assertUnique(items, getId) {
  if (!Array.isArray(items) || items.length === 0) throw new Error(INVALID);
  const ids = new Set();
  // Iteration (not map/every alone) also rejects holes in sparse arrays.
  for (const item of items) {
    const id = getId(item);
    if (!text(id) || ids.has(id)) throw new Error(INVALID);
    ids.add(id);
  }
}

function quantity(values, positive = false) {
  const checked = validateInventoryQuantityValues(values);
  if (positive && checked.amount <= 0) throw new Error(INVALID);
  return { ...checked, unit: CANONICAL_UNITS[checked.unit],
    integerAmount: Math.round(checked.amount * UNIT_FACTORS[checked.unit] * 1000) };
}

function currentStock(entry, scope) {
  if (!entry?.ingredient) throw new Error(STALE);
  const current = projectInventoryQuantity(entry.ingredient, entry.review, scope);
  if (current.quantityStatus !== 'verified' || current.quantityRevision !== entry.expectedRevision
    || current.sourceToken !== entry.expectedSourceToken) throw new Error(STALE);
  return quantity(entry.review);
}

function changedStock(entry, current, integerAmount, scope, now) {
  if (!Number.isSafeInteger(integerAmount) || integerAmount < 0) {
    throw new Error('사용량이 남은 재고보다 많거나 지원하는 수량 범위를 벗어났습니다.');
  }
  const amount = integerAmount / 1000;
  const ingredient = { ...entry.ingredient, quantity: `${amount}${current.unit}`, updatedAt: now,
    syncState: entry.ingredient.syncState === 'pendingCreate' ? 'pendingCreate' : 'pendingUpdate' };
  const review = createInventoryQuantityReview({ ingredient, scope, now, revision: entry.review.revision + 1,
    values: { name: current.name, amount, unit: current.unit, preparationState: current.preparationState } });
  // A zero verified quantity is not the old boolean "repurchase this item" action.
  return { ingredient, review };
}

function eventHeader(kind, { scope, operationId, slotId, now }) {
  return { schemaVersion: 1, kind, id: `${kind}:${operationId}`, scope, operationId, slotId, createdAt: now };
}

/** Pure preparation only: callers must atomically persist stock, reviews, meal state
 * and events, and enforce idempotency in that transaction before applying anything. */
export function prepareConsumption(input) {
  assertMetadata(input);
  assertUnique(input.changes, entry => entry?.ingredient?.id);
  const lines = [];
  const changes = input.changes.map(entry => {
    const current = currentStock(entry, input.scope);
    const used = quantity({ name: current.name, preparationState: current.preparationState,
      amount: entry.amount, unit: entry.unit }, true);
    if (used.unit !== current.unit) throw new Error('사용량과 재고의 단위가 호환되지 않습니다.');
    const next = changedStock(entry, current, current.integerAmount - used.integerAmount, input.scope, input.now);
    lines.push({ inventoryId: entry.ingredient.id, ingredientKey: current.ingredientKey, name: current.name,
      amount: used.integerAmount / 1000, unit: used.unit, preparationState: current.preparationState });
    return next;
  });
  return { changes, event: { ...eventHeader('consumption', input), lines } };
}

function assertConsumptionEvent(event, scope) {
  if (!event || event.schemaVersion !== 1 || event.kind !== 'consumption' || event.scope !== scope
    || event.id !== `consumption:${event.operationId}`) throw new Error(INVALID);
  assertMetadata({ ...event, now: event.createdAt });
  assertUnique(event.lines, line => line?.inventoryId);
  for (const line of event.lines) {
    const checked = quantity(line, true);
    if (line.ingredientKey !== checked.ingredientKey || line.unit !== checked.unit) throw new Error(INVALID);
  }
}

/** Add the inverse delta to current compatible batches, never restore a snapshot.
 * This function alone does not prevent applying the same reversal twice. */
export function prepareConsumptionReversal(input) {
  assertMetadata({ ...input, slotId: input?.originalEvent?.slotId });
  assertConsumptionEvent(input.originalEvent, input.scope);
  assertUnique(input.inventory, entry => entry?.ingredient?.id);
  const byId = new Map(input.inventory.map(entry => [entry.ingredient.id, entry]));
  const changes = input.originalEvent.lines.map(line => {
    const entry = byId.get(line.inventoryId);
    const current = currentStock(entry, input.scope);
    const delta = quantity(line, true);
    if (current.ingredientKey !== delta.ingredientKey || current.preparationState !== delta.preparationState
      || current.unit !== delta.unit) throw new Error(STALE);
    return changedStock(entry, current, current.integerAmount + delta.integerAmount, input.scope, input.now);
  });
  return { changes, event: { ...eventHeader('consumption-reversal', { ...input, slotId: input.originalEvent.slotId }),
    reversesId: input.originalEvent.id, lines: input.originalEvent.lines.map(line => ({ ...line })) } };
}
