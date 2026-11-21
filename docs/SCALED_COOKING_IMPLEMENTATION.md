# 배율 축소 조리 — 구현 및 검증 기록

기준일: 2026-09-16. 이 문서는 배율 축소 조리 목표의 진행 기록이며 출시 완료 선언이 아니다.

## 목표와 범위

정량 검수된 개별 레시피에서 사용 가능한 재료량을 확인하면, 만들 수 있는 축소 분량과 추가 확인할 재료를 보여준다. 본재료 비율 중 최솟값을 적용하고 확대는 하지 않으며 양수 배율의 제품상 하한선은 두지 않는다. 작은 요리를 만들 수 있다는 것과 요청한 인원에게 충분한 저녁이라는 것은 다르다.

전체 진행 순서는 기준선 → 정량 계약 → 순수 계산 → 수량 확인/미리보기 → 추천 정렬 → 공통 배분기를 통한 주간 식단/장보기 연결이다. 최신 주간 연결은 명시적으로 선택한 정량 반찬 한 가지 단위이며, PRD 전체나 모든 저녁 조합의 정량 검증 완료를 뜻하지 않는다. 실제 소비·취소 이벤트는 PRD B3의 별도 후속 범위다. 아래 날짜별 실행 기록은 당시 상태를 보존하며 최신 결과는 문서 마지막 절을 따른다.

| 요구사항 | 현재 증거 / 남은 작업 |
| --- | --- |
| 0. 현재 테스트·빌드 기준선 | 아래 실행 기록. 기존 실패 17개를 그대로 보존 |
| 1. 정량 계약 | `recipeQuantityContract.js`, 계약 테스트 |
| 2. 축소 계산 | `scaledCooking.js`, 가상 수량 기반 계산 테스트 |
| 실사용 원문 정량 대조 1개 → 3~5개 | AI 원문 대조 3개(ID29·31·95). 사람·실조리·영양 전문가 검증은 각각 0개. 테스트 fixture는 실사용 카탈로그가 아님 |
| 3. 표시 규칙 | 사용자 승인 규칙을 `quantityDisplay.js`에 구현. g/ml 1단위 내림, 1미만은 미만 표시, 개수는 소수 유지. 표시 테스트 통과 |
| 3. 수량 확인 입력·미리보기 UI | 공개 ID29·31·95 상세에 연결. UI/페이지·브라우저 검사 통과(아래 최신 기록) |
| 4. 추천 정렬·그룹·집계 | 실제 목록 연결. 기존 동일 우선순위·동일 확인 조건의 양수 후보만 배율순 비교, 정량 그룹/카드/집계 분리 |
| 5. 주간 식단·장보기 | 공동 재고 배분 + 원재고 확인·승인 repository/CAS + `/meal-plan`의 선택형 정량 반찬·장보기 화면 연결. 기존 저녁 16개는 미검수 유지 |
| 미리보기 이후 인원/재고 변경 | 인원·입력 변경은 재확인 요구. scope/레시피/재고 내용 변경은 입력·결과 초기화. 창 이탈은 확인만 해제 |
| 반복 미리보기·기존 추천 유지 | 실제 저장소를 쓴 페이지 통합 검사에서 재고·재구매 기록·원문 보존. 기존 종류 기반 계산 정책은 유지하고 별도 정량 보강층 사용 |
| 재고300g/두 끼200g의 부족100g | 공통 배분 테스트에서 확인. 다른 주도 같은 범위에 포함. 실제 화면에서는 원문150g 반찬 두 끼·확인 재고225g → 두 번째75g 제안을 검증 |

## 입력 계약

### 검수 레시피

`validateQuantityRecipe(recipe)`는 `{ status: 'eligible' | 'unverified' | 'invalid', issues }`를 반환한다.

- 레시피: `id`, `version`, `source: { kind, id, name }`.
- 인분: `servings`, `servingsStatus: 'verified'`, `servingsEvidence`.
- 원문 재료 행: `id`, `rawName`, `rawText`, `section`, `foodId`, `preparationState`.
- 분류: `role: core | seasoning | other`, `required`, `selected`. 필수인데 미선택이거나 활성 본재료를 선택 재료로 표시하면 오류다.
- 정량: `amount`, `unit`, `quantityStatus`, `quantityEvidence`. 모든 활성 본재료와 같은 식품·상태의 반복 사용 행은 g 단위로 검수되어야 한다.

`eligible`은 증거 필드의 존재와 계산 적격성을 뜻한다. 출처의 진위, 실제 조리 검증 또는 사람/영양 전문가의 검수를 이 함수가 증명하지 않는다. 식품명 별칭으로 삼겹살/앞다리살 또는 생쌀/밥을 동일 정량 재료로 합치지 않는다. 별도 양념의 수량 미확인은 본재료 계산을 막지 않지만 결과에 확인 필요로 남긴다.

실사용 레시피 원본은 PRD B1 카탈로그와 공유해야 한다. 현재 추가한 `__tests__/fixtures/scaledCookingFixtures.js`는 합성 산술 사례이며, 앱 카탈로그로 가져오거나 사용자에게 검수 레시피로 배포하면 안 된다. 기존 16개 식단과 공개 원본 데이터는 변경하지 않았다.

### 이 끼니에 사용할 수 있는 수량 스냅샷

`calculateScaledCooking({ recipe, targetServings, inventory })`는 다음 입력을 요구한다.

- `inventory.scope`, `revision`, `asOf`, `mealDate`.
- `basis: 'user-confirmed-for-meal'`: 사용자가 이 끼니에 쓸 수 있다고 확인한 양. 기존 자유 입력 재고 문자열에서 자동 생성하면 안 된다.
- 또는 `basis: 'allocated'` + `allocationRevision`: 후속 공통 배분기의 버전이 있는 계산 결과. 이 함수를 호출한다고 전체 미래 식단 배분이 구현되는 것은 아니다.
- `items`: `id`, `foodId`, `preparationState`, `amount`, `unit`, `quantityStatus`, `availabilityStatus`, `confirmedAt`.

계산되는 재고는 `quantityStatus: 'confirmed'`, `availabilityStatus: 'available'`인 항목이다. `availabilityStatus: 'unavailable'`은 이 끼니에서 제외한다. 시점별 가용성 판단은 스냅샷 제공자의 책임이며 확인 시각만으로 식품 안전을 보증하지 않는다. 다른 끼니의 예정량이 미확인이면 순가용량도 미확인으로 전달해야 한다.

부분 목록에 재료가 없다는 것은 0g이라는 뜻이 아니다. 확인된 0g은 명시해야 한다. 같은 ID 중복은 오류, 서로 다른 배치의 호환 수량은 합산, 관련 미확인 배치가 있으면 최대 배율은 미확인이다. `raw-stock` 총량은 배분 가능한 양으로 받아들이지 않는다.

## 계산과 결과

1. 검수된 기준 인분에서 목표 인분의 필요량을 계산한다.
2. 선택된 원문 행은 그대로 보존하면서 식품·상태·단위가 같은 필요량만 합산한다.
3. 본재료별 `가용량 / 필요량` 중 최솟값과 1 중 작은 값을 배율로 사용한다.
4. 각 선택 행의 필요량에 같은 배율을 적용한다. 정량 미확인 양념은 `null`로 남긴다.
5. 필수 부재료·양념의 부족/미확인을 별도 `checks`로 반환한다.

상태는 `original`, `scaled`, `needs-confirmation`, `unavailable`, `invalid`다. `status`는 본재료 분량 상태이고 `requirementsStatus`는 필수 재료 전체의 확인 상태다. `status: scaled`만 보고 ‘구매 없이 조리 가능’으로 표시하면 안 된다. 기존 `READY`는 재료 종류 기준이므로 덮어쓰지 않는다.

결과에는 반올림 전 `scaleFactor`, 행별 `requestedAmount`/`scaledAmount`, `limitingIngredients`, `checks`, 계산 기준 `basis`가 남는다. 저장·소비·장보기·추천 점수를 바꾸지 않는다. 호출할 때마다 새 결과를 생성하며 이전 결과를 다시 축소하지 않는다.

계산은 JavaScript Number의 정밀도 안에서 수행하며 표시용 반올림은 하지 않는다. 비교 시 상대적인 기계 오차만 구분해 `0.10000000000000002 - 0.1` 같은 가짜 부족분을 막는다. 이 오차 비교는 최소 조리량 컷오프가 아니다. 양수가 표현 범위를 벗어나 0으로 소실되는 경우에는 재고 0이 아니라 `numeric_range` 오류로 처리한다.

## 표시·연결 경계

사용자가 2026-09-15 승인한 규칙:

- g/ml의 정수는 그대로 표시한다. 소수이고 1 이상이면 1단위로 내림하여 ‘약’ 표시한다.
- `0 < 양 < 1`은 ‘1g 미만’/‘1ml 미만’으로 안내한다. 숫자 0으로 대체하지 않는다.
- 실제 확인된 0과 미확인은 다르다. 개수 단위의 소수는 유지한다.
- 근거 없는 봉/모/줌 → g, g → ml/스푼 환산을 하지 않는다.
- 표시 결과를 배율·필요량·실제 소비 계산에 재입력하지 않는다.

`PublicRecipeQuantityPreview`가 원문 상세와 개인 미리보기를 분리한다. `ScaledCookingPanel`은 원문 재료명으로 이번 요리에 쓸 수 있는 양을 직접 입력받고, 확인 버튼에서만 임시 스냅샷을 만든다. `scaledCookingForm`은 같은 식품·상태·단위의 반복 사용을 한 입력으로 묶고 빈칸과 0을 구분한다. 계산값은 화면 상태에 복제 저장하지 않고 확인 스냅샷에서 계산한다.

기존 `ShoppingListPanel`은 실제 재고의 수량을 자동 저장하는 재구매 패널이므로 재사용하지 않았다. 원본 레시피의 조리 단계 숫자·시간·온도·영양·JSON-LD를 바꾸지 않는다. 원래 분량의 부족분 표시/장보기 버튼은 이번 미리보기에서 제공하지 않으며 후속 정책 결정 대상으로 남긴다.

계정·레시피 ID/버전·재고 내용·로컬 날짜 변경은 React key 경계에서 입력과 결과를 초기화한다. 인원·입력량 변경은 결과를 지우고 재확인을 요구한다. `blur`와 문서 숨김은 입력을 남기되 확인만 해제한다. 현재 재고 provider는 다른 탭의 저장소 변경을 직접 구독하지 않으므로 최신 전역 재고를 자동으로 배분한다는 보장은 하지 않는다. 입력은 이 한 끼의 수동 확인이며, 다른 끼니에 남겨 둘 양은 사용자가 제외해야 한다.

`RecipeQuantityProvider`/`RecipeQuantitySessionProvider`는 계정·재고 버전·날짜에 묶인 레시피별 확인값만 React 메모리에 보관한다. 화면 이동은 유지하되 새로고침·창 이탈·다른 조건에서는 재사용하지 않는다. 렌더 단계의 context 검사와 epoch 검사로 이전 콜백의 늦은 확인도 거부한다. 재고 provider에 `inventoryScope` 읽기 메타데이터를 추가해 계정 전환 첫 렌더의 이전 재료를 새 추천 문맥에 사용하지 않는다. CRUD/저장 스키마는 변경하지 않았다. 로컬 자정과 포커스 복귀 시 날짜도 갱신한다.

원문 조회는 출처 `kind/id/version`과 레시피 ID가 모두 맞아야 한다. `quantityRecommendationBridge`는 원문·계정·재고·날짜·인원 연결을 재검사하고 `quantityResult`를 파생한다. 확인한 정확한 원문 후보가 종류 기반 필터에서 빠졌더라도 결과가 있으면 보존한다. 0·미확인·오류의 보존은 조리 가능 판정이 아니라 결과 설명을 위한 것이다. API/미검수 후보에 수량을 만들어 붙이지 않는다.

`quantityRecommendationOrder`는 기존 `rankingScore`, `homePriority`, 긴급 일치 수, 부족 재료 수와 확인 문맥이 같은 후보만 비교한다. 유효 양수 배율 후보가 원래 차지하던 자리 안에서 안정적으로 재배치하고, 미확인 후보의 자리를 보존한다. 점수 가중치를 새로 만들거나 양수 컷오프를 두지 않는다. 카드·집계는 종류 기준과 분리하고, 필수 양념 미확인은 정량 ‘확인 완료’에 세지 않는다. private 수량·원재고 문맥은 추천 이벤트에 포함하지 않는다.

## 첫 원문 정량 카탈로그

`quantityRecipeCatalog.js`는 B1과 정량 소비자가 함께 사용할 원문 수량 계약이다. `publicRecipes.json` 자체를 수정하거나 축소 결과를 원문에 저장하지 않는다. `getQuantityRecipeForPublicRecipe()`는 고정된 원문 ID·출처·기준 중량·재료·조리문이 일치할 때만 독립 복사본을 반환한다. 자료 갱신으로 내용이 달라지면 재대조 전 `null`이다.

- 대상: `COOKRCP01` ID29, 부추 콩가루 찜. 개별 반찬이며 한 끼 전체가 아니다.
- 근거: 원문 재료의 `[1인분]`과 [식약처 공식 책자](https://www.foodsafetykorea.go.kr/upload/20170417/20170417053825_1492418305214.pdf) PDF44쪽(인쇄86–87쪽)의 `재료준비(1인분)`. AI가 해당 페이지를 시각 대조했다. 사람·실조리·영양 전문가 검증 완료로 표현하지 않는다.
- 본재료: 조선부추50g, 날콩가루7g. 저염간장 등 양념의 원문 g만 사용하며 스푼/쪽 표현은 원문 보존용이지 환산 근거로 재사용하지 않는다.
- 참깨 ‘약간’은 필수 행을 유지하되 양·단위 미확인이다. 부추의 구입 중량/손질 후 중량은 원문 미명시이므로 수율을 생성하지 않는다. `servingWeight:null`을 채우지 않는다.
- [공공데이터포털의 해당 데이터 이용 안내](https://www.data.go.kr/data/15060073/openapi.do)를 확인했다. 책자 전체·사진을 새로 앱에 재배포하지 않았고 기존 공개 데이터와 이미지 경로는 그대로다.

- ID31 방울토마토 소박이: 같은 공식 책자 PDF46쪽(인쇄90–91쪽) 1인분. 본재료 방울토마토150g·양파10g·부추10g, 물2ml는 ml 그대로, 통깨 약간은 미확인. 공개 원문과 책자의 탄수화물 값 차이는 노트에 남기고 기존 영양값을 덮어쓰지 않는다.
- ID95 치커리 샐러드와 올리브 마늘 소스: PDF113쪽(인쇄224–225쪽) 1인분. 본재료 치커리30g·적양배추15g·양파10g·당근5g. 원문의 마늘5g은 다지기 전 원물 상태이며 이미 다진 마늘과 자동 합산하지 않는다. 책자의 ‘드레싱’ 제목과 공개 원문의 ‘소스’ 차이는 출처 노트에 남겼다.

테스트용 합성 레시피는 기존처럼 `__tests__/fixtures`에만 둔다. 세 자료는 모두 개별 반찬·샐러드이고 밥·주요리가 포함된 저녁 한 끼 정량 검수 조합이 아니다.

## 검증 기록

### 변경 전 기준선

- `npm run test:run`: 다른 `.worktrees`의 사본과 중첩 의존성 테스트까지 수집하여 중단. 성공으로 기록하지 않음.
- `npm run test:run -- --exclude '.worktrees/**'`: 정상 루트 92파일, **519개 중 502 통과 / 17 실패**.
- 실패는 기존 본재료/양념 중복 분류 정책 사례: `recommendations.test.js` 1개, `recommendations.agent-regression.test.js` 16개. 이번 작업에서 테스트를 제외·skip하거나 추천 정책을 변경하지 않음.
- `npm run build`: 빌드 및 공개 113경로 SEO 검사 성공. 환경에서 HMR 포트 권한 경고와 오래된 Browserslist 자료 경고가 있었음.

### 테스트 수집 수정

`vitest.config.js`에 Vitest 기본 제외 목록을 복구하고 `**/.worktrees/**`를 추가했다. 실제 파일 목록 비교에서 기존 수집 1,075 → 정상 루트 92, 작업사본 983 → 0, 중첩 node_modules 543 → 0이었다(분류 간 중복 있음). 기존 루트 scripts/server/src의 8/34/50파일은 그대로이며 추천 실패 테스트도 유지된다. 이 비교는 새 기능 테스트 추가 전 목록이다.

### 재실행 방법

```sh
npm run test:run -- src/features/recipes/__tests__/recipeQuantityContract.test.js src/features/recipes/__tests__/scaledCooking.test.js src/features/recipes/__tests__/quantityDisplay.test.js
npm run test:run
npm run build
```

신규 계약·계산 테스트는 가상 숫자의 독립적인 기대값을 검증하며 검수 레시피/실사용 파일럿을 대신하지 않는다. 화면과 정렬·주간 식단 연결 후에는 해당 UI/브라우저 회귀 테스트가 추가로 필요하다.

### 0~2단계 및 표시 함수 확인

- 계약 65개 + 축소 계산 39개 + 표시 44개 = **신규 148개 통과**. 누락 모듈 오류만을 RED 증거로 삼지 않고, 최소 함수 뼈대에서 실제 기대 동작 assertion 실패를 확인한 후 구현했다.
- `npm run test:run`: **95파일, 667개 중 650 통과 / 기존 17 실패**. 신규 실패 없음. 명령 자체는 exit 1이며 전체 테스트가 green이라고 표현하지 않는다.
- `npm run build`: exit 0, 113개 공개 경로·SEO 검증 성공. 변경 전과 같은 HMR 포트 권한/Browserslist 경고가 남는다.
- 변경한 JS·테스트·Vitest 설정 대상 ESLint 통과. 기존 정책 실패 테스트와 원본 추천 로직은 수정하지 않았다.
- 실제 검수 레시피, UI, 추천 정렬, 주간 배분/장보기, 브라우저 회귀, 배포는 아직 검증되지 않았거나 미구현이다. 전체 목표는 진행 중이다.

### 3단계 작업 당시 확인 — 아래 4단계 기록으로 갱신됨

- 착수 시 전체 테스트를 다시 실행: 95파일, 650통과/기존17실패. 빌드/공개113경로 검사 성공.
- 추가: 원문 카탈로그29개, 확인 폼18개, 패널24개, 실제 provider·IndexedDB를 쓰는 상세 페이지3개 = **이번 단계74개 통과**. 앞선148개를 포함한 신규 기능222개가 통과했다.
- 당시 `npm run test:run`: **99파일, 741개 중 724통과/기존17실패**, exit1. 추천 중복 정책의 기존 실패는 바꾸거나 제외하지 않았다.
- 당시 `npm run build`: exit0. 공개113경로·SEO 검사 통과. 기존 HMR 포트 권한/Browserslist 경고는 남아 있다.
- 빌드된 ID29 공개 HTML을 별도 파싱해 원래 Recipe 이름·1인분·원문 재료가 유지되고, 개인 미리보기 결과/선입력값이 없음을 확인했다. 개발 서버 E2E가 빌드 HTML 검증을 대신한 것은 아니다.
- 변경 JS/JSX·단위/브라우저 테스트·설정 ESLint 및 `git diff --check` 통과.
- 브라우저 첫 실행: **모바일 입력/작은 양/창 이탈, API 모드 로그아웃 분리 2개 통과**. 원본·재고 보존 시나리오1개는 ‘참깨’가 재료행과 경고행에 함께 있어 선택자가 중복 매칭되어 중단됐다. 선택자를 경고행으로 좁혔지만 재실행은 아직 못 했다.
- 당시 브라우저 재실행 제한: 로컬 서버 권한 확장 요청의 자동 승인 서비스가 `Selected model is at capacity`로 두 번 실패했다. 다른 도구·포트로 우회하지 않았다. 이후 4단계 작업에서 승인 서비스 복구 후 해당3개를 모두 재검증했고, 새 시나리오까지5개로 확대했다.
- 390px 모바일 스크린샷에서 가로 넘침·겹침 없이 입력·상태·실제량·양념 경고가 보이고 버튼 높이44px 이상임을 확인했다. 원문 검수 한계와 양념 접기 구조는 기존 디자인을 유지한 화면 설계 원칙을 적용했다.

재현: `npm run dev`로 앱을 열고 `/recipes/29-부추-콩가루-찜`에서 조선부추25, 날콩가루7을 입력해 확인한다. 결과는 조선부추25g·날콩가루 약3g이며 내부값은3.5g이다. 빈 양념과 참깨는 확인 필요로 남는다. 원문은50g·7g 그대로이며 재고/재구매 목록은 변하지 않아야 한다.

```sh
npm run test:run -- src/features/recipes/__tests__/recipeQuantityContract.test.js src/features/recipes/__tests__/scaledCooking.test.js src/features/recipes/__tests__/quantityDisplay.test.js src/features/recipes/__tests__/quantityRecipeCatalog.test.js src/features/recipes/__tests__/scaledCookingForm.test.js src/features/recipes/__tests__/ScaledCookingPanel.test.jsx src/pages/__tests__/PublicRecipePage.test.jsx
npx playwright test e2e/scaled-cooking.spec.js e2e/scaled-cooking-account.spec.js --workers=1
```

## 이전 개발 단위 및 검증 이력 — 5단계 연결 전 기록

### 4단계 최신 검증 — 2026-09-15

- 착수 시 기준선: 99파일741개, 724통과/기존17실패. 승인 서비스 복구 후 이전 미리보기 브라우저3개 모두 통과했다.
- 완료 검사: `npm run test:run` **104파일823개 중806통과/기존17실패**, exit1. 추가된 실패는 없고 기존 중복 재료 정책 테스트는 수정·제외하지 않았다.
- `npm run build`: exit0. 공개113경로 SEO 검사 통과. 기존 HMR 포트 EPERM/Browserslist 경고는 남는다.
- `npx playwright test e2e/scaled-cooking.spec.js e2e/scaled-cooking-account.spec.js --workers=1`: **5/5 통과**. 반복 미리보기·새로고침·원문/재고/재구매 보존, 모바일0/작은양/창이탈, 상세↔추천/키보드/계정 로그아웃, 세 원문의 독립 입력을 확인했다.
- 최종 재검증 도중 자동 승인 서비스 용량 오류가 한 차례 있었으나 우회하지 않았고, 같은 로컬 서버·모의 API 검사 범위로 재시도 후 완료했다. 현재 브라우저 검사는 보류 상태가 아니다.
- 변경 JS/JSX·관련 테스트 ESLint와 `git diff --check` 통과. 신규 계약/순수함수/상태 전이/페이지 연결은 실제 assertion 실패를 확인한 뒤 구현했다. 기존 분석 이벤트 허용 목록에 개인 수량이 들어가지 않는 보호 검사도 통과했다.
- 빌드된 `dist/_seo/recipes/29-*.html`, `31-*.html`, `95-*.html`을 별도 파싱: 원문 Recipe 이름·기존 `recipeYield:1` 유지, 개인 입력값·결과·확인 문맥 없음.
- 390px 카드와 데스크톱 입력 화면을 시각 확인했다. 가로 넘침 없이 실제량·양념 확인이 분리되고 키보드 버튼과 원문 링크는 독립 동작한다. 기존 글꼴/배치를 유지하고 정량 부분만 조리 안내에 맞춰 보강한 디자인 지침을 적용했다.
- 계정 전환 첫 렌더에서 기존 재고가 남는 경계는 `inventoryScope`를 추가해 새 추천·미리보기에서 차단했다. 이 변경은 재고 소유 범위를 알려주는 읽기 메타데이터이며, 재고 저장값·서버 계약·CRUD를 바꾸지 않는다.

### 4단계 변경 파일

- 출처/정렬: `quantityRecipeCatalog.js` 확장, 신규 `quantityRecommendationCatalog.js`, `quantityRecommendationBridge.js`, `quantityRecommendationOrder.js` 및 각 테스트.
- 확인값: 신규 `RecipeQuantitySession.jsx`, `RecipeQuantityProvider.jsx`, `src/hooks/useRecipeQuantitySession.js`, `useQuantityMealDate.js`와 세션/날짜 테스트.
- 상세 입력: `ScaledCookingPanel.jsx`, `PublicRecipeQuantityPreview.jsx`, 패널/공개 페이지 통합 테스트.
- 실제 추천: `src/hooks/useLocalRecommendations.js`, `useRecipesPageModel.js`, `src/pages/RecipesPage.jsx`, `recommendationSections.js`, `src/components/RecipeCard.jsx`, 신규 `QuantityRecommendationSummary.jsx`와 카드/집계 테스트.
- 앱 경계: `src/main.jsx`, `src/entry-server.jsx`, `src/hooks/useIngredients.js` 및 scope 전환 테스트.
- 보호 검사: `src/api/__tests__/recommendationEventsApi.test.js`, `e2e/scaled-cooking.spec.js` 확장. 기존 계정 E2E도 다시 실행했다.
- 사용법/기록: `README.md`, `CHANGELOG.md`, 이 문서. 이전 0~3단계 파일과 아래 이력도 유지한다.

### 이번 단계 변경 파일

- 신규 정량 원본: `src/features/recipes/quantityRecipeCatalog.js`.
- 신규 입력/화면: `src/features/recipes/scaledCookingForm.js`, `ScaledCookingPanel.jsx`, `PublicRecipeQuantityPreview.jsx`.
- 신규 단위·통합 검사: `src/features/recipes/__tests__/quantityRecipeCatalog.test.js`, `scaledCookingForm.test.js`, `ScaledCookingPanel.test.jsx`, `src/pages/__tests__/PublicRecipePage.test.jsx`.
- 신규 브라우저 검사: `e2e/scaled-cooking.spec.js`, `e2e/scaled-cooking-account.spec.js`.
- 연결 수정: `src/pages/PublicRecipePage.jsx`, `playwright.config.js`.
- 진행/사용법 수정: `README.md`, `CHANGELOG.md`, 이 문서. 이전 단계의 정량 계약·계산·표시 함수와 테스트·Vitest 수집 수정은 유지한다.
- 사용자 기존 `.agents/`, `skills-lock.json`, 별도 사이트 디자인 문서는 변경하지 않았다.

### 다음 완료 단위

| 단위 | 필요한 실제 연결 / 완료 검사 |
| --- | --- |
| 4A 출처 정량 연결 — 구현 | seed와 출처 대조3개를 정확 ID·버전으로 연결. 원문 링크와 상세↔추천 실제 이동·카드 검증 |
| 4B 확인값·정렬·그룹 — 구현 | 다른 요리로 확인값 복사 금지. 동일 조건 양수 배율 정렬, 작은 양/미확인/0 보존, 종류·정량 집계 분리와 브라우저 검증 |
| 5A 계획·재고 계약 — 기반 구현 | 명시적 승인량 입력 계약과 DB v3 공동 트랜잭션 추가. 현재 planned/skipped/empty는 사용자 확정 상태가 아니며, 실제 확인값 저장·전체 미래 주 조회 repository는 남음 |
| 5B 공통 배분 — 순수 계산 구현 | 전체 미래 확정 수요를 시간순 배분. 300g/두 끼200g→부족100g, 주 경계·기한·단위·미확인량 검사. 끼니별 배분량만 축소 계산에 전달. 실제 저장 자료 연결은 남음 |
| 5C 승인·장보기 — 파생 계산 구현 | 식단 출처 부족/확인 필요 계산은 구현. 승인 직전 재고·모든 관련 주의 재검사, 예정량·장보기 저장, 잠금·수동 기록 보존을 실제 화면에서 검증해야 함. 실제 소비는 별도B3 |

전역 배분과 식단 부족분의 순수 계산은 구현했으나 앱의 주간 승인·장보기 갱신은 아직 연결되지 않았다. 기존 식단16개는 정량 미확인 그대로다. 기존 `planned` 상태를 사용자 확정으로 간주하지 않으며, 개별 요리 확인값을 주간 총재고로 복사하지 않는다. 주간 연결의 첫 UI를 ‘사용자가 날짜를 골라 곁들일 단품 추가’로 할지, 완성된 한 끼 조합을 검수한 뒤 진행할지 사용자 선택을 요청했다. 세 단품을 저녁 전체로 자동 삽입하지 않는다. 미응답 상태에서도 두 방식에 공통인 계산·저장 기반 작업은 진행할 수 있으며, 이를 전체 기능 완료나 사용자 선택 확정으로 취급하지 않는다.

5단계에는 재고 확인량/원재고 버전, 전체 미래 확정 계획 집합, 슬롯별 승인 예정량과 식단 출처 장보기 계약이 필요하다. 저장 직전 원재고·모든 관련 주의 revision을 한 트랜잭션에서 다시 검사해야 한다. 기존 장보기는 consumed 재고 편집이므로 별도 식단 파생 목록을 사용해야 수동 기록을 보존할 수 있다. 잠금·건너뛰기·복원·인원 변경의 재확인 규칙도 함께 검증해야 한다. 실제 소비/취소는 B3로 남긴다.

운영 배포나 전체 브라우저 회귀를 완료했다고 주장하지 않는다. 커밋·푸시·배포는 수행하지 않았다.

## 5단계 공통 계산·저장 기반 — 2026-09-16

이 절은 **저장·화면 연결 전의 부분 구현 기록**이다. 아래 검증 수치와 당시 남은 작업을 보존한다. 이후 실제 승인 연결 결과는 문서 마지막 절에 별도로 기록한다.

### 구현한 경계

- `mealPlanAllocation.js`: 같은 계정의 모든 입력 주에서 미래 `confirmed` 수요를 날짜·ID 순으로 배분한다. 초안·건너뜀·완료·보관은 제외하고, 호환되는 확인 재고만 기한 우선으로 사용한다. 명시적 0과 누락을 구분한다. 앞선 수요의 양이 미확인이면 같은 식품을 뒤 끼니에 낙관적으로 배분하지 않으며, 식품 정체성 자체가 불명확하면 전체를 확인 필요로 남긴다. 유효기한이 지난 배치는 다른 유효 배치가 충분해도 확인 안내를 유지한다. 계획만으로 실제 재고는 줄지 않는다.
- `mealPlanQuantityDomain.js`: 원본 레시피·인원·선택 행·승인 배율을 대조해 별도의 확정 수요를 만든다. 사용자가 절반 분량을 승인했다면 새 재고가 생겨도 자동으로 원래 분량을 요구하지 않는다. 끼니별 배분량만 기존 축소 계산에 전달하며 같은 재료의 원문 행이 중복돼도 배분량은 한 번만 전달한다. 버전·계정·날짜·수요가 달라진 결과는 거부한다. 새 미리보기는 기존 승인 수요를 수정하지 않는다. 실제 저장 직전 최신 자료를 다시 읽는 CAS는 아직 구현되지 않았다.
- `mealPlanShopping.js`: `source:'meal-plan'`의 파생 목록만 만든다. 정확한 식품·상태·단위·필수 여부별로 묶고 원래 끼니·레시피·행 ID를 보존한다. `knownMissingAmount`는 확인된 부족분의 부분 합계이며 `needsConfirmation:true`이면 전체 부족량이 확정됐다는 뜻이 아니다. 기존 수동 목록·재구매 재고를 인자로 받거나 변경하지 않는다. UI에서 이 목록을 기존 목록 전체의 대체값으로 사용하면 안 된다.
- `indexedDB.js`: v2→v3에서 `mealPlanningState`만 추가하고 기존 재고·식단을 보존한다. `runMealPlanningTransaction()`은 재고·기존 식단·새 계획 상태를 한 트랜잭션으로 읽고 쓸 수 있게 한다. 완료 이벤트 후에만 결과를 반환하며 오류·취소는 전체 롤백한다. Promise를 반환하는 비동기 handler도 거부해 조기 성공 표시를 방지한다. 요청 콜백 안의 결과 수집·검증을 사용해야 한다. 계정 삭제는 세 저장소를 함께 정리한다.

모든 양은 표시 반올림 전 수치다. 표현 가능한 작은 양수를 임의로 제거하지 않는다. JavaScript Number 범위를 벗어나거나 양수 덧셈·차감이 정밀도 때문에 사라지는 경우에는 `numeric_range`로 거부하고 부분 결과를 내보내지 않는다. 원재고의 `반 모` 등 문자열에서 수치를 추정하지 않는다. 4단계의 개인 메모리 확인값을 자동으로 주간 재고에 저장하는 연결도 추가하지 않았다.

### 이번 변경 파일

- 신규: `src/features/mealPlans/mealPlanAllocation.js`, `mealPlanQuantityDomain.js`, `mealPlanShopping.js`와 각각의 `__tests__/*.test.js` — 6개 파일.
- 수정: `src/db/indexedDB.js`, `src/db/__tests__/indexedDB.test.js`, `src/features/mealPlans/__tests__/mealPlanRepository.test.js`.
- 문서: `README.md`, `CHANGELOG.md`, 이 문서.
- 원문 레시피, 기존 16개 식단, 기존 추천 정책 및 의도된 실패 테스트는 변경하지 않았다. 실제 소비·입고 이벤트는 이번 범위가 아니다.

### 검증

- 테스트 우선 지침에 따라 배분·승인량·장보기·DB 실패 시나리오를 실제 assertion RED 후 구현했다. 단순 미존재 import 오류를 RED로 세지 않았다.
- 새 순수 계산 검사 **145개 통과**: 배분67개, 승인량/미리보기61개, 장보기17개. 실제 출처 대조된 ID29·31·95도 공통 배분기를 통과시켰다. 가정한 재고를 사용한 통합 검사이며 실제 사용자 조리·보유량을 검증한 것은 아니다.
- DB 기반 검사14개 추가. 관련 5개 파일을 함께 실행해 **182개 통과**. v2 원형 보존, 3스토어 원자성, 잘못된 비동기 handler, 다른 계정/탭, 계정 삭제 실패를 포함한다.
- 최종 전체 `npm run test:run`: **107파일982개 중965통과/기존17실패**, exit1. 실패는 `recommendations.agent-regression.test.js`16개와 `recommendations.test.js`1개뿐이다.
- 이번 착수 때 병렬 빌드와 함께 실행한 전체 검사에서 공개 페이지 첫 테스트가 추가 실패했다. 단독 두 번과 이후 순차 전체 두 번에서는 재현되지 않았다. 정확한 초기 오류 전문을 보관하지 못했으므로 원인을 자원 경쟁으로 확정하지 않는다. 타임아웃을 늘리거나 테스트를 제거하지 않았다.
- 최종 `npm run build`: exit0, 공개113경로·SEO 검사 통과. 기존 HMR 포트 EPERM 및 Browserslist 경고는 남는다.
- 변경한9개 JS/테스트 파일 ESLint 및 `git diff --check` 통과. 최종 브라우저 검사 **9/9 통과**: 기존 냉장고 CRUD, 주간 식단 교체·잠금·새로고침·모바일, 분량 미리보기·추천 연결·원문 보존, 로그인/로그아웃 분리. 아래 명령으로 재현할 수 있다. 이는 새 단계5 화면 검사가 아니라 기존 동작의 회귀 검사다.

```sh
npm run test:run -- src/features/mealPlans/__tests__/mealPlanAllocation.test.js src/features/mealPlans/__tests__/mealPlanQuantityDomain.test.js src/features/mealPlans/__tests__/mealPlanShopping.test.js src/db/__tests__/indexedDB.test.js src/features/mealPlans/__tests__/mealPlanRepository.test.js
npm run test:run
npm run build
npx playwright test e2e/scaled-cooking.spec.js e2e/scaled-cooking-account.spec.js e2e/meal-plan.spec.js e2e/meal-plan-account.spec.js e2e/local-only.spec.js --workers=1
```

### 당시 다음 연결 작업 — 아래 최신 절에서 구현 결과 확인

1. 새 저장소에 원재고 행에 연결된 정량 확인값과 슬롯별 승인량을 보관하는 repository를 만든다. 기존 문자열을 검수량으로 승격하지 않으며 유효한 계정 범위를 검사한다.
2. 전체 미래 계획과 원재고를 같은 읽기 스냅샷으로 조회하고, 승인 시 같은 트랜잭션 안에서 원재고 내용·계획 ID/revision 집합·계획 상태 revision을 비교한다. 새 주의 추가/삭제도 충돌 검사에 포함한다.
3. 저장된 원본 버전·인원·제외 조건·잠금·건너뜀·복원과 일치하는지 확인한 다음 승인 예정량과 장보기를 갱신한다. 단품을 완성된 저녁으로 표시하거나 다른 끼니를 자동 교체하지 않는다.
4. 실제 승인·저장 실패·재시도·다른 탭·계정 전환과 수동 장보기 보존을 화면에서 검증한다. 이 흐름이 확인되기 전 단계5 전체를 완료로 표시하지 않는다.

## 최신 결과 — 주간 정량 반찬 승인·장보기 연결, 2026-09-16

목표 문서의 0~5단계 연결을 구현·검증했다. 범위는 **원문 대조된 개별 반찬을 사용자가 날짜별로 선택하고 분량을 승인하는 경험**이다. 전체 PRD 구현, 기존 16개 저녁 조합의 정량 검수, 운영 배포 완료 선언이 아니다.

### 실제 사용 흐름

`주간 식단 생성 → 정량 반찬 계획 펼치기 → 냉장고 행의 재료·상태·단위·양·기한 확인 → 날짜·반찬 선택 → 분량 미리보기 → 이 분량을 식단에 승인 → 정량 반찬 장보기`

- 기본 저녁 메뉴를 보존하고 날짜당 정량 반찬 한 가지를 별도 `quantity-side`로 승인한다. 자동 추가나 한 끼 전체 확정은 하지 않는다. 기존 목표의 개별 레시피부터 시작하는 범위에 맞춘 제한적 연결이다. 완성된 저녁 조합을 선호한다는 사용자 결정을 대신 확정한 것은 아니다.
- 상세 페이지의 임시 요리 확인값과 주간 총재고 확인값은 별도다. 원재고 행을 사용자가 직접 식품·상태·단위에 연결하며 문자열 수량·팬트리 소유만으로 양을 만들지 않는다. 등록되지 않은 양은 미확인이고, 저장된 `unknown + 숫자`도 UI에서 확인된 양으로 승격하지 않는다.
- 저장된 확인값은 원재고 전체 기준값과 개별 행 기준값에 연결된다. 원재고 편집·추가·삭제가 감지되면 다시 확인하기 전 확정 배분·장보기를 보류한다. 계정별 확인값과 계획은 섞이지 않는다.
- 원래 인원 분량으로 가상 배분한 뒤, 해당 끼니에 남은 본재료 배율을 계산한다. 보유량에 맞춘 분량을 기본 제안하며 원래 분량 유지도 선택할 수 있다. 승인한 반찬의 수요만 다시 계산하고 다른 끼니 분량을 자동 확대·교체하지 않는다.
- 승인 직전 재고·모든 주의 ID/내용/revision·계획 상태 revision·서울 기준 날짜를 같은 트랜잭션에서 재검사한다. 요청된 변경도 원문에서 다시 계산하며 호출자가 보낸 수량 결과를 그대로 저장하지 않는다. 중복 승인과 오래된 미리보기는 거절한다. 저장 실패를 성공으로 표시하지 않는다.
- 저장소에는 확인값과 승인 선택을 보관한다. 배분·장보기는 동일한 저장 스냅샷으로 매번 파생하므로, 별도 장보기 캐시가 오래된 상태로 남지 않는다. 구매/소비 이벤트나 기존 consumed 재구매 항목은 생성하지 않는다.
- 기존 주간 식단 저장도 같은 3개 저장소 트랜잭션을 사용한다. 잠금을 우회한 건너뛰기·메뉴 교체를 거절한다. 인원·메뉴·제외 조건이 바뀐 승인은 중지하고 확인 필요를 남긴다. 이를 0 수요처럼 취급해 다른 끼니 재고를 낙관적으로 늘리지 않는다. 명시적 외식·계획 삭제만 예정 수요를 해제하며, 복원만으로 정량 승인을 되살리지 않는다.
- 반찬 장보기는 별도 영역이다. 단위·상태 미확인 재료를 억지로 합치지 않고 필요한 확인 사항을 표시한다. 실제 사용량, 기존 수동 기록, 이미 입고한 재고를 덮어쓰지 않는다. 새로고침 후 승인된 재료량을 다시 볼 수 있다.

### 이번 연결 변경 파일

- 신규 도메인/저장: `src/features/mealPlans/mealPlanningStock.js`, `mealPlanningBindings.js`, `mealPlanningRepository.js`.
- 신규 화면: `src/features/mealPlans/MealPlanningPanel.jsx`. 기존 화면 톤을 유지하고, React 지침에 따라 사용자가 펼칠 때 지연 로딩한다. 양·단위·조리 상태를 분리하며 모바일의 체크/라디오 크기와 가로 넘침을 검사했다.
- 신규 단위·통합 검사: 위 4개 모듈의 `src/features/mealPlans/__tests__` 파일 4개.
- 수정: `src/features/mealPlans/mealPlanRepository.js`, 해당 테스트, `src/pages/MealPlanPage.jsx`, `playwright.config.js`.
- 신규 브라우저 검사: `e2e/meal-planning-quantity.spec.js`.
- 문서: `README.md`, `CHANGELOG.md`, 이 문서. 기존 원문 데이터·16개 카탈로그의 미검수 수량·의도된 추천 정책 실패는 변경하지 않았다.

### 최종 검증 결과

- 테스트 우선으로 저장·승인·화면의 실패를 확인한 뒤 구현했다. 재검토에서 발견한 미확인 숫자의 확인값 승격, 다진/생마늘 표시 혼동, 날짜 변경 뒤 미리보기, 중지된 수요의 낙관적 해제, 숫자 계산 실패의 빈 장보기 표시도 각각 실패를 재현하고 수정했다.
- 신규 4개 검사 파일 **199개 통과**: 재고 확인97, 슬롯 연결63, 승인 저장33, 화면6. 기존 식단 저장에 추가한3개도 통과했다. 실제 IndexedDB 대역에서 트랜잭션·계정·재시도·저장 실패를 검증했으며, 실사용자 보유량이나 실제 조리 검증은 아니다.
- 최종 `npm run test:run`: **111파일1,184개 중1,167통과/기존17실패**, exit1. 기존 `recommendations.agent-regression.test.js`16개 및 `recommendations.test.js`1개 외의 신규 실패는 없다. 실패를 삭제·skip하거나 관계없는 추천 정책을 변경하지 않았다.
- 최종 `npm run build`: **exit0**, 480개 모듈 빌드 및 공개113경로·SEO 검증 통과. 기존 Browserslist 경고와 SEO 생성 중 HMR 포트 `24678`의 sandbox EPERM 경고는 남으며 빌드 자체는 성공했다.
- 변경13개 JS/JSX·테스트·설정 파일 ESLint 및 `git diff --check` 통과.
- 최종 브라우저 검사 **10/10 통과**. 새 모바일 주간 연결에서225g 재고를 첫150g·다음75g으로 나눠 승인하고 새로고침 후 복원했다. 기존 저녁 메뉴·물리 재고·직접 적은 재구매 기록은 불변이었다. 기존 주간 교체·잠금·모바일·계정, 개별 미리보기·추천·원문, 냉장고 CRUD도 함께 회귀 검사했다.
- 화면 캡처를 직접 확인해 공통 입력 스타일로 체크/라디오가 약254px까지 늘어나던 문제를 발견했다. 실제 너비 실패를 검사에 추가하고 수정한 뒤10개 전체를 다시 통과시켰다. 중간 테스트의 잘못된 정확 라벨 선택자와 두 끼의 미확인 통깨를 단일 항목으로 기대한 검사도 실제 접근성 이름·미확인 분리 계약에 맞게 수정했다. 일시적 로컬4173 포트 충돌은 종료 후 같은 테스트를 재실행했으며 다른 서버로 우회하지 않았다.

```sh
npm run test:run
npm run build
npx playwright test e2e/meal-planning-quantity.spec.js e2e/scaled-cooking.spec.js e2e/scaled-cooking-account.spec.js e2e/meal-plan.spec.js e2e/meal-plan-account.spec.js e2e/local-only.spec.js --workers=1
```

### 남는 한계와 다음 단계

1. 원문 대조3개는 반찬이며 사람·실조리·영양 전문가 검증은 아직0개다. 정량 카탈로그의 실조리 검수와 한 끼 구성 확충이 다음 데이터 작업이다.
2. 기존16개 저녁의 정량 수요는 계산하지 않는다. 화면의 장보기는 명시적으로 승인한 정량 반찬에 한정한다. 재고 매핑·양 확인도 사용자의 직접 입력이 필요하다.
3. 실제 구매 입고·조리 소비·취소, 정량 영양, 조리시간 조정, 가격·구매 제휴, 서버 동기화·식단 백업은 이 목표의 구현 범위가 아니다. B3는 별도 이벤트·원자성 검증 후 진행한다.
4. 여러 승인에 동시에 재확인이 필요하면 해당 선택을 다시 승인하거나 제외해야 계산을 재개한다. 불확실한 수요를 숨기지 않는 보수적 동작이며 입력 부담은 파일럿에서 개선한다.
5. 커밋·푸시·배포는 수행하지 않았다. 배포 전 기존17개 추천 정책 실패의 처리 방침과 소수 사용자의 실제 조리 경험을 별도로 확인한다.
