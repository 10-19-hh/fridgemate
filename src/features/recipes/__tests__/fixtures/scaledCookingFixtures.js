// Synthetic arithmetic fixtures only. These are NOT reviewed cooking recipes
// and must never be imported by the application or published in the catalog.
export function makeQuantityLine(overrides = {}) {
  return {
    id: 'pork-main', foodId: 'pork-front-leg', rawName: '돼지고기 앞다리살',
    rawText: '돼지고기 앞다리살 300g', section: 'main', preparationState: 'raw',
    role: 'core', required: true, selected: true,
    amount: 300, unit: 'g', quantityStatus: 'verified',
    quantityEvidence: 'Synthetic test evidence; not a reviewed recipe.',
    ...overrides,
  };
}

export function makeQuantityRecipe(overrides = {}) {
  return {
    id: 'test-only:pork-onion', version: 'test-v1',
    source: { kind: 'test-fixture', id: 'arithmetic-1', name: 'Synthetic test only' },
    servings: 2, servingsStatus: 'verified', servingsEvidence: 'Synthetic two-portion fixture.',
    ingredients: [
      makeQuantityLine(),
      makeQuantityLine({ id: 'onion-main', foodId: 'onion', rawName: '양파', rawText: '양파 100g', amount: 100 }),
    ],
    ...overrides,
  };
}

export function makeAvailableItem(overrides = {}) {
  return {
    id: 'pork-batch', foodId: 'pork-front-leg', preparationState: 'raw',
    amount: 201, unit: 'g', quantityStatus: 'confirmed',
    availabilityStatus: 'available', confirmedAt: '2026-09-15T09:00:00+09:00',
    ...overrides,
  };
}

export function makeAvailabilitySnapshot(overrides = {}) {
  return {
    scope: 'guest', revision: 'inventory-test-v1', asOf: '2026-09-15T09:00:00+09:00',
    mealDate: '2026-09-15', basis: 'user-confirmed-for-meal',
    items: [makeAvailableItem(), makeAvailableItem({ id: 'onion-batch', foodId: 'onion', amount: 80 })],
    ...overrides,
  };
}
