import { useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import MealCookingPanel from '../MealCookingPanel';
import { clearAccountLocalData, getAllIngredients, saveIngredient } from '../../db/indexedDB';
import { generateMealPlan } from '../../features/mealPlans/mealPlanDomain';
import { confirmMealPlan, getMealPlan, saveMealPlan } from '../../features/mealPlans/mealPlanRepository';
import { getInventoryQuantitySnapshot, saveInventoryQuantity } from '../../features/mealPlans/inventoryQuantityRepository';
import * as cooking from '../../features/mealPlans/mealCookingRepository';

const WEEK = '2026-09-21';
const NOW = `${WEEK}T09:00:00.000Z`;
let gates = [];
function deferred() {
  let resolve; const promise = new Promise(done => { resolve = done; });
  const gate = { promise, resolve }; gates.push(gate); return gate;
}
function Harness({ scope = 'guest', visible = true }) {
  const [refreshes, setRefreshes] = useState([]);
  return <MemoryRouter><p>외부 갱신 기록: {refreshes.length ? refreshes.join(', ') : '없음'}</p>
    {visible ? <MealCookingPanel scope={scope} weekStart={WEEK} onClose={() => {}}
      onChanged={() => setRefreshes(previous => [...previous, scope])} /> : <p>조리 창 닫힘</p>}
  </MemoryRouter>;
}
async function open(amount = '100') {
  fireEvent.click(await screen.findByRole('button', { name: '실제 사용량 정정', exact: true }));
  fireEvent.change(screen.getByRole('spinbutton'), { target: { value: amount } });
  fireEvent.click(screen.getByLabelText('정정할 실제 사용량을 모두 확인했어요'));
}
const submit = () => fireEvent.click(screen.getByRole('button', { name: '정정한 사용량으로 재고 반영' }));
const done = () => screen.findByText('실제 사용량을 정정했어요. 조리 기록은 유지돼요.');

describe('actual correction acknowledgement, retry and account boundaries', () => {
  beforeEach(async () => {
    gates = []; vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(NOW));
    await Promise.all(['guest', 'user:alice'].map(scope => clearAccountLocalData(scope)));
    await saveIngredient({ id: 'chicken', name: '닭고기', quantity: '300g', consumed: false, updatedAt: NOW });
    const row = (await getInventoryQuantitySnapshot()).inventory[0];
    await saveInventoryQuantity({ scope: 'guest', ingredientId: row.id, expectedRevision: row.quantityRevision,
      expectedSourceToken: row.sourceToken, values: { name: '닭고기', amount: 300, unit: 'g', preparationState: 'raw' } });
    const plan = generateMealPlan({ scope: 'guest', weekStart: WEEK, now: NOW,
      preferences: { servings: 1, dinnerDays: [0], excludedIngredients: [] } });
    await saveMealPlan(plan, 'guest', 0); await confirmMealPlan(WEEK, 'guest', 1);
    const verified = (await getInventoryQuantitySnapshot()).inventory[0];
    await cooking.recordMealCooking({ scope: 'guest', weekStart: WEEK, slotId: `${WEEK}:dinner`, expectedPlanRevision: 2,
      operationId: 'original-cook', usageMode: 'measured', completeUsageConfirmed: true,
      usages: [{ ingredientId: verified.id, amount: 150, unit: 'g', expectedRevision: verified.quantityRevision, expectedSourceToken: verified.sourceToken }] });
  });
  afterEach(async () => {
    cleanup(); gates.forEach(gate => gate.resolve()); await Promise.all(gates.map(gate => gate.promise));
    vi.restoreAllMocks(); vi.useRealTimers();
  });

  it('reviews and closes without writing and restores keyboard focus', async () => {
    render(<Harness />);
    const trigger = await screen.findByRole('button', { name: '실제 사용량 정정', exact: true });
    trigger.focus(); fireEvent.click(trigger);
    expect(screen.getByRole('heading', { name: '실제 사용량 정정', exact: true })).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: '정정하지 않고 돌아가기' }));
    expect(trigger).toHaveFocus(); expect((await getAllIngredients())[0].quantity).toBe('150g');
    expect((await cooking.getMealCookingWorkspace()).history).toHaveLength(2);
  });

  it('reverses only the latest corrected usage, not the original or intermediate consumption', async () => {
    const originalEvent = (await cooking.getMealCookingWorkspace()).history.find(event => event.kind === 'cooking');
    render(<Harness />); await open('100'); submit(); await done();
    await open('50'); submit(); await done();
    expect((await getAllIngredients())[0].quantity).toBe('250g');
    expect(screen.getByRole('list', { name: '기록한 실제 사용량' })).toHaveTextContent('닭고기 50g');
    expect(screen.queryByText('재고 반영 취소됨 · 남은 양 확인 필요')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '재고 반영 취소', exact: true }));
    fireEvent.click(screen.getByRole('button', { name: '재고 반영 취소 확인' }));
    await screen.findByText('재고 반영만 취소했어요. 조리 기록은 유지돼요.');
    const history = (await cooking.getMealCookingWorkspace()).history;
    expect(history.filter(event => event.kind === 'cooking')).toEqual([originalEvent]);
    expect(history.find(event => event.kind === 'consumption-reversal' && !event.replacementConsumptionId).lines[0].amount).toBe(50);
    expect((await getAllIngredients())[0].quantity).toBe('300g');
    expect(screen.queryByRole('button', { name: '실제 사용량 정정', exact: true })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '조리 기록 취소', exact: true })).toBeEnabled();
  });

  it('keeps failed inputs and reuses the operation id for one successful retry', async () => {
    const original = cooking.correctMealConsumption;
    const spy = vi.spyOn(cooking, 'correctMealConsumption').mockRejectedValueOnce(new Error('저장에 실패했어요. 다시 시도해 주세요.')).mockImplementation(original);
    render(<Harness />); await open(); submit();
    await screen.findByRole('alert');
    await waitFor(() => expect(screen.getByRole('button', { name: '정정한 사용량으로 재고 반영' })).toBeEnabled());
    expect(screen.getByRole('spinbutton')).toHaveValue(100);
    expect((await getAllIngredients())[0].quantity).toBe('150g');
    submit(); await done();
    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy.mock.calls[0][0].operationId).toBe(spy.mock.calls[1][0].operationId);
    expect((await cooking.getMealCookingWorkspace()).history.filter(event => event.kind === 'consumption')).toHaveLength(2);
    expect((await getAllIngredients())[0].quantity).toBe('200g');
  });

  it('describes an empty-usage reversal without falsely marking unchanged stock as needing review', async () => {
    render(<Harness />); await open('0'); submit(); await done();
    const before = await getInventoryQuantitySnapshot();
    fireEvent.click(screen.getByRole('button', { name: '재고 반영 취소', exact: true }));
    expect(screen.getByText('기록한 사용량이 0이라 재고량과 수량 확인 상태는 바꾸지 않아요. 조리 기록은 남아요.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '재고 반영 취소 확인' }));
    await screen.findByText('재고 반영만 취소했어요. 조리 기록은 유지돼요.');
    expect(screen.getByText('재고 반영 취소됨 · 재고 변경 없음')).toBeInTheDocument();
    expect(screen.queryByText('재고 반영 취소됨 · 남은 양 확인 필요')).not.toBeInTheDocument();
    expect(await getInventoryQuantitySnapshot()).toEqual(before);
  });

  it('acknowledges a committed correction once after focus discards its old form', async () => {
    const gate = deferred(); const committed = deferred(); const original = cooking.correctMealConsumption;
    const spy = vi.spyOn(cooking, 'correctMealConsumption').mockImplementation(async input => {
      const result = await original(input); committed.resolve(); await gate.promise; return result;
    });
    render(<Harness />); await open(); submit(); submit();
    await act(async () => { await committed.promise; });
    expect((await getAllIngredients())[0].quantity).toBe('200g');
    fireEvent.focus(window);
    expect(screen.queryByRole('form', { name: /실제 사용량 정정/ })).not.toBeInTheDocument();
    await act(async () => { gate.resolve(); await gate.promise; });
    await screen.findByText('외부 갱신 기록: guest');
    expect(spy).toHaveBeenCalledOnce();
    expect(screen.queryByText('실제 사용량을 정정했어요. 조리 기록은 유지돼요.')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '조리 목록 새로고침' }));
    fireEvent.click(await screen.findByRole('button', { name: '실제 사용량 정정', exact: true }));
    expect(screen.getByRole('spinbutton')).toHaveValue(100);
  });

  it.each(['account switch', 'unmount'])('does not leak a delayed correction acknowledgement after %s', async boundary => {
    const gate = deferred(); const committed = deferred(); const original = cooking.correctMealConsumption;
    vi.spyOn(cooking, 'correctMealConsumption').mockImplementation(async input => {
      const result = await original(input); committed.resolve(); await gate.promise; return result;
    });
    const view = render(<Harness />); await open(); submit();
    await act(async () => { await committed.promise; });
    if (boundary === 'account switch') { view.rerender(<Harness scope="user:alice" />); await screen.findByText('아직 조리 기록이 없어요.'); }
    else view.rerender(<Harness visible={false} />);
    await act(async () => { gate.resolve(); await gate.promise; });
    expect(screen.getByText('외부 갱신 기록: 없음')).toBeInTheDocument();
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();
    expect(screen.queryByText('실제 사용량을 정정했어요. 조리 기록은 유지돼요.')).not.toBeInTheDocument();
    expect((await getAllIngredients('guest'))[0].quantity).toBe('200g');
    expect(await getAllIngredients('user:alice')).toEqual([]);
    expect(await getMealPlan(WEEK, 'user:alice')).toBeNull();
  });

  it('does not offer another correction submission after the commit succeeds but the result read fails', async () => {
    const read = cooking.getMealCookingWorkspace; let fail = false;
    vi.spyOn(cooking, 'getMealCookingWorkspace').mockImplementation((...args) => fail ? Promise.reject(new Error('read unavailable')) : read(...args));
    const write = vi.spyOn(cooking, 'correctMealConsumption');
    render(<Harness />); await open(); fail = true; submit();
    await screen.findByText('외부 갱신 기록: guest');
    expect(await screen.findByRole('alert')).toHaveTextContent('저장은 완료됐지만');
    expect(screen.queryByRole('button', { name: '정정한 사용량으로 재고 반영' })).not.toBeInTheDocument();
    expect(write).toHaveBeenCalledOnce(); expect((await getAllIngredients())[0].quantity).toBe('200g');
    fail = false; fireEvent.click(screen.getByRole('button', { name: '조리 목록 새로고침' }));
    await screen.findByRole('article', { name: `${WEEK} 조리 이력` });
    expect(screen.getByRole('list', { name: '기록한 실제 사용량' })).toHaveTextContent('닭고기 100g');
  });
});
