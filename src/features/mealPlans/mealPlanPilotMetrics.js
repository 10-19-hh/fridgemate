// Offline, consent-prepared pilot exports only. This module reads no browser
// storage, emits no events, and cannot establish consent or anonymity itself.
import { parsePilotInstant } from './mealPlanPilotPolicy.js';
import { isMealPlanFeedback } from './mealPlanFeedback.js';

const INVALID = '파일럿 자료의 형식·관측 범위·이벤트 연결을 확인해주세요.';
const DAY = 86400000;
const WEEK = 7 * DAY;
const SEOUL = 9 * 3600000;
const HOURS_72 = 3 * DAY;
const KINDS = ['account', 'guest'];
const COMMON_EVENT = ['id', 'version', 'name', 'subjectId', 'occurredAt', 'weekKey', 'status', 'operationId'];
const EVENT_NAMES = new Set([
  'meal_plan_generation_started', 'meal_plan_generated', 'meal_plan_confirmed', 'meal_slot_changed',
  'shopping_list_recalculated', 'inventory_purchase_applied', 'meal_cooked_recorded',
  'meal_cooked_reversed', 'consumption_applied', 'consumption_reversed',
]);
const GENERATION_NAMES = new Set(['meal_plan_generation_started', 'meal_plan_generated', 'meal_plan_confirmed']);
const SLOT_NAMES = new Set(['meal_slot_changed', 'meal_cooked_recorded', 'meal_cooked_reversed', 'consumption_applied', 'consumption_reversed']);
const REVERSES = { meal_cooked_reversed: 'meal_cooked_recorded', consumption_reversed: 'consumption_applied' };

function check(condition) {
  if (!condition) throw new Error(INVALID);
}

function keys(value, required, optional = []) {
  check(value !== null && typeof value === 'object' && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value)));
  const allowed = new Set([...required, ...optional]);
  check(required.every(key => Object.hasOwn(value, key))
    && Reflect.ownKeys(value).every(key => allowed.has(key)));
}

function array(value, maximum) {
  check(Array.isArray(value) && value.length <= maximum && Reflect.ownKeys(value).length === value.length + 1);
  for (let index = 0; index < value.length; index += 1) check(Object.hasOwn(value, index));
}

function instant(value) {
  const time = parsePilotInstant(value);
  check(time !== null);
  return time;
}

function pseudonym(value, prefix) {
  check(typeof value === 'string' && new RegExp(`^${prefix}_[a-f0-9]{32}$`).test(value));
}

function weekAt(time) {
  const date = new Date(time + SEOUL);
  date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7);
  return date.toISOString().slice(0, 10);
}

function weekStart(key) {
  return Date.parse(`${key}T00:00:00.000Z`) - SEOUL;
}

function stable(value) {
  if (Array.isArray(value)) return JSON.stringify(value.map(item => JSON.parse(stable(item))));
  if (value !== null && typeof value === 'object') {
    return JSON.stringify(Object.fromEntries(Object.keys(value).sort().map(key => [key, JSON.parse(stable(value[key]))])));
  }
  return JSON.stringify(value);
}

function validateSubject(subject, exportedAt) {
  keys(subject, ['id', 'kind', 'observedFrom', 'observedThrough', 'firstGenerationKnown', 'gaps']);
  pseudonym(subject.id, 'sub');
  check(KINDS.includes(subject.kind) && typeof subject.firstGenerationKnown === 'boolean');
  const from = instant(subject.observedFrom);
  const through = instant(subject.observedThrough);
  check(from <= through && through <= exportedAt);
  array(subject.gaps, 100);
  const gaps = subject.gaps.map(gap => {
    keys(gap, ['from', 'through', 'reason']);
    check(['opt-out', 'reset', 'missing'].includes(gap.reason));
    const gapFrom = instant(gap.from);
    const gapThrough = instant(gap.through);
    check(gapFrom < gapThrough && gapFrom >= from && gapThrough <= through);
    return { ...gap };
  }).sort((left, right) => left.from.localeCompare(right.from));
  for (let index = 1; index < gaps.length; index += 1) check(gaps[index - 1].through <= gaps[index].from);
  return { ...subject, gaps };
}

function validateEvent(event, subjects, exportedAt) {
  const feedbackFields = event?.version === 2 ? ['changeType', 'reasonCode'] : [];
  keys(event, [...COMMON_EVENT, ...feedbackFields], ['planId', 'slotId', 'reversesEventId', 'plannedSlotCount', 'engineVersion']);
  pseudonym(event.id, 'evt');
  pseudonym(event.subjectId, 'sub');
  pseudonym(event.operationId, 'op');
  check([1, 2].includes(event.version) && EVENT_NAMES.has(event.name));
  if (event.version === 2) {
    check(event.name === 'meal_slot_changed' && event.status === 'success'
      && isMealPlanFeedback(event.changeType, event.reasonCode));
  }
  check(event.name === 'meal_plan_generation_started' ? event.status === 'started'
    : ['success', 'failure', 'cancelled'].includes(event.status));
  const occurredAt = instant(event.occurredAt);
  const subject = subjects.get(event.subjectId);
  check(subject && occurredAt <= exportedAt && event.weekKey === weekAt(occurredAt));
  check(event.occurredAt >= subject.observedFrom && event.occurredAt <= subject.observedThrough
    // A missing interval means incomplete observation, not that every result is
    // absent. Keep independently committed results/reversals while covers()
    // continues to exclude this interval from evidence of non-use. Opt-out and
    // reset intervals still prohibit collection altogether.
    && !subject.gaps.some(gap => gap.reason !== 'missing'
      && event.occurredAt >= gap.from && event.occurredAt < gap.through));
  for (const [key, prefix] of [['planId', 'plan'], ['slotId', 'slot'], ['reversesEventId', 'evt']]) {
    if (Object.hasOwn(event, key)) pseudonym(event[key], prefix);
  }
  if (Object.hasOwn(event, 'plannedSlotCount')) {
    check(GENERATION_NAMES.has(event.name) && Number.isInteger(event.plannedSlotCount)
      && event.plannedSlotCount >= 0 && event.plannedSlotCount <= 7);
  }
  if (Object.hasOwn(event, 'slotId')) check(SLOT_NAMES.has(event.name));
  if (Object.hasOwn(event, 'reversesEventId')) check(Object.hasOwn(REVERSES, event.name));
  if (Object.hasOwn(event, 'engineVersion')) {
    check(typeof event.engineVersion === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(event.engineVersion));
  }
  if (event.name === 'meal_plan_generation_started') check(Object.hasOwn(event, 'planId'));
  if (event.status === 'success') {
    if (GENERATION_NAMES.has(event.name)) check(Object.hasOwn(event, 'planId') && Object.hasOwn(event, 'plannedSlotCount'));
    if (SLOT_NAMES.has(event.name)) check(Object.hasOwn(event, 'planId') && Object.hasOwn(event, 'slotId'));
    if (Object.hasOwn(REVERSES, event.name)) check(Object.hasOwn(event, 'reversesEventId'));
  }
  return { ...event };
}

function validateLinks(events) {
  const byId = new Map(events.map(event => [event.id, event]));
  const reversals = new Map();
  for (const event of events) {
    if (event.status !== 'success' || !Object.hasOwn(REVERSES, event.name)) continue;
    const original = byId.get(event.reversesEventId);
    check(original?.status === 'success' && original.name === REVERSES[event.name]
      && original.subjectId === event.subjectId && original.slotId === event.slotId
      && original.planId === event.planId && original.occurredAt <= event.occurredAt
      && !reversals.has(original.id));
    reversals.set(original.id, event);
  }
  const slots = new Map();
  for (const event of events) {
    if (event.status !== 'success' || event.name !== 'meal_cooked_recorded') continue;
    const key = `${event.subjectId}:${event.slotId}`;
    const spans = slots.get(key) || [];
    spans.push({ from: Date.parse(event.occurredAt), through: reversals.has(event.id)
      ? Date.parse(reversals.get(event.id).occurredAt) : Infinity });
    slots.set(key, spans);
  }
  for (const spans of slots.values()) {
    spans.sort((left, right) => left.from - right.from || left.through - right.through);
    for (let index = 1; index < spans.length; index += 1) check(spans[index - 1].through <= spans[index].from);
  }
}

/** Strict JSON contract, not a de-identification service. Never supply a raw
 * operational snapshot. IDs must already be purpose-specific random aliases. */
export function validatePilotDataset(input) {
  try {
    keys(input, ['schemaVersion', 'exportedAt', 'subjects', 'events']);
    check(input.schemaVersion === 1);
    const exportedAt = instant(input.exportedAt);
    array(input.subjects, 1000);
    array(input.events, 50000);
    const subjects = input.subjects.map(subject => validateSubject(subject, exportedAt))
      .sort((left, right) => left.id.localeCompare(right.id));
    const subjectsById = new Map(subjects.map(subject => [subject.id, subject]));
    check(subjectsById.size === subjects.length);
    const eventsById = new Map();
    for (const raw of input.events) {
      const event = validateEvent(raw, subjectsById, exportedAt);
      const previous = eventsById.get(event.id);
      check(!previous || stable(previous) === stable(event));
      eventsById.set(event.id, event);
    }
    const events = [...eventsById.values()].sort((left, right) => left.occurredAt.localeCompare(right.occurredAt) || left.id.localeCompare(right.id));
    validateLinks(events);
    return { schemaVersion: 1, exportedAt: input.exportedAt, subjects, events };
  } catch {
    // In particular, never echo unknown keys, malformed identifiers, or parser
    // details that might contain an unredacted private value.
    throw new Error(INVALID);
  }
}

// observedThrough is inclusive. Full-week coverage requires observing through
// the next Monday 00:00 KST. Gaps are half-open [from, through).
function covers(subject, from, through, includeEnd = false) {
  return Date.parse(subject.observedFrom) <= from && Date.parse(subject.observedThrough) >= through
    && !subject.gaps.some(gap => (includeEnd ? Date.parse(gap.from) <= through : Date.parse(gap.from) < through)
      && Date.parse(gap.through) > from);
}

const perKind = create => Object.fromEntries(KINDS.map(kind => [kind, create()]));
const ratio = (numerator, denominator) => denominator ? numerator / denominator : null;
const normal = (event, name) => event.name === name && event.status === 'success' && event.plannedSlotCount > 0;

function summarizeActivation(subjects, eventsBySubject, asOf) {
  const activation = perKind(() => ({ eligible: 0, activated: 0, pending: 0, unknownFirst: 0,
    noNormalGeneration: 0, missingObservation: 0, rate: null }));
  const decisionTime = perKind(() => ({ measured: 0, missingStart: 0, medianWallTimeMs: null }));
  const durations = perKind(() => []);
  for (const subject of subjects) {
    const events = eventsBySubject.get(subject.id) || [];
    const first = events.find(event => normal(event, 'meal_plan_generated'));
    const bucket = activation[subject.kind];
    if (!subject.firstGenerationKnown) bucket.unknownFirst += 1;
    if (!first) { bucket.noNormalGeneration += 1; continue; }
    const firstAt = Date.parse(first.occurredAt);
    const confirms = events.filter(event => normal(event, 'meal_plan_confirmed') && event.occurredAt >= first.occurredAt);
    if (subject.firstGenerationKnown) {
      const deadline = firstAt + HOURS_72;
      if (asOf < deadline) bucket.pending += 1;
      else {
        bucket.eligible += 1;
        if (confirms.some(event => Date.parse(event.occurredAt) <= deadline)) bucket.activated += 1;
        else if (!covers(subject, firstAt, deadline, true)) bucket.missingObservation += 1;
      }
    }
    const confirmation = confirms.find(event => event.planId === first.planId);
    if (confirmation) {
      const started = events.find(event => event.name === 'meal_plan_generation_started'
        && event.operationId === first.operationId && event.planId === first.planId && event.occurredAt <= first.occurredAt);
      if (!started) decisionTime[subject.kind].missingStart += 1;
      else durations[subject.kind].push(Date.parse(confirmation.occurredAt) - Date.parse(started.occurredAt));
    }
  }
  for (const kind of KINDS) {
    activation[kind].rate = ratio(activation[kind].activated, activation[kind].eligible);
    const sorted = durations[kind].sort((left, right) => left - right);
    const middle = Math.floor(sorted.length / 2);
    decisionTime[kind].measured = sorted.length;
    decisionTime[kind].medianWallTimeMs = sorted.length
      ? (sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2) : null;
  }
  return { activation, decisionTime };
}

/** Aggregates only: no subject, plan, slot, operation or event identifiers leave
 * the result. A missing observation is not evidence of non-use. */
export function summarizeMealPlanPilot(input, { asOf } = {}) {
  const dataset = validatePilotDataset(input);
  const cutoff = instant(asOf);
  check(cutoff <= Date.parse(dataset.exportedAt));
  const subjects = dataset.subjects.filter(subject => subject.observedFrom <= asOf);
  const events = dataset.events.filter(event => event.occurredAt <= asOf);
  const subjectsById = new Map(subjects.map(subject => [subject.id, subject]));
  const eventsBySubject = new Map();
  for (const event of events) {
    const rows = eventsBySubject.get(event.subjectId) || [];
    rows.push(event);
    eventsBySubject.set(event.subjectId, rows);
  }
  const cancelled = new Set(events.filter(event => event.name === 'meal_cooked_reversed' && event.status === 'success')
    .map(event => event.reversesEventId));
  const usage = new Map();
  const weeks = new Set();
  for (const subject of subjects) {
    const through = Math.min(Date.parse(subject.observedThrough), cutoff);
    if (Date.parse(subject.observedFrom) > through) continue;
    for (let time = weekStart(weekAt(Date.parse(subject.observedFrom))); time <= through; time += WEEK) weeks.add(weekAt(time));
  }
  for (const event of events) {
    if (event.name !== 'meal_cooked_recorded' || event.status !== 'success' || cancelled.has(event.id)) continue;
    const bySubject = usage.get(event.weekKey) || new Map();
    const slots = bySubject.get(event.subjectId) || new Set();
    slots.add(event.slotId);
    bySubject.set(event.subjectId, slots);
    usage.set(event.weekKey, bySubject);
  }
  const active = key => [...(usage.get(key) || new Map())].filter(([, slots]) => slots.size >= 2).map(([id]) => id);
  const weekly = [...weeks].sort().map(weekKey => {
    const buckets = perKind(() => ({ activeSubjects: 0, activeSlots: 0 }));
    for (const [subjectId, slots] of usage.get(weekKey) || []) {
      const bucket = buckets[subjectsById.get(subjectId).kind];
      bucket.activeSlots += slots.size;
      if (slots.size >= 2) bucket.activeSubjects += 1;
    }
    return { weekKey, provisional: weekStart(weekKey) + WEEK > cutoff, ...buckets };
  });
  const retention = [];
  for (const { weekKey } of weekly) {
    const nextStart = weekStart(weekKey) + WEEK;
    if (nextStart + WEEK > cutoff) continue;
    const cohort = active(weekKey);
    if (!cohort.length) continue;
    const nextWeekKey = weekAt(nextStart);
    const retained = new Set(active(nextWeekKey));
    const buckets = perKind(() => ({ eligible: 0, retainedObserved: 0, observedInactive: 0, missingObservation: 0, rate: null }));
    for (const id of cohort) {
      const subject = subjectsById.get(id);
      const bucket = buckets[subject.kind];
      bucket.eligible += 1;
      if (retained.has(id)) bucket.retainedObserved += 1;
      else if (covers(subject, nextStart, nextStart + WEEK)) bucket.observedInactive += 1;
      else bucket.missingObservation += 1;
    }
    for (const kind of KINDS) buckets[kind].rate = ratio(buckets[kind].retainedObserved, buckets[kind].eligible);
    retention.push({ weekKey, nextWeekKey, ...buckets });
  }
  return { schemaVersion: 1, calculationVersion: 'meal-plan-pilot-v1', asOf, exportedAt: dataset.exportedAt, timeZone: 'Asia/Seoul',
    counts: { inputSubjects: dataset.subjects.length, subjects: subjects.length, noEventSubjects: subjects.filter(subject => !eventsBySubject.has(subject.id)).length,
      inputEvents: input.events.length, uniqueEvents: dataset.events.length, duplicateEvents: input.events.length - dataset.events.length,
      includedEvents: events.length, afterCutoffEvents: dataset.events.length - events.length },
    weekly, retention, ...summarizeActivation(subjects, eventsBySubject, cutoff) };
}
