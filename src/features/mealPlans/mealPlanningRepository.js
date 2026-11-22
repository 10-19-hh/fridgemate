import { runMealPlanningTransaction } from '../../db/indexedDB.js';
import { assertMealPlanRecord } from './mealPlanRepository.js';
import { allocatePlannedMeals } from './mealPlanningAllocation.js';
import { deriveMealPlanShopping } from './mealPlanShopping.js';
import { getPlanningInventoryBasis, validatePlanningStockConfirmations } from './mealPlanningStock.js';
import { getPlanningSlotBasis } from './mealPlanningBindings.js';
import { buildConfirmedRecipeMeal, previewAllocatedRecipeMeal } from './mealPlanQuantityDomain.js';
import { publicRecipeCatalog } from '../recipes/publicRecipeCatalog.js';
import { getQuantityRecipeForPublicRecipe } from '../recipes/quantityRecipeCatalog.js';
import { normalizeIngredientName } from '../ingredients/ingredientDomain.js';

const COMPONENT_ID = 'quantity-side';
const commitmentId = (planId, slotId) => JSON.stringify([planId, slotId, COMPONENT_ID]);
const hasText = (value) => typeof value === 'string' && Boolean(value.trim());

function canonicalRecipe(id, version) {
  const source = publicRecipeCatalog.find((recipe) => `mfds:${recipe.externalId}` === id);
  const recipe = getQuantityRecipeForPublicRecipe(source);
  return recipe?.version === version ? recipe : null;
}

function hasExcludedIngredient(recipe, plan) {
  const key = (name) => normalizeIngredientName(name).replace(/\s+/g, '').toLowerCase();
  const excluded = new Set(plan.preferences.excludedIngredients.map(key));
  return recipe.ingredients.some((line) => excluded.has(key(line.rawName)));
}

function resolveScope(scope) {
  if (scope !== 'guest' && !/^user:[a-zA-Z0-9_-]+$/.test(scope || '')) {
    throw new Error('식단을 저장할 계정을 확인해주세요.');
  }
  return scope;
}

function calendarDate(asOf) {
  const date = new Date(asOf);
  if (validatePlanningStockConfirmations({ ingredients: [], confirmations: [], asOf }).status !== 'valid') {
    throw new Error('식단 계산 시각을 확인해주세요.');
  }
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const value = (type) => parts.find((part) => part.type === type).value;
  return `${value('year')}-${value('month')}-${value('day')}`;
}

function emptyState(scope) {
  return { id: 'state', schemaVersion: 1, scope, revision: 0,
    stockInventoryBasis: null, stockConfirmations: [], commitments: [] };
}

function validateState(state, scope) {
  if (!state || state.id !== 'state' || state.schemaVersion !== 1 || state.scope !== scope
    || !Number.isSafeInteger(state.revision) || state.revision < 1
    || !(state.stockInventoryBasis === null || typeof state.stockInventoryBasis === 'string')
    || !Array.isArray(state.stockConfirmations) || !Array.isArray(state.commitments)
    || (state.stockInventoryBasis === null && state.stockConfirmations.length)) {
    throw new Error('저장된 정량 식단 자료를 확인할 수 없습니다. 기존 자료는 유지됩니다.');
  }
  const ids = new Set();
  for (const item of state.commitments) {
    if (!item || ![item.planId, item.slotId, item.recipeId, item.recipeVersion, item.slotBasis].every(hasText)
      || item.id !== commitmentId(item.planId, item.slotId) || ids.has(item.id)
      || item.componentId !== COMPONENT_ID || !item.quantityChoice
      || !['active', 'suspended'].includes(item.status)
      || (item.status === 'suspended' && !['skipped', 'plan_removed', 'slot_changed'].includes(item.suspensionReason))) {
      throw new Error('저장된 정량 승인 자료를 확인해주세요. 기존 자료는 유지됩니다.');
    }
    ids.add(item.id);
  }
  return state;
}

function confirmedMeals(state, plans, scope, asOf) {
  const meals = [];
  const issues = [];
  for (const commitment of state.commitments) {
    if (commitment.status === 'suspended') {
      // A still-planned portion whose amount changed is not confirmed zero.
      // Explicit skipping/deletion does release demand; restoration is not approval.
      if (commitment.suspensionReason === 'slot_changed') {
        issues.push({ code: 'commitment_reconfirmation_required', commitmentId: commitment.id });
      }
      continue;
    }
    const plan = plans.find((entry) => entry.id === commitment.planId);
    const slot = plan?.slots.find((entry) => entry.id === commitment.slotId);
    const recipe = canonicalRecipe(commitment.recipeId, commitment.recipeVersion);
    if (!slot || slot.status !== 'planned' || getPlanningSlotBasis(plan, slot) !== commitment.slotBasis
      || !recipe || hasExcludedIngredient(recipe, plan)) {
      issues.push({ code: 'commitment_confirmation_stale', commitmentId: commitment.id });
      continue;
    }
    const built = buildConfirmedRecipeMeal({ recipe, scope, planId: plan.id, planRevision: plan.revision,
      slotId: slot.id, componentId: COMPONENT_ID, date: slot.date, locked: slot.locked,
      quantityChoice: commitment.quantityChoice });
    if (built.status !== 'valid' || commitment.quantityChoice.targetServings !== slot.servings
      || Date.parse(commitment.quantityChoice.confirmedAt) > Date.parse(asOf)) {
      issues.push({ code: 'commitment_confirmation_stale', commitmentId: commitment.id });
    } else meals.push(built.meal);
  }
  return { meals, issues };
}

function makeSnapshot(records, scope, asOf) {
  const fromDate = calendarDate(asOf);
  const ingredients = records.ingredients;
  // Quantity side dishes bind to each week's confirmed plan; drafts never create demand.
  const plans = records.confirmedPlans ?? records.plans.flatMap((record) => {
    const checked = assertMealPlanRecord(record, scope, record.weekStart);
    return checked.confirmed ? [checked.confirmed] : [];
  });
  const state = records.state === undefined ? emptyState(scope) : validateState(records.state, scope);
  const basis = { scope, fromDate, planningRevision: state.revision,
    inventoryBasis: getPlanningInventoryBasis(ingredients), plansBasis: JSON.stringify(plans) };
  const stale = state.stockInventoryBasis !== null && state.stockInventoryBasis !== basis.inventoryBasis;
  const stock = stale ? null : validatePlanningStockConfirmations({ ingredients,
    confirmations: state.stockConfirmations, asOf });
  if (stock?.status === 'invalid') throw new Error('저장된 재고 확인 자료를 확인해주세요. 기존 자료는 유지됩니다.');
  const inventory = stock ? { scope, revision: basis.inventoryBasis, items: stock.items } : null;
  const issues = stale ? [{ code: 'stock_confirmation_stale' }] : [];
  const confirmed = confirmedMeals(state, plans, scope, asOf);
  issues.push(...confirmed.issues);
  const meals = confirmed.meals;
  if (issues.length) return { scope, asOf, fromDate, ingredients, plans, state, basis, issues, meals,
    inventory, allocation: null, shopping: null };
  const allocation = allocatePlannedMeals({ scope, asOf, fromDate,
    inventory, meals });
  const shopping = deriveMealPlanShopping(allocation);
  if (allocation.status !== 'calculated' || shopping.status !== 'calculated') {
    return { scope, asOf, fromDate, ingredients, plans, state, basis, inventory, meals,
      issues: [{ code: 'allocation_calculation_failed' }], allocation: null, shopping: null };
  }
  return { scope, asOf, fromDate, ingredients, plans, state, basis, issues, inventory, meals,
    allocation, shopping };
}

function assertUnchanged(expected, current) {
  if (!expected || expected.scope !== current.scope) throw new Error('식단을 저장할 계정을 확인해주세요.');
  if (!['scope', 'fromDate', 'planningRevision', 'inventoryBasis', 'plansBasis']
    .every((key) => expected[key] === current[key])) {
    throw new Error('재고나 식단이 변경됐습니다. 다시 불러온 뒤 확인해주세요.');
  }
}

function nextRevision(state) {
  if (!Number.isSafeInteger(state.revision + 1)) throw new Error('저장 버전을 확인해주세요.');
  return state.revision + 1;
}

async function readTransaction(mode, scope, operation) {
  let operationError;
  try {
    return await runMealPlanningTransaction(mode, (stores, transaction) => {
      const holder = { result: null };
      const records = {};
      let pending = 3;
      const requests = { ingredients: stores.ingredients.getAll(), plans: stores.mealPlans.getAll(),
        state: stores.mealPlanningState.get('state') };
      for (const [key, request] of Object.entries(requests)) {
        request.onsuccess = () => {
          records[key] = request.result;
          pending -= 1;
          if (pending) return;
          try {
            holder.result = operation(records, stores);
          } catch (error) {
            operationError = error;
            transaction.abort();
          }
        };
      }
      return holder;
    }, scope);
  } catch (error) {
    throw operationError || error;
  }
}

/** Reads stock, all weeks, and quantity choices at the same transaction boundary. */
export async function getMealPlanningSnapshot({ scope = 'guest', asOf = new Date().toISOString() } = {}) {
  resolveScope(scope);
  calendarDate(asOf);
  return readTransaction('readonly', scope, (records) => makeSnapshot(records, scope, asOf));
}
/** Saves explicit confirmations only; raw stock and manual shopping are untouched. */
export async function saveMealPlanningStock({ scope = 'guest', snapshot, confirmations,
  asOf = new Date().toISOString() } = {}) {
  resolveScope(scope);
  calendarDate(asOf);
  if (snapshot?.scope !== scope) throw new Error('식단을 저장할 계정을 확인해주세요.');
  const expected = structuredClone(snapshot.basis);
  const proposed = structuredClone(confirmations);
  return readTransaction('readwrite', scope, (records, stores) => {
    const current = makeSnapshot(records, scope, asOf);
    assertUnchanged(expected, current.basis);
    if (validatePlanningStockConfirmations({ ingredients: current.ingredients,
      confirmations: proposed, asOf }).status !== 'valid') throw new Error('재고의 수량 확인 내용을 다시 확인해주세요.');
    const state = { ...current.state, revision: nextRevision(current.state),
      stockInventoryBasis: current.basis.inventoryBasis, stockConfirmations: proposed };
    const result = makeSnapshot({ ...records, state }, scope, asOf);
    stores.mealPlanningState.put(state);
    return result;
  });
}
const invalidChange = (code) => ({ status: 'invalid', issues: [{ code }] });

function snapshotRecords(snapshot) {
  return { ingredients: snapshot.ingredients, confirmedPlans: snapshot.plans,
    state: snapshot.state.revision === 0 ? undefined : snapshot.state };
}

function computeChange(snapshot, change, confirmedAt) {
  if (!change || !['set', 'remove'].includes(change.type)
    || ![change.planId, change.slotId].every(hasText)) return invalidChange('invalid_change');
  const current = makeSnapshot(snapshotRecords(snapshot), snapshot.scope, snapshot.asOf);
  assertUnchanged(snapshot.basis, current.basis);
  const plan = current.plans.find((entry) => entry.id === change.planId);
  const slot = plan?.slots.find((entry) => entry.id === change.slotId);
  const id = commitmentId(change.planId, change.slotId);
  if (slot?.locked) return invalidChange('slot_locked');
  const state = { ...current.state, revision: nextRevision(current.state),
    commitments: current.state.commitments.filter((entry) => entry.id !== id) };
  let proposedCommitment = null;
  let cookingPreview = null;
  if (change.type === 'set') {
    if (!slot || slot.date < current.fromDate || slot.status !== 'planned'
      || !plan.preferences.dinnerDays.includes(plan.slots.indexOf(slot))) return invalidChange('slot_unavailable');
    const recipe = canonicalRecipe(change.recipeId, change.recipeVersion);
    if (!recipe || !['original', 'available'].includes(change.mode)) return invalidChange('recipe_unavailable');
    if (hasExcludedIngredient(recipe, plan)) return invalidChange('excluded_ingredient');
    proposedCommitment = { id, planId: plan.id, slotId: slot.id, componentId: COMPONENT_ID,
      status: 'active', slotBasis: getPlanningSlotBasis(plan, slot), recipeId: recipe.id, recipeVersion: recipe.version,
      quantityChoice: { status: 'confirmed', recipeId: recipe.id, recipeVersion: recipe.version,
        targetServings: slot.servings, scaleFactor: 1, confirmedAt,
        selectedLineIds: recipe.ingredients.filter((line) => line.selected).map((line) => line.id) } };
    state.commitments.push(proposedCommitment);
    const original = makeSnapshot({ ...snapshotRecords(current), state }, current.scope, current.asOf);
    if (!original.allocation || original.allocation.status !== 'calculated') return invalidChange('planning_confirmation_required');
    const calculated = previewAllocatedRecipeMeal({ recipe,
      meal: original.meals.find((meal) => meal.id === id), allocation: original.allocation });
    if (calculated.status !== 'calculated') return invalidChange('planning_confirmation_required');
    cookingPreview = calculated.preview;
    if (change.mode === 'available') {
      if (!(cookingPreview.scaleFactor > 0)) return invalidChange('quantity_unavailable');
      proposedCommitment.quantityChoice.scaleFactor = cookingPreview.scaleFactor;
    }
  } else if (!current.state.commitments.some((entry) => entry.id === id)) {
    return invalidChange('commitment_missing');
  }
  const result = makeSnapshot({ ...snapshotRecords(current), state }, current.scope, current.asOf);
  if (change.type === 'set' && (result.allocation?.status !== 'calculated' || result.shopping?.status !== 'calculated')) {
    return invalidChange('planning_confirmation_required');
  }
  return { status: 'ready', issues: result.issues, scope: current.scope, asOf: confirmedAt,
    basis: structuredClone(current.basis), change: structuredClone(change), proposedCommitment, cookingPreview,
    allocation: result.allocation, shopping: result.shopping, state };
}

/** A read-only proposal for one additional recipe component, never a whole dinner. */
export function previewMealPlanningChange({ snapshot, change } = {}) {
  try {
    resolveScope(snapshot?.scope);
    return computeChange(structuredClone(snapshot), structuredClone(change), snapshot.asOf);
  } catch {
    return invalidChange('invalid_planning_snapshot');
  }
}

function approvalContent(preview) {
  return JSON.stringify({ commitment: preview.proposedCommitment, state: preview.state,
    meals: preview.allocation?.meals ?? null, shopping: preview.shopping?.items ?? null, issues: preview.issues });
}

/** Compare-and-swap under a single transaction; never trusts caller-supplied quantities. */
export async function approveMealPlanningChange({ scope = 'guest', preview, asOf = new Date().toISOString() } = {}) {
  resolveScope(scope);
  calendarDate(asOf);
  if (preview?.status !== 'ready' || preview.scope !== scope) throw new Error('승인할 식단과 계정을 확인해주세요.');
  const expected = structuredClone(preview);
  calendarDate(expected.asOf);
  if (Date.parse(expected.asOf) > Date.parse(asOf)) throw new Error('미리보기 시각을 확인해주세요.');
  return readTransaction('readwrite', scope, (records, stores) => {
    const current = makeSnapshot(records, scope, asOf);
    assertUnchanged(expected.basis, current.basis);
    const checked = computeChange(current, expected.change, expected.asOf);
    if (checked.status !== 'ready' || approvalContent(checked) !== approvalContent(expected)) {
      throw new Error('승인할 분량이나 식단이 변경됐습니다. 다시 미리보기를 확인해주세요.');
    }
    const result = makeSnapshot({ ...records, state: checked.state }, scope, asOf);
    stores.mealPlanningState.put(checked.state);
    return result;
  });
}
