# PRD v2 수량 확인: 저장·화면·식단 연결

기록일: 2026-09-15. 전체 목표는 원본 PRD v2이며 이 단위를 완료로 대체하지 않는다.
이 문서의 수치는 당시 수량 확인 단계 기록이다. 2026-09-16 한그릇 메뉴 연결과 최신
전체 검증은 [후속 작업 기록](PRD_V2_REVIEWED_DINNERS.md)을 따른다.
작업 공간은 `/private/tmp/fridgemate-prd-v2-b1-Lba78Azy`, 브랜치는
`codex/prd-v2-quantity-contract`, HEAD는 `986051a6693a20e305adaff355530c5a2779774c`다.
현재 변경은 미커밋이며 원본 루트의 동시 작업과 섞거나 배포하지 않았다.

## 현재 적용 범위

- `inventoryQuantityDomain.js`: 원문과 분리한 확인값, 원본 비교값, revision, 계정 범위,
  확인 취소와 배분용 변환. 0으로 반올림되는 작은 양수·배열 단위를 거부하며 60개 통과.
- `indexedDB.js`: v4 `inventoryQuantities` 저장소, 기존 데이터 보존, 원문 변경과 확인
  무효화의 원자적 처리. 삭제·재등록 후에도 이전 요청을 거부하는 revision 표식을 유지한다.
- `inventoryQuantityRepository.js`: 원본 비교값과 revision을 같은 transaction에서 비교한
  확인·취소, 실패 시 보존, 문자열 계정 범위 검사. 신규 21개 통과.
- `mealPlanRepository.js`: 원본 재고·확인값·모든 주 식단을 한 transaction에서 읽어
  `inventory`로 투영한다. 원본에 임의로 적힌 정량 필드는 믿지 않는다. 86개 통과.
- `InventoryQuantityReview.jsx`와 `IngredientsPage.jsx`: 명시적 수량 확인·취소·재조회.
  계정·원본 변경과 창 복귀 시 이전 화면을 폐기하고 중복 저장·늦은 응답을 막는다.
- `MealPlanShoppingPreview.jsx`: 실제 저장 API의 확인값을 배분 계산에 사용한다.
  화면·미리보기·기존 식단 화면 39개 통과. 원문 `반 모`에서 양을 추정하지 않는다.
- `authSessionService.js`: 계정 삭제·공유기기 정리에서 네 저장소를 원자적으로 비운다.
  손상된 확인값과 다른 탭의 DB 삭제 차단을 포함한 인증 18개, 관련 회귀 36개 통과.

수량 확인은 구매·입고·소비가 아니다. 자유문자 `반 모`나 팬트리 보유 체크에서 g을
추정하지 않으며 원문 재고를 차감하지 않는다. 수량 확인 취소와 원문 변경의 표식은
이유를 구분하지 못하므로 사용자에게 무효화 이유를 추측해서 안내하면 안 된다.

## 검증 기록

최신 로그: `/private/tmp/fridgemate-prd-v2-quantity-complete-Ztt0TfsF`.

- 전체 단위·통합 검사: 153파일, **1,307/1,307 통과**, skip/todo 0.
- 현재 작업 공간 밖의 테스트 파일 0개. 실제 실행 목록은 `tests.json`에 있다.
- 최종 린트 종료 코드 0(`lint-final.log`). 빌드는 허용된 로컬 실행에서 경고 없이
  종료 코드 0, 공개 경로 113개·사이트맵·개인 화면 noindex 검증 통과(`build-approved.log`).
  최초 `build.log`의 개발 WebSocket EPERM 경고는 환경 차이로 별도 보존했다.
- 전체 브라우저 **37/37 통과**, skip/retry/flaky 0, 27.4초(`e2e-verified.json`).
  현재 작업 공간의 E2E 8파일만 실행했고 다른 작업 트리 결과는 섞이지 않았다.
  모바일 390px 수량 저장·새로고침·취소·소비 재료 제외·원문 보존과 원문 편집 후
  확인 해제를 검증했다. 가로 넘침 검사와 실제 화면 캡처도 확인했다.
- 중간 브라우저 실행 `e2e-final.json`, `e2e-green.json`은 각각 36통과/1실패다.
  파일명과 달리 `e2e-green.json`도 최종 성공 결과가 아니다. 새 테스트의 넓은 `수량`
  선택자와 필수 표시 `*`를 빠뜨린 정확 일치 선택자가 원인이었다. 실제 화면의
  `textbox` / `수량 *`를 지정한 후 같은 동작·기대값으로 전체 검사를 통과했다.
- 최초 브라우저 실행은 localhost 권한 EPERM으로 0개 실행됐다. 앱 실패로 세지 않는다.
- 이전 1,281개 중 40개 실패는 `stock-resume-8ucJFahL`의 미완성 단계 기록이며 현재
  결과가 아니다. 초기 화면 준비 오류는 정책 회귀 재현 성공으로 세지 않았다.

TDD 기록은 API 20개, 인증 7개, 식단 스냅샷 17개, UI 13개 및 연결 4개의 예상 실패를
확인한 뒤 각각 통과시켰다. 추가 경계 검사는 domain 57통과/3실패 → 60통과,
scope 20통과/1실패 → 21통과다. 테스트 삭제·skip으로 통과시키지 않았다.
Prisma·인증·DB의 예상 밖 실패는 최종 전체 검사에 없었다. 브라우저 로그에는 고의로
원격 OCR 교정 저장을 거절하는 기존 가짜 API 시나리오의 경고가 남으며 테스트 실패가 아니다.
운영 계정·운영 DB·실제 기기 간 동기화·사용자 파일럿을 검증한 결과는 아니다.

## 이번 수량 확인 단위의 파일

- 신규: `src/features/mealPlans/inventoryQuantityDomain.js`, `inventoryQuantityRepository.js`,
  해당 `__tests__` 2파일, `src/components/InventoryQuantityReview.jsx`와 해당 테스트.
- 연결·회귀: `src/db/indexedDB.js`와 테스트, `src/features/mealPlans/mealPlanRepository.js`와
  테스트, `src/features/auth/authSessionService.js`와 테스트, `src/pages/IngredientsPage.jsx`,
  `src/components/MealPlanShoppingPreview.jsx`와 테스트, `e2e/meal-plan.spec.js`.
- 문서: 이 문서, README, CHANGELOG, PRD_V2_PROGRESS, PRD_V2_ALLOCATION_PREVIEW의
  역사 기록 안내. 전용 브랜치에 이미 있던 초안/확정·배분 변경도 미커밋으로 보존한다.

## 재실행

실행 명령은 전용 작업 공간 기준이다.

```sh
npm run test:run -- --exclude '.worktrees/**' --reporter=json --outputFile=/private/tmp/fridgemate-prd-v2-quantity-complete-Ztt0TfsF/tests.json
npm run lint -- --ignore-pattern '.worktrees/**'
npm run build
npm run test:e2e -- e2e/meal-plan.spec.js --project=local-only --grep 'inventory quantity review' --workers=1 --reporter=json
npm run test:e2e -- --workers=2 --output=/private/tmp/fridgemate-prd-v2-quantity-complete-Ztt0TfsF/e2e-verified --reporter=json
git diff --check
```

Node는 `/Users/lee/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin`의
24.19.0을 PATH 앞에 두었다. package/lockfile 일치를 확인한
`/private/tmp/fridgemate-weekly-pr-CtPuVjtR/node_modules`를 임시 연결해 검사했다.
검사 종료 시 링크만 제거하고 의존성 원본은 보존한다. 재실행 전 두 manifest의 일치와
의존성 연결을 다시 확인한다.
새 의존성 설치, 원본 `.env` 복사, 모델 API 호출, commit/push/merge/배포는 하지 않았다.
화면 확인은 개발 서버의 `/ingredients`에서 **수량 확인 목록 열기** → 남은 양·단위·
조리 상태 입력 → 저장 → 새로고침 → 취소 순서다. 원본 수량과 재구매 메모는 유지되어야 한다.

## 승인과 남은 범위

과거 학습용 실행기 범위를 적용하던 검토 혼선은 사용자의 명시적
“승인: PRD v2 제품 개발 계속” 답변으로 해소됐다. 전용 작업트리에서 구현·테스트·문서를
정상 변경 경로로 수정했으며, 원본 저장소·커밋·푸시·배포는 제외한다.
자동 검토의 용량 오류로 미적용된 변경은 적용됐다고 보고하거나 다른 쓰기 경로로 우회하지 않는다.

수량 확인 저장·화면 연결은 제품 전체 완료가 아니다. 확인값은 현재 기기에만 보관하며
서버 동기화·게스트 가져오기·백업에 포함되지 않는다. 계란/달걀을 자동 병합하지 않고
g/kg·ml/l·개 및 명시적 조리 상태만 지원한다. 식품 안전·실제 조리 검수를 보장하지 않는다.
React 가이드에 따라 조회·저장은 사용자 동작에서 시작하고 scope/reset key로 세션을
분리했다. 디자인 스킬은 기존 녹색 계열과 모바일 세로 입력 구조를 유지하는 데 적용했다.
검수된 완성 한 끼 카탈로그, 수동 장보기·구매 이력, B3 이후 실제 입고·소비·이동·파일럿·
예산·공유·운영 조건은 여전히 남는다. [전체 진행 기록](PRD_V2_PROGRESS.md)의 이전 통과
수치는 각 단계의 역사적 결과이며 현재 수량 확인 구현 완료를 의미하지 않는다.
