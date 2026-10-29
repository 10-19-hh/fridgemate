import { useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import MealCookingPanel from '../MealCookingPanel';
import { clearAccountLocalData } from '../../db/indexedDB';
import { generateMealPlan } from '../../features/mealPlans/mealPlanDomain';
import { confirmMealPlan, getMealPlan, saveMealPlan } from '../../features/mealPlans/mealPlanRepository';
import * as cooking from '../../features/mealPlans/mealCookingRepository';

const WEEK = '2026-09-21';
const NOW = `${WEEK}T09:00:00.000Z`;
let gates = [];

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  const gate = { promise, resolve };
  gates.push(gate);
  return gate;
}

function Harness({ scope = 'guest', visible = true }) {
  const [refreshes, setRefreshes] = useState([]);
  return <MemoryRouter>
    <p>외부 갱신 기록: {refreshes.length ? refreshes.join(', ') : '없음'}</p>
    {visible ? <MealCookingPanel scope={scope} weekStart={WEEK} onClose={() => {}}
      onChanged={() => setRefreshes(previous => [...previous, scope])} /> : <p>조리 화면을 닫았어요.</p>}
  </MemoryRouter>;
}

async function seed(scope, cooked) {
  const plan = generateMealPlan({ scope, weekStart: WEEK, now: NOW,
    preferences: { servings: 1, dinnerDays: [0], excludedIngredients: [] } });
  plan.slots[0].title = scope === 'guest' ? '게스트의 개인 저녁' : '계정의 개인 저녁';
  await saveMealPlan(plan, scope, 0);
  await confirmMealPlan(WEEK, scope, 1);
  if (cooked) await cooking.recordMealCooking({ scope, weekStart: WEEK, slotId: `${WEEK}:dinner`,
    operationId: 'unknown-fixture', expectedPlanRevision: 2, usageMode: 'unknown', usages: [], completeUsageConfirmed: false });
}

async function beginCancel() {
  fireEvent.click(await screen.findByRole('button', { name: '조리 기록 취소', exact: true }));
  fireEvent.click(screen.getByRole('button', { name: '조리 기록 취소 확인' }));
}

describe('cooking panel account and asynchronous snapshot boundaries', () => {
  beforeEach(async () => {
    gates = [];
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(NOW));
    await Promise.all(['guest', 'user:alice'].map(scope => clearAccountLocalData(scope)));
    await seed('guest', true);
    await seed('user:alice', false);
  });

  afterEach(async () => {
    cleanup();
    gates.forEach(gate => gate.resolve());
    await Promise.all(gates.map(gate => gate.promise));
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('never displays a delayed guest snapshot after switching to an account', async () => {
    const gate = deferred();
    const captured = deferred();
    const original = cooking.getMealCookingWorkspace;
    vi.spyOn(cooking, 'getMealCookingWorkspace').mockImplementation(async scope => {
      const snapshot = await original(scope);
      if (scope === 'guest') { captured.resolve(); await gate.promise; }
      return snapshot;
    });
    const view = render(<Harness />);
    await act(async () => { await captured.promise; });
    view.rerender(<Harness scope="user:alice" />);
    await screen.findByText('아직 조리 기록이 없어요.');
    await act(async () => { gate.resolve(); await gate.promise; });

    expect(screen.queryByRole('article', { name: `${WEEK} 조리 이력` })).not.toBeInTheDocument();
    expect(screen.queryByText('게스트의 개인 저녁')).not.toBeInTheDocument();
    expect(screen.getByText('아직 조리 기록이 없어요.')).toBeInTheDocument();
    expect(screen.getByText('외부 갱신 기록: 없음')).toBeInTheDocument();
    expect((await original('guest')).history).toHaveLength(1);
    expect((await original('user:alice')).history).toEqual([]);
  });

  it.each(['account switch', 'unmount'])('does not publish an old write acknowledgement after %s', async boundary => {
    const gate = deferred();
    const committed = deferred();
    const original = cooking.cancelMealCooking;
    vi.spyOn(cooking, 'cancelMealCooking').mockImplementation(async input => {
      const result = await original(input);
      committed.resolve();
      await gate.promise;
      return result;
    });
    const view = render(<Harness />);
    await beginCancel();
    await act(async () => { await committed.promise; });
    expect((await getMealPlan(WEEK, 'guest')).confirmed.slots[0].status).toBe('planned');
    if (boundary === 'account switch') {
      view.rerender(<Harness scope="user:alice" />);
      await screen.findByText('아직 조리 기록이 없어요.');
    } else {
      view.rerender(<Harness visible={false} />);
      expect(screen.getByText('조리 화면을 닫았어요.')).toBeInTheDocument();
    }
    await act(async () => { gate.resolve(); await gate.promise; });

    expect(screen.getByText('외부 갱신 기록: 없음')).toBeInTheDocument();
    expect(screen.queryByText('조리 기록을 취소했어요. 재고는 변경하지 않았어요.')).not.toBeInTheDocument();
    expect(screen.queryByText('게스트의 개인 저녁')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect((await cooking.getMealCookingWorkspace('guest')).history.map(event => event.kind).sort())
      .toEqual(['cooking', 'cooking-reversal']);
    expect((await cooking.getMealCookingWorkspace('user:alice')).history).toEqual([]);
  });

  it('keeps the refreshed committed history when an older read arrives after focus invalidation', async () => {
    const gate = deferred();
    const captured = deferred();
    const original = cooking.getMealCookingWorkspace;
    let delayFirst = true;
    vi.spyOn(cooking, 'getMealCookingWorkspace').mockImplementation(async scope => {
      const snapshot = await original(scope);
      if (delayFirst) { delayFirst = false; captured.resolve(); await gate.promise; }
      return snapshot;
    });
    render(<Harness />);
    await act(async () => { await captured.promise; });
    await cooking.cancelMealCooking({ scope: 'guest', weekStart: WEEK, slotId: `${WEEK}:dinner`,
      cookingId: 'cooking:unknown-fixture', operationId: 'other-tab-cancel', expectedPlanRevision: 3 });
    fireEvent.focus(window);
    fireEvent.click(screen.getByRole('button', { name: '조리 목록 새로고침' }));
    await waitFor(() => expect(screen.getByRole('article', { name: `${WEEK} 조리 이력` })).toHaveTextContent('조리 취소됨'));
    await act(async () => { gate.resolve(); await gate.promise; });

    expect(screen.getByRole('article', { name: `${WEEK} 조리 이력` })).toHaveTextContent('조리 취소됨');
    expect(screen.queryByRole('button', { name: '조리 기록 취소', exact: true })).not.toBeInTheDocument();
    expect(screen.queryByText('식단과 재고·조리 이력을 확인하고 있어요.')).not.toBeInTheDocument();
    expect((await getMealPlan(WEEK)).confirmed.slots[0].status).toBe('planned');
  });
});
