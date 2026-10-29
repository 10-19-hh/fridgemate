import { useState } from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import MealPlanEditor from '../MealPlanEditor';
import { generateMealPlan, setMealPlanSlotSkipped } from '../../../features/mealPlans/mealPlanDomain';

function editor() {
  return <MemoryRouter><MealPlanEditor plan={null} confirmedPlan={null} hasDraft={false}
    weekStart="2026-09-14" storageScope="guest" saving={false} today="2026-09-14"
    ingredients={[]} inventoryLoading={false} inventoryError="" pantryItems={[]}
    overdueConflicts={[]} /></MemoryRouter>;
}

function StoredEditor({ initialPlan }) {
  const [plan, setPlan] = useState(initialPlan);
  return <MemoryRouter><MealPlanEditor plan={plan} confirmedPlan={null} hasDraft
    weekStart={plan.weekStart} storageScope="guest" saving={false} today={plan.weekStart}
    ingredients={[]} inventoryLoading={false} inventoryError="" pantryItems={[]}
    overdueConflicts={[]} savePlan={async next => { setPlan(next); return next; }} /></MemoryRouter>;
}

afterEach(() => { cleanup(); vi.unstubAllEnvs(); });

describe('pilot menu policy disclosure', () => {
  it('explains the conditional menu scope before a guest generates a plan, without requiring analytics consent', () => {
    vi.stubEnv('VITE_LOCAL_PILOT_ENABLED', 'true');
    render(editor());
    const notice = screen.getByRole('complementary', { name: '파일럿 메뉴 기준' });
    expect(notice).toHaveTextContent('원문 대조 완료(식재료량)');
    expect(notice).toHaveTextContent(/과정 물.*추가 양념.*확인/);
    expect(notice).toHaveTextContent(/기본 양념.*보유량/);
    expect(notice).toHaveTextContent(/같은 메뉴.*반복/);
    expect(notice).toHaveTextContent(/기존.*식단.*유지/);
    expect(notice).toHaveTextContent(/참여 동의.*관계없이/);
    expect(screen.getByRole('button', { name: '한 주 식단 만들기' })).toBeEnabled();
  });

  it('does not advertise pilot restrictions in the ordinary application build', () => {
    vi.stubEnv('VITE_LOCAL_PILOT_ENABLED', 'false');
    render(editor());
    expect(screen.queryByRole('complementary', { name: '파일럿 메뉴 기준' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '한 주 식단 만들기' })).toBeEnabled();
  });

  it('does not announce successful inclusion when no reviewed candidate can restore a skipped legacy meal', async () => {
    vi.stubEnv('VITE_LOCAL_PILOT_ENABLED', 'false');
    const plan = generateMealPlan({ weekStart: '2026-10-05', now: '2026-10-05T03:00:00.000Z',
      preferences: { servings: 1, dinnerDays: [0], excludedIngredients: ['두유', '석류', '중화면', '쌀'] } });
    const skipped = setMealPlanSlotSkipped(plan, plan.slots[0].id, true);
    const before = structuredClone(skipped);
    vi.stubEnv('VITE_LOCAL_PILOT_ENABLED', 'true');
    render(<StoredEditor initialPlan={skipped} />);
    const monday = screen.getByRole('article', { name: '2026-10-05 저녁 식단' });
    fireEvent.click(within(monday).getByRole('button', { name: '식단에 포함' }));
    expect(await screen.findByRole('status')).not.toHaveTextContent('식단에 다시 포함했어요.');
    expect(screen.getByRole('status')).toHaveTextContent(/메뉴가 없/);
    expect(within(monday).getByRole('button', { name: '식단에 포함' })).toBeEnabled();
    expect(skipped).toStrictEqual(before);
  });
});
