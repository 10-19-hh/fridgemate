import { StrictMode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import MealPlanPage from '../MealPlanPage';
import { IngredientsProvider } from '../../hooks/useIngredients';
import { PantryStaplesProvider } from '../../hooks/usePantryStaples';
import { clearAccountLocalData, getAllIngredients, saveIngredient } from '../../db/indexedDB';
import { clearScopeState } from '../../features/ingredients/ingredientsScopeState';
import { generateMealPlan } from '../../features/mealPlans/mealPlanDomain';
import { confirmMealPlan, getMealPlan, saveMealPlan } from '../../features/mealPlans/mealPlanRepository';
import { getInventoryQuantitySnapshot, saveInventoryQuantity } from '../../features/mealPlans/inventoryQuantityRepository';

const WEEK = '2026-09-21';
const NEXT = '2026-09-28';
const NOW = `${WEEK}T09:00:00.000Z`;
const auth = { storageScope: 'guest', loading: false, isAuthenticated: false };
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => auth }));

async function seedPlan(weekStart = WEEK, title = '이동 검증용 닭고기 식단', amount = 200) {
  const plan = generateMealPlan({ scope: 'guest', weekStart, now: NOW,
    preferences: { servings: 1, dinnerDays: [0], excludedIngredients: [] } });
  plan.slots[0] = { ...plan.slots[0], title, templateKey: `fixture:${weekStart}`,
    components: [{ ...plan.slots[0].components[0], title, servings: 1, servingsStatus: 'verified', processInputs: [],
      ingredients: [{ ...plan.slots[0].components[0].ingredients[0], id: 'chicken-line', rawName: '닭고기', normalizedName: '닭고기',
        ingredientKey: 'food:닭고기', amount, unit: 'g', preparationState: 'raw', quantityStatus: 'verified',
        quantityEvidence: 'test:arithmetic-only', optional: false, selected: true }] }] };
  await saveMealPlan(plan, 'guest', 0); await confirmMealPlan(weekStart, 'guest', 1);
}

function page() {
  return <StrictMode><MemoryRouter><IngredientsProvider><PantryStaplesProvider><MealPlanPage /></PantryStaplesProvider></IngredientsProvider></MemoryRouter></StrictMode>;
}
async function noticeReady() {
  // The selected-week board can settle before the separate all-weeks read.
  await waitFor(() => {
    expect(screen.queryByText('식단을 불러오는 중이에요.')).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: '지난 끼니 확인' })).toHaveAttribute('aria-busy', 'false');
  });
}
async function openMove(targetDate) {
  const monday = within(await screen.findByRole('article', { name: `${WEEK} 저녁 식단` }));
  await noticeReady();
  fireEvent.click(monday.getByRole('button', { name: '날짜 이동' }));
  const panel = within(await screen.findByRole('region', { name: '식단 변경 미리보기' }));
  fireEvent.change(panel.getByLabelText('옮길 날짜'), { target: { value: targetDate } });
  return panel;
}

describe('meal-plan changes through real storage and page controls', () => {
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(NOW));
    auth.storageScope = 'guest'; auth.loading = false;
    localStorage.clear();
    for (const scope of ['guest', 'user:alice']) { clearScopeState(scope); await clearAccountLocalData(scope); }
    await saveIngredient({ id: 'chicken', name: '닭고기', quantity: '300g', consumed: false,
      expiryDate: WEEK, category: '육류', storageType: '냉장', memo: '계획 이동으로 바꾸면 안 됨', createdAt: NOW, updatedAt: NOW });
    const row = (await getInventoryQuantitySnapshot()).inventory[0];
    await saveInventoryQuantity({ scope: 'guest', ingredientId: row.id, expectedRevision: row.quantityRevision,
      expectedSourceToken: row.sourceToken, values: { name: '닭고기', amount: 300, unit: 'g', preparationState: 'raw' } });
    await seedPlan();
  });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); });

  it('previews a moved meal without writes, warns about expiry and confirms without consuming stock', async () => {
    const before = await getMealPlan(WEEK);
    const stock = await getAllIngredients();
    const quantity = await getInventoryQuantitySnapshot();
    const view = render(page());
    const panel = await openMove('2026-09-22');
    fireEvent.click(panel.getByRole('button', { name: '변경안 미리보기' }));
    const confirm = await panel.findByRole('button', { name: '변경안 확정' });
    await waitFor(() => expect(confirm).toBeEnabled());
    expect(panel.getAllByText(/기한/).length).toBeGreaterThan(0);
    expect(await getMealPlan(WEEK)).toEqual(before);
    confirm.focus(); fireEvent.click(confirm); fireEvent.click(confirm);
    await panel.findByText('변경안을 확정했어요.');
    await noticeReady();
    const after = await getMealPlan(WEEK);
    expect(after).toMatchObject({ revision: 3, draft: null, archives: [before.confirmed] });
    expect(after.confirmed.slots[0].status).toBe('skipped');
    expect(after.confirmed.slots[1]).toMatchObject({ status: 'planned', title: before.confirmed.slots[0].title });
    expect(await getAllIngredients()).toEqual(stock);
    expect(await getInventoryQuantitySnapshot()).toEqual(quantity);
    fireEvent.click(panel.getByRole('button', { name: '변경 창 닫기' }));
    expect(within(await screen.findByRole('article', { name: '2026-09-22 저녁 식단' })).getByRole('heading', { name: before.confirmed.slots[0].title })).toBeInTheDocument();
    view.unmount(); render(page());
    expect(within(await screen.findByRole('article', { name: `${WEEK} 저녁 식단` })).getByRole('heading', { name: '외식하거나 쉬는 날' })).toBeInTheDocument();
    await noticeReady();
  });

  it('requires an explicit swap and confirms both weeks together while keeping the old confirmations', async () => {
    await seedPlan(NEXT, '다음 주에 정한 닭고기 식단', 100);
    const first = await getMealPlan(WEEK); const next = await getMealPlan(NEXT);
    render(page()); const panel = await openMove(NEXT);
    fireEvent.change(panel.getByLabelText('이동 방식'), { target: { value: 'swap' } });
    fireEvent.click(panel.getByRole('button', { name: '변경안 미리보기' }));
    const confirm = await panel.findByRole('button', { name: '변경안 확정' });
    await waitFor(() => expect(confirm).toBeEnabled());
    expect(await getMealPlan(WEEK)).toEqual(first); expect(await getMealPlan(NEXT)).toEqual(next);
    fireEvent.click(confirm); await panel.findByText('변경안을 확정했어요.');
    await noticeReady();
    expect((await getMealPlan(WEEK)).confirmed.slots[0].title).toBe(next.confirmed.slots[0].title);
    expect((await getMealPlan(NEXT)).confirmed.slots[0].title).toBe(first.confirmed.slots[0].title);
    expect((await getMealPlan(WEEK)).archives).toEqual([first.confirmed]);
    expect((await getMealPlan(NEXT)).archives).toEqual([next.confirmed]);
    expect((await getAllIngredients())[0].quantity).toBe('300g');
  });

  it('rejects a proposal after another week changes and does not show a saved result', async () => {
    render(page()); const panel = await openMove('2026-09-22');
    fireEvent.click(panel.getByRole('button', { name: '변경안 미리보기' }));
    const confirm = await panel.findByRole('button', { name: '변경안 확정' });
    await waitFor(() => expect(confirm).toBeEnabled());
    await seedPlan(NEXT);
    fireEvent.click(confirm);
    await panel.findByRole('alert');
    expect(panel.queryByText('변경안을 확정했어요.')).not.toBeInTheDocument();
    expect((await getMealPlan(WEEK)).confirmed.slots[0].status).toBe('planned');
    expect((await getMealPlan(NEXT)).revision).toBe(2);
  });

  it('offers manual remaining-week readjustment without regenerating when inventory changes', async () => {
    render(page());
    await screen.findByRole('article', { name: `${WEEK} 저녁 식단` });
    await noticeReady();
    const before = await getMealPlan(WEEK);
    await saveIngredient({ id: 'rice', name: '밥', quantity: '한 공기', consumed: false, expiryDate: '2026-09-30', createdAt: NOW, updatedAt: NOW });
    expect(await getMealPlan(WEEK)).toEqual(before);
    fireEvent.click(await screen.findByRole('button', { name: '이번 주 남은 식단 다시 맞추기' }));
    const panel = within(await screen.findByRole('region', { name: '식단 변경 미리보기' }));
    fireEvent.click(panel.getByRole('button', { name: '변경안 미리보기' }));
    const confirm = await panel.findByRole('button', { name: '변경안 확정' });
    await waitFor(() => expect(confirm).toBeEnabled());
    expect(await getMealPlan(WEEK)).toEqual(before);
    fireEvent.click(confirm); await panel.findByText('변경안을 확정했어요.');
    await noticeReady();
    const after = await getMealPlan(WEEK);
    expect(after.confirmed.slots[0].templateKey).not.toBe(before.confirmed.slots[0].templateKey);
    expect(after.confirmed.slots.slice(1)).toEqual(before.confirmed.slots.slice(1));
    expect((await getAllIngredients()).find(item => item.id === 'rice').quantity).toBe('한 공기');
  });

  it('keeps a conflicting locked draft unconfirmed until the user resolves its exclusion', async () => {
    render(page());
    const monday = within(await screen.findByRole('article', { name: `${WEEK} 저녁 식단` }));
    await noticeReady();
    fireEvent.click(monday.getByRole('button', { name: '메뉴 고정' }));
    const confirmDraft = () => screen.getByRole('button', { name: '수정 초안으로 확정본 교체' });
    await waitFor(() => expect(confirmDraft()).toBeEnabled());
    fireEvent.click(confirmDraft());
    await screen.findByRole('heading', { name: '확정됨' });
    await noticeReady();
    const original = await getMealPlan(WEEK);
    const stock = await getAllIngredients();
    fireEvent.click(screen.getByText('식단 조건', { exact: false, selector: 'summary' }));
    fireEvent.change(screen.getByLabelText('피하고 싶은 재료'), { target: { value: '닭고기' } });
    expect(screen.getByRole('button', { name: '이번 주 남은 식단 다시 맞추기' })).toBeDisabled();
    expect(monday.getByRole('button', { name: '날짜 이동' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '고정하지 않은 메뉴 다시 추천' }));
    await waitFor(() => expect(confirmDraft()).toBeEnabled());
    await noticeReady();
    const conflict = await getMealPlan(WEEK);
    expect(conflict.draft.slots[0]).toMatchObject({ locked: true, title: original.confirmed.slots[0].title });
    fireEvent.click(confirmDraft());
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('제외 재료'));
    expect(await getMealPlan(WEEK)).toEqual(conflict);
    expect((await getMealPlan(WEEK)).confirmed).toEqual(original.confirmed);
    expect(await getAllIngredients()).toEqual(stock);
    expect(screen.queryByRole('heading', { name: '확정됨' })).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('피하고 싶은 재료'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: '고정하지 않은 메뉴 다시 추천' }));
    await waitFor(() => expect(confirmDraft()).toBeEnabled());
    fireEvent.click(confirmDraft());
    await screen.findByRole('heading', { name: '확정됨' });
    await noticeReady();
    const resolved = await getMealPlan(WEEK);
    expect(resolved.draft).toBeNull();
    expect(resolved.confirmed.preferences.excludedIngredients).toEqual([]);
    expect(resolved.confirmed.slots[0]).toMatchObject({ locked: true, title: original.confirmed.slots[0].title });
    expect(await getAllIngredients()).toEqual(stock);
  });
});
