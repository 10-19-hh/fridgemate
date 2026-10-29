import { runMealPlanPilotTransaction } from '../../db/indexedDB';
import { isLocalPilotBuild } from '../../utils/pilotMode';
import { validateLocalMealPlanPilotExport } from './mealPlanPilotExport';
import { LOCAL_PILOT_POLICY, LOCAL_PILOT_RETENTION_MS, parsePilotInstant, createPilotVersion } from './mealPlanPilotPolicy.js';

const ERROR = '파일럿 설정을 확인하거나 저장하지 못했어요. 새로 확인한 뒤 다시 시도해주세요.';
const CLOSED_KEYS = ['id', 'schemaVersion', 'scope', 'status', 'version'];
const ACTIVE_KEYS = [...CLOSED_KEYS, 'policyVersion', 'startedAt', 'expiresAt', 'subjectId', 'kind',
  'observedThrough', 'firstGenerationKnown', 'gaps', 'events'];
const CAPTURE_KEYS = ['state', 'version', 'owner', 'missingSince', 'pending', 'aliasSecret'];
const CHANGE_LISTENERS = new Set();
const SKIPPED = Symbol('stale pilot request');
const DEADLINE = 2000;

function check(condition) {
  if (!condition) throw new Error(ERROR);
}

function exact(value, fields) {
  check(value !== null && typeof value === 'object' && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value))
    && Reflect.ownKeys(value).length === fields.length && fields.every(key => Object.hasOwn(value, key)));
}

function scopeValue(scope) {
  check(typeof scope === 'string' && (scope === 'guest' || /^user:[A-Za-z0-9_-]+$/.test(scope)));
  return scope;
}

function instant(value) {
  const time = parsePilotInstant(value);
  check(time !== null);
  return time;
}

function exportGaps(row) {
  const from = [row.capture?.missingSince, ...(row.capture?.pending || []).map(item => item.startedAt)].filter(Boolean).sort()[0];
  if (!from || from >= row.observedThrough) return row.gaps;
  const intervals = [...row.gaps, { from, through: row.observedThrough, reason: 'missing' }];
  const boundaries = [...new Set(intervals.flatMap(gap => [gap.from, gap.through]))].sort();
  const result = [];
  for (let index = 1; index < boundaries.length; index += 1) {
    const start = boundaries[index - 1];
    const through = boundaries[index];
    const covering = intervals.filter(gap => gap.from <= start && gap.through >= through);
    const gap = covering.find(item => item.reason !== 'missing') || covering[0];
    if (!gap) continue;
    const previous = result.at(-1);
    if (previous?.through === start && previous.reason === gap.reason) previous.through = through;
    else result.push({ from: start, through, reason: gap.reason });
  }
  return result;
}

function envelope(row, exportedAt, includePending = false) {
  return validateLocalMealPlanPilotExport({ schemaVersion: 1,
    exportKind: 'fridgemate-local-meal-plan-pilot', measurementUnit: 'browser-scope', policyVersion: row.policyVersion,
    startedAt: row.startedAt, expiresAt: row.expiresAt,
    dataset: { schemaVersion: 1, exportedAt, subjects: [{ id: row.subjectId, kind: row.kind,
      observedFrom: row.startedAt, observedThrough: row.observedThrough,
      firstGenerationKnown: row.firstGenerationKnown, gaps: includePending ? exportGaps(row) : row.gaps }], events: row.events },
  });
}

export function mealPlanPilotConsentView(row) {
  if (!row) return { status: 'off', version: null };
  if (row.status !== 'active') return { status: row.status, version: row.version };
  // A consent record is not proof that the application collector is connected.
  // No personal aliases or event payloads are needed for the settings display.
  return { status: 'active', version: row.version, policyVersion: row.policyVersion,
    startedAt: row.startedAt, expiresAt: row.expiresAt,
    eventCount: row.events.length, observedThrough: row.observedThrough };
}

/** Internal store notifications carry no account identifiers or source payloads. */
export function subscribeMealPlanPilotStore(callback) {
  CHANGE_LISTENERS.add(callback);
  return () => CHANGE_LISTENERS.delete(callback);
}

function notify() {
  for (const callback of CHANGE_LISTENERS) {
    try { callback(); } catch { /* Display failures cannot roll back storage. */ }
  }
}

function captureShape(row, now) {
  if (row.schemaVersion !== 2) return;
  const capture = row.capture;
  exact(capture, CAPTURE_KEYS);
  const hex = value => typeof value === 'string' && /^[a-f0-9]{32}$/.test(value);
  check(['paused', 'collecting'].includes(capture.state) && hex(capture.version) && hex(capture.aliasSecret)
    && (capture.owner === null || hex(capture.owner)) && (capture.state !== 'collecting' || capture.owner !== null));
  check(capture.missingSince === null || (instant(capture.missingSince) >= instant(row.startedAt) && instant(capture.missingSince) <= instant(now)));
  check(Array.isArray(capture.pending) && capture.pending.length <= 100
    && Reflect.ownKeys(capture.pending).length === capture.pending.length + 1);
  const ids = new Set();
  for (const item of capture.pending) {
    exact(item, ['id', 'startedAt']);
    check(hex(item.id) && !ids.has(item.id) && instant(item.startedAt) >= instant(row.startedAt) && instant(item.startedAt) <= instant(now));
    ids.add(item.id);
  }
}

/** Internal collector persistence: validate the export whitelist and private v2 fields together. */
export function saveMealPlanPilotSession(store, row, now, changed) {
  exact(row, row.schemaVersion === 2 ? [...ACTIVE_KEYS, 'capture'] : ACTIVE_KEYS);
  envelope(row, now);
  captureShape(row, now);
  store.put(row);
  changed();
}

function close(store, scope, status) {
  const row = { id: 'session', schemaVersion: 1, scope, status, version: createPilotVersion() };
  // Clear the whole dedicated store, including malformed/unexpected rows. Keep
  // only a fresh generation barrier so delayed pre-withdrawal writes cannot win.
  store.clear();
  store.put(row);
  return row;
}

function current(rows, store, scope, now) {
  const row = rows.find(item => item.id === 'session');
  if (!row) {
    check(rows.length === 0);
    return undefined;
  }
  check(row.id === 'session' && [1, 2].includes(row.schemaVersion) && row.scope === scope
    && typeof row.version === 'string' && /^[a-f0-9]{32}$/.test(row.version));
  if (row.status !== 'active') {
    check(rows.length === 1 && row.schemaVersion === 1);
    exact(row, CLOSED_KEYS);
    check(['expired', 'withdrawn'].includes(row.status));
    return row;
  }
  const started = instant(row.startedAt);
  const expiry = instant(row.expiresAt);
  check(expiry === started + LOCAL_PILOT_RETENTION_MS);
  // Expire all event/alias material together, never prune an original away from
  // a later reversal. An expired malformed payload must not prolong retention.
  if (instant(now) >= expiry) return close(store, scope, 'expired');
  check(rows.length === 1);
  exact(row, row.schemaVersion === 2 ? [...ACTIVE_KEYS, 'capture'] : ACTIVE_KEYS);
  check(row.policyVersion === LOCAL_PILOT_POLICY && row.kind === (scope === 'guest' ? 'guest' : 'account'));
  envelope(row, now);
  captureShape(row, now);
  return row;
}

export async function accessMealPlanPilotSession(scope, action, { allowCorrupt = false, isCurrent = () => true,
  signal, deadlineMs = DEADLINE } = {}) {
  scopeValue(scope);
  check(typeof isCurrent === 'function');
  let transaction;
  let timedOut = false;
  let changed = false;
  let timer;
  const valid = () => {
    try { return !timedOut && !signal?.aborted && isCurrent() === true; } catch { return false; }
  };
  const abort = () => { try { transaction?.abort(); } catch { /* Already completed. */ } };
  signal?.addEventListener('abort', abort, { once: true });
  try {
    const work = runMealPlanPilotTransaction('readwrite', (store, tx) => {
      transaction = tx;
      if (timedOut || signal?.aborted) { tx.abort(); return { result: SKIPPED }; }
      const output = { result: undefined };
      const request = store.getAll();
      request.onsuccess = () => {
        try {
          if (timedOut || signal?.aborted) { tx.abort(); return; }
          // Opening/queuing an IDB transaction may cross the expiry boundary.
          const now = new Date().toISOString();
          instant(now);
          const row = allowCorrupt ? undefined : current(request.result, store, scope, now);
          if (!allowCorrupt && row !== request.result.find(item => item.id === 'session')) changed = true;
          output.result = valid() ? action(row, store, now, () => { changed = true; }) : SKIPPED;
        } catch {
          tx.abort();
        }
      };
      return output;
    }, scope);
    const result = await Promise.race([work, new Promise((_, reject) => {
      timer = setTimeout(() => { timedOut = true; abort(); reject(new Error(ERROR)); }, deadlineMs);
    })]);
    if (changed) notify();
    check(result !== SKIPPED && valid());
    return result;
  } catch {
    // Never forward IndexedDB/provider messages or malformed private values.
    throw new Error(ERROR);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}

/** Consent storage only: never enables GA, emits a product event, reads the
 * operational ledger, or infers that the first observed generation is first use. */
export function getMealPlanPilotConsent(scope = 'guest') {
  return accessMealPlanPilotSession(scope, row => mealPlanPilotConsentView(row));
}

export async function grantMealPlanPilotConsent(input, options) {
  check(isLocalPilotBuild());
  exact(input, ['scope', 'expectedVersion', 'policyVersion', 'accepted']);
  const { scope, expectedVersion, policyVersion, accepted } = input;
  scopeValue(scope);
  // Do not promise next-startup cleanup on browsers that cannot enumerate the
  // existing account databases. Reading/withdrawing old consent remains possible.
  let canEnumerate = false;
  try { canEnumerate = typeof window !== 'undefined' && typeof window.indexedDB?.databases === 'function'; } catch { /* Do not reflect provider errors. */ }
  check(canEnumerate);
  check(accepted === true && policyVersion === LOCAL_PILOT_POLICY
    && (expectedVersion === null || (typeof expectedVersion === 'string' && /^[a-f0-9]{32}$/.test(expectedVersion))));
  const result = await accessMealPlanPilotSession(scope, (previous, store, now, changed) => {
    check(isLocalPilotBuild());
    // A stale grant must not roll back a just-completed expiry purge.
    if (previous?.status === 'active' || (previous?.version ?? null) !== expectedVersion) return null;
    const expiresAt = new Date(instant(now) + LOCAL_PILOT_RETENTION_MS).toISOString();
    instant(expiresAt);
    const row = { id: 'session', schemaVersion: 1, scope, status: 'active', version: createPilotVersion(), policyVersion: LOCAL_PILOT_POLICY,
      startedAt: now, expiresAt, subjectId: `sub_${createPilotVersion()}`, kind: scope === 'guest' ? 'guest' : 'account',
      observedThrough: now, firstGenerationKnown: false, gaps: [], events: [] };
    envelope(row, now);
    store.put(row);
    changed();
    return mealPlanPilotConsentView(row);
  }, options);
  check(result !== null);
  return result;
}

/** Explicit withdrawal does not depend on being able to parse a damaged row. */
export async function withdrawMealPlanPilotConsent(scope = 'guest', options) {
  const guarded = options !== undefined;
  if (guarded) check(options !== null && typeof options === 'object' && Object.hasOwn(options, 'expectedVersion'));
  const result = await accessMealPlanPilotSession(scope, (row, store, _now, changed) => {
    if (guarded && (row?.version ?? null) !== options.expectedVersion) return null;
    const closed = close(store, scope, 'withdrawn');
    changed();
    return mealPlanPilotConsentView(closed);
  }, { ...options, allowCorrupt: !guarded });
  check(result !== null);
  return result;
}

export async function prepareMealPlanPilotExport(input, options) {
  exact(input, ['scope', 'expectedVersion']);
  const { scope, expectedVersion } = input;
  scopeValue(scope);
  // Return an unavailable marker from the transaction, then reject outside it.
  // Throwing while purging an expired session would roll its deletion back.
  const result = await accessMealPlanPilotSession(scope, (row, _store, now) => row?.status === 'active' && row.version === expectedVersion
    ? envelope(row, now, true) : null, options);
  check(result !== null);
  return result;
}
