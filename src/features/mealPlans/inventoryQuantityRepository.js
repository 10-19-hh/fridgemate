import { readMealPlanningSnapshot, runInventoryQuantityTransaction } from '../../db/indexedDB';
import {
  assertInventoryQuantityReview, createInventoryQuantityReview,
  invalidateInventoryQuantityReview, projectInventoryQuantity,
} from './inventoryQuantityDomain';

function resolveScope(scope = 'guest') {
  const value = typeof scope === 'string' ? scope : scope?.scope;
  if (typeof value !== 'string' || (value !== 'guest' && !/^user:[A-Za-z0-9_-]+$/.test(value))) {
    throw new Error('수량을 확인할 계정을 확인할 수 없습니다. 다시 로그인해주세요.');
  }
  return value;
}

export async function getInventoryQuantitySnapshot(scopeOrOptions = 'guest') {
  const scope = resolveScope(scopeOrOptions);
  const { ingredients, quantityReviews } = await readMealPlanningSnapshot(scope);
  const reviewsById = new Map();
  for (const review of quantityReviews) {
    assertInventoryQuantityReview(review, scope, review?.id);
    if (reviewsById.has(review.id)) throw new Error('수량 확인 자료가 중복되어 있습니다.');
    reviewsById.set(review.id, review);
  }
  return {
    scope, ingredients, quantityReviews,
    inventory: ingredients.map((ingredient) => projectInventoryQuantity(ingredient, reviewsById.get(ingredient.id), scope)),
  };
}

async function writeQuantityReview(input, revoke) {
  const scope = resolveScope(input?.scope);
  const { ingredientId, expectedRevision, expectedSourceToken } = input || {};
  const values = input?.values ? { ...input.values } : null;
  if (typeof ingredientId !== 'string' || !ingredientId.trim() ||
      !Number.isSafeInteger(expectedRevision) || expectedRevision < 0 ||
      typeof expectedSourceToken !== 'string' || !expectedSourceToken) {
    throw new Error('수량 확인 요청이 올바르지 않습니다. 목록을 새로고침해주세요.');
  }
  let failure;
  try {
    return await runInventoryQuantityTransaction('readwrite', ({ ingredients, quantities }, transaction) => {
      const output = { result: undefined };
      const ingredientRequest = ingredients.get(ingredientId);
      const reviewRequest = quantities.get(ingredientId);
      let completed = 0;
      const finishRead = () => {
        completed += 1;
        if (completed !== 2) return;
        try {
          const ingredient = ingredientRequest.result;
          const review = reviewRequest.result;
          if (!ingredient || ingredient.consumed || ingredient.deletedAt) {
            throw new Error('현재 남아 있는 재고만 확인할 수 있습니다. 목록을 새로고침해주세요.');
          }
          const projected = projectInventoryQuantity(ingredient, review, scope);
          if (projected.sourceToken !== expectedSourceToken || projected.quantityRevision !== expectedRevision) {
            throw new Error('재고 또는 확인한 수량이 바뀌었습니다. 목록을 새로고침해주세요.');
          }
          const next = revoke
            ? invalidateInventoryQuantityReview(review, scope, ingredientId)
            : createInventoryQuantityReview({ ingredient, scope, values,
              revision: projected.quantityRevision + 1, now: new Date().toISOString() });
          quantities.put(next);
          output.result = next;
        } catch (error) {
          failure = error;
          try { transaction.abort(); } catch { /* A failed request may have already aborted. */ }
        }
      };
      ingredientRequest.onsuccess = finishRead;
      reviewRequest.onsuccess = finishRead;
      // The DB helper only exposes this result after transaction completion.
      return output;
    }, scope);
  } catch (error) {
    throw failure || error;
  }
}

export function saveInventoryQuantity(input) {
  return writeQuantityReview(input, false);
}

export function revokeInventoryQuantity(input) {
  return writeQuantityReview(input, true);
}
