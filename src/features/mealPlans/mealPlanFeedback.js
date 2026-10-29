// Optional, fixed-choice feedback only. Never persist free text or turn a
// one-time reason into a lasting meal preference.
export const MEAL_PLAN_REASON_OPTIONS = [
  { value: 'taste', label: '취향에 맞지 않아서' },
  { value: 'ingredients', label: '재료가 없어서' },
  { value: 'cost', label: '비용이 부담돼서' },
  { value: 'difficulty', label: '만들기 어려워서' },
  { value: 'schedule', label: '일정이 바뀌어서' },
  { value: 'repetition', label: '같은 메뉴가 반복돼서' },
  { value: 'other', label: '다른 이유' },
];

export const MEAL_PLAN_CHANGE_TYPES = ['replace', 'skip', 'not_cooked'];

export function isMealPlanFeedback(changeType, reasonCode) {
  return MEAL_PLAN_CHANGE_TYPES.includes(changeType)
    && (reasonCode === 'not_answered' || MEAL_PLAN_REASON_OPTIONS.some(option => option.value === reasonCode));
}
