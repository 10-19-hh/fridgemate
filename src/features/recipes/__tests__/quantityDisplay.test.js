import { describe, expect, it } from 'vitest';
import { formatQuantity } from '../quantityDisplay.js';

describe('formatQuantity', () => {
  it('shows a whole gram amount without changing the measured quantity', () => {
    expect(formatQuantity({ amount: 201, unit: 'g' })).toEqual({
      kind: 'exact', text: '201g', displayAmount: 201, unit: 'g'
    });
  });

  it.each([
    { amount: 2.6, unit: 'g', displayAmount: 2, text: '약 2g' },
    { amount: 201.99, unit: 'g', displayAmount: 201, text: '약 201g' },
    { amount: 1.9999999999999998, unit: 'g', displayAmount: 1, text: '약 1g' },
    { amount: 2.6, unit: 'ml', displayAmount: 2, text: '약 2ml' },
    { amount: 10.01, unit: 'ml', displayAmount: 10, text: '약 10ml' }
  ])('never rounds $amount $unit up beyond the calculated amount', ({ amount, unit, displayAmount, text }) => {
    expect(formatQuantity({ amount, unit })).toEqual({ kind: 'approximate', text, displayAmount, unit });
  });

  it.each([
    { amount: 0.4, unit: 'g', text: '1g 미만' },
    { amount: 0.4, unit: 'ml', text: '1ml 미만' },
    { amount: Number.MIN_VALUE, unit: 'g', text: '1g 미만' },
    { amount: 0.9999999999999999, unit: 'g', text: '1g 미만' }
  ])('does not turn positive $amount $unit into a numeric zero', ({ amount, unit, text }) => {
    expect(formatQuantity({ amount, unit })).toEqual({ kind: 'less-than', text, displayAmount: null, unit });
  });

  it.each([
    { amount: 1.4, unit: 'count', text: '1.4개' },
    { amount: 0.125, unit: 'count', text: '0.125개' }
  ])('labels count as 개 without discarding its fractional amount $amount', ({ amount, unit, text }) => {
    expect(formatQuantity({ amount, unit })).toEqual({ kind: 'exact', text, displayAmount: amount, unit });
  });

  it.each([
    { amount: 1.4, unit: '개', text: '1.4개' },
    { amount: 0.125, unit: '쪽', text: '0.125쪽' },
    { amount: 2.625, unit: '쪽', text: '2.625쪽' }
  ])('preserves all fractional digits for $amount $unit', ({ amount, unit, text }) => {
    expect(formatQuantity({ amount, unit })).toEqual({ kind: 'exact', text, displayAmount: amount, unit });
  });

  it.each([
    { amount: 0, unit: 'g', text: '0g' },
    { amount: 0, unit: 'ml', text: '0ml' },
    { amount: 1, unit: 'g', text: '1g' },
    { amount: 2, unit: 'ml', text: '2ml' }
  ])('does not mark exact $amount $unit as approximate or less-than', ({ amount, unit, text }) => {
    expect(formatQuantity({ amount, unit })).toEqual({ kind: 'exact', text, displayAmount: amount, unit });
  });

  it.each([
    { amount: null },
    { amount: undefined }
  ])('does not render a missing amount $amount as zero', ({ amount }) => {
    expect(formatQuantity({ amount, unit: 'g' })).toEqual({
      kind: 'unknown', text: '수량 미확인', displayAmount: null, unit: 'g'
    });
  });

  it.each([null, undefined, '', 'unknown', 'UNKNOWN', 'unverified', '미확인'])('does not infer a unit from %j', (unit) => {
    expect(formatQuantity({ amount: 10, unit })).toMatchObject({
      kind: 'unknown', text: '단위 미확인', displayAmount: null
    });
  });

  it.each(['봉', '모', '줌', 'kg', 'l', '큰술'])('keeps the source unit %s unconverted when unsupported', (unit) => {
    expect(formatQuantity({ amount: 0.5, unit })).toEqual({
      kind: 'unsupported', text: `단위 확인 필요 (${unit})`, displayAmount: null, unit
    });
  });

  it.each([-1, NaN, Infinity, -Infinity, '2.6', false])('rejects invalid amounts %j without coercion', (amount) => {
    expect(formatQuantity({ amount, unit: 'g' })).toEqual({
      kind: 'invalid', text: '수량 오류', displayAmount: null, unit: 'g'
    });
  });

  it('does not display negative zero as a distinct usable amount', () => {
    expect(formatQuantity({ amount: -0, unit: 'g' })).toEqual({
      kind: 'exact', text: '0g', displayAmount: 0, unit: 'g'
    });
  });

  it('handles a missing input as unconfirmed instead of throwing', () => {
    expect(formatQuantity()).toEqual({ kind: 'unknown', text: '수량 미확인', displayAmount: null, unit: null });
  });

  it('does not treat a non-string unit as a supported measurement', () => {
    expect(formatQuantity({ amount: 10, unit: 1 })).toEqual({
      kind: 'invalid', text: '단위 오류', displayAmount: null, unit: null
    });
  });

  it('does not write the conservative display amount back into the original calculation', () => {
    const calculation = Object.freeze({ amount: 2.6, unit: 'g' });
    const display = formatQuantity(calculation);
    expect(display.displayAmount).toBe(2);
    expect(calculation).toEqual({ amount: 2.6, unit: 'g' });
    display.displayAmount = 0;
    expect(formatQuantity(calculation).displayAmount).toBe(2);
  });
});
