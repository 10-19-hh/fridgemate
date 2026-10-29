const SOURCE_FIELDS = [
  'id', 'clientId', 'name', 'quantity', 'purchaseDate', 'expiryDate',
  'category', 'storageType', 'consumed', 'deletedAt', 'createdAt', 'updatedAt',
];
const UNIT_FACTORS = { g: 1, kg: 1000, ml: 1, l: 1000, 개: 1 };
const PREPARATION_STATES = new Set(['raw', 'cooked', 'as-sold']);
const hasText = (value) => typeof value === 'string' && value.trim().length > 0;
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

function assertIdentity(scope, id) {
  if (!(scope === 'guest' || (typeof scope === 'string' && /^user:[A-Za-z0-9_-]+$/.test(scope))) || !hasText(id)) {
    throw new Error('재고 수량 확인의 저장 범위 또는 식별자 형식이 올바르지 않습니다.');
  }
}

function assertRevision(revision) {
  if (!Number.isSafeInteger(revision) || revision < 1) {
    throw new Error('재고 수량 확인의 버전 형식이 올바르지 않습니다.');
  }
}

function assertTimestamp(value) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) {
    throw new Error('재고 수량 확인 시각의 형식이 올바르지 않습니다.');
  }
}

export function validateInventoryQuantityValues(values) {
  if (!isObject(values) || !hasText(values.name) || values.name.trim().length > 120 ||
      typeof values.unit !== 'string' || !Object.hasOwn(UNIT_FACTORS, values.unit) || !PREPARATION_STATES.has(values.preparationState) ||
      typeof values.amount !== 'number' || !Number.isFinite(values.amount) || values.amount < 0) {
    throw new Error('재료 이름, 남은 양, 단위와 조리 상태를 확인해주세요.');
  }
  const scaled = values.amount * UNIT_FACTORS[values.unit] * 1000;
  const integer = Math.round(scaled);
  const tolerance = Math.min(1e-7, Number.EPSILON * Math.max(1, Math.abs(scaled)) * 4);
  if ((values.amount > 0 && integer === 0) || !Number.isSafeInteger(integer) || Math.abs(scaled - integer) > tolerance ||
      Math.round((integer / 1000) * 1000) !== integer) {
    throw new Error('확인한 양을 지원하는 정밀도 안에서 정확하게 표현할 수 없습니다.');
  }
  const name = values.name.trim();
  return { name, ingredientKey: `food:${name.replace(/\s+/g, '')}`,
    amount: values.amount, unit: values.unit, preparationState: values.preparationState };
}

// This private comparison value contains raw inventory data, not an authentication
// credential. Keep it local; never send it to analytics or application logs.
export function getInventorySourceToken(ingredient) {
  if (!isObject(ingredient) || !hasText(ingredient.id)) {
    throw new Error('재고 원본의 형식이 올바르지 않습니다.');
  }
  return JSON.stringify(SOURCE_FIELDS.map((field) => ingredient[field] ?? null));
}

export function assertInventoryQuantityReview(review, scope, id) {
  assertIdentity(scope, id);
  if (!isObject(review) || review.schemaVersion !== 1 || review.scope !== scope || review.id !== id ||
      !['verified', 'unverified'].includes(review.status)) {
    throw new Error('저장된 재고 수량 확인의 형식 또는 범위가 올바르지 않습니다.');
  }
  assertRevision(review.revision);
  if (review.status === 'verified') {
    const values = validateInventoryQuantityValues(review);
    if (values.ingredientKey !== review.ingredientKey || !hasText(review.sourceToken)) {
      throw new Error('저장된 재고 수량 확인의 원본 연결이 올바르지 않습니다.');
    }
    assertTimestamp(review.confirmedAt);
  }
  return review;
}

export function createInventoryQuantityReview({ ingredient, scope, values, revision, now }) {
  const sourceToken = getInventorySourceToken(ingredient);
  assertIdentity(scope, ingredient.id);
  assertRevision(revision);
  assertTimestamp(now);
  if (!hasText(ingredient.name) || ingredient.consumed || ingredient.deletedAt ||
      (ingredient.scope != null && ingredient.scope !== scope)) {
    throw new Error('현재 범위의 사용 가능한 재고만 수량을 확인할 수 있습니다.');
  }
  return { schemaVersion: 1, id: ingredient.id, scope, revision, status: 'verified',
    sourceToken, ...validateInventoryQuantityValues(values), confirmedAt: now };
}

export function invalidateInventoryQuantityReview(review, scope, id) {
  assertIdentity(scope, id);
  if (review != null) assertInventoryQuantityReview(review, scope, id);
  const revision = (review?.revision ?? 0) + 1;
  assertRevision(revision);
  // Keep the revision to reject stale forms, but discard all former food details.
  return { schemaVersion: 1, id, scope, revision, status: 'unverified' };
}

export function projectInventoryQuantity(ingredient, review, scope) {
  const sourceToken = getInventorySourceToken(ingredient);
  assertIdentity(scope, ingredient.id);
  if (ingredient.scope != null && ingredient.scope !== scope) {
    throw new Error('다른 범위의 재고 수량을 사용할 수 없습니다.');
  }
  if (review != null) assertInventoryQuantityReview(review, scope, ingredient.id);
  const wasVerified = review?.status === 'verified';
  const isCurrent = wasVerified && review.sourceToken === sourceToken && !ingredient.consumed && !ingredient.deletedAt;
  return { ...ingredient, sourceToken, quantityRevision: review?.revision ?? 0,
    quantityState: isCurrent ? 'verified' : wasVerified ? 'stale' : 'unverified',
    quantityStatus: isCurrent ? 'verified' : 'unverified',
    quantityName: isCurrent ? review.name : null,
    quantityConfirmedAt: isCurrent ? review.confirmedAt : null,
    ingredientKey: isCurrent ? review.ingredientKey : null,
    amount: isCurrent ? review.amount : null,
    unit: isCurrent ? review.unit : null,
    preparationState: isCurrent ? review.preparationState : null,
    quantityEvidence: isCurrent ? `user-confirmation:${review.revision}:${review.confirmedAt}` : null };
}
