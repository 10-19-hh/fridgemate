import { runInventoryReceiptTransaction, runShoppingTransaction } from '../../db/indexedDB';
import { getMealPlanningSnapshot } from '../mealPlans/mealPlanRepository';
import { allocateMealPlanInventory } from '../mealPlans/mealPlanAllocation';
import { createInventoryQuantityReview, invalidateInventoryQuantityReview, validateInventoryQuantityValues } from '../mealPlans/inventoryQuantityDomain';
import { assertMealCookingEvent, isMealCookingEventId } from '../mealPlans/mealCookingEvents';
import { ingredientCategories, storageTypes } from '../ingredients/ingredientFields';
import { createMealPlanPilotOperation, runMealPlanPilotAction } from '../mealPlans/mealPlanPilotActions';

const INVALID = '장보기 자료를 확인할 수 없습니다. 기존 기록은 지우지 않았어요.';
const CONFLICT = '다른 화면에서 장보기 항목이 바뀌었어요. 목록을 다시 불러와 주세요.';
const TOKEN = /^[A-Za-z0-9_-]{1,120}$/;
const PREPARATION_LABELS = { raw: '조리 전', cooked: '조리 후', 'as-sold': '구매 상태' };
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const timestamp = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value));

function scopeName(scope) {
  if (typeof scope !== 'string' || (scope !== 'guest' && !/^user:[A-Za-z0-9_-]+$/.test(scope))) throw new Error(INVALID);
  return scope;
}

function text(value, max, required = false) {
  if (typeof value !== 'string' || value.length > max
    || Array.from(value).some((character) => character.charCodeAt(0) < 32 && !'\t\n\r'.includes(character))
    || (required && !value.trim())) throw new Error(INVALID);
  return value.trim();
}

function manualId(id) {
  if (typeof id !== 'string' || !id.startsWith('manual:') || !TOKEN.test(id.slice(7))) throw new Error(INVALID);
  return id;
}

function revision(value, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum || value >= Number.MAX_SAFE_INTEGER) throw new Error(INVALID);
  return value;
}

function manualValues(values) {
  if (!object(values) || typeof values.checked !== 'boolean') throw new Error(INVALID);
  return { name: text(values.name, 80, true), quantityText: text(values.quantityText, 160),
    memo: text(values.memo, 500), checked: values.checked };
}

function referenceDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(INVALID);
  const date = new Date(`${value}T12:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new Error(INVALID);
  return date;
}

function planReference(value) {
  if (!object(value) || value.schemaVersion !== 1 || !Array.isArray(value.planVersions) || !value.planVersions.length
    || !Array.isArray(value.slotIds) || !value.slotIds.length) throw new Error(INVALID);
  const weeks = new Set();
  const planVersions = Array.from(value.planVersions, (pair) => {
    if (!Array.isArray(pair) || pair.length !== 2) throw new Error(INVALID);
    const [week, version] = pair;
    if (referenceDate(week).getUTCDay() !== 1 || weeks.has(week)) throw new Error(INVALID);
    weeks.add(week);
    return [week, revision(version, 1)];
  });
  const slots = new Set();
  const slotIds = Array.from(value.slotIds, (id) => {
    if (typeof id !== 'string' || !/^\d{4}-\d{2}-\d{2}:dinner$/.test(id) || slots.has(id)) throw new Error(INVALID);
    const date = referenceDate(id.slice(0, 10));
    date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7);
    if (!weeks.has(date.toISOString().slice(0, 10))) throw new Error(INVALID);
    slots.add(id);
    return id;
  });
  // Copy every nested value before asynchronous storage. These are evidence,
  // not part of the row key, and are never truncated to fit an identifier.
  return { schemaVersion: 1, planVersions, slotIds };
}

function sourceSnapshot(source) {
  if (!object(source) || !['plan', 'manual', 'repurchase'].includes(source.source)) throw new Error(INVALID);
  const sourceId = text(source.sourceId, 8192, true);
  if (!sourceId.startsWith(`${source.source}:`)) throw new Error(INVALID);
  const snapshot = { source: source.source, sourceId, name: text(source.name, 200, true),
    quantityText: text(source.quantityText, 1000), context: text(source.context, 400) };
  if (source.source === 'plan' && sourceId.startsWith('plan:v2:')) snapshot.reference = planReference(source.reference);
  else if (source.reference !== undefined) throw new Error(INVALID);
  return snapshot;
}

function assertEntry(entry, scope, id = entry?.id) {
  if (!object(entry) || entry.schemaVersion !== 1 || entry.scope !== scope || entry.id !== id
    || !timestamp(entry.createdAt) || !timestamp(entry.updatedAt)) throw new Error(INVALID);
  revision(entry.revision, 1);
  if (entry.kind === 'manual') {
    manualId(entry.id);
    if (!['active', 'removed'].includes(entry.status)) throw new Error(INVALID);
    if (entry.status === 'active') manualValues(entry);
  } else if (entry.kind === 'purchase-note') {
    if (typeof entry.id !== 'string' || !entry.id.startsWith('purchase:') || !TOKEN.test(entry.id.slice(9))
      || entry.revision !== 1 || entry.inventoryApplied !== false) throw new Error(INVALID);
    sourceSnapshot(entry.source);
    text(entry.actualQuantityText, 160, true);
    text(entry.memo, 500);
  } else throw new Error(INVALID);
  return entry;
}

async function updateEntry(scope, id, update) {
  let failure;
  try {
    return await runShoppingTransaction('readwrite', (store, transaction) => {
      const output = { result: undefined };
      const request = store.get(id);
      request.onsuccess = () => {
        try {
          const current = request.result;
          if (current !== undefined) assertEntry(current, scope, id);
          const next = update(current);
          assertEntry(next, scope, id);
          if (next !== current) store.put(next);
          output.result = next;
        } catch (error) {
          failure = error;
          transaction.abort();
        }
      };
      return output;
    }, scope);
  } catch (error) { throw failure || error; }
}

export async function saveManualShoppingItem(input) {
  const scope = scopeName(input?.scope);
  const id = manualId(input?.id);
  const expected = revision(input?.expectedRevision);
  const values = manualValues(input?.values);
  return updateEntry(scope, id, (current) => {
    if ((current?.revision ?? 0) !== expected || (current && current.status !== 'active')) throw new Error(CONFLICT);
    const now = new Date().toISOString();
    return { schemaVersion: 1, kind: 'manual', id, scope, status: 'active', revision: expected + 1,
      ...values, createdAt: current?.createdAt ?? now, updatedAt: now };
  });
}

export async function removeManualShoppingItem(input) {
  const scope = scopeName(input?.scope);
  const id = manualId(input?.id);
  const expected = revision(input?.expectedRevision, 1);
  return updateEntry(scope, id, (current) => {
    if (!current || current.revision !== expected || current.status !== 'active') throw new Error(CONFLICT);
    // A minimal marker prevents an old tab from recreating the deleted intention.
    // Existing purchase notes retain their own explicit source snapshots.
    return { schemaVersion: 1, kind: 'manual', id, scope, status: 'removed', revision: expected + 1,
      createdAt: current.createdAt, updatedAt: new Date().toISOString() };
  });
}

export async function recordPurchaseNote(input) {
  const scope = scopeName(input?.scope);
  if (typeof input?.operationId !== 'string' || !TOKEN.test(input.operationId)) throw new Error(INVALID);
  const id = `purchase:${input.operationId}`;
  const payload = { source: sourceSnapshot(input.source), actualQuantityText: text(input.actualQuantityText, 160, true),
    memo: text(input.memo, 500) };
  return updateEntry(scope, id, (current) => {
    if (current) {
      const previous = { source: sourceSnapshot(current.source), actualQuantityText: current.actualQuantityText, memo: current.memo };
      if (current.kind !== 'purchase-note' || JSON.stringify(previous) !== JSON.stringify(payload)) throw new Error(CONFLICT);
      return current;
    }
    const now = new Date().toISOString();
    return { schemaVersion: 1, kind: 'purchase-note', id, scope, revision: 1, ...payload,
      inventoryApplied: false, createdAt: now, updatedAt: now };
  });
}

function receiptValues(values) {
  if (!object(values) || !['verified', 'unverified'].includes(values.quantityStatus)
    || !ingredientCategories.includes(values.category) || !storageTypes.includes(values.storageType)) throw new Error(INVALID);
  const day = (value) => {
    if (value === '') return '';
    referenceDate(value);
    return value;
  };
  const result = { name: text(values.name, 120, true), quantityText: text(values.quantityText, 160, true),
    quantityStatus: values.quantityStatus, amount: values.amount, unit: values.unit, preparationState: values.preparationState,
    purchaseDate: day(values.purchaseDate), expiryDate: day(values.expiryDate),
    category: values.category, storageType: values.storageType, memo: text(values.memo, 500) };
  if (result.quantityStatus === 'unverified') {
    if (result.amount !== null || result.unit !== null || result.preparationState !== null) throw new Error(INVALID);
  } else {
    if (typeof result.amount !== 'number' || !(result.amount > 0)) throw new Error(INVALID);
    // Reuse the same exact unit, state and precision contract as manual quantity confirmation.
    validateInventoryQuantityValues(result);
  }
  return result;
}

export function assertReceipt(receipt, scope) {
  if (!object(receipt) || receipt.schemaVersion !== 1 || receipt.kind !== 'receipt' || receipt.scope !== scope
    || typeof receipt.operationId !== 'string' || !TOKEN.test(receipt.operationId)
    || receipt.id !== `receipt:${receipt.operationId}` || receipt.ingredientId !== `receipt-${receipt.operationId}`
    || typeof receipt.purchaseNoteId !== 'string' || !receipt.purchaseNoteId.startsWith('purchase:')
    || !TOKEN.test(receipt.purchaseNoteId.slice(9)) || !timestamp(receipt.createdAt)
    || !object(receipt.purchase)) throw new Error(INVALID);
  receiptValues(receipt.values);
  sourceSnapshot(receipt.purchase.source);
  text(receipt.purchase.actualQuantityText, 160, true);
  text(receipt.purchase.memo, 500);
  return receipt;
}

export async function applyPurchaseReceipt(input) {
  const scope = scopeName(input?.scope);
  const operationId = input?.operationId;
  const purchaseNoteId = input?.purchaseNoteId;
  if (typeof operationId !== 'string' || !TOKEN.test(operationId)
    || typeof purchaseNoteId !== 'string' || !purchaseNoteId.startsWith('purchase:') || !TOKEN.test(purchaseNoteId.slice(9))) throw new Error(INVALID);
  const values = receiptValues(input.values); // Copy and validate before the first await.
  const id = `receipt:${operationId}`;
  const ingredientId = `receipt-${operationId}`;
  return runMealPlanPilotAction({ scope, ...createMealPlanPilotOperation('inventory_purchase_applied') }, async () => {
  let failure;
  try {
    return await runInventoryReceiptTransaction('readwrite', (stores, transaction) => {
      const output = { result: undefined };
      const requests = [stores.shopping.get(purchaseNoteId), stores.events.get(id),
        stores.events.index('purchaseNoteId').get(purchaseNoteId), stores.ingredients.get(ingredientId), stores.quantities.get(ingredientId)];
      let remaining = requests.length;
      for (const request of requests) request.onsuccess = () => {
        remaining -= 1;
        if (remaining) return;
        try {
          const [note, byOperation, byNote, existingStock, existingReview] = requests.map((item) => item.result);
          assertEntry(note, scope, purchaseNoteId);
          if (note.kind !== 'purchase-note') throw new Error(INVALID);
          if (byOperation) {
            assertReceipt(byOperation, scope);
            if (byOperation.purchaseNoteId !== purchaseNoteId) throw new Error(CONFLICT);
          }
          if (byNote) assertReceipt(byNote, scope);
          if (byOperation && byNote?.id !== byOperation.id) throw new Error(INVALID);
          const existing = byOperation || byNote;
          if (existing) {
            if (JSON.stringify(receiptValues(existing.values)) !== JSON.stringify(values)) throw new Error(CONFLICT);
            // This acknowledges the original event, never restores a later-edited or deleted stock row.
            output.result = existing;
            return;
          }
          if (existingStock || existingReview) throw new Error(CONFLICT);
          const now = new Date().toISOString();
          const ingredient = { id: ingredientId, clientId: ingredientId, name: values.name, quantity: values.quantityText,
            category: values.category, storageType: values.storageType, purchaseDate: values.purchaseDate,
            expiryDate: values.expiryDate, memo: values.memo, consumed: false, deletedAt: null,
            createdAt: now, updatedAt: now, syncState: 'pendingCreate', lastSyncedAt: null };
          const quantity = values.quantityStatus === 'verified'
            ? createInventoryQuantityReview({ ingredient, scope, values, revision: 1, now })
            : invalidateInventoryQuantityReview(undefined, scope, ingredientId);
          const receipt = { schemaVersion: 1, kind: 'receipt', id, scope, operationId, purchaseNoteId, ingredientId,
            values, createdAt: now, purchase: { source: sourceSnapshot(note.source), actualQuantityText: note.actualQuantityText, memo: note.memo } };
          assertReceipt(receipt, scope);
          stores.ingredients.add(ingredient);
          stores.quantities.add(quantity);
          stores.events.add(receipt);
          output.result = receipt;
        } catch (error) { failure = error; transaction.abort(); }
      };
      return output;
    }, scope);
  } catch (error) { throw failure || error; }
  }, receipt => [{ name: 'inventory_purchase_applied', status: 'success',
    sourceKey: `inventory_purchase_applied:${receipt.id}`, operationKey: receipt.operationId, occurredAt: receipt.createdAt }]);
}

function planShopping(snapshot, today) {
  const allocation = allocateMealPlanInventory({ ...snapshot, today });
  const versions = snapshot.confirmedPlans.map((plan) => [plan.weekStart, plan.revision]);
  const source = (kind, identity, slotIds, name, quantityText, context) => sourceSnapshot({
    source: 'plan', sourceId: `plan:v2:${JSON.stringify([kind, ...identity])}`, name, quantityText, context,
    reference: { schemaVersion: 1, planVersions: versions, slotIds },
  });
  const shortageContext = (slotIds) => {
    const dates = slotIds.slice(0, 3).map((id) => id.slice(0, 10)).join(', ');
    // Only the display is abbreviated; the separate reference retains every slot.
    return `확정 식단 부족분 · ${dates}${slotIds.length > 3 ? ` 외 ${slotIds.length - 3}회` : ''}`;
  };
  const sources = [
    ...allocation.shopping.shortages.map((item) => source('shortage', [item.ingredientKey, item.preparationState, item.unit], item.slotIds,
      item.label, `${item.amount}${item.unit}`, shortageContext(item.slotIds))),
    ...allocation.shopping.needsReview.filter(item => item.date >= today).map((item) => source('review',
      [item.slotId, item.componentId, item.lineId, item.ingredientKey, item.unit, item.preparationState, item.reason],
      [item.slotId], item.label, '양 확인 필요',
      `${item.date} · ${item.title} · 단위 ${item.unit ?? '미확인'} · ${PREPARATION_LABELS[item.preparationState] ?? '조리 상태 미확인'}`)),
  ];
  // An unresolved past meal is not an item to buy or receive into inventory.
  const overdueMeals = allocation.slots.filter(slot => slot.overdue)
    .map(slot => ({ slotId: slot.id, date: slot.date, title: slot.title }));
  return { sources, overdueMeals };
}

export async function getShoppingWorkspace(scope = 'guest', today) {
  scopeName(scope);
  // Notes are independent of allocation and never consumed as stock. Only the
  // planning snapshot needs the existing atomic stock/quantity/plan read.
  const [entries, snapshot, events] = await Promise.all([
    runShoppingTransaction('readonly', (store) => store.getAll(), scope),
    getMealPlanningSnapshot(scope),
    runInventoryReceiptTransaction('readonly', ({ events }) => events.getAll(), scope),
  ]);
  entries.forEach((entry) => assertEntry(entry, scope));
  const receipts = [];
  for (const event of events) {
    // Route by ID as well as kind so a damaged receipt cannot disappear from
    // purchase history merely because its kind was changed to another event.
    if (typeof event?.id === 'string' && event.id.startsWith('receipt:')) receipts.push(assertReceipt(event, scope));
    else if (isMealCookingEventId(event?.id)) assertMealCookingEvent(event, scope);
    else throw new Error(INVALID);
  }
  const manualItems = entries.filter((entry) => entry.kind === 'manual' && entry.status === 'active');
  const purchaseNotes = entries.filter((entry) => entry.kind === 'purchase-note')
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
  const plan = planShopping(snapshot, today);
  const sources = [
    ...plan.sources,
    ...manualItems.map((entry) => sourceSnapshot({ source: 'manual', sourceId: `${entry.id}@${entry.revision}`,
      name: entry.name, quantityText: entry.quantityText, context: `직접 입력 · 버전 ${entry.revision}` })),
    ...snapshot.ingredients.filter((item) => item.consumed && !item.deletedAt).map((item) => sourceSnapshot({
      source: 'repurchase', sourceId: `repurchase:${JSON.stringify([item.id, item.updatedAt ?? null, item.quantity ?? ''])}`,
      name: item.name, quantityText: item.quantity || '', context: '소비 완료 재료 · 재구매 후보',
    })),
  ];
  return { scope, manualItems, purchaseNotes, receipts, sources, overdueMeals: plan.overdueMeals, checkedAt: new Date().toISOString() };
}
