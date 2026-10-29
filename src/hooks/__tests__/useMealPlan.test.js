import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useMealPlan } from '../useMealPlan';
import { generateMealPlan } from '../../features/mealPlans/mealPlanDomain';

const authState = { storageScope: 'guest', loading: false };
const repository = { getMealPlan: vi.fn(), saveMealPlan: vi.fn(), confirmMealPlan: vi.fn(), restoreOverdueMealPlanDraft: vi.fn() };
vi.mock('../useAuth', () => ({ useAuth: () => authState }));
vi.mock('../../features/mealPlans/mealPlanRepository', () => ({
  getMealPlan: (...args) => repository.getMealPlan(...args),
  saveMealPlan: (...args) => repository.saveMealPlan(...args),
  confirmMealPlan: (...args) => repository.confirmMealPlan(...args),
  restoreOverdueMealPlanDraft: (...args) => repository.restoreOverdueMealPlanDraft(...args)
}));

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function plan(scope = 'guest', revision = 1, weekStart = '2026-09-14') {
  return { ...generateMealPlan({ scope, weekStart, now: '2026-09-12T00:00:00.000Z' }), revision };
}

function record(draft, confirmed = null, revision = draft?.revision ?? confirmed?.revision ?? 0) {
  const value = draft ?? confirmed;
  return value ? {
    id: value.id, scope: value.scope, weekStart: value.weekStart, schemaVersion: 2,
    revision, createdAt: value.createdAt, updatedAt: value.updatedAt,
    draft, confirmed, archives: [],
  } : null;
}

describe('useMealPlan', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    authState.storageScope = 'guest';
    authState.loading = false;
    repository.getMealPlan.mockResolvedValue(null);
    repository.saveMealPlan.mockImplementation(async (next) => record(next));
  });
  afterEach(cleanup);

  it('restores through the guarded write path, preserving state on failure and blocking duplicate requests', async () => {
    const draft = plan('guest', 3);
    const confirmed = plan();
    repository.getMealPlan.mockResolvedValue(record(draft, confirmed, 3));
    repository.restoreOverdueMealPlanDraft.mockRejectedValueOnce(new Error('복구 저장 실패'));
    const { result } = renderHook(() => useMealPlan('2026-09-14'));
    await waitFor(() => expect(result.current.ready).toBe(true));
    await act(async () => { expect(await result.current.restoreOverdueDraft()).toBeNull(); });
    expect(result.current.plan).toEqual(draft);
    expect(result.current.confirmedPlan).toEqual(confirmed);
    const pending = deferred();
    repository.restoreOverdueMealPlanDraft.mockReturnValue(pending.promise);
    let request;
    await act(async () => {
      request = result.current.restoreOverdueDraft();
      expect(await result.current.restoreOverdueDraft()).toBeNull();
      expect(await result.current.confirmPlan()).toBeNull();
    });
    expect(repository.restoreOverdueMealPlanDraft).toHaveBeenCalledTimes(2);
    expect(repository.restoreOverdueMealPlanDraft).toHaveBeenLastCalledWith('2026-09-14', 'guest', 3);
    expect(result.current.plan).toEqual(draft);
    const restored = { ...draft, slots: confirmed.slots };
    await act(async () => { pending.resolve(record(restored, confirmed, 4)); expect(await request).toEqual(restored); });
    expect(result.current.recordRevision).toBe(4);
    expect(result.current.confirmedPlan).toEqual(confirmed);
    expect(result.current.error).toBe('');
  });

  it('does not expose a late restored draft after the account changes', async () => {
    repository.getMealPlan.mockImplementation(async (_week, scope) => record(plan(scope)));
    const pending = deferred();
    repository.restoreOverdueMealPlanDraft.mockReturnValue(pending.promise);
    const { result, rerender } = renderHook(() => useMealPlan('2026-09-14'));
    await waitFor(() => expect(result.current.ready).toBe(true));
    const oldRestore = result.current.restoreOverdueDraft;
    let request;
    act(() => { request = oldRestore(); });
    authState.storageScope = 'user:alice';
    rerender();
    await waitFor(() => expect(result.current.plan?.scope).toBe('user:alice'));
    await act(async () => {
      pending.resolve(record(plan('guest', 2)));
      expect(await request).toBeNull();
      expect(await oldRestore()).toBeNull();
    });
    expect(result.current.plan.scope).toBe('user:alice');
    expect(repository.restoreOverdueMealPlanDraft).toHaveBeenCalledTimes(1);
  });

  it('loads the requested scoped week and commits only after a successful save', async () => {
    const save = deferred();
    repository.saveMealPlan.mockReturnValue(save.promise);
    const { result } = renderHook(() => useMealPlan('2026-09-14'));
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(repository.getMealPlan).toHaveBeenCalledWith('2026-09-14', 'guest');
    let pending;
    act(() => { pending = result.current.savePlan(plan()); });
    expect(result.current.saving).toBe(true);
    expect(result.current.plan).toBeNull();
    await act(async () => { save.resolve(record(plan())); await pending; });
    expect(result.current.plan).toEqual(plan());
    expect(result.current.saving).toBe(false);
  });

  it('preserves the previous plan on failed saves and permits retry', async () => {
    repository.getMealPlan.mockResolvedValue(record(plan()));
    repository.saveMealPlan.mockRejectedValue(new Error('저장 공간 부족'));
    const { result } = renderHook(() => useMealPlan('2026-09-14'));
    await waitFor(() => expect(result.current.ready).toBe(true));
    await act(async () => { expect(await result.current.savePlan(plan('guest', 2))).toBeNull(); });
    expect(result.current.plan).toEqual(plan());
    expect(result.current.error).toBe('저장 공간 부족');
    expect(result.current.ready).toBe(true);
    repository.saveMealPlan.mockImplementation(async (next) => record(next));
    await act(async () => { await result.current.savePlan(plan('guest', 2)); });
    expect(result.current.plan.revision).toBe(2);
    expect(result.current.error).toBe('');
  });

  it('keeps an empty editor ready after its first save fails', async () => {
    repository.saveMealPlan.mockRejectedValueOnce(new Error('저장 공간 부족'));
    const { result } = renderHook(() => useMealPlan('2026-09-14'));
    await waitFor(() => expect(result.current.ready).toBe(true));
    await act(async () => { await result.current.savePlan(plan()); });
    expect(result.current.plan).toBeNull();
    expect(result.current.ready).toBe(true);
    expect(result.current.loading).toBe(false);
    await act(async () => { await result.current.savePlan(plan()); });
    expect(result.current.plan).toEqual(plan());
  });

  it('does not permit generation after a read failure until retry succeeds', async () => {
    repository.getMealPlan.mockRejectedValue(new Error('미지원 식단 형식'));
    const { result } = renderHook(() => useMealPlan('2026-09-14'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.ready).toBe(false);
    await act(async () => { await result.current.savePlan(plan()); });
    expect(repository.saveMealPlan).not.toHaveBeenCalled();
    repository.getMealPlan.mockResolvedValue(null);
    act(() => result.current.retryLoad());
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.error).toBe('');
  });

  it('waits for auth verification and never exposes an old account plan during a switch', async () => {
    const observed = [];
    authState.loading = true;
    repository.getMealPlan.mockImplementation(async (_week, scope) => record(plan(scope)));
    const { result, rerender } = renderHook(() => {
      const value = useMealPlan('2026-09-14');
      observed.push({ scope: authState.storageScope, plan: value.plan });
      return value;
    });
    expect(repository.getMealPlan).not.toHaveBeenCalled();
    expect(result.current.plan).toBeNull();
    authState.loading = false;
    rerender();
    await waitFor(() => expect(result.current.plan?.scope).toBe('guest'));
    authState.storageScope = 'user:alice';
    rerender();
    await waitFor(() => expect(result.current.plan?.scope).toBe('user:alice'));
    expect(observed.every((value) => !value.plan || value.plan.scope === value.scope)).toBe(true);
    authState.loading = true;
    rerender();
    expect(result.current.plan).toBeNull();
    expect(result.current.ready).toBe(false);
  });

  it('ignores old scope and week loads that finish after navigation', async () => {
    const old = deferred();
    repository.getMealPlan.mockReturnValueOnce(old.promise).mockResolvedValue(record(plan('user:alice', 1, '2026-09-21')));
    const { result, rerender } = renderHook(({ week }) => useMealPlan(week), { initialProps: { week: '2026-09-14' } });
    authState.storageScope = 'user:alice';
    rerender({ week: '2026-09-21' });
    await waitFor(() => expect(result.current.ready).toBe(true));
    await act(async () => { old.resolve(record(plan())); await old.promise; });
    expect(result.current.plan).toEqual(plan('user:alice', 1, '2026-09-21'));
  });

  it('does not expose stale saves after switching accounts, even when returning to the original scope', async () => {
    const save = deferred();
    repository.getMealPlan.mockImplementation(async (_week, scope) => record(plan(scope)));
    repository.saveMealPlan.mockReturnValue(save.promise);
    const { result, rerender } = renderHook(() => useMealPlan('2026-09-14'));
    await waitFor(() => expect(result.current.ready).toBe(true));
    let pending;
    act(() => { pending = result.current.savePlan(plan('guest', 2)); });
    authState.storageScope = 'user:alice';
    rerender();
    await waitFor(() => expect(result.current.plan?.scope).toBe('user:alice'));
    authState.storageScope = 'guest';
    rerender();
    await waitFor(() => expect(result.current.plan?.scope).toBe('guest'));
    await act(async () => { save.resolve(record(plan('guest', 2))); expect(await pending).toBeNull(); });
    expect(result.current.plan.revision).toBe(1);
    expect(repository.saveMealPlan).toHaveBeenCalledWith(plan('guest', 2), 'guest', 1);
  });

  it('guards rapid double saves before React has rendered saving state', async () => {
    const save = deferred();
    repository.saveMealPlan.mockReturnValue(save.promise);
    const { result } = renderHook(() => useMealPlan('2026-09-14'));
    await waitFor(() => expect(result.current.ready).toBe(true));
    let first;
    let second;
    act(() => { first = result.current.savePlan(plan()); second = result.current.savePlan(plan('guest', 2)); });
    expect(repository.saveMealPlan).toHaveBeenCalledTimes(1);
    expect(await second).toBeNull();
    await act(async () => { save.resolve(record(plan())); await first; });
    expect(result.current.plan.revision).toBe(1);
  });

  it('rejects save callbacks captured from a previous account and mismatched input', async () => {
    const { result, rerender } = renderHook(() => useMealPlan('2026-09-14'));
    await waitFor(() => expect(result.current.ready).toBe(true));
    const oldSave = result.current.savePlan;
    authState.storageScope = 'user:alice';
    rerender();
    await waitFor(() => expect(result.current.ready).toBe(true));
    await act(async () => { await oldSave(plan()); await result.current.savePlan(plan()); });
    expect(repository.saveMealPlan).not.toHaveBeenCalled();
    expect(result.current.error).toContain('현재 계정');
  });

  it('invalidates captured save callbacks while auth is being verified', async () => {
    const { result, rerender } = renderHook(() => useMealPlan('2026-09-14'));
    await waitFor(() => expect(result.current.ready).toBe(true));
    const oldSave = result.current.savePlan;
    authState.loading = true;
    rerender();
    await act(async () => { await oldSave(plan()); });
    expect(repository.saveMealPlan).not.toHaveBeenCalled();
    authState.loading = false;
    rerender();
    await waitFor(() => expect(result.current.ready).toBe(true));
    await act(async () => { await oldSave(plan()); });
    expect(repository.saveMealPlan).not.toHaveBeenCalled();
  });

  it('exposes the editing draft separately from the unchanged confirmed plan', async () => {
    const confirmed = plan();
    const draft = plan('guest', 3);
    repository.getMealPlan.mockResolvedValue(record(draft, confirmed, 3));
    const { result } = renderHook(() => useMealPlan('2026-09-14'));
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.plan).toEqual(draft);
    expect(result.current.confirmedPlan).toEqual(confirmed);
    expect(result.current.hasDraft).toBe(true);
    expect(result.current.recordRevision).toBe(3);
  });

  it('confirms only after successful persistence and uses the record revision, not the plan revision', async () => {
    const draft = plan();
    const confirmation = deferred();
    repository.getMealPlan.mockResolvedValue(record(draft, null, 4));
    repository.confirmMealPlan.mockReturnValue(confirmation.promise);
    const { result } = renderHook(() => useMealPlan('2026-09-14'));
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.confirmPlan).toBeTypeOf('function');
    let pending;
    act(() => { pending = result.current.confirmPlan(); });
    expect(result.current.saving).toBe(true);
    expect(result.current.confirmedPlan).toBeNull();
    await waitFor(() => expect(repository.confirmMealPlan).toHaveBeenCalledWith('2026-09-14', 'guest', 4));
    await act(async () => {
      confirmation.resolve(record(null, draft, 5));
      expect(await pending).toEqual(draft);
    });
    expect(result.current.confirmedPlan).toEqual(draft);
    expect(result.current.plan).toEqual(draft);
    expect(result.current.hasDraft).toBe(false);
    expect(result.current.recordRevision).toBe(5);
  });

  it('keeps both plans on failed confirmation and allows an explicit retry', async () => {
    const confirmed = plan();
    const draft = plan('guest', 3);
    repository.getMealPlan.mockResolvedValue(record(draft, confirmed, 3));
    repository.confirmMealPlan.mockRejectedValueOnce(new Error('다른 탭에서 변경됐어요'))
      .mockResolvedValue(record(null, draft, 4));
    const { result } = renderHook(() => useMealPlan('2026-09-14'));
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.confirmPlan).toBeTypeOf('function');
    await act(async () => { expect(await result.current.confirmPlan()).toBeNull(); });
    expect(result.current.confirmedPlan).toEqual(confirmed);
    expect(result.current.plan).toEqual(draft);
    expect(result.current.hasDraft).toBe(true);
    expect(result.current.error).toContain('다른 탭');
    await act(async () => { await result.current.confirmPlan(); });
    expect(result.current.confirmedPlan).toEqual(draft);
    expect(result.current.error).toBe('');
  });

  it('blocks double confirmation and edits while confirmation is in flight', async () => {
    const draft = plan();
    const confirmation = deferred();
    repository.getMealPlan.mockResolvedValue(record(draft));
    repository.confirmMealPlan.mockReturnValue(confirmation.promise);
    const { result } = renderHook(() => useMealPlan('2026-09-14'));
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.confirmPlan).toBeTypeOf('function');
    let pending;
    await act(async () => {
      pending = result.current.confirmPlan();
      expect(await result.current.confirmPlan()).toBeNull();
      expect(await result.current.savePlan(plan('guest', 2))).toBeNull();
    });
    await waitFor(() => expect(repository.confirmMealPlan).toHaveBeenCalledTimes(1));
    expect(repository.saveMealPlan).not.toHaveBeenCalled();
    await act(async () => { confirmation.resolve(record(null, draft, 2)); await pending; });
    await act(async () => { expect(await result.current.confirmPlan()).toBeNull(); });
    expect(repository.confirmMealPlan).toHaveBeenCalledTimes(1);
  });

  it('never lets an old confirmation callback confirm an unseen newer draft in the same week', async () => {
    repository.getMealPlan.mockResolvedValue(record(plan()));
    repository.saveMealPlan.mockResolvedValue(record(plan('guest', 2)));
    const { result } = renderHook(() => useMealPlan('2026-09-14'));
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.confirmPlan).toBeTypeOf('function');
    const oldConfirm = result.current.confirmPlan;
    await act(async () => { await result.current.savePlan(plan('guest', 2)); });
    await act(async () => { expect(await oldConfirm()).toBeNull(); });
    expect(repository.confirmMealPlan).not.toHaveBeenCalled();
  });

  it('hides late confirmations across account and week changes, including return navigation', async () => {
    const confirmation = deferred();
    repository.getMealPlan.mockImplementation(async (week, scope) => record(plan(scope, 1, week)));
    repository.confirmMealPlan.mockReturnValue(confirmation.promise);
    const { result, rerender } = renderHook(({ week }) => useMealPlan(week), { initialProps: { week: '2026-09-14' } });
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.confirmPlan).toBeTypeOf('function');
    const oldConfirm = result.current.confirmPlan;
    let pending;
    act(() => { pending = oldConfirm(); });
    authState.storageScope = 'user:alice';
    rerender({ week: '2026-09-21' });
    expect(result.current.confirmedPlan).toBeNull();
    await waitFor(() => expect(result.current.plan?.scope).toBe('user:alice'));
    authState.storageScope = 'guest';
    rerender({ week: '2026-09-14' });
    await waitFor(() => expect(result.current.plan?.scope).toBe('guest'));
    await act(async () => {
      confirmation.resolve(record(null, plan(), 2));
      expect(await pending).toBeNull();
      expect(await oldConfirm()).toBeNull();
    });
    expect(result.current.confirmedPlan).toBeNull();
    expect(result.current.hasDraft).toBe(true);
    expect(result.current.recordRevision).toBe(1);
  });

  it.each(['confirm', 'draft'])('blocks %s immediately when reload is requested in the same event', async (action) => {
    const refresh = deferred();
    repository.getMealPlan.mockResolvedValueOnce(record(plan())).mockReturnValueOnce(refresh.promise);
    const { result } = renderHook(() => useMealPlan('2026-09-14'));
    await waitFor(() => expect(result.current.ready).toBe(true));
    let pending;
    act(() => {
      result.current.retryLoad();
      pending = action === 'confirm' ? result.current.confirmPlan() : result.current.savePlan(plan('guest', 2));
    });
    expect(repository.confirmMealPlan).not.toHaveBeenCalled();
    expect(repository.saveMealPlan).not.toHaveBeenCalled();
    expect(result.current.ready).toBe(false);
    expect(result.current.loading).toBe(true);
    expect(await pending).toBeNull();
    await act(async () => {
      expect(await result.current.confirmPlan()).toBeNull();
      refresh.resolve(record(plan('guest', 2)));
      await refresh.promise;
    });
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.recordRevision).toBe(2);
  });
});
