const INGREDIENT_ROLES = new Set(['core', 'seasoning', 'other']);
const UNKNOWN_VALUES = new Set(['unknown', 'unverified', '미확인']);

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasText(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function hasIdentity(value) {
  return hasText(value) || (typeof value === 'number' && Number.isFinite(value));
}

function hasKnownText(value) {
  return hasText(value) && !UNKNOWN_VALUES.has(value.trim().toLowerCase());
}

/**
 * Validates the data contract for individual-recipe gram scaling without editing it.
 * `eligible` means required evidence fields are present, not that this function
 * has authenticated the source or performed a human review of its quantities.
 * Independent non-core requirements can remain unknown for a separate notice.
 */
export function validateQuantityRecipe(recipe) {
  const issues = [];
  let status = 'eligible';
  const addIssue = (severity, code, lineId) => {
    if (severity === 'invalid' || status === 'eligible') status = severity;
    issues.push(hasIdentity(lineId) ? { code, lineId } : { code });
  };
  const result = () => ({ status, issues });

  if (!isRecord(recipe)) {
    addIssue('invalid', 'invalid_recipe');
    return result();
  }

  if (!hasIdentity(recipe.id) || !hasIdentity(recipe.version)) {
    addIssue('unverified', 'recipe_identity_unverified');
  }
  if (!isRecord(recipe.source) || !hasText(recipe.source.kind)
    || !hasIdentity(recipe.source.id) || !hasText(recipe.source.name)) {
    addIssue('unverified', 'recipe_source_unverified');
  }
  if (recipe.servings != null && (typeof recipe.servings !== 'number'
    || !Number.isFinite(recipe.servings) || recipe.servings <= 0)) {
    addIssue('invalid', 'invalid_servings');
  } else if (recipe.servings == null || recipe.servingsStatus !== 'verified') {
    addIssue('unverified', 'servings_unverified');
  }
  if (!hasText(recipe.servingsEvidence)) {
    addIssue('unverified', 'servings_evidence_missing');
  }

  if (recipe.ingredients == null) {
    addIssue('unverified', 'ingredients_unverified');
    return result();
  }
  if (!Array.isArray(recipe.ingredients)) {
    addIssue('invalid', 'invalid_ingredients');
    return result();
  }

  const rows = recipe.ingredients.filter(isRecord);
  const activeCore = rows.filter((line) => line.selected === true && line.role === 'core');
  const lineIds = new Set();
  let incompleteCoreSelection = false;

  for (const line of recipe.ingredients) {
    if (!isRecord(line)) {
      addIssue('invalid', 'invalid_ingredient');
      continue;
    }

    if (!hasIdentity(line.id)) {
      addIssue('unverified', 'line_identity_unverified');
    } else if (lineIds.has(line.id)) {
      addIssue('invalid', 'duplicate_line_id', line.id);
    } else {
      lineIds.add(line.id);
    }

    if (line.role == null) {
      incompleteCoreSelection = true;
      addIssue('unverified', 'ingredient_role_unverified', line.id);
    } else if (!INGREDIENT_ROLES.has(line.role)) {
      addIssue('invalid', 'invalid_ingredient_role', line.id);
    }
    if (line.selected == null || line.required == null) {
      incompleteCoreSelection = true;
      addIssue('unverified', 'ingredient_selection_unverified', line.id);
    }
    if ((line.selected != null && typeof line.selected !== 'boolean')
      || (line.required != null && typeof line.required !== 'boolean')) {
      addIssue('invalid', 'invalid_ingredient_selection', line.id);
    }
    if (line.required === true && line.selected === false) {
      addIssue('invalid', 'required_not_selected', line.id);
    }
    if (line.role === 'core' && line.selected === true && line.required === false) {
      addIssue('invalid', 'selected_core_not_required', line.id);
    }
    if (line.amount != null && (typeof line.amount !== 'number'
      || !Number.isFinite(line.amount) || line.amount < 0
      || (line.quantityStatus === 'verified' && line.amount === 0))) {
      addIssue('invalid', 'invalid_amount', line.id);
    }

    // An unselected optional row is not part of the proposed dish.
    if (line.selected !== true) continue;
    if (!hasText(line.rawName) || !hasText(line.rawText)) {
      addIssue('unverified', 'ingredient_source_unverified', line.id);
    }

    const sharesCoreFood = hasKnownText(line.foodId)
      && activeCore.some((core) => core.foodId === line.foodId);
    const sharesCoreState = sharesCoreFood
      && activeCore.some((core) => core.foodId === line.foodId
        && core.preparationState === line.preparationState);
    const needsCoreQuantity = line.role === 'core' || sharesCoreState;

    if (line.role === 'core' && !hasKnownText(line.foodId)) {
      addIssue('unverified', 'food_identity_unverified', line.id);
    }
    if ((line.role === 'core' || sharesCoreFood) && !hasKnownText(line.preparationState)) {
      addIssue('unverified', 'preparation_state_unverified', line.id);
    }
    if (!needsCoreQuantity) continue;
    if (line.quantityStatus !== 'verified' || typeof line.amount !== 'number'
      || !Number.isFinite(line.amount) || line.amount <= 0) {
      addIssue('unverified', 'core_quantity_unverified', line.id);
    }
    if (line.unit !== 'g') {
      addIssue('unverified', 'core_unit_unverified', line.id);
    }
    if (!hasText(line.quantityEvidence)) {
      addIssue('unverified', 'quantity_evidence_missing', line.id);
    }
  }

  // A legacy row with no role/selection is unverified, not an explicit core-free recipe.
  if (activeCore.length === 0 && !incompleteCoreSelection) {
    addIssue('invalid', 'no_active_core');
  }
  return result();
}
