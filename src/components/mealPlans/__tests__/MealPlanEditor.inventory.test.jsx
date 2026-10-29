import { useState } from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import MealPlanEditor from '../MealPlanEditor';
import { generateMealPlan } from '../../../features/mealPlans/mealPlanDomain';

const WEEK = '2026-09-14';
const NOW = '2026-09-14T03:00:00.000Z';

function fixturePlan() {
  const plan = generateMealPlan({ weekStart: WEEK, now: NOW,
    preferences: { servings: 1, excludedIngredients: [], dinnerDays: [0] } });
  const component = plan.slots[0].components[0];
  plan.slots[0].title = '재료 확인 테스트 메뉴';
  plan.slots[0].components = [{ ...component, source: { kind: 'test', id: 'test', name: '테스트' },
    ingredients: ['닭고기', '당근'].map((name, index) => ({ ...component.ingredients[0],
      id: `test:${index}`, rawName: name, normalizedName: name, selected: true, optional: false })) }];
  return plan;
}

function ingredient(name, quantity = '2팩') {
  return { id: name, name, quantity, consumed: false, expiryDate: '2026-10-01' };
}

function Editor({ initialPlan = null, ingredients = [] }) {
  const [plan, setPlan] = useState(initialPlan);
  return <MemoryRouter><MealPlanEditor plan={plan} confirmedPlan={null} hasDraft={Boolean(plan)}
    weekStart={WEEK} storageScope="guest" saving={false} today={WEEK} ingredients={ingredients}
    inventoryLoading={false} inventoryError="" pantryItems={[]} overdueConflicts={[]}
    generatePlan={async create => { const next = create(); setPlan(next); return next; }}
    savePlan={async next => { setPlan(next); return next; }} /></MemoryRouter>;
}

beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(NOW)); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('meal-plan ingredient registration is not proof of absence or quantity', () => {
  it('offers draft creation without requiring full ingredient registration', () => {
    render(<Editor />);
    expect(screen.getByText('재료를 등록하지 않아도 초안을 만들 수 있어요. 필요한 재료는 구매 또는 보유 여부를 확인해 주세요.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '한 주 식단 만들기' })).toBeEnabled();
  });

  it('creates the first draft with no inventory and asks for ownership checks instead of declaring ingredients absent', async () => {
    render(<Editor />);
    fireEvent.click(screen.getByRole('button', { name: '한 주 식단 만들기' }));
    const board = await screen.findByRole('region', { name: '한 주 저녁 식단표' });
    expect(within(board).getAllByRole('article')).toHaveLength(7);
    expect(within(board).queryAllByText(/미보유/)).toHaveLength(0);
    expect(within(board).getAllByText(/^재료 확인 · 구매 또는 보유 확인 필요/).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: '이 식단 확정' })).toBeEnabled();
  });

  it('makes partial registration and unmatched ownership checks distinct', () => {
    render(<Editor initialPlan={fixturePlan()} ingredients={[ingredient('닭고기')]} />);
    const meal = screen.getByRole('article', { name: `${WEEK} 저녁 식단` });
    expect(within(meal).getByText('재료 확인 · 구매 또는 보유 확인 필요 1가지 · 수량 확인 필요')).toBeInTheDocument();
    expect(within(meal).getByText('등록·보유 확인된 재료명:').parentElement).toHaveTextContent('닭고기');
    expect(within(meal).getByText('구매 또는 보유 확인 필요:').parentElement).toHaveTextContent('당근');
    expect(within(meal).queryByText(/미보유|보유한 닭고기/)).not.toBeInTheDocument();
  });

  it('keeps unmeasured package labels unchanged and does not turn matching names into sufficient quantities', () => {
    const ingredients = [ingredient('닭고기'), ingredient('당근', '반 개')];
    const before = structuredClone(ingredients);
    render(<Editor initialPlan={fixturePlan()} ingredients={ingredients} />);
    const meal = screen.getByRole('article', { name: `${WEEK} 저녁 식단` });
    expect(within(meal).getByText('재료 확인 · 재료명 일치 · 수량 확인 필요')).toBeInTheDocument();
    expect(within(meal).getByText(/재료명만 비교한 결과/)).toBeInTheDocument();
    expect(within(meal).queryByText(/수량 확인됨|바로 조리 가능|0g/)).not.toBeInTheDocument();
    expect(ingredients).toStrictEqual(before);
  });

  it.each(['applied', 'reversed', 'needs-review'])('keeps past cooked %s details historical rather than comparing today’s empty fridge', inventoryStatus => {
    const plan = fixturePlan();
    plan.slots[0].status = 'cooked';
    plan.slots[0].cooking = { inventoryStatus };
    const before = structuredClone(plan);
    render(<Editor initialPlan={plan} />);
    const meal = screen.getByRole('article', { name: `${WEEK} 저녁 식단` });
    expect(within(meal).getByText('조리 당시 메뉴와 원문 재료')).toBeInTheDocument();
    expect(within(meal).getByText('조리 기록됨')).toBeInTheDocument();
    expect(within(meal).queryByText(/구매 또는 보유 확인 필요|재료명만 비교한 결과/)).not.toBeInTheDocument();
    expect(plan).toStrictEqual(before);
  });
});
