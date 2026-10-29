import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import IngredientsPage from '../../pages/IngredientsPage';
import MealPlanPage from '../../pages/MealPlanPage';
import * as authHook from '../../hooks/useAuth';
import * as ingredientsHook from '../../hooks/useIngredients';
import * as pantryHook from '../../hooks/usePantryStaples';
import * as mealRepository from '../../features/mealPlans/mealPlanRepository';
import * as shoppingRepository from '../../features/shopping/shoppingRepository';

beforeEach(() => {
  vi.spyOn(authHook, 'useAuth').mockReturnValue({ storageScope: 'user:alice', loading: false });
  vi.spyOn(ingredientsHook, 'useIngredients').mockReturnValue({ ingredients: [], loading: false, error: '', removeIngredient: vi.fn(), updateIngredient: vi.fn() });
  vi.spyOn(pantryHook, 'usePantryStaples').mockReturnValue({ pantryStaples: [], pantryOwnership: {} });
  vi.spyOn(mealRepository, 'getMealPlan').mockResolvedValue(null);
  vi.spyOn(shoppingRepository, 'getShoppingWorkspace').mockResolvedValue({ scope: 'user:alice', manualItems: [], purchaseNotes: [], receipts: [], sources: [], checkedAt: '2026-09-16' });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('shopping notes page connections', () => {
  it.each([['재료 관리', IngredientsPage], ['주간 식단', MealPlanPage]])('%s opens the current account shopping notes without changing legacy lists', async (_, Page) => {
    render(<MemoryRouter><Page /></MemoryRouter>);
    await waitFor(() => expect(screen.getByRole('button', { name: '장보기 메모 열기' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: '장보기 메모 열기' }));
    expect(await screen.findByRole('form', { name: '수동 장보기 추가' })).toBeInTheDocument();
    expect(shoppingRepository.getShoppingWorkspace).toHaveBeenCalledWith('user:alice', expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/));
    expect(screen.getByText(/체크.*구매 메모.*재고.*반영하지/)).toBeInTheDocument();
  });

  it('closes the ingredients page form when the ingredient source changes', async () => {
    const view = render(<MemoryRouter><IngredientsPage /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: '장보기 메모 열기' }));
    await screen.findByRole('form', { name: '수동 장보기 추가' });
    vi.mocked(ingredientsHook.useIngredients).mockReturnValue({ ingredients: [{ id: 'rice', name: '밥', quantity: '1공기', consumed: true }], loading: false, error: '', removeIngredient: vi.fn(), updateIngredient: vi.fn() });
    view.rerender(<MemoryRouter><IngredientsPage /></MemoryRouter>);
    expect(screen.queryByRole('form', { name: '수동 장보기 추가' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '장보기 메모 열기' })).toBeEnabled();
  });
});
