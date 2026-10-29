import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import MealPlanPage from '../MealPlanPage';
import { generateMealPlan } from '../../features/mealPlans/mealPlanDomain';

const pilot = vi.hoisted(() => ({ begin: vi.fn(), finish: vi.fn() }));
vi.mock('../../features/mealPlans/mealPlanPilotCollector', () => ({
  beginMealPlanPilotOperation: (...args) => pilot.begin(...args),
  finishMealPlanPilotOperation: (...args) => pilot.finish(...args),
}));

const authState = { storageScope: 'guest', loading: false };
const repository = { getMealPlan: vi.fn(), saveMealPlan: vi.fn(), confirmMealPlan: vi.fn() };
const WEEK = '2026-09-14';
const NOW = '2026-09-14T03:00:00.000Z';
const records = new Map();
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => authState }));
vi.mock('../../hooks/useIngredients', () => ({
  useIngredients: () => ({ ingredients: [], loading: false, error: '' })
}));
vi.mock('../../hooks/usePantryStaples', () => ({
  usePantryStaples: () => ({ pantryStaples: [], pantryOwnership: {} })
}));
vi.mock('../../features/mealPlans/mealPlanRepository', async (importOriginal) => ({
  ...await importOriginal(),
  getMealPlanningSnapshot: async (scope) => ({ scope, confirmedPlans: [...records.values()]
    .filter(record => record.scope === scope && record.confirmed).map(record => record.confirmed) }),
  getMealPlan: (...args) => repository.getMealPlan(...args),
  saveMealPlan: (...args) => repository.saveMealPlan(...args),
  confirmMealPlan: (...args) => repository.confirmMealPlan(...args)
}));

function recordKey(weekStart, scope) {
  return `${scope}|${weekStart}`;
}

function fixturePlan() {
  return generateMealPlan({ weekStart: WEEK, scope: 'guest', now: NOW,
    preferences: { servings: 1, excludedIngredients: [], dinnerDays: [0, 1, 2, 3, 4, 5, 6] } });
}

function recordWith({ draft = null, confirmed = null, revision = 1, archives = [] }) {
  const plan = draft || confirmed;
  return {
    schemaVersion: 2, id: plan.id, scope: plan.scope, weekStart: plan.weekStart,
    revision, createdAt: NOW, updatedAt: NOW, draft, confirmed, archives,
  };
}

function remember(record) {
  records.set(recordKey(record.weekStart, record.scope), structuredClone(record));
  return structuredClone(record);
}

function saveDraft(nextPlan, scope, expectedRevision) {
  const current = records.get(recordKey(nextPlan.weekStart, scope));
  if ((current?.revision || 0) !== expectedRevision) throw new Error('다른 화면에서 식단이 변경됐습니다.');
  return remember(recordWith({ draft: { ...structuredClone(nextPlan), revision: expectedRevision + 1 },
    confirmed: current?.confirmed || null, revision: expectedRevision + 1, archives: current?.archives || [] }));
}

function confirmDraft(weekStart, scope, expectedRevision) {
  const current = records.get(recordKey(weekStart, scope));
  if (!current?.draft || current.revision !== expectedRevision) throw new Error('확정할 초안을 다시 확인해주세요.');
  return remember({ ...current, revision: current.revision + 1, draft: null, confirmed: current.draft,
    archives: current.confirmed ? [...current.archives, current.confirmed] : current.archives });
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function page() {
  return <MemoryRouter><MealPlanPage /></MemoryRouter>;
}

describe('MealPlanPage storage integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('VITE_LOCAL_PILOT_ENABLED', 'false');
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(NOW));
    pilot.begin.mockResolvedValue(Object.freeze({}));
    pilot.finish.mockResolvedValue({ status: 'recorded' });
    records.clear();
    authState.storageScope = 'guest';
    authState.loading = false;
    repository.getMealPlan.mockImplementation(async (weekStart, scope) =>
      structuredClone(records.get(recordKey(weekStart, scope)) || null));
    repository.saveMealPlan.mockImplementation(async (...args) => saveDraft(...args));
    repository.confirmMealPlan.mockImplementation(async (...args) => confirmDraft(...args));
  });
  afterEach(() => { cleanup(); vi.unstubAllEnvs(); vi.useRealTimers(); });

  it('connects the explicit generation click to a started observation and its saved result, not initial render', async () => {
    vi.stubEnv('VITE_LOCAL_PILOT_ENABLED', 'true');
    render(page());
    const button = await screen.findByRole('button', { name: '한 주 식단 만들기' });
    expect(pilot.begin).not.toHaveBeenCalled();
    fireEvent.click(button);
    await screen.findByRole('region', { name: '한 주 저녁 식단표' });
    expect(pilot.begin.mock.calls[0]?.[0].startEvent).toMatchObject({ name: 'meal_plan_generation_started', status: 'started' });
    expect(pilot.finish.mock.calls.flatMap(call => call[1])).toEqual([expect.objectContaining({ name: 'meal_plan_generated', status: 'success', plannedSlotCount: 7 })]);
    expect(records.get(recordKey(WEEK, 'guest')).confirmed).toBeNull();
  });

  it('keeps a saved draft unconfirmed until the user explicitly confirms it', async () => {
    render(page());
    fireEvent.click(await screen.findByRole('button', { name: '한 주 식단 만들기' }));
    await screen.findByRole('region', { name: '한 주 저녁 식단표' });
    expect(screen.queryByRole('button', { name: '이 식단 확정' })).toBeInTheDocument();
    expect(screen.getByText('초안', { exact: true })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: '현재 확정된 식단' })).not.toBeInTheDocument();
  });

  it('connects saved source-reviewed menu details to the board without changing one-person source rows', async () => {
    const draft = generateMealPlan({ weekStart: WEEK, now: NOW,
      preferences: { servings: 2, dinnerDays: [0], excludedIngredients: [] },
      ingredients: ['밥', '시금치', '마', '두유', '소금', '버터', '후춧가루'].map((name) => ({ name })) });
    remember(recordWith({ draft }));
    render(page());
    const board = await screen.findByRole('region', { name: '한 주 저녁 식단표' });
    expect(within(board).getByRole('heading', { name: '시금치 리조또' })).toBeInTheDocument();
    fireEvent.click(within(board).getByText(/^재료 확인 ·/));
    const quantities = within(board).getByRole('list', { name: '2인분 식재료 필요량' });
    expect(within(quantities).getByText('360g')).toBeInTheDocument();
    expect(within(board).getByText(/시금치 데치는 물: 양 확인 필요/)).toBeInTheDocument();
    expect(within(board).getByRole('link', { name: '공식 책자 50–51쪽 확인' })).toHaveAttribute('href', expect.stringContaining('#page=26'));
    expect(records.get(recordKey(WEEK, 'guest')).draft.slots[0].components[0].ingredients[0].amount).toBe(180);
    expect(repository.saveMealPlan).not.toHaveBeenCalled();
  });

  it('shows confirmation only after persistence completes and blocks a duplicate click', async () => {
    remember(recordWith({ draft: fixturePlan() }));
    const confirmation = deferred();
    repository.confirmMealPlan.mockReturnValueOnce(confirmation.promise);
    render(page());
    const button = await screen.findByRole('button', { name: '이 식단 확정' });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(button).toBeDisabled();
    expect(screen.getByRole('button', { name: '다음 주' })).toBeDisabled();
    expect(screen.queryByText('확정됨', { exact: true })).not.toBeInTheDocument();
    await waitFor(() => expect(repository.confirmMealPlan).toHaveBeenCalledTimes(1));
    expect(repository.confirmMealPlan).toHaveBeenCalledWith(WEEK, 'guest', 1);
    await act(async () => { confirmation.resolve(confirmDraft(WEEK, 'guest', 1)); });
    expect(await screen.findByText('확정됨', { exact: true })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '이 식단 확정' })).not.toBeInTheDocument();
    expect(screen.getByText(/확정은.*수량.*안전/)).toBeInTheDocument();
  });

  it('keeps the draft and offers retry when confirmation fails without announcing success', async () => {
    remember(recordWith({ draft: fixturePlan() }));
    repository.confirmMealPlan.mockRejectedValueOnce(new Error('확정 내용을 저장하지 못했어요.'));
    render(page());
    fireEvent.click(await screen.findByRole('button', { name: '이 식단 확정' }));
    await screen.findByText('확정 내용을 저장하지 못했어요.');
    expect(screen.getByText('초안', { exact: true })).toBeInTheDocument();
    expect(screen.queryByText('확정됨', { exact: true })).not.toBeInTheDocument();
    expect(screen.queryByText('식단을 확정했어요.')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '이 식단 확정' }));
    expect(await screen.findByText('확정됨', { exact: true })).toBeInTheDocument();
  });

  it('preserves the effective confirmed menu while a changed draft is saved and after reload', async () => {
    const confirmed = fixturePlan();
    confirmed.slots[0].title = '기존에 확정한 월요일 메뉴';
    remember(recordWith({ confirmed, revision: 2 }));
    const firstView = render(page());
    const board = await screen.findByRole('region', { name: '한 주 저녁 식단표' });
    fireEvent.click(within(board).getAllByRole('button', { name: '외식·건너뛰기' })[0]);
    expect(await screen.findByText('수정 초안', { exact: true })).toBeInTheDocument();
    const summary = screen.getByRole('region', { name: '현재 확정된 식단' });
    expect(within(summary).getByText('기존에 확정한 월요일 메뉴')).toBeInTheDocument();
    expect(within(summary).getByText('9.14 월요일')).toBeInTheDocument();
    expect(within(summary).getAllByText('1인')).toHaveLength(7);
    expect(within(summary).queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByText(/이전 확정본을 유지/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '수정 초안으로 확정본 교체' })).toBeEnabled();
    expect(within(board).getByText('외식하거나 쉬는 날')).toBeInTheDocument();
    firstView.unmount();
    render(page());
    expect(await screen.findByText('수정 초안', { exact: true })).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: '현재 확정된 식단' }))
      .getByText('기존에 확정한 월요일 메뉴')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: '한 주 저녁 식단표' }))
      .getByText('외식하거나 쉬는 날')).toBeInTheDocument();
  });

  it('keeps the existing confirmation when a draft edit fails to save', async () => {
    const confirmed = fixturePlan();
    confirmed.slots[0].title = '저장 실패 전에 확정한 메뉴';
    remember(recordWith({ confirmed, revision: 2 }));
    repository.saveMealPlan.mockRejectedValueOnce(new Error('초안 저장 공간 부족'));
    render(page());
    const board = await screen.findByRole('region', { name: '한 주 저녁 식단표' });
    fireEvent.click(within(board).getAllByRole('button', { name: '외식·건너뛰기' })[0]);
    await screen.findByText('초안 저장 공간 부족');
    expect(screen.getByText('확정됨', { exact: true })).toBeInTheDocument();
    expect(within(board).getByText('저장 실패 전에 확정한 메뉴')).toBeInTheDocument();
    expect(screen.queryByText('수정 초안', { exact: true })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '수정 초안으로 확정본 교체' })).not.toBeInTheDocument();
  });

  it('replaces the confirmed snapshot only after explicit confirmation and keeps it on reload', async () => {
    const confirmed = fixturePlan();
    const draft = structuredClone(confirmed);
    confirmed.slots[0].title = '교체 전 확정 메뉴';
    draft.slots[0].title = '새로 선택한 초안 메뉴';
    draft.slots[0].servings = 2;
    remember(recordWith({ draft, confirmed, revision: 3 }));
    const confirmation = deferred();
    repository.confirmMealPlan.mockReturnValueOnce(confirmation.promise);
    const firstView = render(page());
    fireEvent.click(await screen.findByRole('button', { name: '수정 초안으로 확정본 교체' }));
    expect(within(screen.getByRole('region', { name: '현재 확정된 식단' }))
      .getByText('교체 전 확정 메뉴')).toBeInTheDocument();
    await act(async () => { confirmation.resolve(confirmDraft(WEEK, 'guest', 3)); });
    expect(await screen.findByText('확정됨', { exact: true })).toBeInTheDocument();
    expect(screen.queryByText('교체 전 확정 메뉴')).not.toBeInTheDocument();
    firstView.unmount();
    render(page());
    expect(await screen.findByText('확정됨', { exact: true })).toBeInTheDocument();
    const board = screen.getByRole('region', { name: '한 주 저녁 식단표' });
    expect(within(board).getByText('새로 선택한 초안 메뉴')).toBeInTheDocument();
    expect(within(board).getByText('저녁 · 2인')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '수정 초안으로 확정본 교체' })).not.toBeInTheDocument();
  });

  it('requires changed settings to be saved before confirmation', async () => {
    remember(recordWith({ draft: fixturePlan() }));
    render(page());
    const confirm = await screen.findByRole('button', { name: '이 식단 확정' });
    fireEvent.change(screen.getByLabelText('식사 인원'), { target: { value: '2' } });
    expect(confirm).toBeDisabled();
    fireEvent.click(confirm);
    expect(repository.confirmMealPlan).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '고정하지 않은 메뉴 다시 추천' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '이 식단 확정' })).toBeEnabled());
    expect(within(screen.getByRole('region', { name: '한 주 저녁 식단표' }))
      .getAllByText('저녁 · 2인')).toHaveLength(7);
  });

  it('moves keyboard focus to the confirmation state after its action button disappears', async () => {
    remember(recordWith({ draft: fixturePlan() }));
    render(page());
    const button = await screen.findByRole('button', { name: '이 식단 확정' });
    button.focus();
    fireEvent.click(button);
    const heading = await screen.findByRole('heading', { name: '확정됨', exact: true });
    expect(heading).toHaveFocus();
  });

  it('does not announce or render an earlier account’s late confirmation', async () => {
    const guestRecord = recordWith({ draft: fixturePlan() });
    remember(guestRecord);
    const confirmation = deferred();
    repository.confirmMealPlan.mockReturnValueOnce(confirmation.promise);
    const view = render(page());
    fireEvent.click(await screen.findByRole('button', { name: '이 식단 확정' }));
    authState.storageScope = 'user:alice';
    view.rerender(page());
    await screen.findByRole('button', { name: '한 주 식단 만들기' });
    await act(async () => { confirmation.resolve({ ...guestRecord, revision: 2, draft: null, confirmed: guestRecord.draft }); });
    expect(screen.queryByText('확정됨', { exact: true })).not.toBeInTheDocument();
    expect(screen.queryByText('식단을 확정했어요.')).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: '한 주 저녁 식단표' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('피하고 싶은 재료')).toHaveValue('');
  });

  it('keeps the first draft after save failure and saves the same choices on retry', async () => {
    const save = deferred();
    repository.saveMealPlan.mockReturnValueOnce(save.promise);
    render(page());
    await screen.findByRole('button', { name: '한 주 식단 만들기' });
    fireEvent.change(screen.getByLabelText('식사 인원'), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('피하고 싶은 재료'), { target: { value: '버섯, 가지' } });
    fireEvent.click(screen.getByRole('button', { name: '한 주 식단 만들기' }));
    expect(screen.getByRole('button', { name: '다음 주' })).toBeDisabled();
    await act(async () => { save.reject(new Error('저장 공간 부족')); });
    await screen.findByText('저장 공간 부족');
    expect(screen.getByLabelText('식사 인원')).toHaveValue('2');
    expect(screen.getByLabelText('피하고 싶은 재료')).toHaveValue('버섯, 가지');
    expect(screen.getByLabelText('피하고 싶은 재료').closest('details')).toHaveAttribute('open');
    expect(screen.queryByRole('region', { name: '한 주 저녁 식단표' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '한 주 식단 만들기' }));
    await screen.findByRole('region', { name: '한 주 저녁 식단표' });
    expect(repository.saveMealPlan).toHaveBeenLastCalledWith(expect.objectContaining({
      scope: 'guest', preferences: expect.objectContaining({ servings: 2, excludedIngredients: ['버섯', '가지'] })
    }), 'guest', 0);
  });

  it('blocks generation on a failed read and unlocks it only after successful retry', async () => {
    repository.getMealPlan.mockRejectedValueOnce(new Error('저장된 식단 형식을 확인할 수 없습니다.'));
    render(page());
    await screen.findByRole('alert');
    expect(screen.queryByRole('button', { name: '한 주 식단 만들기' })).not.toBeInTheDocument();
    expect(repository.saveMealPlan).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '저장된 식단 다시 불러오기' }));
    await screen.findByRole('button', { name: '한 주 식단 만들기' });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('does not show or apply an earlier account’s draft when its save completes late', async () => {
    const save = deferred();
    repository.saveMealPlan.mockReturnValueOnce(save.promise);
    const view = render(page());
    await screen.findByRole('button', { name: '한 주 식단 만들기' });
    fireEvent.change(screen.getByLabelText('피하고 싶은 재료'), { target: { value: '게스트 취향' } });
    fireEvent.click(screen.getByRole('button', { name: '한 주 식단 만들기' }));
    await waitFor(() => expect(repository.saveMealPlan).toHaveBeenCalledTimes(1));
    const guestDraft = repository.saveMealPlan.mock.calls[0][0];
    authState.storageScope = 'user:alice';
    view.rerender(page());
    await screen.findByRole('button', { name: '한 주 식단 만들기' });
    expect(screen.getByLabelText('피하고 싶은 재료')).toHaveValue('');
    await act(async () => { save.resolve(recordWith({ draft: guestDraft })); });
    expect(screen.queryByRole('region', { name: '한 주 저녁 식단표' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('피하고 싶은 재료')).toHaveValue('');
    await waitFor(() => expect(repository.getMealPlan).toHaveBeenLastCalledWith(expect.any(String), 'user:alice'));
  });
});
