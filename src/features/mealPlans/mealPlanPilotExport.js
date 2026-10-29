import { summarizeMealPlanPilot, validatePilotDataset } from './mealPlanPilotMetrics.js';
import { LOCAL_PILOT_POLICY, LOCAL_PILOT_RETENTION_MS, parsePilotInstant } from './mealPlanPilotPolicy.js';

const INVALID = '로컬 파일럿 내보내기의 형식·범위·보관 기간을 확인해주세요.';
const FIELDS = ['schemaVersion', 'exportKind', 'measurementUnit', 'policyVersion', 'startedAt', 'expiresAt', 'dataset'];

function check(condition) {
  if (!condition) throw new Error(INVALID);
}

function instant(value) {
  const time = parsePilotInstant(value);
  check(time !== null);
  return time;
}

/** A local consent period is one browser scope, never a deduplicated account.
 * Validate the recorded export instant, not today's clock: downloaded copies
 * cannot be remotely expired or erased by the browser that produced them. */
export function validateLocalMealPlanPilotExport(input) {
  try {
    check(input !== null && typeof input === 'object' && !Array.isArray(input)
      && [Object.prototype, null].includes(Object.getPrototypeOf(input)));
    check(Reflect.ownKeys(input).length === FIELDS.length && FIELDS.every(key => Object.hasOwn(input, key)));
    check(input.schemaVersion === 1 && input.exportKind === 'fridgemate-local-meal-plan-pilot'
      && input.measurementUnit === 'browser-scope' && input.policyVersion === LOCAL_PILOT_POLICY);
    const startedAt = instant(input.startedAt);
    const expiresAt = instant(input.expiresAt);
    check(expiresAt === startedAt + LOCAL_PILOT_RETENTION_MS);
    const dataset = validatePilotDataset(input.dataset);
    check(dataset.subjects.length === 1 && dataset.subjects[0].observedFrom === input.startedAt
      && dataset.subjects[0].firstGenerationKnown === false && instant(dataset.exportedAt) < expiresAt);
    return { schemaVersion: 1, exportKind: input.exportKind, measurementUnit: input.measurementUnit,
      policyVersion: input.policyVersion, startedAt: input.startedAt, expiresAt: input.expiresAt, dataset };
  } catch {
    // The same message covers bad nested values, including private raw data.
    throw new Error(INVALID);
  }
}

function browserKinds({ account, guest, ...rest }) {
  return { ...rest, signedInBrowser: account, guestBrowser: guest };
}

/** Reuse the vetted arithmetic, but never expose its account-label groups for
 * local aliases. No operational data, storage, current clock, or network reads. */
export function summarizeLocalMealPlanPilotExport(input, options) {
  try {
    validateLocalMealPlanPilotExport(input);
    // Use the raw validated dataset here, preserving the duplicate-input counts
    // that would disappear if the normalized validator result were summarized.
    const { weekly, retention, activation, decisionTime, ...metadata } = summarizeMealPlanPilot(input.dataset, options);
    return { ...metadata, measurementUnit: 'browser-scope', actualAccountKpisAvailable: false,
      weekly: weekly.map(browserKinds), retention: retention.map(browserKinds),
      activation: browserKinds(activation), decisionTime: browserKinds(decisionTime) };
  } catch {
    throw new Error(INVALID);
  }
}
