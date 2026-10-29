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
import { confirmMealPlan, getMealPlan, saveMealPlan } from '../../features/mealPlans/mealPlanRepository';
import { getInventoryQuantitySnapshot, saveInventoryQuantity } from '../../features/mealPlans/inventoryQuantityRepository';
import { getMealCookingWorkspace, recordMealCooking } from '../../features/mealPlans/mealCookingRepository';

const WEEK = '2026-09-21';
const NOW = `${WEEK}T09:00:00.000Z`;
const auth = { storageScope: 'guest', loading: false, isAuthenticated: false };
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => auth }));

async function stock(id, amount) {
  await saveIngredient({ id, name: '닭고기', quantity: `${amount}g`, consumed: false, memo: '유지할 메모',
    expiryDate: '2026-10-30', category: '육류', storageType: '냉장', createdAt: NOW, updatedAt: NOW });
  const row = (await getInventoryQuantitySnapshot()).inventory.find(item => item.id === id);
  await saveInventoryQuantity({ scope: 'guest', ingredientId: row.id, expectedRevision: row.quantityRevision,
    expectedSourceToken: row.sourceToken, values: { name: '닭고기', amount, unit: 'g', preparationState: 'raw' } });
}
async function seed() {
  await stock('original', 300);
  const plan = generateMealPlan({ scope: 'guest', weekStart: WEEK, now: NOW,
    preferences: { servings: 1, dinnerDays: [0], excludedIngredients: [] } });
  plan.slots[0].title = '사용량 정정용 한 끼';
  await saveMealPlan(plan, 'guest', 0); await confirmMealPlan(WEEK, 'guest', 1);
  const row = (await getInventoryQuantitySnapshot()).inventory[0];
  await recordMealCooking({ scope: 'guest', weekStart: WEEK, slotId: `${WEEK}:dinner`, expectedPlanRevision: 2,
    operationId: 'original-cook', usageMode: 'measured', completeUsageConfirmed: true,
    usages: [{ ingredientId: row.id, amount: 150, unit: 'g', expectedRevision: row.quantityRevision, expectedSourceToken: row.sourceToken }] });
}
function page() {
  return <StrictMode><MemoryRouter><IngredientsProvider><PantryStaplesProvider><MealPlanPage /></PantryStaplesProvider></IngredientsProvider></MemoryRouter></StrictMode>;
}
async function noticeReady() {
  await waitFor(() => expect(screen.getByRole('region', { name: '지난 끼니 확인' })).toHaveAttribute('aria-busy', 'false'));
}
async function openCorrection() {
  fireEvent.click(await screen.findByRole('button', { name: '조리 이력 열기' }));
  const history = within(await screen.findByRole('article', { name: `${WEEK} 조리 이력` }));
  await noticeReady();
  fireEvent.click(history.getByRole('button', { name: '실제 사용량 정정', exact: true }));
  return within(await screen.findByRole('form', { name: /실제 사용량 정정 ·/ }));
}
function submit(form) {
  fireEvent.click(form.getByLabelText('정정할 실제 사용량을 모두 확인했어요'));
  fireEvent.click(form.getByRole('button', { name: '정정한 사용량으로 재고 반영' }));
}

describe('actual consumption correction through the meal page and IndexedDB', () => {
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(NOW));
    auth.storageScope = 'guest'; localStorage.clear();
    for (const scope of ['guest', 'user:alice']) { clearScopeState(scope); await clearAccountLocalData(scope); }
    await seed();
  });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); });

  it('corrects 150g to 100g, keeps later 500g and the original cooking fact, and survives reload', async () => {
    // A later, separately verified batch is real local stock, not a recipe estimate.
    await stock('z-later', 500);
    const original = (await getMealCookingWorkspace()).history.find(event => event.kind === 'cooking');
    const view = render(page()); const form = await openCorrection();
    const input = form.getByLabelText('닭고기 (1번 재고) 정정할 사용량 (g)');
    expect(input).toHaveValue(150);
    fireEvent.change(input, { target: { value: '100' } });
    expect(form.getByRole('region', { name: '정정 후 재고 미리보기' })).toHaveTextContent('200g');
    expect((await getAllIngredients()).find(item => item.id === 'original').quantity).toBe('150g');
    submit(form);
    await screen.findByText('실제 사용량을 정정했어요. 조리 기록은 유지돼요.'); await noticeReady();
    const stocks = await getAllIngredients();
    expect(stocks.find(item => item.id === 'original')).toMatchObject({ quantity: '200g', memo: '유지할 메모' });
    expect(stocks.find(item => item.id === 'z-later').quantity).toBe('500g');
    const history = (await getMealCookingWorkspace()).history;
    expect(history.filter(event => event.kind === 'cooking')).toEqual([original]);
    expect(history.filter(event => event.kind === 'consumption')).toHaveLength(2);
    expect((await getMealPlan(WEEK)).confirmed.slots[0].status).toBe('cooked');
    view.unmount(); render(page());
    const reloaded = await openCorrection();
    expect(reloaded.getByLabelText('닭고기 (1번 재고) 정정할 사용량 (g)')).toHaveValue(100);
  });

  it('allows an explicitly confirmed zero usage and keeps correction available without cancelling the cooking', async () => {
    render(page()); const form = await openCorrection();
    fireEvent.change(form.getByRole('spinbutton'), { target: { value: '0' } });
    submit(form);
    await screen.findByText('실제 사용량을 정정했어요. 조리 기록은 유지돼요.'); await noticeReady();
    expect((await getAllIngredients())[0].quantity).toBe('300g');
    const history = within(screen.getByRole('article', { name: `${WEEK} 조리 이력` }));
    expect(history.getByText('실제 사용량 재고 반영됨')).toBeInTheDocument();
    expect(history.getByText('기록한 사용량 0 · 재고 차감 없음')).toBeInTheDocument();
    expect(history.getByRole('button', { name: '실제 사용량 정정', exact: true })).toBeEnabled();
    expect((await getMealPlan(WEEK)).confirmed.slots[0].status).toBe('cooked');
  });

  it('keeps correction input after a stale stock rejection and does not write another consumption', async () => {
    render(page()); const form = await openCorrection();
    const input = form.getByRole('spinbutton'); fireEvent.change(input, { target: { value: '100' } });
    const row = (await getInventoryQuantitySnapshot()).inventory[0];
    await saveInventoryQuantity({ scope: 'guest', ingredientId: row.id, expectedRevision: row.quantityRevision,
      expectedSourceToken: row.sourceToken, values: { name: '닭고기', amount: 140, unit: 'g', preparationState: 'raw' } });
    submit(form);
    await waitFor(() => expect(form.getByRole('alert')).toHaveTextContent(/바뀌|다시|새로/));
    expect(input).toHaveValue(100);
    expect(form.getByRole('button', { name: '정정한 사용량으로 재고 반영' })).toBeEnabled();
    expect((await getMealCookingWorkspace()).history.filter(event => event.kind === 'consumption')).toHaveLength(1);
    expect((await getInventoryQuantitySnapshot()).inventory[0].amount).toBe(140);
    expect(screen.queryByText('실제 사용량을 정정했어요. 조리 기록은 유지돼요.')).not.toBeInTheDocument();
  });
});
