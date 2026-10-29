import { StrictMode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import MealPlanPage from '../MealPlanPage';
import { IngredientsProvider } from '../../hooks/useIngredients';
import { PantryStaplesProvider } from '../../hooks/usePantryStaples';
import { clearScopeState } from '../../features/ingredients/ingredientsScopeState';
import { clearAccountLocalData, getAllIngredients, saveIngredient } from '../../db/indexedDB';
import { generateMealPlan } from '../../features/mealPlans/mealPlanDomain';
import { confirmMealPlan, getMealPlan, getMealPlanningSnapshot, saveMealPlan } from '../../features/mealPlans/mealPlanRepository';
import { getInventoryQuantitySnapshot, saveInventoryQuantity } from '../../features/mealPlans/inventoryQuantityRepository';
import { getMealCookingWorkspace } from '../../features/mealPlans/mealCookingRepository';
import { getShoppingWorkspace } from '../../features/shopping/shoppingRepository';

const TODAY = '2026-09-28';
const PAST = '2026-09-21';
const OLDER = '2026-09-14';
const auth = { storageScope: 'guest', loading: false, isAuthenticated: false };
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => auth }));

// Hand-checked arithmetic fixtures, not reviewed production recipes.
async function seedPlan(weekStart, { confirmed = true } = {}) {
  const plan = generateMealPlan({ scope: 'guest', weekStart, now: `${weekStart}T03:00:00.000Z`,
    preferences: { servings: 1, excludedIngredients: [], dinnerDays: [0] } });
  const slot = plan.slots[0];
  slot.title = `${weekStart} 닭고기 한 끼`;
  slot.components = [{ ...slot.components[0], servings: 1, servingsStatus: 'verified', processInputs: [],
    ingredients: [{ ...slot.components[0].ingredients[0], id: 'chicken', rawName: '닭고기', normalizedName: '닭고기',
      ingredientKey: 'food:닭고기', amount: 200, unit: 'g', preparationState: 'raw', quantityStatus: 'verified',
      quantityEvidence: 'test:arithmetic-only', optional: false, selected: true }] }];
  await saveMealPlan(plan, 'guest', 0);
  if (confirmed) await confirmMealPlan(weekStart, 'guest', 1);
}

function page() {
  return <StrictMode><MemoryRouter><IngredientsProvider><PantryStaplesProvider><MealPlanPage /></PantryStaplesProvider></IngredientsProvider></MemoryRouter></StrictMode>;
}
const overdue = () => within(screen.getByRole('region', { name: '지난 끼니 확인' }));
const shopping = () => within(screen.getByRole('region', { name: '식단 장보기 미리보기' }));
async function noticeReady() {
  await waitFor(() => {
    expect(screen.queryByText('식단을 불러오는 중이에요.')).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: '지난 끼니 확인' })).toHaveAttribute('aria-busy', 'false');
  });
}
async function openPast() {
  fireEvent.click(await screen.findByRole('button', { name: `${PAST} 식단 확인` }));
  const article = await screen.findByRole('article', { name: `${PAST} 저녁 식단` });
  await noticeReady();
  return within(article);
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 8, 28, 12));
  auth.storageScope = 'guest';
  localStorage.clear();
  for (const scope of ['guest', 'user:alice']) { clearScopeState(scope); await clearAccountLocalData(scope); }
  await saveIngredient({ id: 'chicken', name: '닭고기', quantity: '300g', consumed: false,
    expiryDate: '2026-10-30', category: '육류', storageType: '냉장', memo: '보존할 재고 메모' });
  const row = (await getInventoryQuantitySnapshot()).inventory[0];
  await saveInventoryQuantity({ scope: 'guest', ingredientId: row.id, expectedRevision: row.quantityRevision,
    expectedSourceToken: row.sourceToken, values: { name: '닭고기', amount: 300, unit: 'g', preparationState: 'raw' } });
  await seedPlan(PAST);
  await seedPlan(TODAY);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); });

describe('overdue confirmed meals through page controls and real IndexedDB', () => {
  it('discovers all older confirmed meals without treating a draft as a hold or writing inventory', async () => {
    await seedPlan(OLDER);
    await seedPlan('2026-09-07', { confirmed: false });
    const before = await getMealCookingWorkspace('guest');
    render(page());
    // Retry only the notice while real IndexedDB work is pending; the editor's
    // unrelated mutations should not repeatedly scan/serialize the whole page.
    const olderWeek = await overdue().findByRole('button', { name: `${OLDER} 식단 확인` });
    expect(screen.getByRole('button', { name: `${OLDER} 식단 확인` })).toBe(olderWeek);
    expect(overdue().getByRole('button', { name: `${PAST} 식단 확인` })).toBeEnabled();
    expect(overdue().queryByRole('button', { name: '2026-09-07 식단 확인' })).not.toBeInTheDocument();
    expect(overdue().getAllByText(/조리 여부 확인 필요/)).not.toHaveLength(0);
    expect(await getMealCookingWorkspace('guest')).toEqual(before);
  });

  it('keeps the confirmed hold after a skip draft and releases it only after explicit confirmation', async () => {
    const before = await getAllIngredients();
    render(page());
    const past = await openPast();
    expect(past.getByText(/예정 배분 보류/)).toBeInTheDocument();
    expect(past.getByRole('button', { name: '메뉴 교체' })).toBeDisabled();
    fireEvent.click(past.getByRole('button', { name: '만들지 않았어요' }));
    const confirm = await screen.findByRole('button', { name: '수정 초안으로 확정본 교체' });
    await waitFor(() => expect(confirm).toBeEnabled());
    await overdue().findByRole('button', { name: `${PAST} 식단 확인` });
    expect((await getMealPlan(PAST)).confirmed.slots[0].status).toBe('planned');
    fireEvent.click(shopping().getByRole('button', { name: '식단 장보기 확인' }));
    expect(await shopping().findByText('100g', { exact: true })).toBeInTheDocument();
    expect(shopping().getByRole('list', { name: '배분을 보류한 지난 끼니' })).toHaveTextContent(PAST);
    fireEvent.click(confirm);
    await screen.findByRole('heading', { name: '확정됨', exact: true });
    await noticeReady();
    await waitFor(() => expect(overdue().queryByRole('button', { name: `${PAST} 식단 확인` })).not.toBeInTheDocument());
    expect((await getMealPlan(PAST)).confirmed.slots[0].status).toBe('skipped');
    expect(await getAllIngredients()).toEqual(before);
    expect((await getMealCookingWorkspace('guest')).history).toEqual([]);
  });

  it('moves an overdue meal to a future empty day without offering a swap or consuming stock', async () => {
    const before = await getAllIngredients();
    render(page());
    const past = await openPast();
    fireEvent.click(past.getByRole('button', { name: '날짜 이동' }));
    const panel = within(screen.getByRole('region', { name: '식단 변경 미리보기' }));
    expect(panel.queryByRole('option', { name: '두 메뉴 날짜 바꾸기' })).not.toBeInTheDocument();
    expect(panel.getByLabelText('옮길 날짜')).toHaveAttribute('min', TODAY);
    fireEvent.change(panel.getByLabelText('옮길 날짜'), { target: { value: '2026-09-29' } });
    fireEvent.click(panel.getByRole('button', { name: '변경안 미리보기' }));
    const confirm = await panel.findByRole('button', { name: '변경안 확정' });
    await waitFor(() => expect(confirm).toBeEnabled());
    expect(panel.getByRole('region', { name: '변경 전 전체 장보기' })).toHaveTextContent('조리 여부 확인 필요');
    fireEvent.click(confirm);
    await panel.findByText('변경안을 확정했어요.');
    await noticeReady();
    expect((await getMealPlan(PAST)).confirmed.slots[0].status).toBe('skipped');
    expect((await getMealPlan(TODAY)).confirmed.slots[1]).toMatchObject({ status: 'planned', title: `${PAST} 닭고기 한 끼` });
    expect(await getAllIngredients()).toEqual(before);
    await waitFor(() => expect(overdue().queryByRole('button', { name: `${PAST} 식단 확인` })).not.toBeInTheDocument());
  });

  it('resolves an overdue meal only when its actual cooking is recorded', async () => {
    render(page());
    const past = await openPast();
    fireEvent.click(past.getByRole('button', { name: '만들어 먹었어요' }));
    const form = within(await screen.findByRole('form', { name: `조리 사용량 · ${PAST} 닭고기 한 끼` }));
    const cooking = within(screen.getByRole('region', { name: '조리와 재고 기록' }));
    fireEvent.change(form.getByRole('spinbutton', { name: /실제 사용량/ }), { target: { value: '150' } });
    fireEvent.click(form.getByLabelText('실제로 쓴 재고를 모두 확인했어요'));
    fireEvent.click(form.getByRole('button', { name: '실제 사용량으로 조리 기록' }));
    const saved = await cooking.findByText('조리와 실제 사용량을 저장했어요.');
    expect(screen.getByText('조리와 실제 사용량을 저장했어요.')).toBe(saved);
    await noticeReady();
    await waitFor(() => expect(overdue().queryByRole('button', { name: `${PAST} 식단 확인` })).not.toBeInTheDocument());
    expect((await getAllIngredients())[0]).toMatchObject({ quantity: '150g', memo: '보존할 재고 메모' });
    expect((await getMealPlan(PAST)).confirmed.slots[0].status).toBe('cooked');
  });

  it('refreshes the local day on focus without exposing a previous account or reusing stale shopping', async () => {
    const view = render(page());
    await screen.findByRole('button', { name: `${PAST} 식단 확인` });
    fireEvent.click(shopping().getByRole('button', { name: '식단 장보기 확인' }));
    await shopping().findByText('100g', { exact: true });
    const before = await getMealCookingWorkspace('guest');
    vi.setSystemTime(new Date(2026, 8, 29, 0, 1));
    fireEvent.focus(window);
    await screen.findByRole('button', { name: `${TODAY} 식단 확인` });
    expect(shopping().queryByText('100g', { exact: true })).not.toBeInTheDocument();
    expect(await getMealCookingWorkspace('guest')).toEqual(before);
    auth.storageScope = 'user:alice';
    view.rerender(page());
    expect(screen.queryByRole('button', { name: `${PAST} 식단 확인` })).not.toBeInTheDocument();
    await screen.findByText('조리 여부를 확인할 지난 끼니가 없어요.');
  });

  it('restores a conflicting overdue draft only on request and preserves its future edits', async () => {
    const record = await getMealPlan(TODAY);
    const draft = structuredClone(record.confirmed);
    draft.slots[0].title = '자정 전에 바꾼 메뉴';
    draft.slots[1] = { ...structuredClone(draft.slots[0]), id: draft.slots[1].id,
      date: draft.slots[1].date, title: '유지할 미래 메뉴' };
    await saveMealPlan(draft, 'guest', record.revision);
    vi.setSystemTime(new Date(2026, 8, 29, 0, 1));
    const before = await getMealCookingWorkspace('guest');
    render(page());
    const restore = await screen.findByRole('button', { name: '지난 끼니를 유지해 초안 복구' });
    await waitFor(() => expect(restore).toBeEnabled());
    await noticeReady();
    expect(await getMealCookingWorkspace('guest')).toEqual(before);
    expect(screen.getByRole('button', { name: '수정 초안으로 확정본 교체' })).toBeDisabled();
    fireEvent.click(restore);
    await waitFor(() => expect(screen.queryByRole('button', { name: '지난 끼니를 유지해 초안 복구' })).not.toBeInTheDocument());
    await noticeReady();
    const saved = await getMealPlan(TODAY);
    expect(saved.draft.slots[0]).toEqual(record.confirmed.slots[0]);
    expect(saved.draft.slots[1]).toEqual(draft.slots[1]);
    expect(saved.confirmed).toEqual(record.confirmed);
    expect(saved.archives).toEqual(record.archives);
    expect(screen.getByRole('button', { name: '수정 초안으로 확정본 교체' })).toBeEnabled();
    await noticeReady();
    expect(overdue().getByRole('button', { name: `${TODAY} 식단 확인` })).toBeInTheDocument();
  });

  it('preserves an overdue confirmation when regenerating but leaves an unconfirmed old draft editable', async () => {
    await seedPlan(OLDER, { confirmed: false });
    render(page());
    await openPast();
    const confirmed = (await getMealPlan(PAST)).confirmed;
    fireEvent.click(screen.getByRole('button', { name: '고정하지 않은 메뉴 다시 추천' }));
    await screen.findByRole('button', { name: '수정 초안으로 확정본 교체' });
    await waitFor(() => expect(screen.getByRole('button', { name: '수정 초안으로 확정본 교체' })).toBeEnabled());
    await noticeReady();
    expect((await getMealPlan(PAST)).draft.slots[0]).toEqual(confirmed.slots[0]);
    fireEvent.change(screen.getByLabelText('주 시작일'), { target: { value: OLDER } });
    const oldDraft = within(await screen.findByRole('article', { name: `${OLDER} 저녁 식단` }));
    await noticeReady();
    expect(oldDraft.queryByText(/예정 배분 보류/)).not.toBeInTheDocument();
    expect(oldDraft.getByRole('button', { name: '메뉴 교체' })).toBeEnabled();
    fireEvent.click(oldDraft.getByRole('button', { name: '메뉴 교체' }));
    // A committed DB revision may be visible before React receives the save
    // response and starts its new all-weeks read. Wait for that UI boundary first.
    await screen.findByText('9.14 메뉴를 바꿨어요.');
    await noticeReady();
    const savedDraft = await getMealPlan(OLDER);
    expect(savedDraft.revision).toBe(2);
    expect(savedDraft.confirmed).toBeNull();
  });

  it('updates overdue state at local midnight even without focus or any inventory write', async () => {
    render(page());
    await screen.findByRole('button', { name: `${PAST} 식단 확인` });
    await waitFor(() => expect(shopping().getByRole('button', { name: '식단 장보기 확인' })).toBeEnabled());
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    vi.setSystemTime(new Date(2026, 8, 28, 23, 59, 59));
    fireEvent.focus(window); // Rearm under the fake clock before opening either view.
    await act(async () => { await getMealPlanningSnapshot('guest'); });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '장보기 메모 열기' }));
      await getShoppingWorkspace('guest', TODAY);
    });
    const purchase = within(screen.getByRole('form', { name: '구매 메모 작성' }));
    expect(purchase.getByRole('option', { name: /식단: 닭고기.*100g/ })).toBeInTheDocument();
    // No later focus event occurs: the local-midnight timer must invalidate
    // the open view. IndexedDB remains real and asynchronous.
    expect(screen.queryByRole('button', { name: `${TODAY} 식단 확인` })).not.toBeInTheDocument();
    let before;
    await act(async () => { before = await getMealCookingWorkspace('guest'); });
    await act(async () => { await vi.advanceTimersByTimeAsync(1001); });
    await act(async () => { await getMealPlanningSnapshot('guest'); });
    expect(screen.getByRole('button', { name: `${TODAY} 식단 확인` })).toBeInTheDocument();
    expect(screen.queryByRole('form', { name: '구매 메모 작성' })).not.toBeInTheDocument();
    expect(await getMealCookingWorkspace('guest')).toEqual(before);
  });
});
