import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useMealPlan } from '../useMealPlan';
import * as plans from '../../features/mealPlans/mealPlanRepository';
import { clearAccountLocalData } from '../../db/indexedDB';
import { generateMealPlan, toggleMealPlanSlotLock } from '../../features/mealPlans/mealPlanDomain';

const auth = vi.hoisted(() => ({ storageScope: 'guest', loading: false }));
const collector = vi.hoisted(() => ({ begin: vi.fn(), finish: vi.fn() }));
vi.mock('../useAuth', () => ({ useAuth: () => auth }));
vi.mock('../../features/mealPlans/mealPlanPilotCollector', () => ({
  beginMealPlanPilotOperation: (...args) => collector.begin(...args),
  finishMealPlanPilotOperation: (...args) => collector.finish(...args),
}));
const WEEK = '2026-09-28';
const NOW = '2026-09-28T03:00:00.000Z';
const LATER = '2026-09-28T03:02:00.000Z';
const makePlan = () => generateMealPlan({ scope: 'guest', weekStart: WEEK, now: NOW,
  preferences: { servings: 1, dinnerDays: [0], excludedIngredients: [] } });
const events = () => collector.finish.mock.calls.flatMap(call => call[1]);
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}
async function ready() {
  const view = renderHook(() => useMealPlan(WEEK));
  await waitFor(() => expect(view.result.current.ready).toBe(true));
  return view;
}

beforeEach(async () => {
  vi.resetAllMocks();
  vi.stubEnv('VITE_LOCAL_PILOT_ENABLED', 'true');
  auth.storageScope = 'guest'; auth.loading = false;
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(NOW));
  for (const scope of ['guest', 'user:pilot-b']) await clearAccountLocalData(scope);
  collector.begin.mockResolvedValue(Object.freeze({}));
  collector.finish.mockResolvedValue({ status: 'recorded' });
});
afterEach(async () => {
  cleanup(); vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.useRealTimers();
  for (const scope of ['guest', 'user:pilot-b']) await clearAccountLocalData(scope);
});

describe('meal plan pilot integration at guarded storage ACK boundaries', () => {
  it('starts observation immediately before real generation and acknowledges only its persisted draft', async () => {
    const view = await ready();
    expect(view.result.current.generatePlan).toBeTypeOf('function');
    const order = [];
    collector.begin.mockImplementation(async input => { order.push(input.startEvent.name); return Object.freeze({}); });
    collector.finish.mockImplementation(async (_ticket, rows) => {
      expect((await plans.getMealPlan(WEEK)).draft.slots[0].status).toBe('planned');
      order.push(rows[0].name);
    });
    await act(async () => {
      const result = await view.result.current.generatePlan(() => { order.push('calculate'); return makePlan(); });
      expect(result.slots[0].status).toBe('planned');
    });
    expect(order).toEqual(['meal_plan_generation_started', 'calculate', 'meal_plan_generated']);
    expect(events()).toEqual([expect.objectContaining({ name: 'meal_plan_generated', status: 'success', plannedSlotCount: 1,
      engineVersion: 'weekly-dinner-rules-v3', planKey: `week:${WEEK}` })]);
    expect(collector.begin.mock.calls[0][0].startEvent.operationKey).toBe(events()[0].operationKey);
  });

  it('records confirmation at its record ACK timestamp rather than the older draft timestamp', async () => {
    await plans.saveMealPlan(makePlan(), 'guest', 0);
    const view = await ready();
    vi.setSystemTime(new Date(LATER));
    await act(async () => { await view.result.current.confirmPlan(); });
    const record = await plans.getMealPlan(WEEK);
    expect(record.confirmed.updatedAt).toBe(NOW);
    expect(record.updatedAt).toBe(LATER);
    expect(events()).toEqual([expect.objectContaining({ name: 'meal_plan_confirmed', status: 'success', occurredAt: LATER,
      plannedSlotCount: 1, planKey: `week:${WEEK}` })]);
  });

  it('records only an actual saved slot change and never a read or unchanged draft save', async () => {
    await plans.saveMealPlan(makePlan(), 'guest', 0);
    const view = await ready();
    expect(events()).toEqual([]);
    await act(async () => { await view.result.current.savePlan(view.result.current.plan); });
    expect(events()).toEqual([]);
    const next = toggleMealPlanSlotLock(view.result.current.plan, `${WEEK}:dinner`);
    await act(async () => { await view.result.current.savePlan(next); });
    expect(events()).toEqual([expect.objectContaining({ name: 'meal_slot_changed', status: 'success',
      planKey: `week:${WEEK}`, slotKey: `${WEEK}:dinner` })]);
    expect((await plans.getMealPlan(WEEK)).draft.slots[0].locked).toBe(true);
  });

  it('records calculation rejection as failure while keeping the previous saved plan and permitting retry', async () => {
    await plans.saveMealPlan(makePlan(), 'guest', 0);
    const view = await ready();
    expect(view.result.current.generatePlan).toBeTypeOf('function');
    await act(async () => { expect(await view.result.current.generatePlan(() => { throw new Error('generation failed'); })).toBeNull(); });
    expect(view.result.current.error).toBe('generation failed');
    expect((await plans.getMealPlan(WEEK)).revision).toBe(1);
    expect(events()).toEqual([expect.objectContaining({ name: 'meal_plan_generated', status: 'failure' })]);
    await act(async () => { await view.result.current.generatePlan(makePlan); });
    expect(view.result.current.error).toBe('');
    expect((await plans.getMealPlan(WEEK)).revision).toBe(2);
  });

  it('does not calculate or write after scope changes while the pending observation is opening', async () => {
    const pending = deferred();
    collector.begin.mockReturnValue(pending.promise);
    const view = await ready();
    expect(view.result.current.generatePlan).toBeTypeOf('function');
    let calculations = 0;
    let saving;
    act(() => { saving = view.result.current.generatePlan(() => { calculations += 1; return makePlan(); }); });
    auth.storageScope = 'user:pilot-b'; view.rerender();
    await waitFor(() => expect(view.result.current.ready).toBe(true));
    await act(async () => { pending.resolve(Object.freeze({})); expect(await saving).toBeNull(); });
    expect(calculations).toBe(0);
    expect(await plans.getMealPlan(WEEK, 'guest')).toBeNull();
    expect(await plans.getMealPlan(WEEK, 'user:pilot-b')).toBeNull();
    expect(events()).toEqual([expect.objectContaining({ name: 'meal_plan_generated', status: 'cancelled' })]);
  });

  it('acknowledges a committed old-scope save without exposing it or turning it into a failure', async () => {
    await plans.saveMealPlan(makePlan(), 'guest', 0);
    const view = await ready();
    const read = plans.confirmMealPlan;
    const committed = deferred();
    const release = deferred();
    vi.spyOn(plans, 'confirmMealPlan').mockImplementationOnce(async (...args) => {
      const result = await read(...args); committed.resolve(); await release.promise; return result;
    });
    let saving;
    await act(async () => { saving = view.result.current.confirmPlan(); await committed.promise; });
    auth.storageScope = 'user:pilot-b'; view.rerender();
    await waitFor(() => expect(view.result.current.ready).toBe(true));
    await act(async () => { release.resolve(); expect(await saving).toBeNull(); });
    expect(view.result.current.confirmedPlan).toBeNull();
    expect((await plans.getMealPlan(WEEK, 'guest')).confirmed).not.toBeNull();
    expect(events()).toEqual([expect.objectContaining({ name: 'meal_plan_confirmed', status: 'success' })]);
  });
});
