# PRD v2: 실제 구매량 입고

기록일: 2026-09-16. B3 중 FR-05의 실제 구매량 확인·입고·중복 방지 단위다.
조리 기록·실제 소비·반대 이벤트 취소는 아직 없으며 B3나 PRD 전체 완료가 아니다.
이전 [구매 메모 기록](PRD_V2_SHOPPING_NOTES.md), [메뉴 확충](PRD_V2_DINNER_EXPANSION.md),
전체 [진행 상태](PRD_V2_PROGRESS.md)를 함께 본다.

## 범위와 기준선

- 작업 트리: `/private/tmp/fridgemate-prd-v2-b1-Lba78Azy`.
- 브랜치: `codex/prd-v2-quantity-contract`.
- HEAD: `986051a6693a20e305adaff355530c5a2779774c`. 앞선 PRD 작업의 미커밋 변경 위에서 진행했다.
- 제품 개발 재승인 범위에서 앱·테스트·문서만 수정했다. 원본 `/Users/lee/fridgemate`, 학습용
  실행기·보관 스냅샷은 수정하지 않았다. commit/push/merge/배포는 수행하지 않았다.
- 변경 전 단위 검사를 새로 실행해 164파일 **1,438/1,438** 통과, skip/todo 0을 확인했다.
  이전 단계의 브라우저 41개 결과는 이전 결과로만 인용한다.
- package.json/lockfile을 대조한 뒤 기존 의존성을 임시 연결했다. 새 패키지 설치나 `.env`
  복사, 실제 모델 API·운영 DB 호출은 하지 않았다. 검증은 Node 24.19.0을 명시했다.
  연결 대상은 `/private/tmp/fridgemate-weekly-pr-CtPuVjtR/node_modules`였으며 모든 검사 종료 뒤
  이번 작업 트리의 임시 링크만 제거했다. 원래 의존성 디렉터리는 보존했다. 재실행하려면
  두 package 파일이 여전히 일치하는지 확인하고 같은 의존성을 다시 연결해야 한다.

## 이번 변경 파일

| 구분 | 파일과 역할 |
| --- | --- |
| 저장 | `src/db/indexedDB.js`: DB v6, 입고용 원자적 트랜잭션, 여섯 저장소 계정 정리 |
| 입고 계약 | `src/features/shopping/shoppingRepository.js`: 입력 검증, 구매 메모별 입고, 멱등 처리, 이력 조회 |
| 수량 검증 | `src/features/mealPlans/inventoryQuantityDomain.js`: 기존 검증 함수를 재사용 가능하게 export. 단위·정밀도 정책 불변 |
| 화면 | 새 `src/components/PurchaseReceiptForm.jsx`, `ShoppingNotesPanel.jsx`, `src/pages/IngredientsPage.jsx`, `MealPlanPage.jsx` |
| 새 검사 | `src/features/shopping/__tests__/inventoryReceipt.test.js`, `src/components/__tests__/ShoppingNotesPanel.receiving.test.jsx`, `e2e/purchase-receiving.spec.js` |
| 기존 검사 | DB·계정 정리·식단 저장 테스트, 장보기 저장/화면 fixtures. `playwright.config.js`에 입고 흐름 등록 |
| 문서 | 이 기록, README, CHANGELOG, 진행 기록, 이전 장보기 기록의 후속 안내 |

인증 구현은 앞선 단계의 원자적 계정 정리 연결을 그대로 사용한다. 이번 단위에서 인증 구현,
서버·Prisma·추천 계산·전역 별칭·카탈로그·점수 가중치·의존성을 새로 변경하지 않았다.

## 사용자에게 보이는 동작

1. 장보기 체크·구매 메모는 여전히 재고를 바꾸지 않는다. 구매 메모 이력에서 **입고할 양 확인**을
   열고 별도로 제출해야 실제 입고한다. 기존 구매 메모를 자동 입고로 소급 처리하지 않는다.
2. 필요한 양이나 포장 메모에서 정량을 추정하지 않는다. 구매량 숫자는 빈칸에서 시작한다.
   실제 품목·포장 메모·양·단위·조리 상태·보관 장소를 확인한다. 구매일·기한은 빈칸을 허용한다.
3. 200g 필요·500g 구매라면 500g을 새 재고 배치로 만든다. 같은 이름의 기존 재고를 임의로
   합치지 않는다. `수량 모름`은 원문 포장 메모를 보존하고 정량 필드를 null로 저장한다.
4. 입고 저장 후 재고 목록을 다시 읽고 이미 펼친 식단 계산은 폐기한다. 장보기 메모 안의 부족분도
   다시 계산한다. 기존 식단 메뉴를 자동으로 바꾸지 않는다.
5. 이력에는 `입고 당시 500g`과 현재 남은 양을 냉장고에서 확인하라는 설명을 구분해 표시한다.
   이후 원본 재고를 수정·삭제해도 입고 재시도로 그 재고를 복구하거나 다시 늘리지 않는다.
6. 메뉴를 건너뛰고 확정본을 교체해도 수동 장보기·구매 당시 출처/필요량·입고 이력·물리 재고를 보존한다.

구매 메모의 기존 `inventoryApplied: false`는 원본 메모 자체가 재고를 변경하지 않았다는
과거 계약이다. 값을 재작성하지 않고 별도 입고 이벤트의 연결로 현재 화면 상태를 판단한다.
저장 후 화면 갱신만 실패한 경우에는 “입고는 저장됐지만 목록을 갱신하지 못했다”고 구분한다.

디자인 스킬에 따라 기존 글꼴·흰 바탕·녹색 강조를 유지하고 모바일 입력은 펼침 영역에 세로로
배치했다. React 지침에 따라 입고는 명시적 제출 핸들러에서만 실행하며 렌더/effect에서 실행하지 않는다.
390px 모바일에서 가로 넘침 여부와 실제 입력·이력 스크린샷을 확인했다.

## 저장·동시 요청·개인 범위

IndexedDB v6에 `inventoryEvents`를 추가했다. keyPath는 `id`, `purchaseNoteId` index는 unique다.
이전 v5의 다섯 저장소와 원본 값은 보존하고 새 이력은 비어 있는 상태로 시작한다.
입고는 해당 scope의 `ingredients`, `inventoryQuantities`, `shoppingEntries`, `inventoryEvents`를
포함한 단일 readwrite 트랜잭션에서 구매 근거를 읽고 재고·수량 확인·입고 이벤트를 함께 저장한다.
개별 요청 성공이 아니라 트랜잭션 완료 이후에만 성공을 반환한다.

- `receipt:<operationId>`와 `receipt-<operationId>`로 이벤트·재고를 연결한다.
- 같은 요청 또는 다른 탭에서 새 ID로 제출한 **같은 구매 메모·같은 입력**은 최초 이벤트를 반환한다.
  내용을 바꾸면 충돌로 거절한다. 동일 operationId를 다른 구매 메모에 재사용할 수도 없다.
- 다른 탭의 요청 ID를 별도 별칭 이벤트로 추가하지 않는다. 최초 이벤트 ID가 기준이다.
- 중복 방지는 구매 메모 단위다. 같은 실물 구매를 사용자가 별도 구매 메모로 두 번 기록한 경우까지
  이름만으로 알아내거나 병합하지 않는다.
- 숫자·단위·정밀도·상태·범위·날짜·입력 길이를 검증하며 입력은 첫 await 전에 복사한다.
  손상된 입고 이력을 미입고로 간주하지 않고 조회와 재시도를 거절한다.
- 기존 재고 ID와 충돌하면 덮어쓰지 않는다. 세 쓰기 각각의 요청 성공 직후 트랜잭션을 강제로
  중단해 재고·수량 확인·이력이 전부 롤백되는지 검사했다.
- guest/계정별 DB 경계를 유지한다. 계정 삭제·공유기기 정리의 원자적 초기화 대상은 이제
  여섯 저장소이며, 손상된 이벤트와 DB 삭제가 다른 탭에 막힌 경우도 검증한다.

입고로 생긴 원본 재고는 기존 수동 동기화의 `pendingCreate` 상태다. 입고 이력·정량 확인값은
로컬 전용이며 서버 동기화·게스트 가져오기·JSON 백업에 포함하지 않는다. 기기 간 같은 실물 구매의
중복 제거를 보장하지 않으며, 브라우저 자료 삭제 시 이력은 사라질 수 있다.

## 테스트 우선 실행과 중간 실패

증거 폴더: `/private/tmp/fridgemate-prd-v2-receiving-3cS3KYuY`.
임시 산출물이므로 장기 보관·운영 모니터링을 의미하지 않는다.

| 결과 파일/검사 | 실제 결과와 처리 |
| --- | --- |
| `baseline.json` | 164파일 1,438개 모두 통과 |
| `receipt-red.json` | 구현 전 입고 22개 실패. 핵심 검사는 재고 1개 기대/0개 실제 assertion으로 입고 부재 재현 |
| `upgrade-red.json` | 새 이력 저장소 부재 재현. 기존 다섯 저장소 보존 기대는 유지 |
| `receipt-first-green.json` | 70개 중 67통과/3실패. 입고 22개 통과, 남은 세 건은 DB v5를 기대한 기존 업그레이드 검사 |
| `ui-red.json` | 입고 화면 부재 4건 재현 |
| `receiving-green.json` | 당시 입고·화면·DB 74개 모두 통과. 이후 손상/충돌/정리·조회 방어 검사 추가 |
| `history-red.json` | 입고 이력 배열이 없는 응답을 거절하지 않는 문제 1건 재현 후 방어 추가 |
| `browser-red` → `browser-target` | 실제 입고 후 이전 360g 부족량이 열린 화면에 남는 assertion 실패 → 재고 재조회/계산 무효화 후 1/1 통과 |
| `full-tests.json` | 1,471개 중 1,417통과/54실패. 모두 식단 저장 테스트가 현재 DB를 v5로 열어 발생한 VersionError |
| `repository-version-green-node24.json` | 현재 저장소 조회 helper는 버전 지정을 제거. 과거 v1/v2 준비는 유지하고 최종 v6·여섯 저장소·자료 보존 검사를 통과 |
| `full-final.json` | **166파일 1,471/1,471 통과**, skip/todo 0, 작업 트리 밖/다른 `.worktrees` 실행 파일 0 |

v5 고정 수정 전후에 관련 없는 식단 기대값·assertion을 삭제하거나 skip하지 않았다.
한 번 Node 경로를 누락한 명령은 시스템 Node 20.19.2에서 0개 실행·종료 코드 1
(`repository-version-green.json`)이었다. 검증 성공이나 제품 버그 재현으로 세지 않고
동일 범위를 명시적 Node 24로 실행했다.

전체 브라우저 최초 실행 `browser-final.json`은 40통과/2시간초과다. 실패한 두 기존 수량 확인
테스트의 trace에서 같은 시간대의 select/click 응답에 각각 약 85초/87초 공백이 보였다.
원인은 확정하지 않았다. 실제 입고 흐름은 통과했으며, 이 실패를 삭제하거나 제한 시간을 늘리지
않고 코드 변경 없는 전체 재검사를 별도 결과에 기록한다.

## 최종 검증

| 검사 | 결과 |
| --- | --- |
| 전체 단위·통합 | 166파일 1,471개 통과, 실패/skip/todo 0 |
| 전체 브라우저 독립 재검사 | `browser-recheck.json`: 9파일 42개 통과, 41.4초, 실패/skip/flaky/개별 retry 0 |
| 린트 | `npm run lint` 종료 코드 0 |
| 빌드 | `npm run build` 종료 코드 0, 528모듈, 공개 정적 경로 113개·사이트맵·개인 화면 noindex 검사 통과 |

브라우저 재검사는 동일 2 workers·기존 30초 제한·동일 코드로 실행했다. 최초 실패한 두 검사는
각각 3.5초/1.9초로 통과했으나, 최초 지연의 원인을 해결했다고 단정하지 않는다. 전체 단위
결과의 실제 파일 경로와 브라우저 rootDir를 확인해 이 작업 트리 밖의 테스트가 섞이지 않았음을
확인했다. Node 색상 환경 경고와 의도적으로 429를 반환하는 기존 OCR 테스트의 경고는 남는다.
운영 URL·실제 인증 서버·실사용 DB·광고 설정의 검증은 아니다.

## 실행 방법

해당 작업 트리에서 기존에 대조한 의존성을 사용할 때의 명령이다. 의존성 설치 명령이 아니다.

```sh
export PATH=/Users/lee/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH
npm run test:run -- --exclude '.worktrees/**' --reporter=json --outputFile=/private/tmp/fridgemate-prd-v2-receiving-3cS3KYuY/full-final.json
PLAYWRIGHT_JSON_OUTPUT_NAME=/private/tmp/fridgemate-prd-v2-receiving-3cS3KYuY/browser-recheck.json npm run test:e2e -- --workers=2 --output=/private/tmp/fridgemate-prd-v2-receiving-3cS3KYuY/browser-recheck --reporter=json,list
npm run lint
npm run build
git diff --check
```

다시 검증할 때는 결과 파일·폴더를 새 경로로 지정해 이전 실패 증거를 덮어쓰지 않는다.
UI 확인은 냉장고 또는 주간 식단 → 장보기 메모 → 구매 메모 저장 → 입고할 양 확인 순서다.

## 남은 범위

- AT-09 실제 포장량과 입고 부분의 AT-11/12를 검증했다. AT-10은 메뉴 건너뛰기·확정본 교체
  이후 재고/기록 보존을 확인했으며, 아직 없는 전체 식단 삭제 기능까지 검증했다고 주장하지 않는다.
- AT-07/08/14의 조리·실제 사용량 차감·미확인 사용량 전파·반대 이벤트 취소는 다음 B3 단위다.
  이번 이벤트 조회는 receipt만 받으므로 후속 소비 이벤트 도입 때 계약을 명시적으로 확장해야 한다.
- 입고 이력 수정/취소는 제공하지 않는다. 현재 재고의 편집·삭제·수량 재확인은 기존 화면에서
  가능하지만 과거 입고 이력을 덮어쓰는 기능과 구분한다.
- 가입 계정의 실제 서버를 통한 새 입고 동기화, 기기 간 수량/이력 복구, Safari/Firefox,
  실사용 음식 조리, 저사양 성능·대용량 저장은 이번 브라우저 검증 범위 밖이다.
- 카탈로그 20–30개 검토 목표, B4 날짜 이동/미리보기, B5 동의 계측·실제 파일럿, B6–B9의
  가격·공유·테마·운영 조건은 [진행 상태](PRD_V2_PROGRESS.md)에 남긴다. 통과한 작은 단위를
  PRD 전체 완료나 출시 승인으로 대체하지 않는다.
