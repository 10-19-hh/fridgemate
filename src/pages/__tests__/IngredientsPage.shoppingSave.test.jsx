import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import IngredientsPage from '../IngredientsPage';
import * as indexedDb from '../../db/indexedDB';
import { clearScopeState } from '../../features/ingredients/ingredientsScopeState';
import * as authHook from '../../hooks/useAuth';
import { IngredientsProvider } from '../../hooks/useIngredients';

const scope = 'guest';
const originalIngredient = {
  id: 'shopping-milk',
  clientId: 'shopping-milk',
  name: '우유',
  category: '유제품',
  storageType: '냉장',
  quantity: '1통',
  purchaseDate: '2026-09-20',
  expiryDate: '2026-09-27',
  memo: '기존 메모',
  consumed: true
};

beforeEach(async () => {
  clearScopeState(scope);
  await indexedDb.clearIngredients({ scope });
  await indexedDb.saveIngredient(originalIngredient, { scope });
  vi.spyOn(authHook, 'useAuth').mockReturnValue({
    isAuthenticated: false,
    loading: false,
    storageScope: scope
  });
});

afterEach(async () => {
  cleanup();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  clearScopeState(scope);
  await indexedDb.clearIngredients({ scope });
});

describe('IngredientsPage shopping autosave', () => {
  // Swallowing the storage rejection in the page must not turn the panel's failed write into success.
  it('keeps failed shopping edits until the existing automatic retry actually saves them', async () => {
    render(<MemoryRouter><IngredientsProvider><IngredientsPage /></IngredientsProvider></MemoryRouter>);
    const quantity = await screen.findByRole('textbox', { name: '다음 구매 수량' });
    const memo = screen.getByRole('textbox', { name: '장보기 메모', exact: true });
    const saveIngredient = indexedDb.saveIngredient;
    let latestWrite;
    const save = vi.spyOn(indexedDb, 'saveIngredient')
      .mockRejectedValueOnce(new DOMException('Fixture storage is full', 'QuotaExceededError'))
      .mockImplementation((...args) => {
        latestWrite = saveIngredient(...args);
        return latestWrite;
      });

    // Control only autosave/feedback timers; fake-indexeddb keeps its real asynchronous transactions.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    fireEvent.change(quantity, { target: { value: '2통' } });
    fireEvent.change(memo, { target: { value: '작은 팩으로 구매' } });
    await act(async () => { await vi.advanceTimersByTimeAsync(450); });

    expect(save).toHaveBeenCalledExactlyOnceWith({
      ...originalIngredient, quantity: '2통', memo: '작은 팩으로 구매'
    }, { scope });
    expect(screen.queryByText('저장됨')).not.toBeInTheDocument();
    expect(screen.getByText('저장 실패')).toBeInTheDocument();
    expect(quantity).toHaveValue('2통');
    expect(memo).toHaveValue('작은 팩으로 구매');
    expect(await indexedDb.getIngredientById(originalIngredient.id, { scope })).toEqual(originalIngredient);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(450);
      await latestWrite;
    });

    expect(save).toHaveBeenCalledTimes(2);
    expect(screen.getByText('저장됨')).toBeInTheDocument();
    expect(screen.queryByText('저장 실패')).not.toBeInTheDocument();
    expect(quantity).toHaveValue('2통');
    expect(memo).toHaveValue('작은 팩으로 구매');
    expect(await indexedDb.getIngredientById(originalIngredient.id, { scope })).toEqual({
      ...originalIngredient, quantity: '2통', memo: '작은 팩으로 구매'
    });
  });
});
