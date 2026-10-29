import { getInventorySourceToken, validateInventoryQuantityValues } from './inventoryQuantityDomain';

const UNITS = { g: ['g', 1], kg: ['g', 1000], ml: ['ml', 1], l: ['ml', 1000], 개: ['개', 1] };
const ORIGINAL_STOCK_ERROR = '원래 사용한 재고의 이름·상태·남은 양을 냉장고에서 먼저 확인해 주세요. 일부만 정정하지 않아요.';
const text = value => typeof value === 'string' && Boolean(value.trim());
const check = row => ({ ingredientId: row.ingredientId, expectedRevision: row.expectedRevision, expectedSourceToken: row.expectedSourceToken });
const ticks = (amount, unit) => Math.round(amount * UNITS[unit][1] * 1000);

// Local stale-form comparison only; never sent to analytics or a server.
export const mealConsumptionCorrectionFingerprint = (consumption, inventory) => JSON.stringify([consumption, inventory]);

function eligible(item) {
  try {
    if (!item || item.consumed || item.deletedAt || item.quantityStatus !== 'verified'
      || !text(item.sourceToken) || !text(item.quantityEvidence) || !Number.isSafeInteger(item.quantityRevision)
      || item.quantityRevision < 1 || getInventorySourceToken(item) !== item.sourceToken) return false;
    const values = validateInventoryQuantityValues({ name: item.quantityName, amount: item.amount, unit: item.unit, preparationState: item.preparationState });
    return values.ingredientKey === item.ingredientKey;
  } catch { return false; }
}

export function createMealConsumptionCorrectionModel(consumption, inventory) {
  const oldLines = consumption.lines;
  const rows = inventory.filter(item => eligible(item) && (item.amount > 0 || oldLines.some(line => line.inventoryId === item.id)))
    .map(item => {
      const old = oldLines.find(line => line.inventoryId === item.id);
      const oldAmount = old && UNITS[old.unit]?.[0] === UNITS[item.unit][0] ? old.amount * UNITS[old.unit][1] / UNITS[item.unit][1] : 0;
      return { ingredientId: item.id, name: item.quantityName, ingredientKey: item.ingredientKey,
        currentAmount: item.amount, oldAmount, unit: item.unit, preparationState: item.preparationState,
        expiryDate: item.expiryDate || '', storageType: item.storageType || '',
        initialAmount: old ? String(oldAmount) : '', expectedRevision: item.quantityRevision, expectedSourceToken: item.sourceToken };
    });
  const missing = oldLines.some(line => {
    const row = rows.find(item => item.ingredientId === line.inventoryId);
    return !row || row.ingredientKey !== line.ingredientKey || row.preparationState !== line.preparationState
      || UNITS[row.unit][0] !== UNITS[line.unit]?.[0];
  });
  return { rows, previousLines: oldLines, expectedConsumptionId: consumption.id,
    fingerprint: mealConsumptionCorrectionFingerprint(consumption, inventory),
    blockedReason: missing ? ORIGINAL_STOCK_ERROR : '', unavailableCount: inventory.length - rows.length };
}

export function getMealConsumptionCorrectionPreview(model, amounts) {
  if (model.blockedReason) throw new Error(model.blockedReason);
  return model.rows.map(row => {
    try {
      const value = amounts[row.ingredientId];
      const amount = value === undefined || value.trim() === '' ? 0 : Number(value);
      validateInventoryQuantityValues({ name: row.name, amount, unit: row.unit, preparationState: row.preparationState });
      const available = ticks(row.currentAmount, row.unit) + ticks(row.oldAmount, row.unit);
      if (!Number.isSafeInteger(available)) throw new Error('정정 후 재고량을 안전하게 계산할 수 없어요. 남은 양을 다시 확인해 주세요.');
      const remaining = available - ticks(amount, row.unit);
      if (remaining < 0) throw new Error(`${row.name}: 정정할 사용량이 현재 재고와 기존 사용량을 합친 양보다 많아요.`);
      const remainingAmount = remaining / 1000 / UNITS[row.unit][1];
      validateInventoryQuantityValues({ name: row.name, amount: remainingAmount, unit: row.unit, preparationState: row.preparationState });
      return { ...row, amount, remainingAmount };
    } catch (error) { throw Object.assign(error, { ingredientId: row.ingredientId }); }
  });
}

export function createMealConsumptionCorrectionPayload(model, amounts, completeUsageConfirmed) {
  if (model.blockedReason) throw new Error(model.blockedReason);
  if (completeUsageConfirmed !== true) throw Object.assign(new Error('정정할 실제 사용량을 모두 확인한 뒤 체크해 주세요.'), { field: 'confirmation' });
  const preview = getMealConsumptionCorrectionPreview(model, amounts);
  return { expectedConsumptionId: model.expectedConsumptionId, completeUsageConfirmed: true,
    inventory: model.previousLines.map(line => check(model.rows.find(row => row.ingredientId === line.inventoryId))),
    usages: preview.filter(row => row.amount > 0).map(row => ({ ...check(row), amount: row.amount, unit: row.unit })) };
}
