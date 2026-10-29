import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import FDBFactory from 'fake-indexeddb/lib/FDBFactory';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import MealPlanShoppingPreview from '../MealPlanShoppingPreview';
import * as repository from '../../features/mealPlans/mealPlanRepository';
import { generateMealPlan } from '../../features/mealPlans/mealPlanDomain';
import { clearAccountLocalData, getAllIngredients, saveIngredients } from '../../db/indexedDB';
import { getInventoryQuantitySnapshot, saveInventoryQuantity } from '../../features/mealPlans/inventoryQuantityRepository';

const pilot = vi.hoisted(() => ({ begin: vi.fn(), finish: vi.fn() }));
vi.mock('../../features/mealPlans/mealPlanPilotCollector', () => ({
  beginMealPlanPilotOperation: (...args) => pilot.begin(...args),
  finishMealPlanPilotOperation: (...args) => pilot.finish(...args),
}));

const TODAY = '2026-09-14';
const NOW = new Date(2026, 8, 14, 0, 30);

// Synthetic arithmetic fixtures, not a claim that any production recipe was reviewed.
function fixturePlan(weekStart = TODAY, scope = 'guest') {
  const plan = generateMealPlan({ weekStart, scope, now: NOW,
    preferences: { servings: 1, excludedIngredients: [], dinnerDays: [0] } });
  const component = plan.slots[0].components[0];
  plan.slots[0].title = '테스트 전용 닭고기 메뉴';
  plan.slots[0].components = [{ ...component,
    id: 'fixture:main', recipeKey: 'fixture:main', recipeVersion: 'fixture-v1',
    source: { kind: 'test-fixture', id: 'fixture:recipe', name: '테스트 전용' },
    servings: 1, servingsStatus: 'verified',
    ingredients: [{ ...component.ingredients[0], id: 'fixture:chicken', rawName: '닭고기',
      normalizedName: '닭고기', ingredientKey: 'food:닭고기', preparationState: 'raw',
      amount: 200, unit: 'g', quantityStatus: 'verified', quantityEvidence: 'fixture:200g',
      optional: false, selected: true }],
  }];
  return plan;
}

function fixtureStock(overrides = {}) {
  return { id: 'batch-1', name: '닭고기', expiryDate: '2026-10-01',
    quantity: '반 모', consumed: false, memo: '기존 수동 메모', ...overrides };
}

async function confirmStock(amount = 300) {
  const { inventory } = await getInventoryQuantitySnapshot('guest');
  const item = inventory.find((entry) => entry.id === 'batch-1');
  await saveInventoryQuantity({ scope: 'guest', ingredientId: item.id,
    expectedSourceToken: item.sourceToken, expectedRevision: item.quantityRevision,
    values: { name: '닭고기', amount, unit: 'g', preparationState: 'raw' } });
}

async function saveConfirmed(plan) {
  await repository.saveMealPlan(plan, plan.scope, 0);
  return repository.confirmMealPlan(plan.weekStart, plan.scope, 1);
}

function page(scope = 'guest', recordRevision = 0) {
  return <MemoryRouter><MealPlanShoppingPreview scope={scope} recordRevision={recordRevision} /></MemoryRouter>;
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function expand(title) {
  fireEvent.click(screen.getByRole('heading', { name: title }).closest('summary'));
  return screen.getByRole('list', { name: title });
}

beforeAll(() => {
  Object.defineProperty(window, 'indexedDB', { configurable: true, value: new FDBFactory() });
});
beforeEach(async () => {
  vi.clearAllMocks();
  vi.stubEnv('VITE_LOCAL_PILOT_ENABLED', 'false');
  pilot.begin.mockResolvedValue(Object.freeze({}));
  pilot.finish.mockResolvedValue({ status: 'recorded' });
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  for (const scope of ['guest', 'user:alice']) {
    await clearAccountLocalData(scope);
  }
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.useRealTimers(); });

describe('MealPlanShoppingPreview', () => {
  it('records only explicit completed calculations and preserves the displayed result when pilot storage fails', async () => {
    await saveConfirmed(fixturePlan());
    vi.stubEnv('VITE_LOCAL_PILOT_ENABLED', 'true');
    render(page());
    expect(pilot.begin).not.toHaveBeenCalled();
    pilot.finish.mockRejectedValue(new Error('optional pilot failure'));
    fireEvent.click(screen.getByRole('button', { name: '식단 장보기 확인' }));
    expect(await screen.findByRole('list', { name: '등록된 재고 기준 추가 필요량' })).toHaveTextContent('200g');
    expect(pilot.finish.mock.calls.flatMap(call => call[1])).toEqual([expect.objectContaining({ name: 'shopping_list_recalculated', status: 'success' })]);
    expect(await getAllIngredients()).toEqual([]);
  });

  it('does not turn a discarded read after focus into a failed calculation', async () => {
    vi.stubEnv('VITE_LOCAL_PILOT_ENABLED', 'true');
    const pending = deferred();
    vi.spyOn(repository, 'getMealPlanningSnapshot').mockReturnValueOnce(pending.promise);
    render(page());
    fireEvent.click(screen.getByRole('button', { name: '식단 장보기 확인' }));
    await act(async () => { await Promise.resolve(); });
    fireEvent.focus(window);
    await act(async () => { pending.reject(new Error('stale snapshot failure')); });
    expect(screen.getByText(/다른 화면의 변경을 반영하려면/)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(pilot.finish.mock.calls.flatMap(call => call[1])).toEqual([expect.objectContaining({ name: 'shopping_list_recalculated', status: 'cancelled' })]);
  });

  it('labels a registered-inventory calculation without declaring an unregistered ingredient physically absent', async () => {
    await saveConfirmed(fixturePlan());
    render(page());
    fireEvent.click(screen.getByRole('button', { name: '식단 장보기 확인' }));
    const list = await screen.findByRole('list', { name: '등록된 재고 기준 추가 필요량' });
    expect(list).toHaveTextContent('닭고기');
    expect(list).toHaveTextContent('200g');
    expect(screen.getByText(/미등록 재료는.*구매 또는 보유 확인 필요/)).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '확인된 부족분' })).not.toBeInTheDocument();
    expect(await getAllIngredients('guest')).toEqual([]);
  });

  it('keeps unknown package quantities separate from a verified zero stock balance', async () => {
    await saveConfirmed(fixturePlan());
    await saveIngredients([fixtureStock({ quantity: '2팩' })]);
    const before = await getAllIngredients('guest');
    render(page());
    fireEvent.click(screen.getByRole('button', { name: '식단 장보기 확인' }));
    await screen.findByRole('heading', { name: '확인이 필요한 재료' });
    expect(expand('확인이 필요한 재료')).toHaveTextContent('보유 재료의 수량 확인이 필요해요.');
    expect(screen.queryByRole('heading', { name: '등록된 재고 기준 추가 필요량' })).not.toBeInTheDocument();
    expect(screen.queryByText('0g')).not.toBeInTheDocument();
    expect(await getAllIngredients('guest')).toStrictEqual(before);

    await confirmStock(0);
    fireEvent.click(screen.getByRole('button', { name: '다시 계산' }));
    const list = await screen.findByRole('list', { name: '등록된 재고 기준 추가 필요량' });
    expect(list).toHaveTextContent('200g');
    expect(screen.queryByRole('heading', { name: '확인이 필요한 재료' })).not.toBeInTheDocument();
    expect(await getAllIngredients('guest')).toStrictEqual(before);
  });

  it('offers an explicit read-only check before presenting any shopping result', () => {
    const read = vi.spyOn(repository, 'getMealPlanningSnapshot');
    render(page());
    expect(screen.queryByRole('button', { name: '식단 장보기 확인' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '등록된 재고 기준 추가 필요량' })).not.toBeInTheDocument();
    expect(read).not.toHaveBeenCalled();
  });

  it('allocates stock across all confirmed weeks without writing manual or repurchase records', async () => {
    await saveConfirmed(fixturePlan());
    await saveConfirmed(fixturePlan('2026-09-21'));
    await repository.saveMealPlan(fixturePlan('2026-09-28'), 'guest', 0);
    const inventory = [fixtureStock(), fixtureStock({ id: 'repurchase',
      consumed: true, memo: '할인하면 재구매', purchaseDate: '2026-09-01' })];
    await saveIngredients(inventory, 'guest');
    await confirmStock();
    const before = await getAllIngredients('guest');
    render(page());
    fireEvent.click(screen.getByRole('button', { name: '식단 장보기 확인' }));
    const list = await screen.findByRole('list', { name: '등록된 재고 기준 추가 필요량' });
    expect(within(list).getByText('닭고기')).toBeInTheDocument();
    expect(within(list).getByText('100g')).toBeInTheDocument();
    expect(within(list).getByText(/2026-09-21/)).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '확인이 필요한 재료' })).not.toBeInTheDocument();
    expect(screen.getByText(/2026-09-14부터.*모든 확정 식단/)).toBeInTheDocument();
    expect(screen.getByText(/출처: 식단/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '냉장고 목록' })).toHaveAttribute('href', '/ingredients');
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(await getAllIngredients('guest')).toEqual(before);
    fireEvent.click(screen.getByRole('button', { name: '다시 계산' }));
    expect(await screen.findByText('100g')).toBeInTheDocument();
    expect(await getAllIngredients('guest')).toEqual(before);
  });

  it('does not treat an unconfirmed draft as shopping demand', async () => {
    await repository.saveMealPlan(fixturePlan(), 'guest', 0);
    render(page());
    fireEvent.click(screen.getByRole('button', { name: '식단 장보기 확인' }));
    expect(await screen.findByText('오늘 이후 확정된 식단이 없어요.')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '등록된 재고 기준 추가 필요량' })).not.toBeInTheDocument();
  });

  it('shows current unreviewed recipe rows as checks, never a zero or complete purchase total', async () => {
    const plan = generateMealPlan({ weekStart: TODAY, now: NOW,
      preferences: { servings: 1, excludedIngredients: [], dinnerDays: [0] } });
    await saveConfirmed(plan);
    render(page());
    fireEvent.click(screen.getByRole('button', { name: '식단 장보기 확인' }));
    await screen.findByRole('heading', { name: '확인이 필요한 재료' });
    const list = expand('확인이 필요한 재료');
    expect(within(list).getAllByRole('listitem').length).toBeGreaterThan(0);
    expect(list).toHaveTextContent(plan.slots[0].components[0].ingredients.find((line) => line.selected).rawName);
    expect(screen.getByText(/전체 구매량은 계산되지 않았어요/)).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '등록된 재고 기준 추가 필요량' })).not.toBeInTheDocument();
    expect(screen.queryByText(/조리 가능|부족분은 없어요|0g/)).not.toBeInTheDocument();
  });

  it('keeps an original quantity label unverified without a saved user confirmation', async () => {
    await saveConfirmed(fixturePlan());
    await saveIngredients([fixtureStock({ quantity: '300g' })]);
    render(page());
    fireEvent.click(screen.getByRole('button', { name: '식단 장보기 확인' }));
    await screen.findByRole('heading', { name: '확인이 필요한 재료' });
    expect(expand('확인이 필요한 재료')).toHaveTextContent('닭고기');
    expect(screen.queryByRole('heading', { name: '등록된 재고 기준 추가 필요량' })).not.toBeInTheDocument();
    expect(screen.queryByText(/부족분은 없어요/)).not.toBeInTheDocument();
  });

  it('keeps unselected optional ingredients separate from confirmed shortage quantities', async () => {
    const plan = fixturePlan();
    plan.slots[0].components[0].ingredients.push({ ...plan.slots[0].components[0].ingredients[0],
      id: 'parsley', rawName: '파슬리', normalizedName: '파슬리', ingredientKey: 'fixture:parsley',
      amount: 2, optional: true, selected: false });
    await saveConfirmed(plan);
    render(page());
    fireEvent.click(screen.getByRole('button', { name: '식단 장보기 확인' }));
    const shortages = await screen.findByRole('list', { name: '등록된 재고 기준 추가 필요량' });
    expect(shortages).toHaveTextContent('닭고기');
    expect(shortages).not.toHaveTextContent('파슬리');
    expect(expand('선택 재료')).toHaveTextContent('파슬리');
  });

  it('clears a previously successful calculation when reading fails and offers retry', async () => {
    await saveConfirmed(fixturePlan());
    render(page());
    fireEvent.click(screen.getByRole('button', { name: '식단 장보기 확인' }));
    await screen.findByText('200g');
    vi.spyOn(repository, 'getMealPlanningSnapshot').mockRejectedValueOnce(new Error('저장소 읽기 실패'));
    fireEvent.click(screen.getByRole('button', { name: '다시 계산' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('다시 계산');
    expect(screen.queryByText('200g')).not.toBeInTheDocument();
    expect(screen.queryByText(/부족분은 없어요|전체 구매량/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '다시 계산' }));
    expect(await screen.findByText('200g')).toBeInTheDocument();
  });

  it('discards an earlier account response and only shows the newly requested account', async () => {
    await saveConfirmed(fixturePlan(TODAY, 'user:alice'));
    const pending = deferred();
    vi.spyOn(repository, 'getMealPlanningSnapshot').mockReturnValueOnce(pending.promise);
    const view = render(page());
    fireEvent.click(screen.getByRole('button', { name: '식단 장보기 확인' }));
    await waitFor(() => expect(repository.getMealPlanningSnapshot).toHaveBeenCalledTimes(1));
    view.rerender(page('user:alice'));
    await act(async () => { pending.resolve({ scope: 'guest', ingredients: [], inventory: [], confirmedPlans: [], quantityReviews: [] }); });
    expect(screen.queryByText('오늘 이후 확정된 식단이 없어요.')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '식단 장보기 확인' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: '식단 장보기 확인' }));
    expect(await screen.findByText('200g')).toBeInTheDocument();
  });

  it('ignores a failed request from an unmounted preview', async () => {
    const pending = deferred();
    vi.spyOn(repository, 'getMealPlanningSnapshot').mockReturnValueOnce(pending.promise);
    const view = render(page());
    fireEvent.click(screen.getByRole('button', { name: '식단 장보기 확인' }));
    await waitFor(() => expect(repository.getMealPlanningSnapshot).toHaveBeenCalledTimes(1));
    view.unmount();
    render(page('user:alice'));
    await act(async () => { pending.reject(new Error('이전 계정 오류')); });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '식단 장보기 확인' })).toBeEnabled();
  });

  it('invalidates a result when the saved meal plan revision changes', async () => {
    await saveConfirmed(fixturePlan());
    const view = render(page('guest', 2));
    fireEvent.click(screen.getByRole('button', { name: '식단 장보기 확인' }));
    await screen.findByText('200g');
    view.rerender(page('guest', 3));
    expect(screen.queryByText('200g')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '식단 장보기 확인' })).toBeEnabled();
  });

  it('requires a fresh read after returning from another window without automatically recalculating', async () => {
    await saveConfirmed(fixturePlan());
    const read = vi.spyOn(repository, 'getMealPlanningSnapshot');
    render(page());
    fireEvent.click(screen.getByRole('button', { name: '식단 장보기 확인' }));
    await screen.findByText('200g');
    await saveIngredients([fixtureStock()]);
    await confirmStock();
    fireEvent.focus(window);
    expect(screen.queryByText('200g')).not.toBeInTheDocument();
    expect(screen.getByText(/다른 화면의 변경을 반영하려면 다시 계산/)).toBeInTheDocument();
    expect(read).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: '다시 계산' }));
    expect(await screen.findByText(/확인된 수량에서 부족분은 없어요/)).toBeInTheDocument();
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('rejects a wrong-scope snapshot instead of rendering another account’s quantities', async () => {
    vi.spyOn(repository, 'getMealPlanningSnapshot').mockResolvedValueOnce({
      scope: 'user:alice', ingredients: [], inventory: [], quantityReviews: [], confirmedPlans: [fixturePlan(TODAY, 'user:alice')],
    });
    render(page());
    fireEvent.click(screen.getByRole('button', { name: '식단 장보기 확인' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.queryByText('200g')).not.toBeInTheDocument();
  });
});
