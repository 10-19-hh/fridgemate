import { useCallback, useEffect, useRef, useState } from 'react';
import { confirmMealPlan, getMealPlan, restoreOverdueMealPlanDraft, saveMealPlan } from '../features/mealPlans/mealPlanRepository';
import { useAuth } from './useAuth';
import { createMealPlanPilotOperation, runMealPlanPilotAction } from '../features/mealPlans/mealPlanPilotActions';
import { isMealPlanFeedback } from '../features/mealPlans/mealPlanFeedback';

function emptyState(key) {
  return { key, record: null, loading: true, saving: false, ready: false, error: '' };
}

function copyFeedback(input) {
  if (!input || Reflect.ownKeys(input).length !== 3
    || !['slotId', 'changeType', 'reasonCode'].every(field => Object.hasOwn(input, field))
    || !isMealPlanFeedback(input.changeType, input.reasonCode)
    || typeof input.slotId !== 'string') return null;
  return { slotId: input.slotId, changeType: input.changeType, reasonCode: input.reasonCode };
}

function slotFeedback(input, before, after, confirmed, occurredAt) {
  if (!input || input.slotId !== after?.id || before?.status !== 'planned') return {};
  const replacement = input.changeType === 'replace' && after.status === 'planned'
    && before.templateKey !== after.templateKey;
  const skip = after.status === 'skipped' && before.templateKey === after.templateKey;
  const now = new Date(occurredAt);
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const notCooked = input.changeType === 'not_cooked' && skip
    && confirmed?.status === 'planned' && confirmed.date < today;
  return replacement || notCooked || (input.changeType === 'skip' && skip)
    ? { changeType: input.changeType, reasonCode: input.reasonCode } : {};
}

export function useMealPlan(weekStart) {
  const { storageScope = 'guest', loading: authLoading = false } = useAuth();
  const key = `${storageScope}|${weekStart}`;
  const [state, setState] = useState(() => emptyState(key));
  const [loadAttempt, setLoadAttempt] = useState(0);
  const contextRef = useRef({ key, authLoading });
  const loadRef = useRef(0);
  const saveRef = useRef(null);
  const mountedRef = useRef(false);
  const refreshRef = useRef(null);
  const stateRef = useRef(state);
  stateRef.current = state;

  // Tag results during render, not only after effects, so old account data is never briefly exposed.
  if (contextRef.current.key !== key || contextRef.current.authLoading !== authLoading) {
    contextRef.current = { key, authLoading };
  }
  const renderedContext = contextRef.current;

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    const context = contextRef.current;
    const request = ++loadRef.current;
    let active = true;
    if (authLoading) return () => { active = false; };

    setState((previous) => ({
      ...emptyState(key),
      record: previous.key === key ? previous.record : null
    }));

    getMealPlan(weekStart, storageScope).then((record) => {
      if (active && contextRef.current === context && loadRef.current === request) {
        refreshRef.current = null;
        setState({ key, record, loading: false, saving: false, ready: true, error: '' });
      }
    }).catch((error) => {
      if (active && contextRef.current === context && loadRef.current === request) {
        refreshRef.current = null;
        setState((previous) => ({
          ...previous,
          loading: false,
          error: error?.message || '식단을 불러오지 못했습니다. 저장소를 확인한 뒤 다시 시도해주세요.'
        }));
      }
    });

    return () => { active = false; };
  }, [authLoading, key, loadAttempt, storageScope, weekStart]);

  const persist = useCallback(async (action, nextPlan, feedback) => {
    const context = renderedContext;
    if (!mountedRef.current || authLoading || contextRef.current !== context
      || context.key !== key || state.key !== key || state.loading || !state.ready
      || stateRef.current !== state
      || refreshRef.current === context
      || saveRef.current?.context === context) return null;
    if (!['draft', 'generate'].includes(action) && !state.record?.draft) return null;
    if (action === 'draft' && (nextPlan?.scope !== storageScope || nextPlan?.weekStart !== weekStart)) {
      setState((previous) => ({ ...previous, error: '현재 계정과 선택한 주의 식단인지 확인해주세요.' }));
      return null;
    }

    const operation = { context };
    saveRef.current = operation;
    ++loadRef.current;
    setState((previous) => ({ ...previous, saving: true, error: '' }));

    try {
      const expectedRevision = state.record?.revision ?? 0;
      const previousPlan = state.record?.draft ?? state.record?.confirmed;
      const copiedPlan = action === 'draft' ? structuredClone(nextPlan) : null;
      // Capture a one-time choice before opening the asynchronous observation.
      // Only a matching, committed slot transition may carry it into the export.
      const copiedFeedback = action === 'draft' ? copyFeedback(feedback) : null;
      const changedSlots = copiedPlan?.slots.filter(slot => {
        const before = previousPlan?.slots.find(item => item.id === slot.id);
        return before && JSON.stringify(before) !== JSON.stringify(slot);
      }) ?? [];
      const write = () => {
        if (action === 'confirm') return confirmMealPlan(weekStart, storageScope, expectedRevision);
        if (action === 'restore-overdue') return restoreOverdueMealPlanDraft(weekStart, storageScope, expectedRevision);
        const generated = action === 'generate' ? nextPlan() : copiedPlan;
        if (generated?.scope !== storageScope || generated?.weekStart !== weekStart) {
          throw new Error('현재 계정과 선택한 주의 식단인지 확인해주세요.');
        }
        return saveMealPlan(generated, storageScope, expectedRevision);
      };
      const name = action === 'generate' ? 'meal_plan_generated'
        : action === 'confirm' ? 'meal_plan_confirmed' : 'meal_slot_changed';
      const pilot = createMealPlanPilotOperation(name, { planKey: `week:${weekStart}` });
      const observe = action === 'generate' || action === 'confirm' || changedSlots.length > 0;
      const record = observe ? await runMealPlanPilotAction({ scope: storageScope, ...pilot,
        isCurrent: () => mountedRef.current && contextRef.current === context && saveRef.current === operation,
        ...(action === 'generate' ? { startEvent: { name: 'meal_plan_generation_started', status: 'started',
          sourceKey: `meal_plan_generation_started:${pilot.operationKey}`, operationKey: pilot.operationKey,
          occurredAt: new Date().toISOString(), planKey: `week:${weekStart}` } } : {}),
      }, write, saved => {
        const committedPlan = action === 'confirm' ? saved.confirmed : saved.draft;
        const common = { name, status: 'success', occurredAt: saved.updatedAt, planKey: saved.id,
          operationKey: action === 'generate' ? pilot.operationKey : `${name}:${saved.id}@${saved.revision}` };
        if (action === 'generate' || action === 'confirm') return [{ ...common,
          sourceKey: `${name}:${saved.id}@${saved.revision}`,
          plannedSlotCount: committedPlan.slots.filter(slot => slot.status === 'planned').length,
          engineVersion: committedPlan.engineVersion }];
        return changedSlots.map(slot => ({ ...common,
          sourceKey: `${name}:${saved.id}@${saved.revision}:${slot.id}`, slotKey: slot.id,
          ...slotFeedback(copiedFeedback, previousPlan?.slots.find(item => item.id === slot.id),
            committedPlan.slots.find(item => item.id === slot.id),
            state.record?.confirmed?.slots.find(item => item.id === slot.id), saved.updatedAt),
        }));
      }) : await write();
      if (!record) return null;
      if (mountedRef.current && contextRef.current === context && saveRef.current === operation) {
        setState({ key, record, loading: false, saving: false, ready: true, error: '' });
        return action === 'confirm' ? record.confirmed : record.draft;
      }
      return null;
    } catch (error) {
      if (mountedRef.current && contextRef.current === context && saveRef.current === operation) {
        setState((previous) => ({
          ...previous,
          saving: false,
          error: error?.message || '식단을 저장하지 못했습니다. 기존 초안과 확정 식단을 유지했습니다. 다시 시도해주세요.'
        }));
      }
      return null;
    } finally {
      if (saveRef.current === operation) saveRef.current = null;
    }
  }, [authLoading, key, renderedContext, state, storageScope, weekStart]);

  const savePlan = useCallback((nextPlan, feedback) => persist('draft', nextPlan, feedback), [persist]);
  const generatePlan = useCallback((createPlan) => persist('generate', createPlan), [persist]);
  const confirmPlan = useCallback(() => persist('confirm'), [persist]);
  const restoreOverdueDraft = useCallback(() => persist('restore-overdue'), [persist]);

  const retryLoad = useCallback(() => {
    const context = contextRef.current;
    if (saveRef.current?.context === context) return;
    // Close the write gate synchronously, before React runs the loading effect.
    refreshRef.current = context;
    ++loadRef.current;
    setState((previous) => previous.key === context.key
      ? { ...previous, ready: false, loading: true } : previous);
    setLoadAttempt((attempt) => attempt + 1);
  }, []);

  const visibleState = !authLoading && state.key === key ? state : emptyState(key);
  const record = visibleState.record;
  // Display is derived from the committed storage response, never optimistic state.
  return {
    ...visibleState, plan: record?.draft ?? record?.confirmed ?? null,
    confirmedPlan: record?.confirmed ?? null, hasDraft: Boolean(record?.draft),
    recordRevision: record?.revision ?? 0, savePlan, generatePlan, confirmPlan, restoreOverdueDraft, retryLoad, storageScope,
  };
}
