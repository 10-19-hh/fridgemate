import { getMealQuantityRequirements } from './mealQuantityDomain';
import { getInventorySourceToken, validateInventoryQuantityValues } from './inventoryQuantityDomain';

const UNITS = { g: ['g', 1], kg: ['g', 1000], ml: ['ml', 1], l: ['ml', 1000], 개: ['개', 1] };
const PREPARATIONS = ['raw', 'cooked', 'as-sold'];
const text = value => typeof value === 'string' && Boolean(value.trim());
const included = line => !(line.optional === true && line.selected !== true);
const canonical = unit => Object.hasOwn(UNITS, unit) ? UNITS[unit][0] : null;

function eligible(item) {
  try {
    if (!item || item.consumed || item.deletedAt || item.quantityStatus !== 'verified'
      || !text(item.sourceToken) || !text(item.quantityEvidence) || !Number.isSafeInteger(item.quantityRevision)
      || item.quantityRevision < 1 || getInventorySourceToken(item) !== item.sourceToken || !(item.amount > 0)) return false;
    const checked = validateInventoryQuantityValues({ name: item.quantityName, amount: item.amount, unit: item.unit, preparationState: item.preparationState });
    return checked.ingredientKey === item.ingredientKey;
  } catch { return false; }
}

function mayUse(line, requirement) {
  return !text(line.ingredientKey) || (line.ingredientKey === requirement.ingredientKey
    && (!PREPARATIONS.includes(line.preparationState) || line.preparationState === requirement.preparationState)
    && (!canonical(line.unit) || canonical(line.unit) === requirement.unit));
}

function usableDate(expiryDate, cookingDate) {
  if (typeof expiryDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(expiryDate)) return false;
  const date = new Date(`${expiryDate}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === expiryDate && expiryDate >= cookingDate;
}

// This is a local stale-form comparison, never an analytics or authentication token.
export const mealCookingFormFingerprint = (slot, inventory) => JSON.stringify([slot, inventory]);

export function createMealCookingFormModel(slot, inventory) {
  const quantity = getMealQuantityRequirements(slot, slot.servings);
  const sourceLines = slot.components.flatMap(component => component.ingredients.map(line => ({ componentId: component.id, line })));
  const source = reference => sourceLines.find(item => item.componentId === reference.componentId && item.line.id === reference.lineId)?.line;
  const process = slot.components.flatMap(component => (component.processInputs || []).filter(included));
  const unresolvedLines = quantity.unverifiedLines.map(source);
  const masks = [...unresolvedLines, ...process];
  const requirements = quantity.requirements.map(requirement => ({ ...requirement,
    label: source(requirement.sourceLines[0])?.rawName || '재료 이름 확인 필요',
    amount: masks.some(line => mayUse(line, requirement)) ? null : requirement.amount,
  }));
  const rows = inventory.filter(eligible).map(item => ({ ingredientId: item.id, name: item.quantityName,
    ingredientKey: item.ingredientKey, availableAmount: item.amount, unit: item.unit, preparationState: item.preparationState,
    expiryDate: item.expiryDate || '', storageType: item.storageType || '', initialAmount: '',
    expectedRevision: item.quantityRevision, expectedSourceToken: item.sourceToken }));
  for (const requirement of requirements) {
    if (!(requirement.amount > 0)) continue;
    const matches = rows.filter(row => row.ingredientKey === requirement.ingredientKey
      && row.preparationState === requirement.preparationState && canonical(row.unit) === requirement.unit);
    if (matches.length !== 1) continue;
    const row = matches[0];
    const amount = requirement.amount / UNITS[row.unit][1];
    if (amount > row.availableAmount || !usableDate(row.expiryDate, slot.date)) continue;
    validateInventoryQuantityValues({ name: row.name, amount, unit: row.unit, preparationState: row.preparationState });
    row.initialAmount = String(amount);
  }
  return { fingerprint: mealCookingFormFingerprint(slot, inventory), requirements, rows, unavailableCount: inventory.length - rows.length,
    unresolved: [...unresolvedLines.map(line => ({ label: line.rawName, process: false })), ...process.map(line => ({ label: line.name, process: true }))],
    optional: sourceLines.filter(({ line }) => !included(line)).map(({ line }) => ({ label: line.rawName, rawAmount: line.rawAmount || '' })),
  };
}

export function createMealCookingPayload(model, amounts, completeUsageConfirmed) {
  if (completeUsageConfirmed !== true) throw Object.assign(new Error('실제로 쓴 재고를 모두 확인한 뒤 체크해 주세요.'), { field: 'confirmation' });
  const usages = [];
  for (const row of model.rows) {
    const value = amounts[row.ingredientId];
    if (value === undefined || value.trim() === '') continue;
    const amount = Number(value);
    try {
      validateInventoryQuantityValues({ name: row.name, amount, unit: row.unit, preparationState: row.preparationState });
      if (amount > row.availableAmount) throw new Error(`${row.name}: 실제 사용량이 확인된 남은 양보다 많아요. 냉장고에서 남은 양을 다시 확인해 주세요.`);
    } catch (error) { throw Object.assign(error, { ingredientId: row.ingredientId }); }
    if (amount === 0) continue;
    usages.push({ ingredientId: row.ingredientId, amount, unit: row.unit,
      expectedRevision: row.expectedRevision, expectedSourceToken: row.expectedSourceToken });
  }
  if (!usages.length) throw new Error('실제로 쓴 재고의 양을 하나 이상 입력하거나 사용량 없이 조리만 기록해 주세요.');
  return { usageMode: 'measured', completeUsageConfirmed: true, usages };
}
