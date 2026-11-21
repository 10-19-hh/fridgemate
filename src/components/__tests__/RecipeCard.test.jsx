import { createEvent, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import RecipeCard from '../RecipeCard';
import { calculateScaledCooking } from '../../features/recipes/scaledCooking';
import { makeAvailabilitySnapshot, makeAvailableItem, makeQuantityLine, makeQuantityRecipe } from '../../features/recipes/__tests__/fixtures/scaledCookingFixtures';

const baseRecipe = {
  title: '계란 볶음밥',
  category: '한 그릇',
  matchRate: 0.94,
  matchedIngredients: ['계란', '밥'],
  coreIngredients: ['계란', '밥', '대파'],
  matchedCount: 2,
  totalRequiredIngredients: 3,
  searchLinks: {
    manRecipe: 'https://example.com/recipe',
    youtube: 'https://example.com/video',
    naver: 'https://example.com/search'
  }
};

describe('RecipeCard', () => {
  it('hides empty missing ingredient sections', () => {
    render(<RecipeCard recipe={{ ...baseRecipe, canMakeNow: true }} />);

    expect(screen.getByText('94%')).toBeInTheDocument();
    expect(screen.getByText('계란, 밥')).toBeInTheDocument();
    expect(screen.queryByText('추가로 필요한 재료')).not.toBeInTheDocument();
  });

  it('combines missing ingredients and seasonings into one compact warning', () => {
    render(
      <RecipeCard
        recipe={{
          ...baseRecipe,
          missingIngredients: ['대파'],
          missingSeasonings: ['간장']
        }}
      />
    );

    expect(screen.getByText('추가로 필요한 재료')).toBeInTheDocument();
    expect(screen.getByText('대파')).toBeInTheDocument();
    expect(screen.getByText('양념: 간장')).toBeInTheDocument();
  });

  it('describes legacy readiness as ingredient types without claiming confirmed quantities', () => {
    render(<RecipeCard recipe={{ ...baseRecipe, canMakeNow: true }} />);
    expect(screen.getByText('재료 종류 확인됨')).toBeInTheDocument();
    expect(screen.getByText(/필요한 분량과 재료 상태는 조리법에서 확인/)).toBeInTheDocument();
    expect(screen.queryByText('바로 가능')).not.toBeInTheDocument();
  });

  it('shows real core amounts and unresolved seasonings while suppressing legacy readiness claims', () => {
    const recipe = makeQuantityRecipe({ ingredients: [
      makeQuantityLine(),
      makeQuantityLine({ id: 'onion', foodId: 'onion', rawName: '양파', amount: 100 }),
      makeQuantityLine({ id: 'soy', foodId: 'soy-sauce', rawName: '간장', amount: 10, role: 'seasoning' })
    ] });
    const quantityResult = calculateScaledCooking({ recipe, targetServings: 2, inventory: makeAvailabilitySnapshot() });
    render(<RecipeCard recipe={{
      ...baseRecipe, canMakeNow: true, reason: '필수 재료 종류를 모두 갖췄어요.',
      missingIngredients: ['돼지고기'], missingSeasonings: ['간장'], quantityResult
    }} />);

    const summary = screen.getByRole('region', { name: '확인한 분량' });
    expect(within(summary).getByText('본재료 축소 가능')).toBeInTheDocument();
    expect(within(summary).getByText('201g')).toBeInTheDocument();
    expect(within(summary).getByText('67g')).toBeInTheDocument();
    expect(within(summary).getByText('간장: 확인 필요')).toBeInTheDocument();
    expect(within(summary).getByText(/요청한 인원에게 충분한 한 끼/)).toBeInTheDocument();
    expect(screen.queryByText('재료 종류 확인됨')).not.toBeInTheDocument();
    expect(screen.queryByText('추가로 필요한 재료')).not.toBeInTheDocument();
    expect(screen.queryByText('필수 재료 종류를 모두 갖췄어요.')).not.toBeInTheDocument();
    expect(within(summary).queryByText(/67%/)).not.toBeInTheDocument();
  });

  it('preserves sub-gram positive quantities without rounding them to zero', () => {
    const quantityResult = calculateScaledCooking({
      recipe: makeQuantityRecipe(), targetServings: 2,
      inventory: makeAvailabilitySnapshot({ items: [makeAvailableItem({ amount: 0.4 }), makeAvailableItem({ id: 'onion', foodId: 'onion', amount: 1 })] })
    });
    render(<RecipeCard recipe={{ ...baseRecipe, quantityResult }} />);
    const summary = screen.getByRole('region', { name: '확인한 분량' });
    expect(within(summary).getAllByText('1g 미만')).toHaveLength(2);
    expect(within(summary).queryByText('0g')).not.toBeInTheDocument();
  });

  it.each([
    ['needs-confirmation', null, '수량 확인 필요'],
    ['unavailable', 0, '사용 가능한 본재료 없음'],
    ['invalid', null, '수량 계산 불가']
  ])('communicates %s instead of a ready badge', (status, scaleFactor, title) => {
    render(<RecipeCard recipe={{ ...baseRecipe, canMakeNow: true, quantityResult: { status, scaleFactor, ingredients: [], checks: [] } }} />);
    expect(screen.getByText(title)).toBeInTheDocument();
    expect(screen.queryByText('재료 종류 확인됨')).not.toBeInTheDocument();
  });

  it('shows unknown quantity guidance when only an exact source is available', () => {
    render(<RecipeCard recipe={{ ...baseRecipe, canMakeNow: true, quantitySource: { kind: 'test', id: 'a', version: '1' } }} />);
    expect(screen.getByText('수량 확인 필요')).toBeInTheDocument();
    expect(screen.queryByText('재료 종류 확인됨')).not.toBeInTheDocument();
  });

  it.each(['original', 'scaled'])('does not display impossible enlarged quantities for %s results', (status) => {
    render(<RecipeCard recipe={{ ...baseRecipe, quantityResult: {
      status, scaleFactor: 1.01, requirementsStatus: 'satisfied', checks: [],
      ingredients: [{ lineId: 'egg', rawName: '계란', role: 'core', scaledAmount: 101, unit: 'g' }]
    } }} />);
    const summary = screen.getByRole('region', { name: '확인한 분량' });
    expect(within(summary).getByText('수량 확인 필요')).toBeInTheDocument();
    expect(within(summary).queryByText('101g')).not.toBeInTheDocument();
    expect(within(summary).queryByText(/필수 재료의 양을 모두 확인/)).not.toBeInTheDocument();
  });

  it('distinguishes registered ingredient type matching from manually confirmed amounts', () => {
    const quantityResult = calculateScaledCooking({ recipe: makeQuantityRecipe(), targetServings: 2, inventory: makeAvailabilitySnapshot() });
    const { rerender } = render(<RecipeCard recipe={{ ...baseRecipe, quantityResult }} />);
    expect(screen.getByText('종류 매칭')).toBeInTheDocument();
    expect(screen.getByText('등록 재료(종류)')).toBeInTheDocument();
    expect(screen.queryByText('보유 재료')).not.toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: '확인한 분량' })).getByText('201g')).toBeInTheDocument();

    rerender(<RecipeCard recipe={baseRecipe} />);
    expect(screen.getByText('매칭')).toBeInTheDocument();
    expect(screen.getByText('보유 재료')).toBeInTheDocument();
  });

  it('keeps the quantity link separate from the explicit today-menu selection', () => {
    function Location() { return <output aria-label="현재 경로">{useLocation().pathname}</output>; }
    const onSelect = vi.fn();
    render(<MemoryRouter><RecipeCard recipe={{ ...baseRecipe, publicRecipePath: '/recipes/source-29' }} onSelect={onSelect} /><Location /></MemoryRouter>);
    const link = screen.getByRole('link', { name: '분량 확인하기' });
    const enter = createEvent.keyDown(link, { key: 'Enter', bubbles: true, cancelable: true });
    fireEvent(link, enter);
    expect(enter.defaultPrevented).toBe(false);
    fireEvent.click(link);
    expect(screen.getByLabelText('현재 경로')).toHaveTextContent('/recipes/source-29');
    expect(onSelect).not.toHaveBeenCalled();

    expect(screen.getByRole('article')).not.toHaveAttribute('tabindex');
    expect(screen.queryByRole('button', { name: '계란 볶음밥' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('한 그릇'));
    expect(onSelect).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '오늘 먹기' }));
    expect(onSelect).toHaveBeenCalledTimes(1);
  });
});
