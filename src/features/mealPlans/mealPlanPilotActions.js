import { beginMealPlanPilotOperation, finishMealPlanPilotOperation } from './mealPlanPilotCollector';

// These operation keys are transient correlation values, not stored identities.
// The collector independently pseudonymizes all keys within a consent period.
export function createMealPlanPilotOperation(name, fields = {}) {
  let operationKey = null;
  try {
    const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
    operationKey = `action:${Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')}`;
  } catch { /* No secure identity means missing observation, not blocked business. */ }
  return { operationKey, failureEvent: () => ({ name, status: 'failure',
    sourceKey: `${name}:failure:${operationKey}`, operationKey, occurredAt: new Date().toISOString(), ...fields }) };
}

async function finish(ticket, events) {
  try { await finishMealPlanPilotOperation(ticket, events); } catch { /* Optional observation never changes business truth. */ }
}

/** Collector deadlines live in the collector. Only the business callback's
 * rejection is a business failure; mapping or observation errors are separate.
 * isCurrent gates starting work, not acknowledging an already committed write. */
export async function runMealPlanPilotAction({ scope, startEvent, failureEvent, isCurrent = () => true }, business, eventsForResult) {
  let ticket = null;
  try { ticket = await beginMealPlanPilotOperation({ scope, ...(startEvent ? { startEvent } : {}) }, { isCurrent }); } catch { /* Continue business. */ }
  const terminal = status => {
    const event = typeof failureEvent === 'function' ? failureEvent() : failureEvent;
    return event ? [{ ...event, status }] : [];
  };
  if (!isCurrent()) {
    await finish(ticket, terminal('cancelled'));
    return null;
  }
  let result;
  try { result = await business(); }
  catch (error) {
    try { await finish(ticket, terminal('failure')); } catch { /* Preserve the original rejection. */ }
    throw error;
  }
  try { await finish(ticket, eventsForResult(result)); }
  catch { await finish(ticket, null); } // Invalid mapping is missing observation, never failed business.
  return result;
}

export function mealCookingPilotEvents({ event }) {
  const common = { status: 'success', operationKey: event.operationId, occurredAt: event.createdAt,
    planKey: `week:${event.weekStart}`, slotKey: event.slotId };
  const descriptor = (name, id, extra = {}) => ({ name, ...common, sourceKey: `${name}:${id}`, ...extra });
  if (event.kind === 'cooking') return [
    descriptor('meal_cooked_recorded', event.id),
    ...(event.consumptionId ? [descriptor('consumption_applied', event.consumptionId)] : []),
  ];
  if (event.kind === 'consumption') return [
    ...(event.replacesId ? [descriptor('consumption_reversed', `consumption-reversal:${event.operationId}`,
      { reversesKey: `consumption_applied:${event.replacesId}` })] : []),
    descriptor('consumption_applied', event.id),
  ];
  const consumption = event.kind === 'consumption-reversal';
  return [descriptor(consumption ? 'consumption_reversed' : 'meal_cooked_reversed', event.id,
    { reversesKey: `${consumption ? 'consumption_applied' : 'meal_cooked_recorded'}:${event.reversesId}` })];
}
