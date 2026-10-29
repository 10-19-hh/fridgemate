import { runMealCookingTransaction } from '../../db/indexedDB';
import { assertMealPlanRecord } from './mealPlanRepository';
import { assertMealPlanExclusions, generateMealPlan, getWeekStart, moveMealPlanSlot, readjustRemainingMealPlan } from './mealPlanDomain';
import { allocateMealPlanInventory } from './mealPlanAllocation';
import { assertInventoryQuantityReview, projectInventoryQuantity } from './inventoryQuantityDomain';
import { assertMealCookingEvent, assertMealCookingHistory, getMealCookingState, isMealCookingEventId } from './mealCookingEvents';
import { assertReceipt } from '../shopping/shoppingRepository';
import { createMealPlanPilotOperation, runMealPlanPilotAction } from './mealPlanPilotActions';

const INVALID = '식단 변경 요청을 확인해주세요.';
const CONFLICT = '식단·재고 또는 날짜가 바뀌었어요. 변경 내용을 다시 확인해주세요.';
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = value => typeof value === 'string' && Boolean(value.trim());

function isDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function localDate(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (object(value)) return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
  return value;
}

const same = (left, right) => JSON.stringify(stable(left)) === JSON.stringify(stable(right));

function requestValues(input) {
  const value = structuredClone(input);
  if (!object(value) || typeof value.scope !== 'string'
    || (value.scope !== 'guest' && !/^user:[A-Za-z0-9_-]+$/.test(value.scope))
    || !isDate(value.weekStart) || getWeekStart(value.weekStart) !== value.weekStart
    || !['move', 'readjust'].includes(value.kind) || !Array.isArray(value.pantryItems)) throw new Error(INVALID);
  const pantryItems = Array.from(value.pantryItems, item => {
    if (text(item)) return item;
    if (object(item) && text(item.name)) return { name: item.name };
    throw new Error(INVALID);
  });
  const request = { scope: value.scope, weekStart: value.weekStart, kind: value.kind, pantryItems };
  if (value.kind === 'move') {
    if (typeof value.slotId !== 'string' || !/^\d{4}-\d{2}-\d{2}:dinner$/.test(value.slotId)
      || !isDate(value.slotId.slice(0, 10)) || getWeekStart(value.slotId.slice(0, 10)) !== value.weekStart
      || !isDate(value.targetDate) || !['move', 'swap'].includes(value.mode ?? 'move')) throw new Error(INVALID);
    Object.assign(request, { slotId: value.slotId, targetDate: value.targetDate, mode: value.mode ?? 'move' });
  } else if (value.slotId !== undefined || value.targetDate !== undefined || value.mode !== undefined) throw new Error(INVALID);
  return request;
}

function context(scope, raw) {
  const [ingredients, quantities, rawRecords, events] = raw;
  const records = rawRecords.map(record => assertMealPlanRecord(record, scope, record?.weekStart));
  const reviews = new Map();
  for (const review of quantities) {
    assertInventoryQuantityReview(review, scope, review?.id);
    if (reviews.has(review.id)) throw new Error(INVALID);
    reviews.set(review.id, review);
  }
  const inventory = ingredients.map(ingredient => projectInventoryQuantity(ingredient, reviews.get(ingredient.id), scope));
  const cooking = [];
  for (const event of events) {
    if (isMealCookingEventId(event?.id)) cooking.push(assertMealCookingEvent(event, scope));
    else assertReceipt(event, scope);
  }
  const history = assertMealCookingHistory(cooking, scope);
  assertConfirmedCooking(records, history);
  // This comparison token contains private raw records, not an auth credential.
  // Keep it in local UI memory only; never send it to analytics or logs.
  return { records, ingredients, inventory, history, token: JSON.stringify(stable(raw)) };
}

function assertConfirmedCooking(records, history) {
  const cancelled = new Set(history.filter(event => event.kind === 'cooking-reversal').map(event => event.reversesId));
  const cooking = new Map(history.filter(event => event.kind === 'cooking').map(event => [event.id, event]));
  for (const event of cooking.values()) {
    if (cancelled.has(event.id)) continue;
    const confirmed = records.find(record => record.weekStart === event.weekStart)?.confirmed;
    // A cleared week legitimately has no current plan. If a confirmed plan
    // exists, however, it may not silently recreate demand for an active meal.
    if (!confirmed) continue;
    const slot = confirmed.slots.find(item => item.id === event.slotId);
    if (slot?.status !== 'cooked' || slot.cooking?.id !== event.id) {
      throw new Error('확정 식단에 남아 있는 조리 기록을 확인해주세요. 기존 기록은 유지했어요.');
    }
  }
  for (const record of records) {
    for (const slot of record.confirmed?.slots ?? []) {
      if (slot.status !== 'cooked') continue;
      const event = cooking.get(slot.cooking.id);
      const current = event && getMealCookingState(history, event.id);
      if (!event || cancelled.has(event.id) || event.weekStart !== record.weekStart || event.slotId !== slot.id
        || !same(slot.cooking, { id: event.id, recordedAt: event.createdAt,
          inventoryStatus: current.inventoryStatus,
          consumptionId: current.consumption?.id ?? null, reversalId: current.reversal?.id ?? null })) {
        throw new Error('확정 식단의 조리 상태와 저장된 소비 이력이 일치하지 않아요. 기존 기록은 유지했어요.');
      }
    }
  }
}

function confirmedRecord(data, weekStart, required) {
  const record = data.records.find(item => item.weekStart === weekStart);
  if (!record && !required) return null;
  if (!record?.confirmed || record.draft !== null) {
    throw new Error('변경할 주의 식단을 먼저 확정해주세요. 수정 중인 초안은 자동으로 버리지 않아요.');
  }
  return record;
}

function approvedRecords(proposal, data) {
  const cancelled = new Set(data.history.filter(event => event.kind === 'cooking-reversal').map(event => event.reversesId));
  return proposal.plans.map(plan => {
    assertMealPlanExclusions(plan);
    const current = data.records.find(record => record.weekStart === plan.weekStart);
    if (current?.draft) throw new Error(CONFLICT);
    const revision = (current?.revision ?? 0) + 1;
    if (!Number.isSafeInteger(revision)) throw new Error(INVALID);
    for (const [index, slot] of plan.slots.entries()) {
      const prior = current?.confirmed?.slots[index];
      if ((prior?.locked || prior?.status === 'cooked' || slot.status === 'cooked') && !same(prior, slot)) {
        throw new Error('고정 또는 조리한 끼니는 변경할 수 없어요.');
      }
    }
    for (const event of data.history) {
      if (event.kind !== 'cooking' || event.weekStart !== plan.weekStart || cancelled.has(event.id)) continue;
      const slot = plan.slots.find(item => item.id === event.slotId);
      if (slot?.status !== 'cooked' || slot.cooking?.id !== event.id) {
        throw new Error('식단을 지워도 조리 기록은 남아 있어요. 조리 기록을 취소한 뒤 변경해주세요.');
      }
    }
    return assertMealPlanRecord({ id: plan.id, schemaVersion: 2, scope: proposal.scope, weekStart: plan.weekStart,
      revision, createdAt: current?.createdAt ?? proposal.createdAt, updatedAt: proposal.createdAt, draft: null,
      confirmed: { ...plan, revision, updatedAt: proposal.createdAt },
      archives: current?.confirmed ? [...current.archives, current.confirmed] : current?.archives ?? [],
    }, proposal.scope, plan.weekStart);
  });
}

function buildProposal(request, data, today, createdAt) {
  const source = confirmedRecord(data, request.weekStart, true).confirmed;
  let result;
  if (request.kind === 'move') {
    const targetWeek = getWeekStart(request.targetDate);
    const existing = confirmedRecord(data, targetWeek, false);
    const target = existing?.confirmed ?? generateMealPlan({ scope: request.scope, weekStart: targetWeek,
      preferences: { ...source.preferences, dinnerDays: [] }, now: createdAt });
    result = moveMealPlanSlot({ sourcePlan: source, targetPlan: target, sourceSlotId: request.slotId,
      targetSlotId: `${request.targetDate}:dinner`, mode: request.mode, today, now: createdAt });
  } else {
    const readjusted = readjustRemainingMealPlan(source, { today, ingredients: data.ingredients,
      pantryItems: request.pantryItems, now: createdAt });
    result = { ...readjusted, plans: [readjusted.plan] };
  }
  const plans = result.plans.slice().sort((left, right) => left.weekStart.localeCompare(right.weekStart));
  const confirmedPlans = data.records.flatMap(record => record.confirmed ? [record.confirmed] : []);
  const replacements = new Map(plans.map(plan => [plan.weekStart, plan]));
  const afterPlans = confirmedPlans.filter(plan => !replacements.has(plan.weekStart)).concat(plans);
  const allocate = values => allocateMealPlanInventory({ scope: request.scope, confirmedPlans: values, inventory: data.inventory, today });
  const proposal = { scope: request.scope, request, token: data.token, today, createdAt, plans,
    changes: result.changes, notices: result.notices, canApply: result.changes.length > 0,
    beforeAllocation: allocate(confirmedPlans), afterAllocation: allocate(afterPlans) };
  approvedRecords(proposal, data);
  return proposal;
}

async function withSnapshot(scope, mode, action) {
  let failure;
  try {
    return await runMealCookingTransaction(mode, (stores, transaction) => {
      const output = { result: undefined };
      const reads = [stores.ingredients.getAll(), stores.quantities.getAll(), stores.mealPlans.getAll(), stores.events.getAll()];
      let remaining = reads.length;
      for (const read of reads) read.onsuccess = () => {
        if (--remaining) return;
        try { output.result = action(context(scope, reads.map(item => item.result)), stores); }
        catch (error) { failure = error; transaction.abort(); }
      };
      return output;
    }, scope);
  } catch (error) { throw failure || error; }
}

/** Read-only proposal: neither confirmed plans nor physical stock change here. */
export async function previewMealPlanChange(input) {
  const request = requestValues(input);
  return withSnapshot(request.scope, 'readonly', data => {
    const now = new Date();
    return buildProposal(request, data, localDate(now), now.toISOString());
  });
}

/** Explicit approval recomputes the exact reviewed proposal against one fresh
 * snapshot. Only affected meal plans are written, in the same transaction. */
export async function confirmMealPlanChange(input) {
  const preview = structuredClone(input);
  const request = requestValues(preview?.request);
  if (preview.scope !== request.scope || !isDate(preview.today) || !text(preview.createdAt)
    || !Number.isFinite(Date.parse(preview.createdAt)) || new Date(preview.createdAt).toISOString() !== preview.createdAt) throw new Error(INVALID);
  return runMealPlanPilotAction({ scope: request.scope,
    ...createMealPlanPilotOperation('meal_slot_changed', { planKey: `week:${request.weekStart}` }) },
  () => withSnapshot(request.scope, 'readwrite', (data, stores) => {
    const today = localDate();
    if (preview.token !== data.token || preview.today !== today) throw new Error(CONFLICT);
    const checked = buildProposal(request, data, today, preview.createdAt);
    if (!checked.canApply || !same(checked, preview)) throw new Error(CONFLICT);
    const records = approvedRecords(checked, data);
    for (const record of records) stores.mealPlans.put(record);
    return { records, weekStarts: records.map(record => record.weekStart) };
  }), result => {
    // Record approval ACK time, not the older read-only proposal timestamp.
    const occurredAt = new Date().toISOString();
    const operationKey = `plan-change:${result.records.map(record => `${record.id}@${record.revision}`).join('|')}`;
    return preview.changes.map(change => {
      const week = getWeekStart(change.date);
      const record = result.records.find(item => item.weekStart === week);
      return { name: 'meal_slot_changed', status: 'success',
        sourceKey: `meal_slot_changed:${record.id}@${record.revision}:${change.after.id}`,
        operationKey, occurredAt, planKey: record.id, slotKey: change.after.id };
    });
  });
}
