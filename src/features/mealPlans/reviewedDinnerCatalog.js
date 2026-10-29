import { normalizeIngredientName } from '../ingredients/ingredientDomain';
import { FOOD_GROUP_RULE_VERSION, getMealFoodGroups } from '../nutrition/foodGroupRules';

export const REVIEWED_DINNER_CATALOG_VERSION = 'mfds-dinners-2026-09-16-v2';

// Facts visually compared to the complete ingredient and method pages. The book
// itself and its photographs are not bundled; summaries below are our wording.
const BOOK = {
  title: '우리 몸이 원하는 삼삼한 밥상 II',
  url: 'https://www.foodsafetykorea.go.kr/upload/20170417/20170417053825_1492418305244.pdf',
  sha256: 'f3ae4dce2cbde7e8024932ee7e87d20bd76230009848dbc7b3813dd4e4e42f6c',
};
const REVIEW_NOTE = 'AI가 공식 책자의 인분·재료표·조리 단계를 대조했어요. 직접 조리·영양 전문가 검수나 개인에게 충분한 저녁 분량을 보장하지 않아요.';

const DINNERS = [
  {
    key: 'spinach-risotto', title: '시금치 리조또', pdfPage: 26, printedPages: [50, 51],
    rows: [
      ['rice', '밥', 180, '180g(1컵)', 'cooked', '리조또', ['grains']],
      ['spinach', '시금치', 50, '50g(1/2개)', 'raw', '리조또', ['vegetables']],
      ['yam', '마', 10, '10g(5cm)', 'raw', '리조또', []],
      ['soy-drink', '두유', 150, '150g(3/4컵)', 'as-sold', '리조또', ['proteinFoods']],
      ['salt', '소금', 1, '1g', 'as-sold', '간', []],
      ['butter', '버터', 8, '8g(1½작은술)', 'as-sold', '리조또', []],
      ['pepper', '후춧가루', 1, '1g', 'as-sold', '간', []],
    ],
    processWater: { name: '시금치 데치는 물', step: 1 },
    methodSummary: [
      '데친 시금치의 물기를 뺀 다음 마·두유와 함께 갈고 거릅니다.',
      '팬에 버터를 두르고 밥에 갈아둔 재료를 섞습니다. 소금·후춧가루로 마무리합니다.',
    ],
    comparisonNote: '밥은 이미 지은 상태의 180g이며 쌀로 환산하지 않습니다. 두유는 원문의 g을 유지하고 ml로 바꾸지 않습니다. 팁의 무염버터를 본문 버터 대신 넣지 않았습니다. 데침물 양과 가식부 수율은 미기재입니다.',
  },
  {
    key: 'chilgok-pomegranate-noodles', title: '칠곡석류국수', pdfPage: 16, printedPages: [30, 31],
    rows: [
      ['noodles', '소면', 160, '160g', 'as-sold', '면', ['grains']],
      ['salt', '저염소금', 4, '4g(1작은술)', 'as-sold', '면 삶기', []],
      ['vinegar', '식초', 8, '8g(1/2작은술)', 'as-sold', '면 삶기', []],
      ['pomegranate', '석류', 200, '200g(1/2개)', 'raw', '석류즙', ['fruit']],
      ['pine-nuts', '잣', 4, '4g(1작은술)', 'as-sold', '고명', []],
      ['almonds', '아몬드', 4, '4g(1작은술)', 'as-sold', '고명', []],
      ['sunflower-seeds', '해바라기씨', 4, '4g(1작은술)', 'as-sold', '고명', []],
      ['walnuts', '호두', 4, '4g(1작은술)', 'as-sold', '고명', []],
      ['pumpkin-seeds', '호박씨', 4, '4g(1작은술)', 'as-sold', '고명', []],
      ['cucumber', '오이', 20, '20g(1/4개)', 'raw', '고명', ['vegetables']],
      ['sauce-water', '물', 600, '600g', 'as-sold', '석류즙', [], 3],
    ],
    processWater: { name: '소면 삶는 물', step: 2 },
    methodSummary: [
      '견과류를 잘게 준비하고, 저염소금·식초를 넣은 물에서 소면을 삶아 건집니다.',
      '석류에 원문에 적힌 물 600g을 더해 갈고 거릅니다. 식힌 즙을 면에 붓고 견과류·오이로 마무리합니다.',
    ],
    comparisonNote: '소면은 삶기 전 판매 상태의 투입량으로 구분하며 삶은 면의 무게로 바꾸지 않습니다. 단계 3의 물 600g은 석류즙 재료로 포함합니다. 별도의 면 삶는 물은 양 미확인입니다. 저염소금과 일반 소금을 합치지 않으며 석류의 가식부 수율은 추정하지 않습니다.',
  },
  {
    key: 'vegetable-jajang-noodles', title: '채소 자장면', pdfPage: 15, printedPages: [28, 29],
    normalizedNames: { 저염간장: '간장' },
    rows: [
      ['noodles', '중화면', 200, '200g', 'as-sold', '면', ['grains']],
      ['potato', '감자', 80, '80g(1/2개)', 'raw', '자장소스', ['vegetables']],
      ['onion', '양파', 80, '80g(1/3개)', 'raw', '자장소스', ['vegetables']],
      ['zucchini', '애호박', 30, '30g(1/2개)', 'raw', '자장소스', ['vegetables']],
      ['black-beans', '검은콩', 2, '2g(1/2작은술)', 'as-sold', '자장소스', ['proteinFoods']],
      ['mushroom', '새송이버섯', 30, '30g(3개)', 'raw', '자장소스', ['vegetables']],
      ['corn', '옥수수통조림', 10, '10g(2작은술)', 'as-sold', '자장소스', ['grains']],
      ['sugar', '설탕', 20, '20g(1½큰술)', 'as-sold', '자장소스', ['oilsAndSugars']],
      ['soy-sauce', '저염간장', 15, '15g(1큰술)', 'as-sold', '자장소스', []],
      ['jajang-powder', '자장분말', 30, '30g(2큰술)', 'as-sold', '자장소스', []],
      ['starch', '녹말가루', 30, '30g(2큰술)', 'as-sold', '자장소스', []],
      ['cucumber', '오이', 30, '30g(1/5개)', 'raw', '고명', ['vegetables']],
      ['peas', '완두콩', 10, '10g(2작은술)', 'as-sold', '고명', ['proteinFoods']],
    ],
    processWaters: [
      { id: 'bean-soaking-water', name: '검은콩 불리는 물', step: 1 },
      { id: 'pea-blanching-water', name: '완두콩 데치는 물', step: 2 },
      { id: 'noodle-boiling-water', name: '중화면 삶는 물', step: 5 },
      { id: 'starch-water', name: '녹말물에 섞는 물', step: 9 },
    ],
    methodSummary: [
      '검은콩은 물에 불려 갈고 완두콩은 데칩니다. 감자·양파·애호박은 깍둑썰고, 새송이버섯과 오이를 손질합니다. 중화면은 삶아 건집니다.',
      '감자·양파·애호박을 볶다가 저염간장·자장분말·설탕을 넣습니다. 간 검은콩·옥수수통조림을 넣고 끓인 뒤 녹말물로 농도를 조절합니다. 면에 소스를 얹고 오이·완두콩으로 마무리합니다.',
    ],
    comparisonNote: '원문의 g과 괄호 분량을 그대로 보존합니다. 검은콩은 불리기 전 투입량이며 완두콩은 판매 상태로 두고 냉동·생물 여부를 추정하지 않습니다. 네 과정의 물 양은 미기재입니다. 새송이버섯은 재료표·손질 단계에 있으나 소스 투입 시점은 명시되지 않아 임의로 정하지 않습니다. 볶음용 기름도 추가 추정하지 않습니다.',
  },
  {
    key: 'soy-drink-pasta', title: '두유 파스타', pdfPage: 21, printedPages: [40, 41],
    normalizedNames: { 페투치네: '파스타면', 올리브오일: '올리브유', '흰 후춧가루': '후추', 파마산치즈가루: '파마산 치즈' },
    rows: [
      ['noodles', '페투치네', 120, '120g', 'as-sold', '면', ['grains']],
      ['oil', '올리브오일', 2, '2g', 'as-sold', '소스', ['oilsAndSugars']],
      ['onion', '양파', 40, '40g(1/4개)', 'raw', '소스', ['vegetables']],
      ['soy-drink', '두유', 400, '400g(2컵)', 'as-sold', '소스', ['proteinFoods']],
      ['pepper', '흰 후춧가루', 5, '5g(1작은술)', 'as-sold', '소스', []],
      ['cheese', '파마산치즈가루', 30, '30g(2큰술)', 'as-sold', '고명', ['dairy']],
      ['scallion', '실파', 2, '2g', 'raw', '고명', ['vegetables']],
      ['garlic', '마늘', 40, '40g(8개)', 'raw', '향내기·고명', ['vegetables']],
    ],
    processWaters: [{ id: 'noodle-boiling-water', name: '페투치네 삶는 물', step: 1 }],
    methodSummary: [
      '페투치네를 삶고 양파를 채 썹니다. 약한 불에서 올리브오일로 마늘을 익혀 건진 뒤 양파를 볶습니다.',
      '두유를 넣어 끓이다가 면과 흰 후춧가루를 더해 조립니다. 그릇에 담고 파마산치즈가루·익힌 마늘·송송 썬 실파를 올립니다.',
    ],
    comparisonNote: '페투치네 120g은 삶기 전 투입량입니다. 두유 400g은 ml로 환산하지 않으며 마늘 40g은 향내기 뒤 고명으로 재사용하는 한 행으로 보존합니다. 면 삶는 물 양과 가식부 수율은 미기재입니다. 페투치네 등 확인한 식품명은 제외 필터에만 함께 사용하고 재고량 호환 근거로 쓰지 않습니다.',
  },
  {
    key: 'potato-rice', title: '감자밥', pdfPage: 25, printedPages: [48, 49],
    normalizedNames: { 칵테일새우: '새우' },
    rows: [
      ['rice', '쌀', 200, '200g(1컵)', 'as-sold', '밥', ['grains']],
      ['potato', '감자', 200, '200g(1개)', 'raw', '밥', ['vegetables']],
      ['onion', '양파', 100, '100g(1/2개)', 'raw', '밥', ['vegetables']],
      ['button-mushroom', '양송이버섯', 50, '50g(3개)', 'raw', '밥', ['vegetables']],
      ['wood-ear', '목이버섯', 5, '5g(3개)', 'as-sold', '밥', ['vegetables']],
      ['shrimp', '칵테일새우', 15, '15g(3개)', 'as-sold', '밥', ['proteinFoods']],
      ['perilla', '깻잎', 10, '10g(12장)', 'raw', '밥', ['vegetables']],
    ],
    processWaters: [
      { id: 'rice-soaking-water', name: '쌀 불리는 물', step: 1 },
      { id: 'mushroom-soaking-water', name: '목이버섯 불리는 물', step: 3 },
      { id: 'rice-cooking-water', name: '밥 짓는 물(원문 1:1, 기준 미확인)', step: 6 },
    ],
    methodSummary: [
      '쌀을 씻어 불리고 감자는 껍질을 벗겨 썹니다. 목이버섯을 불려 찢고 양파·양송이버섯·칵테일새우·깻잎을 손질합니다.',
      '냄비에 쌀과 물, 준비한 재료를 넣고 뚜껑을 덮어 중불에서 끓입니다. 끓으면 불을 줄여 익히고 뜸을 들입니다. 물의 정량은 별도 확인이 필요합니다.',
    ],
    comparisonNote: '쌀 200g은 불리기 전 표기량이며 밥 무게로 바꾸지 않습니다. 단계 6은 쌀과 물 1:1이나 무게/부피 및 불린 쌀 기준이 명시되지 않아 물 g을 계산하지 않습니다. 목이버섯은 불리기 전 판매 상태이며 건조 수율을 추정하지 않습니다. 칵테일새우의 생/가열 상태도 판매 제품 확인 전에는 단정하지 않습니다.',
  },
  {
    key: 'doenjang-bibimbap', title: '된장비빔밥', pdfPage: 28, printedPages: [54, 55],
    normalizedNames: { '쇠고기(우둔)': '소고기' },
    rows: [
      ['brown-rice', '현미', 60, '60g(1/3컵)', 'as-sold', '비빔밥', ['grains']],
      ['rice', '쌀', 60, '60g(1/3컵)', 'as-sold', '비빔밥', ['grains']],
      ['sprouts', '숙주', 40, '40g', 'raw', '비빔밥', ['vegetables']],
      ['tofu', '두부', 70, '70g(1/3모)', 'as-sold', '비빔밥', ['proteinFoods']],
      ['amaranth', '비름나물', 30, '30g', 'raw', '비빔밥', ['vegetables']],
      ['beef', '쇠고기(우둔)', 50, '50g', 'raw', '비빔밥', ['proteinFoods']],
      ['egg', '달걀', 40, '40g(1개)', 'raw', '비빔밥', ['proteinFoods']],
      ['carrot', '당근', 40, '40g(12cm)', 'raw', '비빔밥', ['vegetables']],
      ['doenjang', '된장', 5, '5g(1작은술)', 'as-sold', '비빔소스', []],
      ['pineapple', '파인애플', 10, '10g(1슬라이스)', 'raw', '비빔소스', ['fruit']],
      ['garlic', '마늘', 5, '5g(1개)', 'raw', '비빔소스', ['vegetables']],
      ['chili', '청양고추', 2, '2g(1/2개)', 'raw', '비빔소스', ['vegetables']],
      ['onion', '양파', 5, '5g', 'raw', '비빔소스', ['vegetables']],
      ['perilla-powder', '들깨가루', 3, '3g(1/2작은술)', 'as-sold', '비빔소스', []],
      ['sesame-oil', '참기름', 10, '10g(2작은술)', 'as-sold', '비빔소스', ['oilsAndSugars']],
    ],
    processWaters: [
      { id: 'grain-soaking-water', name: '현미·쌀 불리는 물', step: 2 },
      { id: 'rice-cooking-water', name: '현미·쌀 밥 짓는 물', step: 2 },
      { id: 'blanching-water', name: '비름나물·숙주·두부 데치는 물', step: 7 },
    ],
    methodSummary: [
      '마늘·청양고추·파인애플·양파를 다져 된장·들깨가루와 섞습니다. 현미와 쌀을 불려 밥을 짓고 채소·두부·쇠고기를 손질합니다.',
      '달걀은 흰자·노른자를 나눠 지단을 부칩니다. 당근·쇠고기는 볶고 비름나물·숙주·두부는 데칩니다. 밥에 준비한 재료와 소스를 올리고 참기름으로 마무리합니다.',
    ],
    comparisonNote: '현미와 쌀 각 60g은 불리기 전 투입량입니다. 원문 단계의 비름나물(시금치) 선택지 중 재료표의 비름나물을 유지하며 자동 대체하지 않습니다. 불리기·취사·데침물의 양과 추가 볶음 기름은 추정하지 않습니다. 원문의 당근 40g(12cm) 표기도 그대로 보존합니다.',
  },
];

function makeTemplate(dinner) {
  const recipeKey = `mfds-book:2:${dinner.key}`;
  const book = { ...BOOK, pdfPage: dinner.pdfPage, printedPages: dinner.printedPages };
  const component = {
    id: recipeKey, recipeKey, recipeVersion: `sha256:${BOOK.sha256}:page:${dinner.pdfPage}`,
    reviewVersion: REVIEWED_DINNER_CATALOG_VERSION, title: dinner.title, role: 'main',
    source: {
      kind: 'mfds-book-source-comparison', id: recipeKey, name: BOOK.title, book,
      url: `${BOOK.url}#page=${dinner.pdfPage}`, reviewedAt: '2026-09-16',
      reviewMethod: REVIEW_NOTE, comparisonNote: dinner.comparisonNote,
    },
    sourceServings: 1, servings: 1, servingsStatus: 'verified',
    servingsEvidence: `PDF ${dinner.pdfPage} / 책자 ${dinner.printedPages.join('–')}쪽: 재료 준비(1인분)`,
    nutrition: null, nutritionStatus: 'unavailable', cookingMinutes: null,
    methodSummary: dinner.methodSummary,
    ingredients: dinner.rows.map(([id, rawName, amount, rawAmount, preparationState, purpose, foodGroups, step]) => ({
      id: `${recipeKey}:${id}`, rawName, rawAmount,
      // Reviewed names serve the taste exclusion filter, never quantitative
      // compatibility. Keep source food identity/state/amount independently.
      normalizedName: dinner.normalizedNames?.[rawName] || normalizeIngredientName(rawName),
      foodCode: null, ingredientKey: `food:${rawName.replace(/\s+/g, '')}`, amount, unit: 'g',
      preparationState, purpose, selected: true, optional: false, foodGroups,
      quantityStatus: 'verified', quantityReason: '공식 책자 표기량을 대조한 값이며 실제 보유량은 별도 확인이 필요해요.',
      quantityEvidence: `PDF ${dinner.pdfPage} / ${step ? `조리 단계 ${step}` : '재료표'}: ${rawName} ${rawAmount}`,
      sourceLocation: { kind: step ? 'step' : 'ingredients', ...(step ? { order: step } : {}), text: `${rawName} ${rawAmount}` },
    })),
    processInputs: (dinner.processWaters || [{ id: 'process-water', ...dinner.processWater }]).map((water) => ({
      id: `${recipeKey}:${water.id}`, name: water.name,
      ingredientKey: 'food:물', preparationState: 'as-sold',
      amount: null, unit: null, optional: false, quantityStatus: 'unverified',
      sourceLocation: { kind: 'step', order: water.step },
    })),
  };
  const components = [component];
  return structuredClone({
    key: `mfds-dinner:book2-${dinner.key}`, version: 1, catalogVersion: REVIEWED_DINNER_CATALOG_VERSION,
    title: dinner.title, source: component.source, reviewStatus: 'source-quantity-compared', reviewNote: REVIEW_NOTE,
    servings: 1, servingsStatus: 'verified', quantityStatus: 'verified', processQuantityStatus: 'needs-review',
    nutrition: null, nutritionStatus: 'unavailable', cookingMinutes: null,
    foodGroupRuleVersion: FOOD_GROUP_RULE_VERSION, components, foodGroups: getMealFoodGroups(components),
  });
}

// Static, versioned book comparisons; this is not a live remote-source monitor.
export function getReviewedDinnerCatalog() {
  return { templates: DINNERS.map(makeTemplate), blocked: [] };
}
