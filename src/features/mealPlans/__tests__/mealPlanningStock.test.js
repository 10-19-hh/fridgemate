import { describe, expect, it } from 'vitest';
import { getPlanningInventoryBasis, validatePlanningStockConfirmations } from '../mealPlanningStock.js';

const AS_OF = '2026-09-16T12:00:00.000+09:00';
const RAW_ONION = { id: 'onion', name: '양파', quantity: '반 봉', consumed: false, deletedAt: null };
const ONION_BASIS = '[{"consumed":false,"deletedAt":null,"id":"onion","name":"양파","quantity":"반 봉"}]';
const CONFIRMATION = {
  ingredientId: 'onion', sourceBasis: ONION_BASIS,
  foodId: 'onion', preparationState: 'raw', amount: 125.5, unit: 'g',
  quantityStatus: 'confirmed', availabilityStatus: 'available',
  expiryStatus: 'dated', expiryDate: '2026-09-20', confirmedAt: '2026-09-16T11:00:00.000+09:00',
};
const EXPECTED_ITEM = {
  id: 'onion', foodId: 'onion', preparationState: 'raw', amount: 125.5, unit: 'g',
  quantityStatus: 'confirmed', availabilityStatus: 'available',
  expiryStatus: 'dated', expiryDate: '2026-09-20', confirmedAt: '2026-09-16T11:00:00.000+09:00',
};

function validate(overrides = {}) {
  return validatePlanningStockConfirmations({ ingredients: [RAW_ONION], confirmations: [CONFIRMATION], asOf: AS_OF, ...overrides });
}

function confirmation(overrides = {}) {
  return { ...CONFIRMATION, ...overrides };
}

function deepFreeze(value) {
  Object.values(value).forEach((child) => {
    if (child && typeof child === 'object') deepFreeze(child);
  });
  return Object.freeze(value);
}

describe('getPlanningInventoryBasis', () => {
  it('sorts ids and nested object keys while preserving the raw quantity text and array order', () => {
    const ingredients = [
      { quantity: '반 모', id: 'b', meta: { z: null, a: [2, { y: true, x: '원문' }] } },
      { name: '양파', id: 'a' },
    ];
    const expected = '[{"id":"a","name":"양파"},{"id":"b","meta":{"a":[2,{"x":"원문","y":true}],"z":null},"quantity":"반 모"}]';
    expect(getPlanningInventoryBasis(ingredients)).toBe(expected);
    expect(getPlanningInventoryBasis([
      { id: 'a', name: '양파' },
      { meta: { a: [2, { x: '원문', y: true }], z: null }, id: 'b', quantity: '반 모' },
    ])).toBe(expected);
  });

  it('represents an empty snapshot distinctly from missing input', () => {
    expect(getPlanningInventoryBasis([])).toBe('[]');
    expect(() => getPlanningInventoryBasis()).toThrow(TypeError);
  });

  it.each([
    ['name', '다른 양파'], ['quantity', '1봉'], ['consumed', true],
    ['deletedAt', '2026-09-16T03:00:00Z'], ['memo', 'new note'],
    ['expiryDate', '2026-09-17'], ['updatedAt', '2026-09-16T02:00:00Z'],
  ])('detects changes to %s, including consumed and deleted records', (field, value) => {
    expect(getPlanningInventoryBasis([RAW_ONION])).toBe(ONION_BASIS);
    expect(getPlanningInventoryBasis([{ ...RAW_ONION, [field]: value }])).not.toBe(ONION_BASIS);
  });

  it('does not mutate frozen data and does not mistake shared objects for cycles', () => {
    const shared = { quantity: '한 줌' };
    const data = deepFreeze([{ id: 'b', meta: shared }, { id: 'a', meta: shared }]);
    expect(getPlanningInventoryBasis(data)).toBe('[{"id":"a","meta":{"quantity":"한 줌"}},{"id":"b","meta":{"quantity":"한 줌"}}]');
    expect(data.map((row) => row.id)).toEqual(['b', 'a']);
  });

  it.each([
    ['non-array', {}], ['null list', null], ['null row', [null]], ['array row', [[]]],
    ['missing id', [{ name: '양파' }]], ['empty id', [{ id: '  ' }]], ['numeric id', [{ id: 1 }]],
    ['duplicate id', [{ id: 'a' }, { id: 'a', name: 'different' }]],
    ['undefined', [{ id: 'a', meta: undefined }]], ['NaN', [{ id: 'a', amount: NaN }]],
    ['infinity', [{ id: 'a', amount: Infinity }]], ['negative infinity', [{ id: 'a', amount: -Infinity }]],
    ['bigint', [{ id: 'a', amount: 1n }]], ['function', [{ id: 'a', meta: () => 1 }]],
    ['symbol value', [{ id: 'a', meta: Symbol('hidden') }]],
    ['date object', [{ id: 'a', meta: new Date('2026-09-16T00:00:00Z') }]],
    ['map', [{ id: 'a', meta: new Map([['key', 'value']]) }]],
    ['sparse list', new Array(1)], ['sparse nested array', [{ id: 'a', meta: new Array(1) }]],
  ])('rejects %s instead of silently omitting or converting data', (_label, ingredients) => {
    expect(() => getPlanningInventoryBasis(ingredients)).toThrow(TypeError);
  });

  it('rejects cycles, symbol keys and non-enumerable data without omitting them', () => {
    const cyclic = { id: 'cycle' };
    cyclic.meta = cyclic;
    expect(() => getPlanningInventoryBasis([cyclic])).toThrow(TypeError);
    expect(() => getPlanningInventoryBasis([{ id: 'symbol', [Symbol('key')]: 1 }])).toThrow(TypeError);
    const hidden = Object.defineProperty({ id: 'hidden' }, 'meta', { value: 'private' });
    expect(() => getPlanningInventoryBasis([hidden])).toThrow(TypeError);
    const arrayWithExtra = Object.assign([], { note: 'would disappear' });
    expect(() => getPlanningInventoryBasis([{ id: 'extra', meta: arrayWithExtra }])).toThrow(TypeError);
  });

  it('rejects getters without invoking them', () => {
    let accessed = false;
    const row = { id: 'getter', get quantity() { accessed = true; return '1g'; } };
    expect(() => getPlanningInventoryBasis([row])).toThrow(TypeError);
    expect(accessed).toBe(false);
  });

  it('keeps JSON object keys such as __proto__ and uses deterministic lexical key order', () => {
    const row = JSON.parse('{"id":"a","meta":{"2":"two","10":"ten","__proto__":{"z":1,"a":2}}}');
    expect(getPlanningInventoryBasis([row])).toBe('[{"id":"a","meta":{"10":"ten","2":"two","__proto__":{"a":2,"z":1}}}]');
  });
});

describe('validatePlanningStockConfirmations', () => {
  it('projects only explicitly confirmed rows and preserves the literal user-confirmed amount', () => {
    const result = validate({
      ingredients: [RAW_ONION, { id: 'tofu', name: '두부', quantity: '200g' }],
      confirmations: [confirmation({ memo: 'do not send to allocator', ingredientId: 'onion' })],
    });
    expect(result).toEqual({ status: 'valid', issues: [], items: [EXPECTED_ITEM] });
    expect(result.items[0]).not.toHaveProperty('sourceBasis');
    expect(result.items[0]).not.toHaveProperty('ingredientId');
    expect(result.items[0]).not.toHaveProperty('memo');
  });

  it('accepts no confirmations without promoting any raw inventory quantity', () => {
    expect(validate({ confirmations: [] })).toEqual({ status: 'valid', issues: [], items: [] });
    expect(validate({ ingredients: [], confirmations: [] })).toEqual({ status: 'valid', issues: [], items: [] });
  });

  it.each([
    ['confirmed zero', { amount: 0 }, { amount: 0, quantityStatus: 'confirmed' }],
    ['tiny positive', { amount: Number.MIN_VALUE }, { amount: Number.MIN_VALUE, quantityStatus: 'confirmed' }],
    ['unknown blank', { amount: null, quantityStatus: 'unknown' }, { amount: null, quantityStatus: 'unknown' }],
    ['unknown numeric', { amount: 75, quantityStatus: 'unknown' }, { amount: 75, quantityStatus: 'unknown' }],
    ['explicit unavailable', { amount: null, quantityStatus: 'unknown', availabilityStatus: 'unavailable' }, { amount: null, availabilityStatus: 'unavailable' }],
    ['unknown expiry', { expiryStatus: 'unknown', expiryDate: null }, { expiryStatus: 'unknown', expiryDate: null }],
    ['unconfirmed recorded expiry', { expiryStatus: 'unknown', expiryDate: '2026-09-20' }, { expiryStatus: 'unknown', expiryDate: '2026-09-20' }],
    ['explicit no expiry', { expiryStatus: 'no-expiry', expiryDate: null }, { expiryStatus: 'no-expiry', expiryDate: null }],
    ['ml unchanged', { unit: 'ml' }, { amount: 125.5, unit: 'ml' }],
    ['pack unit unchanged', { unit: '봉' }, { amount: 125.5, unit: '봉' }],
  ])('preserves %s without upgrading uncertainty or converting units', (_label, fields, expected) => {
    const result = validate({ confirmations: [confirmation(fields)] });
    expect(result.status).toBe('valid');
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject(expected);
  });

  it('compares timestamps by actual instant while requiring a real ISO calendar date', () => {
    const equalInstant = validate({ confirmations: [confirmation({ confirmedAt: '2026-09-16T03:00:00Z' })] });
    expect(equalInstant.status).toBe('valid');
    expect(equalInstant.items[0].confirmedAt).toBe('2026-09-16T03:00:00Z');
    const leapDay = validate({ asOf: '2028-02-29T12:00:00Z', confirmations: [confirmation({ confirmedAt: '2028-02-29T12:00:00Z', expiryDate: '2028-02-29' })] });
    expect(leapDay.status).toBe('valid');
  });

  it.each([
    ['changed quantity', { quantity: '다른 수량' }], ['changed name', { name: '적양파' }],
    ['new memo', { memo: '장보기 메모' }], ['new expiry', { expiryDate: '2026-09-17' }],
    ['new update time', { updatedAt: '2026-09-16T02:00:00Z' }],
  ])('rejects a confirmation with a stale source binding after %s', (_label, fields) => {
    const result = validate({ ingredients: [{ ...RAW_ONION, ...fields }] });
    expect(result).toEqual({ status: 'invalid', issues: [{ code: 'stale_stock_confirmation', ingredientId: 'onion' }], items: [] });
  });

  it.each([
    ['consumed', { consumed: true }], ['deleted', { deletedAt: '2026-09-16T03:00:00Z' }],
  ])('rejects %s inventory even with an up-to-date source binding', (_label, fields) => {
    const raw = { ...RAW_ONION, ...fields };
    const result = validate({ ingredients: [raw], confirmations: [confirmation({ sourceBasis: getPlanningInventoryBasis([raw]) })] });
    expect(result).toEqual({ status: 'invalid', issues: [{ code: 'inventory_item_inactive', ingredientId: 'onion' }], items: [] });
  });

  it('requires a live row rather than accepting a matching id from the source basis alone', () => {
    expect(validate({ ingredients: [] })).toEqual({ status: 'invalid', issues: [{ code: 'inventory_item_missing', ingredientId: 'onion' }], items: [] });
  });

  it('rejects repeated confirmation mappings for one physical inventory row', () => {
    expect(validate({ confirmations: [CONFIRMATION, confirmation({ foodId: 'red-onion' })] })).toEqual({
      status: 'invalid', issues: [{ code: 'duplicate_stock_confirmation', ingredientId: 'onion' }], items: [],
    });
  });

  it('keeps separate physical rows with the same explicit identity independent', () => {
    const secondRaw = { ...RAW_ONION, id: 'onion-second' };
    const result = validate({ ingredients: [RAW_ONION, secondRaw], confirmations: [
      CONFIRMATION, confirmation({ ingredientId: 'onion-second', sourceBasis: getPlanningInventoryBasis([secondRaw]), amount: 25 }),
    ] });
    expect(result).toEqual({ status: 'valid', issues: [], items: [EXPECTED_ITEM, { ...EXPECTED_ITEM, id: 'onion-second', amount: 25 }] });
  });

  it('does not invalidate the per-row binding for an unrelated row, but the full basis still changes', () => {
    const other = { id: 'tofu', quantity: '반 모' };
    const ingredients = [RAW_ONION, other];
    const changed = [RAW_ONION, { ...other, quantity: '1모' }];
    expect(validate({ ingredients: changed }).status).toBe('valid');
    expect(getPlanningInventoryBasis(changed)).not.toBe(getPlanningInventoryBasis(ingredients));
  });

  it.each([
    ['blank id', { ingredientId: '' }], ['missing source basis', { sourceBasis: null }],
    ['missing food identity', { foodId: null }], ['empty food identity', { foodId: ' ' }],
    ['unknown food identity', { foodId: 'unknown' }], ['missing preparation', { preparationState: null }],
    ['unverified preparation', { preparationState: 'unverified' }], ['missing unit', { unit: null }],
    ['unknown unit', { unit: '미확인' }], ['numeric unit', { unit: 1 }],
    ['negative amount', { amount: -1 }], ['string amount', { amount: '125.5' }],
    ['NaN amount', { amount: NaN }], ['infinite amount', { amount: Infinity }],
    ['missing amount', { amount: undefined }], ['confirmed null amount', { amount: null }],
    ['invalid quantity status', { quantityStatus: 'verified' }], ['invalid availability status', { availabilityStatus: 'ready' }],
    ['invalid expiry status', { expiryStatus: 'safe' }], ['missing dated expiry', { expiryDate: null }],
    ['impossible expiry', { expiryDate: '2026-02-30' }], ['invalid leap day', { expiryDate: '2026-02-29' }],
    ['no-expiry with date', { expiryStatus: 'no-expiry' }], ['unknown with malformed date', { expiryStatus: 'unknown', expiryDate: 'tomorrow' }],
    ['missing confirmation time', { confirmedAt: null }], ['date-only confirmation', { confirmedAt: '2026-09-16' }],
    ['impossible confirmation date', { confirmedAt: '2026-02-30T00:00:00Z' }],
    ['confirmation without zone', { confirmedAt: '2026-09-16T11:00:00' }],
    ['invalid confirmation hour', { confirmedAt: '2026-09-16T24:00:00Z' }],
    ['future confirmation instant', { confirmedAt: '2026-09-16T03:00:00.001Z' }],
  ])('rejects %s without partially accepting other confirmations', (_label, fields) => {
    const result = validate({ confirmations: [confirmation(fields)] });
    expect(result.status).toBe('invalid');
    expect(result.issues.length).toBeGreaterThan(0);
    expect(result.items).toEqual([]);
  });

  it.each([null, {}, { ingredients: [RAW_ONION], confirmations: [] },
    { ingredients: [], confirmations: {}, asOf: AS_OF },
    { ingredients: [], confirmations: [], asOf: '2026-02-30T00:00:00Z' },
    { ingredients: [], confirmations: [], asOf: '2026-09-16' },
    { ingredients: [{ id: 'a' }, { id: 'a' }], confirmations: [], asOf: AS_OF },
    { ingredients: [{ id: 'a', value: undefined }], confirmations: [], asOf: AS_OF },
  ])('returns an invalid result for malformed request %j', (input) => {
    expect(validatePlanningStockConfirmations(input)).toMatchObject({ status: 'invalid', items: [] });
  });

  it('returns no accepted rows if a later confirmation is invalid', () => {
    const result = validate({ confirmations: [CONFIRMATION, confirmation({ ingredientId: 'absent' })] });
    expect(result.status).toBe('invalid');
    expect(result.items).toEqual([]);
  });

  it('never converts raw strings to numbers or substitutes broad name aliases', () => {
    const raw = { id: 'chives', name: '부추', quantity: '500g' };
    const explicit = confirmation({ ingredientId: 'chives', sourceBasis: getPlanningInventoryBasis([raw]), foodId: 'joseon-chives', amount: null, quantityStatus: 'unknown' });
    const result = validate({ ingredients: [raw], confirmations: [explicit] });
    expect(result.status).toBe('valid');
    expect(result.items[0]).toMatchObject({ foodId: 'joseon-chives', amount: null, quantityStatus: 'unknown' });
  });

  it('returns independent items and leaves frozen inputs unchanged', () => {
    const input = deepFreeze({ ingredients: [{ ...RAW_ONION }], confirmations: [confirmation()], asOf: AS_OF });
    const result = validatePlanningStockConfirmations(input);
    expect(result.status).toBe('valid');
    expect(result.items).toHaveLength(1);
    result.items[0].amount = 1;
    result.items.push({ id: 'injected' });
    expect(validatePlanningStockConfirmations(input)).toEqual({ status: 'valid', issues: [], items: [EXPECTED_ITEM] });
    expect(input.confirmations[0].amount).toBe(125.5);
  });
});
