import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import PublicRecipePage from '../PublicRecipePage';
import RecipesPage from '../RecipesPage';
import { AuthProvider } from '../../hooks/useAuth';
import { IngredientsProvider, useIngredients } from '../../hooks/useIngredients';
import { getAllIngredients, replaceIngredients } from '../../db/indexedDB';
import { getScopeState } from '../../features/ingredients/ingredientsScopeState';
import { getPublicRecipePath, publicRecipeCatalog } from '../../features/recipes/publicRecipeCatalog';
import RecipeQuantityProvider from '../../features/recipes/RecipeQuantityProvider';
import { useRecipeQuantitySession } from '../../hooks/useRecipeQuantitySession';
import { useLocalRecommendations } from '../../hooks/useLocalRecommendations';
import { PantryStaplesProvider } from '../../hooks/usePantryStaples';
import { MenuDecisionProvider } from '../../hooks/useMenuDecision';
import { UserPreferencesProvider } from '../../hooks/useUserPreferences';

const STOCK = [
  { id: 'chives', name: '조선부추', quantity: '50g', consumed: false, updatedAt: '2026-09-15T01:00:00Z' },
  { id: 'shopping', name: '우유', quantity: '2개', memo: '직접 쓴 장보기', consumed: true, updatedAt: '2026-09-15T01:00:00Z' },
];

function InventoryChangeControl() {
  const { ingredients, updateIngredient } = useIngredients();
  return <button onClick={() => updateIngredient({ ...ingredients.find((item) => item.id === 'chives'), quantity: '20g' })}>재고 변경 테스트</button>;
}

let currentRecommendations = [];
function QuantitySessionProbe() {
  const session = useRecipeQuantitySession();
  const { recommendations } = useLocalRecommendations();
  useEffect(() => { currentRecommendations = recommendations; }, [recommendations]);
  return <>
    <output aria-label="확인된 레시피 수">{Object.keys(session?.confirmations ?? {}).length}</output>
    <Link to="/test-list">목록 화면 테스트</Link>
    <Link to="/recipes/29-부추-콩가루-찜">미리보기 화면 테스트</Link>
  </>;
}

function page(path = '/recipes/29-부추-콩가루-찜') {
  return (
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider><UserPreferencesProvider><MenuDecisionProvider><PantryStaplesProvider><IngredientsProvider><RecipeQuantityProvider>
        <InventoryChangeControl />
        <QuantitySessionProbe />
        <Routes><Route path="/recipes/:recipeSlug" element={<PublicRecipePage />} /><Route path="/test-list" element={<p>목록</p>} /><Route path="/recipes" element={<RecipesPage />} /></Routes>
      </RecipeQuantityProvider></IngredientsProvider></PantryStaplesProvider></MenuDecisionProvider></UserPreferencesProvider></AuthProvider>
    </MemoryRouter>
  );
}

describe('public recipe quantity preview integration', () => {
  beforeEach(async () => {
    localStorage.clear();
    const cache = getScopeState('guest');
    cache.items = [];
    cache.loaded = false;
    cache.promise = null;
    await replaceIngredients(STOCK, 'guest');
  });
  afterEach(cleanup);

  it('connects actual recommendation cards and separate quantity counts, without claiming all ingredients are ready', async () => {
    render(page());
    fireEvent.change(await screen.findByLabelText('조선부추 사용 가능량 (g)'), { target: { value: '0.4' } });
    fireEvent.change(screen.getByLabelText('날콩가루 사용 가능량 (g)'), { target: { value: '7' } });
    fireEvent.click(screen.getByRole('button', { name: '확인한 양으로 계산' }));
    fireEvent.click(screen.getByRole('link', { name: '추천 목록에서 보기' }));
    const counts = await screen.findByRole('region', { name: '분량 확인 상태' });
    expect(within(counts).getByText('필수 재료량 확인 0개')).toBeVisible();
    expect(within(counts).getByText('추가 확인 필요 1개')).toBeVisible();
    const summary = screen.getByRole('region', { name: '확인한 분량' });
    expect(within(summary).getAllByText('1g 미만')).toHaveLength(2);
    expect(within(summary).getByText('참깨: 확인 필요')).toBeVisible();
    const card = summary.closest('article');
    expect(within(card).queryByText('재료 종류 일치')).not.toBeInTheDocument();
    expect(within(card).getByRole('link', { name: '분량 확인하기' })).toHaveAttribute('href', '/recipes/29-부추-콩가루-찜');
    fireEvent(window, new Event('blur'));
    expect(within(screen.getByRole('region', { name: '확인한 분량' })).getByText('수량 확인 필요')).toBeVisible();
    expect(screen.queryByText('본재료 축소 가능')).not.toBeInTheDocument();
  });

  it('shares an explicit confirmation across real routes and restores inputs, without a persistent write', async () => {
    render(page());
    fireEvent.change(await screen.findByLabelText('조선부추 사용 가능량 (g)'), { target: { value: '25' } });
    fireEvent.change(screen.getByLabelText('날콩가루 사용 가능량 (g)'), { target: { value: '7' } });
    fireEvent.click(screen.getByRole('button', { name: '확인한 양으로 계산' }));
    expect(screen.getByLabelText('확인된 레시피 수')).toHaveTextContent('1');
    expect(currentRecommendations.find((recipe) => recipe.id === 'mfds:29')?.quantityResult?.scaleFactor).toBe(0.5);
    fireEvent.click(screen.getByRole('link', { name: '목록 화면 테스트' }));
    expect(screen.getByLabelText('확인된 레시피 수')).toHaveTextContent('1');
    fireEvent.click(screen.getByRole('link', { name: '미리보기 화면 테스트' }));
    expect(await screen.findByLabelText('조선부추 사용 가능량 (g)')).toHaveValue('25');
    expect(within(screen.getByRole('region', { name: '분량 미리보기 결과' })).getByText('25g')).toBeVisible();
    fireEvent(window, new Event('blur'));
    expect(screen.getByLabelText('확인된 레시피 수')).toHaveTextContent('0');
    expect(currentRecommendations.find((recipe) => recipe.id === 'mfds:29')?.quantityResult).toBeFalsy();
    expect(await getAllIngredients('guest')).toEqual(STOCK);
  });

  it('connects reviewed quantities without pre-confirming strings or changing original content and shopping', async () => {
    render(page());
    const chives = await screen.findByLabelText('조선부추 사용 가능량 (g)');
    expect(chives).toHaveValue('');
    const sourceIngredient = screen.getAllByText(/\[1인분\]조선부추 50g/).map((node) => node.textContent).join('|');
    const nutrition = screen.getByRole('heading', { name: '식약처 제공 영양성분' }).closest('section').textContent;
    fireEvent.change(chives, { target: { value: '25' } });
    fireEvent.change(screen.getByLabelText('날콩가루 사용 가능량 (g)'), { target: { value: '7' } });
    fireEvent.click(screen.getByRole('button', { name: '확인한 양으로 계산' }));
    const result = await screen.findByRole('region', { name: '분량 미리보기 결과' });
    expect(within(result).getByText('25g')).toBeInTheDocument();
    expect(within(result).getByText('약 3g')).toBeInTheDocument();
    expect(within(result).queryByText('3.5g')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '확인한 양으로 계산' }));
    expect(await getAllIngredients('guest')).toEqual(STOCK);
    expect(screen.getAllByText(/\[1인분\]조선부추 50g/).map((node) => node.textContent).join('|')).toBe(sourceIngredient);
    expect(screen.getByRole('heading', { name: '식약처 제공 영양성분' }).closest('section').textContent).toBe(nutrition);
  });

  it('invalidates confirmed quantities when the real inventory provider changes', async () => {
    render(page());
    fireEvent.change(await screen.findByLabelText('조선부추 사용 가능량 (g)'), { target: { value: '25' } });
    fireEvent.change(screen.getByLabelText('날콩가루 사용 가능량 (g)'), { target: { value: '7' } });
    fireEvent.click(screen.getByRole('button', { name: '확인한 양으로 계산' }));
    expect(await screen.findByRole('region', { name: '분량 미리보기 결과' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '재고 변경 테스트' }));
    await waitFor(() => expect(screen.queryByRole('region', { name: '분량 미리보기 결과' })).not.toBeInTheDocument());
    expect(screen.getByLabelText('조선부추 사용 가능량 (g)')).toHaveValue('');
    await waitFor(async () => expect((await getAllIngredients('guest')).find((item) => item.id === 'chives').quantity).toBe('20g'));
  });

  it('keeps unreviewed recipe details on the original path without scaling fields', () => {
    const recipe = publicRecipeCatalog.find((item) => item.externalId !== '29');
    render(page(getPublicRecipePath(recipe)));
    expect(screen.getByRole('heading', { level: 1, name: recipe.name })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '식약처 제공 영양성분' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: '이번 요리에 쓸 양으로 계산' })).not.toBeInTheDocument();
  });
});
import { useEffect } from 'react';
