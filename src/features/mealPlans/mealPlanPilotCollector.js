import { accessMealPlanPilotSession, mealPlanPilotConsentView, saveMealPlanPilotSession, subscribeMealPlanPilotStore } from './mealPlanPilotConsent';
import { createPilotVersion, parsePilotInstant } from './mealPlanPilotPolicy';
import { isMealPlanFeedback } from './mealPlanFeedback';

const ERROR = '파일럿 관측을 이어가지 못했어요. 상태를 확인하고 다시 시작해주세요.';
const DEADLINE = 2000;
const tickets = new WeakMap();
const degraded = new Map();
const resumeEpochs = new Map();
const subscribers = new Map();
let owner;
let channel;
let unsubscribeStore;
const pageOwner = () => owner ||= createPilotVersion();
const scopeValid = scope => typeof scope === 'string' && (scope === 'guest' || /^user:[A-Za-z0-9_-]+$/.test(scope));
const nowISO = () => new Date().toISOString();
const earliest = values => values.filter(Boolean).sort()[0];

function check(condition) { if (!condition) throw new Error(ERROR); }

function view(row) {
  return { ...mealPlanPilotConsentView(row), captureState: row?.capture?.state || 'paused',
    gapCount: (row?.gaps?.length || 0) + (row?.capture?.missingSince ? 1 : 0), pendingCount: row?.capture?.pending.length || 0 };
}

function pause(row, since) {
  row.capture.state = 'paused';
  const from = earliest([row.capture.missingSince, row.observedThrough, since,
    ...row.capture.pending.map(item => item.startedAt)]);
  row.capture.missingSince = from < row.startedAt ? row.startedAt : from;
}

const currentEpoch = scope => resumeEpochs.get(scope) || 0;

function lossAffects(row, scope, loss = degraded.get(scope)) {
  if (!loss || loss.epoch !== currentEpoch(scope) || row?.schemaVersion !== 2) return false;
  return loss.version === null ? row.capture.owner === pageOwner()
    : row.version === loss.version && row.capture.version === loss.captureVersion;
}

function rememberLoss(scope, row, since = nowISO(), epoch = currentEpoch(scope)) {
  if (!scopeValid(scope) || epoch !== currentEpoch(scope)) return false;
  const previous = degraded.get(scope);
  degraded.set(scope, { version: row?.version ?? null, captureVersion: row?.capture?.version ?? null, epoch,
    since: earliest([previous?.epoch === epoch ? previous.since : null, since]) });
  signalSubscribers();
  try { channel?.postMessage({ type: 'changed' }); } catch { /* Only a best-effort notification. */ }
  return true;
}

function observeOwner(row, scope, store, now, changed) {
  if (row?.status !== 'active') { degraded.delete(scope); return; }
  if (row.schemaVersion !== 2) return;
  const loss = degraded.get(scope);
  const affected = lossAffects(row, scope, loss);
  if (row.capture.state === 'collecting' && (row.capture.owner !== pageOwner() || affected)) {
    pause(row, affected ? loss.since : null);
    saveMealPlanPilotSession(store, row, now, changed);
  }
}

function signalSubscribers() {
  for (const callbacks of subscribers.values()) {
    for (const callback of callbacks) { try { callback(); } catch { /* Observers cannot affect storage or user work. */ } }
  }
}

function startNotifications() {
  if (unsubscribeStore) return;
  if (typeof window !== 'undefined') window.addEventListener('focus', signalSubscribers);
  try {
    if (typeof globalThis.BroadcastChannel === 'function') {
      channel = new BroadcastChannel('fridgemate-local-meal-plan-pilot');
      channel.onmessage = event => { if (event.data?.type === 'changed') signalSubscribers(); };
    }
  } catch { channel = undefined; }
  unsubscribeStore = subscribeMealPlanPilotStore(() => {
    signalSubscribers();
    try { channel?.postMessage({ type: 'changed' }); } catch { /* Focus remains a fallback. */ }
  });
}

export function subscribeMealPlanPilotCapture(scope, callback) {
  check(scopeValid(scope) && typeof callback === 'function');
  const callbacks = subscribers.get(scope) || new Set();
  callbacks.add(callback);
  subscribers.set(scope, callbacks);
  startNotifications();
  return () => {
    callbacks.delete(callback);
    if (!callbacks.size) subscribers.delete(scope);
    if (subscribers.size) return;
    unsubscribeStore?.(); unsubscribeStore = undefined;
    if (typeof window !== 'undefined') window.removeEventListener('focus', signalSubscribers);
    try { channel?.close(); } catch { /* Closing a notification transport is best effort. */ }
    channel = undefined;
  };
}

export async function getMealPlanPilotCapture(scope = 'guest') {
  try {
    return await accessMealPlanPilotSession(scope, row => {
      if (row?.status === 'active' && row.schemaVersion === 2 && (row.capture.owner !== pageOwner() || lossAffects(row, scope))) {
        return { ...view(row), captureState: 'paused', gapCount: view(row).gapCount
          + (lossAffects(row, scope) && !row.capture.missingSince ? 1 : 0) };
      }
      return view(row);
    });
  } catch { throw new Error(ERROR); }
}

function addMissingGap(row, from, through) {
  if (from >= through) return;
  const gaps = [...row.gaps, { from, through, reason: 'missing' }].sort((a, b) => a.from.localeCompare(b.from));
  const merged = [];
  for (const gap of gaps) {
    const previous = merged.at(-1);
    if (previous && previous.through >= gap.from && previous.reason === 'missing' && gap.reason === 'missing') {
      previous.through = previous.through > gap.through ? previous.through : gap.through;
    } else {
      check(!previous || previous.through <= gap.from);
      merged.push({ ...gap });
    }
  }
  check(merged.length <= 100);
  row.gaps = merged;
}

export async function resumeMealPlanPilotCapture(input, { isCurrent = () => true } = {}) {
  try {
    check(input && Object.keys(input).length === 2 && scopeValid(input.scope) && typeof input.expectedVersion === 'string');
    const result = await accessMealPlanPilotSession(input.scope, (row, store, now, changed) => {
      if (row?.status !== 'active' || row.version !== input.expectedVersion) return null;
      const loss = degraded.get(input.scope);
      const rememberedSince = earliest([row.observedThrough, row.capture?.missingSince,
        ...(row.capture?.pending || []).map(item => item.startedAt),
        lossAffects(row, input.scope, loss) ? loss.since : null]);
      // A failed read during clock rollback can only give us a local loss hint,
      // not evidence of observations before consent began.
      const since = rememberedSince < row.startedAt ? row.startedAt : rememberedSince;
      const next = structuredClone(row);
      addMissingGap(next, since, now);
      next.observedThrough = now;
      next.schemaVersion = 2;
      next.capture = { state: 'collecting', version: createPilotVersion(), owner: pageOwner(), missingSince: null,
        pending: [], aliasSecret: row.capture?.aliasSecret || createPilotVersion() };
      saveMealPlanPilotSession(store, next, now, changed);
      return view(next);
    }, { isCurrent });
    check(result !== null);
    resumeEpochs.set(input.scope, currentEpoch(input.scope) + 1);
    degraded.delete(input.scope);
    return result;
  } catch { throw new Error(ERROR); }
}

async function bounded(task, onTimeout) {
  const controller = new AbortController();
  let timer;
  try {
    return await Promise.race([task(controller.signal), new Promise((_, reject) => {
      timer = setTimeout(() => { controller.abort(); onTimeout(); reject(new Error(ERROR)); }, DEADLINE);
    })]);
  } finally { clearTimeout(timer); }
}

function validateDescriptor(value) {
  const required = ['name', 'status', 'sourceKey', 'operationKey', 'occurredAt'];
  const optional = ['planKey', 'slotKey', 'reversesKey', 'plannedSlotCount', 'engineVersion', 'changeType', 'reasonCode'];
  check(value && typeof value === 'object' && !Array.isArray(value)
    && required.every(key => Object.hasOwn(value, key))
    && Reflect.ownKeys(value).every(key => [...required, ...optional].includes(key)));
  check(parsePilotInstant(value.occurredAt) !== null);
  if (Object.hasOwn(value, 'changeType') || Object.hasOwn(value, 'reasonCode')) {
    check(Object.hasOwn(value, 'changeType') && Object.hasOwn(value, 'reasonCode')
      && value.name === 'meal_slot_changed' && value.status === 'success'
      && isMealPlanFeedback(value.changeType, value.reasonCode));
  }
  for (const key of ['sourceKey', 'operationKey', 'planKey', 'slotKey', 'reversesKey']) {
    if (Object.hasOwn(value, key)) check(typeof value[key] === 'string' && value[key].length > 0 && value[key].length <= 512);
  }
}

async function pseudonym(key, prefix, source) {
  const signed = await globalThis.crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${prefix}:${source}`));
  return `${prefix}_${Array.from(new Uint8Array(signed).slice(0, 16), byte => byte.toString(16).padStart(2, '0')).join('')}`;
}

async function eventsFor(row, descriptors) {
  check(Array.isArray(descriptors) && descriptors.length <= 32 && Reflect.ownKeys(descriptors).length === descriptors.length + 1);
  descriptors.forEach(validateDescriptor);
  const key = await globalThis.crypto.subtle.importKey('raw', Uint8Array.from(row.capture.aliasSecret.match(/../g), byte => parseInt(byte, 16)),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return Promise.all(descriptors.map(async descriptor => {
    const date = new Date(Date.parse(descriptor.occurredAt) + 9 * 3600000);
    date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7);
    const event = { version: Object.hasOwn(descriptor, 'changeType') ? 2 : 1, name: descriptor.name, status: descriptor.status,
      id: await pseudonym(key, 'evt', descriptor.sourceKey), subjectId: row.subjectId,
      operationId: await pseudonym(key, 'op', descriptor.operationKey), occurredAt: descriptor.occurredAt,
      weekKey: date.toISOString().slice(0, 10) };
    for (const [source, target, prefix] of [['planKey', 'planId', 'plan'], ['slotKey', 'slotId', 'slot'], ['reversesKey', 'reversesEventId', 'evt']]) {
      if (Object.hasOwn(descriptor, source)) event[target] = await pseudonym(key, prefix, descriptor[source]);
    }
    for (const field of ['plannedSlotCount', 'engineVersion', 'changeType', 'reasonCode']) {
      if (Object.hasOwn(descriptor, field)) event[field] = descriptor[field];
    }
    return event;
  }));
}

const eventSignature = event => JSON.stringify(Object.fromEntries(Object.keys(event).sort().map(key => [key, event[key]])));

function append(row, events) {
  const byId = new Map(row.events.map(event => [event.id, event]));
  let added = 0;
  for (const event of events) {
    const previous = byId.get(event.id);
    check(!previous || eventSignature(previous) === eventSignature(event));
    if (!previous) { byId.set(event.id, event); added += 1; }
  }
  check(byId.size <= 50000);
  row.events = [...byId.values()];
  return added;
}

function sameCapture(row, reference) {
  return row?.status === 'active' && row.schemaVersion === 2 && row.version === reference.version
    && row.capture.version === reference.capture.version && row.capture.owner === pageOwner() && row.capture.state === 'collecting';
}

async function persistLoss(scope, reference, signal, epoch) {
  if (!rememberLoss(scope, reference, nowISO(), epoch)) return;
  if (signal?.aborted) return;
  try {
    await accessMealPlanPilotSession(scope, (row, store, now, changed) => {
      if (row?.status !== 'active' || !lossAffects(row, scope)) return;
      pause(row, degraded.get(scope)?.since);
      saveMealPlanPilotSession(store, row, now, changed);
    }, { signal });
  } catch { /* Keep the in-memory loss flag until a successful explicit resume. */ }
}

export async function beginMealPlanPilotOperation(input, { isCurrent = () => true } = {}) {
  let reference;
  const scope = input?.scope;
  if (!scopeValid(scope)) return null;
  const epoch = currentEpoch(scope);
  try {
    check(input && Reflect.ownKeys(input).every(key => ['scope', 'startEvent'].includes(key)));
    const startEvent = input.startEvent === undefined ? null : structuredClone(input.startEvent);
    return await bounded(async signal => {
      reference = await accessMealPlanPilotSession(scope, (row, store, now, changed) => {
        observeOwner(row, scope, store, now, changed);
        return row?.status === 'active' && row.schemaVersion === 2 && row.capture.state === 'collecting' ? row : null;
      }, { isCurrent, signal });
      if (!reference) return null;
      try {
        if (startEvent) check(startEvent.name === 'meal_plan_generation_started' && startEvent.status === 'started');
        const events = startEvent ? await eventsFor(reference, [startEvent]) : [];
        const id = createPilotVersion();
        const result = await accessMealPlanPilotSession(scope, (row, store, now, changed) => {
          if (!sameCapture(row, reference)) return null;
          if (lossAffects(row, scope)) { observeOwner(row, scope, store, now, changed); return null; }
          check(row.capture.pending.length < 100);
          append(row, events);
          row.observedThrough = now;
          row.capture.pending.push({ id, startedAt: now });
          saveMealPlanPilotSession(store, row, now, changed);
          return true;
        }, { isCurrent, signal });
        if (!result) return null;
        const ticket = Object.freeze(Object.create(null));
        tickets.set(ticket, { scope, reference, id, epoch, result: null });
        return ticket;
      } catch {
        await persistLoss(scope, reference, signal, epoch);
        return null;
      }
    }, () => rememberLoss(scope, reference, nowISO(), epoch));
  } catch {
    try { if (isCurrent() === true) rememberLoss(scope, reference, nowISO(), epoch); } catch { /* A stale UI is not a new observation. */ }
    return null;
  }
}

export function finishMealPlanPilotOperation(ticket, descriptors) {
  const operation = tickets.get(ticket);
  if (!operation) return Promise.resolve({ status: 'ignored' });
  if (operation.result) return operation.result;
  operation.result = (async () => {
    try {
      const copied = structuredClone(descriptors);
      return await bounded(async signal => {
        try {
          const events = await eventsFor(operation.reference, copied);
          const count = await accessMealPlanPilotSession(operation.scope, (row, store, now, changed) => {
            if (!sameCapture(row, operation.reference) || !row.capture.pending.some(item => item.id === operation.id)) return null;
            if (lossAffects(row, operation.scope)) { observeOwner(row, operation.scope, store, now, changed); return null; }
            const added = append(row, events);
            row.observedThrough = now;
            row.capture.pending = row.capture.pending.filter(item => item.id !== operation.id);
            saveMealPlanPilotSession(store, row, now, changed);
            return added;
          }, { signal });
          return count === null ? { status: 'ignored' } : { status: 'recorded', recordedCount: count };
        } catch {
          await persistLoss(operation.scope, operation.reference, signal, operation.epoch);
          return { status: signal.aborted ? 'unavailable' : 'missing' };
        }
      }, () => rememberLoss(operation.scope, operation.reference, nowISO(), operation.epoch));
    } catch {
      rememberLoss(operation.scope, operation.reference, nowISO(), operation.epoch);
      return { status: 'unavailable' };
    }
  })();
  return operation.result;
}
