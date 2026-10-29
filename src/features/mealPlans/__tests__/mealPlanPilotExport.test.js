import { beforeEach, describe, expect, it } from 'vitest';

const api = Object.values(import.meta.glob('../mealPlanPilotExport.js', { eager: true }))[0] || {};
const { validateLocalMealPlanPilotExport: validate, summarizeLocalMealPlanPilotExport: summarize } = api;
const id = (prefix, number) => `${prefix}_${number.toString(16).padStart(32, '0')}`;
const START = '2026-09-06T15:00:00.000Z';
const EXPIRES = '2026-10-11T15:00:00.000Z';
const EXPORTED = '2026-09-20T15:00:00.000Z';

function envelope(kind = 'account') {
  return { schemaVersion: 1, exportKind: 'fridgemate-local-meal-plan-pilot', measurementUnit: 'browser-scope',
    policyVersion: 'local-pilot-35d-v1', startedAt: START, expiresAt: EXPIRES,
    dataset: { schemaVersion: 1, exportedAt: EXPORTED, subjects: [{ id: id('sub', 1), kind,
      observedFrom: START, observedThrough: EXPORTED, firstGenerationKnown: false, gaps: [] }], events: [] } };
}

function cooking(number, occurredAt, weekKey) {
  return { id: id('evt', number), version: 1, name: 'meal_cooked_recorded', subjectId: id('sub', 1),
    occurredAt, weekKey, status: 'success', operationId: id('op', number), planId: id('plan', 1), slotId: id('slot', number) };
}

beforeEach(() => {
  expect(typeof validate, 'local export validation API must exist').toBe('function');
  expect(typeof summarize, 'local browser summary API must exist').toBe('function');
});

describe('local-only pilot export validation', () => {
  it('returns an isolated validated copy without altering the source', () => {
    const input = envelope();
    const original = structuredClone(input);
    const checked = validate(input);
    expect(checked).toEqual(original);
    checked.dataset.subjects[0].gaps.push({ from: START, through: EXPORTED, reason: 'missing' });
    expect(input).toEqual(original);
  });

  it('exports mixed v1 history and v2 not-cooked feedback without adding a cooked meal', () => {
    const input = envelope('guest');
    input.dataset.events = [cooking(1, '2026-09-07T09:00:00.000Z', '2026-09-07'), {
      ...cooking(2, '2026-09-08T09:00:00.000Z', '2026-09-07'), version: 2,
      name: 'meal_slot_changed', changeType: 'not_cooked', reasonCode: 'repetition',
    }];
    const checked = validate(input);
    expect(checked.schemaVersion).toBe(1);
    expect(checked.dataset.events[1]).toMatchObject({ version: 2, changeType: 'not_cooked', reasonCode: 'repetition' });
    expect(checked.dataset.events[0]).not.toHaveProperty('reasonCode');
    expect(summarize(input, { asOf: EXPORTED }).weekly[0].guestBrowser).toEqual({ activeSubjects: 0, activeSlots: 1 });
  });

  it.each([
    ['unknown envelope field', input => { input.personalNote = 'SECRET_INPUT_VALUE'; }],
    ['wrong envelope version', input => { input.schemaVersion = 2; }],
    ['wrong export purpose', input => { input.exportKind = 'account-data'; }],
    ['account identity claim', input => { input.measurementUnit = 'account'; }],
    ['unknown retention policy', input => { input.policyVersion = 'local-pilot-28d-v1'; }],
    ['invalid start date', input => { input.startedAt = '2026-02-30T15:00:00.000Z'; }],
    ['noncanonical start date', input => { input.startedAt = '2026-09-07T00:00:00.000+09:00'; }],
    ['noncanonical expiry', input => { input.expiresAt = '2026-10-11T15:00:00Z'; }],
    ['invalid expiry', input => { input.expiresAt = '2026-10-32T15:00:00.000Z'; }],
    ['shortened retention', input => { input.expiresAt = '2026-10-04T15:00:00.000Z'; }],
    ['extended retention', input => { input.expiresAt = '2026-10-12T15:00:00.000Z'; }],
    ['one millisecond late expiry', input => { input.expiresAt = '2026-10-11T15:00:00.001Z'; }],
    ['observation predates consent', input => { input.dataset.subjects[0].observedFrom = '2026-09-06T14:59:59.999Z'; }],
    ['observation after consent start', input => { input.dataset.subjects[0].observedFrom = '2026-09-06T15:00:00.001Z'; }],
    ['export at expiry', input => { input.dataset.exportedAt = EXPIRES; }],
    ['export after expiry', input => { input.dataset.exportedAt = '2026-10-12T15:00:00.000Z'; }],
    ['no browser scope', input => { input.dataset.subjects = []; }],
    ['multiple browser scopes', input => { input.dataset.subjects.push({ ...input.dataset.subjects[0], id: id('sub', 2) }); }],
    ['claimed lifetime first generation', input => { input.dataset.subjects[0].firstGenerationKnown = true; }],
    ['unknown first flag', input => { delete input.dataset.subjects[0].firstGenerationKnown; }],
    ['private nested field', input => { input.dataset.subjects[0].email = 'SECRET_INPUT_VALUE'; }],
    ['observation after export', input => { input.dataset.subjects[0].observedThrough = '2026-09-21T15:00:00.000Z'; }],
    ['unsupported dataset', input => { input.dataset.schemaVersion = 2; }],
    ['sparse scope array', input => { input.dataset.subjects = Array(1); }],
    ['symbol property', input => { input[Symbol('SECRET_INPUT_VALUE')] = true; }],
  ])('rejects %s without reflecting private values', (_name, mutate) => {
    const input = envelope();
    mutate(input);
    let failure;
    try { validate(input); } catch (error) { failure = error; }
    expect(failure).toBeInstanceOf(Error);
    expect(failure.message).not.toMatch(/SECRET_INPUT_VALUE|personalNote|email/);
  });

  it.each([null, [], {}, undefined, 'SECRET_INPUT_VALUE'])('rejects a non-envelope input %#', input => {
    expect(() => validate(input)).toThrow();
  });

  it('allows a file made one millisecond before expiry, without consulting the machine clock', () => {
    const input = envelope();
    input.dataset.exportedAt = '2026-10-11T14:59:59.999Z';
    input.dataset.subjects[0].observedThrough = input.dataset.exportedAt;
    expect(validate(input).dataset.exportedAt).toBe('2026-10-11T14:59:59.999Z');
  });

  it('does not accept the unwrapped prepared-dataset format', () => {
    expect(() => validate(envelope().dataset)).toThrow();
  });

  it('reuses event link validation instead of allowing orphan cancellations', () => {
    const input = envelope();
    input.dataset.events = [{ ...cooking(1, '2026-09-07T09:00:00.000Z', '2026-09-07'),
      name: 'meal_cooked_reversed', reversesEventId: id('evt', 99) }];
    expect(() => validate(input)).toThrow();
  });
});

describe('browser-scope output cannot be mistaken for account KPI output', () => {
  it.each([['account', 'signedInBrowser', 'guestBrowser'], ['guest', 'guestBrowser', 'signedInBrowser']])(
    'reports %s observations under %s in every aggregate', (kind, label, otherLabel) => {
      const input = envelope(kind);
      input.dataset.events = [cooking(1, '2026-09-07T09:00:00.000Z', '2026-09-07'),
        cooking(2, '2026-09-08T09:00:00.000Z', '2026-09-07'), cooking(3, '2026-09-14T09:00:00.000Z', '2026-09-14'),
        cooking(4, '2026-09-15T09:00:00.000Z', '2026-09-14')];
      const original = structuredClone(input);
      const result = summarize(input, { asOf: EXPORTED });
      expect(result.measurementUnit).toBe('browser-scope');
      expect(result.actualAccountKpisAvailable).toBe(false);
      expect(result.weekly.find(row => row.weekKey === '2026-09-07')[label]).toEqual({ activeSubjects: 1, activeSlots: 2 });
      expect(result.retention[0][label]).toEqual({ eligible: 1, retainedObserved: 1, observedInactive: 0, missingObservation: 0, rate: 1 });
      expect(result.retention[0][otherLabel].rate).toBeNull();
      expect(result.activation[label]).toMatchObject({ unknownFirst: 1, eligible: 0, rate: null });
      expect(result.decisionTime[label]).toEqual({ measured: 0, missingStart: 0, medianWallTimeMs: null });
      for (const group of [...result.weekly, ...result.retention, result.activation, result.decisionTime]) {
        expect(group).not.toHaveProperty('account');
        expect(group).not.toHaveProperty('guest');
        expect(group).toHaveProperty('signedInBrowser');
        expect(group).toHaveProperty('guestBrowser');
      }
      expect(JSON.stringify(result)).not.toMatch(/sub_|evt_|plan_|slot_|op_/);
      expect(input).toEqual(original);
    });

  it('preserves duplicate and cutoff counts when normalizing the envelope', () => {
    const input = envelope();
    const first = cooking(1, '2026-09-07T09:00:00.000Z', '2026-09-07');
    input.dataset.events = [first, structuredClone(first), cooking(2, '2026-09-14T09:00:00.000Z', '2026-09-14')];
    expect(validate(input).dataset.events).toHaveLength(2);
    const result = summarize(input, { asOf: '2026-09-10T15:00:00.000Z' });
    expect(result.counts).toMatchObject({ inputEvents: 3, uniqueEvents: 2, duplicateEvents: 1, includedEvents: 1, afterCutoffEvents: 1 });
    expect(result.weekly[0].signedInBrowser).toEqual({ activeSubjects: 0, activeSlots: 1 });
  });

  it('retains zero-event browser scopes without inventing activation evidence', () => {
    const result = summarize(envelope(), { asOf: EXPORTED });
    expect(result.counts).toMatchObject({ subjects: 1, noEventSubjects: 1, inputEvents: 0 });
    expect(result.activation.signedInBrowser).toMatchObject({ unknownFirst: 1, noNormalGeneration: 1, eligible: 0 });
  });

  it('rejects a cutoff after the exported snapshot instead of reading current time', () => {
    expect(() => summarize(envelope(), { asOf: '2026-09-20T15:00:00.001Z' })).toThrow();
  });
});
