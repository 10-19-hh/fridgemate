import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import MealPlanPage from '../MealPlanPage';
import { IngredientsProvider } from '../../hooks/useIngredients';
import { PantryStaplesProvider } from '../../hooks/usePantryStaples';
import { clearScopeState } from '../../features/ingredients/ingredientsScopeState';
import { clearAccountLocalData, getAllIngredients, saveIngredient } from '../../db/indexedDB';
import { generateMealPlan } from '../../features/mealPlans/mealPlanDomain';
import { clearMealPlans, confirmMealPlan, getMealPlan, saveMealPlan } from '../../features/mealPlans/mealPlanRepository';
import { getInventoryQuantitySnapshot, saveInventoryQuantity } from '../../features/mealPlans/inventoryQuantityRepository';
import { recordMealCooking } from '../../features/mealPlans/mealCookingRepository';

const WEEK = '2026-09-21';
const NOW = `${WEEK}T09:00:00.000Z`;
const auth = { storageScope: 'guest', loading: false, isAuthenticated: false };
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => auth }));

async function seed() {
  await saveIngredient({ id: 'chicken', name: '닭고기', quantity: '300g', consumed: false,
    memo: '보존 메모', expiryDate: '2026-09-30', category: '육류', storageType: '냉장', createdAt: NOW, updatedAt: NOW });
  const row = (await getInventoryQuantitySnapshot()).inventory[0];
  await saveInventoryQuantity({ scope: 'guest', ingredientId: row.id, expectedRevision: row.quantityRevision,
    expectedSourceToken: row.sourceToken, values: { name: '닭고기', amount: 300, unit: 'g', preparationState: 'raw' } });
  const plan = generateMealPlan({ scope: 'guest', weekStart: WEEK, now: NOW,
    preferences: { servings: 1, dinnerDays: [0, 1], excludedIngredients: [] } });
  for (const slot of plan.slots.filter(slot => slot.status === 'planned')) {
    slot.title = '사용량 확인용 닭고기 한 끼';
    slot.components = [{ ...slot.components[0], title: '닭고기', servings: 1, servingsStatus: 'verified', processInputs: [],
      ingredients: [{ ...slot.components[0].ingredients[0], id: 'chicken-line', rawName: '닭고기', normalizedName: '닭고기',
        ingredientKey: 'food:닭고기', amount: 200, unit: 'g', preparationState: 'raw', quantityStatus: 'verified',
        quantityEvidence: 'test:arithmetic-fixture', selected: true, optional: false }] }];
  }
  await saveMealPlan(plan, 'guest', 0);
  await confirmMealPlan(WEEK, 'guest', 1);
}

function page() {
  return <StrictMode><MemoryRouter><IngredientsProvider><PantryStaplesProvider><MealPlanPage /></PantryStaplesProvider></IngredientsProvider></MemoryRouter></StrictMode>;
}
async function noticeReady() {
  await waitFor(() => {
    expect(screen.queryByText('식단을 불러오는 중이에요.')).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: '지난 끼니 확인' })).toHaveAttribute('aria-busy', 'false');
  });
}
async function openMonday() {
  const article = within(await screen.findByRole('article', { name: `${WEEK} 저녁 식단` }));
  await noticeReady();
  fireEvent.click(article.getByRole('button', { name: '만들어 먹었어요', exact: true }));
  return within(await screen.findByRole('form', { name: '조리 사용량 · 사용량 확인용 닭고기 한 끼' }));
}

describe('weekly cooking through actual local storage', () => {
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(NOW));
    auth.storageScope = 'guest'; auth.loading = false;
    localStorage.clear();
    for (const scope of ['guest', 'user:alice']) { clearScopeState(scope); await clearAccountLocalData(scope); }
    await seed();
  });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); });

  it('suggests planned 200g but stores actual 150g once and refreshes the completed meal and shopping', async () => {
    const view = render(page());
    const form = await openMonday();
    const cooking = within(screen.getByRole('region', { name: '조리와 재고 기록' }));
    const amount = form.getByRole('spinbutton', { name: /실제 사용량/ });
    expect(amount).toHaveValue(200);
    fireEvent.change(amount, { target: { value: '150' } });
    fireEvent.click(form.getByLabelText('실제로 쓴 재고를 모두 확인했어요'));
    const save = form.getByRole('button', { name: '실제 사용량으로 조리 기록' });
    save.focus();
    fireEvent.click(save); fireEvent.click(save);
    const saved = await cooking.findByText('조리와 실제 사용량을 저장했어요.');
    expect(screen.getByText('조리와 실제 사용량을 저장했어요.')).toBe(saved);
    await noticeReady();
    expect(screen.getByRole('heading', { name: '조리와 재고 기록' })).toHaveFocus();
    expect((await getAllIngredients())[0]).toMatchObject({ quantity: '150g', memo: '보존 메모' });
    fireEvent.click(screen.getByRole('button', { name: '조리 창 닫기' }));
    const monday = within(await screen.findByRole('article', { name: `${WEEK} 저녁 식단` }));
    expect(monday.getByText('조리 기록됨')).toBeInTheDocument();
    expect(monday.queryByRole('button', { name: '외식·건너뛰기' })).not.toBeInTheDocument();
    const preview = within(screen.getByRole('region', { name: '식단 장보기 미리보기' }));
    fireEvent.click(preview.getByRole('button', { name: '식단 장보기 확인' }));
    await waitFor(() => expect(preview.getByText('50g', { exact: true })).toBeInTheDocument());
    view.unmount(); render(page());
    expect(within(await screen.findByRole('article', { name: `${WEEK} 저녁 식단` })).getByText('조리 기록됨')).toBeInTheDocument();
    await noticeReady();
    expect((await getAllIngredients())[0].quantity).toBe('150g');
  });

  it('records unknown usage without treating the former quantity as available', async () => {
    render(page()); const form = await openMonday();
    fireEvent.click(form.getByRole('button', { name: '사용량 없이 조리만 기록' }));
    await screen.findByText('조리만 기록했어요. 남은 재고량을 다시 확인해 주세요.');
    await noticeReady();
    expect((await getInventoryQuantitySnapshot()).inventory[0]).toMatchObject({ quantity: '300g', amount: null, quantityStatus: 'unverified' });
    expect((await getMealPlan(WEEK)).confirmed.slots[0]).toMatchObject({ status: 'cooked', cooking: { inventoryStatus: 'needs-review' } });
    fireEvent.click(screen.getByRole('button', { name: '조리 창 닫기' }));
    const preview = within(screen.getByRole('region', { name: '식단 장보기 미리보기' }));
    fireEvent.click(preview.getByRole('button', { name: '식단 장보기 확인' }));
    fireEvent.click(await preview.findByText('확인이 필요한 재료', { exact: true }));
    expect(preview.getByRole('list', { name: '확인이 필요한 재료' })).toHaveTextContent('닭고기');
  });

  it('shows remaining history after a plan is deleted and makes the two reversals explicit', async () => {
    const row = (await getInventoryQuantitySnapshot()).inventory[0];
    await recordMealCooking({ scope: 'guest', weekStart: WEEK, slotId: `${WEEK}:dinner`, expectedPlanRevision: 2,
      operationId: 'fixture-cook', usageMode: 'measured', completeUsageConfirmed: true,
      usages: [{ ingredientId: row.id, amount: 150, unit: 'g', expectedRevision: row.quantityRevision, expectedSourceToken: row.sourceToken }] });
    await clearMealPlans(); render(page());
    fireEvent.click(await screen.findByRole('button', { name: '조리 이력 열기' }));
    const history = within(await screen.findByRole('article', { name: `${WEEK} 조리 이력` }));
    expect(history.getByText(/식단이 삭제되어도/)).toBeInTheDocument();
    expect(history.getByRole('button', { name: '조리 기록 취소', exact: true })).toBeDisabled();
    fireEvent.click(history.getByRole('button', { name: '재고 반영 취소', exact: true }));
    expect((await getAllIngredients())[0].quantity).toBe('150g');
    fireEvent.click(screen.getByRole('button', { name: '재고 반영 취소 확인' }));
    await screen.findByText('재고 반영만 취소했어요. 조리 기록은 유지돼요.');
    await noticeReady();
    expect((await getAllIngredients())[0].quantity).toBe('300g');
    expect(await getMealPlan(WEEK)).toBeNull();
    fireEvent.click(history.getByRole('button', { name: '조리 기록 취소', exact: true }));
    fireEvent.click(screen.getByRole('button', { name: '조리 기록 취소 확인' }));
    await screen.findByText('조리 기록을 취소했어요. 재고는 변경하지 않았어요.');
    await noticeReady();
    expect(await getMealPlan(WEEK)).toBeNull();
    expect((await getInventoryQuantitySnapshot()).inventory[0].amount).toBeNull();
  });

  it('clears the open form immediately across a changed account scope', async () => {
    const view = render(page()); await openMonday();
    auth.storageScope = 'user:alice'; view.rerender(page());
    expect(screen.queryByRole('form', { name: /조리 사용량/ })).not.toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: '조리 이력 열기' }));
    await screen.findByText('아직 조리 기록이 없어요.');
    expect(await getAllIngredients('user:alice')).toEqual([]);
    expect((await getAllIngredients('guest'))[0].quantity).toBe('300g');
  });

  it('rejects a changed stock review even without a browser focus notification', async () => {
    render(page()); const form = await openMonday();
    fireEvent.change(form.getByRole('spinbutton', { name: /실제 사용량/ }), { target: { value: '150' } });
    fireEvent.click(form.getByLabelText('실제로 쓴 재고를 모두 확인했어요'));
    const row = (await getInventoryQuantitySnapshot()).inventory[0];
    await saveInventoryQuantity({ scope: 'guest', ingredientId: row.id, expectedRevision: row.quantityRevision,
      expectedSourceToken: row.sourceToken, values: { name: '닭고기', amount: 250, unit: 'g', preparationState: 'raw' } });
    const save = form.getByRole('button', { name: '실제 사용량으로 조리 기록' });
    fireEvent.click(save);
    await screen.findByRole('alert');
    await waitFor(() => expect(save).toBeEnabled());
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(screen.getByRole('alert')).toHaveTextContent(/바뀌|다시|새로/);
    expect(screen.queryByText('조리와 실제 사용량을 저장했어요.')).not.toBeInTheDocument();
    expect(form.getByRole('spinbutton', { name: /실제 사용량/ })).toHaveValue(150);
    expect((await getMealPlan(WEEK)).confirmed.slots[0].status).toBe('planned');
    expect((await getInventoryQuantitySnapshot()).inventory[0].amount).toBe(250);
    expect((await getAllIngredients())[0].quantity).toBe('300g');
  });
});
