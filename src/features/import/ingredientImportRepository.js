import { runInventoryQuantityTransaction } from '../../db/indexedDB';
import { assertInventoryQuantityReview, invalidateInventoryQuantityReview } from '../mealPlans/inventoryQuantityDomain';
import { compactIngredientTombstone, markIngredientAsPending, SYNC_STATE } from '../../utils/syncStrategy';

const INVALID = '가져오기 요청을 확인할 수 없습니다. 재료를 다시 검토해주세요.';
const CONFLICT = '재고 또는 확인한 가져오기 내용이 바뀌었습니다. 재료를 다시 검토해주세요.';
const STALE_SCOPE = '가져오기를 시작한 계정 상태가 바뀌었습니다. 다시 확인해주세요.';
const FAILED = '재료 가져오기를 저장하지 못했습니다. 같은 내용을 다시 시도해주세요.';
const ITEM_TEXT_FIELDS = ['quantity', 'category', 'storageType', 'purchaseDate', 'expiryDate', 'memo'];
const COMMAND_KEYS = ['scope', 'items', 'replacements', 'syncEnabled', 'now'];
const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
  && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
const hasId = (value) => typeof value === 'string' && value.trim().length > 0;
const identityKeys = (item) => [...new Set([item.id, item.clientId].filter(hasId))];

function assertArray(value, nonempty = false) {
  if (!Array.isArray(value) || (nonempty && !value.length) || value.length > 1000
      || Array.from({ length: value.length }, (_, index) => index).some((index) => !Object.hasOwn(value, index))) {
    throw new Error(INVALID);
  }
}

function assertHeader({ scope, syncEnabled, now }) {
  if (!(scope === 'guest' || (typeof scope === 'string' && /^user:[A-Za-z0-9_-]+$/.test(scope)))
      || typeof syncEnabled !== 'boolean' || typeof now !== 'string'
      || !Number.isFinite(Date.parse(now)) || new Date(now).toISOString() !== now) {
    throw new Error(INVALID);
  }
}

function prepareItem(item, now, syncEnabled) {
  if (!isRecord(item) || !hasId(item.name) || item.deletedAt
      || (item.id != null && !hasId(item.id))
      || (item.consumed != null && typeof item.consumed !== 'boolean')) throw new Error(INVALID);
  const id = item.id ?? crypto.randomUUID();
  // Fresh imports use a single identity so the per-id deletion marker also
  // rejects retries after an imported row has subsequently been deleted.
  if (item.clientId != null && item.clientId !== id) throw new Error(INVALID);
  const next = { id, clientId: id, name: item.name };
  for (const field of ITEM_TEXT_FIELDS) {
    if (item[field] !== undefined) {
      if (typeof item[field] !== 'string') throw new Error(INVALID);
      next[field] = item[field];
    }
  }
  next.consumed = item.consumed ?? false;
  next.createdAt = now;
  next.updatedAt = now;
  return syncEnabled ? markIngredientAsPending(next, SYNC_STATE.PENDING_CREATE) : next;
}

// Include every raw field (including memo) in the local compare-and-swap.
// This comparison is not a quantity sourceToken and is never logged or sent.
function sameStoredValue(left, right) {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
  } else if (!isRecord(left) || !isRecord(right)) return false;
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length
    && keys.every((key) => Object.hasOwn(right, key) && sameStoredValue(left[key], right[key]));
}

function assertIdentities(command) {
  const seen = new Set();
  for (const item of [...command.items, ...command.replacements]) {
    if (!isRecord(item) || !hasId(item.id) || item.deletedAt
        || (item.clientId != null && !hasId(item.clientId))
        || (item.scope != null && item.scope !== command.scope)) throw new Error(INVALID);
    for (const key of identityKeys(item)) {
      if (seen.has(key)) throw new Error(INVALID);
      seen.add(key);
    }
  }
}

export function prepareIngredientImport(input) {
  try {
    if (!isRecord(input)) throw new Error(INVALID);
    const { scope, items, replacements = [], syncEnabled = false, now = new Date().toISOString() } = input;
    assertHeader({ scope, syncEnabled, now });
    assertArray(items, true);
    assertArray(replacements);
    const command = { scope, items: items.map((item) => {
      if (item?.scope != null && item.scope !== scope) throw new Error(INVALID);
      return prepareItem(item, now, syncEnabled);
    }),
      replacements: structuredClone(replacements), syncEnabled, now };
    assertIdentities(command);
    return command;
  } catch {
    throw new Error(INVALID);
  }
}

function captureCommand(input) {
  try {
    if (!isRecord(input) || Object.keys(input).length !== COMMAND_KEYS.length
        || COMMAND_KEYS.some((key) => !Object.hasOwn(input, key))) throw new Error(INVALID);
    const command = structuredClone(input);
    assertHeader(command);
    assertArray(command.items, true);
    assertArray(command.replacements);
    assertIdentities(command);
    for (const item of command.items) {
      if (!sameStoredValue(item, prepareItem(item, command.now, command.syncEnabled))) throw new Error(INVALID);
    }
    return command;
  } catch {
    throw new Error(INVALID);
  }
}

function replacementTombstone(item, now) {
  return compactIngredientTombstone(item, { updatedAt: now, deletedAt: now, syncState: SYNC_STATE.PENDING_DELETE });
}

function checkReplay(command, currentById, reviewsById) {
  const existing = command.items.filter((item) => currentById.has(item.id));
  if (!existing.length) return false;
  if (existing.length !== command.items.length) throw new Error(CONFLICT);
  for (const item of command.items) {
    if (!sameStoredValue(currentById.get(item.id), item) || !reviewsById.has(item.id)) throw new Error(CONFLICT);
    // A later quantity confirmation is allowed; never invalidate it on retry.
    assertInventoryQuantityReview(reviewsById.get(item.id), command.scope, item.id);
  }
  for (const item of command.replacements) {
    const current = currentById.get(item.id);
    const completed = command.syncEnabled
      ? sameStoredValue(current, replacementTombstone(item, command.now)) : current === undefined;
    const review = reviewsById.get(item.id);
    if (!completed || !review || review.status !== 'unverified') throw new Error(CONFLICT);
    assertInventoryQuantityReview(review, command.scope, item.id);
  }
  return true;
}

export async function commitIngredientImport(input, { isCurrent = () => true } = {}) {
  // Clone before the first async boundary. Callers may edit their next review
  // while this command is waiting for the scoped database to open.
  const command = captureCommand(input);
  if (typeof isCurrent !== 'function') throw new Error(INVALID);
  let failure;
  try {
    return await runInventoryQuantityTransaction('readwrite', ({ ingredients, quantities }, transaction) => {
      const output = { result: undefined };
      const stockRead = ingredients.getAll();
      const reviewRead = quantities.getAll();
      let readCount = 0;
      const finishRead = () => {
        readCount += 1;
        if (readCount !== 2) return;
        try {
          let currentScope = false;
          try { currentScope = isCurrent() === true; } catch { /* Fail closed without reflecting callback errors. */ }
          if (!currentScope) throw new Error(STALE_SCOPE);
          const currentById = new Map(stockRead.result.map((item) => [item.id, item]));
          const reviewsById = new Map(reviewRead.result.map((review) => [review.id, review]));
          const replayed = checkReplay(command, currentById, reviewsById);
          const newKeys = new Set(command.items.flatMap(identityKeys));
          const newIds = new Set(command.items.map((item) => item.id));
          for (const current of stockRead.result) {
            if (replayed && newIds.has(current.id)) continue;
            if (identityKeys(current).some((key) => newKeys.has(key))) throw new Error(CONFLICT);
          }
          if (!replayed) {
            for (const item of command.items) {
              if (reviewsById.has(item.id)) throw new Error(CONFLICT);
            }
            for (const item of command.replacements) {
              if (!sameStoredValue(currentById.get(item.id), item)) throw new Error(CONFLICT);
            }
            // Validate and compute every sidecar before issuing the first write.
            const reviews = [...command.items, ...command.replacements].map((item) =>
              invalidateInventoryQuantityReview(reviewsById.get(item.id), command.scope, item.id));
            for (const item of command.items) {
              ingredients.add(item);
              currentById.set(item.id, item);
            }
            for (const item of command.replacements) {
              if (command.syncEnabled) {
                const tombstone = replacementTombstone(item, command.now);
                ingredients.put(tombstone);
                currentById.set(item.id, tombstone);
              } else {
                ingredients.delete(item.id);
                currentById.delete(item.id);
              }
            }
            for (const review of reviews) quantities.put(review);
          }
          const syncSnapshot = [...currentById.values()].sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
          output.result = { ingredients: syncSnapshot.filter((item) => !item.deletedAt), syncSnapshot,
            importedItems: command.items, replayed };
        } catch (error) {
          failure = [CONFLICT, STALE_SCOPE].includes(error?.message) ? error : new Error(FAILED);
          try { transaction.abort(); } catch { /* The failed request may already have aborted. */ }
        }
      };
      stockRead.onsuccess = finishRead;
      reviewRead.onsuccess = finishRead;
      // The DB wrapper releases this acknowledgement only on transaction completion.
      return output;
    }, command.scope);
  } catch {
    throw failure || new Error(FAILED);
  }
}
