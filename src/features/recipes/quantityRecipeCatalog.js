const SOURCE_URL = 'https://www.foodsafetykorea.go.kr/api/openApiInfo.do?menu_grp=MENU_GRP31&menu_no=661&show_cnt=10&start_idx=1&svc_no=COOKRCP01';
const SOURCE_NAME = '식품의약품안전처 조리식품의 레시피 DB';
const PORTION_EVIDENCE = 'COOKRCP01 ID 29 원문 [1인분] 및 식약처 공식 책자 PDF 44쪽(인쇄 86–87쪽)의 재료준비(1인분)를 2026-09-15 AI 원문 대조했습니다.';

// Fixed reviewed content, not a snapshot generated from whatever data is current.
// Image/nutrition changes do not change this quantity review and are never copied.
const SOURCE_SNAPSHOT_29 = {
  externalId: '29',
  name: '부추 콩가루 찜',
  cookingMethod: '찌기',
  dishType: '반찬',
  servingWeight: null,
  source: SOURCE_NAME,
  sourceUrl: SOURCE_URL,
  ingredientsText: '[1인분]조선부추 50g, 날콩가루 7g(1⅓작은술)\n·양념장 : 저염간장 3g(2/3작은술), 다진 대파 5g(1작은술), 다진 마늘 2g(1/2쪽), 고춧가루 2g(1/3작은술), 요리당 2g(1/3작은술), 참기름 2g(1/3작은술), 참깨 약간',
  steps: [
    { order: 1, text: '1. 부추는 깨끗이 씻어 물기를 제거하고, 5cm 길이로 썰고 부추에 날콩가루를 넣고 고루 섞이도록 버무린다.' },
    { order: 2, text: '2. 찜기에 면보를 깔고 부추를 넣은 후 김이 오르게 쪄서 파랗게 익힌다.' },
    { order: 3, text: '3. 저염간장에 다진 대파, 다진 마늘, 고춧가루, 요리당 , 참기름, 참깨를 섞어 양념장을 만들고 찐 부추는 그릇에 담아낸다.' }
  ]
};

// Canonical source-quantity record shared by B1 and recipe quantity consumers.
// These are source quantities, never personal scaled amounts or nutrition estimates.
const RECIPE_29 = {
  id: 'mfds:29',
  version: '2026-09-15.1',
  name: '부추 콩가루 찜',
  source: { kind: 'mfds-cookrcp01', id: '29', name: SOURCE_NAME, url: SOURCE_URL },
  sourceSnapshot: SOURCE_SNAPSHOT_29,
  servings: 1,
  servingsStatus: 'verified',
  servingsEvidence: PORTION_EVIDENCE,
  review: {
    method: 'ai-source-comparison',
    reviewedAt: '2026-09-15',
    humanReviewed: false,
    cookingValidated: false,
    nutritionExpertReviewed: false,
    weightBasis: 'purchase-vs-trimmed-unspecified',
    references: [{
      url: 'https://www.foodsafetykorea.go.kr/upload/20170417/20170417053825_1492418305214.pdf',
      pdfPage: 44,
      printedPages: '86–87'
    }]
  },
  reviewNote: 'AI가 원문 분량을 대조했습니다. 실조리·영양 전문가 검증은 하지 않았습니다.',
  sourceNotes: [
    '부추 50g의 구입중량·손질후 중량 구분은 원문에 명시되지 않았습니다. 수율 환산을 하지 않습니다.',
    '조선부추·날콩가루·저염간장을 일반 부추·볶은 콩가루·일반 간장으로 자동 치환하지 않습니다.',
    '참깨 약간은 정량 미확인으로 남깁니다. 재료명 그대로 직접 확인한 양으로만 미리봅니다.'
  ],
  ingredients: [
    { rawName: '조선부추', rawText: '조선부추 50g', foodId: 'joseon-chives', preparationState: 'raw', amount: 50, role: 'core' },
    { rawName: '날콩가루', rawText: '날콩가루 7g(1⅓작은술)', foodId: 'raw-soybean-powder', preparationState: 'raw-ground', amount: 7, role: 'core' },
    { rawName: '저염간장', rawText: '저염간장 3g(2/3작은술)', foodId: 'low-sodium-soy-sauce', preparationState: 'liquid', amount: 3, role: 'seasoning' },
    { rawName: '다진 대파', rawText: '다진 대파 5g(1작은술)', foodId: 'green-onion', preparationState: 'minced', amount: 5, role: 'seasoning' },
    { rawName: '다진 마늘', rawText: '다진 마늘 2g(1/2쪽)', foodId: 'garlic', preparationState: 'minced', amount: 2, role: 'seasoning' },
    { rawName: '고춧가루', rawText: '고춧가루 2g(1/3작은술)', foodId: 'red-pepper-powder', preparationState: 'ground', amount: 2, role: 'seasoning' },
    { rawName: '요리당', rawText: '요리당 2g(1/3작은술)', foodId: 'cooking-syrup', preparationState: 'liquid', amount: 2, role: 'seasoning' },
    { rawName: '참기름', rawText: '참기름 2g(1/3작은술)', foodId: 'sesame-oil', preparationState: 'liquid', amount: 2, role: 'seasoning' },
    { rawName: '참깨', rawText: '참깨 약간', foodId: 'sesame-seeds', preparationState: null, amount: null, role: 'seasoning' }
  ].map((line, index) => ({
    id: `mfds:29:ingredient:${index + 1}`,
    ...line,
    section: line.role === 'core' ? '부추 콩가루 찜' : '양념장',
    required: true,
    selected: true,
    unit: line.amount === null ? null : 'g',
    quantityStatus: line.amount === null ? 'unknown' : 'verified',
    quantityEvidence: line.amount === null ? '' : `${PORTION_EVIDENCE} 원문 행: ${line.rawText}`
  }))
};

function buildSourceQuantityRecipe({ sourceSnapshot, pdfPage, printedPages, sourceNotes, ingredientRows }) {
  const id = `mfds:${sourceSnapshot.externalId}`;
  const portionEvidence = `COOKRCP01 ID ${sourceSnapshot.externalId} 원문 재료량을 식약처 공식 책자 PDF ${pdfPage}쪽(인쇄 ${printedPages}쪽)의 재료준비(1인분)와 2026-09-15 AI 원문 대조했습니다.`;
  return {
    id,
    version: '2026-09-15.1',
    name: sourceSnapshot.name,
    source: { kind: 'mfds-cookrcp01', id: sourceSnapshot.externalId, name: SOURCE_NAME, url: SOURCE_URL },
    sourceSnapshot,
    servings: 1,
    servingsStatus: 'verified',
    servingsEvidence: portionEvidence,
    review: {
      method: 'ai-source-comparison',
      reviewedAt: '2026-09-15',
      humanReviewed: false,
      cookingValidated: false,
      nutritionExpertReviewed: false,
      weightBasis: 'purchase-vs-trimmed-unspecified',
      references: [{
        url: 'https://www.foodsafetykorea.go.kr/upload/20170417/20170417053825_1492418305214.pdf',
        pdfPage,
        printedPages
      }]
    },
    reviewNote: 'AI가 원문 분량을 대조했습니다. 실조리·영양 전문가 검증은 하지 않았습니다.',
    sourceNotes,
    ingredients: ingredientRows.map((line, index) => ({
      id: `${id}:ingredient:${index + 1}`,
      ...line,
      required: true,
      selected: true,
      quantityStatus: line.amount === null ? 'unknown' : 'verified',
      quantityEvidence: line.amount === null ? '' : `${portionEvidence} 원문 행: ${line.rawText}`
    }))
  };
}

const RECIPE_31 = buildSourceQuantityRecipe({
  sourceSnapshot: {
    externalId: '31',
    name: '방울토마토 소박이',
    cookingMethod: '기타',
    dishType: '반찬',
    servingWeight: null,
    source: SOURCE_NAME,
    sourceUrl: SOURCE_URL,
    ingredientsText: '●방울토마토 소박이 : \n방울토마토 150g(5개), 양파 10g(3×1cm), 부추 10g(5줄기)\n●양념장 : \n고춧가루 4g(1작은술), 멸치액젓 3g(2/3작은술), 다진 마늘 2.5g(1/2쪽), 매실액 2g(1/3작은술), 설탕 2g(1/3작은술), 물 2ml(1/3작은술), 통깨 약간',
    steps: [
      { order: 1, text: '1. 물기를 빼고 2cm 정도의 크기로 썰은 부추와 양파를 양념장에 섞어 양념속을 만든다.' },
      { order: 2, text: '2. 깨끗이 씻은 방울토마토는 꼭지를 떼고 윗부분에 칼로 십자모양으로 칼집을 낸다.' },
      { order: 3, text: '3. 칼집을 낸 방울토마토에 양념속을 사이사이에 넣어 버무린다.' }
    ]
  },
  pdfPage: 46,
  printedPages: '90–91',
  sourceNotes: [
    '채소의 g 표기는 구입중량·손질후 중량 구분이 명시되지 않았습니다. 수율 환산을 하지 않습니다.',
    '방울토마토와 부추의 원문 정체성을 유지하며 일반 토마토나 조선부추로 자동 치환하지 않습니다.',
    '양념장의 물은 원문 2ml를 유지합니다. 통깨 약간은 정량 미확인으로 남깁니다.',
    '책자의 양념장 준비 단계를 포함해 원문 조리 흐름을 대조했습니다. 공개 원문의 조리 단계는 바꾸지 않았습니다.',
    '공개 원문과 책자의 탄수화물 표기에 차이가 있어 영양값을 혼합하거나 재계산하지 않습니다.'
  ],
  ingredientRows: [
    { rawName: '방울토마토', rawText: '방울토마토 150g(5개)', foodId: 'cherry-tomato', preparationState: 'raw', section: '방울토마토 소박이', role: 'core', amount: 150, unit: 'g' },
    { rawName: '양파', rawText: '양파 10g(3×1cm)', foodId: 'onion', preparationState: 'raw', section: '방울토마토 소박이', role: 'core', amount: 10, unit: 'g' },
    { rawName: '부추', rawText: '부추 10g(5줄기)', foodId: 'chives', preparationState: 'raw', section: '방울토마토 소박이', role: 'core', amount: 10, unit: 'g' },
    { rawName: '고춧가루', rawText: '고춧가루 4g(1작은술)', foodId: 'red-pepper-powder', preparationState: 'ground', section: '양념장', role: 'seasoning', amount: 4, unit: 'g' },
    { rawName: '멸치액젓', rawText: '멸치액젓 3g(2/3작은술)', foodId: 'anchovy-fish-sauce', preparationState: 'liquid', section: '양념장', role: 'seasoning', amount: 3, unit: 'g' },
    { rawName: '다진 마늘', rawText: '다진 마늘 2.5g(1/2쪽)', foodId: 'garlic', preparationState: 'minced', section: '양념장', role: 'seasoning', amount: 2.5, unit: 'g' },
    { rawName: '매실액', rawText: '매실액 2g(1/3작은술)', foodId: 'plum-extract', preparationState: 'liquid', section: '양념장', role: 'seasoning', amount: 2, unit: 'g' },
    { rawName: '설탕', rawText: '설탕 2g(1/3작은술)', foodId: 'sugar', preparationState: 'as-supplied', section: '양념장', role: 'seasoning', amount: 2, unit: 'g' },
    { rawName: '물', rawText: '물 2ml(1/3작은술)', foodId: 'water', preparationState: 'liquid', section: '양념장', role: 'seasoning', amount: 2, unit: 'ml' },
    { rawName: '통깨', rawText: '통깨 약간', foodId: 'whole-sesame-seeds', preparationState: null, section: '양념장', role: 'seasoning', amount: null, unit: null }
  ]
});

const RECIPE_95 = buildSourceQuantityRecipe({
  sourceSnapshot: {
    externalId: '95',
    name: '치커리샐러드와 올리브 마늘 소스',
    cookingMethod: '기타',
    dishType: '반찬',
    servingWeight: null,
    source: SOURCE_NAME,
    sourceUrl: SOURCE_URL,
    ingredientsText: '●치커리 샐러드 : 치커리 30g(10줄기), 적양배추 15g(5×3cm), 양파 10g(2×1cm), 당근 5g(3×1×1cm)\n●올리브마늘 드레싱 : 올리브유 10g(2작은술), 식초 5g(1작은술), 설탕 5g(1작은술), 마늘 5g(1쪽)',
    steps: [
      { order: 1, text: '1. 올리브유, 식초, 설탕, 다진 마늘을 섞어 거품기로 충분히 저어주어 올리브마늘 드레싱을 만든다.' },
      { order: 2, text: '2. 치커리는 싱싱하게 찬물에 담갔다가 물기를 뺀 후 한입 크기로 자르고, 적양배추, 양파, 당근은 곱게채를 썬다.' },
      { order: 3, text: '3. 접시에 준비한 치커리, 적양배추, 양파, 당근을 담고 올리브마늘 드레싱을 뿌린다.' }
    ]
  },
  pdfPage: 113,
  printedPages: '224–225',
  sourceNotes: [
    '채소의 g 표기는 구입중량·손질후 중량 구분이 명시되지 않았습니다. 수율 환산을 하지 않습니다.',
    '책자 제목은 치커리 샐러드와 올리브 마늘 드레싱입니다. 고정된 출처 ID의 재료 8행과 조리 흐름을 대조했으며 이름 유사도로 다른 레시피를 합치지 않았습니다.',
    '마늘 5g(1쪽)은 책자에서 먼저 다지는 원재료입니다. 다진 마늘의 정량값으로 자동 치환하지 않습니다.',
    '적양배추를 일반 양배추로 자동 치환하지 않습니다. 영양 정보와 이미지는 이 정량 원본으로 복사하지 않습니다.'
  ],
  ingredientRows: [
    { rawName: '치커리', rawText: '치커리 30g(10줄기)', foodId: 'chicory', preparationState: 'raw', section: '치커리 샐러드', role: 'core', amount: 30, unit: 'g' },
    { rawName: '적양배추', rawText: '적양배추 15g(5×3cm)', foodId: 'red-cabbage', preparationState: 'raw', section: '치커리 샐러드', role: 'core', amount: 15, unit: 'g' },
    { rawName: '양파', rawText: '양파 10g(2×1cm)', foodId: 'onion', preparationState: 'raw', section: '치커리 샐러드', role: 'core', amount: 10, unit: 'g' },
    { rawName: '당근', rawText: '당근 5g(3×1×1cm)', foodId: 'carrot', preparationState: 'raw', section: '치커리 샐러드', role: 'core', amount: 5, unit: 'g' },
    { rawName: '올리브유', rawText: '올리브유 10g(2작은술)', foodId: 'olive-oil', preparationState: 'liquid', section: '올리브마늘 드레싱', role: 'seasoning', amount: 10, unit: 'g' },
    { rawName: '식초', rawText: '식초 5g(1작은술)', foodId: 'vinegar', preparationState: 'liquid', section: '올리브마늘 드레싱', role: 'seasoning', amount: 5, unit: 'g' },
    { rawName: '설탕', rawText: '설탕 5g(1작은술)', foodId: 'sugar', preparationState: 'as-supplied', section: '올리브마늘 드레싱', role: 'seasoning', amount: 5, unit: 'g' },
    { rawName: '마늘', rawText: '마늘 5g(1쪽)', foodId: 'garlic', preparationState: 'raw', section: '올리브마늘 드레싱', role: 'seasoning', amount: 5, unit: 'g' }
  ]
});

const QUANTITY_RECIPES = [RECIPE_29, RECIPE_31, RECIPE_95];

/**
 * Returns the canonical source-quantity recipe only while the reviewed cooking
 * source still matches exactly. A source edit requires another explicit review.
 * Consumers receive independent copies; no personal inventory is read or matched.
 */
export function getQuantityRecipeForPublicRecipe(publicRecipe) {
  if (!publicRecipe || typeof publicRecipe !== 'object' || Array.isArray(publicRecipe)) return null;
  const recipe = QUANTITY_RECIPES.find((entry) => entry.sourceSnapshot.externalId === publicRecipe.externalId);
  if (!recipe) return null;
  const snapshot = recipe.sourceSnapshot;
  const fieldsMatch = Object.entries(snapshot)
    .filter(([field]) => field !== 'steps')
    .every(([field, value]) => publicRecipe[field] === value);
  if (!fieldsMatch || !Array.isArray(publicRecipe.steps)
    || publicRecipe.steps.length !== snapshot.steps.length) return null;
  const stepsMatch = snapshot.steps.every((step, index) => (
    publicRecipe.steps[index]?.order === step.order && publicRecipe.steps[index]?.text === step.text
  ));
  return stepsMatch ? structuredClone(recipe) : null;
}
