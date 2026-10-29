import { webcrypto } from 'node:crypto';
import FDBFactory from 'fake-indexeddb/lib/FDBFactory';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({ storageScope: 'guest', loading: false }));
vi.mock('../useAuth', () => ({ useAuth: () => auth }));
const WEEK = '2026-09-28';
const NOW = '2026-09-28T03:00:00.000Z';
const SLOT = `${WEEK}:dinner`;
let hook;
let repository;
let domain;
let consent;
let collector;
let db;

async function ready({ optedIn = true, confirmed = false } = {}) {
  const plan = domain.generateMealPlan({ scope: 'guest', weekStart: WEEK, now: NOW,
    preferences: { servings: 1, dinnerDays: [0], excludedIngredients: [] } });
  await repository.saveMealPlan(plan, 'guest', 0);
  if (confirmed) await repository.confirmMealPlan(WEEK, 'guest', 1);
  if (optedIn) {
    const state = await consent.grantMealPlanPilotConsent({ scope: 'guest', expectedVersion: null,
      accepted: true, policyVersion: 'local-pilot-35d-v1' });
    await collector.resumeMealPlanPilotCapture({ scope: 'guest', expectedVersion: state.version });
  }
  const view = renderHook(() => hook.useMealPlan(WEEK));
  await waitFor(() => expect(view.result.current.ready).toBe(true));
  return view;
}

const storedPilot = async () => (await db.runMealPlanPilotTransaction('readonly', store => store.getAll(), 'guest'))[0];
async function exportedEvents() {
  const state = await consent.getMealPlanPilotConsent();
  return (await consent.prepareMealPlanPilotExport({ scope: 'guest', expectedVersion: state.version })).dataset.events;
}

beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(NOW));
  vi.stubGlobal('crypto', webcrypto);
  Object.defineProperty(window, 'indexedDB', { configurable: true, value: new FDBFactory() });
  auth.storageScope = 'guest'; auth.loading = false;
  [hook, repository, domain, consent, collector, db] = await Promise.all([
    import('../useMealPlan'), import('../../features/mealPlans/mealPlanRepository'),
    import('../../features/mealPlans/mealPlanDomain'), import('../../features/mealPlans/mealPlanPilotConsent'),
    import('../../features/mealPlans/mealPlanPilotCollector'), import('../../db/indexedDB'),
  ]);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('optional meal feedback at the actual local storage boundary', () => {
  it('exports a replacement reason only after the new menu is saved and keeps it out of the plan', async () => {
    const view = await ready();
    const before = view.result.current.plan;
    const next = domain.replaceMealPlanSlot(before, SLOT, { now: NOW });
    expect(next.slots[0].templateKey).not.toBe(before.slots[0].templateKey);
    await act(async () => { expect(await view.result.current.savePlan(next,
      { slotId: SLOT, changeType: 'replace', reasonCode: 'repetition' })).not.toBeNull(); });
    expect((await repository.getMealPlan(WEEK)).draft.slots[0].templateKey).toBe(next.slots[0].templateKey);
    const events = await exportedEvents();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ version: 2, name: 'meal_slot_changed', status: 'success',
      changeType: 'replace', reasonCode: 'repetition', occurredAt: NOW });
    expect(JSON.stringify(await repository.getMealPlan(WEEK))).not.toMatch(/reasonCode|changeType/);
    expect(JSON.stringify(events)).not.toMatch(/week:|:dinner|templateKey|excludedIngredients/);
  });

  it('distinguishes skipping without answering from old uninstrumented changes', async () => {
    const view = await ready();
    const next = domain.setMealPlanSlotSkipped(view.result.current.plan, SLOT, true, { now: NOW });
    await act(async () => { await view.result.current.savePlan(next,
      { slotId: SLOT, changeType: 'skip', reasonCode: 'not_answered' }); });
    expect((await repository.getMealPlan(WEEK)).draft.slots[0].status).toBe('skipped');
    expect(await exportedEvents()).toEqual([expect.objectContaining({ version: 2,
      name: 'meal_slot_changed', changeType: 'skip', reasonCode: 'not_answered' })]);
    expect((await storedPilot()).events.some(event => event.name === 'meal_cooked_recorded')).toBe(false);
  });

  it('records an explicitly reported past confirmed meal as not cooked while retaining its confirmed hold until confirmation', async () => {
    const view = await ready({ confirmed: true });
    vi.setSystemTime(new Date('2026-09-29T03:00:00.000Z'));
    const next = domain.setMealPlanSlotSkipped(view.result.current.plan, SLOT, true);
    await act(async () => { await view.result.current.savePlan(next,
      { slotId: SLOT, changeType: 'not_cooked', reasonCode: 'schedule' }); });
    const record = await repository.getMealPlan(WEEK);
    expect(record.draft.slots[0].status).toBe('skipped');
    expect(record.confirmed.slots[0].status).toBe('planned');
    expect(await exportedEvents()).toEqual([expect.objectContaining({ version: 2,
      name: 'meal_slot_changed', changeType: 'not_cooked', reasonCode: 'schedule' })]);
  });

  it('saves the selected menu without collecting feedback when there is no pilot consent', async () => {
    const view = await ready({ optedIn: false });
    const next = domain.replaceMealPlanSlot(view.result.current.plan, SLOT, { now: NOW });
    await act(async () => { expect(await view.result.current.savePlan(next,
      { slotId: SLOT, changeType: 'replace', reasonCode: 'taste' })).not.toBeNull(); });
    expect((await repository.getMealPlan(WEEK)).draft.slots[0].templateKey).toBe(next.slots[0].templateKey);
    expect(await storedPilot()).toBeUndefined();
  });

  it('keeps a reason out of unchanged saves and unrelated slot locking', async () => {
    const view = await ready();
    await act(async () => { await view.result.current.savePlan(view.result.current.plan,
      { slotId: SLOT, changeType: 'replace', reasonCode: 'cost' }); });
    expect(await exportedEvents()).toEqual([]);
    const next = domain.toggleMealPlanSlotLock(view.result.current.plan, SLOT, { now: NOW });
    await act(async () => { await view.result.current.savePlan(next,
      { slotId: SLOT, changeType: 'replace', reasonCode: 'cost' }); });
    const events = await exportedEvents();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ version: 1, name: 'meal_slot_changed' });
    expect(events[0]).not.toHaveProperty('reasonCode');
  });

  it('does not accept free text even when it targets the changed slot', async () => {
    const view = await ready();
    const next = domain.replaceMealPlanSlot(view.result.current.plan, SLOT, { now: NOW });
    await act(async () => { await view.result.current.savePlan(next,
      { slotId: SLOT, changeType: 'replace', reasonCode: 'PRIVATE NOTE' }); });
    expect((await repository.getMealPlan(WEEK)).draft.slots[0].templateKey).toBe(next.slots[0].templateKey);
    const events = await exportedEvents();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ version: 1, name: 'meal_slot_changed' });
    expect(JSON.stringify(events)).not.toMatch(/PRIVATE|reasonCode|changeType/);
  });

  it('does not attach a valid reason belonging to a different slot', async () => {
    const view = await ready();
    const next = domain.replaceMealPlanSlot(view.result.current.plan, SLOT, { now: NOW });
    await act(async () => { await view.result.current.savePlan(next,
      { slotId: '2026-09-29:dinner', changeType: 'replace', reasonCode: 'cost' }); });
    expect(await exportedEvents()).toEqual([expect.objectContaining({ version: 1, name: 'meal_slot_changed' })]);
    expect((await storedPilot()).events[0]).not.toHaveProperty('reasonCode');
  });

  it('preserves menu saves when optional feedback contains an uncloneable value', async () => {
    const view = await ready();
    const next = domain.replaceMealPlanSlot(view.result.current.plan, SLOT, { now: NOW });
    await act(async () => { expect(await view.result.current.savePlan(next,
      { slotId: SLOT, changeType: 'replace', reasonCode: () => 'taste' })).not.toBeNull(); });
    expect((await repository.getMealPlan(WEEK)).draft.slots[0].templateKey).toBe(next.slots[0].templateKey);
    expect(await exportedEvents()).toEqual([expect.objectContaining({ version: 1, name: 'meal_slot_changed' })]);
  });

  it('does not label a confirmed meal as not cooked on the same day', async () => {
    const view = await ready({ confirmed: true });
    const next = domain.setMealPlanSlotSkipped(view.result.current.plan, SLOT, true, { now: NOW });
    await act(async () => { await view.result.current.savePlan(next,
      { slotId: SLOT, changeType: 'not_cooked', reasonCode: 'schedule' }); });
    expect(await exportedEvents()).toEqual([expect.objectContaining({ version: 1, name: 'meal_slot_changed' })]);
    expect((await storedPilot()).events[0]).not.toHaveProperty('changeType');
  });

  it('keeps the original choice if the caller changes feedback while observation is opening', async () => {
    const view = await ready();
    const next = domain.replaceMealPlanSlot(view.result.current.plan, SLOT, { now: NOW });
    const originalBegin = collector.beginMealPlanPilotOperation;
    let release;
    let entered;
    const pending = new Promise(resolve => { release = resolve; });
    const started = new Promise(resolve => { entered = resolve; });
    vi.spyOn(collector, 'beginMealPlanPilotOperation').mockImplementationOnce(async (...args) => {
      entered(); await pending; return originalBegin(...args);
    });
    const feedback = { slotId: SLOT, changeType: 'replace', reasonCode: 'repetition' };
    await act(async () => {
      const save = view.result.current.savePlan(next, feedback);
      await started;
      feedback.reasonCode = 'taste';
      release();
      expect(await save).not.toBeNull();
    });
    expect(await exportedEvents()).toEqual([expect.objectContaining({ version: 2, reasonCode: 'repetition' })]);
  });

  it('leaves failed saves as failures without a successful reason record', async () => {
    const view = await ready();
    const before = await repository.getMealPlan(WEEK);
    const next = domain.replaceMealPlanSlot(view.result.current.plan, SLOT, { now: NOW });
    vi.spyOn(repository, 'saveMealPlan').mockRejectedValueOnce(new Error('저장 실패'));
    await act(async () => { expect(await view.result.current.savePlan(next,
      { slotId: SLOT, changeType: 'replace', reasonCode: 'ingredients' })).toBeNull(); });
    expect(await repository.getMealPlan(WEEK)).toEqual(before);
    expect(await exportedEvents()).toEqual([expect.objectContaining({ version: 1,
      name: 'meal_slot_changed', status: 'failure' })]);
    expect((await storedPilot()).events[0]).not.toHaveProperty('reasonCode');
  });
});
