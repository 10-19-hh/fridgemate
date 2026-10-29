import { normalizeIngredientName } from '../ingredients/ingredientDomain.js';
import { getCompositionHint, getMealFoodGroups } from '../nutrition/foodGroupRules.js';
import { ACTIVE_MEAL_PLAN_CATALOG_VERSION, getMealPlanCandidates } from './mealPlanCatalog.js';
import { PILOT_CANDIDATE_POLICY } from './mealPlanReviewPolicy.js';
import { isLocalPilotBuild } from '../../utils/pilotMode.js';

export { mealPlanCatalog } from './mealPlanCatalog.js';

const ALL_DINNER_DAYS = [0, 1, 2, 3, 4, 5, 6];
const NO_CANDIDATE_REASON = '제외한 재료를 피할 수 있는 메뉴가 없어요. 제외 재료를 조정해 주세요.';
const QUANTITY_CAUTION = '보유 표시는 재료명 기준이며 한 주에 필요한 분량을 보장하지 않아요. 조리 전 수량과 상태를 확인해 주세요.';

function parseCalendarDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year, month - 1, day, 12);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day ? date : null;
}

function formatCalendarDate(date) {
  return `${String(date.getFullYear()).padStart(4, '0')}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function addCalendarDays(dateString, numberOfDays) {
  const date = parseCalendarDate(dateString);
  if (!date || !Number.isInteger(numberOfDays)) throw new RangeError('올바른 날짜와 일수가 필요해요.');
  date.setDate(date.getDate() + numberOfDays);
  return formatCalendarDate(date);
}

export function getWeekStart(value = new Date()) {
  const date = typeof value === 'string' ? parseCalendarDate(value) : value instanceof Date ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) throw new RangeError('올바른 주 시작 날짜가 필요해요.');
  date.setDate(date.getDate() - (date.getDay() + 6) % 7);
  return formatCalendarDate(date);
}

function timestamp(now) {
  const date = now === undefined ? new Date() : new Date(now);
  if (Number.isNaN(date.getTime())) throw new RangeError('올바른 저장 시각이 필요해요.');
  return date.toISOString();
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizePreferences(preferences = {}) {
  return {
    servings: Number(preferences.servings) === 2 ? 2 : 1,
    excludedIngredients: [...new Set((Array.isArray(preferences.excludedIngredients) ? preferences.excludedIngredients : [])
      .filter((name) => typeof name === 'string')
      .map((name) => name.trim()).filter(Boolean))],
    dinnerDays: [...new Set((Array.isArray(preferences.dinnerDays) ? preferences.dinnerDays : ALL_DINNER_DAYS)
      .filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))].sort((a, b) => a - b),
  };
}

function ingredientKey(name) {
  return normalizeIngredientName(name).replace(/\s+/g, '').toLowerCase();
}

function getExcludedNames(components, excludedIngredients) {
  const excluded = new Set(excludedIngredients.map(ingredientKey));
  // Optional source ingredients are checked too. This is a conservative taste
  // filter, not an allergen screen for packaged sauces or cross-contact.
  return [...new Set(components.flatMap((component) => component.ingredients || [])
    .filter((line) => excluded.has(ingredientKey(line.rawName))
      || (typeof line.normalizedName === 'string' && excluded.has(ingredientKey(line.normalizedName))))
    .map((line) => line.rawName))];
}

/** Validate new approvals, not historical reads or editable drafts. Completed
 * and skipped meal snapshots retain their original ingredients and quantities. */
export function assertMealPlanExclusions(plan) {
  const conflicts = [...new Set(plan.slots.filter(slot => slot.status === 'planned')
    .flatMap(slot => getExcludedNames(slot.components, plan.preferences.excludedIngredients)))];
  if (conflicts.length) {
    throw new Error(`예정 메뉴에 제외 재료(${conflicts.join('·')})가 있어 확정할 수 없어요. 고정을 풀고 메뉴를 교체하거나 제외 조건을 조정해주세요.`);
  }
}

function getNeededNames(components = []) {
  const names = new Map();
  components.forEach((component) => (component.ingredients || []).forEach((line) => {
    if (line.selected && !names.has(ingredientKey(line.rawName))) names.set(ingredientKey(line.rawName), line.rawName);
  }));
  return [...names.values()];
}

function inventoryStatus(date, ingredients, pantryItems) {
  const available = new Set();
  const expiring = new Set();
  const unverifiedExpiry = new Set();
  ingredients.forEach((ingredient) => {
    if (!ingredient || ingredient.consumed || ingredient.deletedAt) return;
    const key = ingredientKey(ingredient.name || ingredient.normalizedName || '');
    if (!key) return;
    const expiry = ingredient.expiryDate;
    if (!parseCalendarDate(expiry)) {
      unverifiedExpiry.add(key);
      return;
    }
    if (expiry < date) return;
    available.add(key);
    if (expiry <= addCalendarDays(date, 3)) expiring.add(key);
  });
  pantryItems.forEach((item) => {
    const name = typeof item === 'string' ? item : item?.name;
    if (name) available.add(ingredientKey(name));
  });
  return { available, expiring, unverifiedExpiry };
}

export function getSlotSummary(slot, ingredients = [], pantryItems = []) {
  const foodGroups = getMealFoodGroups(slot?.components || []);
  const result = {
    availableIngredients: [], missingIngredients: [], expiringIngredients: [], unverifiedExpiryIngredients: [],
    foodGroups, compositionHint: getCompositionHint(foodGroups), quantityStatus: 'unverified',
    quantityCaution: QUANTITY_CAUTION, reason: slot?.notice || slot?.reason || '',
  };
  if (slot?.status === 'cooked') {
    result.reason = slot.cooking?.inventoryStatus === 'applied'
      ? '조리 완료를 기록하고 확인한 실제 사용량을 재고에 반영했어요.'
      : slot.cooking?.inventoryStatus === 'reversed'
        ? '조리 기록은 유지하고 재고 반영만 취소했어요. 남은 수량을 다시 확인해 주세요.'
        : '조리 기록만 저장했어요. 재고는 아직 반영하지 않아 확인이 필요해요.';
    result.quantityCaution = '완료된 끼니는 앞으로 사용할 재료 계산에 포함하지 않아요.';
    return result;
  }
  if (!slot || slot.status !== 'planned' || !parseCalendarDate(slot.date)) return result;

  const state = inventoryStatus(slot.date, ingredients, pantryItems);
  getNeededNames(slot.components).forEach((name) => {
    const key = ingredientKey(name);
    if (state.available.has(key)) result.availableIngredients.push(name);
    else if (state.unverifiedExpiry.has(key)) result.unverifiedExpiryIngredients.push(name);
    else result.missingIngredients.push(name);
    if (state.available.has(key) && state.expiring.has(key)) result.expiringIngredients.push(name);
  });
  const currentReason = result.expiringIngredients.length
    ? `식사일에 기한이 가까운 ${result.expiringIngredients.slice(0, 2).join('·')} 활용을 제안해요. 수량과 상태를 확인해 주세요.`
    : result.availableIngredients.length
      ? `보유한 ${result.availableIngredients.slice(0, 2).join('·')}에 맞춘 메뉴예요. 필요한 분량은 확인해 주세요.`
      : '장보기를 고려한 메뉴 제안이에요. 필요한 재료와 분량을 확인해 주세요.';
  const expiryCaution = result.unverifiedExpiryIngredients.length
    ? ' 기한 미확인 재료는 조리일까지 사용할 수 있는지 확인해 주세요.' : '';
  result.reason = slot.notice || `${currentReason}${expiryCaution}`;
  return result;
}

function effectiveCandidatePolicy(requested) {
  // Only an explicit replay input carries policy across builds. Reading a
  // previously saved plan never changes the current build's default policy.
  return requested ?? (isLocalPilotBuild() ? PILOT_CANDIDATE_POLICY : null);
}

function noCandidateReason(candidatePolicy, defaultReason = NO_CANDIDATE_REASON) {
  return candidatePolicy === null ? defaultReason
    : '검수 기준과 제외 재료 조건에 맞는 메뉴가 없어요. 조건을 확인해 주세요.';
}

function eligibleTemplates(preferences, candidatePolicy) {
  return getMealPlanCandidates(effectiveCandidatePolicy(candidatePolicy))
    .filter((candidate) => !getExcludedNames(candidate.components, preferences.excludedIngredients).length);
}

function tieBreaker(key) {
  return [...key].reduce((hash, character) => (hash * 31 + character.charCodeAt(0)) >>> 0, 0);
}

function chooseTemplate({ date, candidates, ingredients, pantryItems, usedKeys, revision }) {
  return candidates.map((candidate) => {
    const summary = getSlotSummary({ ...candidate, date, status: 'planned' }, ingredients, pantryItems);
    const requiredCount = getNeededNames(candidate.components).length;
    const usedCount = usedKeys.filter((key) => key === candidate.key).length;
    const score = (summary.availableIngredients.length / Math.max(1, requiredCount)) * 100
      + Math.min(summary.expiringIngredients.length, 3) * 15
      - summary.missingIngredients.length * 2
      - usedCount * 85
      + summary.foodGroups.length;
    return { candidate, score, tie: tieBreaker(`${date}:${revision}:${candidate.key}`) };
  }).sort((a, b) => b.score - a.score || a.tie - b.tie)[0]?.candidate || null;
}

function baseSlot(date, servings) {
  return {
    id: `${date}:dinner`, date, mealType: 'dinner', status: 'empty', locked: false,
    servings, templateKey: null, templateVersion: null, title: '', components: [], foodGroups: [], reason: '', notice: null,
  };
}

function plannedSlot(date, servings, candidate, ingredients, pantryItems, emptyReason = NO_CANDIDATE_REASON) {
  if (!candidate) return { ...baseSlot(date, servings), reason: emptyReason };
  const slot = {
    ...baseSlot(date, servings), status: 'planned', templateKey: candidate.key, templateVersion: candidate.version,
    title: candidate.title, components: clone(candidate.components), foodGroups: clone(candidate.foodGroups),
    catalogVersion: candidate.catalogVersion, foodGroupRuleVersion: candidate.foodGroupRuleVersion,
  };
  const summary = getSlotSummary(slot, ingredients, pantryItems);
  slot.reason = summary.reason;
  return slot;
}

function confirmedOverdueSlots(confirmedPlan, scope, weekStart, today) {
  if (!confirmedPlan) return new Map();
  assertChangePlan(confirmedPlan);
  if (confirmedPlan.scope !== scope || confirmedPlan.weekStart !== weekStart) {
    throw new Error('같은 계정과 주의 확정 식단을 전달해주세요.');
  }
  return new Map(confirmedPlan.slots.filter(slot => slot.status === 'planned' && slot.date < today).map(slot => [slot.id, slot]));
}

export function generateMealPlan({ weekStart, preferences, ingredients = [], pantryItems = [], scope = 'guest', previousPlan = null, confirmedPlan = null, candidatePolicy, now } = {}) {
  const start = getWeekStart(weekStart || new Date());
  const previous = previousPlan?.weekStart === start && previousPlan.scope === scope ? previousPlan : null;
  const normalized = normalizePreferences(preferences || previous?.preferences);
  const revision = (previous?.revision || 0) + 1;
  const updatedAt = timestamp(now);
  const today = formatCalendarDate(new Date(updatedAt));
  const overdue = confirmedOverdueSlots(confirmedPlan, scope, start, today);
  const selectionPolicy = effectiveCandidatePolicy(candidatePolicy);
  const candidates = eligibleTemplates(normalized, selectionPolicy);
  const preservedSlots = (previous?.slots || []).filter((slot, day) => {
    const explicitlyRestored = normalized.dinnerDays.includes(day) && !previous.preferences.dinnerDays.includes(day);
    return slot.status === 'cooked' || slot.locked || (slot.status === 'skipped' && !explicitlyRestored);
  });
  for (const confirmed of overdue.values()) {
    const draft = previous?.slots.find(slot => slot.id === confirmed.id);
    const preserved = draft?.status === 'skipped' ? draft : confirmed;
    const index = preservedSlots.findIndex(slot => slot.id === confirmed.id);
    if (index < 0) preservedSlots.push(preserved);
    else preservedSlots[index] = preserved;
  }
  const usedKeys = preservedSlots.filter((slot) => ['planned', 'cooked'].includes(slot.status)).map((slot) => slot.templateKey);
  const slots = ALL_DINNER_DAYS.map((day) => {
    const date = addCalendarDays(start, day);
    const preserved = preservedSlots.find((slot) => slot.date === date);
    if (preserved) {
      if (preserved.status === 'cooked' || overdue.has(preserved.id)) return structuredClone(preserved);
      const slot = { ...clone(preserved), servings: normalized.servings, notice: null };
      const excludedNames = getExcludedNames(slot.components, normalized.excludedIngredients);
      if (slot.locked && excludedNames.length) {
        slot.reason = `고정한 메뉴에 제외 재료(${excludedNames.join('·')})가 있어요. 고정을 풀고 교체해 주세요.`;
        slot.notice = slot.reason;
      } else if (slot.locked && !normalized.dinnerDays.includes(day)) {
        slot.reason = '집에서 먹지 않는 날로 바꿨지만 고정 메뉴를 보존했어요. 원하면 직접 건너뛰어 주세요.';
        slot.notice = slot.reason;
      }
      return slot;
    }
    if (!normalized.dinnerDays.includes(day)) {
      return { ...baseSlot(date, normalized.servings), status: 'skipped', reason: '이날 저녁은 계획에서 건너뛰었어요.' };
    }
    const candidate = chooseTemplate({ date, candidates, ingredients, pantryItems, usedKeys, revision });
    const slot = plannedSlot(date, normalized.servings, candidate, ingredients, pantryItems, noCandidateReason(selectionPolicy));
    if (candidate) usedKeys.push(candidate.key);
    return slot;
  });
  const replayPrevious = previous ? clone({
    weekStart: previous.weekStart, scope: previous.scope, revision: previous.revision,
    preferences: previous.preferences, slots: previous.slots, createdAt: previous.createdAt,
  }) : null;
  if (replayPrevious && overdue.size) {
    // Explicit skips retain the complete protected meal, including optional source fields.
    replayPrevious.slots = replayPrevious.slots.map((slot, index) => overdue.has(slot.id) && slot.status === 'skipped'
      ? structuredClone(previous.slots[index]) : slot);
  }
  return {
    id: `week:${start}`, schemaVersion: 1, catalogVersion: ACTIVE_MEAL_PLAN_CATALOG_VERSION,
    engineVersion: 'weekly-dinner-rules-v3',
    generationInput: {
      ...(selectionPolicy === null ? {} : { candidatePolicy: selectionPolicy }),
      ...clone({
        weekStart: start, scope, preferences: normalized, now: updatedAt,
        ingredients: ingredients.map((item) => item ? {
          name: item.name, normalizedName: item.normalizedName, expiryDate: item.expiryDate,
          consumed: item.consumed, deletedAt: item.deletedAt,
        } : null),
        pantryItems: pantryItems.map((item) => typeof item === 'string' ? item : { name: item?.name }),
      }),
      previousPlan: replayPrevious,
      ...(confirmedPlan ? { confirmedPlan: structuredClone({
        weekStart: confirmedPlan.weekStart, scope: confirmedPlan.scope, revision: confirmedPlan.revision,
        preferences: confirmedPlan.preferences, slots: confirmedPlan.slots, createdAt: confirmedPlan.createdAt,
      }) } : {}),
    },
    scope, weekStart: start, preferences: normalized, slots, revision,
    createdAt: previous?.createdAt || updatedAt, updatedAt,
  };
}

function updateSlot(plan, slotId, transform, now, preferences = plan.preferences) {
  if (!plan.slots.some((slot) => slot.id === slotId)) return plan;
  return {
    ...plan, preferences, slots: plan.slots.map((slot) => slot.id === slotId ? transform(slot) : slot),
    revision: plan.revision + 1, updatedAt: timestamp(now),
  };
}

export function replaceMealPlanSlot(plan, slotId, { ingredients = [], pantryItems = [], confirmedPlan = null, now } = {}) {
  const overdue = confirmedOverdueSlots(confirmedPlan, plan.scope, plan.weekStart, formatCalendarDate(new Date(timestamp(now))));
  const slot = plan.slots.find((item) => item.id === slotId);
  if (!slot || slot.status === 'cooked') return plan;
  if (overdue.has(slot.id)) return plan;
  if (slot.locked || slot.status === 'skipped') {
    return updateSlot(plan, slotId, (item) => ({ ...item, notice: item.locked ? '고정을 풀면 다른 메뉴로 바꿀 수 있어요.' : '건너뛰기를 해제하면 메뉴를 고를 수 있어요.' }), now);
  }
  const selectionPolicy = effectiveCandidatePolicy();
  const candidates = eligibleTemplates(plan.preferences, selectionPolicy).filter((candidate) => candidate.key !== slot.templateKey);
  const candidate = chooseTemplate({
    date: slot.date, candidates, ingredients, pantryItems, revision: plan.revision + 1,
    usedKeys: plan.slots.filter((item) => item.id !== slotId && item.status === 'planned').map((item) => item.templateKey),
  });
  const emptyReason = noCandidateReason(selectionPolicy, '현재 조건에 맞는 다른 메뉴가 없어요. 제외 재료를 조정해 주세요.');
  return updateSlot(plan, slotId, (item) => candidate
    ? plannedSlot(item.date, item.servings, candidate, ingredients, pantryItems)
    : { ...item, reason: emptyReason, notice: emptyReason }, now);
}

export function toggleMealPlanSlotLock(plan, slotId, { now } = {}) {
  const slot = plan.slots.find((item) => item.id === slotId);
  if (!slot || slot.status !== 'planned') return plan;
  return updateSlot(plan, slotId, (item) => ({ ...item, locked: !item.locked, notice: null }), now);
}

export function setMealPlanSlotSkipped(plan, slotId, skipped, { ingredients = [], pantryItems = [], now } = {}) {
  const index = plan.slots.findIndex((item) => item.id === slotId);
  if (index < 0 || plan.slots[index].status === 'cooked' || plan.slots[index].locked) return plan;
  const selectionPolicy = effectiveCandidatePolicy();
  const candidates = skipped ? [] : eligibleTemplates(plan.preferences, selectionPolicy);
  if (!skipped && selectionPolicy !== null && !candidates.length) {
    return updateSlot(plan, slotId, slot => ({ ...slot, notice: noCandidateReason(selectionPolicy) }), now);
  }
  const dinnerDays = skipped
    ? plan.preferences.dinnerDays.filter((day) => day !== index)
    : [...new Set([...plan.preferences.dinnerDays, index])].sort((a, b) => a - b);
  return updateSlot(plan, slotId, (slot) => {
    if (skipped) return { ...slot, status: 'skipped', locked: false, notice: null, reason: '이날 저녁은 계획에서 건너뛰었어요.' };
    const eligibleSnapshot = selectionPolicy === null || candidates.some(candidate => candidate.key === slot.templateKey
      && candidate.version === slot.templateVersion && candidate.catalogVersion === slot.catalogVersion
      && JSON.stringify(candidate.components) === JSON.stringify(slot.components));
    if (slot.templateKey && eligibleSnapshot && !getExcludedNames(slot.components, plan.preferences.excludedIngredients).length) {
      return { ...slot, status: 'planned', locked: false, notice: null, reason: '이전에 골랐던 메뉴를 되살렸어요. 재료와 분량을 다시 확인해 주세요.' };
    }
    const candidate = chooseTemplate({
      date: slot.date, candidates, ingredients, pantryItems,
      usedKeys: plan.slots.filter((item) => item.id !== slotId && item.status === 'planned').map((item) => item.templateKey),
      revision: plan.revision + 1,
    });
    return plannedSlot(slot.date, slot.servings, candidate, ingredients, pantryItems);
  }, now, { ...plan.preferences, dinnerDays });
}

function assertChangeDate(today) {
  if (!parseCalendarDate(today)) throw new RangeError('변경 기준 날짜를 확인해 주세요.');
}

function assertChangePlan(plan) {
  if (!plan || typeof plan.scope !== 'string'
    || (plan.scope !== 'guest' && !/^user:[a-zA-Z0-9_-]+$/.test(plan.scope))
    || !parseCalendarDate(plan.weekStart) || getWeekStart(plan.weekStart) !== plan.weekStart
    || !Array.isArray(plan.slots) || plan.slots.length !== 7
    || !plan.preferences || ![1, 2].includes(plan.preferences.servings)
    || !Array.isArray(plan.preferences.excludedIngredients)
    || !Array.isArray(plan.preferences.dinnerDays)
    || !Number.isSafeInteger(plan.revision) || plan.revision < 1
    || plan.slots.some((slot, index) => !slot || slot.date !== addCalendarDays(plan.weekStart, index)
      || slot.id !== `${slot.date}:dinner` || slot.mealType !== 'dinner')) {
    throw new TypeError('변경할 식단의 범위와 날짜를 확인해 주세요.');
  }
}

function assertMovableSlot(slot, today, allowOverdueSource = false) {
  if (!slot) throw new Error('이동할 식사 날짜를 찾을 수 없어요.');
  if (slot.date < today && !allowOverdueSource) throw new Error('지난 날짜는 도착일로 지정하거나 메뉴를 교환할 수 없어요.');
  if (slot.status === 'cooked') throw new Error('조리 기록이 있는 메뉴는 이동할 수 없어요.');
  if (slot.locked) throw new Error('고정을 먼저 풀어야 메뉴를 이동할 수 있어요.');
}

function assertDestinationPreferences(slot, destination) {
  if (slot.servings !== destination.preferences.servings) {
    throw new Error('두 날짜의 인원이 달라요. 같은 인분의 식단 사이에서 이동해 주세요.');
  }
  if (getExcludedNames(slot.components, destination.preferences.excludedIngredients).length) {
    throw new Error('이동할 메뉴에 도착하는 주의 제외 재료가 있어요. 조건을 확인해 주세요.');
  }
}

function relocatedSlot(slot, destination) {
  return { ...structuredClone(slot), id: destination.id, date: destination.date,
    reason: '날짜를 옮긴 메뉴예요. 새 식사일의 재료와 기한을 다시 확인해 주세요.', notice: null };
}

function changeDescription(before, after) {
  return { date: before.date, before: structuredClone(before), after: structuredClone(after) };
}

/** Propose a date move; callers must preview and atomically confirm all returned weeks. */
export function moveMealPlanSlot({ sourcePlan, targetPlan = sourcePlan, sourceSlotId, targetSlotId,
  mode, today, now } = {}) {
  assertChangeDate(today);
  assertChangePlan(sourcePlan);
  assertChangePlan(targetPlan);
  if (sourcePlan.scope !== targetPlan.scope) throw new Error('다른 계정의 식단으로 이동할 수 없어요.');
  const sameWeek = sourcePlan.weekStart === targetPlan.weekStart;
  if (sameWeek && sourcePlan !== targetPlan && JSON.stringify(sourcePlan) !== JSON.stringify(targetPlan)) {
    throw new Error('같은 주의 서로 다른 식단이 전달됐어요. 최신 식단을 다시 불러와 주세요.');
  }
  if (!['move', 'swap'].includes(mode)) throw new Error('메뉴 이동 또는 날짜 교환을 명시적으로 선택해 주세요.');
  const source = sourcePlan.slots.find(slot => slot.id === sourceSlotId);
  const target = targetPlan.slots.find(slot => slot.id === targetSlotId);
  assertMovableSlot(source, today, mode === 'move');
  assertMovableSlot(target, today);
  if (source.status !== 'planned') throw new Error('계획된 메뉴만 다른 날짜로 이동할 수 있어요.');
  if (source.id === target.id) return { plans: [sourcePlan], changes: [], notices: ['같은 날짜여서 식단을 유지했어요.'] };
  if (mode === 'swap' ? target.status !== 'planned' : !['empty', 'skipped'].includes(target.status)) {
    throw new Error('메뉴가 있는 날짜는 교환을, 비어 있거나 건너뛴 날짜는 이동을 선택해 주세요.');
  }
  assertDestinationPreferences(source, targetPlan);
  if (mode === 'swap') assertDestinationPreferences(target, sourcePlan);

  const moved = relocatedSlot(source, target);
  const released = mode === 'swap' ? relocatedSlot(target, source)
    : { ...structuredClone(source), status: 'skipped', notice: null,
      reason: `${target.date}로 메뉴를 옮겨 이날의 예정 사용량을 해제했어요.` };
  const updatedAt = timestamp(now);
  const originals = sameWeek ? [sourcePlan] : [sourcePlan, targetPlan];
  const plans = originals.map(original => {
    const result = structuredClone(original);
    result.slots = result.slots.map(slot => slot.id === source.id ? structuredClone(released)
      : slot.id === target.id ? structuredClone(moved) : slot);
    const dinnerDays = new Set(result.preferences.dinnerDays);
    result.slots.forEach((slot, index) => {
      if (slot.id === source.id && mode === 'move') dinnerDays.delete(index);
      if (slot.id === target.id) dinnerDays.add(index);
    });
    result.preferences.dinnerDays = [...dinnerDays].sort((a, b) => a - b);
    result.revision += 1;
    result.updatedAt = updatedAt;
    return result;
  });
  return { plans, changes: [changeDescription(source, released), changeDescription(target, moved)]
    .sort((a, b) => a.date.localeCompare(b.date)),
  notices: [mode === 'swap' ? '두 날짜의 메뉴를 서로 교환하는 변경안이에요.'
    : target.status === 'skipped' ? '도착 날짜의 외식·건너뛰기를 해제하고 출발 날짜는 건너뛰어요.'
      : '비어 있던 날짜로 메뉴를 옮기고 출발 날짜는 건너뛰어요.',
  '새 날짜 기준으로 전체 확정 식단의 재료·기한·장보기 차이를 확인한 뒤 적용해 주세요.'] };
}

function sameMeal(left, right) {
  return ['status', 'templateKey', 'templateVersion', 'title', 'servings', 'catalogVersion', 'foodGroupRuleVersion']
    .every(key => left[key] === right[key])
    && JSON.stringify(left.components) === JSON.stringify(right.components)
    && JSON.stringify(left.foodGroups) === JSON.stringify(right.foodGroups);
}

/** Reuse the rule-based ranking without changing protected meals or writing inventory. */
export function readjustRemainingMealPlan(plan, { today, ingredients = [], pantryItems = [], candidatePolicy, now } = {}) {
  assertChangeDate(today);
  assertChangePlan(plan);
  const canChange = (slot, index) => slot.date >= today && !slot.locked
    && ['planned', 'empty'].includes(slot.status) && plan.preferences.dinnerDays.includes(index);
  const selectionPolicy = effectiveCandidatePolicy(candidatePolicy);
  const candidates = eligibleTemplates(plan.preferences, selectionPolicy);
  if (!plan.slots.some(canChange)) return { plan, changes: [], notices: ['다시 맞출 수 있는 남은 메뉴가 없어 기존 식단을 유지했어요.'] };
  if (!candidates.length) return { plan, changes: [], notices: [noCandidateReason(selectionPolicy), '기존 식단은 그대로 보존했어요.'] };
  const usedKeys = plan.slots.filter((slot, index) => !canChange(slot, index) && ['planned', 'cooked'].includes(slot.status))
    .map(slot => slot.templateKey);
  const changes = [];
  const slots = plan.slots.map((slot, index) => {
    if (!canChange(slot, index)) return structuredClone(slot);
    const candidate = chooseTemplate({ date: slot.date, candidates, ingredients, pantryItems, usedKeys, revision: plan.revision + 1 });
    usedKeys.push(candidate.key);
    const next = plannedSlot(slot.date, slot.servings, candidate, ingredients, pantryItems);
    if (sameMeal(slot, next)) return structuredClone(slot);
    changes.push(changeDescription(slot, next));
    return next;
  });
  if (!changes.length) return { plan, changes, notices: ['현재 조건에서 메뉴 변경이 없어 기존 식단을 유지했어요.'] };
  const updatedAt = timestamp(now);
  // Replaying must preserve all plan metadata, but not recursively copy earlier
  // generation inputs. Those inputs do not participate in the ranking.
  const previousPlan = structuredClone(plan);
  delete previousPlan.generationInput;
  return { plan: { ...structuredClone(plan), slots, revision: plan.revision + 1, updatedAt,
    engineVersion: 'weekly-dinner-rules-v3', catalogVersion: ACTIVE_MEAL_PLAN_CATALOG_VERSION,
    generationInput: structuredClone({ operation: 'readjust-remaining', today, weekStart: plan.weekStart,
      ...(selectionPolicy === null ? {} : { candidatePolicy: selectionPolicy }),
      scope: plan.scope, preferences: plan.preferences, now: updatedAt,
      ingredients: ingredients.map(item => item ? { name: item.name, normalizedName: item.normalizedName,
        expiryDate: item.expiryDate, consumed: item.consumed, deletedAt: item.deletedAt } : null),
      pantryItems: pantryItems.map(item => typeof item === 'string' ? item : { name: item?.name }),
      previousPlan }) },
  changes, notices: ['완료·고정·외식·지난 날짜는 그대로 두고 남은 메뉴의 변경안을 만들었어요. 아직 확정하지 않았어요.'] };
}
