import { validateInventoryQuantityValues } from './inventoryQuantityDomain';

const INVALID = '저장된 조리·소비 기록의 형식 또는 범위를 확인해주세요. 기존 기록은 지우지 않았어요.';
const KINDS = ['cooking', 'consumption', 'consumption-reversal', 'cooking-reversal'];
const TOKEN = /^[A-Za-z0-9_-]{1,120}$/;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = value => typeof value === 'string' && Boolean(value.trim());
const token = value => typeof value === 'string' && TOKEN.test(value);
const link = (value, kind) => typeof value === 'string' && value.startsWith(`${kind}:`)
  && token(value.slice(kind.length + 1));

function day(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? date : null;
}

function assertLines(lines, allowEmpty = false) {
  if (!Array.isArray(lines) || (!allowEmpty && lines.length === 0)) throw new Error(INVALID);
  const ids = new Set();
  for (const line of lines) {
    if (!object(line) || !text(line.inventoryId) || ids.has(line.inventoryId)
      || !['g', 'ml', '개'].includes(line.unit) || !(line.amount > 0)) throw new Error(INVALID);
    const checked = validateInventoryQuantityValues(line);
    if (checked.ingredientKey !== line.ingredientKey) throw new Error(INVALID);
    ids.add(line.inventoryId);
  }
}

// This routes a namespace, not a valid event. Bad suffixes still reach validation.
export function isMealCookingEventId(id) {
  return typeof id === 'string' && KINDS.some(kind => id.startsWith(`${kind}:`));
}

/** Validate a local event without mutating its historical payload. Request keys
 * contain private request data; never send them to analytics or application logs. */
export function assertMealCookingEvent(event, scope) {
  if (!object(event) || event.schemaVersion !== 1 || !KINDS.includes(event.kind)
    || typeof scope !== 'string' || (scope !== 'guest' && !/^user:[A-Za-z0-9_-]+$/.test(scope))
    || event.scope !== scope || !token(event.operationId) || event.id !== `${event.kind}:${event.operationId}`
    || Object.hasOwn(event, 'purchaseNoteId')
    || typeof event.slotId !== 'string' || !/^\d{4}-\d{2}-\d{2}:dinner$/.test(event.slotId)
    || typeof event.createdAt !== 'string' || !Number.isFinite(Date.parse(event.createdAt))
    || new Date(event.createdAt).toISOString() !== event.createdAt || !text(event.requestKey)) throw new Error(INVALID);
  const slotDay = day(event.slotId.slice(0, 10));
  const week = day(event.weekStart);
  if (!slotDay || !week || week.getUTCDay() !== 1 || slotDay < week
    || slotDay.getTime() - week.getTime() >= 7 * 86400000) throw new Error(INVALID);
  let request;
  try { request = JSON.parse(event.requestKey); } catch { throw new Error(INVALID); }
  if (!object(request)) throw new Error(INVALID);
  if ((Object.hasOwn(event, 'replacesId') && event.kind !== 'consumption')
    || (Object.hasOwn(event, 'replacementConsumptionId') && event.kind !== 'consumption-reversal')) throw new Error(INVALID);

  if (event.kind === 'cooking') {
    if (!['applied', 'needs-review'].includes(event.inventoryStatus)
      || event.consumptionId !== (event.inventoryStatus === 'applied' ? `consumption:${event.operationId}` : null)) throw new Error(INVALID);
  } else if (event.kind === 'consumption') {
    const replacement = Object.hasOwn(event, 'replacesId');
    if (replacement ? (!link(event.cookingId, 'cooking') || !link(event.replacesId, 'consumption') || event.replacesId === event.id)
      : event.cookingId !== `cooking:${event.operationId}`) throw new Error(INVALID);
    assertLines(event.lines, replacement);
  } else if (event.kind === 'consumption-reversal') {
    if (!link(event.cookingId, 'cooking') || !link(event.reversesId, 'consumption')
      || (Object.hasOwn(event, 'replacementConsumptionId')
        && event.replacementConsumptionId !== `consumption:${event.operationId}`)) throw new Error(INVALID);
    // Empty inverses are valid only when history confirms a zero-use replacement.
    assertLines(event.lines, true);
  } else if (!link(event.reversesId, 'cooking')) throw new Error(INVALID);
  return event;
}

function sameStoredValue(left, right) {
  if (Object.is(left, right)) return true;
  if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object'
    || Array.isArray(left) !== Array.isArray(right)) return false;
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length
    && keys.every(key => Object.hasOwn(right, key) && sameStoredValue(left[key], right[key]));
}

function sameMeal(left, right) {
  return left.scope === right.scope && left.weekStart === right.weekStart && left.slotId === right.slotId;
}

function inspectMealCookingHistory(events, scope) {
  if (!Array.isArray(events) || typeof scope !== 'string'
    || (scope !== 'guest' && !/^user:[A-Za-z0-9_-]+$/.test(scope))) throw new Error(INVALID);
  const byId = new Map();
  for (const event of events) {
    assertMealCookingEvent(event, scope);
    if (byId.has(event.id)) throw new Error(INVALID);
    byId.set(event.id, event);
  }
  const inverses = new Map();
  const cancellations = new Map();
  for (const event of events) {
    if (event.kind === 'cooking' && event.inventoryStatus === 'applied') {
      const consumption = byId.get(event.consumptionId);
      if (consumption?.kind !== 'consumption' || consumption.cookingId !== event.id
        || !sameMeal(consumption, event) || consumption.operationId !== event.operationId
        || consumption.requestKey !== event.requestKey || Object.hasOwn(consumption, 'replacesId')) throw new Error(INVALID);
    } else if (event.kind === 'consumption') {
      const cooking = byId.get(event.cookingId);
      if (cooking?.kind !== 'cooking' || cooking.inventoryStatus !== 'applied' || !sameMeal(cooking, event)) throw new Error(INVALID);
      if (Object.hasOwn(event, 'replacesId')) {
        const previous = byId.get(event.replacesId);
        const inverse = byId.get(`consumption-reversal:${event.operationId}`);
        if (previous?.kind !== 'consumption' || previous.cookingId !== cooking.id || !sameMeal(previous, event)
          || inverse?.kind !== 'consumption-reversal' || inverse.reversesId !== previous.id
          || inverse.replacementConsumptionId !== event.id || inverse.cookingId !== cooking.id
          || !sameMeal(inverse, event) || inverse.requestKey !== event.requestKey) throw new Error(INVALID);
      } else if (cooking.consumptionId !== event.id || cooking.operationId !== event.operationId
        || cooking.requestKey !== event.requestKey) throw new Error(INVALID);
    } else if (event.kind === 'consumption-reversal') {
      const consumption = byId.get(event.reversesId);
      const cooking = byId.get(event.cookingId);
      if (consumption?.kind !== 'consumption' || cooking?.kind !== 'cooking'
        || consumption.cookingId !== cooking.id || !sameMeal(consumption, event) || !sameMeal(cooking, event)
        || inverses.has(consumption.id) || consumption.lines.length !== event.lines.length) throw new Error(INVALID);
      const originalLines = new Map(consumption.lines.map(line => [line.inventoryId, line]));
      if (!event.lines.every(line => sameStoredValue(line, originalLines.get(line.inventoryId)))) throw new Error(INVALID);
      if (Object.hasOwn(event, 'replacementConsumptionId')) {
        const replacement = byId.get(event.replacementConsumptionId);
        if (replacement?.kind !== 'consumption' || replacement.replacesId !== consumption.id
          || replacement.cookingId !== cooking.id || !sameMeal(replacement, event)
          || replacement.operationId !== event.operationId || replacement.requestKey !== event.requestKey) throw new Error(INVALID);
      }
      inverses.set(consumption.id, event);
    } else if (event.kind === 'cooking-reversal') {
      const cooking = byId.get(event.reversesId);
      if (cooking?.kind !== 'cooking' || !sameMeal(cooking, event) || cancellations.has(cooking.id)) throw new Error(INVALID);
      cancellations.set(cooking.id, event);
    }
  }
  const activeSlots = new Set();
  const reached = new Set();
  const states = new Map();
  for (const event of events) {
    if (event.kind !== 'cooking') continue;
    let consumption = byId.get(event.consumptionId) || null;
    while (consumption) {
      if (reached.has(consumption.id)) throw new Error(INVALID);
      reached.add(consumption.id);
      const inverse = inverses.get(consumption.id);
      if (!inverse?.replacementConsumptionId) break;
      consumption = byId.get(inverse.replacementConsumptionId);
    }
    const reversal = consumption ? inverses.get(consumption.id) || null : null;
    const cancelled = cancellations.has(event.id);
    if (cancelled) {
      if (consumption && !reversal) throw new Error(INVALID);
    } else {
      if (activeSlots.has(event.slotId)) throw new Error(INVALID);
      activeSlots.add(event.slotId);
    }
    states.set(event.id, { cooking: event, consumption, reversal, cancelled,
      inventoryStatus: !consumption ? 'needs-review' : reversal ? 'reversed' : 'applied' });
  }
  // Reciprocal links alone could form a disconnected cycle. Every consumption
  // must be reachable exactly once from an immutable initial cooking pointer.
  if (reached.size !== events.filter(event => event.kind === 'consumption').length) throw new Error(INVALID);
  return states;
}

/** Check linked history before a mutation, including atomic correction pairs. */
export function assertMealCookingHistory(events, scope) {
  inspectMealCookingHistory(events, scope);
  return events;
}

/** Read current state from a single-scope history. Callers choose the authorized
 * scope; this helper validates all events even when the requested id is absent. */
export function getMealCookingState(history, cookingId) {
  if (!Array.isArray(history)) throw new Error(INVALID);
  if (history.length === 0) return null;
  return inspectMealCookingHistory(history, history[0]?.scope).get(cookingId) || null;
}
