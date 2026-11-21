import { describe, expect, it } from 'vitest';
import { getPlanningSlotBasis, reconcilePlanningCommitments } from '../mealPlanningBindings.js';

function plan(overrides = {}) {
  return {
    id: 'week:2026-09-14', schemaVersion: 1, scope: 'guest', weekStart: '2026-09-14', revision: 1,
    preferences: { servings: 1, excludedIngredients: ['양파', '가지'], dinnerDays: [0, 2] },
    slots: [slot(), slot({ id: '2026-09-16:dinner', date: '2026-09-16' })], ...overrides,
  };
}

function slot(overrides = {}) {
  return {
    id: '2026-09-14:dinner', date: '2026-09-14', mealType: 'dinner', status: 'planned', servings: 1,
    templateKey: 'test:dinner', templateVersion: 1, locked: false, title: '테스트 메뉴', reason: '', notice: null,
    components: [{ id: 'test:side', ingredients: [{ rawName: '테스트 재료', amount: null, unit: null }] }],
    ...overrides,
  };
}

function state(previous = plan(), overrides = {}) {
  return {
    id: 'state', schemaVersion: 1, scope: 'guest', revision: 4,
    stockInventoryBasis: null, stockConfirmations: [],
    commitments: [{ id: 'test:choice', planId: previous.id, slotId: previous.slots[0].id,
      status: 'active', slotBasis: getPlanningSlotBasis(previous, previous.slots[0]),
      quantityChoice: { scaleFactor: 0.5, targetServings: 1, selectedLineIds: ['test:line'] } }],
    ...overrides,
  };
}

function changeSlot(previous, fields) {
  return { ...previous, revision: previous.revision + 1,
    slots: previous.slots.map((entry, index) => index ? entry : { ...entry, ...fields }) };
}

function deepFreeze(value) {
  Object.values(value).forEach((entry) => {
    if (entry && typeof entry === 'object') deepFreeze(entry);
  });
  return Object.freeze(value);
}

describe('getPlanningSlotBasis', () => {
  it('binds only the requested quantity placement and sorted exclusions deterministically', () => {
    const previous = plan();
    expect(getPlanningSlotBasis(previous, previous.slots[0])).toBe(
      '[{"components":[{"id":"test:side","ingredients":[{"amount":null,"rawName":"테스트 재료","unit":null}]}],"date":"2026-09-14","dinnerIncluded":true,"excludedIngredients":["가지","양파"],"id":"2026-09-14:dinner","mealType":"dinner","servings":1,"status":"planned","templateKey":"test:dinner","templateVersion":1}]'
    );
    const reordered = structuredClone(previous);
    reordered.preferences.excludedIngredients.reverse();
    reordered.slots[0].components = [{ ingredients: [{ unit: null, rawName: '테스트 재료', amount: null }], id: 'test:side' }];
    expect(getPlanningSlotBasis(reordered, reordered.slots[0])).toBe(getPlanningSlotBasis(previous, previous.slots[0]));
  });

  it.each([
    ['lock', { locked: true }], ['reason', { reason: '다른 설명' }],
    ['notice', { notice: '기한 확인' }], ['title', { title: '표시만 변경' }],
  ])('does not rebind for %s alone', (_label, fields) => {
    const previous = plan();
    const next = changeSlot(previous, fields);
    expect(getPlanningSlotBasis(next, next.slots[0])).toBe(getPlanningSlotBasis(previous, previous.slots[0]));
  });

  it('ignores plan revision, other slots and other dinner-day choices', () => {
    const previous = plan();
    const next = plan({ revision: 20,
      preferences: { ...previous.preferences, dinnerDays: [0, 1, 6] },
      slots: [previous.slots[0], slot({ id: '2026-09-16:dinner', date: '2026-09-16', servings: 2 })],
    });
    expect(getPlanningSlotBasis(next, next.slots[0])).toBe(getPlanningSlotBasis(previous, previous.slots[0]));
  });

  it.each([
    ['date/id', { id: '2026-09-15:dinner', date: '2026-09-15' }],
    ['status', { status: 'skipped' }], ['servings', { servings: 2 }],
    ['template key', { templateKey: 'test:new-menu' }], ['template version', { templateVersion: 2 }],
    ['component contents', { components: [{ id: 'test:side', ingredients: [{ rawName: '새 재료', amount: null, unit: null }] }] }],
  ])('changes the binding for %s', (_label, fields) => {
    const previous = plan();
    const next = changeSlot(previous, fields);
    expect(getPlanningSlotBasis(next, next.slots[0])).not.toBe(getPlanningSlotBasis(previous, previous.slots[0]));
  });

  it('binds the target date dinner choice independently of slot array order', () => {
    const previous = plan();
    const reordered = { ...previous, slots: [...previous.slots].reverse() };
    expect(getPlanningSlotBasis(reordered, reordered.slots[1])).toBe(getPlanningSlotBasis(previous, previous.slots[0]));
    const excludedDay = { ...previous, preferences: { ...previous.preferences, dinnerDays: [2] } };
    expect(getPlanningSlotBasis(excludedDay, excludedDay.slots[0])).not.toBe(getPlanningSlotBasis(previous, previous.slots[0]));
  });

  it('changes the binding when excluded ingredients change', () => {
    const previous = plan();
    const next = { ...previous, preferences: { ...previous.preferences, excludedIngredients: ['양파', '가지', '마늘'] } };
    expect(getPlanningSlotBasis(next, next.slots[0])).not.toBe(getPlanningSlotBasis(previous, previous.slots[0]));
  });

  it.each([
    ['missing plan', () => null], ['future schema', () => plan({ schemaVersion: 2 })],
    ['bad week date', () => plan({ weekStart: '2026-02-30' })],
    ['bad exclusions', () => plan({ preferences: { servings: 1, excludedIngredients: [5], dinnerDays: [0] } })],
    ['bad dinner choice', () => plan({ preferences: { servings: 1, excludedIngredients: [], dinnerDays: [7] } })],
    ['missing slots', () => plan({ slots: null })],
  ])('rejects %s instead of creating a reusable binding', (_label, create) => {
    expect(() => getPlanningSlotBasis(create(), slot())).toThrow();
  });

  it.each([
    ['bad slot date', { date: '2026-02-30' }], ['missing slot id', { id: '' }],
    ['different meal', { mealType: 'lunch' }], ['bad status', { status: 'confirmed' }],
    ['invalid servings', { servings: 0 }], ['invalid component list', { components: null }],
    ['unsupported JSON data', { components: [{ amount: undefined }] }],
  ])('rejects %s', (_label, fields) => {
    const previous = plan();
    expect(() => getPlanningSlotBasis(previous, slot(fields))).toThrow();
  });
});

describe('reconcilePlanningCommitments', () => {
  it('keeps active choices for unchanged slots across lock, notice and unrelated revision changes', () => {
    const previous = plan();
    const current = state(previous);
    const next = changeSlot(previous, { locked: true, notice: '설명만 변경' });
    expect(reconcilePlanningCommitments(current, previous, next)).toEqual(current);
  });

  it.each([
    ['servings', { servings: 2 }, 'slot_changed'],
    ['menu key', { templateKey: 'test:new-menu' }, 'slot_changed'],
    ['components', { components: [{ id: 'test:other-side' }] }, 'slot_changed'],
    ['skip', { status: 'skipped' }, 'skipped'],
  ])('suspends active choices once after %s changes', (_label, fields, suspensionReason) => {
    const previous = plan();
    const current = state(previous);
    const next = changeSlot(previous, fields);
    const result = reconcilePlanningCommitments(current, previous, next);
    expect(result).toEqual({ ...current, revision: 5,
      commitments: [{ ...current.commitments[0], status: 'suspended', suspensionReason }],
    });
    expect(reconcilePlanningCommitments(result, next, previous)).toEqual(result);
  });

  it('suspends on preference conflicts without deleting quantities or changing the menu', () => {
    const previous = plan();
    const current = state(previous);
    const next = { ...previous, preferences: { ...previous.preferences, excludedIngredients: ['가지'] } };
    const result = reconcilePlanningCommitments(current, previous, next);
    expect(result.commitments[0]).toEqual({ ...current.commitments[0], status: 'suspended', suspensionReason: 'slot_changed' });
    expect(result.revision).toBe(5);
    expect(next.slots).toEqual(previous.slots);
  });

  it('suspends when the target dinner is deselected even if the menu snapshot remains', () => {
    const previous = plan();
    const next = { ...previous, preferences: { ...previous.preferences, dinnerDays: [2] } };
    expect(reconcilePlanningCommitments(state(previous), previous, next).commitments[0])
      .toMatchObject({ status: 'suspended', suspensionReason: 'slot_changed' });
  });

  it('suspends a missing unlocked slot but does not touch another week or previously suspended choices', () => {
    const previous = plan();
    const current = state(previous);
    const otherWeek = { ...current.commitments[0], id: 'other-week', planId: 'week:2026-09-21' };
    const suspended = { ...current.commitments[0], id: 'already-suspended', status: 'suspended', suspensionReason: 'skipped' };
    current.commitments.push(otherWeek, suspended);
    const next = { ...previous, slots: [previous.slots[1]] };
    const result = reconcilePlanningCommitments(current, previous, next);
    expect(result.commitments).toEqual([
      { ...current.commitments[0], status: 'suspended', suspensionReason: 'slot_changed' }, otherWeek, suspended,
    ]);
    expect(result.revision).toBe(5);
  });

  it('marks explicit whole-plan removal, including locked placements, without reactivating older suspensions', () => {
    const previous = plan({ slots: [slot({ locked: true })] });
    const current = state(previous);
    const result = reconcilePlanningCommitments(current, previous, null);
    expect(result.commitments[0]).toEqual({ ...current.commitments[0], status: 'suspended', suspensionReason: 'plan_removed' });
    expect(result.revision).toBe(5);
  });

  it('increments the state revision only once when multiple active choices are suspended', () => {
    const previous = plan();
    const current = state(previous);
    current.commitments.push({ ...current.commitments[0], id: 'second', slotId: previous.slots[1].id,
      slotBasis: getPlanningSlotBasis(previous, previous.slots[1]) });
    const result = reconcilePlanningCommitments(current, previous, null);
    expect(result.revision).toBe(5);
    expect(result.commitments.map((entry) => entry.status)).toEqual(['suspended', 'suspended']);
  });

  it('accepts empty revision-zero state without creating a saved change', () => {
    const previous = plan();
    const current = state(previous, { revision: 0, commitments: [] });
    expect(reconcilePlanningCommitments(current, previous, null)).toEqual(current);
  });

  it('returns independent copies without mutating frozen nested stock or quantity choices', () => {
    const previous = deepFreeze(plan());
    const current = deepFreeze(state(previous, { stockInventoryBasis: '[]', stockConfirmations: [{ nested: { keep: 'yes' } }] }));
    const next = deepFreeze(changeSlot(previous, { servings: 2 }));
    const result = reconcilePlanningCommitments(current, previous, next);
    expect(result.commitments).toHaveLength(1);
    result.commitments[0].quantityChoice.selectedLineIds.push('injected');
    result.stockConfirmations[0].nested.keep = 'changed';
    expect(current.commitments[0].quantityChoice.selectedLineIds).toEqual(['test:line']);
    expect(current.stockConfirmations[0].nested.keep).toBe('yes');
    expect(current.revision).toBe(4);
    expect(previous.slots[0].servings).toBe(1);
  });

  it.each([
    ['skip', { status: 'skipped' }], ['template replacement', { templateKey: 'new' }],
    ['template revision', { templateVersion: 2 }], ['component edit', { components: [] }],
    ['unlock and skip together', { locked: false, status: 'skipped' }],
    ['unlock and replace together', { locked: false, templateKey: 'new' }],
  ])('rejects locked-slot %s even with no saved commitments', (_label, fields) => {
    const previous = plan({ slots: [slot({ locked: true })] });
    expect(() => reconcilePlanningCommitments(state(previous, { commitments: [] }), previous, changeSlot(previous, fields))).toThrow();
  });

  it('rejects removing a locked slot inside an otherwise retained plan', () => {
    const previous = plan({ slots: [slot({ locked: true })] });
    expect(() => reconcilePlanningCommitments(state(previous), previous, { ...previous, slots: [] })).toThrow();
  });

  it('allows an explicit unlock before a later skip', () => {
    const previous = plan({ slots: [slot({ locked: true })] });
    const current = state(previous);
    const unlocked = changeSlot(previous, { locked: false });
    const retained = reconcilePlanningCommitments(current, previous, unlocked);
    expect(retained).toEqual(current);
    const skipped = changeSlot(unlocked, { status: 'skipped' });
    expect(reconcilePlanningCommitments(retained, unlocked, skipped).commitments[0])
      .toMatchObject({ status: 'suspended', suspensionReason: 'skipped' });
  });

  it('allows changed servings on a locked slot but suspends its quantity choice', () => {
    const previous = plan({ slots: [slot({ locked: true })] });
    const result = reconcilePlanningCommitments(state(previous), previous, changeSlot(previous, { servings: 2 }));
    expect(result.commitments[0]).toMatchObject({ status: 'suspended', suspensionReason: 'slot_changed' });
  });

  it('rejects revision overflow only when a commitment would change', () => {
    const previous = plan();
    const current = state(previous, { revision: Number.MAX_SAFE_INTEGER });
    expect(reconcilePlanningCommitments(current, previous, previous).revision).toBe(Number.MAX_SAFE_INTEGER);
    expect(() => reconcilePlanningCommitments(current, previous, null)).toThrow();
  });

  it.each([
    ['missing state', null], ['future state', { schemaVersion: 2 }], ['negative revision', { revision: -1 }],
    ['fractional revision', { revision: 1.1 }], ['different account', { scope: 'user:alice' }],
    ['wrong state id', { id: 'other' }], ['missing stock list', { stockConfirmations: null }],
    ['missing commitments', { commitments: null }], ['bad commitment', { commitments: [{}] }],
    ['unsupported data', { extra: () => 1 }],
  ])('rejects %s instead of partially reconciling data', (_label, overrides) => {
    const previous = plan();
    expect(() => reconcilePlanningCommitments(overrides === null ? null : state(previous, overrides), previous, previous)).toThrow();
  });

  it.each([
    ['future plan', { schemaVersion: 2 }], ['different plan', { id: 'week:2026-09-21', weekStart: '2026-09-21' }],
    ['different account', { scope: 'user:alice' }], ['duplicate slot', { slots: [slot(), slot()] }],
  ])('rejects a %s transition', (_label, overrides) => {
    const previous = plan();
    expect(() => reconcilePlanningCommitments(state(previous), previous, { ...previous, ...overrides })).toThrow();
  });
});
