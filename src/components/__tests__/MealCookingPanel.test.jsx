import { StrictMode, useState } from 'react';
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
function Harness({ strict = false }) {
  const [status, setStatus] = useState('cooked');
  const panel = <MemoryRouter><p>외부 식단 상태: {status}</p><MealCookingPanel scope="guest" weekStart={WEEK}
    onClose={() => {}} onChanged={async () => setStatus((await getMealPlan(WEEK)).confirmed.slots[0].status)} /></MemoryRouter>;
  return strict ? <StrictMode>{panel}</StrictMode> : panel;
}
async function beginCancel() {
  fireEvent.click(await screen.findByRole('button', { name: '조리 기록 취소', exact: true }));
  fireEvent.click(screen.getByRole('button', { name: '조리 기록 취소 확인' }));
}

describe('cooking panel load and acknowledged-write lifecycle', () => {
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(NOW));
    await clearAccountLocalData('guest');
    const plan = generateMealPlan({ scope: 'guest', weekStart: WEEK, now: NOW,
      preferences: { servings: 1, dinnerDays: [0], excludedIngredients: [] } });
    await saveMealPlan(plan, 'guest', 0); await confirmMealPlan(WEEK, 'guest', 1);
    await cooking.recordMealCooking({ scope: 'guest', weekStart: WEEK, slotId: `${WEEK}:dinner`, operationId: 'unknown-fixture',
      expectedPlanRevision: 2, usageMode: 'unknown', usages: [], completeUsageConfirmed: false });
  });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); });

  it('loads the actual saved history through StrictMode effect replay', async () => {
    render(<Harness strict />);
    expect(await screen.findByRole('article', { name: `${WEEK} 조리 이력` })).toHaveTextContent('조리 기록됨');
    expect(screen.queryByText('식단과 재고·조리 이력을 확인하고 있어요.')).not.toBeInTheDocument();
  });

  it('moves keyboard focus into cancellation review and back without changing saved data', async () => {
    render(<Harness />);
    const trigger = await screen.findByRole('button', { name: '조리 기록 취소', exact: true });
    trigger.focus(); fireEvent.click(trigger);
    expect(screen.getByRole('heading', { name: '조리 기록을 취소할까요?' })).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: '취소하지 않고 돌아가기' }));
    expect(trigger).toHaveFocus();
    expect((await getMealPlan(WEEK)).confirmed.slots[0].status).toBe('cooked');
  });

  it('returns keyboard focus to the panel after the confirmed cancellation removes its button', async () => {
    render(<Harness />);
    fireEvent.click(await screen.findByRole('button', { name: '조리 기록 취소', exact: true }));
    const confirm = screen.getByRole('button', { name: '조리 기록 취소 확인' });
    confirm.focus(); fireEvent.click(confirm);
    await screen.findByText('조리 기록을 취소했어요. 재고는 변경하지 않았어요.');
    expect(screen.getByRole('heading', { name: '조리와 재고 기록' })).toHaveFocus();
  });

  it('refreshes dependent plan state after a committed write even when focus invalidates its old form', async () => {
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const original = cooking.cancelMealCooking;
    vi.spyOn(cooking, 'cancelMealCooking').mockImplementation(async input => {
      const result = await original(input); await gate; return result;
    });
    render(<Harness />); await beginCancel();
    await waitFor(async () => expect((await getMealPlan(WEEK)).confirmed.slots[0].status).toBe('planned'));
    fireEvent.focus(window);
    await act(async () => { release(); await gate; });
    await screen.findByText('외부 식단 상태: planned');
    expect(screen.getByText(/작성 중인 입력은 닫았어요/)).toBeInTheDocument();
    expect(screen.queryByRole('article', { name: `${WEEK} 조리 이력` })).not.toBeInTheDocument();
  });

  it('refreshes dependent plan state when the post-commit panel read fails without inviting a second write', async () => {
    const original = cooking.getMealCookingWorkspace;
    let failRead = false;
    vi.spyOn(cooking, 'getMealCookingWorkspace').mockImplementation((...args) => failRead ? Promise.reject(new Error('read unavailable')) : original(...args));
    render(<Harness />);
    await screen.findByRole('article', { name: `${WEEK} 조리 이력` });
    failRead = true;
    await beginCancel();
    await screen.findByText('외부 식단 상태: planned');
    expect(await screen.findByRole('alert')).toHaveTextContent('저장은 완료됐지만');
    expect(screen.queryByRole('button', { name: '조리 기록 취소 확인' })).not.toBeInTheDocument();
    failRead = false;
    fireEvent.click(screen.getByRole('button', { name: '조리 목록 새로고침' }));
    expect(await screen.findByRole('article', { name: `${WEEK} 조리 이력` })).toHaveTextContent('조리 취소됨');
  });
});
