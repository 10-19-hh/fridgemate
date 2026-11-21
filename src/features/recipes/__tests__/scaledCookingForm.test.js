import { describe, expect, it } from 'vitest';
import { buildConfirmedAvailability, getQuantityInputs } from '../scaledCookingForm.js';
import { calculateScaledCooking } from '../scaledCooking.js';
import { makeQuantityLine, makeQuantityRecipe } from './fixtures/scaledCookingFixtures.js';

const confirmation = {
  scope: 'guest', revision: 'confirmation-1', confirmedAt: '2026-09-15T10:00:00+09:00', mealDate: '2026-09-15',
};

describe('quantity confirmation form', () => {
  it('asks once for compatible repeated uses but preserves all source row links', () => {
    const recipe = makeQuantityRecipe({ ingredients: [
      makeQuantityLine(),
      makeQuantityLine({ id: 'pork-sauce', role: 'seasoning', amount: 30, section: 'sauce' }),
      makeQuantityLine({ id: 'pork-cooked', preparationState: 'cooked', amount: 40 }),
    ] });
    const before = structuredClone(recipe);
    const inputs = getQuantityInputs(recipe);
    expect(inputs).toHaveLength(2);
    expect(inputs[0]).toMatchObject({
      foodId: 'pork-front-leg', preparationState: 'raw', requestedAmount: 330,
      label: '돼지고기 앞다리살', role: 'core', required: true, unit: 'g', lineIds: ['pork-main', 'pork-sauce'],
    });
    expect(inputs[1]).toMatchObject({ preparationState: 'cooked', requestedAmount: 40 });
    expect(inputs[0].id).not.toBe(inputs[1].id);
    expect(recipe).toEqual(before);
  });

  it('does not offer unreviewed recipes or turn an unknown seasoning into zero', () => {
    expect(getQuantityInputs(makeQuantityRecipe({ servingsStatus: 'unverified' }))).toEqual([]);
    const inputs = getQuantityInputs(makeQuantityRecipe({ ingredients: [makeQuantityLine(), makeQuantityLine({
      id: 'salt', foodId: 'salt', rawName: '소금', role: 'seasoning', amount: null,
      unit: null, quantityStatus: 'unknown', quantityEvidence: null,
    })] }));
    expect(inputs[1]).toMatchObject({ requestedAmount: null, unit: null, label: '소금' });
  });

  it('keeps blank unknown and explicit zero confirmed in a per-meal snapshot', () => {
    const inputs = getQuantityInputs(makeQuantityRecipe());
    const amounts = { [inputs[0]?.id]: '  ', [inputs[1]?.id]: '0' };
    const before = structuredClone({ inputs, amounts });
    const result = buildConfirmedAvailability({ inputs, amounts, ...confirmation });
    expect(result.errors).toEqual([]);
    expect(result.inventory).toMatchObject({
      scope: 'guest', revision: 'confirmation-1', asOf: confirmation.confirmedAt,
      mealDate: '2026-09-15', basis: 'user-confirmed-for-meal',
    });
    expect(result.inventory?.items[0]).toMatchObject({ amount: null, quantityStatus: 'unknown', availabilityStatus: 'unknown' });
    expect(result.inventory?.items[1]).toMatchObject({ amount: 0, quantityStatus: 'confirmed', availabilityStatus: 'available' });
    expect({ inputs, amounts }).toEqual(before);
  });

  it('passes the entered precision to the real calculator without formatting it', () => {
    const recipe = makeQuantityRecipe();
    const inputs = getQuantityInputs(recipe);
    const result = buildConfirmedAvailability({
      inputs, amounts: { [inputs[0]?.id]: '201', [inputs[1]?.id]: '80.4' }, ...confirmation,
    });
    expect(result.inventory?.items.map((item) => item.amount)).toEqual([201, 80.4]);
    const calculated = calculateScaledCooking({ recipe, targetServings: 2, inventory: result.inventory });
    expect(calculated.status).toBe('scaled');
    expect(calculated.scaleFactor).toBe(0.67);
    expect(calculated.ingredients.map((line) => line.scaledAmount)).toEqual([201, 67]);
  });

  it.each(['-1', 'Infinity', 'NaN', '1g', '0x10', '1,000', '1.2.3', 20])('rejects malformed amount %j instead of silently parsing it', (value) => {
    const inputs = getQuantityInputs(makeQuantityRecipe());
    const result = buildConfirmedAvailability({ inputs, amounts: { [inputs[0]?.id]: value }, ...confirmation });
    expect(result.inventory).toBeNull();
    expect(result.errors).toEqual([{ inputId: inputs[0]?.id, code: 'invalid_amount' }]);
  });

  it.each([['.4', 0.4], ['2.6', 2.6], [' 1.40 ', 1.4], ['0.000001', 0.000001]])('preserves positive input %s without a minimum quantity', (value, amount) => {
    const inputs = getQuantityInputs(makeQuantityRecipe());
    const result = buildConfirmedAvailability({ inputs, amounts: { [inputs[0]?.id]: value }, ...confirmation });
    expect(result.errors).toEqual([]);
    expect(result.inventory?.items[0].amount).toBe(amount);
  });

  it('does not convert an unrepresentably small positive value to true zero', () => {
    const inputs = getQuantityInputs(makeQuantityRecipe());
    const result = buildConfirmedAvailability({ inputs, amounts: { [inputs[0]?.id]: `0.${'0'.repeat(350)}1` }, ...confirmation });
    expect(result.inventory).toBeNull();
    expect(result.errors).toEqual([{ inputId: inputs[0]?.id, code: 'invalid_amount' }]);
  });

  it('ignores no source uncertainty even if a value is supplied for an unknown unit', () => {
    const inputs = [{ id: 'sesame', foodId: 'sesame', preparationState: 'seed', requestedAmount: null, unit: null }];
    const result = buildConfirmedAvailability({ inputs, amounts: { sesame: '5' }, ...confirmation });
    expect(result.inventory?.items[0]).toMatchObject({ amount: null, quantityStatus: 'unknown', unit: null });
  });
});
