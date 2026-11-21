const UNKNOWN_UNITS = new Set(['unknown', 'unverified', '미확인']);
const COUNT_UNITS = new Set(['개', '쪽', 'count']);

/**
 * UI-only formatting: never use displayAmount for allocation or consumption.
 * It can be conservatively lower than amount, or null for a positive amount
 * smaller than one g/ml. This helper never converts between source units.
 */
export function formatQuantity({ amount, unit } = {}) {
  const sourceUnit = typeof unit === 'string' ? unit : null;
  const result = (kind, text, displayAmount = null) => ({ kind, text, displayAmount, unit: sourceUnit });

  if (amount == null) return result('unknown', '수량 미확인');
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0) {
    return result('invalid', '수량 오류');
  }
  if (unit != null && typeof unit !== 'string') return result('invalid', '단위 오류');
  if (unit == null || !unit.trim() || UNKNOWN_UNITS.has(unit.trim().toLowerCase())) {
    return result('unknown', '단위 미확인');
  }

  if (COUNT_UNITS.has(unit)) {
    const displayUnit = unit === 'count' ? '개' : unit;
    return result('exact', `${amount}${displayUnit}`, amount === 0 ? 0 : amount);
  }
  if (unit !== 'g' && unit !== 'ml') return result('unsupported', `단위 확인 필요 (${unit})`);
  if (amount === 0) return result('exact', `0${unit}`, 0);
  if (amount < 1) return result('less-than', `1${unit} 미만`);

  const displayAmount = Math.floor(amount);
  return displayAmount === amount
    ? result('exact', `${displayAmount}${unit}`, displayAmount)
    : result('approximate', `약 ${displayAmount}${unit}`, displayAmount);
}
