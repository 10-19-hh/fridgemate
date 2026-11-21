import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import FDBFactory from 'fake-indexeddb/lib/FDBFactory';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import MealPlanningPanel from '../MealPlanningPanel.jsx';
import { generateMealPlan } from '../mealPlanDomain.js';
import { confirmMealPlan, getMealPlan, saveMealPlan } from '../mealPlanRepository.js';
import { getMealPlanningSnapshot, saveMealPlanningStock } from '../mealPlanningRepository.js';
import { getPlanningInventoryBasis } from '../mealPlanningStock.js';
import { getAllIngredients, saveIngredient } from '../../../db/indexedDB.js';

let index = 0;
let scope;
const weekStart = '2026-09-14';

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-16T00:00:00Z'));
  scope = `user:planning-panel-${++index}`;
  Object.defineProperty(window, 'indexedDB', { configurable: true, value: new FDBFactory() });
  const plan = generateMealPlan({ weekStart, scope });
  const saved = await saveMealPlan(plan, scope, (await getMealPlan(weekStart, scope))?.revision ?? 0);
  await confirmMealPlan(weekStart, scope, saved.revision);
  for (const [id, name] of [['tomato', '방울토마토'], ['onion', '양파'], ['chives', '부추']]) {
    await saveIngredient({ id, name, quantity: '일부', expiryDate: '2026-09-30', consumed: false }, scope);
  }
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

async function open() {
  const view = render(<MealPlanningPanel scope={scope} weekStart={weekStart} />);
  await screen.findByLabelText('계획할 날짜');
  return view;
}

async function confirmCore() {
  for (const [name, value, amount] of [['방울토마토', 'cherry-tomato|raw|g', '75'], ['양파', 'onion|raw|g', '10'], ['부추', 'chives|raw|g', '10']]) {
    const row = within(screen.getByRole('group', { name: `냉장고 ${name}` }));
    fireEvent.change(row.getByLabelText('계산할 재료'), { target: { value } });
    fireEvent.change(row.getByLabelText('확인한 보유량'), { target: { value: amount } });
    fireEvent.click(row.getByLabelText('쓸 수 있는 상태임을 확인'));
  }
  fireEvent.click(screen.getByRole('button', { name: '재고 확인값 저장' }));
  await screen.findByText('재고 확인값을 저장했어요. 실제 냉장고 수량은 바꾸지 않았어요.');
}

function previewPortion() {
  fireEvent.change(screen.getByLabelText('계획할 날짜'), { target: { value: '2026-09-16:dinner' } });
  fireEvent.change(screen.getByLabelText('추가할 반찬'), { target: { value: 'mfds:31' } });
  fireEvent.click(screen.getByRole('button', { name: '분량 미리보기' }));
}

describe('quantity meal-planning panel with real local storage', () => {
  it('confirms stock, previews without saving, and persists one additional half-portion without consuming stock', async () => {
    const view = await open();
    const original = await getAllIngredients(scope);
    expect(screen.getByText(/한 끼 전체가 아닌 반찬 한 가지/)).toBeInTheDocument();
    expect(screen.getByLabelText('추가할 반찬').options).toHaveLength(4);
    expect((await getMealPlanningSnapshot({ scope })).state.commitments).toEqual([]);
    await confirmCore();
    previewPortion();
    const preview = screen.getByRole('region', { name: '승인 전 분량' });
    expect(within(preview).getByText('75g', { exact: true })).toBeInTheDocument();
    expect(within(preview).getByText('다진 마늘', { exact: true })).toBeInTheDocument();
    expect(within(preview).getByText(/양념/)).toBeInTheDocument();
    expect((await getMealPlanningSnapshot({ scope })).state.commitments).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: '이 분량을 식단에 승인' }));
    await screen.findByText('반찬 예정량을 저장하고 정량 반찬 장보기를 갱신했어요.');
    expect((await getMealPlanningSnapshot({ scope })).state.commitments[0].quantityChoice.scaleFactor).toBe(0.5);
    expect(await getAllIngredients(scope)).toEqual(original);
    view.unmount();
    await open();
    const approved = screen.getByRole('region', { name: '승인한 정량 반찬' });
    expect(within(approved).getByText('방울토마토 소박이')).toBeInTheDocument();
    expect(within(approved).getByText('2026-09-16')).toBeInTheDocument();
    expect(within(approved).getByText('75g', { exact: true })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: '정량 반찬 장보기' })).toHaveTextContent('통깨');
  });

  it('discards a pending approval when stock input or recipe choices change', async () => {
    await open();
    await confirmCore();
    previewPortion();
    expect(screen.getByRole('button', { name: '이 분량을 식단에 승인' })).toBeEnabled();
    const row = within(screen.getByRole('group', { name: '냉장고 방울토마토' }));
    fireEvent.change(row.getByLabelText('확인한 보유량'), { target: { value: '30' } });
    expect(screen.queryByRole('button', { name: '이 분량을 식단에 승인' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '분량 미리보기' })).toBeDisabled();
    expect((await getMealPlanningSnapshot({ scope })).state.commitments).toEqual([]);
  });

  it('surfaces concurrent changes instead of displaying a false save success', async () => {
    await open();
    await confirmCore();
    previewPortion();
    await saveIngredient({ id: 'tomato', name: '방울토마토', quantity: '바뀐 양' }, scope);
    fireEvent.click(screen.getByRole('button', { name: '이 분량을 식단에 승인' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('변경');
    expect((await getMealPlanningSnapshot({ scope })).state.commitments).toEqual([]);
    expect(screen.queryByText('반찬 예정량을 저장하고 정량 반찬 장보기를 갱신했어요.')).not.toBeInTheDocument();
  });

  it('clears an old scope immediately and does not reveal its pending approval in another account', async () => {
    const view = await open();
    await confirmCore();
    previewPortion();
    view.rerender(<MealPlanningPanel scope={`${scope}-other`} weekStart={weekStart} />);
    expect(screen.queryByRole('region', { name: '승인 전 분량' })).not.toBeInTheDocument();
    await screen.findByText('먼저 이 주의 식단 초안을 만들어 주세요.');
    expect(screen.queryByRole('group', { name: '냉장고 방울토마토' })).not.toBeInTheDocument();
    expect((await getMealPlanningSnapshot({ scope })).state.commitments).toEqual([]);
  });

  it('does not promote an unknown stored numeric amount when saving unrelated stock edits', async () => {
    const snapshot = await getMealPlanningSnapshot({ scope });
    const raw = snapshot.ingredients.find((row) => row.id === 'tomato');
    await saveMealPlanningStock({ scope, snapshot, confirmations: [{ ingredientId: raw.id,
      sourceBasis: getPlanningInventoryBasis([raw]), foodId: 'cherry-tomato', preparationState: 'raw', unit: 'g',
      amount: 75, quantityStatus: 'unknown', availabilityStatus: 'available', expiryStatus: 'dated',
      expiryDate: '2026-09-30', confirmedAt: new Date().toISOString() }] });
    await open();
    const row = within(screen.getByRole('group', { name: '냉장고 방울토마토' }));
    expect(row.getByLabelText('확인한 보유량')).toHaveValue(null);
    fireEvent.click(screen.getByRole('button', { name: '재고 확인값 저장' }));
    await screen.findByText('재고 확인값을 저장했어요. 실제 냉장고 수량은 바꾸지 않았어요.');
    expect((await getMealPlanningSnapshot({ scope })).state.stockConfirmations[0]).toMatchObject({ amount: null, quantityStatus: 'unknown' });
  });

  it('requires a reload when the date changes before opening a preview', async () => {
    await open();
    await confirmCore();
    vi.setSystemTime(new Date('2026-09-17T00:00:00Z'));
    previewPortion();
    await waitFor(() => expect(screen.queryByRole('region', { name: '승인 전 분량' })).not.toBeInTheDocument());
    expect(screen.getByRole('alert')).toHaveTextContent('날짜');
  });
});
