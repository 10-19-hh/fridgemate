import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import MealQuantityDetails from '../MealQuantityDetails';
import { getReviewedDinnerCatalog } from '../../features/mealPlans/reviewedDinnerCatalog';
import { mealPlanCatalog } from '../../features/mealPlans/mealPlanCatalog';

function slot(servings = 2) {
  const template = getReviewedDinnerCatalog().templates[0];
  return { ...template, status: 'planned', servings };
}
afterEach(() => { cleanup(); vi.unstubAllEnvs(); });

describe('MealQuantityDetails', () => {
  it('distinguishes a source-compared food quantity from a completely measured cooking process in the pilot', () => {
    vi.stubEnv('VITE_LOCAL_PILOT_ENABLED', 'true');
    const meal = slot();
    const before = structuredClone(meal);
    render(<MealQuantityDetails slot={meal} />);
    expect(screen.getByRole('note', { name: '메뉴 검수 범위' })).toHaveTextContent('원문 대조 완료(식재료량)');
    expect(screen.getByRole('note', { name: '메뉴 검수 범위' })).toHaveTextContent(/과정 물.*추가 양념.*확인/);
    expect(screen.getByText(/시금치 데치는 물.*양 확인 필요/)).toBeInTheDocument();
    expect(screen.getByText('360g')).toBeInTheDocument();
    expect(meal).toStrictEqual(before);
  });

  it('labels saved editorial meals without hiding their original unmeasured contents', () => {
    vi.stubEnv('VITE_LOCAL_PILOT_ENABLED', 'true');
    const meal = { ...mealPlanCatalog[0], servings: 2 };
    const before = structuredClone(meal);
    render(<MealQuantityDetails slot={meal} />);
    expect(screen.getByRole('note', { name: '메뉴 검수 범위' })).toHaveTextContent('편집 조합');
    expect(screen.getByText(/재료별 필요량.*확인되지/)).toBeInTheDocument();
    expect(meal).toStrictEqual(before);
  });

  it('does not label an unknown stored source as an editorial or source-reviewed meal', () => {
    vi.stubEnv('VITE_LOCAL_PILOT_ENABLED', 'true');
    const meal = structuredClone({ ...mealPlanCatalog[0], servings: 1 });
    meal.components[0].source = { kind: 'unreviewed-import', id: 'unknown' };
    render(<MealQuantityDetails slot={meal} />);
    expect(screen.getByRole('note', { name: '메뉴 검수 범위' })).toHaveTextContent('미검수');
    expect(screen.queryByText(/앱 기본 메뉴를 조합한 식단/)).not.toBeInTheDocument();
  });

  it('does not advertise completed food-quantity review when a stored source row has lost its amount', () => {
    vi.stubEnv('VITE_LOCAL_PILOT_ENABLED', 'true');
    const meal = slot();
    meal.components[0].ingredients[0].amount = null;
    render(<MealQuantityDetails slot={meal} />);
    const note = screen.getByRole('note', { name: '메뉴 검수 범위' });
    expect(note).toHaveTextContent('미검수');
    expect(note).not.toHaveTextContent('원문 대조 완료');
    expect(screen.getByText(/밥.*분량 확인 필요/)).toBeInTheDocument();
    expect(screen.queryByText('360g')).not.toBeInTheDocument();
  });

  it('shows two-person ingredient requirements while preserving the original one-person amounts', () => {
    const meal = slot();
    const before = structuredClone(meal);
    render(<MealQuantityDetails slot={meal} />);
    const requirements = screen.getByRole('list', { name: '2인분 식재료 필요량' });
    expect(within(requirements).getByText('밥')).toBeInTheDocument();
    expect(within(requirements).getByText('360g')).toBeInTheDocument();
    expect(within(requirements).getByText('300g')).toBeInTheDocument();
    expect(screen.getByText(/원문.*밥.*180g/)).toBeInTheDocument();
    expect(screen.getByText(/보유량.*장보기/)).toBeInTheDocument();
    expect(meal).toEqual(before);
  });

  it('reveals original unmeasured process water and source-review limitations', () => {
    render(<MealQuantityDetails slot={slot()} />);
    expect(screen.getByText(/시금치 데치는 물.*양 확인 필요/)).toBeInTheDocument();
    expect(screen.getByText(/직접 조리.*영양 전문가/)).toBeInTheDocument();
    expect(screen.queryByText(/30분|균형 보장|조리 가능|영양 충족/)).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /공식 책자.*50.*51/ })).toHaveAttribute('href',
      'https://www.foodsafetykorea.go.kr/upload/20170417/20170417053825_1492418305244.pdf#page=26');
  });

  it('labels noodle method quantities as the original one-person recipe, separate from two-person requirements', () => {
    const dinner = { ...getReviewedDinnerCatalog().templates[1], servings: 2 };
    render(<MealQuantityDetails slot={dinner} />);
    const requirements = screen.getByRole('list', { name: '2인분 식재료 필요량' });
    expect(within(requirements).getByText('1,200g')).toBeInTheDocument();
    const method = screen.getByText(/조리 흐름.*석류/);
    expect(method).toHaveTextContent('원문 1인분 조리 흐름 요약');
    expect(method).toHaveTextContent('600g');
    expect(screen.getByText(/조리할 때는 위의 2인분 필요량/)).toBeInTheDocument();
  });

  it('does not turn a missing amount into a numeric whole requirement', () => {
    const meal = slot();
    meal.components[0].ingredients[0].amount = null;
    meal.components[0].ingredients[0].quantityStatus = 'unverified';
    render(<MealQuantityDetails slot={meal} />);
    expect(screen.getByText(/밥.*분량 확인 필요/)).toBeInTheDocument();
    expect(screen.queryByText('360g')).not.toBeInTheDocument();
    expect(screen.queryByText('0g')).not.toBeInTheDocument();
  });

  it('keeps legacy editorial menus unverified without inventing source links or recipe quantities', () => {
    render(<MealQuantityDetails slot={{ ...mealPlanCatalog[0], servings: 2 }} />);
    expect(screen.getByText(/재료별 필요량.*확인되지/)).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: '2인분 식재료 필요량' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('never exposes an executable or unrelated stored source URL as a recipe link', () => {
    for (const url of ['javascript:alert(1)', 'https://example.com/unreviewed.pdf']) {
      const meal = slot();
      meal.components[0].source.url = url;
      const view = render(<MealQuantityDetails slot={meal} />);
      expect(screen.queryByRole('link')).not.toBeInTheDocument();
      view.unmount();
    }
  });
});
