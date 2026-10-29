import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import HomePage from '../HomePage';
import RecipesPage from '../RecipesPage';
import IngredientsPage from '../IngredientsPage';
import { IngredientsProvider } from '../../hooks/useIngredients';
import { PantryStaplesProvider } from '../../hooks/usePantryStaples';
import { UserPreferencesProvider } from '../../hooks/useUserPreferences';
import { MenuDecisionProvider } from '../../hooks/useMenuDecision';
import * as authHook from '../../hooks/useAuth';
import * as database from '../../db/indexedDB';
import { clearScopeState } from '../../features/ingredients/ingredientsScopeState';

const { trackEvent } = vi.hoisted(() => ({ trackEvent: vi.fn() }));
vi.mock('../../hooks/useAnalytics', () => ({ useAnalytics: () => ({ trackEvent }) }));
const original = { id: 'tofu', clientId: 'tofu', name: '두부', quantity: '1팩', category: '두부/콩',
  storageType: '냉장', purchaseDate: '2026-09-28', expiryDate: '2026-10-05', consumed: false, memo: '원래 메모' };
const readStored = database.getAllIngredients;
function renderPage(Page) {
  return render(<MemoryRouter><IngredientsProvider><PantryStaplesProvider><UserPreferencesProvider>
    <MenuDecisionProvider><Page /></MenuDecisionProvider>
  </UserPreferencesProvider></PantryStaplesProvider></IngredientsProvider></MemoryRouter>);
}
beforeEach(async () => {
  localStorage.clear(); clearScopeState('guest'); trackEvent.mockClear();
  await database.clearAccountLocalData('guest');
  await database.saveIngredient(original, 'guest');
  vi.spyOn(authHook, 'useAuth').mockReturnValue({ isAuthenticated: false, loading: false, storageScope: 'guest' });
});
afterEach(async () => {
  cleanup(); vi.restoreAllMocks(); localStorage.clear(); clearScopeState('guest');
  await database.clearAccountLocalData('guest');
});

describe('inventory unavailable is not an empty fridge', () => {
  it.each([
    { name: 'home', Page: HomePage, heading: '먼저 쓸 재료와 오늘 메뉴를 확인하세요' },
    { name: 'recipes', Page: RecipesPage, heading: '보유 재료로 만들 메뉴를 확인하세요' },
    { name: 'ingredients', Page: IngredientsPage, heading: '재료를 빠르게 찾고, 지금 쓰실 것부터 정리하세요' }
  ])('shows an honest read error on $name and restores the saved rows after retry', async ({ Page, name, heading }) => {
    const read = vi.spyOn(database, 'getAllIngredients').mockRejectedValue(new Error('PRIVATE unavailable DB'));
    renderPage(Page);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/재고를 불러오지 못/);
    expect(alert).toHaveTextContent(/비어 있는지.*확인/);
    expect(document.body.textContent).not.toContain('PRIVATE');
    expect(screen.queryByText('현재 조건에 맞는 재료가 없어요')).not.toBeInTheDocument();
    expect(screen.queryByText('보유 중 0개')).not.toBeInTheDocument();
    expect(trackEvent.mock.calls.filter(([event]) => event === 'recommendations_viewed')).toEqual([]);
    if (name !== 'ingredients') expect(screen.getByRole('region', { name: '남은 재료로 무엇을 만들까요?' })).toBeInTheDocument();
    expect(await readStored('guest')).toEqual([original]);

    read.mockRestore();
    fireEvent.click(screen.getByRole('button', { name: '재고 다시 불러오기' }));
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    expect(await screen.findByRole('heading', { level: 1, name: heading })).toBeInTheDocument();
    expect(await readStored('guest')).toEqual([original]);
    if (name === 'ingredients') expect(screen.getByRole('heading', { name: '두부' })).toBeInTheDocument();
  });

  it.each([
    { button: '삭제', method: 'deleteIngredient', failure: /삭제하지 못/ },
    { button: '소비', method: 'saveIngredient', failure: /저장하지 못/ }
  ])('shows $button failure without removing the original card and permits retry', async ({ button, method, failure }) => {
    renderPage(IngredientsPage);
    const title = await screen.findByRole('heading', { name: '두부' });
    vi.spyOn(database, method).mockRejectedValueOnce(new Error('PRIVATE write failure'));
    fireEvent.click(within(title.closest('article')).getByRole('button', { name: button, exact: true }));
    expect(await screen.findByRole('alert')).toHaveTextContent(failure);
    expect(screen.getByRole('heading', { name: '두부' })).toBeInTheDocument();
    expect(await readStored('guest')).toEqual([original]);
    expect(document.body.textContent).not.toContain('PRIVATE');
    fireEvent.click(within(screen.getByRole('heading', { name: '두부' }).closest('article')).getByRole('button', { name: button, exact: true }));
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    const saved = await readStored('guest');
    expect(saved).toEqual(button === '삭제' ? [] : [{ ...original, consumed: true }]);
  });
});
