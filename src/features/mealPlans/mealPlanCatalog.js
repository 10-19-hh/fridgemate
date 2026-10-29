import { seedRecipes } from '../../data/seedRecipes.js';
import { normalizeIngredientName } from '../ingredients/ingredientDomain.js';
import { FOOD_GROUP_RULE_VERSION, getMealFoodGroups } from '../nutrition/foodGroupRules.js';
import { getReviewedDinnerCatalog } from './reviewedDinnerCatalog.js';
import { selectMealPlanCandidates } from './mealPlanReviewPolicy.js';

export const MEAL_PLAN_CATALOG_VERSION = '2026-09-12.1';
export const ACTIVE_MEAL_PLAN_CATALOG_VERSION = '2026-09-16.2';

const QUANTITY_REASON = '기본 메뉴에는 재료별 사용량 근거가 없어 분량 확인이 필요해요.';
const recipeById = new Map(seedRecipes.map((recipe) => [recipe.id, recipe]));

function ingredientLine(recipeKey, rawName, index, { selected, optional, foodGroups = [] }) {
  return {
    id: `${recipeKey}:ingredient:${index}`,
    rawName,
    normalizedName: normalizeIngredientName(rawName),
    foodCode: null,
    amount: null,
    unit: null,
    preparationState: null,
    quantityStatus: 'unverified',
    quantityReason: QUANTITY_REASON,
    selected,
    optional,
    foodGroups,
  };
}

function recipeComponent(id, role, selectedOptional = [], groupEvidence = {}) {
  const recipe = recipeById.get(id);
  if (!recipe) throw new Error(`Unknown meal plan source: ${id}`);

  const recipeKey = `local:${id}`;
  const required = [...recipe.coreIngredients, ...recipe.pantryIngredients];
  const alternatives = recipe.requiredGroups.flatMap((group) => group.anyOf);
  // The source repeats group alternatives in optionalIngredients; these are
  // references to the same named ingredient, not measured quantities to sum.
  const names = [...new Set([...required, ...recipe.optionalIngredients, ...alternatives])];
  const selected = new Set([...required, ...selectedOptional]);
  if (selectedOptional.some((name) => !names.includes(name))) {
    throw new Error(`Unlisted ingredient selected for ${recipeKey}`);
  }
  if (recipe.requiredGroups.some((group) => !group.anyOf.some((name) => selected.has(name)))) {
    throw new Error(`Missing required ingredient choice for ${recipeKey}`);
  }

  return {
    id: recipeKey,
    recipeKey,
    recipeVersion: MEAL_PLAN_CATALOG_VERSION,
    title: recipe.title,
    role,
    source: { kind: 'local-recipe', id, name: 'FridgeMate 기본 메뉴', path: 'src/data/seedRecipes.js' },
    sourceServings: recipe.servings ?? null,
    servings: null,
    servingsStatus: 'unverified',
    nutrition: null,
    nutritionStatus: 'unavailable',
    ingredients: names.map((name, index) => ingredientLine(recipeKey, name, index, {
      selected: selected.has(name),
      optional: !required.includes(name),
      foodGroups: groupEvidence[name] || [],
    })),
  };
}

function riceComponent() {
  return {
    id: 'editorial:cooked-rice',
    recipeKey: 'editorial:cooked-rice',
    recipeVersion: MEAL_PLAN_CATALOG_VERSION,
    title: '밥',
    role: 'staple',
    source: { kind: 'editorial-pairing', id: 'cooked-rice', name: 'FridgeMate 끼니 조합 제안' },
    sourceServings: null,
    servings: null,
    servingsStatus: 'unverified',
    nutrition: null,
    nutritionStatus: 'unavailable',
    ingredients: [ingredientLine('editorial:cooked-rice', '밥', 0, {
      selected: true, optional: false, foodGroups: ['grains'],
    })],
  };
}

function template(key, title, components) {
  return {
    key: `local-meal:${key}`,
    version: 1,
    catalogVersion: MEAL_PLAN_CATALOG_VERSION,
    title,
    source: { kind: 'editorial-composition', name: 'FridgeMate 저녁 조합', version: MEAL_PLAN_CATALOG_VERSION },
    reviewStatus: 'composition-only',
    reviewNote: '기본 메뉴의 재료 구성에 맞춘 편집 조합이며 영양 전문가의 검수나 분량 검증을 뜻하지 않아요.',
    servings: null,
    servingsStatus: 'unverified',
    quantityStatus: 'unverified',
    nutrition: null,
    nutritionStatus: 'unavailable',
    foodGroupRuleVersion: FOOD_GROUP_RULE_VERSION,
    components,
    foodGroups: getMealFoodGroups(components),
  };
}

// Evidence lists intentionally omit optional garnishes and seasonings. A named
// vegetable in a title alone does not justify a vegetable composition label.
export const mealPlanCatalog = [
  template('kimchi-rice', '김치볶음밥', [
    recipeComponent('recipe-1', 'main', [], { 밥: ['grains'], 김치: ['vegetables'] }),
  ]),
  template('tomato-egg-rice', '토마토 달걀볶음과 밥', [
    riceComponent(), recipeComponent('recipe-3', 'main', [], { 토마토: ['vegetables'], 계란: ['proteinFoods'] }),
  ]),
  template('tuna-mayo-rice', '참치마요 덮밥', [
    recipeComponent('recipe-4', 'main', [], { 밥: ['grains'], 참치캔: ['proteinFoods'] }),
  ]),
  template('vegetable-omelette-rice', '채소 오믈렛과 밥', [
    riceComponent(), recipeComponent('recipe-5', 'main', ['양파', '당근'], {
      계란: ['proteinFoods'], 양파: ['vegetables'], 당근: ['vegetables'],
    }),
  ]),
  template('chicken-broccoli-rice', '닭고기 채소볶음과 밥', [
    riceComponent(), recipeComponent('recipe-7', 'main', ['브로콜리'], { 닭고기: ['proteinFoods'], 브로콜리: ['vegetables'] }),
  ]),
  template('tofu-zucchini-rice', '두부조림·애호박볶음과 밥', [
    riceComponent(), recipeComponent('recipe-14', 'main', [], { 두부: ['proteinFoods'] }),
    recipeComponent('recipe-16', 'side', [], { 애호박: ['vegetables'] }),
  ]),
  template('pork-sprout-rice', '돼지고기 숙주볶음과 밥', [
    riceComponent(), recipeComponent('recipe-30', 'main', [], { 돼지고기: ['proteinFoods'], 숙주: ['vegetables'] }),
  ]),
  template('chicken-curry', '닭고기 카레라이스', [
    recipeComponent('recipe-20', 'main', ['닭고기'], {
      밥: ['grains'], 양파: ['vegetables'], 당근: ['vegetables'], 닭고기: ['proteinFoods'],
    }),
  ]),
  template('bulgogi-rice', '불고기 덮밥', [
    recipeComponent('recipe-34', 'main', [], { 밥: ['grains'], 소고기: ['proteinFoods'], 양파: ['vegetables'] }),
  ]),
  template('zucchini-doenjang-rice', '애호박 된장찌개와 밥', [
    riceComponent(), recipeComponent('recipe-37', 'main', [], { 두부: ['proteinFoods'], 애호박: ['vegetables'] }),
  ]),
  template('shrimp-tomato-pasta', '새우 토마토 파스타', [
    recipeComponent('recipe-52', 'main', [], { 파스타면: ['grains'], 새우: ['proteinFoods'], 토마토: ['vegetables'] }),
  ]),
  template('cucumber-tuna-rice', '오이참치비빔밥', [
    recipeComponent('recipe-57', 'main', [], { 밥: ['grains'], 참치캔: ['proteinFoods'], 오이: ['vegetables'] }),
  ]),
  template('cabbage-egg-rice', '양배추계란덮밥', [
    recipeComponent('recipe-62', 'main', [], { 밥: ['grains'], 계란: ['proteinFoods'], 양배추: ['vegetables'] }),
  ]),
  template('mushroom-egg-porridge', '달걀을 넣은 버섯죽', [
    recipeComponent('recipe-58', 'main', ['계란'], { 밥: ['grains'], 버섯: ['vegetables'], 계란: ['proteinFoods'] }),
  ]),
  template('beef-radish-rice', '소고기무국과 밥', [
    riceComponent(), recipeComponent('recipe-25', 'main', [], { 소고기: ['proteinFoods'], 무: ['vegetables'] }),
  ]),
  template('broccoli-pasta', '브로콜리 파스타', [
    recipeComponent('recipe-64', 'main', [], { 파스타면: ['grains'], 브로콜리: ['vegetables'] }),
  ]),
];

export function getMealPlanCatalog() {
  return [...mealPlanCatalog, ...getReviewedDinnerCatalog().templates];
}

export function getMealPlanCandidates(candidatePolicy = null) {
  return selectMealPlanCandidates(getMealPlanCatalog(), candidatePolicy);
}
