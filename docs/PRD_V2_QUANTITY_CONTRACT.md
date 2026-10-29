# PRD v2 착수: 기준선·정량 계약·소스 대조 카탈로그

기준일: 2026-09-13. 입력 문서: 사용자가 제공한 `FridgeMate_PRD_v2_2026-09-13.md`.
입력 문서 SHA-256: `ba0a51c1682a2dc768cd9f20a438de11fcf6b7b153c07d6a0264447b914c887e`.
이 문서는 출시 완료 선언이 아니다. 이번 단위는 B0 점검과 B1의 **계산 계약 기반**이며,
검수 카탈로그 확충 및 B2 장보기 연결은 별도 후속 작업이다.
아래 B1a와 그 실행 결과는 9월 13일의 기록이다. 9월 15일 후속 내용과 결과는 문서 끝에
별도로 기록하며, 전체 PRD 진행 상태는 `PRD_V2_PROGRESS.md`에서 관리한다.

## 작업 기준과 보존 범위

- 원격 main 확인 및 착수 커밋: `986051a6693a20e305adaff355530c5a2779774c`.
- 브랜치: `codex/prd-v2-quantity-contract`.
- 원본 루트의 `codex/weekly-meal-plan` 및 실습 보관본은 수정하지 않는다.
- 새 작업 공간에서만 실행한다. 기존 변경·미추적 파일·스냅샷·추천 실습을 가져오지 않는다.
- package/lockfile이 바이트 단위로 일치하는 기존 main 검증용 의존성을 임시 링크해 재사용한다.
  Node 24.19.0, Vitest 5.0.0을 사용한다. 원본 루트 의존성이나 `.env`는 복사하지 않는다.
- 실행 시 `.worktrees/**`를 제외하고 JSON 결과의 실제 파일 경로도 이 작업 공간 아래인지 검사한다.

## B0: 코드에서 확인한 격차

| 영역 | 현재 main | 후속 처리 |
| --- | --- | --- |
| 카탈로그 | 16개 편집 조합. 재료별 amount/unit/preparationState=null, 정량 검수 0개 | 인분·원문 행·단위·검수 근거를 갖춘 자료만 정량 계산 |
| 식단 | 생성 즉시 같은 주 레코드에 저장. 초안/확정 상태 없음 | B2 전에 초안과 유효 확정본 분리 |
| 재고 확인 | 끼니별 재료명/기한 비교, 수량 보장 없음 | 전체 미래 확정 식단을 시간순으로 모아 배분 |
| 장보기 | consumed 재료의 재구매 목록, 수량/메모는 재고 자체에 저장 | 식단 계산분과 수동·재구매 기록 분리 |
| 저장 | IndexedDB v3, 범위별 DB, revision 충돌 방지 | B3에서 이벤트·재고·슬롯의 원자적 저장 경계 설계 |

근거: `mealPlanCatalog.js`, `mealPlanDomain.js`, `mealPlanRepository.js`,
`MealPlanPage.jsx`, `IngredientsPage.jsx`, `ingredientSelectors.js`, `indexedDB.js`.
현재 주간 식단의 수량 미확인 안내·게스트/계정 분리·저장 실패·충돌 보호는 유지한다.

## 이번 B1a의 목표·변경·제외 범위

신규 `src/features/mealPlans/mealQuantityDomain.js`의 순수 함수
`getMealQuantityRequirements(meal, targetServings)`와 같은 폴더의 테스트를 추가한다.
입력의 원문 행은 변경하지 않고 별도의 필요량과 미확인 목록만 반환한다.
README/CHANGELOG 및 이 기록을 함께 갱신한다.

화면 연결, seed/별칭 사전/점수 변경, 기존 추천 테스트, 재고 차감, 입고, 장보기 저장,
식단 확정 모델, DB/schema 변경, 외부 API, 배포는 이번 단위에서 제외한다.
이 모듈은 아직 실제 식단 생성이나 화면에서 사용하지 않는다.

### 정량 계약의 보수적인 첫 버전

- 각 구성 요소의 `servings`/`servingsStatus`가 검수된 기준 인분이다.
  사용자가 고른 식단 인원이나 seed의 `sourceServings`를 검수 근거로 대체하지 않는다.
  목표 인원은 현재 제품 범위인 정수 1 또는 2다.
- 원문 재료 행의 `rawName`, `id`, `amount`, `unit`, 용도 등은 보존한다.
  필수 행은 기본 포함하고, 선택 재료는 `selected: true`인 경우에만 포함한다.
  `selected: false`라고 해서 필수 재료가 사라지지 않는다.
- 정량 계산은 명시적 `ingredientKey`, `preparationState`, `quantityStatus: 'verified'`,
  비어 있지 않은 `quantityEvidence`(원문/검수 참조)가 있는 행만 허용한다.
  구성 요소에도 source.id 및 recipeVersion이 필요하다. 이 검사는 메타데이터 누락을 막는
  장치이지 인용 근거가 사실인지 자동으로 인증하는 기능은 아니다.
- 조리 상태의 초기 허용값은 `raw`, `cooked`, `as-sold`다. `unknown` 등 미확인 값이나
  다른 상태는 검토 전 합산하지 않는다. 상태 이름이 다르면 서로 자동 변환하지 않는다.
- 기존 추천의 넓은 별칭 묶음을 정량 호환성으로 간주하지 않는다. 동일한 명시적 품목 키와
  조리 상태, 호환 차원일 때만 합친다. 예: 소금 본체 2g + 소스 1g = 3g.
- 지원 단위는 g/kg, ml/l, 개이며 계산 단위는 g/ml/개다. 질량↔부피, 모/봉/컵/한 줌,
  식품별 밀도·조리 수율은 추정하지 않는다. 미확인 원문량은 0이 아니다.
- 계산은 기준 단위의 0.001 단위 정수로 다룬다. 인분 환산 후 이 정밀도로 정확히
  표현할 수 없거나 안전한 정수 범위를 벗어나면 반올림으로 확정하지 않고 미확인으로 남긴다.
  이는 초기 구현의 제한이며 조리 정확도·적정 분량의 보장이 아니다.
- 같은 품목/상태에 미확인 행이 남으면 알려진 양은 `knownAmount`(부분 합계)만 제공하고
  전체 `amount`는 null로 둔다. 단위를 모르는 같은 품목은 다른 차원의 알려진 양까지
  확정 총량으로 표시하지 않는다. 미확인 상태의 행은 호환 여부를 임의 확정하지 않는다.
- 결과의 status는 `verified` 또는 `needs-review`. 이는 **입력된 필요량의 계산 가능성**이며
  재고 보유·조리 가능·메뉴 검수 완료·영양 충분을 뜻하지 않는다.
- `requirements[].sourceLines`는 알려진 부분 합계에 기여한 원문 행 참조다.
  `unverifiedLines`의 행은 부분 합계에 들어가지 않는다. 호출자는 원본 meal을 통해
  원문 이름·양·용도를 보여주고 두 목록을 함께 확인해야 한다. 품목 키도 모르는 행은
  특정 합계에 임의 연결하지 않으며, 전체 status는 계속 `needs-review`다.

### 테스트에서 잡을 오류

1. 소스/주재료 이름 중복을 제거해 실제 필요량이 줄어드는 오류.
2. kg↔g, l↔ml 환산 오류와 차원이 다른 수량의 잘못된 합산.
3. 순두부/부침두부처럼 추천 별칭만 같은 식품, 생/조리 상태를 합치는 오류.
4. 미확인·잘못된 수치·인분·근거가 전체 필요량 0 또는 확정 총량으로 바뀌는 오류.
5. 일부 행의 결측이 알려진 부분 합계 뒤에 숨는 오류.
6. 선택/필수 분류를 잘못 적용하거나 원문 행·기존 카탈로그를 수정하는 오류.
7. 원문 행 식별자 충돌로 어느 행을 합산했는지 추적할 수 없는 오류.

## 검수 자료의 한계와 다음 단계

기존 16개는 정량 검수 0개다. 공개 원문 100개나 편집 설명 6개도 이를 대신하지 않는다.
원문에 명시적 1인분이 있는 공개 ID29는 후보지만 반찬이며 `참깨 약간`은 미확인이다.
ID91의 올리브유 구이용/소스용 행은 합산 검토 후보, ID32의 단계에만 있는 세척 소금은
재료표만으로 완전성을 보장할 수 없는 사례다. 실제 원문 버전/해시·인분·용도·누락을
대조한 소수 항목부터 검수하고, 테스트의 가상 fixture를 실제 검수 카탈로그로 배포하지 않는다.

B1a 검토 후 남은 B1 검수 자료를 마련한다. B2는 초안/확정 모델과 전체 미래 조회를
먼저 확정한 다음, 재고 300g에 두 끼 200g씩이면 부족분 100g이 되는 배분·장보기로 진행한다.
실제 입고·소비·취소는 B3로 남긴다. 커밋·push·배포는 별도 승인 없이 수행하지 않는다.

## 실행 결과

이번 새 작업 공간에서 직접 실행한 결과다. 보관된 추천 정책 실습의 39/17 결과와
다른 작업 트리의 과거 결과는 기준으로 사용하지 않았다.

| 단계 | 결과 |
| --- | --- |
| B0 변경 전 | 146파일, 961테스트 전부 통과, skip/todo 0 |
| 신규 계약 첫 RED | 빈 계약 골격에 대해 52개 모두 AssertionError로 실패. import/환경 오류 없음 |
| 첫 GREEN | 52/52 통과 |
| 경계 재현 | 미확인 조리 상태·불확실성 전파·극소 양수 0 처리: 52통과/4 assertion 실패 |
| 리뷰 재현 | 출력 단위 변환의 소량 손실까지 추가: 52통과/5 assertion 실패 |
| 신규 계약 최종 | 57/57 통과 |
| 변경 후 전체 | 147파일, 1,018테스트 전부 통과, skip/todo 0 |
| 린트 | 변경 전·후 모두 통과 |
| 빌드/정적 페이지 | 변경 전·후 모두 통과, 공개 경로 113개와 sitemap/noindex 검증 통과 |
| 기존 브라우저 동선 | 30/30 통과(19.7초), 로컬 테스트 서버와 가짜 API 사용 |

두 전체 JSON 결과의 실제 파일 경로가 모두 이 작업 공간 아래이고 `.worktrees/`가
포함되지 않는 것을 검사했다. Prisma 관련 실패는 이번 실행에서 발생하지 않았다.
처음 제한 환경에서 실행한 빌드는 종료 코드 0/SEO 검증 통과였으나 로컬 포트 제한
경고가 있어, 로컬 서버를 허용한 환경에서 재실행해 경고 없는 통과를 확인했다.
이는 운영 HTTP/Google 계정/실제 DB를 점검한 결과가 아니다.

### 실제 실행 명령

전용 작업 공간: `/private/tmp/fridgemate-prd-v2-b1-Lba78Azy`.
의존성 원본: `/private/tmp/fridgemate-weekly-pr-CtPuVjtR/node_modules`.
검증 기록: `/private/tmp/fridgemate-prd-v2-validation-GXeelCOv`.
Node 런타임의 bin 디렉터리를 PATH 앞에 둔 상태에서 실행했다.

```sh
npm run test:run -- --exclude '.worktrees/**' --reporter=json --outputFile=/private/tmp/fridgemate-prd-v2-validation-GXeelCOv/baseline-tests.json
npm run test:run -- src/features/mealPlans/__tests__/mealQuantityDomain.test.js --exclude '.worktrees/**' --reporter=json --outputFile=/private/tmp/fridgemate-prd-v2-validation-GXeelCOv/quantity-red.json
npm run test:run -- src/features/mealPlans/__tests__/mealQuantityDomain.test.js --exclude '.worktrees/**' --reporter=json --outputFile=/private/tmp/fridgemate-prd-v2-validation-GXeelCOv/quantity-green.json
npm run test:run -- src/features/mealPlans/__tests__/mealQuantityDomain.test.js --exclude '.worktrees/**' --reporter=json --outputFile=/private/tmp/fridgemate-prd-v2-validation-GXeelCOv/quantity-boundary-red.json
npm run test:run -- src/features/mealPlans/__tests__/mealQuantityDomain.test.js --exclude '.worktrees/**' --reporter=json --outputFile=/private/tmp/fridgemate-prd-v2-validation-GXeelCOv/quantity-review-red.json
npm run test:run -- src/features/mealPlans/__tests__/mealQuantityDomain.test.js --exclude '.worktrees/**' --reporter=json --outputFile=/private/tmp/fridgemate-prd-v2-validation-GXeelCOv/quantity-final.json
npm run test:run -- --exclude '.worktrees/**' --reporter=json --outputFile=/private/tmp/fridgemate-prd-v2-validation-GXeelCOv/final-tests.json
npm run lint
npm run build
npm run test:e2e -- --reporter=list
git diff --check
```

각 명령의 콘솔 로그는 위 검증 폴더의 대응되는 `.log` 파일에 보관했다.
새 테스트 수치는 이 작업의 정량 계약 테스트 수이며, 과거 56개 추천 실습 테스트와 무관하다.

### 설치한 스킬과 적용 방식

- `test-driven-development`: 사용자 폴더 `/Users/lee/.codex/skills/test-driven-development`.
  신규 계약의 RED→GREEN과 리뷰 반례를 먼저 테스트하는 데 적용했다. 기존 구현을 삭제하지 않았다.
- `vercel-react-best-practices`: `/Users/lee/.codex/skills/vercel-react-best-practices`.
  이후 React 화면 연결에 사용한다. 이번에 React 컴포넌트나 프레임워크를 변경하지 않았다.

공식 설치 도우미로 각각 `obra/superpowers`의 `skills/test-driven-development`,
`vercel-labs/agent-skills`의 `skills/react-best-practices`를 설치했다.
기존 저장소의 `.agents/`, `skills-lock.json`은 변경하지 않았다.

### 다음 실행과 주의

검증용 node_modules 심볼릭 링크만 작업 종료 시 제거한다. 의존성 원본 디렉터리는 보존한다.
다음 실행에는 package.json/lockfile 일치를 다시 확인한 뒤 같은 경로를 링크하거나,
별도 새 작업 공간에서 잠긴 의존성을 설치해야 한다. 임시 경로가 사라졌다면 원본 실습
의존성을 임의로 고쳐 맞추지 않는다. 이 작업의 테스트·문서·구현 변경은 전용 작업 공간에
미커밋 상태로 남기며 커밋·push·merge·배포는 수행하지 않는다.

## 2026-09-15 후속: 실제 소스 대조 구성 요소 4개

### 목표와 변경 범위

가상 테스트 자료가 아니라 기존 공개 레시피와 공식 책자를 대조한 실제 구성 요소를
정량 계약에 공급한다. 변경은 `reviewedRecipeCatalog.js`, `reviewedRecipeSources.json`,
`__tests__/reviewedRecipeCatalog.test.js` 및 진행 문서다. 기존 `publicRecipes.json`,
16개 편집 조합, 추천 구현/테스트, UI, 재고, DB, 의존성은 변경하지 않았다.

기준 HEAD는 계속 `986051a6693a20e305adaff355530c5a2779774c`다. 9월 15일 확인한
원격 main `129b63772558e4209192053a3838b3f6701eb363`과는 문서 7개만 차이가 있었으며
코드·의존성 차이는 없었다. 미커밋 작업 위로 자동 병합하지 않았다. 향후 PR 전에 문서
기준 차이를 조정해야 한다. 원본 실습 보관 루트는 이번 작업 대상이 아니다.

### 근거와 수량 상태

[식약처 공식 책자](https://www.foodsafetykorea.go.kr/upload/20170417/20170417053825_1492418305214.pdf)
『우리 몸이 원하는 삼삼한 밥상』의 해당 네 펼침면을 내려받아 렌더링하고, 재료표·조리
단계·명시적 1인분 표기를 직접 대조했다. 이는 직접 조리나 전문가 검수가 아니다.
PDF URL의 날짜를 책자의 발행일로 단정하지 않는다.

| 원본 ID / 구성 요소 | PDF 페이지 / 책자 쪽 | 확인된 g 행 / 미정량 식재료 행 | 미확인 또는 주의 사항 |
| --- | --- | --- | --- |
| 28 새우 두부 계란찜 | 43 / 84–85 | 7 / 0 | 데치는 물은 별도 processInputs에 양 미확인으로 보존 |
| 29 부추 콩가루 찜 | 44 / 86–87 | 8 / 1 | 참깨 약간 유지, API의 3단계는 책자 5단계를 묶은 표현 |
| 32 순두부 사과 소스 오이무침 | 47 / 92–93 | 4 / 1 | 재료표에 없는 세척 소금도 조리 단계에서 발견해 유지 |
| 91 버섯구이와 두부타르타르 소스 | 109 / 216–217 | 11 / 1 | 올리브유 10g·2g 두 행/용도 유지, 흰 후추 약간은 미확인 |

합계 식재료 33행 중 30행은 원문에 g이 있고 3행은 미정량이다. 처리용 물 1행은 별도다.
네 구성 요소 모두 반찬이며 **정량 완성 한 끼 4개로 세지 않는다**. 기존 편집 조합 16개,
정량 검수 완료 한 끼 0개라는 구분은 유지한다. 20–30개 목표에 맞춰 밥의 양·조리 수율·
양념량을 만들어 넣지 않는다.

`75g(3/4모)`는 원문이 제공한 75g만 사용한다. 모·봉의 크기를 추정하지 않는다.
`food:` 키는 이 네 소스에서 비교한 좁은 품목 이름이며 범용 식품 코드가 아니다.
연두부/순두부, 다진 재료/통재료를 추천 별칭으로 합치지 않는다. 조리 상태는 해당 원문
투입 행의 생재료/판매 상태 구분이고, 가식부 보정·배수·가열 후 수율을 검증한 뜻이 아니다.

[공식 API 설명](https://www.foodsafetykorea.go.kr/api/openApiInfo.do?menu_grp=MENU_GRP31&menu_no=661&show_cnt=10&start_idx=1&svc_no=COOKRCP01)의
`INFO_WGT` 설명만으로 모든 레시피의 재료량을 1인분이라고 간주하지 않았다.
서빙 근거는 각 책자 페이지에 따로 기록한다. 실제 API를 인증키로 다시 조회한 것이 아니라
저장소의 원문 스냅샷과 책자를 대조한 것이다.

[공공데이터포털의 이 DB 안내](https://www.data.go.kr/data/15060073/openapi.do)는
이용허락범위 제한 없음으로 표시돼 있다. 이를 책자 사진·편집물 전체의 재게시 권한으로
확대하지 않으며 이번 변경에 PDF나 이미지를 포함하지 않았다.

### 소스 변경 차단과 해시

- 원문 ID·이름·재료표·출처·URL·순서가 있는 조리 단계 스냅샷을 고정한다.
- 입력에서 원문이 없거나 ID가 중복되거나 위 내용이 바뀌면 해당 구성 요소를 반환하지
  않고 `blocked`에 사유를 남긴다. 누락된 배열 원소도 단계 수가 같다고 통과시키지 않는다.
- `recipeVersion`은 기록된 원문 스냅샷 JSON의 SHA-256이다. 별도 `reviewVersion`은
  수량 대조 자료의 버전이다. 원문 또는 대조 자료 수정 시 재검토하고 해당 버전을 갱신한다.
- 원문 비교는 앱에 들어온 자료만 비교하며 원격 변경을 실시간 감시하지 않는다.
  메타데이터가 있다고 사실성이 자동 인증되는 것도 아니다. 원문 위치·전체 수량·해시는
  별도의 테스트와 소스 대조 검토로 확인했다.
- 반환 객체는 호출마다 복제해 한 화면의 변경이 원문이나 다음 호출에 퍼지지 않게 한다.
- `quantityStatus`는 식재료 행의 수량 상태다. 알려진 식재료만 계산 가능한 ID28도
  조리수·전체 과정의 수량, 재고 충분, 식품 안전, 영양 충분이 검증됐다는 뜻은 아니다.
  이후 UI는 `processInputs`까지 확인해야 하며 계산 status를 조리 가능 배지로 사용하면 안 된다.

PDF SHA-256: `a0c70b598bbc86fc097eee604552e52838c4dea831fd8536af45d0d2f8396614`.
원문별 해시는 데이터 파일의 `sourceSha256`에 있고 테스트에서 실제 스냅샷 해시와 비교한다.
로컬 PDF 및 검증 로그: `/private/tmp/fridgemate-prd-v2-continuation-RKZKIINA`.
이 임시 폴더는 배포 자료나 영구 백업이 아니며 없어지면 공식 출처와 해시로 재확인해야 한다.

### 이번 후속의 실행 결과

| 단계 | 결과 |
| --- | --- |
| 재착수 기준선 | 이 작업 공간 147파일, 1,018/1,018 통과 |
| 신규 소스 카탈로그 RED | 13/13 assertion 실패, import 오류 아님 |
| 정량 계약 + 첫 카탈로그 GREEN | 70/70 통과 |
| 비어 있는 조리 단계 배열 반례 | 13 통과 / 1 assertion 실패 후 보완 |
| 전사 오류 검출 확인 | 이 작업의 새 자료에 생크림 13→130 오타를 잠시 주입: 18 통과 / 1 예상 실패. 즉시 13으로 복구 |
| 최종 전체 | 148파일, 1,037/1,037 통과. 새 카탈로그 19/19, skip/todo 0 |
| 린트 | 통과 |
| 빌드 | 로컬 서버 허용 재실행 통과, 공개 경로 113개·sitemap·noindex 검증 통과 |

전체 JSON 결과의 실제 파일 목록은 모두 현재 작업 공간 아래이며 `.worktrees/`는 없다.
Prisma 실패는 발생하지 않았다. 브라우저 E2E는 이번 데이터 전용 후속에서 재실행하지
않았으며, 위 9월 13일 30개 결과를 오늘의 결과로 세지 않는다. 운영 배포·계정·실제 DB도
검증하지 않았다.

처음 PATH 지정 없이 시도한 `catalog-green.json`은 실행 파일/테스트가 0개이고
`success: false`, 종료 코드 1이었다. 그 기록만으로 원인을 단정하지 않으며 기능의
RED나 통과로 세지 않는다. 명시적 Node 24 실행에서는 70개가 실제 실행되고 통과했다.
제한 환경 빌드는 코드 0이지만 포트 EPERM 경고가 있어 로컬 서버 허용 후 재검증했다.

작업 폴더와 의존성 재사용 방법은 앞 절과 같다. 이번 주요 명령은 다음과 같다.
각 명령 앞에 Node 24 런타임 bin 경로를 PATH로 지정했다.

```sh
npm run test:run -- --exclude '.worktrees/**' --reporter=json --outputFile=/private/tmp/fridgemate-prd-v2-continuation-RKZKIINA/baseline-tests.json
npm run test:run -- src/features/mealPlans/__tests__/reviewedRecipeCatalog.test.js --exclude '.worktrees/**' --reporter=json --outputFile=/private/tmp/fridgemate-prd-v2-continuation-RKZKIINA/catalog-red.json
npm run test:run -- --exclude '.worktrees/**' --reporter=json --outputFile=/private/tmp/fridgemate-prd-v2-continuation-RKZKIINA/final-audited-tests.json
npm run lint
npm run build
git diff --check
```

적용 스킬: TDD는 실패 확인 후 구현 및 배열 누락 반례를 보완하는 데 사용했다.
데이터 품질 점검은 원문량·인분·누락·출처를 서로 구분하게 했고, PDF 스킬은 책자의
관련 페이지를 직접 확인하는 데 사용했다. UI나 React 컴포넌트 변경은 없다.
