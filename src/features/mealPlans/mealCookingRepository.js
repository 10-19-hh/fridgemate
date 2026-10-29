import { runMealCookingTransaction } from '../../db/indexedDB';
import { assertMealPlanRecord } from './mealPlanRepository';
import { getWeekStart } from './mealPlanDomain';
import { assertInventoryQuantityReview, invalidateInventoryQuantityReview, projectInventoryQuantity, validateInventoryQuantityValues } from './inventoryQuantityDomain';
import { prepareConsumption, prepareConsumptionReversal } from './inventoryConsumptionDomain';
import { assertMealCookingEvent, assertMealCookingHistory, getMealCookingState, isMealCookingEventId } from './mealCookingEvents';
import { assertReceipt } from '../shopping/shoppingRepository';
import { createMealPlanPilotOperation, mealCookingPilotEvents, runMealPlanPilotAction } from './mealPlanPilotActions';

const INVALID = '조리 기록 요청을 확인해주세요.';
const CONFLICT = '식단이나 사용량이 바뀌었어요. 다시 불러온 뒤 확인해주세요.';
const TOKEN = /^[A-Za-z0-9_-]{1,120}$/;
const text = value => typeof value === 'string' && Boolean(value.trim());

function stockCheck(value) {
  if (!value || !text(value.ingredientId) || !Number.isSafeInteger(value.expectedRevision) || value.expectedRevision < 1
    || !text(value.expectedSourceToken)) throw new Error(INVALID);
  return { ingredientId: value.ingredientId, expectedRevision: value.expectedRevision, expectedSourceToken: value.expectedSourceToken };
}

function checkedList(values, measured, allowEmpty = false) {
  if (!Array.isArray(values) || (!allowEmpty && !values.length)) throw new Error(INVALID);
  const ids = new Set();
  const result = [];
  for (const value of values) {
    const check = stockCheck(value);
    if (ids.has(check.ingredientId)) throw new Error(INVALID);
    ids.add(check.ingredientId);
    if (measured) {
      validateInventoryQuantityValues({ name: '재고', amount: value.amount, unit: value.unit, preparationState: 'raw' });
      if (!(value.amount > 0)) throw new Error(INVALID);
      result.push({ ...check, amount: value.amount, unit: value.unit });
    } else result.push(check);
  }
  return result.sort((left, right) => left.ingredientId.localeCompare(right.ingredientId));
}

function requestValues(input, action) {
  // Retain only this command's fields and copy before opening IndexedDB.
  const value = structuredClone(input);
  if (!value || typeof value.scope !== 'string' || (value.scope !== 'guest' && !/^user:[A-Za-z0-9_-]+$/.test(value.scope))
    || typeof value.operationId !== 'string' || !TOKEN.test(value.operationId)
    || !Number.isSafeInteger(value.expectedPlanRevision) || value.expectedPlanRevision < 0
    || typeof value.slotId !== 'string' || !/^\d{4}-\d{2}-\d{2}:dinner$/.test(value.slotId)
    || getWeekStart(value.slotId.slice(0, 10)) !== value.weekStart) throw new Error(INVALID);
  const request = { scope: value.scope, weekStart: value.weekStart, slotId: value.slotId,
    expectedPlanRevision: value.expectedPlanRevision };
  if (action === 'cooking') {
    if (!['measured', 'unknown'].includes(value.usageMode)) throw new Error(INVALID);
    request.usageMode = value.usageMode;
    request.completeUsageConfirmed = value.completeUsageConfirmed;
    if (value.usageMode === 'measured') {
      if (value.completeUsageConfirmed !== true) throw new Error('입력한 목록이 실제 사용한 재고 전부인지 확인해주세요.');
      request.usages = checkedList(value.usages, true);
    } else {
      if (value.completeUsageConfirmed !== false || !Array.isArray(value.usages) || value.usages.length) throw new Error(INVALID);
      request.usages = [];
    }
  } else {
    if (typeof value.cookingId !== 'string' || !/^cooking:[A-Za-z0-9_-]{1,120}$/.test(value.cookingId)) throw new Error(INVALID);
    request.cookingId = value.cookingId;
    if (action === 'consumption-reversal' || action === 'consumption-correction') {
      request.inventory = checkedList(value.inventory, false, true);
      if (value.expectedConsumptionId !== undefined || action === 'consumption-correction') {
        if (typeof value.expectedConsumptionId !== 'string' || !/^consumption:[A-Za-z0-9_-]{1,120}$/.test(value.expectedConsumptionId)) throw new Error(INVALID);
        request.expectedConsumptionId = value.expectedConsumptionId;
      }
    }
    if (action === 'consumption-correction') {
      if (value.completeUsageConfirmed !== true) throw new Error('정정할 실제 사용량을 모두 확인해주세요.');
      request.completeUsageConfirmed = true;
      request.usages = checkedList(value.usages, true, true);
    }
  }
  return { ...request, operationId: value.operationId, requestKey: JSON.stringify(request) };
}

function cookingHistory(events, scope) {
  const history = [];
  for (const event of events) {
    if (isMealCookingEventId(event?.id)) history.push(assertMealCookingEvent(event, scope));
    else assertReceipt(event, scope);
  }
  return assertMealCookingHistory(history, scope);
}

function context(request, rawRecord, ingredients, reviews, events) {
  const record = rawRecord === undefined ? null : assertMealPlanRecord(rawRecord, request.scope, request.weekStart);
  const history = cookingHistory(events, request.scope);
  const reviewsById = new Map();
  for (const review of reviews) {
    assertInventoryQuantityReview(review, request.scope, review?.id);
    reviewsById.set(review.id, review);
  }
  const stockById = new Map(ingredients.map(item => [item.id, item]));
  const originalStock = check => ({ ingredient: stockById.get(check.ingredientId), review: reviewsById.get(check.ingredientId),
    expectedRevision: check.expectedRevision, expectedSourceToken: check.expectedSourceToken });
  return { record, history, ingredients, reviewsById, originalStock };
}

function newEvent(kind, request, now, fields) {
  const event = { schemaVersion: 1, kind, id: `${kind}:${request.operationId}`, operationId: request.operationId,
    scope: request.scope, weekStart: request.weekStart, slotId: request.slotId, createdAt: now,
    requestKey: request.requestKey, ...fields };
  return assertMealCookingEvent(event, request.scope);
}

function replay(event, request, record) {
  if (event.requestKey !== request.requestKey || event.slotId !== request.slotId || event.weekStart !== request.weekStart) throw new Error(CONFLICT);
  return { record, event };
}

function replaceRecordedSlot(record, slotId, update, now, required = true) {
  const slot = record?.confirmed?.slots.find(item => item.id === slotId);
  if (!slot) {
    if (required) throw new Error('먼저 해당 저녁 식단을 확정해주세요.');
    return record;
  }
  const draftSlot = record.draft?.slots.find(item => item.id === slotId);
  if (draftSlot && JSON.stringify(draftSlot) !== JSON.stringify(slot)) {
    throw new Error('해당 끼니의 수정 중인 초안이 있어요. 초안을 먼저 확정한 뒤 조리 기록을 변경해주세요.');
  }
  const revision = record.revision + 1;
  if (!Number.isSafeInteger(revision)) throw new Error(INVALID);
  const updated = update(slot);
  const changePlan = plan => plan && ({ ...plan, revision, updatedAt: now,
    slots: plan.slots.map(item => item.id === slotId ? structuredClone(updated) : item) });
  const next = { ...record, revision, updatedAt: now, confirmed: changePlan(record.confirmed), draft: changePlan(record.draft) };
  return assertMealPlanRecord(next, record.scope, record.weekStart);
}

function checkedRecordedSlot(record, slotId, state) {
  const slot = record?.confirmed?.slots.find(item => item.id === slotId);
  if (slot && (slot.status !== 'cooked' || slot.cooking.id !== state.cooking.id
    || slot.cooking.recordedAt !== state.cooking.createdAt
    || slot.cooking.consumptionId !== (state.consumption?.id ?? null)
    || slot.cooking.inventoryStatus !== state.inventoryStatus
    || slot.cooking.reversalId !== (state.reversal?.id ?? null))) throw new Error(CONFLICT);
  return slot;
}

function invalidatePossibleUsage(slot, data, scope, stores) {
  const lines = slot.components.flatMap(component => [
    ...component.ingredients.filter(line => !(line.optional && line.selected !== true)),
    ...(component.processInputs || []).filter(line => !(line.optional && line.selected !== true)),
  ]);
  const unresolved = lines.some(line => !text(line.ingredientKey));
  const keys = new Set(lines.map(line => line.ingredientKey));
  for (const ingredient of data.ingredients) {
    if (ingredient.consumed || ingredient.deletedAt) continue;
    const review = data.reviewsById.get(ingredient.id);
    if (review?.status === 'verified' && (unresolved || keys.has(review.ingredientKey))) {
      stores.quantities.put(invalidateInventoryQuantityReview(review, scope, ingredient.id));
    }
  }
}

function recordCooking(request, data, stores, now) {
  const cancelled = new Set(data.history.filter(event => event.kind === 'cooking-reversal').map(event => event.reversesId));
  const active = data.history.filter(event => event.kind === 'cooking' && event.slotId === request.slotId && !cancelled.has(event.id));
  if (active.length > 1) throw new Error(INVALID);
  if (active.length) return replay(active[0], request, data.record);
  if ((data.record?.revision ?? 0) !== request.expectedPlanRevision) throw new Error(CONFLICT);
  const slot = data.record?.confirmed?.slots.find(item => item.id === request.slotId);
  if (slot?.status !== 'planned') throw new Error('확정된 예정 끼니만 조리 기록을 남길 수 있어요.');
  let consumptionId = null;
  const status = request.usageMode === 'measured' ? 'applied' : 'needs-review';
  if (status === 'applied') {
    const prepared = prepareConsumption({ ...request, now, changes: request.usages.map(usage => ({
      ...data.originalStock(usage), amount: usage.amount, unit: usage.unit,
    })) });
    consumptionId = prepared.event.id;
    for (const change of prepared.changes) {
      stores.ingredients.put(change.ingredient);
      stores.quantities.put(change.review);
    }
    stores.events.add(newEvent('consumption', request, now, { ...prepared.event, cookingId: `cooking:${request.operationId}` }));
  } else invalidatePossibleUsage(slot, data, request.scope, stores);
  const event = newEvent('cooking', request, now, { inventoryStatus: status, consumptionId });
  const record = replaceRecordedSlot(data.record, request.slotId, current => ({ ...current, status: 'cooked',
    cooking: { id: event.id, recordedAt: now, inventoryStatus: status, consumptionId, reversalId: null } }), now);
  stores.mealPlans.put(record);
  stores.events.add(event);
  return { record, event };
}

function reverseCooking(request, data, stores, now, action) {
  const state = getMealCookingState(data.history, request.cookingId);
  const original = state?.cooking;
  if (!original || original.slotId !== request.slotId || original.weekStart !== request.weekStart) throw new Error(INVALID);
  const prior = action === 'consumption-reversal' ? state.reversal
    : data.history.find(event => event.kind === 'cooking-reversal' && event.reversesId === original.id);
  if (prior) return replay(prior, request, data.record);
  if ((data.record?.revision ?? 0) !== request.expectedPlanRevision) throw new Error(CONFLICT);
  if (data.history.some(event => event.kind === 'cooking-reversal' && event.reversesId === original.id)) throw new Error(CONFLICT);
  const currentSlot = checkedRecordedSlot(data.record, request.slotId, state);
  let event;
  if (action === 'consumption-reversal') {
    const consumption = state.consumption;
    if (!consumption || consumption.cookingId !== original.id) throw new Error('취소할 소비 반영이 없어요.');
    if ((request.expectedConsumptionId !== undefined || consumption.replacesId !== undefined)
      && request.expectedConsumptionId !== consumption.id) throw new Error(CONFLICT);
    if (request.inventory.length !== consumption.lines.length
      || request.inventory.some(check => !consumption.lines.some(line => line.inventoryId === check.ingredientId))) throw new Error(INVALID);
    const prepared = consumption.lines.length
      ? prepareConsumptionReversal({ ...request, now, originalEvent: consumption, inventory: request.inventory.map(data.originalStock) })
      : { changes: [], event: { reversesId: consumption.id, lines: [] } };
    for (const change of prepared.changes) {
      stores.ingredients.put(change.ingredient);
      // Cooking remains asserted: restored physical amounts are not a fresh count.
      stores.quantities.put(invalidateInventoryQuantityReview(data.reviewsById.get(change.ingredient.id), request.scope, change.ingredient.id));
    }
    event = newEvent(action, request, now, { ...prepared.event, cookingId: original.id });
  } else {
    if (state.inventoryStatus === 'applied') {
      throw new Error('먼저 재고 반영을 취소해주세요. 조리 기록 취소만으로 재고를 되돌리지 않아요.');
    }
    event = newEvent(action, request, now, { reversesId: original.id });
  }
  // Deleting a plan must neither erase stock history nor prevent its correction.
  const record = currentSlot?.status === 'cooked' ? replaceRecordedSlot(data.record, request.slotId, slot => {
    if (action === 'consumption-reversal') return { ...slot, cooking: { ...slot.cooking, inventoryStatus: 'reversed', reversalId: event.id } };
    const { cooking: _cooking, ...planned } = slot;
    return { ...planned, status: 'planned' };
  }, now) : data.record;
  if (record !== data.record) stores.mealPlans.put(record);
  stores.events.add(event);
  return { record, event };
}

function correctConsumption(request, data, stores, now) {
  const state = getMealCookingState(data.history, request.cookingId);
  if (!state || state.cooking.weekStart !== request.weekStart || state.cooking.slotId !== request.slotId) throw new Error(INVALID);
  // Another tab can acknowledge an identical committed correction, but never
  // apply its inverse again or silently overwrite a different new quantity.
  const priorInverse = data.history.find(event => event.kind === 'consumption-reversal'
    && event.reversesId === request.expectedConsumptionId && event.replacementConsumptionId);
  if (priorInverse) return replay(data.history.find(event => event.id === priorInverse.replacementConsumptionId), request, data.record);
  if (state.cancelled || state.inventoryStatus !== 'applied' || state.consumption?.id !== request.expectedConsumptionId
    || (data.record?.revision ?? 0) !== request.expectedPlanRevision) throw new Error(CONFLICT);
  const consumption = state.consumption;
  if (request.inventory.length !== consumption.lines.length
    || request.inventory.some(check => !consumption.lines.some(line => line.inventoryId === check.ingredientId))) throw new Error(INVALID);
  // Validate every new-use token against the committed pre-correction stock,
  // before substituting the in-memory inverse balance for a shared batch.
  for (const usage of request.usages) {
    const entry = data.originalStock(usage);
    if (!entry.ingredient) throw new Error(CONFLICT);
    const current = projectInventoryQuantity(entry.ingredient, entry.review, request.scope);
    if (current.quantityStatus !== 'verified' || current.quantityRevision !== usage.expectedRevision
      || current.sourceToken !== usage.expectedSourceToken) throw new Error(CONFLICT);
  }
  const inverse = consumption.lines.length
    ? prepareConsumptionReversal({ ...request, now, originalEvent: consumption, inventory: request.inventory.map(data.originalStock) })
    : { changes: [], event: { reversesId: consumption.id, lines: [] } };
  const finalChanges = new Map(inverse.changes.map(change => [change.ingredient.id, change]));
  const replacement = request.usages.length ? prepareConsumption({ ...request, now, changes: request.usages.map(usage => {
    const restored = finalChanges.get(usage.ingredientId);
    const entry = restored ? { ...restored, expectedRevision: restored.review.revision, expectedSourceToken: restored.review.sourceToken }
      : data.originalStock(usage);
    return { ...entry, amount: usage.amount, unit: usage.unit };
  }) }) : { changes: [], event: { lines: [] } };
  for (const change of replacement.changes) finalChanges.set(change.ingredient.id, change);
  const event = newEvent('consumption', request, now, { ...replacement.event,
    cookingId: state.cooking.id, replacesId: consumption.id });
  const reversal = newEvent('consumption-reversal', request, now, { ...inverse.event,
    cookingId: state.cooking.id, replacementConsumptionId: event.id });
  assertMealCookingHistory([...data.history, reversal, event], request.scope);
  const slot = checkedRecordedSlot(data.record, request.slotId, state);
  const record = slot ? replaceRecordedSlot(data.record, request.slotId, current => ({ ...current,
    cooking: { ...current.cooking, consumptionId: event.id } }), now) : data.record;
  // Persist only final amounts. No observer can see the inverse-only balance.
  for (const change of finalChanges.values()) {
    stores.ingredients.put(change.ingredient);
    stores.quantities.put(change.review);
  }
  if (record !== data.record) stores.mealPlans.put(record);
  stores.events.add(reversal);
  stores.events.add(event);
  return { record, event };
}

async function performTransaction(request, action) {
  let failure;
  try {
    return await runMealCookingTransaction('readwrite', (stores, transaction) => {
      const output = { result: undefined };
      const reads = [stores.mealPlans.get(`week:${request.weekStart}`), stores.ingredients.getAll(), stores.quantities.getAll(), stores.events.getAll()];
      let remaining = reads.length;
      for (const read of reads) read.onsuccess = () => {
        if (--remaining) return;
        try {
          const data = context(request, ...reads.map(item => item.result));
          const eventKind = action === 'consumption-correction' ? 'consumption' : action;
          const previous = data.history.find(event => event.id === `${eventKind}:${request.operationId}`);
          if (previous) output.result = replay(previous, request, data.record);
          else {
            const now = new Date().toISOString();
            output.result = action === 'cooking' ? recordCooking(request, data, stores, now)
              : action === 'consumption-correction' ? correctConsumption(request, data, stores, now)
                : reverseCooking(request, data, stores, now, action);
          }
        } catch (error) { failure = error; transaction.abort(); }
      };
      return output;
    }, request.scope);
  } catch (error) { throw failure || error; }
}

function perform(input, action) {
  // Keep command validation/copy synchronous, before optional observation awaits.
  let request;
  try { request = requestValues(input, action); } catch (error) { return Promise.reject(error); }
  const name = { cooking: 'meal_cooked_recorded', 'cooking-reversal': 'meal_cooked_reversed',
    'consumption-reversal': 'consumption_reversed', 'consumption-correction': 'consumption_applied' }[action];
  return runMealPlanPilotAction({ scope: request.scope,
    ...createMealPlanPilotOperation(name, { planKey: `week:${request.weekStart}`, slotKey: request.slotId }) },
  () => performTransaction(request, action), mealCookingPilotEvents);
}

export const recordMealCooking = input => perform(input, 'cooking');
export const reverseMealConsumption = input => perform(input, 'consumption-reversal');
export const cancelMealCooking = input => perform(input, 'cooking-reversal');
export const correctMealConsumption = input => perform(input, 'consumption-correction');

/** Read one committed version for cooking forms and history. Retain history when
 * a plan was cleared so its consumption can still be corrected explicitly. */
export async function getMealCookingWorkspace(scope = 'guest') {
  if (typeof scope !== 'string' || (scope !== 'guest' && !/^user:[A-Za-z0-9_-]+$/.test(scope))) {
    throw new Error('조리 기록을 불러올 계정을 확인해주세요.');
  }
  const [ingredients, reviews, rawRecords, events] = await runMealCookingTransaction('readonly', stores => {
    const output = { result: undefined };
    const reads = [stores.ingredients.getAll(), stores.quantities.getAll(), stores.mealPlans.getAll(), stores.events.getAll()];
    let remaining = reads.length;
    for (const read of reads) read.onsuccess = () => {
      if (--remaining === 0) output.result = reads.map(request => request.result);
    };
    return output;
  }, scope);
  const records = rawRecords.map(record => assertMealPlanRecord(record, scope, record?.weekStart))
    .sort((left, right) => left.weekStart.localeCompare(right.weekStart));
  const reviewsById = new Map();
  // Orphaned and deleted-item reviews still need validation; do not hide them.
  for (const review of reviews) {
    assertInventoryQuantityReview(review, scope, review?.id);
    if (reviewsById.has(review.id)) throw new Error('수량 확인 자료가 중복되어 있습니다.');
    reviewsById.set(review.id, review);
  }
  const inventory = ingredients.map(ingredient => projectInventoryQuantity(ingredient, reviewsById.get(ingredient.id), scope));
  return { scope, records, inventory, history: cookingHistory(events, scope) };
}
