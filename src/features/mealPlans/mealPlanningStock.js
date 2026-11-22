const hasText = (value) => typeof value === 'string' && value.trim().length > 0;
const knownText = (value) => hasText(value) && !['unknown', 'unverified', '미확인'].includes(value.trim().toLowerCase());
const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const compareText = (left, right) => left < right ? -1 : left > right ? 1 : 0;

/** Unlike JSON.stringify, reject values/properties it would silently drop or coerce. */
function canonicalJson(value, ancestors = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (typeof value !== 'object' || ancestors.has(value)) throw new TypeError('계획 재고에는 JSON으로 보존할 수 있는 자료만 사용할 수 있습니다.');
  const array = Array.isArray(value);
  const prototype = Object.getPrototypeOf(value);
  if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) {
    throw new TypeError('계획 재고에는 일반 객체와 배열만 사용할 수 있습니다.');
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  if (keys.some((key) => typeof key !== 'string')) throw new TypeError('심볼 속성은 재고 기준에 사용할 수 없습니다.');
  const dataKeys = keys.filter((key) => !array || key !== 'length');
  if (dataKeys.some((key) => !descriptors[key].enumerable || !Object.hasOwn(descriptors[key], 'value'))) {
    throw new TypeError('계획 재고 속성은 숨겨지지 않은 데이터 값이어야 합니다.');
  }
  ancestors.add(value);
  try {
    if (array) {
      const length = descriptors.length.value;
      if (dataKeys.length !== length) throw new TypeError('비어 있는 배열 칸이나 배열의 추가 속성은 사용할 수 없습니다.');
      const entries = [];
      for (let index = 0; index < length; index += 1) {
        if (!Object.hasOwn(descriptors, index)) throw new TypeError('비어 있는 배열 칸은 사용할 수 없습니다.');
        entries.push(canonicalJson(descriptors[index].value, ancestors));
      }
      return `[${entries.join(',')}]`;
    }
    return `{${dataKeys.sort(compareText).map((key) => `${JSON.stringify(key)}:${canonicalJson(descriptors[key].value, ancestors)}`).join(',')}}`;
  } finally {
    ancestors.delete(value);
  }
}

/** Private change-detection token, not a quantity parser, hash or public identifier. */
export function getPlanningInventoryBasis(ingredients) {
  if (!Array.isArray(ingredients)) throw new TypeError('원재고 목록이 필요합니다.');
  canonicalJson(ingredients);
  const ids = new Set();
  for (const row of ingredients) {
    if (!isRecord(row) || !hasText(row.id) || ids.has(row.id)) throw new TypeError('원재고에는 중복되지 않는 문자열 ID가 필요합니다.');
    ids.add(row.id);
  }
  return canonicalJson([...ingredients].sort((left, right) => compareText(left.id, right.id)));
}

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

function invalid(code, ingredientId) {
  return { status: 'invalid', issues: [{ code, ...(ingredientId === undefined ? {} : { ingredientId }) }], items: [] };
}

function validConfirmation(value, asOf) {
  return isRecord(value) && hasText(value.ingredientId) && hasText(value.sourceBasis)
    && ['foodId', 'preparationState', 'unit'].every((key) => knownText(value[key]))
    && (value.amount === null || (Number.isFinite(value.amount) && value.amount >= 0))
    && ['confirmed', 'unknown'].includes(value.quantityStatus)
    && (value.quantityStatus !== 'confirmed' || value.amount !== null)
    && ['available', 'unknown', 'unavailable'].includes(value.availabilityStatus)
    && ['dated', 'no-expiry', 'unknown'].includes(value.expiryStatus)
    && (value.expiryDate === null || calendarDate(value.expiryDate))
    && (value.expiryStatus !== 'dated' || calendarDate(value.expiryDate))
    && (value.expiryStatus !== 'no-expiry' || value.expiryDate === null)
    && timestamp(value.confirmedAt) && Date.parse(value.confirmedAt) <= Date.parse(asOf);
}

/**
 * Validates explicit per-row user confirmations, never raw quantity text.
 * Partial confirmations are allowed; absent rows/foods are not confirmed zero.
 * A valid result is not proof of complete stock coverage or food safety.
 */
export function validatePlanningStockConfirmations(input) {
  try {
    canonicalJson(input);
  } catch {
    return invalid('invalid_stock_request');
  }
  if (!isRecord(input) || !Array.isArray(input.confirmations) || !timestamp(input.asOf)) return invalid('invalid_stock_request');
  const { ingredients, confirmations, asOf } = input;
  try {
    getPlanningInventoryBasis(ingredients);
  } catch {
    return invalid('invalid_inventory');
  }
  const rawById = new Map(ingredients.map((row) => [row.id, row]));
  const seen = new Set();
  const items = [];
  for (const entry of confirmations) {
    if (!validConfirmation(entry, asOf)) return invalid('invalid_stock_confirmation');
    const { ingredientId } = entry;
    if (seen.has(ingredientId)) return invalid('duplicate_stock_confirmation', ingredientId);
    seen.add(ingredientId);
    const raw = rawById.get(ingredientId);
    if (!raw) return invalid('inventory_item_missing', ingredientId);
    if (raw.consumed || raw.deletedAt) return invalid('inventory_item_inactive', ingredientId);
    if (getPlanningInventoryBasis([raw]) !== entry.sourceBasis) return invalid('stale_stock_confirmation', ingredientId);
    items.push({
      id: ingredientId, foodId: entry.foodId, preparationState: entry.preparationState,
      amount: entry.amount, unit: entry.unit, quantityStatus: entry.quantityStatus,
      availabilityStatus: entry.availabilityStatus, expiryStatus: entry.expiryStatus,
      expiryDate: entry.expiryDate, confirmedAt: entry.confirmedAt,
    });
  }
  return { status: 'valid', issues: [], items };
}
