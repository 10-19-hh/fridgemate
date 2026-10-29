import { StrictMode, useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import MealPlanChangePanel from '../MealPlanChangePanel';
import { previewMealPlanChange, confirmMealPlanChange } from '../../features/mealPlans/mealPlanChangesRepository';
import { allocateMealPlanInventory } from '../../features/mealPlans/mealPlanAllocation';
import { generateMealPlan, moveMealPlanSlot } from '../../features/mealPlans/mealPlanDomain';

// The repository is the persistence boundary. Actual storage and allocation are
// exercised by the page integration tests; these tests defer its responses to
// expose UI ordering and account/focus races deterministically.
vi.mock('../../features/mealPlans/mealPlanChangesRepository', () => ({
  previewMealPlanChange: vi.fn(), confirmMealPlanChange: vi.fn(),
}));

const WEEK = '2026-09-21';
const SLOT = `${WEEK}:dinner`;
const meal = (date, title, status = 'planned') => ({ id: `${date}:dinner`, date, title, status, servings: 1, components: [] });
function preview(scope = 'guest') {
  return {
    scope, request: { scope, weekStart: WEEK, kind: 'move', slotId: SLOT, targetDate: '2026-09-23', mode: 'move', pantryItems: [] },
    token: 'fixture-current-state', today: WEEK, createdAt: `${WEEK}T09:00:00.000Z`, plans: [], canApply: true,
    changes: [
      { date: WEEK, before: meal(WEEK, '닭고기 한 끼'), after: meal(WEEK, '', 'skipped') },
      { date: '2026-09-23', before: meal('2026-09-23', '', 'skipped'), after: meal('2026-09-23', '닭고기 한 끼') },
    ], notices: ['도착일의 재료 기한을 다시 확인해 주세요.'],
    beforeAllocation: { status: 'shortage', slots: [{ id: SLOT, date: WEEK, requirements: [
      { label: '닭고기', requiredAmount: 200, unit: 'g', status: 'shortage' },
    ] }], shopping: { shortages: [{ ingredientKey: 'food:닭고기', label: '닭고기', amount: 100, unit: 'g', preparationState: 'raw', slotIds: [SLOT] }], needsReview: [], optional: [] } },
    afterAllocation: { status: 'needs-review', slots: [{ id: '2026-09-23:dinner', date: '2026-09-23', requirements: [
      { label: '닭고기', requiredAmount: 200, unit: 'g', status: 'needs-review' },
    ] }], shopping: { shortages: [], needsReview: [{ slotId: '2026-09-23:dinner', date: '2026-09-23', title: '닭고기 한 끼', label: '닭고기', reason: 'inventory-expired' }], optional: [] } },
  };
}
function deferred() {
  let resolve; let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function Harness({ scope = 'guest', kind = 'move', pantryItems = [], today = WEEK, afterChange }) {
  const [changed, setChanged] = useState(false);
  const [closed, setClosed] = useState(false);
  return <StrictMode><p role="status">{changed ? '부모 화면 갱신됨' : '부모 화면 유지'}</p>
    {closed ? <p>변경 창이 닫힘</p> : <MealPlanChangePanel {...{ scope, kind, pantryItems, today }} weekStart={WEEK} slotId={SLOT}
      onChanged={async () => { setChanged(true); await afterChange?.(); }} onClose={() => setClosed(true)} />}</StrictMode>;
}
async function showPreview() {
  fireEvent.change(screen.getByLabelText('옮길 날짜'), { target: { value: '2026-09-23' } });
  fireEvent.click(screen.getByRole('button', { name: '변경안 미리보기' }));
  await screen.findByRole('button', { name: '변경안 확정' });
}

describe('MealPlanChangePanel user approval and stale results', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    previewMealPlanChange.mockImplementation(async input => ({ ...preview(input.scope), request: input }));
    confirmMealPlanChange.mockResolvedValue({ records: [], weekStarts: [WEEK] });
  });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it.each([true, false])('announces a completed comparison (canApply=%s) without moving focus', async canApply => {
    const gate = deferred(); previewMealPlanChange.mockReturnValueOnce(gate.promise);
    render(<Harness />);
    fireEvent.change(screen.getByLabelText('옮길 날짜'), { target: { value: '2026-09-23' } });
    fireEvent.click(screen.getByRole('button', { name: '변경안 미리보기' }));
    const close = screen.getByRole('button', { name: '변경 창 닫기' }); close.focus();
    await act(async () => gate.resolve({ ...preview(), canApply }));
    const panel = within(screen.getByRole('region', { name: '식단 변경 미리보기' }));
    expect(panel.getByRole('status')).toHaveTextContent(canApply ? '변경안이 준비됐어요' : '적용할 변경안이 없어요');
    expect(close).toHaveFocus(); expect(confirmMealPlanChange).not.toHaveBeenCalled();
  });

  it('qualifies computed shortages when ownership is unknown without changing amounts or accessible list names', async () => {
    const now = `${WEEK}T09:00:00.000Z`;
    const plan = generateMealPlan({ weekStart: WEEK, now,
      preferences: { servings: 1, excludedIngredients: [], dinnerDays: [0] } });
    const component = plan.slots[0].components[0];
    // Test-only measured menu; no production recipe review is implied.
    plan.slots[0].components = [{ ...component, servings: 1, servingsStatus: 'verified',
      source: { kind: 'test-fixture', id: 'fixture:recipe', name: '테스트 전용' }, recipeVersion: 'fixture-v1',
      ingredients: [{ ...component.ingredients[0], id: 'fixture:chicken', rawName: '닭고기',
        ingredientKey: 'food:닭고기', preparationState: 'raw', amount: 200, unit: 'g',
        quantityStatus: 'verified', quantityEvidence: 'fixture:200g', optional: false, selected: true }],
    }];
    const moved = moveMealPlanSlot({ sourcePlan: plan, sourceSlotId: SLOT,
      targetSlotId: '2026-09-23:dinner', mode: 'move', today: WEEK, now });
    const inventory = [];
    const comparison = { ...preview(), changes: moved.changes, plans: moved.plans,
      beforeAllocation: allocateMealPlanInventory({ scope: 'guest', confirmedPlans: [plan], inventory, today: WEEK }),
      afterAllocation: allocateMealPlanInventory({ scope: 'guest', confirmedPlans: moved.plans, inventory, today: WEEK }) };
    const before = structuredClone(comparison);
    previewMealPlanChange.mockResolvedValue(comparison);
    render(<Harness />);
    await showPreview();

    for (const label of ['변경 전 전체 장보기', '변경 후 전체 장보기']) {
      expect(screen.getByRole('list', { name: `${label} 부족분` })).toHaveTextContent('닭고기 200g');
      expect.soft(screen.getByRole('region', { name: label })).toHaveTextContent('등록된 재고 기준 추가 필요량');
    }
    expect.soft(screen.queryByText(/미등록 재료는.*구매 또는 보유 확인 필요/)).toBeInTheDocument();
    expect(comparison).toStrictEqual(before);
    expect(inventory).toEqual([]);
    expect(confirmMealPlanChange).not.toHaveBeenCalled();
  });

  it('drops yesterday’s comparison and swap choice when the local day changes', async () => {
    const view = render(<Harness />);
    await showPreview();
    view.rerender(<Harness today="2026-09-22" />);
    expect(screen.queryByRole('button', { name: '변경안 확정' })).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: '두 메뉴 날짜 바꾸기' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('옮길 날짜')).toHaveAttribute('min', '2026-09-22');
    expect(screen.getByLabelText('옮길 날짜')).toHaveValue('');
    expect(confirmMealPlanChange).not.toHaveBeenCalled();
  });

  it('still refreshes an acknowledged write when midnight invalidates its comparison', async () => {
    const saving = deferred();
    confirmMealPlanChange.mockReturnValue(saving.promise);
    const view = render(<Harness />);
    await showPreview();
    fireEvent.click(screen.getByRole('button', { name: '변경안 확정' }));
    view.rerender(<Harness today="2026-09-22" />);
    expect(screen.getByRole('button', { name: '변경 창 닫기' })).toBeDisabled();
    await act(async () => { saving.resolve({ records: [], weekStarts: [WEEK] }); });
    expect(screen.getByText('부모 화면 갱신됨')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '변경안 확정' })).not.toBeInTheDocument();
    expect(confirmMealPlanChange).toHaveBeenCalledTimes(1);
  });

  it('shows a read-only menu and quantity comparison without saving until approval', async () => {
    render(<Harness />);
    expect(screen.getByRole('region', { name: '식단 변경 미리보기' })).toBeInTheDocument();
    expect(previewMealPlanChange).not.toHaveBeenCalled();
    await showPreview();
    const monday = within(screen.getByRole('article', { name: `${WEEK} 변경 비교` }));
    expect(monday.getByRole('region', { name: '변경 전 메뉴' })).toHaveTextContent('닭고기 한 끼');
    expect(monday.getByRole('region', { name: '변경 후 메뉴' })).toHaveTextContent('외식·건너뜀');
    expect(monday.getByRole('region', { name: '변경 전 메뉴' })).toHaveTextContent('닭고기 200g');
    const before = screen.getByRole('region', { name: '변경 전 전체 장보기' });
    const after = screen.getByRole('region', { name: '변경 후 전체 장보기' });
    expect(before).toHaveTextContent('닭고기 100g');
    expect(after).toHaveTextContent('기한');
    expect(after).toHaveTextContent('확인 필요');
    expect(after).not.toHaveTextContent('부족분이 없어요');
    expect(confirmMealPlanChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '변경 창 닫기' }));
    expect(screen.getByText('변경 창이 닫힘')).toBeInTheDocument();
    expect(confirmMealPlanChange).not.toHaveBeenCalled();
  });

  it('confirms the reviewed comparison only once and announces success after acknowledgement', async () => {
    const saving = deferred(); confirmMealPlanChange.mockReturnValue(saving.promise);
    render(<Harness />); await showPreview();
    const confirm = screen.getByRole('button', { name: '변경안 확정' });
    fireEvent.click(confirm); fireEvent.click(confirm);
    expect(screen.queryByText('변경안을 확정했어요.')).not.toBeInTheDocument();
    expect(screen.getByText('부모 화면 유지')).toBeInTheDocument();
    expect(confirm).toBeDisabled();
    expect(confirmMealPlanChange).toHaveBeenCalledTimes(1);
    await act(async () => { saving.resolve({ records: [], weekStarts: [WEEK] }); });
    expect(await screen.findByText('변경안을 확정했어요.')).toBeInTheDocument();
    expect(screen.getByText('부모 화면 갱신됨')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '변경안 확정' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '식단 변경 미리보기' })).toHaveFocus();
  });

  it('invalidates a reviewed move after the user edits its destination or movement mode', async () => {
    render(<Harness />); await showPreview();
    fireEvent.change(screen.getByLabelText('옮길 날짜'), { target: { value: '2026-09-24' } });
    expect(screen.queryByRole('button', { name: '변경안 확정' })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('이동 방식'), { target: { value: 'swap' } });
    fireEvent.click(screen.getByRole('button', { name: '변경안 미리보기' }));
    await screen.findByRole('button', { name: '변경안 확정' });
    expect(previewMealPlanChange).toHaveBeenLastCalledWith({ scope: 'guest', weekStart: WEEK, kind: 'move',
      slotId: SLOT, targetDate: '2026-09-24', mode: 'swap', pantryItems: [] });
    expect(confirmMealPlanChange).not.toHaveBeenCalled();
  });

  it('requires a new comparison after focus and ignores an older delayed preview', async () => {
    const old = deferred(); previewMealPlanChange.mockReturnValueOnce(old.promise);
    render(<Harness />);
    fireEvent.change(screen.getByLabelText('옮길 날짜'), { target: { value: '2026-09-23' } });
    fireEvent.click(screen.getByRole('button', { name: '변경안 미리보기' }));
    fireEvent.focus(window);
    expect(screen.getByRole('button', { name: '변경안 미리보기' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: '변경안 미리보기' }));
    await screen.findByRole('button', { name: '변경안 확정' });
    await act(async () => { old.resolve({ ...preview(), notices: ['이전 응답 노출 금지'] }); });
    expect(screen.queryByText('이전 응답 노출 금지')).not.toBeInTheDocument();
    fireEvent.focus(window);
    expect(screen.queryByRole('button', { name: '변경안 확정' })).not.toBeInTheDocument();
    expect(screen.getByText(/다시 미리보기/)).toBeInTheDocument();
  });

  it('hides prior-account results and ignores its late successful save callback', async () => {
    const saving = deferred(); confirmMealPlanChange.mockReturnValue(saving.promise);
    const view = render(<Harness />); await showPreview();
    fireEvent.click(screen.getByRole('button', { name: '변경안 확정' }));
    view.rerender(<Harness scope="user:alice" />);
    expect(screen.queryByRole('article', { name: `${WEEK} 변경 비교` })).not.toBeInTheDocument();
    await act(async () => { saving.resolve({ records: [], weekStarts: [WEEK] }); });
    expect(screen.getByText('부모 화면 유지')).toBeInTheDocument();
    expect(screen.queryByText('변경안을 확정했어요.')).not.toBeInTheDocument();
    expect(screen.getByLabelText('옮길 날짜')).toHaveValue('');
  });

  it('refreshes the parent after a committed save even when focus discarded the preview', async () => {
    const saving = deferred(); confirmMealPlanChange.mockReturnValue(saving.promise);
    render(<Harness />); await showPreview();
    fireEvent.click(screen.getByRole('button', { name: '변경안 확정' }));
    fireEvent.focus(window);
    await act(async () => { saving.resolve({ records: [], weekStarts: [WEEK] }); });
    expect(await screen.findByText('부모 화면 갱신됨')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '변경안 확정' })).not.toBeInTheDocument();
    expect(screen.queryByText('변경안을 확정했어요.')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '변경안 미리보기' })).toBeEnabled();
  });

  it('does not offer the committed preview again when the parent refresh fails', async () => {
    render(<Harness afterChange={async () => { throw new Error('refresh offline'); }} />); await showPreview();
    fireEvent.click(screen.getByRole('button', { name: '변경안 확정' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('저장은 완료');
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(screen.queryByRole('button', { name: '변경안 확정' })).not.toBeInTheDocument();
    expect(screen.queryByText('변경안을 확정했어요.')).not.toBeInTheDocument();
  });

  it('keeps a failed confirmation visible without claiming success and requires a fresh comparison', async () => {
    confirmMealPlanChange.mockRejectedValue(new Error('다른 화면에서 재고가 변경됐어요.'));
    render(<Harness />); await showPreview();
    fireEvent.click(screen.getByRole('button', { name: '변경안 확정' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('재고가 변경');
    expect(screen.getByText('부모 화면 유지')).toBeInTheDocument();
    expect(screen.queryByText('변경안을 확정했어요.')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '변경안 확정' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '변경안 미리보기' })).toBeEnabled();
  });

  it('shows an unavailable readjustment without giving approval or moving controls', async () => {
    previewMealPlanChange.mockResolvedValue({ ...preview(), canApply: false, changes: [], notices: ['조건에 맞는 새 메뉴가 없어 기존 식단을 유지해요.'] });
    render(<Harness kind="readjust" />);
    expect(screen.queryByLabelText('옮길 날짜')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '변경안 미리보기' }));
    expect(await screen.findByText('조건에 맞는 새 메뉴가 없어 기존 식단을 유지해요.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '변경안 확정' })).not.toBeInTheDocument();
    expect(confirmMealPlanChange).not.toHaveBeenCalled();
  });

  it('invalidates the comparison immediately when pantry inputs change', async () => {
    const view = render(<Harness pantryItems={['소금']} />); await showPreview();
    view.rerender(<Harness pantryItems={['소금', '후추']} />);
    expect(screen.queryByRole('button', { name: '변경안 확정' })).not.toBeInTheDocument();
    expect(screen.queryByRole('article', { name: `${WEEK} 변경 비교` })).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: '변경안 미리보기' })).toBeDisabled());
  });

  it('refreshes the same account after pantry changes replace a panel with a pending committed write', async () => {
    const saving = deferred(); confirmMealPlanChange.mockReturnValue(saving.promise);
    const view = render(<Harness pantryItems={['소금']} />); await showPreview();
    fireEvent.click(screen.getByRole('button', { name: '변경안 확정' }));
    view.rerender(<Harness pantryItems={['소금', '후추']} />);
    expect(screen.queryByRole('button', { name: '변경안 확정' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('옮길 날짜')).toBeDisabled();
    expect(screen.getByRole('button', { name: '변경안 미리보기' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '변경 창 닫기' })).toBeDisabled();
    await act(async () => { saving.resolve({ records: [], weekStarts: [WEEK] }); });
    expect(screen.getByText('부모 화면 갱신됨')).toBeInTheDocument();
    expect(screen.queryByText('변경안을 확정했어요.')).not.toBeInTheDocument();
  });

  it('discards a delayed old-pantry preview and permits a fresh comparison of the new inputs', async () => {
    const old = deferred(); previewMealPlanChange.mockReturnValueOnce(old.promise);
    const view = render(<Harness pantryItems={['소금']} />);
    fireEvent.change(screen.getByLabelText('옮길 날짜'), { target: { value: '2026-09-23' } });
    fireEvent.click(screen.getByRole('button', { name: '변경안 미리보기' }));
    view.rerender(<Harness pantryItems={['소금', '후추']} />);
    await showPreview();
    await act(async () => { old.resolve({ ...preview(), notices: ['이전 팬트리 응답'] }); });
    expect(screen.queryByText('이전 팬트리 응답')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '변경안 확정' })).toBeEnabled();
    expect(previewMealPlanChange).toHaveBeenLastCalledWith(expect.objectContaining({ pantryItems: ['소금', '후추'] }));
  });

  it('keeps a reviewed proposal when only the pantry array reference changes', async () => {
    const view = render(<Harness pantryItems={['소금']} />); await showPreview();
    view.rerender(<Harness pantryItems={['소금']} />);
    expect(screen.getByRole('button', { name: '변경안 확정' })).toBeEnabled();
    expect(screen.getByLabelText('옮길 날짜')).toHaveValue('2026-09-23');
  });

  it('does not resurrect an old comparison when changed pantry contents return to their earlier value', async () => {
    const view = render(<Harness pantryItems={['소금']} />); await showPreview();
    view.rerender(<Harness pantryItems={['소금', '후추']} />);
    view.rerender(<Harness pantryItems={['소금']} />);
    expect(screen.queryByRole('button', { name: '변경안 확정' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('옮길 날짜')).toHaveValue('');
  });
});
