import { beforeEach, describe, expect, it } from 'vitest';

// A missing public API is an assertion failure, not an import/environment error.
const module = Object.values(import.meta.glob('../mealPlanPilotMetrics.js', { eager: true }))[0] || {};
const { validatePilotDataset: validate, summarizeMealPlanPilot: summarize } = module;
const id = (prefix, number) => `${prefix}_${number.toString(16).padStart(32, '0')}`;
const S = id('sub', 1);
const start = '2026-09-06T15:00:00.000Z';
const end = '2026-09-27T15:00:00.000Z';
const subject = (number = 1, fields = {}) => ({ id: id('sub', number), kind: 'guest',
  observedFrom: start, observedThrough: end, firstGenerationKnown: true, gaps: [], ...fields });
const event = (number, name, occurredAt, weekKey, fields = {}) => ({ id: id('evt', number), version: 1,
  name, subjectId: S, occurredAt, weekKey, status: 'success', operationId: id('op', number), ...fields });
const cook = (number, occurredAt = '2026-09-07T09:00:00.000Z', weekKey = '2026-09-07', fields = {}) =>
  event(number, 'meal_cooked_recorded', occurredAt, weekKey, { planId: id('plan', 1), slotId: id('slot', number), ...fields });
const reverse = (number, original, occurredAt = '2026-09-21T09:00:00.000Z', weekKey = '2026-09-21', fields = {}) =>
  event(number, 'meal_cooked_reversed', occurredAt, weekKey, { subjectId: original.subjectId,
    planId: original.planId, slotId: original.slotId, reversesEventId: original.id, ...fields });
const generation = (number, occurredAt = '2026-09-07T09:00:00.000Z', fields = {}) =>
  event(number, 'meal_plan_generated', occurredAt, '2026-09-07', { planId: id('plan', number), plannedSlotCount: 3, ...fields });
const confirmation = (number, occurredAt, fields = {}) => event(number, 'meal_plan_confirmed', occurredAt,
  '2026-09-07', { planId: id('plan', 1), plannedSlotCount: 3, ...fields });
const dataset = (events = [], subjects = [subject()]) => ({ schemaVersion: 1, exportedAt: end, subjects, events });
const report = (input, asOf = end) => summarize(input, { asOf });
const week = (result, key) => result.weekly.find(row => row.weekKey === key);

beforeEach(() => {
  expect(typeof validate, 'validation API must be implemented').toBe('function');
  expect(typeof summarize, 'aggregation API must be implemented').toBe('function');
});

describe('versioned meal change feedback contract', () => {
  const feedback = fields => event(1, 'meal_slot_changed', '2026-09-07T09:00:00.000Z', '2026-09-07', {
    version: 2, planId: id('plan', 1), slotId: id('slot', 1), changeType: 'replace', reasonCode: 'repetition', ...fields,
  });

  it.each(['taste', 'ingredients', 'cost', 'difficulty', 'schedule', 'repetition', 'other', 'not_answered'])(
    'keeps only the explicit %s reason code on a successful v2 meal change', reasonCode => {
      expect(validate(dataset([feedback({ reasonCode })])).events[0]).toMatchObject({
        version: 2, name: 'meal_slot_changed', status: 'success', changeType: 'replace', reasonCode,
      });
    });

  it.each(['replace', 'skip', 'not_cooked'])('accepts the explicit %s action without treating it as cooking', changeType => {
    const input = dataset([feedback({ changeType }), cook(2)]);
    expect(validate(input).events[0]).toMatchObject({ version: 2, changeType, reasonCode: 'repetition' });
    expect(week(report(input), '2026-09-07').guest).toEqual({ activeSubjects: 0, activeSlots: 1 });
  });

  it('reads old v1 meal changes alongside v2 feedback without inferring missing reasons', () => {
    const old = event(2, 'meal_slot_changed', '2026-09-08T09:00:00.000Z', '2026-09-07', {
      planId: id('plan', 1), slotId: id('slot', 2),
    });
    const checked = validate(dataset([feedback(), old]));
    expect(checked.schemaVersion).toBe(1);
    expect(checked.events[1]).toMatchObject({ version: 1, name: 'meal_slot_changed' });
    expect(checked.events[1]).not.toHaveProperty('changeType');
    expect(checked.events[1]).not.toHaveProperty('reasonCode');
  });

  it.each([
    ['missing action', value => { delete value.changeType; }],
    ['missing reason', value => { delete value.reasonCode; }],
    ['unknown action', value => { value.changeType = 'private-action'; }],
    ['free-text reason', value => { value.reasonCode = 'SECRET_PRIVATE_REASON'; }],
    ['unknown reason', value => { value.reasonCode = 'time'; }],
    ['empty reason', value => { value.reasonCode = ''; }],
    ['null reason', value => { value.reasonCode = null; }],
    ['reason object', value => { value.reasonCode = { note: 'SECRET_PRIVATE_REASON' }; }],
    ['failed change', value => { value.status = 'failure'; }],
    ['cancelled change', value => { value.status = 'cancelled'; }],
    ['other event', value => { value.name = 'meal_cooked_recorded'; }],
    ['v1 feedback', value => { value.version = 1; }],
    ['unknown version', value => { value.version = 3; }],
    ['free-text field', value => { value.reasonText = 'SECRET_PRIVATE_REASON'; }],
  ])('rejects %s without exposing private input', (_name, mutate) => {
    const value = feedback();
    mutate(value);
    let error;
    try { validate(dataset([value])); } catch (caught) { error = caught; }
    expect(error).toBeInstanceOf(Error);
    expect(error.message).not.toMatch(/SECRET_PRIVATE_REASON|private-action|reasonText/);
  });
});

describe('pilot dataset privacy and structural boundaries', () => {
  it('clones and canonicalizes shuffled input without modifying callers', () => {
    const input = dataset([cook(2), cook(1)], [subject(2), subject()]);
    const before = structuredClone(input);
    const checked = validate(input);
    expect(checked.subjects.map(row => row.id)).toEqual([S, id('sub', 2)]);
    expect(checked.events.map(row => row.id)).toEqual([id('evt', 1), id('evt', 2)]);
    checked.events[0].slotId = id('slot', 99);
    expect(input).toEqual(before);
  });

  it('deduplicates identical replayed IDs independent of object key order', () => {
    const original = cook(1);
    const reordered = Object.fromEntries(Object.entries(original).reverse());
    const input = dataset([original, reordered]);
    expect(validate(input).events).toHaveLength(1);
    expect(report(input).counts).toMatchObject({ inputEvents: 2, uniqueEvents: 1, duplicateEvents: 1 });
  });

  it('rejects an ID replayed with different payload instead of choosing a winner', () => {
    expect(() => validate(dataset([cook(1), cook(1, undefined, undefined, { slotId: id('slot', 2) })]))).toThrow();
  });

  it.each([
    ['dataset', value => { value.rawInventory = [{ name: 'private-ingredient' }]; }],
    ['subject', value => { value.subjects[0].email = 'sensitive@example.test'; }],
    ['gap', value => { value.subjects[0].gaps = [{ from: start, through: '2026-09-07T00:00:00.000Z', reason: 'missing', note: 'private-note' }]; }],
    ['event', value => { value.events[0].requestKey = '{"private":"secret"}'; }],
  ])('rejects private or unknown fields on %s without echoing their values', (_name, mutate) => {
    const input = dataset([cook(1)]);
    mutate(input);
    let error;
    try { validate(input); } catch (caught) { error = caught; }
    expect(error).toBeInstanceOf(Error);
    expect(error.message).not.toMatch(/private|sensitive|secret|requestKey|rawInventory/);
  });

  it.each([
    ['wrong schema', value => { value.schemaVersion = 2; }],
    ['unknown event name', value => { value.events[0].name = 'raw_inventory_uploaded'; }],
    ['wrong event version', value => { value.events[0].version = 2; }],
    ['bad status', value => { value.events[0].status = 'done'; }],
    ['raw scope', value => { value.subjects[0].id = 'user:real-account'; }],
    ['uppercase pseudonym', value => { value.subjects[0].id = `sub_${'A'.repeat(32)}`; }],
    ['raw slot date', value => { value.events[0].slotId = '2026-09-07:dinner'; }],
    ['raw plan date', value => { value.events[0].planId = 'week:2026-09-07'; }],
    ['unknown subject', value => { value.events[0].subjectId = id('sub', 99); }],
    ['duplicate subject', value => { value.subjects.push(subject()); }],
    ['nonboolean first flag', value => { value.subjects[0].firstGenerationKnown = 'yes'; }],
    ['noncanonical date', value => { value.events[0].occurredAt = '2026-09-07T09:00:00Z'; }],
    ['impossible date', value => { value.exportedAt = '2026-02-30T00:00:00.000Z'; }],
    ['outside supported years', value => { value.exportedAt = '2100-01-01T00:00:00.000Z'; }],
    ['wrong week', value => { value.events[0].weekKey = '2026-09-14'; }],
    ['non-Monday week', value => { value.events[0].weekKey = '2026-09-08'; }],
    ['event after export', value => { value.events[0].occurredAt = '2026-09-28T00:00:00.000Z'; value.events[0].weekKey = '2026-09-28'; }],
    ['event before observation', value => { value.subjects[0].observedFrom = '2026-09-08T00:00:00.000Z'; }],
    ['event after observation', value => { value.subjects[0].observedThrough = '2026-09-07T08:00:00.000Z'; }],
    ['reversed observation', value => { value.subjects[0].observedFrom = end; value.subjects[0].observedThrough = start; }],
    ['observation after export', value => { value.subjects[0].observedThrough = '2026-09-28T00:00:00.000Z'; }],
    ['empty gap', value => { value.subjects[0].gaps = [{ from: start, through: start, reason: 'missing' }]; }],
    ['gap outside observation', value => { value.subjects[0].gaps = [{ from: '2026-09-06T14:00:00.000Z', through: start, reason: 'reset' }]; }],
    ['overlapping gaps', value => { value.subjects[0].gaps = [
      { from: start, through: '2026-09-07T00:00:00.000Z', reason: 'missing' },
      { from: start, through: '2026-09-07T01:00:00.000Z', reason: 'reset' }]; }],
    ['event during gap', value => { value.subjects[0].gaps = [{ from: '2026-09-07T09:00:00.000Z', through: '2026-09-08T00:00:00.000Z', reason: 'opt-out' }]; }],
    ['missing cooking slot', value => { delete value.events[0].slotId; }],
    ['missing cooking plan', value => { delete value.events[0].planId; }],
    ['oversized engine label', value => { value.events[0].engineVersion = 'x'.repeat(81); }],
    ['raw engine text', value => { value.events[0].engineVersion = 'sensitive@example.test'; }],
    ['sparse subjects', value => { value.subjects.length = 2; }],
    ['sparse events', value => { value.events.length = 2; }],
    ['sparse gaps', value => { value.subjects[0].gaps.length = 1; }],
    ['array property', value => { value.events.extra = true; }],
    ['too many subjects', value => { value.subjects = Array.from({ length: 1001 }, (_, index) => subject(index + 1)); }],
    ['too many events', value => { value.events = Array(50001).fill(cook(1)); }],
  ])('rejects %s', (_name, mutate) => {
    const input = dataset([cook(1)]);
    mutate(input);
    expect(() => validate(input)).toThrow();
  });

  it.each([
    ['missing count', value => { delete value.plannedSlotCount; }],
    ['fractional count', value => { value.plannedSlotCount = 1.5; }],
    ['too many slots', value => { value.plannedSlotCount = 8; }],
    ['negative count', value => { value.plannedSlotCount = -1; }],
    ['missing plan', value => { delete value.planId; }],
  ])('rejects generation %s', (_name, mutate) => {
    const input = generation(1);
    mutate(input);
    expect(() => validate(dataset([input]))).toThrow();
  });

  it('accepts empty datasets and events exactly at observation-through or gap-through', () => {
    expect(validate(dataset([], []))).toEqual(dataset([], []));
    const input = dataset([cook(1)], [subject(1, { observedThrough: '2026-09-07T09:00:00.000Z',
      gaps: [{ from: start, through: '2026-09-07T09:00:00.000Z', reason: 'missing' }] })]);
    expect(validate(input).events).toHaveLength(1);
  });

  it('preserves a confirmed event during partial collection without claiming full observation', () => {
    const input = dataset([generation(1)], [subject(1, { gaps: [{
      from: '2026-09-07T08:00:00.000Z', through: '2026-09-11T09:00:00.000Z', reason: 'missing',
    }] })]);
    expect(validate(input).events).toEqual([generation(1)]);
    expect(report(input).activation.guest).toMatchObject({ eligible: 1, activated: 0, missingObservation: 1 });
  });

  it('does not turn one known next-week cooking during a missing interval into observed inactivity', () => {
    const input = dataset([cook(1), cook(2), cook(3, '2026-09-14T09:00:00.000Z', '2026-09-14')],
      [subject(1, { gaps: [{ from: '2026-09-14T08:00:00.000Z', through: '2026-09-16T09:00:00.000Z', reason: 'missing' }] })]);
    const result = report(input);
    expect(week(result, '2026-09-14').guest).toEqual({ activeSubjects: 0, activeSlots: 1 });
    expect(result.retention[0].guest).toEqual({ eligible: 1, retainedObserved: 0,
      observedInactive: 0, missingObservation: 1, rate: 0 });
  });

  it('honors a confirmed reversal even when another operation was not observed during that interval', () => {
    const original = cook(1);
    const input = dataset([original, reverse(2, original)], [subject(1, { gaps: [{
      from: '2026-09-21T08:00:00.000Z', through: '2026-09-22T09:00:00.000Z', reason: 'missing',
    }] })]);
    expect(week(report(input), '2026-09-07').guest).toEqual({ activeSubjects: 0, activeSlots: 0 });
  });

  it.each(['opt-out', 'reset'])('still refuses events during a %s interval', reason => {
    const input = dataset([cook(1)], [subject(1, { gaps: [{
      from: '2026-09-07T08:00:00.000Z', through: '2026-09-08T09:00:00.000Z', reason,
    }] })]);
    expect(() => validate(input)).toThrow();
  });
});

describe('committed outcome links and cancellation semantics', () => {
  it.each([
    ['missing original', values => [values[1]]],
    ['different subject', values => { values[1].subjectId = id('sub', 2); return values; }],
    ['different slot', values => { values[1].slotId = id('slot', 2); return values; }],
    ['different plan', values => { values[1].planId = id('plan', 2); return values; }],
    ['earlier reversal', values => { values[1].occurredAt = start; values[1].weekKey = '2026-09-07'; return values; }],
    ['multiple reversals', values => [...values, { ...values[1], id: id('evt', 9), operationId: id('op', 9) }]],
    ['wrong reversal kind', values => { values[1].name = 'consumption_reversed'; return values; }],
    ['failed original', values => { values[0].status = 'failure'; return values; }],
  ])('rejects cooking cancellation with %s', (_name, mutate) => {
    const original = cook(1);
    expect(() => validate(dataset(mutate([original, reverse(2, original)]), [subject(), subject(2)]))).toThrow();
  });

  it('rejects distinct un-reversed cooking IDs for the same scope and slot', () => {
    expect(() => validate(dataset([cook(1), cook(2, '2026-09-14T09:00:00.000Z', '2026-09-14', { slotId: id('slot', 1) })]))).toThrow();
  });

  it('accepts a cancelled slot being re-recorded and removes only the original week', () => {
    const original = cook(1);
    const recooked = cook(3, '2026-09-21T09:00:00.000Z', '2026-09-21', { slotId: id('slot', 1) });
    const input = dataset([recooked, reverse(2, original), original, cook(4, '2026-09-21T10:00:00.000Z', '2026-09-21')]);
    const result = report(input);
    expect(week(result, '2026-09-07').guest).toEqual({ activeSubjects: 0, activeSlots: 0 });
    expect(week(result, '2026-09-21').guest).toEqual({ activeSubjects: 1, activeSlots: 2 });
  });

  it('rejects re-recording before the prior cooking was cancelled', () => {
    const original = cook(1);
    expect(() => validate(dataset([original, reverse(2, original), cook(3, '2026-09-14T09:00:00.000Z', '2026-09-14', { slotId: id('slot', 1) })]))).toThrow();
  });

  it('consumption reversals target consumption, but never cancel a cooked meal', () => {
    const consumed = event(4, 'consumption_applied', '2026-09-07T09:00:00.000Z', '2026-09-07', { planId: id('plan', 1), slotId: id('slot', 1) });
    const reversed = event(5, 'consumption_reversed', '2026-09-08T09:00:00.000Z', '2026-09-07', { planId: id('plan', 1), slotId: id('slot', 1), reversesEventId: consumed.id });
    expect(week(report(dataset([cook(1), cook(2), consumed, reversed])), '2026-09-07').guest.activeSubjects).toBe(1);
    expect(() => validate(dataset([consumed, { ...reversed, slotId: id('slot', 9) }]))).toThrow();
  });

  it('only applies cancellation up to asOf, while validating future rows too', () => {
    const original = cook(1);
    const input = dataset([original, cook(2), reverse(3, original)]);
    expect(week(report(input, '2026-09-20T14:59:59.999Z'), '2026-09-07').guest.activeSubjects).toBe(1);
    expect(week(report(input), '2026-09-07').guest.activeSubjects).toBe(0);
    input.events[2].unknownPrivateField = 'sensitive';
    expect(() => report(input, '2026-09-20T14:59:59.999Z')).toThrow();
  });

  it('keeps failed or cancelled attempts out of all success counters', () => {
    const input = dataset([cook(1, undefined, undefined, { status: 'failure' }),
      generation(2, undefined, { status: 'cancelled' }), confirmation(3, '2026-09-08T09:00:00.000Z', { status: 'failure' })]);
    const result = report(input);
    expect(week(result, '2026-09-07').guest.activeSlots).toBe(0);
    expect(result.activation.guest.noNormalGeneration).toBe(1);
  });
});

describe('Seoul weekly usage and honest retention cohorts', () => {
  it('uses recording instants at Sunday/Monday and year boundaries, independent of host timezone', () => {
    const input = { schemaVersion: 1, exportedAt: '2027-01-04T15:00:00.000Z', subjects: [subject(1, {
      observedFrom: '2026-12-27T15:00:00.000Z', observedThrough: '2027-01-04T15:00:00.000Z' })], events: [
      cook(1, '2027-01-03T14:59:59.999Z', '2026-12-28'),
      cook(2, '2027-01-03T15:00:00.000Z', '2027-01-04'),
      cook(3, '2027-01-04T09:00:00.000Z', '2027-01-04')] };
    const result = report(input, input.exportedAt);
    expect(result.timeZone).toBe('Asia/Seoul');
    expect(result.weekly).toEqual([
      { weekKey: '2026-12-28', provisional: false, account: { activeSubjects: 0, activeSlots: 0 }, guest: { activeSubjects: 0, activeSlots: 1 } },
      { weekKey: '2027-01-04', provisional: true, account: { activeSubjects: 0, activeSlots: 0 }, guest: { activeSubjects: 1, activeSlots: 2 } },
    ]);
  });

  it('shows zero-observation-event subjects and weeks without inventing future weeks', () => {
    const result = report(dataset([], [subject(), subject(2, { kind: 'account', firstGenerationKnown: false })]), '2026-09-16T00:00:00.000Z');
    expect(result.counts).toMatchObject({ subjects: 2, noEventSubjects: 2, inputEvents: 0, uniqueEvents: 0 });
    expect(result.weekly.map(row => [row.weekKey, row.provisional])).toEqual([['2026-09-07', false], ['2026-09-14', true]]);
    expect(result.activation.account).toMatchObject({ noNormalGeneration: 1, unknownFirst: 1, eligible: 0, rate: null });
  });

  it('does not add future participants to a past report population', () => {
    const result = report(dataset([cook(1, '2026-09-21T09:00:00.000Z', '2026-09-21', { subjectId: id('sub', 2) })], [subject(), subject(2, { observedFrom: '2026-09-21T00:00:00.000Z',
      kind: 'account', firstGenerationKnown: false })]), '2026-09-16T00:00:00.000Z');
    expect(result.counts).toMatchObject({ inputSubjects: 2, subjects: 1, noEventSubjects: 1,
      uniqueEvents: 1, includedEvents: 0, afterCutoffEvents: 1 });
    expect(result.activation.account).toMatchObject({ unknownFirst: 0, noNormalGeneration: 0, eligible: 0 });
    expect(result.weekly.map(row => row.weekKey)).toEqual(['2026-09-07', '2026-09-14']);
  });

  it('does not join distinct scopes or report one-slot users as active', () => {
    const result = report(dataset([cook(1), cook(2, undefined, undefined, { subjectId: id('sub', 2) })],
      [subject(), subject(2, { kind: 'account' })]));
    expect(week(result, '2026-09-07').guest).toEqual({ activeSubjects: 0, activeSlots: 1 });
    expect(week(result, '2026-09-07').account).toEqual({ activeSubjects: 0, activeSlots: 1 });
    expect(JSON.stringify(result)).not.toMatch(/sub_|evt_|slot_|plan_|op_/);
  });

  it('keeps missed and opted-out mature cohort members in the denominator', () => {
    const subjects = [subject(), subject(2, { observedThrough: '2026-09-15T00:00:00.000Z' }),
      subject(3, { gaps: [{ from: '2026-09-14T00:00:00.000Z', through: '2026-09-16T00:00:00.000Z', reason: 'opt-out' }] }), subject(4)];
    const events = subjects.flatMap((row, index) => [cook(index * 10 + 1, undefined, undefined, { subjectId: row.id }),
      cook(index * 10 + 2, undefined, undefined, { subjectId: row.id })]);
    events.push(cook(90, '2026-09-14T09:00:00.000Z', '2026-09-14'), cook(91, '2026-09-15T09:00:00.000Z', '2026-09-14'));
    const input = dataset(events, subjects);
    expect(report(input, '2026-09-20T14:59:59.999Z').retention).toEqual([]);
    const result = report(input, '2026-09-20T15:00:00.000Z');
    expect(result.retention).toEqual([{ weekKey: '2026-09-07', nextWeekKey: '2026-09-14',
      guest: { eligible: 4, retainedObserved: 1, observedInactive: 1, missingObservation: 2, rate: 0.25 },
      account: { eligible: 0, retainedObserved: 0, observedInactive: 0, missingObservation: 0, rate: null } }]);
  });

  it('counts observed retention despite a different unobserved part of that week without double classification', () => {
    const input = dataset([cook(1), cook(2), cook(3, '2026-09-14T09:00:00.000Z', '2026-09-14'),
      cook(4, '2026-09-15T09:00:00.000Z', '2026-09-14')], [subject(1, { observedThrough: '2026-09-16T00:00:00.000Z' })]);
    expect(report(input).retention[0].guest).toEqual({ eligible: 1, retainedObserved: 1, observedInactive: 0, missingObservation: 0, rate: 1 });
  });

  it('reports no ratio when a kind has no eligible denominator', () => {
    const result = report(dataset());
    expect(result.retention).toEqual([]);
    expect(result.activation.guest.rate).toBeNull();
    expect(result.decisionTime.guest.medianWallTimeMs).toBeNull();
  });
});

describe('72-hour activation and explicitly wall-clock decision time', () => {
  it('includes confirmation exactly at 72 hours only once the window matures', () => {
    const input = dataset([generation(1), confirmation(2, '2026-09-10T09:00:00.000Z')]);
    expect(report(input, '2026-09-10T08:59:59.999Z').activation.guest).toMatchObject({ eligible: 0, pending: 1, activated: 0, rate: null });
    expect(report(input, '2026-09-10T09:00:00.000Z').activation.guest).toMatchObject({ eligible: 1, pending: 0, activated: 1, rate: 1 });
  });

  it('does not accept confirmation just after 72 hours or before first normal generation', () => {
    expect(report(dataset([generation(1), confirmation(2, '2026-09-10T09:00:00.001Z')])).activation.guest.activated).toBe(0);
    expect(report(dataset([generation(1), confirmation(2, '2026-09-07T08:59:59.999Z')])).activation.guest.activated).toBe(0);
  });

  it('accepts another normal plan confirmation but not a zero-slot plan', () => {
    expect(report(dataset([generation(1), confirmation(2, '2026-09-08T09:00:00.000Z', { planId: id('plan', 9) })])).activation.guest.activated).toBe(1);
    expect(report(dataset([generation(1), confirmation(2, '2026-09-08T09:00:00.000Z', { plannedSlotCount: 0 })])).activation.guest.activated).toBe(0);
  });

  it('never treats an empty generated plan as first normal generation', () => {
    const input = dataset([generation(1, '2026-09-07T09:00:00.000Z', { plannedSlotCount: 0 }),
      generation(2, '2026-09-10T09:00:00.000Z'), confirmation(3, '2026-09-11T09:00:00.000Z')]);
    expect(report(input, '2026-09-11T09:00:00.000Z').activation.guest).toMatchObject({ eligible: 0, pending: 1, activated: 0 });
  });

  it('does not reset the activation clock on regeneration', () => {
    const input = dataset([generation(1), generation(2, '2026-09-10T09:00:00.000Z'), confirmation(3, '2026-09-11T09:00:00.000Z')]);
    expect(report(input).activation.guest).toMatchObject({ eligible: 1, activated: 0, pending: 0 });
  });

  it('separates unknown first-generation history from a known measured failure', () => {
    const input = dataset([generation(1), confirmation(2, '2026-09-08T09:00:00.000Z')], [subject(1, { firstGenerationKnown: false })]);
    expect(report(input).activation.guest).toMatchObject({ eligible: 0, unknownFirst: 1, activated: 0, rate: null });
  });

  it('keeps incomplete 72-hour observation in the eligible denominator and flags it', () => {
    const input = dataset([generation(1)], [subject(1, { observedThrough: '2026-09-08T09:00:00.000Z' })]);
    expect(report(input).activation.guest).toMatchObject({ eligible: 1, activated: 0, missingObservation: 1, rate: 0 });
  });

  it('flags a gap beginning exactly at the included 72-hour deadline', () => {
    const input = dataset([generation(1)], [subject(1, { gaps: [{ from: '2026-09-10T09:00:00.000Z',
      through: '2026-09-11T09:00:00.000Z', reason: 'missing' }] })]);
    expect(report(input).activation.guest).toMatchObject({ eligible: 1, activated: 0, missingObservation: 1 });
  });

  it('excludes a gap beginning at the next Monday from the preceding retention week', () => {
    const input = dataset([cook(1), cook(2)], [subject(1, { gaps: [{ from: '2026-09-20T15:00:00.000Z',
      through: '2026-09-21T09:00:00.000Z', reason: 'missing' }] })]);
    expect(report(input).retention[0].guest).toMatchObject({ eligible: 1, observedInactive: 1, missingObservation: 0 });
  });

  it('computes matched wall-clock medians without mixing regenerations or subjects', () => {
    const first = generation(1);
    const second = generation(2, undefined, { subjectId: id('sub', 2) });
    const started = event(20, 'meal_plan_generation_started', '2026-09-07T08:59:00.000Z', '2026-09-07', { status: 'started', planId: first.planId, operationId: first.operationId });
    const startedSecond = event(21, 'meal_plan_generation_started', '2026-09-07T08:58:00.000Z', '2026-09-07', { status: 'started', subjectId: id('sub', 2), planId: second.planId, operationId: second.operationId });
    const input = dataset([confirmation(23, '2026-09-07T09:04:00.000Z', { planId: second.planId, subjectId: id('sub', 2) }),
      first, second, started, startedSecond, confirmation(22, '2026-09-07T09:01:00.000Z'),
      confirmation(24, '2026-09-08T09:01:00.000Z')], [subject(), subject(2)]);
    expect(report(input).decisionTime.guest).toEqual({ measured: 2, missingStart: 0, medianWallTimeMs: 240000 });
  });

  it('separates missing or nonmatching start rather than inventing duration zero', () => {
    const input = dataset([generation(1), confirmation(2, '2026-09-08T09:00:00.000Z'),
      event(3, 'meal_plan_generation_started', '2026-09-07T08:59:00.000Z', '2026-09-07', { status: 'started', planId: id('plan', 1) })]);
    expect(report(input).decisionTime.guest).toEqual({ measured: 0, missingStart: 1, medianWallTimeMs: null });
  });

  it.each(['2026-09-28T00:00:00.000Z', '2026-09-20T00:00:00Z', 'invalid', undefined])('rejects invalid asOf %s', asOf => {
    expect(() => summarize(dataset(), { asOf })).toThrow();
  });

  it('is order independent and does not mutate input while reporting aggregates only', () => {
    const input = dataset([cook(1), cook(2), generation(3)]);
    const before = structuredClone(input);
    const result = report(input);
    expect(report({ ...input, events: [...input.events].reverse() })).toEqual(result);
    expect(input).toEqual(before);
    expect(JSON.stringify(result)).not.toMatch(/sub_|evt_|slot_|plan_|op_/);
  });
});
