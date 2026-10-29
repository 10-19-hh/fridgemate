import { readMealPlanningSnapshot, runMealCookingTransaction, runMealPlanTransaction } from '../../db/indexedDB';
import { assertInventoryQuantityReview, projectInventoryQuantity } from './inventoryQuantityDomain';
import { assertMealCookingHistory, isMealCookingEventId } from './mealCookingEvents';
import { assertMealPlanExclusions } from './mealPlanDomain';

const SCHEMA_VERSION = 1;
const RECORD_SCHEMA_VERSION = 2;
const INVALID_DATA_MESSAGE = '저장된 식단 형식을 확인할 수 없습니다. 기존 자료는 지우지 않았습니다.';

function resolveScope(scope = 'guest') {
  const value = typeof scope === 'string' ? scope : scope?.scope;

  // User ids use the same safe characters as their existing ingredient database names.
  if (typeof value !== 'string' || (value !== 'guest' && !/^user:[a-zA-Z0-9_-]+$/.test(value))) {
    throw new Error('식단을 저장할 계정을 확인할 수 없습니다. 다시 로그인해주세요.');
  }

  return value;
}

function isDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function assertWeekStart(weekStart) {
  if (!isDate(weekStart) || new Date(`${weekStart}T12:00:00.000Z`).getUTCDay() !== 1) {
    throw new Error('식단의 시작 날짜를 확인해주세요. 한 주는 월요일부터 시작합니다.');
  }
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isTimestamp(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value));
}

function isNullableString(value) {
  return value === null || typeof value === 'string';
}

function isNullableAmount(value) {
  return value === null || (typeof value === 'number' && Number.isFinite(value) && value >= 0);
}

function isOptionalText(value) {
  return value === undefined || isNullableString(value);
}

function isComponentDetail(component) {
  const { source, processInputs, methodSummary } = component;
  const book = source.book;
  if (source.kind === 'mfds-book-source-comparison'
    && (!Array.isArray(processInputs) || !Array.isArray(methodSummary) || !isObject(book))) return false;
  return isOptionalText(source.reviewMethod) && isOptionalText(source.comparisonNote)
    && (methodSummary === undefined || (Array.isArray(methodSummary)
      && Array.from(methodSummary).every((step) => typeof step === 'string')))
    && (processInputs === undefined || (Array.isArray(processInputs)
      && Array.from(processInputs).every((line) => isObject(line)
        && typeof line.name === 'string' && Boolean(line.name.trim())
        && isOptionalText(line.id) && isOptionalText(line.ingredientKey) && isOptionalText(line.preparationState)
        && isNullableAmount(line.amount) && isNullableString(line.unit)
        && (line.optional === undefined || typeof line.optional === 'boolean')
        && (line.selected === undefined || typeof line.selected === 'boolean'))))
    && (book === undefined || (isObject(book) && typeof book.url === 'string'
      && Number.isSafeInteger(book.pdfPage) && book.pdfPage > 0
      && Array.isArray(book.printedPages) && book.printedPages.length > 0
      && Array.from(book.printedPages).every((page) => Number.isSafeInteger(page) && page > 0)));
}

function isIngredientLine(line) {
  return isObject(line)
    && typeof line.id === 'string' && typeof line.rawName === 'string' && Boolean(line.rawName.trim())
    && typeof line.normalizedName === 'string' && isNullableString(line.foodCode)
    && isNullableAmount(line.amount) && isNullableString(line.unit) && isNullableString(line.preparationState)
    && typeof line.quantityStatus === 'string' && typeof line.quantityReason === 'string'
    && isOptionalText(line.rawAmount) && isOptionalText(line.purpose)
    && typeof line.selected === 'boolean' && typeof line.optional === 'boolean'
    && Array.isArray(line.foodGroups) && Array.from(line.foodGroups).every((group) => typeof group === 'string');
}

function isComponent(component) {
  return isObject(component)
    && typeof component.id === 'string' && typeof component.recipeKey === 'string'
    && typeof component.recipeVersion === 'string' && typeof component.title === 'string'
    && ['staple', 'main', 'side'].includes(component.role)
    && isObject(component.source) && typeof component.source.kind === 'string'
    && typeof component.source.id === 'string' && typeof component.source.name === 'string'
    && isComponentDetail(component)
    && isNullableAmount(component.sourceServings) && isNullableAmount(component.servings)
    && typeof component.servingsStatus === 'string'
    && (component.nutrition === null || isObject(component.nutrition))
    && typeof component.nutritionStatus === 'string'
    && Array.isArray(component.ingredients) && component.ingredients.length > 0
    && Array.from(component.ingredients).every(isIngredientLine);
}

function isCooking(cooking) {
  if (!isObject(cooking) || Object.keys(cooking).length !== 5
    || typeof cooking.id !== 'string' || !/^cooking:[A-Za-z0-9_-]{1,120}$/.test(cooking.id)
    || !isTimestamp(cooking.recordedAt) || new Date(cooking.recordedAt).toISOString() !== cooking.recordedAt) return false;
  const hasConsumption = typeof cooking.consumptionId === 'string'
    && /^consumption:[A-Za-z0-9_-]{1,120}$/.test(cooking.consumptionId);
  const hasReversal = typeof cooking.reversalId === 'string'
    && /^consumption-reversal:[A-Za-z0-9_-]{1,120}$/.test(cooking.reversalId);
  return (cooking.inventoryStatus === 'applied' && hasConsumption && cooking.reversalId === null)
    || (cooking.inventoryStatus === 'needs-review' && cooking.consumptionId === null && cooking.reversalId === null)
    || (cooking.inventoryStatus === 'reversed' && hasConsumption && hasReversal);
}

function assertPlan(plan, scope, weekStart) {
  if (!isObject(plan) || plan.schemaVersion !== SCHEMA_VERSION) {
    throw new Error(plan?.schemaVersion > SCHEMA_VERSION
      ? '더 최신 버전에서 저장한 식단입니다. 앱을 새로고침한 뒤 다시 시도해주세요. 기존 자료는 유지됩니다.'
      : INVALID_DATA_MESSAGE);
  }
  if (plan.scope !== scope) throw new Error('다른 계정의 식단은 이 계정에 저장하거나 불러올 수 없습니다.');

  assertWeekStart(plan.weekStart);
  const preferences = plan.preferences;
  const validPreferences = isObject(preferences)
    && [1, 2].includes(preferences.servings)
    && Array.isArray(preferences.excludedIngredients)
    && Array.from(preferences.excludedIngredients).every((name) => typeof name === 'string')
    && Array.isArray(preferences.dinnerDays)
    && Array.from(preferences.dinnerDays).every((day) => Number.isInteger(day) && day >= 0 && day <= 6)
    && new Set(preferences.dinnerDays).size === preferences.dinnerDays.length;

  if (plan.weekStart !== weekStart || plan.id !== `week:${weekStart}` || !validPreferences
    || !Number.isSafeInteger(plan.revision) || plan.revision < 1
    || !isTimestamp(plan.createdAt) || !isTimestamp(plan.updatedAt)
    || !Array.isArray(plan.slots) || plan.slots.length !== 7) {
    throw new Error(INVALID_DATA_MESSAGE);
  }

  Array.from(plan.slots).forEach((slot, index) => {
    const date = new Date(`${weekStart}T12:00:00.000Z`);
    date.setUTCDate(date.getUTCDate() + index);
    const expectedDate = date.toISOString().slice(0, 10);
    if (!isObject(slot) || slot.date !== expectedDate || slot.id !== `${expectedDate}:dinner`
      || slot.mealType !== 'dinner' || !['planned', 'skipped', 'empty', 'cooked'].includes(slot.status)
      || (slot.status === 'cooked' ? !isCooking(slot.cooking) : Object.hasOwn(slot, 'cooking'))
      || typeof slot.locked !== 'boolean' || ![1, 2].includes(slot.servings)
      || !(slot.templateKey === null || typeof slot.templateKey === 'string')
      || !(slot.templateVersion === null || (Number.isSafeInteger(slot.templateVersion) && slot.templateVersion > 0))
      || typeof slot.title !== 'string' || typeof slot.reason !== 'string'
      || !(slot.notice === undefined || isNullableString(slot.notice))
      || !Array.isArray(slot.components) || !Array.from(slot.components).every(isComponent)
      || !Array.isArray(slot.foodGroups)
      || !Array.from(slot.foodGroups).every((group) => isObject(group) && typeof group.id === 'string' && typeof group.label === 'string')
      || (['planned', 'cooked'].includes(slot.status) && (!slot.templateKey || !slot.templateVersion || !slot.components.length || !slot.title.trim()))) {
      throw new Error(INVALID_DATA_MESSAGE);
    }
  });
  return plan;
}

export function assertMealPlanRecord(record, scope, weekStart) {
  if (record?.schemaVersion === SCHEMA_VERSION) {
    const legacy = assertPlan(record, scope, weekStart);
    // Reading old saved plans projects a draft; it never writes or confirms them.
    return {
      id: legacy.id, schemaVersion: RECORD_SCHEMA_VERSION, scope, weekStart,
      revision: legacy.revision, createdAt: legacy.createdAt, updatedAt: legacy.updatedAt,
      draft: legacy, confirmed: null, archives: []
    };
  }
  if (!isObject(record) || record.schemaVersion !== RECORD_SCHEMA_VERSION) {
    throw new Error(record?.schemaVersion > RECORD_SCHEMA_VERSION
      ? '더 최신 버전에서 저장한 식단입니다. 앱을 새로고침한 뒤 다시 시도해주세요. 기존 자료는 유지됩니다.'
      : INVALID_DATA_MESSAGE);
  }
  if (record.scope !== scope) throw new Error('다른 계정의 식단은 이 계정에 저장하거나 불러올 수 없습니다.');
  assertWeekStart(record.weekStart);
  if (record.id !== `week:${weekStart}` || record.weekStart !== weekStart
    || !Number.isSafeInteger(record.revision) || record.revision < 1
    || !isTimestamp(record.createdAt) || !isTimestamp(record.updatedAt)
    || !Array.isArray(record.archives)) {
    throw new Error(INVALID_DATA_MESSAGE);
  }
  const assertSnapshot = (plan) => {
    assertPlan(plan, scope, weekStart);
    if (plan.revision > record.revision) throw new Error(INVALID_DATA_MESSAGE);
  };
  if (record.draft !== null) assertSnapshot(record.draft);
  if (record.confirmed !== null) assertSnapshot(record.confirmed);
  Array.from(record.archives).forEach(assertSnapshot);
  return record;
}

function assertExpectedRevision(expectedRevision) {
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
    throw new Error('식단의 저장 버전을 확인할 수 없습니다. 다시 불러온 뒤 수정해주세요.');
  }
}

function sameStoredValue(left, right) {
  if (left === right) return true;
  if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object'
    || Array.isArray(left) !== Array.isArray(right)) return false;
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length
    && keys.every(key => Object.hasOwn(right, key) && sameStoredValue(left[key], right[key]));
}

function assertCookingPreserved(current, nextPlan) {
  nextPlan.slots.forEach((slot, index) => {
    const confirmed = current?.confirmed?.slots[index];
    // Only the atomic cooking workflow may create, cancel or change a cooking
    // record. Ordinary draft edits must keep the entire completed meal snapshot.
    if ((confirmed?.status === 'cooked' || slot.status === 'cooked') && !sameStoredValue(confirmed, slot)) {
      throw new Error('조리 기록이 있는 끼니는 일반 식단 수정으로 바꿀 수 없습니다. 최신 식단을 다시 불러오거나 조리 기록에서 취소해주세요.');
    }
  });
}

function localDate(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function preservesOverdueDemand(confirmed, candidate) {
  if (!candidate || !['planned', 'skipped'].includes(candidate.status)) return false;
  // A skip is an explicit resolution, but must retain the source recipe and its
  // quantities. Display notices and locking do not change the held demand.
  return ['id', 'date', 'mealType', 'servings', 'templateKey', 'templateVersion', 'title', 'components', 'foodGroups']
    .every(key => sameStoredValue(confirmed[key], candidate[key]));
}

export function getOverdueMealPlanDraftConflicts(record, today) {
  if (!isDate(today)) throw new Error('지난 끼니를 확인할 날짜가 올바르지 않습니다.');
  if (!record?.confirmed || !record.draft) return [];
  return record.confirmed.slots.filter((slot, index) => slot.status === 'planned' && slot.date < today
    && !preservesOverdueDemand(slot, record.draft.slots[index]));
}

function assertOverdueDemandPreserved(current, draft) {
  if (getOverdueMealPlanDraftConflicts({ confirmed: current?.confirmed, draft }, localDate()).length) {
    throw new Error('지난 미완료 끼니의 메뉴·분량은 일반 수정으로 바꿀 수 없습니다. 지난 끼니를 유지해 초안을 복구한 뒤 조리·건너뛰기·날짜 이동으로 확인해주세요.');
  }
}

function assertActiveCookingPreserved(record, events, scope) {
  const history = [];
  for (const event of events) {
    if (isMealCookingEventId(event?.id) || isMealCookingEventId(`${event?.kind}:`)) {
      history.push(event);
    } else if (event?.kind !== 'receipt' || event.scope !== scope || !/^receipt:[A-Za-z0-9_-]{1,120}$/.test(event.id)) {
      throw new Error('저장된 조리·소비 기록의 형식 또는 범위를 확인해주세요.');
    }
  }
  assertMealCookingHistory(history, scope);
  const cancelled = new Set(history.filter(event => event.kind === 'cooking-reversal').map(event => event.reversesId));
  for (const original of history.filter(event => event.kind === 'cooking')) {
    if (original.weekStart !== record.weekStart || cancelled.has(original.id)) continue;
    const slot = record.confirmed?.slots.find(item => item.id === original.slotId);
    if (slot?.status !== 'cooked' || slot.cooking.id !== original.id) {
      throw new Error('식단을 지워도 조리 기록은 남아 있어요. 해당 조리 기록을 취소한 뒤 식단을 다시 만들어주세요.');
    }
  }
}

async function updateRecord(weekStart, scope, expectedRevision, update) {
  let validationError;
  let saved;

  try {
    await runMealCookingTransaction('readwrite', ({ mealPlans, events }, transaction) => {
      const request = mealPlans.get(`week:${weekStart}`);
      const historyRequest = events.getAll();
      let remaining = 2;
      const ready = () => {
        remaining -= 1;
        if (remaining) return;
        try {
          const current = request.result === undefined ? null : assertMealPlanRecord(request.result, scope, weekStart);
          if ((current?.revision ?? 0) !== expectedRevision) {
            throw new Error('다른 화면에서 식단이 변경됐습니다. 다시 불러온 뒤 수정해주세요.');
          }
          const revision = expectedRevision + 1;
          if (!Number.isSafeInteger(revision)) throw new Error(INVALID_DATA_MESSAGE);
          saved = update(current, revision, new Date().toISOString());
          assertMealPlanRecord(saved, scope, weekStart);
          // A cleared plan does not clear cooking history. Read that history in
          // the same transaction so ordinary saves cannot resurrect its demand.
          assertActiveCookingPreserved(saved, historyRequest.result, scope);
          mealPlans.put(saved);
        } catch (error) {
          validationError = error;
          transaction.abort();
        }
      };
      request.onsuccess = ready;
      historyRequest.onsuccess = ready;
    }, scope);
  } catch (error) {
    throw validationError || error;
  }

  return saved;
}

export async function getMealPlan(weekStart, scope = 'guest') {
  const resolvedScope = resolveScope(scope);
  assertWeekStart(weekStart);
  const record = await runMealPlanTransaction('readonly', (store) => store.get(`week:${weekStart}`), resolvedScope);
  return record === undefined ? null : assertMealPlanRecord(record, resolvedScope, weekStart);
}

export async function getMealPlanningSnapshot(scope = 'guest') {
  const resolvedScope = resolveScope(scope);
  const { ingredients, mealPlans, quantityReviews } = await readMealPlanningSnapshot(resolvedScope);
  // Validate ignored drafts/archives too; a corrupt record must not silently vanish.
  const records = mealPlans.map((record) => assertMealPlanRecord(record, resolvedScope, record?.weekStart));
  const confirmedPlans = records
    .filter((record) => record.confirmed !== null)
    .map((record) => record.confirmed)
    .sort((left, right) => left.weekStart.localeCompare(right.weekStart));
  const reviewsById = new Map();
  // Orphaned and deleted-item reviews still belong to this scope and must be valid.
  for (const review of quantityReviews) {
    assertInventoryQuantityReview(review, resolvedScope, review?.id);
    if (reviewsById.has(review.id)) throw new Error('수량 확인 자료가 중복되어 있습니다.');
    reviewsById.set(review.id, review);
  }
  const inventory = ingredients.map((ingredient) => projectInventoryQuantity(ingredient, reviewsById.get(ingredient.id), resolvedScope));
  return { scope: resolvedScope, ingredients, inventory, confirmedPlans, quantityReviews };
}

export async function saveMealPlan(plan, scope = 'guest', expectedRevision) {
  const resolvedScope = resolveScope(scope);
  assertPlan(plan, resolvedScope, plan?.weekStart);
  assertExpectedRevision(expectedRevision);
  const snapshot = structuredClone(plan);
  return updateRecord(snapshot.weekStart, resolvedScope, expectedRevision, (current, revision, now) => {
    assertCookingPreserved(current, snapshot);
    assertOverdueDemandPreserved(current, snapshot);
    return {
      id: snapshot.id, schemaVersion: RECORD_SCHEMA_VERSION, scope: resolvedScope, weekStart: snapshot.weekStart,
      revision, createdAt: current?.createdAt ?? now, updatedAt: now,
      draft: { ...snapshot, revision, createdAt: current?.draft?.createdAt ?? now, updatedAt: now },
      confirmed: current?.confirmed ?? null, archives: current?.archives ?? []
    };
  });
}

export async function confirmMealPlan(weekStart, scope = 'guest', expectedRevision) {
  const resolvedScope = resolveScope(scope);
  assertWeekStart(weekStart);
  assertExpectedRevision(expectedRevision);
  return updateRecord(weekStart, resolvedScope, expectedRevision, (current, revision, now) => {
    if (!current?.draft) throw new Error('확정할 초안이 없습니다. 식단을 먼저 만들어주세요.');
    assertCookingPreserved(current, current.draft);
    assertOverdueDemandPreserved(current, current.draft);
    assertMealPlanExclusions(current.draft);
    // Confirmation records a menu choice, not verified quantities or inventory consumption.
    return {
      ...current, revision, updatedAt: now, draft: null, confirmed: current.draft,
      archives: current.confirmed ? [...current.archives, current.confirmed] : current.archives
    };
  });
}

export async function restoreOverdueMealPlanDraft(weekStart, scope = 'guest', expectedRevision) {
  const resolvedScope = resolveScope(scope);
  assertWeekStart(weekStart);
  assertExpectedRevision(expectedRevision);
  return updateRecord(weekStart, resolvedScope, expectedRevision, (current, revision, now) => {
    if (!current?.draft) throw new Error('복구할 초안이 없습니다. 최신 식단을 다시 불러와주세요.');
    const conflicts = getOverdueMealPlanDraftConflicts(current, localDate());
    if (!conflicts.length) throw new Error('복구할 지난 끼니 충돌이 없습니다. 최신 식단을 다시 불러와주세요.');
    const ids = new Set(conflicts.map(slot => slot.id));
    const draft = structuredClone(current.draft);
    draft.slots = draft.slots.map((slot, index) => ids.has(slot.id) ? structuredClone(current.confirmed.slots[index]) : slot);
    assertCookingPreserved(current, draft);
    assertOverdueDemandPreserved(current, draft);
    return { ...current, revision, updatedAt: now, draft: { ...draft, revision, updatedAt: now } };
  });
}

export function clearMealPlans(scope = 'guest') {
  return runMealPlanTransaction('readwrite', (store) => store.clear(), resolveScope(scope));
}
