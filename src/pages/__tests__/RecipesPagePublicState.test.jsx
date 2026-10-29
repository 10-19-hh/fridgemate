import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import RecipesPage from '../RecipesPage';
import { pantryStaples } from '../../data/pantryStaples';
import { useRecipesPageModel } from '../../hooks/useRecipesPageModel';

const { cyclePantryStatus, trackEvent } = vi.hoisted(() => ({ cyclePantryStatus: vi.fn(), trackEvent: vi.fn() }));
vi.mock('../../hooks/useRecipesPageModel', () => ({ useRecipesPageModel: vi.fn() }));
vi.mock('../../hooks/useAnalytics', () => ({ useAnalytics: () => ({ trackEvent }) }));
vi.mock('../../hooks/useDBRecommendations', () => ({
  useDBRecommendations: () => ({ recommendations: [], loading: false, hidden: false, needsLogin: true, mode: 'rule' })
}));

let model;

beforeEach(() => {
  vi.clearAllMocks();
  model = {
    pantryStaples, pantryOwnership: {}, pantrySummary: { owned: 0, missing: 0, unknown: pantryStaples.length },
    cyclePantryStatus, ownedPantryItems: [], ownedPantryCount: 0,
    loading: false, ingredients: [], activeIngredientCount: 0, summary: { expiringSoon: 0 },
    missingBasicIngredients: [], localRecommendations: [], readyRecommendations: [], buyOneRecommendations: [], useSoonRecommendations: [],
    fridgeInsight: '', sectionStats: {}
  };
  vi.mocked(useRecipesPageModel).mockImplementation(() => model);
});

afterEach(cleanup);

describe('RecipesPage public state', () => {
  it('keeps public exploration first and allows pantry setup without registering fridge ingredients', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter initialEntries={['/recipes']}><RecipesPage /></MemoryRouter>);

    expect(screen.getByRole('heading', { name: '남은 재료를 골라 조리법까지 살펴보세요' })).toBeInTheDocument();
    const explorer = screen.getByRole('region', { name: '남은 재료로 무엇을 만들까요?' });
    const summary = screen.getByText('보유 양념 설정 · 0개 보유');
    expect(explorer.compareDocumentPosition(summary) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(summary.closest('details')).not.toHaveAttribute('open');

    await user.click(summary);
    await user.click(screen.getByRole('button', { name: /^소금\s*모름$/u }));
    expect(cyclePantryStatus).toHaveBeenCalledWith('salt');
    expect(screen.queryByRole('heading', { name: '서버 카탈로그 추천' })).not.toBeInTheDocument();
  });

  it('lets pantry-only users change an existing ownership setting', async () => {
    const user = userEvent.setup();
    model.pantryOwnership = { salt: 'owned' };
    model.pantrySummary = { owned: 1, missing: 0, unknown: pantryStaples.length - 1 };
    model.ownedPantryItems = ['소금'];
    model.ownedPantryCount = 1;
    render(<MemoryRouter initialEntries={['/recipes']}><RecipesPage /></MemoryRouter>);

    await user.click(screen.getByText('보유 양념 설정 · 1개 보유'));
    await user.click(screen.getByRole('button', { name: /^소금\s*보유$/u }));
    expect(cyclePantryStatus).toHaveBeenCalledWith('salt');
    expect(screen.getByRole('region', { name: '남은 재료로 무엇을 만들까요?' })).toBeInTheDocument();
  });

  it('labels unreadable pantry settings as needing confirmation before the panel is opened', async () => {
    const user = userEvent.setup();
    const reloadPantryOwnership = vi.fn();
    model.pantryStorageReady = false;
    model.pantryError = '이 기기의 팬트리 설정을 불러오지 못했어요.';
    model.reloadPantryOwnership = reloadPantryOwnership;
    render(<MemoryRouter initialEntries={['/recipes']}><RecipesPage /></MemoryRouter>);

    const summary = screen.getByText('보유 양념 설정 · 확인 필요');
    expect(summary.closest('details')).not.toHaveAttribute('open');
    expect(screen.queryByText('보유 양념 설정 · 0개 보유')).not.toBeInTheDocument();
    await user.click(summary);
    expect(screen.getByRole('alert')).toHaveTextContent(model.pantryError);
    expect(screen.getByRole('button', { name: /^소금\s*모름$/u })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: '팬트리 설정 다시 확인' }));
    expect(reloadPantryOwnership).toHaveBeenCalledOnce();
  });
});
