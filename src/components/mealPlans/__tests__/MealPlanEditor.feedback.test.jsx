import { useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import MealPlanEditor from '../MealPlanEditor';
import { generateMealPlan, setMealPlanSlotSkipped } from '../../../features/mealPlans/mealPlanDomain';

const WEEK = '2026-10-05';
const NOW = '2026-10-05T03:00:00.000Z';
const REASON_LABEL = '교체·건너뛰기 이유 (선택)';

function makePlan(options = {}) {
  return generateMealPlan({ weekStart: WEEK, scope: 'guest', now: NOW,
    preferences: { servings: 1, dinnerDays: [0], excludedIngredients: [] }, ...options });
}

function editorProps(plan, options = {}) {
  return { plan, confirmedPlan: null, hasDraft: true, weekStart: plan.weekStart, storageScope: plan.scope,
    saving: false, today: WEEK, ingredients: [], inventoryLoading: false, inventoryError: '',
    pantryItems: [], overdueConflicts: [], ...options };
}

function StoredEditor({ initialPlan, writes, failSave = false, ...options }) {
  const [plan, setPlan] = useState(initialPlan);
  async function savePlan(next, feedback) {
    if (failSave) return null;
    writes.push({ plan: structuredClone(next), feedback });
    setPlan(next);
    return next;
  }
  return <MemoryRouter><MealPlanEditor {...editorProps(plan, options)} savePlan={savePlan} /></MemoryRouter>;
}

function BusyStoredEditor({ waitForSave }) {
  const [plan, setPlan] = useState(() => makePlan());
  const [saving, setSaving] = useState(false);
  async function savePlan(next) {
    setSaving(true);
    await waitForSave;
    setPlan(next);
    setSaving(false);
    return next;
  }
  return <MemoryRouter><MealPlanEditor {...editorProps(plan, { saving })} savePlan={savePlan} /></MemoryRouter>;
}

function monday() {
  return within(screen.getByRole('article', { name: `${WEEK} 저녁 식단` }));
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(NOW));
  vi.stubEnv('VITE_LOCAL_PILOT_ENABLED', 'true');
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllEnvs(); });

describe('optional meal replacement and skipping feedback', () => {
  it('keeps ordinary menu changes usable without showing or attaching pilot reasons', async () => {
    vi.stubEnv('VITE_LOCAL_PILOT_ENABLED', 'false');
    const writes = [];
    render(<StoredEditor initialPlan={makePlan()} writes={writes} />);
    expect(monday().queryByRole('combobox', { name: REASON_LABEL })).not.toBeInTheDocument();
    expect(screen.queryByText(/이유는 선택 사항/)).not.toBeInTheDocument();
    fireEvent.click(monday().getByRole('button', { name: '메뉴 교체' }));
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0].feedback).toBeUndefined();
    fireEvent.click(monday().getByRole('button', { name: '외식·건너뛰기' }));
    await monday().findByRole('button', { name: '식단에 포함' });
    expect(writes[1].plan.slots[0].status).toBe('skipped');
    expect(writes[1].feedback).toBeUndefined();
  });

  it('keeps ordinary confirmed-meal cooking available without pilot feedback', () => {
    vi.stubEnv('VITE_LOCAL_PILOT_ENABLED', 'false');
    const plan = makePlan();
    const openCooking = vi.fn();
    render(<StoredEditor initialPlan={plan} writes={[]} confirmedPlan={plan} hasDraft={false} onOpenCooking={openCooking} />);
    fireEvent.click(monday().getByRole('button', { name: '만들어 먹었어요' }));
    expect(openCooking).toHaveBeenCalledWith(`${WEEK}:dinner`, expect.any(HTMLButtonElement));
    expect(monday().queryByRole('combobox', { name: REASON_LABEL })).not.toBeInTheDocument();
  });

  it('offers a labelled optional selection including repetition fatigue without changing meal preferences', () => {
    const plan = makePlan();
    const before = structuredClone(plan);
    render(<StoredEditor initialPlan={plan} writes={[]} />);
    const selection = monday().getByRole('combobox', { name: REASON_LABEL });
    expect(selection).toHaveValue('');
    fireEvent.change(selection, { target: { value: 'repetition' } });
    expect(selection).toHaveValue('repetition');
    expect(monday().getByRole('option', { name: '같은 메뉴가 반복돼서' })).toHaveValue('repetition');
    expect(monday().getByRole('button', { name: '메뉴 교체' })).toBeEnabled();
    expect(monday().getByRole('button', { name: '외식·건너뛰기' })).toBeEnabled();
    expect(plan).toStrictEqual(before);
    expect(screen.getByText(/파일럿 기록에 동의한 경우에만.*브라우저.*저장/)).toBeInTheDocument();
  });

  it('attaches the selected reason only to a successfully saved replacement and clears the selection', async () => {
    const plan = makePlan();
    const original = structuredClone(plan);
    const writes = [];
    render(<StoredEditor initialPlan={plan} writes={writes} />);
    fireEvent.change(monday().getByRole('combobox', { name: REASON_LABEL }), { target: { value: 'repetition' } });
    fireEvent.click(monday().getByRole('button', { name: '메뉴 교체' }));
    await waitFor(() => expect(monday().getByRole('combobox', { name: REASON_LABEL })).toHaveValue(''));
    expect(writes).toHaveLength(1);
    expect(writes[0].feedback).toEqual({ slotId: `${WEEK}:dinner`, changeType: 'replace', reasonCode: 'repetition' });
    expect(writes[0].plan.slots[0].templateKey).not.toBe(original.slots[0].templateKey);
    expect(writes[0].plan.preferences).toEqual(original.preferences);
    expect(writes[0].plan.slots[0]).not.toHaveProperty('reasonCode');
    expect(plan).toStrictEqual(original);
  });

  it('keeps keyboard focus on the replacement button after a successful menu change', async () => {
    const writes = [];
    render(<StoredEditor initialPlan={makePlan()} writes={writes} />);
    const replace = monday().getByRole('button', { name: '메뉴 교체' });
    replace.focus();
    expect(replace).toHaveFocus();
    fireEvent.click(replace);
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('메뉴를 바꿨어요.'));
    expect(monday().getByRole('button', { name: '메뉴 교체' })).toHaveFocus();
    expect(writes).toHaveLength(1);
  });

  it('restores keyboard focus after the browser blurs a temporarily disabled replacement button', async () => {
    let finishSave;
    const waitForSave = new Promise(resolve => { finishSave = resolve; });
    render(<BusyStoredEditor waitForSave={waitForSave} />);
    const replace = monday().getByRole('button', { name: '메뉴 교체' });
    replace.focus();
    fireEvent.click(replace);
    expect(replace).toBeDisabled();
    // jsdom retains focus on disabled controls. Chromium's observed blur is
    // reproduced explicitly while the real editor is in its busy state.
    document.body.tabIndex = -1;
    document.body.focus();
    document.body.removeAttribute('tabindex');
    expect(document.body).toHaveFocus();
    await act(async () => finishSave());
    await waitFor(() => expect(monday().getByRole('button', { name: '메뉴 교체' })).toHaveFocus());
    expect(replace).toBeEnabled();
  });

  it.each([false, true])('does not take focus back after the user focuses another control during storage (then blur: %s)', async thenBlur => {
    let finishSave;
    const waitForSave = new Promise(resolve => { finishSave = resolve; });
    render(<><BusyStoredEditor waitForSave={waitForSave} /><button type="button">다른 작업</button></>);
    const replace = monday().getByRole('button', { name: '메뉴 교체' });
    replace.focus();
    fireEvent.click(replace);
    const other = screen.getByRole('button', { name: '다른 작업' });
    other.focus();
    if (thenBlur) other.blur();
    await act(async () => finishSave());
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('메뉴를 바꿨어요.'));
    await act(async () => new Promise(resolve => requestAnimationFrame(resolve)));
    if (thenBlur) expect(document.body).toHaveFocus();
    else expect(other).toHaveFocus();
  });

  it('does not focus an old control after its editor was removed during storage', async () => {
    let finishSave;
    const waitForSave = new Promise(resolve => { finishSave = resolve; });
    const view = render(<BusyStoredEditor waitForSave={waitForSave} />);
    const replace = monday().getByRole('button', { name: '메뉴 교체' });
    replace.focus();
    fireEvent.click(replace);
    view.unmount();
    render(<button type="button">다른 계정 화면</button>);
    const other = screen.getByRole('button', { name: '다른 계정 화면' });
    other.focus();
    await act(async () => finishSave());
    await act(async () => new Promise(resolve => requestAnimationFrame(resolve)));
    expect(other).toHaveFocus();
    expect(replace.isConnected).toBe(false);
  });

  it('allows skipping without an answer and restores the meal without attaching a skipping reason', async () => {
    const writes = [];
    render(<StoredEditor initialPlan={makePlan()} writes={writes} />);
    fireEvent.click(monday().getByRole('button', { name: '외식·건너뛰기' }));
    await monday().findByRole('button', { name: '식단에 포함' });
    expect(writes[0].feedback).toEqual({ slotId: `${WEEK}:dinner`, changeType: 'skip', reasonCode: 'not_answered' });
    expect(monday().queryByRole('combobox', { name: REASON_LABEL })).not.toBeInTheDocument();
    fireEvent.click(monday().getByRole('button', { name: '식단에 포함' }));
    await monday().findByRole('button', { name: '메뉴 교체' });
    expect(writes).toHaveLength(2);
    expect(writes[1].feedback).toBeUndefined();
    expect(monday().getByRole('combobox', { name: REASON_LABEL })).toHaveValue('');
  });

  it('keeps an answer when storage fails and does not announce a successful change', async () => {
    const plan = makePlan();
    const writes = [];
    render(<StoredEditor initialPlan={plan} writes={writes} failSave />);
    fireEvent.change(monday().getByRole('combobox', { name: REASON_LABEL }), { target: { value: 'cost' } });
    fireEvent.click(monday().getByRole('button', { name: '메뉴 교체' }));
    await waitFor(() => expect(monday().getByRole('combobox', { name: REASON_LABEL })).toHaveValue('cost'));
    expect(monday().getByRole('heading', { name: plan.slots[0].title })).toBeInTheDocument();
    expect(screen.getByRole('status')).not.toHaveTextContent('메뉴를 바꿨어요.');
    expect(writes).toEqual([]);
  });

  it('keeps an answer and the old meal when no reviewed replacement exists', async () => {
    // Existing ordinary menus remain readable when opened in the pilot build.
    vi.stubEnv('VITE_LOCAL_PILOT_ENABLED', 'false');
    const plan = makePlan({ preferences: { servings: 1, dinnerDays: [0], excludedIngredients: ['두유', '석류', '중화면', '쌀'] } });
    const writes = [];
    vi.stubEnv('VITE_LOCAL_PILOT_ENABLED', 'true');
    render(<StoredEditor initialPlan={plan} writes={writes} />);
    fireEvent.change(monday().getByRole('combobox', { name: REASON_LABEL }), { target: { value: 'taste' } });
    fireEvent.click(monday().getByRole('button', { name: '메뉴 교체' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('기존 메뉴를 유지해요.'));
    expect(monday().getByRole('combobox', { name: REASON_LABEL })).toHaveValue('taste');
    expect(monday().getByRole('heading', { name: plan.slots[0].title })).toBeInTheDocument();
    expect(writes).toEqual([]);
  });

  it.each([
    ['saving', { saving: true }],
    ['inventory loading', { inventoryLoading: true }],
    ['editing another action', { editingDisabled: true }],
  ])('disables selection while %s', (_label, options) => {
    render(<StoredEditor initialPlan={makePlan()} writes={[]} {...options} />);
    expect(monday().getByRole('combobox', { name: REASON_LABEL })).toBeDisabled();
  });

  it('does not attach feedback to locking and disables selection on a locked meal', async () => {
    const writes = [];
    render(<StoredEditor initialPlan={makePlan()} writes={writes} />);
    fireEvent.change(monday().getByRole('combobox', { name: REASON_LABEL }), { target: { value: 'schedule' } });
    fireEvent.click(monday().getByRole('button', { name: '메뉴 고정' }));
    await monday().findByRole('button', { name: '고정 해제' });
    expect(monday().getByRole('combobox', { name: REASON_LABEL })).toBeDisabled();
    expect(writes[0].feedback).toBeUndefined();
  });

  it('records not-cooked only after the explicit action on an overdue confirmed meal', async () => {
    const plan = makePlan();
    const writes = [];
    vi.setSystemTime(new Date('2026-10-06T03:00:00.000Z'));
    render(<StoredEditor initialPlan={plan} writes={writes} confirmedPlan={plan} hasDraft={false} today="2026-10-06" />);
    expect(writes).toEqual([]);
    fireEvent.change(monday().getByRole('combobox', { name: REASON_LABEL }), { target: { value: 'schedule' } });
    fireEvent.click(monday().getByRole('button', { name: '만들지 않았어요' }));
    await monday().findByRole('button', { name: '식단에 포함' });
    expect(writes[0].feedback).toEqual({ slotId: `${WEEK}:dinner`, changeType: 'not_cooked', reasonCode: 'schedule' });
    expect(screen.getByRole('status')).toHaveTextContent('건너뛰어요.');
  });

  it('does not label an unconfirmed past draft as not-cooked', async () => {
    const writes = [];
    render(<StoredEditor initialPlan={makePlan()} writes={writes} today="2026-10-06" />);
    expect(monday().queryByRole('button', { name: '만들지 않았어요' })).not.toBeInTheDocument();
    fireEvent.click(monday().getByRole('button', { name: '외식·건너뛰기' }));
    await monday().findByRole('button', { name: '식단에 포함' });
    expect(writes[0].feedback).toEqual({ slotId: `${WEEK}:dinner`, changeType: 'skip', reasonCode: 'not_answered' });
  });

  it.each(['account', 'week', 'menu'])('does not carry an unsaved answer across a different %s', kind => {
    const plan = makePlan();
    const view = render(<MemoryRouter><MealPlanEditor {...editorProps(plan)} /></MemoryRouter>);
    fireEvent.change(monday().getByRole('combobox', { name: REASON_LABEL }), { target: { value: 'ingredients' } });
    const next = kind === 'week' ? makePlan({ weekStart: '2026-10-12' }) : structuredClone(plan);
    if (kind === 'account') next.scope = 'user:another';
    if (kind === 'menu') { next.slots[0].templateKey = 'test:other-menu'; next.slots[0].title = '바뀐 메뉴'; }
    view.rerender(<MemoryRouter><MealPlanEditor {...editorProps(next)} /></MemoryRouter>);
    const firstMeal = within(screen.getByRole('article', { name: `${next.weekStart} 저녁 식단` }));
    expect(firstMeal.getByRole('combobox', { name: REASON_LABEL })).toHaveValue('');
  });

  it.each(['cooked', 'skipped'])('does not offer skipping feedback on an already %s meal', status => {
    const plan = makePlan();
    const adjusted = status === 'skipped' ? setMealPlanSlotSkipped(plan, plan.slots[0].id, true) : structuredClone(plan);
    if (status === 'cooked') { adjusted.slots[0].status = 'cooked'; adjusted.slots[0].cooking = { inventoryStatus: 'needs-review' }; }
    render(<StoredEditor initialPlan={adjusted} writes={[]} />);
    expect(monday().queryByRole('combobox', { name: REASON_LABEL })).not.toBeInTheDocument();
  });
});
