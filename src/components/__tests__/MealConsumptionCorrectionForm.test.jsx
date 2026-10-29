import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import MealConsumptionCorrectionForm from '../MealConsumptionCorrectionForm';
import { createInventoryQuantityReview, projectInventoryQuantity } from '../../features/mealPlans/inventoryQuantityDomain';

const NOW = '2026-09-21T09:00:00.000Z';
const consumption = { id: 'latest', kind: 'consumption', lines: [{ inventoryId: 'chicken', name: '닭고기',
  ingredientKey: 'food:닭고기', amount: 150, unit: 'g', preparationState: 'raw' }] };
function batch(id = 'chicken') {
  const ingredient = { id, name: '닭고기', quantity: '150g', consumed: false, updatedAt: NOW };
  return projectInventoryQuantity(ingredient, createInventoryQuantityReview({ ingredient, scope: 'guest', revision: 3, now: NOW,
    values: { name: '닭고기', amount: 150, unit: 'g', preparationState: 'raw' } }), 'guest');
}
const input = () => screen.getByLabelText('닭고기 (1번 재고) 정정할 사용량 (g)');
const confirm = () => fireEvent.click(screen.getByLabelText('정정할 실제 사용량을 모두 확인했어요'));
const save = () => fireEvent.click(screen.getByRole('button', { name: '정정한 사용량으로 재고 반영' }));
function form(props = {}) { return <MealConsumptionCorrectionForm title="닭고기 저녁" consumption={consumption} inventory={[batch()]} onCorrect={vi.fn()} onClose={vi.fn()} {...props} />; }
afterEach(cleanup);

describe('actual consumption correction form', () => {
  it('identifies and focuses the invalid second same-name stock without losing entered amounts', async () => {
    const onCorrect = vi.fn(); render(form({ inventory: [batch(), batch('second')], onCorrect }));
    const second = screen.getByLabelText('닭고기 (2번 재고) 정정할 사용량 (g)');
    fireEvent.change(second, { target: { value: '151' } }); confirm(); save();
    const error = await screen.findByRole('alert');
    expect.soft(error).toHaveTextContent('2번 재고');
    expect.soft(second).toHaveFocus();
    expect.soft(second).toHaveAttribute('aria-invalid', 'true');
    expect.soft(second).toHaveAccessibleDescription(expect.stringContaining(error.textContent));
    expect(input()).not.toHaveAttribute('aria-invalid', 'true');
    expect(input()).toHaveValue(150); expect(second).toHaveValue(151); expect(onCorrect).not.toHaveBeenCalled();
    fireEvent.change(second, { target: { value: '50' } });
    expect(second).not.toHaveAttribute('aria-invalid', 'true'); expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('focuses and describes the missing explicit correction confirmation', async () => {
    render(form()); save();
    const error = await screen.findByRole('alert');
    const checkbox = screen.getByLabelText('정정할 실제 사용량을 모두 확인했어요');
    expect.soft(checkbox).toHaveFocus();
    expect.soft(checkbox).toHaveAttribute('aria-invalid', 'true');
    expect.soft(checkbox).toHaveAccessibleDescription(error.textContent);
  });

  it('shows recorded usage, previews only, and requires a fresh confirmation after edits', async () => {
    const onCorrect = vi.fn().mockResolvedValue(true); render(form({ onCorrect }));
    expect(input()).toHaveValue(150);
    expect(screen.getByRole('list', { name: '기존에 기록한 사용량' })).toHaveTextContent('닭고기 150g');
    confirm(); fireEvent.change(input(), { target: { value: '100' } }); save();
    expect(await screen.findByRole('alert')).toHaveTextContent('모두 확인');
    expect(onCorrect).not.toHaveBeenCalled();
    expect(screen.getByRole('region', { name: '정정 후 재고 미리보기' })).toHaveTextContent('150g + 150g − 100g = 200g');
    confirm(); save();
    await waitFor(() => expect(onCorrect).toHaveBeenCalledWith(expect.objectContaining({ expectedConsumptionId: 'latest', usages: [expect.objectContaining({ amount: 100 })] })));
  });

  it('blocks duplicate submissions and preserves rejected inputs for a deliberate retry', async () => {
    let reject; const onCorrect = vi.fn(() => new Promise((_resolve, fail) => { reject = fail; }));
    render(form({ onCorrect }));
    fireEvent.change(input(), { target: { value: '100' } }); confirm(); save(); save();
    expect(onCorrect).toHaveBeenCalledOnce(); expect(input()).toBeDisabled();
    expect(screen.getByRole('button', { name: '정정하지 않고 돌아가기' })).toBeDisabled();
    await act(async () => reject(new Error('private storage details')));
    expect(input()).toHaveValue(100); expect(input()).toBeEnabled();
    expect(screen.getByRole('alert')).toHaveTextContent('입력은 유지');
    expect(screen.queryByText(/private storage details/)).not.toBeInTheDocument();
    onCorrect.mockResolvedValue(true); save();
    await waitFor(() => expect(onCorrect).toHaveBeenCalledTimes(2));
  });

  it('accepts explicitly confirmed all-zero use, retaining the cooking fact', async () => {
    const onCorrect = vi.fn().mockResolvedValue(true); render(form({ onCorrect }));
    fireEvent.change(input(), { target: { value: '0' } });
    expect(screen.getByText(/모두 0이면.*조리 기록은 유지/)).toBeInTheDocument();
    confirm(); save();
    await waitFor(() => expect(onCorrect).toHaveBeenCalledWith(expect.objectContaining({ usages: [], completeUsageConfirmed: true })));
  });

  it('blocks a stale stock or consumption snapshot but allows closing without saving', () => {
    const onCorrect = vi.fn(); const onClose = vi.fn(); const inventory = [batch()];
    const view = render(form({ inventory, onCorrect, onClose }));
    view.rerender(form({ inventory, consumption: { ...consumption, id: 'newer' }, onCorrect, onClose }));
    expect(screen.getByRole('alert')).toHaveTextContent('닫고 다시 열어');
    expect(screen.getByRole('button', { name: '정정한 사용량으로 재고 반영' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '정정하지 않고 돌아가기' }));
    expect(onClose).toHaveBeenCalledOnce(); expect(onCorrect).not.toHaveBeenCalled();
  });

  it('explains unavailable original stock instead of allowing a partial correction', () => {
    render(form({ inventory: [] }));
    expect(screen.getByRole('alert')).toHaveTextContent('원래 사용한 재고');
    expect(screen.getByRole('button', { name: '정정한 사용량으로 재고 반영' })).toBeDisabled();
    expect(screen.getByRole('list', { name: '기존에 기록한 사용량' })).toHaveTextContent('닭고기 150g');
  });
});
