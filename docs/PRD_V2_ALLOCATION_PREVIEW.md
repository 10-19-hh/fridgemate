# PRD v2: 전체 미래 식단 배분과 읽기 전용 장보기

기록일: 2026-09-15. B2의 계산·읽기·화면 연결 단위다. B1/B2 전체나 P0 출시 완료가 아니다.
전체 요구사항과 남은 조건은 [진행 기록](PRD_V2_PROGRESS.md)에 유지한다.

이 문서는 배분 단계 완료 당시의 계약·검증 기록이다. 후속 [수량 확인 연결](PRD_V2_INVENTORY_QUANTITY.md)에서
DB v4의 원본 재고·수량 확인·식단 3개 저장소를 함께 읽도록 확장했고 반환값은
`{ scope, ingredients, inventory, confirmedPlans, quantityReviews }`다. 확인·취소 입력 화면과
계정 정리도 추가했다. 아래의 DB v3·입력 화면 없음·1,175개/35개 결과는 당시 상태다.

## 이번 범위

여러 주의 확정 식단과 재고를 일관된 시점에 읽고, 가까운 식사일부터 같은 재고를 한 번씩만
배분한다. `/meal-plan`의 **식단 장보기 확인**에서 확인된 부족분, 확인할 재료, 선택하지
않은 선택 재료를 구분한다. 결과는 읽기 전용이며 구매·입고·조리·재고 차감이 아니다.

기존 `ShoppingListPanel`의 항목은 소비 완료된 재고 자체이며 수량·메모 편집이 재고를
수정한다. 여기에 식단 파생행을 넣지 않았다. 기존 수동 입력 메모와 재구매 항목을 보존하며,
새 수동 장보기 저장 모델이나 구매 이력 저장 모델을 구현했다고 주장하지 않는다.

## 변경 파일

- 계산: `src/features/mealPlans/mealPlanAllocation.js`와 `__tests__/mealPlanAllocation.test.js`.
- 저장 경계: `src/db/indexedDB.js`, `src/features/mealPlans/mealPlanRepository.js`와 각 테스트.
- 화면: `src/components/MealPlanShoppingPreview.jsx`와 해당 테스트, `src/pages/MealPlanPage.jsx` 연결.
- 브라우저: `e2e/meal-plan.spec.js`에 미리보기·초안/확정·재로드·창 복귀 사례.
- 문서: 이 문서, README, CHANGELOG, PRD_V2_PROGRESS.

기존 미커밋 작업을 보존했다. 원본 루트·추천 실습 파일, 정량 원천 카탈로그, 별칭 사전,
인증·서버·의존성·테스트 설정은 이번 단위에서 변경하지 않았다. IndexedDB v3와 기존
저장소를 그대로 사용하며 스키마 업그레이드·쓰기·자동 병합·배포는 하지 않는다.

## 읽기와 계산 계약

`readMealPlanningSnapshot(scope)`는 같은 scope DB의 `ingredients`와 `mealPlans`를
하나의 readonly transaction으로 읽고 **transaction 완료 이후** 결과를 반환한다.
읽기 후 abort는 성공이 아니다. 삭제 tombstone은 제외하고 소비 완료 항목은 반환하되
계산기에서 제외한다. 서로 다른 transaction의 결과를 Promise.all로 합치지 않는다.

`getMealPlanningSnapshot(scope)`는 모든 주별 레코드를 검증하고
`{ scope, ingredients, confirmedPlans }`를 반환한다. 초안·보관본은 수요로 반환하지 않으며
과거 v1을 자동 확정하지 않는다. 손상되거나 다른 scope의 자료가 있으면 부분 성공으로
숨기지 않고 읽기를 중단한다. 과거 확정본도 조회되지만 날짜 필터는 계산기가 맡는다.

`allocateMealPlanInventory({ scope, confirmedPlans, inventory, today })`는 입력을 변경하지
않는 순수 함수다. `today`는 명시적 YYYY-MM-DD이며 화면에서는 기존 식단 날짜와 같은
브라우저 현지 날짜를 사용하고 이를 표시한다. 오늘을 포함해 날짜순으로 계획 상태인
확정 슬롯만 계산한다. 과거·건너뜀·빈 슬롯·조리 완료는 수요에서 제외한다. 중복 슬롯·
중복 배치·명시적으로 다른 scope·잘못된 날짜는 추측하지 않고 오류로 처리한다.

수량 배치 입력은 다음 조건을 모두 만족해야 숫자로 배분한다.

- `ingredientKey`로 명시된 식품 동일성, `preparationState`의 raw/cooked/as-sold 구분.
- 유한한 0 이상 `amount`, 호환되는 `unit`, `quantityStatus: verified`, 비어 있지 않은 `quantityEvidence`.
- 식사일 이전에 지나지 않은 유효한 `expiryDate`. 날짜 당일은 후보로 취급하되 안전 보장은 아니다.
- g/kg, ml/l, 개만 지원. 밀도·조리 수율·포장 크기를 추정하지 않는다.
- 0.001 기준 정수 계산과 숫자 표현 왕복 검증. 합계·배분 출력이 정밀도를 잃으면 계산을 거부한다.

확인된 후보는 기한이 가까운 순서, 같은 기한은 ID순으로 배분한다. 별칭 이름 일치를
정량 동일성으로 사용하지 않는다. 원문 소스 행은 합치거나 삭제하지 않고 B1 수량 계산의
참조와 부분 합계를 보존한다.

### 불확실성

- 확인 재고 300g + 두 끼 각 200g이면 200g/100g 배분, 부족 100g이다. 실제 재고는 300g 그대로다.
- 미확인 **추가 재고**가 있어도 확인된 별도 배치는 배분할 수 있다. 다만 남은 필요량을
  정확한 구매 부족량으로 확정하지 않는다.
- 앞선 **미확인 수요**는 이후 같은 재료의 재고 가용량도 불확실하게 만든다. 양을 0으로
  간주하거나 임의 예약량을 만들지 않는다. 품목 자체가 불명이면 이후 충분 판정을 보수적으로 막는다.
- 소금의 양이 불명이라는 이유로 명시적으로 다른 닭고기의 배분까지 막지는 않는다.
- 미확인 원문 행에 다른 재료 또는 첫 번째 단위의 부분 합계를 붙이지 않는다.
  모든 알려진 부분 합계는 슬롯의 `requirements`에 단위별로 보존한다.
- `uncoveredAmount`는 확인된 배분으로 충당하지 못한 양이지 항상 확정 구매 부족량은 아니다.
  화면의 미확인 목록에서는 이 숫자와 부분 합계를 구매량으로 표시하지 않는다.

## 화면과 현재 데이터의 한계

자동 실행 대신 명시적 조회 버튼을 사용하고, 로컬 저장 상태를 읽은 시각과 전체 미래
확정 식단 범위를 표시한다. 계정·현재 주의 저장 revision 변경 시 이전 결과를 폐기한다.
창에 돌아오면 결과를 숨기고 다시 계산을 요구한다. 오래된 응답·다른 계정 응답·실패한
조회 결과는 성공 목록에 반영하지 않는다. 다른 화면의 변경을 실시간 구독하는 기능은 아니다.

기존 녹색 팔레트와 글꼴을 유지하고 부족분·미확인·선택 항목을 접는 목록으로 분리했다.
React 가이드에 따라 조회는 사용자 동작에서 실행하고 결과를 별도 장보기 저장 상태로
복제하지 않는다. TDD로 예상 실패를 확인한 뒤 구현하고 검토 반례도 회귀 테스트로 보완했다.

**현재 기본 16개 조합은 여전히 정량 미검수다.** 실제 화면은 확인할 재료명을 제공하며
완성 한 끼의 정확한 구매량을 보장하지 않는다. `quantity: '300g'`, `반 모`, 팬트리 보유
체크도 확인된 수량으로 자동 승격하지 않는다. 현재 사용자 입력 화면에는 위 정량 배치
계약을 확인·저장하는 기능이 없다. 테스트의 200g/300g 예시는 합성 산술 자료이며 제품
카탈로그나 사용자 재고를 수정한 것이 아니다.

## 검증 기록

전용 작업 공간 `/private/tmp/fridgemate-prd-v2-b1-Lba78Azy`, HEAD
`986051a6693a20e305adaff355530c5a2779774c`, 브랜치 `codex/prd-v2-quantity-contract`.
검증 자료: `/private/tmp/fridgemate-prd-v2-allocation-Nrr7nCoZ`.

- 착수 기준선: 실제 재실행 148파일, 1,100/1,100 통과. 다른 작업 트리 파일 0, skip/todo 0.
- 배분 첫 RED: 5/5, 경계 확장 후 37/37 assertion 실패. GREEN 후 날짜 형식 3개, 검토 반례 6개를 추가해
  각각 37통과/3실패, 40통과/6실패를 확인했다. 최종 배분 46/46 통과.
- 저장 경계 RED: 기존 77통과/신규 17 assertion 실패 → 94/94 통과.
- 화면 RED: 신규 12개 버튼/기능 assertion 실패 → 12/12 통과. 기존 페이지 12개도 유지.
- 브라우저 신규 2개는 구현 전 실제 브라우저에서 없는 영역/버튼 assertion 실패를 확인했다.
- 최종 전체: 150파일 1,175/1,175 통과, skip/todo 0, 현재 작업 공간 밖의 테스트 파일 0.
- 린트·빌드 통과. 공개 정적 경로 113개, sitemap, 개인 화면 noindex 검증 통과.
- 전체 브라우저 35/35 통과, 25.5초. 기존 계정/동기화/저장 실패 흐름과 새 장보기 두 사례 포함.
- 읽을 수 있는 모바일 뷰포트 캡처를 추가한 뒤 해당 브라우저 사례도 1/1 재통과했다(2.1초).
- Prisma 관련 실패는 이번 실행에서 없었다. NO_COLOR/FORCE_COLOR 경고와 고의 API 실패
  시나리오의 경고는 로그에 보존했으며 테스트 실패가 아니다.

브라우저는 격리된 로컬 저장소·테스트 서버·가짜 API를 사용한다. 운영 배포·실제 계정·
운영 DB·실사용 성능을 확인한 결과가 아니다. 390px 모바일에서 가로 넘침과 캡처를 점검했다.
작업 도중 원본 루트에 별도 레시피 수량 파일과 vitest.config.js 변경이 관찰됐으며 손대지 않았다.
원본 루트가 계속 무변경이었다고 주장하지 않는다. 이 작업은 전용 작업 공간에서만 수정했다.

Node 24.19.0을 사용한다. package.json과 lockfile 일치를 확인한 기존 검증 의존성
`/private/tmp/fridgemate-weekly-pr-CtPuVjtR/node_modules`를 임시 링크했다. 새 의존성을
설치하거나 루트 `.env`를 복사하지 않았다. 다음 명령은 전용 작업 공간에서 실행한다.

```sh
PATH=/Users/lee/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH npm run test:run -- --exclude '.worktrees/**' --reporter=json --outputFile=/private/tmp/fridgemate-prd-v2-allocation-Nrr7nCoZ/final-tests.json
PATH=/Users/lee/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH npm run lint
PATH=/Users/lee/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH npm run build
PATH=/Users/lee/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH npm run test:e2e -- --reporter=list
PATH=/Users/lee/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH npm run test:e2e -- --project=local-only e2e/meal-plan.spec.js --grep 'shopping preview uses' --workers=1 --output=/private/tmp/fridgemate-prd-v2-allocation-Nrr7nCoZ/visual-check --reporter=list
git diff --check
```

검증 후 node_modules 임시 링크만 제거하며 의존성 원본은 보존한다. 새로 검증할 때는
package/lockfile 일치를 다시 확인하고 같은 링크를 연결해야 한다. 코드·테스트·문서는
미커밋 상태로 유지했고 commit/push/merge/배포는 하지 않았다.

## 다음 완료 조건

실제 사용할 검수된 한 끼 자료 확충과 재고량 확인·원문/버전 연결·저장이 남았다. 이어서
독립적인 수동 장보기·구매 이력 정책과 표시를 완성해야 B2를 닫을 수 있다. 재고 변경은
아직 열지 않는다. B3의 실제 입고·조리 사용량·멱등 소비·반대 이벤트 취소·원자적 저장,
B4 이후 일정 변경·측정·파일럿·후속 예산/공유의 조건은 그대로 남아 있다.
