import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import MealCookingForm from '../MealCookingForm';
import { createInventoryQuantityReview, projectInventoryQuantity } from '../../features/mealPlans/inventoryQuantityDomain';

const NOW = '2026-09-21T09:00:00.000Z';
const meal = () => ({ id: '2026-09-21:dinner', date: '2026-09-21', title: '닭고기 저녁', servings: 1, components: [{
  id: 'dish', source: { id: 'fixture' }, recipeVersion: '1', servings: 1, servingsStatus: 'verified', ingredients: [{
    id: 'chicken', rawName: '닭고기', ingredientKey: 'food:닭고기', amount: 200, unit: 'g', preparationState: 'raw',
    quantityStatus: 'verified', quantityEvidence: 'fixture:200g', optional: false, selected: true,
  }], processInputs: [],
}] });
function batch(id = 'chicken') {
  const ingredient = { id, name: '닭고기', quantity: '300g', consumed: false, expiryDate: '2026-09-30', storageType: '냉장', updatedAt: NOW };
  return projectInventoryQuantity(ingredient, createInventoryQuantityReview({ ingredient, scope: 'guest', revision: 2, now: NOW,
    values: { name: '닭고기', amount: 300, unit: 'g', preparationState: 'raw' } }), 'guest');
}
const amount = () => screen.getByLabelText('닭고기 (1번 재고) 실제 사용량 (g)');
const confirm = () => fireEvent.click(screen.getByLabelText('실제로 쓴 재고를 모두 확인했어요'));
const save = () => fireEvent.click(screen.getByRole('button', { name: '실제 사용량으로 조리 기록' }));
afterEach(cleanup);

describe('MealCookingForm actual-use confirmation', () => {
  it('identifies and focuses only the invalid same-name inventory row and connects its error', async () => {
    const onRecord = vi.fn();
    render(<MealCookingForm slot={meal()} inventory={[batch('one'), batch('two')]} onRecord={onRecord} onClose={() => {}} />);
    const second = screen.getByLabelText('닭고기 (2번 재고) 실제 사용량 (g)');
    fireEvent.change(amount(), { target: { value: '100' } });
    fireEvent.change(second, { target: { value: '301' } }); confirm(); save();
    const error = await screen.findByRole('alert');
    expect.soft(error).toHaveTextContent('2번 재고');
    expect.soft(second).toHaveFocus();
    expect.soft(second).toHaveAttribute('aria-invalid', 'true');
    expect.soft(second).toHaveAccessibleDescription(expect.stringContaining(error.textContent));
    expect(amount()).not.toHaveAttribute('aria-invalid', 'true');
    expect(second).toHaveValue(301); expect(onRecord).not.toHaveBeenCalled();
    fireEvent.change(second, { target: { value: '50' } });
    expect(second).not.toHaveAttribute('aria-invalid', 'true');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('focuses and describes the explicit usage confirmation when it is missing', async () => {
    render(<MealCookingForm slot={meal()} inventory={[batch()]} onRecord={vi.fn()} onClose={() => {}} />);
    save();
    const error = await screen.findByRole('alert');
    const checkbox = screen.getByLabelText('실제로 쓴 재고를 모두 확인했어요');
    expect.soft(checkbox).toHaveFocus();
    expect.soft(checkbox).toHaveAttribute('aria-invalid', 'true');
    expect.soft(checkbox).toHaveAccessibleDescription(error.textContent);
  });

  it('shows proposed amounts but only records after explicit actual-use confirmation', async () => {
    const inventory = [batch()]; const onRecord = vi.fn().mockResolvedValue(true);
    render(<MealCookingForm slot={meal()} inventory={inventory} onRecord={onRecord} onClose={() => {}} />);
    expect(screen.getByRole('form', { name: '조리 사용량 · 닭고기 저녁' })).toBeInTheDocument();
    expect(amount()).toHaveValue(200);
    expect(onRecord).not.toHaveBeenCalled();
    fireEvent.change(amount(), { target: { value: '150' } });
    save();
    expect(onRecord).not.toHaveBeenCalled();
    expect(await screen.findByRole('alert')).toHaveTextContent('모두 확인');
    confirm(); save();
    await waitFor(() => expect(onRecord).toHaveBeenCalledWith({ usageMode: 'measured', completeUsageConfirmed: true,
      usages: [{ ingredientId: 'chicken', amount: 150, unit: 'g', expectedRevision: 2, expectedSourceToken: inventory[0].sourceToken }] }));
  });

  it('records unknown use separately without treating prefilled planned amounts as actual consumption', async () => {
    const onRecord = vi.fn().mockResolvedValue(true);
    render(<MealCookingForm slot={meal()} inventory={[batch()]} onRecord={onRecord} onClose={() => {}} />);
    expect(screen.getByText(/관련 재고.*확인 필요/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '사용량 없이 조리만 기록' }));
    await waitFor(() => expect(onRecord).toHaveBeenCalledWith({ usageMode: 'unknown', completeUsageConfirmed: false, usages: [] }));
  });

  it('shows original unresolved and process labels without prefilled partial quantities', () => {
    const slot = meal();
    slot.components[0].ingredients.push({ ...slot.components[0].ingredients[0], id: 'sauce', rawName: '소스용 닭고기', amount: null, quantityStatus: 'unverified' });
    slot.components[0].processInputs = [{ id: 'water', name: '데치는 물', ingredientKey: 'food:물', amount: null, unit: null }];
    render(<MealCookingForm slot={slot} inventory={[batch()]} onRecord={() => {}} onClose={() => {}} />);
    expect(screen.getByText(/알려진 부분 200g/)).toBeInTheDocument();
    expect(screen.getByText(/소스용 닭고기.*양 확인 필요/)).toBeInTheDocument();
    expect(screen.getByText(/데치는 물.*양 확인 필요/)).toBeInTheDocument();
    expect(amount()).toHaveValue(null);
  });

  it('reports excessive actual usage while keeping entered values', async () => {
    const onRecord = vi.fn();
    render(<MealCookingForm slot={meal()} inventory={[batch()]} onRecord={onRecord} onClose={() => {}} />);
    fireEvent.change(amount(), { target: { value: '301' } }); confirm(); save();
    expect(await screen.findByRole('alert')).toHaveTextContent('남은 양');
    expect(amount()).toHaveValue(301);
    expect(onRecord).not.toHaveBeenCalled();
  });

  it('supports explicit split usage across batches without silently dividing the plan', async () => {
    const onRecord = vi.fn().mockResolvedValue(true);
    render(<MealCookingForm slot={meal()} inventory={[batch('one'), batch('two')]} onRecord={onRecord} onClose={() => {}} />);
    expect(amount()).toHaveValue(null);
    const second = screen.getByLabelText('닭고기 (2번 재고) 실제 사용량 (g)');
    expect(second).toHaveValue(null);
    fireEvent.change(amount(), { target: { value: '100' } });
    fireEvent.change(second, { target: { value: '50' } }); confirm(); save();
    await waitFor(() => expect(onRecord).toHaveBeenCalled());
    expect(onRecord.mock.calls[0][0].usages.map(item => [item.ingredientId, item.amount])).toEqual([['one', 100], ['two', 50]]);
  });

  it('blocks duplicate clicks while persistence is pending and retains rejected input without success claims', async () => {
    let reject;
    const onRecord = vi.fn(() => new Promise((_resolve, rejectPromise) => { reject = rejectPromise; }));
    render(<MealCookingForm slot={meal()} inventory={[batch()]} onRecord={onRecord} onClose={() => {}} />);
    confirm(); save(); save();
    expect(onRecord).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: '사용량 없이 조리만 기록' })).toBeDisabled();
    await act(async () => reject(new Error('private raw failure')));
    expect(await screen.findByRole('alert')).toHaveTextContent('저장 결과');
    expect(screen.queryByText(/private raw failure|저장했어요/)).not.toBeInTheDocument();
    expect(amount()).toHaveValue(200);
  });

  it('disables writes when its parent is busy', () => {
    const onRecord = vi.fn();
    render(<MealCookingForm slot={meal()} inventory={[batch()]} disabled onRecord={onRecord} onClose={() => {}} />);
    expect(amount()).toBeDisabled();
    save(); fireEvent.click(screen.getByRole('button', { name: '사용량 없이 조리만 기록' }));
    expect(onRecord).not.toHaveBeenCalled();
  });

  it('never binds entered amounts to newer inventory props and allows closing the stale form', () => {
    const slot = meal(); const inventory = [batch()]; const onRecord = vi.fn(); const onClose = vi.fn();
    const view = render(<MealCookingForm slot={slot} inventory={inventory} onRecord={onRecord} onClose={onClose} />);
    fireEvent.change(amount(), { target: { value: '150' } }); confirm();
    view.rerender(<MealCookingForm slot={slot} inventory={[{ ...inventory[0], quantityRevision: 3 }]} onRecord={onRecord} onClose={onClose} />);
    expect(screen.getByRole('alert')).toHaveTextContent('닫고 다시 열어');
    expect(screen.getByRole('button', { name: '실제 사용량으로 조리 기록' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '사용량 없이 조리만 기록' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '입력 닫기' }));
    expect(onClose).toHaveBeenCalledOnce(); expect(onRecord).not.toHaveBeenCalled();
  });

  it('keeps unknown-use recording available with no verified measured stock', () => {
    render(<MealCookingForm slot={meal()} inventory={[]} onRecord={() => {}} onClose={() => {}} />);
    expect(screen.getByText(/사용량을 입력할 확인된 재고가 없어요/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '실제 사용량으로 조리 기록' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '사용량 없이 조리만 기록' })).not.toBeDisabled();
  });
});
