import { getMealQuantityRequirements } from './mealQuantityDomain.js';

export const PILOT_CANDIDATE_POLICY = 'source-reviewed-pilot-v1';
const APPROVED_DINNERS = new Set([
  'mfds-dinner:book2-spinach-risotto',
  'mfds-dinner:book2-chilgok-pomegranate-noodles',
  'mfds-dinner:book2-vegetable-jajang-noodles',
  'mfds-dinner:book2-soy-drink-pasta',
  'mfds-dinner:book2-potato-rice',
  'mfds-dinner:book2-doenjang-bibimbap',
]);
const hasText = value => typeof value === 'string' && value.trim().length > 0;

function isApprovedDinner(candidate) {
  if (!APPROVED_DINNERS.has(candidate?.key) || candidate.reviewStatus !== 'source-quantity-compared'
    || candidate.servings !== 1 || candidate.servingsStatus !== 'verified' || candidate.quantityStatus !== 'verified'
    || !Array.isArray(candidate.components) || candidate.components.length !== 1) return false;
  const [component] = candidate.components;
  if (component?.role !== 'main' || component.source?.kind !== 'mfds-book-source-comparison'
    || component.sourceServings !== 1 || component.servings !== 1 || !hasText(component.servingsEvidence)
    || !Array.isArray(component.ingredients) || !component.ingredients.length
    || !component.ingredients.every(line => line && line.selected === true && line.optional === false && line.amount > 0)
    || !component.ingredients.some(line => Array.isArray(line.foodGroups) && line.foodGroups.includes('grains'))) return false;
  try {
    // This validates measured food rows only. Unmeasured process water and the
    // source's cooking caveats remain unchanged, not promoted to full review.
    return getMealQuantityRequirements(candidate, 1).status === 'verified';
  } catch {
    return false;
  }
}

/** Candidate selection never rewrites catalog data or stored plan snapshots. */
export function selectMealPlanCandidates(catalog, policy = null) {
  if (!Array.isArray(catalog)) return [];
  if (policy === null) return catalog.slice();
  if (policy !== PILOT_CANDIDATE_POLICY) return [];
  return catalog.filter(isApprovedDinner);
}
