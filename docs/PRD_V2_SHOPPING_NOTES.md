# PRD v2: 출처별 장보기와 구매 메모

기록일: 2026-09-16. B2의 독립 수동 장보기·구매 메모 저장 및 화면 연결 단위다.
체크·구매 메모를 실제 입고로 처리하지 않으며 B3나 PRD 전체 완료를 뜻하지 않는다.
이전 단계는 [전체 배분·미리보기](PRD_V2_ALLOCATION_PREVIEW.md),
[수량 확인](PRD_V2_INVENTORY_QUANTITY.md), [한그릇 메뉴 연결](PRD_V2_REVIEWED_DINNERS.md)을 참고한다.
전체 남은 범위는 [진행 기록](PRD_V2_PROGRESS.md)에 유지한다.

후속: [실제 구매량 입고](PRD_V2_PURCHASE_RECEIVING.md)를 별도 제출 흐름으로 추가했다.
아래 DB v5·입고 미구현 설명은 이 메모 단위 완료 당시의 기록이다. 현재는 DB v6이며
체크·구매 메모 자체가 재고를 바꾸지 않는 원칙은 그대로다. 소비·취소는 여전히 미구현이다.

최초 화면 연결 결과는 단위·통합 **163파일 1,399/1,399**, 브라우저 **8파일 39/39**, 린트·빌드·
공개 정적 경로 **113개** 검사 통과다. 이후 긴 계획 출처 보강은 아래 후속 검증에 구분했다.
최초 연결 중 발생한 브라우저 실패 4건도 아래에 별도로 남겼다.
긴 출처 참조 보강 후 최신 검증은 **1,410개 단위·통합, 39개 브라우저, 린트·빌드·공개 113경로** 통과다.
브랜치 `codex/prd-v2-quantity-contract`, 기준 HEAD `986051a6693a20e305adaff355530c5a2779774c`이며
이전 PRD 단계와 이번 변경은 모두 미커밋이다.

## 이번 단위의 변경 파일

- 신규 저장 API: `src/features/shopping/shoppingRepository.js`.
- 신규 화면: `src/components/ShoppingNotesPanel.jsx`.
- 신규 검사: `src/features/shopping/__tests__/shoppingRepository.test.js`,
  `shoppingSourceBoundaries.test.js`, `src/components/__tests__/ShoppingNotesPanel.test.jsx`,
  `ShoppingNotesPanel.pages.test.jsx`, `ShoppingNotesPanel.persistence.test.jsx`.
- 기존 수정: `src/db/indexedDB.js`와 해당 검사, `authSessionService.test.js`,
  `mealPlanRepository.test.js`, `mealPlanAllocation.js`, `IngredientsPage.jsx`, `MealPlanPage.jsx`,
  `e2e/meal-plan.spec.js`.
- 문서: 이 기록, `README.md`, `CHANGELOG.md`, `docs/PRD_V2_PROGRESS.md`.

이 목록은 현재 작업 트리 전체 변경 목록이 아니라 이번 장보기 단위다. 수량 확인·카탈로그 등
앞선 변경은 앞선 기록에 남아 있다. `package.json`, lockfile, 추천 구현·추천 실습 테스트는
이번 작업에서 수정하지 않았다.

## 이번에 연결한 동작

재료 관리와 주간 식단의 **장보기 메모**에서 직접 항목을 적고 수정·체크·제거할 수 있다.
식단·직접 입력·재구매 출처를 따로 선택해 **실제로 산 양**과 메모를 기록한다. 같은 이름이어도
다른 장보기 의도일 수 있으므로 자동 합치지 않는다. 메뉴 변경은 식단 파생행만 다시 계산하며,
이미 저장한 수동 항목·체크·구매 메모를 지우지 않는다.

필요량을 실제 구매량 칸에 자동 복사하지 않는다. `200ml` 필요에 `1L 한 통`을 샀다면
두 문자열을 별도로 보존한다. 구매 메모는 원래 수동 항목을 제거하거나 식단을 바꾼 뒤에도
기록 당시 품목·출처·필요량·실제 구매량을 유지한다.

기존 소비 완료 재료의 `ShoppingListPanel`은 그대로 두었다. 그 화면의 재구매 수량·메모
편집은 기존 원본 재고 편집 경로이고, **새 장보기 메모 저장은 그 경로를 호출하지 않는다.**
새 기능의 체크·메모 저장은 재고량 확인, 소비 상태, 원본 수량, 입고량을 바꾸지 않는다.

## 저장소와 원자성

IndexedDB v5에 `shoppingEntries` 저장소(`keyPath: id`)를 추가했다. 실제 v4 업그레이드
fixture로 기존 `ingredients`, `menuDecisions`, `mealPlans`, `inventoryQuantities` 자료가
그대로 남고 새 저장소가 비어 있는지 확인했다. DB 버전 5와 장보기 레코드 `schemaVersion: 1`은
서로 다른 버전이다.

- `runShoppingTransaction(mode, handler, scopeOrOptions)`는 기존 저장소 transaction 도우미를
  이용한다. 요청 하나가 성공했더라도 transaction이 abort되면 성공을 반환하지 않는다.
- `clearAccountLocalData(scope)`는 다섯 저장소를 같은 readwrite transaction에서 비운다.
  손상된 장보기 레코드도 먼저 검증하느라 삭제를 막지 않는다. 실패하면 다섯 저장소 모두
  이전 상태를 보존하며, 다른 계정·게스트 범위는 삭제하지 않는다.
- `getShoppingWorkspace(scope, today)`는 장보기 메모 읽기와 기존 식단 스냅샷 읽기를
  병렬로 수행한다. **이 두 읽기 전체가 하나의 transaction인 것은 아니다.** 재고 배분에
  필요한 원본 재고·수량 확인·식단의 세 저장소만 기존 단일 readonly transaction으로 읽는다.
  장보기 메모는 배분 입력이나 재고로 사용하지 않으므로 별도로 읽는다.
- 반환값은 `{ scope, manualItems, purchaseNotes, sources, checkedAt }`다. 레코드의 범위·버전·
  필수 값이 잘못되면 부분 결과로 숨기지 않고 조회를 거부하며, 읽기 과정에서 자료를 삭제하지 않는다.

## 항목별 계약

| 구분 | 식별·저장 정책 | 변경 경계 |
| --- | --- | --- |
| 직접 입력 | `manual:<고유 토큰>`; 이름·필요량 문자열·메모·체크, revision | 신규는 expectedRevision 0, 수정은 현재 revision과 정확히 일치해야 저장. 동시 수정 중 하나만 성공 |
| 수동 제거 | 같은 ID의 최소 `removed` 표식과 증가한 revision | 품목·메모 본문은 제거. 오래된 창의 수정과 같은 ID 재사용을 차단. 별도 구매 스냅샷은 보존 |
| 구매 메모 | `purchase:<operationId>`; 출처 스냅샷·actualQuantityText·메모, revision 1 | 수정 API 없음. 같은 operationId와 같은 정규화 입력은 기존 기록 반환, 다른 내용이면 충돌 |

세 출처는 다음과 같이 독립적인 ID와 표시 문맥을 가진다.

- 식단: 확인된 부족분 또는 양 확인 필요 행에서 생성한다. 새 `plan:v2:` ID는 행을 구분하는
  원재료·단위·조리 상태를 사용하고, 주차·revision·모든 관련 슬롯은 별도 `reference`에 보존한다.
  미확인 행은 슬롯·구성 요소·원문 행·확인 사유도 ID에 포함한다. 주차 수 때문에 ID가 늘어나지 않는다.
- 직접 입력: 수동 항목 ID와 revision으로 해당 버전을 구분한다.
- 재구매: 삭제되지 않은 소비 완료 원본 재료에서 생성하며 원본 ID·updatedAt·수량 문자열을
  출처에 포함한다. 후보를 보여주는 것만으로 소비 완료를 취소하거나 재입고하지 않는다.

구매 메모의 출처 스냅샷에는 `source`, `sourceId`, `name`, `quantityText`, `context`와
새 식단 출처의 `reference`를 저장한다. `inventoryApplied: false`를 강제하며 모든 새 장보기 쓰기는 `shoppingEntries`에만
발생한다. 동일 operationId 재시도는 중복을 막지만, 사용자가 새 operationId로 별도 기록을
만들면 새 구매 메모다. 서로 다른 구매 의도를 이름만으로 합치는 중복 제거는 하지 않는다.

## 화면과 실제 저장 검증

조회는 사용자가 메모 열기를 누를 때 시작한다. 계정·관련 자료 버전 변경 또는 창 복귀 시
이전 화면을 닫고 다시 읽도록 한다. 저장 중 중복 요청과 이전 계정의 늦은 응답을 차단한다.
실패한 저장은 성공 안내를 내지 않으며, 구매 메모의 같은 입력 재시도는 같은 operationId를
사용한다. 다른 화면의 수정은 실시간 구독하지 않는다.

수동 이름 80자·필요량 160자·메모 500자, 실제 구매량 160자 등 저장 계약과 입력 길이를
맞췄다. 수동 체크는 저장 버튼으로 확정한다. 화면을 닫거나 범위가 바뀌면 아직 저장하지 않은
입력은 유지되지 않는다는 안내가 있다.

가짜 저장 함수만으로 검사하지 않았다. fake-indexeddb와 실제 저장 API를 연결한 화면 검사로
체크·구매 스냅샷·수동 제거·다시 열기·계정 분리·오래된 수정 충돌을 확인했다. 실제 브라우저
검사도 로컬 테스트 자료로 식단 변경 후 메모 유지와 원본 재고 불변을 확인했다.
운영 계정이나 운영 DB를 읽거나 변경한 검증은 아니다.

TDD 스킬에 따라 새 저장·화면 계약과 모바일 표시 문제의 실패를 먼저 확인했다. React 스킬은
저장을 사용자 동작 처리 함수에 두고 계정·자료 변경 시 오래된 화면을 분리하는 데 적용했다.
디자인 스킬은 기존 녹색·글꼴을 유지하면서 출처·직접 입력·구매 이력을 구분하는 데 적용했다.
390px 모바일 스크린샷을 직접 검토해 전역 input 스타일 때문에 체크박스가 늘어나던 문제를
찾았고, 체크박스 20px와 클릭 영역 44px 이상을 브라우저 검사로 고정했다.

## 검증 기록

대상: `/private/tmp/fridgemate-prd-v2-b1-Lba78Azy`.
로그 디렉터리: `/private/tmp/fridgemate-prd-v2-shopping-2TP2VvDa`.
아래 수치는 각 JSON의 실제 결과이며 서로 더해 총 테스트 수를 만들지 않는다.

| 기록 | 결과와 의미 |
| --- | --- |
| `baseline.json` | 착수 기준선 158파일, 1,350/1,350 통과 |
| `agent-db-red.json` → `agent-db-green.json` | DB·계정 정리 56통과/9실패 → 65/65. 새 버전·저장 API·정리 범위 assertion 실패를 먼저 확인 |
| `repository-assertion-red.json` → `repository-green.json` | 저장 계약 20개 assertion 실패 → 20/20. 경계 추가 후 `repository-boundaries.json` 22/22 |
| `agent-ui-red.json`, `agent-ui-pages-red.json`, `agent-ui-input-limits-red.json` | 구현 전 화면 13개, 페이지 연결 3개, 입력 길이 1개가 각각 기대 assertion에서 실패 |
| `agent-ui-final-green.json` | 화면·페이지·실제 저장 연계 5파일, 47/47 통과 |
| `agent-source-red.json` → `agent-source-green.json` | 긴 표시 문맥과 출처 ID 충돌 3개 실패 → 관련 5파일, 90/90 통과 |
| `final-tests.json` | 전체 163파일, 1,399/1,399 통과 |
| `verified-tests.json` | 제어 문자 검증의 동등 표현 수정 후 전체 재실행: 163파일, 1,399/1,399 통과 |
| `browser-final.json` | 모바일 체크박스 크기 회귀 추가 전 전체 브라우저 39/39 통과, 약 45.3초 |
| `final-verified-tests.json` | 모바일 수정까지 포함한 최종 단위·통합 163파일, 1,399/1,399 통과 |
| `browser-verified.json` | 단위 검사와 동시 실행: 35통과/4실패, 약 196.6초. 신규 장보기·모바일 크기 검사는 통과 |
| `browser-isolated.json` | 코드·assertion·timeout 변경 없이 브라우저만 독립 재실행: 8파일, 39/39 통과, 약 64.2초. 재시도·skip·flaky 0 |
| 최종 `npm run lint`, `npm run build` | 종료 코드 0. 527모듈 빌드, 공개 113경로·사이트맵·noindex 셸 검사 통과 |

위 전체 단위·통합 실행은 skip/todo 0이며, 실제 대상 경로는 모두 이 작업 트리 안이다.
의존성 경로가 다른 임시 작업 공간을 가리키는 스택을 외부 테스트 파일 실행으로 세지 않는다.
최종 브라우저 rootDir도 이 작업 트리의 `e2e`이며 실제 파일은 `analytics-consent`, `local-only`,
`meal-plan`, `ocr-import`, `public-recipes`, `api-mode`, `meal-plan-account`, `sync-conflicts`의
8개 spec이다. `.worktrees/**`와 다른 작업 트리 결과는 포함하지 않았다.

### 기능 assertion 실패와 구분한 중간 문제

- 최초 `repository-red.json`에는 불완전한 임시 반환값을 바로 사용한 TypeError 및
  fixture의 DataError가 섞였다. 이를 모두 기능 RED로 세지 않고, 전제 assertion을 보완한
  `repository-assertion-red.json`에서 20개 예상 실패를 다시 확인했다.
- DB v5 전환 뒤 `agent-mealplan-version-red.json`은 기존 최신 DB helper가 v4를 지정해
  54개 VersionError가 난 결과다. 제품 정책 회귀로 세지 않는다. 최신 helper·버전·저장소
  기대값만 갱신하고 실제 과거 버전 fixture는 보존한 뒤 `agent-mealplan-version-green.json`
  86/86을 확인했다.
- `agent-ui-pages-green.json`의 1개 실패는 초기 로딩 후 교체된 버튼 대신 오래된 요소를
  기다린 테스트 문제였다. 현재 버튼을 다시 조회한 `agent-ui-pages-green2.json`은 44/44다.
- `agent-ui-persistence-red.json`은 이름과 달리 2/2 통과한 후속 통합 검사다. RED 근거가 아니다.
- 기존 제어 문자 정규식의 `no-control-regex` 린트 오류는 기능 assertion 실패가 아니다.
  같은 문자 차단을 유지하는 표현으로 바꾼 뒤 위 전체 단위 검사를 다시 통과했다.
- `browser-checkbox-red.json`은 테스트 서버 포트 사용 중으로 사례가 실행되지 않은 setup 실패다.
  이후 `browser-checkbox-assertion-red.json`에서 체크박스 너비 약 263.8px가 상한 24px를 넘는
  실제 화면 assertion 실패를 확인했다. 기존 브라우저 사례에 크기·터치 영역 assertion을
  추가한 것이며 사례 수를 늘린 것은 아니다. 체크박스를 20px로 고정한 후 이 사례는
  `browser-verified.json`과 최종 `browser-isolated.json`에서 모두 통과했다. 최종 모바일
  스크린샷도 확인해 체크 문구가 한 줄로 표시되고 가로 넘침이 없는 것을 확인했다.
- `browser-verified.json`의 기존 인증·동기화 사례 4건은 장보기 기능의 예상 RED가 아니다.
  계정 화면 heading 대기 실패 1건, 동기화 시간 초과 3건이며 브라우저 context 종료와 trace
  파일 오류도 동반됐다. 단위 검사와 동시 실행 중 발생했으나 자원 경합이 원인이라고 확정하지
  않았다. 코드나 테스트를 고치거나 제한 시간을 늘리지 않고 독립 실행한
  `browser-isolated.json`에서 39개 전부 통과했다. 간헐적 실패 원인 추적은 남아 있다.
- 브라우저 출력의 NO_COLOR/FORCE_COLOR 경고와 기존 OCR 비용 제한 429 fixture의 경고는
  최종 실행에도 있었다. 이를 제품 실패나 경고 없는 실행으로 표현하지 않는다.

## 후속: 긴 식단의 출처 보존

최초 구현은 주차 버전·전체 슬롯 목록을 sourceId에 넣었다. 104주·728끼니 산술 fixture에서
8,192자 제한에 걸려 수동 메모까지 조회하지 못하는 문제를 직접 재현했다. ID 제한을 늘리거나
슬롯을 잘라 버리는 대신 행 식별과 출처 증거를 분리했다.

- 부족분의 새 행 ID는 재료 식별·조리 상태·단위를 사용한다. 필요량이 달라져도 같은 행이며,
  변경된 필요량과 계획 버전은 새 출처 스냅샷으로 구분한다. ID를 인증·위변조 방지용 해시로
  취급하지 않는다.
- `reference`는 `{ schemaVersion: 1, planVersions: [[weekStart, revision], ...], slotIds: [...] }`다.
  전체 주차 버전과 관련 날짜를 보존하며 표시용 첫 세 날짜로 축약하지 않는다.
- 구매 저장을 시작할 때 중첩 배열까지 복사하므로 대기 중 호출자가 입력을 바꿔도 기록 당시
  근거가 바뀌지 않는다. 동일 요청 ID에 다른 출처 버전·구매 내용이 오면 기존 메모를 덮지 않는다.
- 주차는 실제 월요일 날짜·중복 없는 양의 revision이어야 한다. 슬롯은 실제 날짜의 저녁이고
  참조 주차에 속해야 한다. 누락·미지원 버전·빈 슬롯·잘못된 참조는 조용히 버리지 않고 거부한다.
- 기존 긴 JSON형 ID로 저장한 구매 메모는 변환·삭제하지 않는다. 기존 메모 조회와 같은 요청
  재시도를 그대로 지원한다. DB v5와 구매 메모 schemaVersion 1은 바꾸지 않았다.

이번 후속 변경은 `shoppingRepository.js`, `shoppingSourceBoundaries.test.js` 및
README·CHANGELOG·이 문서·진행 기록뿐이다. 화면·계산 가중치·원본 재고·식단·추천 구현은
이번 후속에서 수정하지 않았다. 기존 42끼니 테스트는 전체 참조가 ID 안에 있다는 기대만
별도 reference에 있다는 기대로 바꿨으며, 모든 주차·슬롯 보존 assertion은 유지했다.

후속 로그: `/private/tmp/fridgemate-prd-v2-source-dp0zrSWN`.

| 기록 | 결과 |
| --- | --- |
| `baseline.json` | 착수 시 전체 163파일 1,399/1,399 통과 |
| `source-red.json` | 출처 경계 14개 중 11개 예상 assertion 실패, 기존 호환·단위/상태 구분 3개 통과. import·환경 오류 없음 |
| `source-green.json` | 실제 저장 API·화면 저장 통합 포함 3파일 38/38 통과 |
| `final-tests.json` | 전체 163파일 1,410/1,410 통과, skip/todo 0, 다른 작업 트리 실행 0 |
| `browser-final.json` | 이 작업 트리 e2e 8파일 39/39 통과, 약 60.5초, skip·flaky·재시도 0 |
| `npm run lint`, `npm run build` | 종료 코드 0. 공개 113경로·사이트맵·noindex 셸 검증 포함 |

104주 fixture는 100g씩 728끼니의 부족분 72,800g과 모든 104개 버전·728개 슬롯을 확인한다.
짧은 ID만 확인한 것이 아니라 구매 저장·조회·같은 요청 재시도, 메뉴량 변경 후 과거 기록 보존,
기존 형식 구매 기록의 무변경 재사용까지 검증했다. 합성 산술 자료이며 728개 검수 메뉴나
2년간 재료 안전성·보유량을 보장하는 자료가 아니다. 이번 후속 실행에는 예상 밖 실패가 없었다.
앞선 4개 간헐적 브라우저 실패는 재현되지 않았으나 근본 원인을 해결했다는 뜻은 아니다.

최종 단위·통합 검사를 끝낸 뒤 브라우저 검사를 독립 실행했고 그 뒤 빌드를 실행했다.
사용한 Node 경로는 아래 재검증 절차와 같다. 실제 명령의 결과 파일은 다음과 같다.

```sh
npm run test:run -- --exclude '.worktrees/**' --reporter=json --outputFile=/private/tmp/fridgemate-prd-v2-source-dp0zrSWN/final-tests.json
PLAYWRIGHT_JSON_OUTPUT_NAME=/private/tmp/fridgemate-prd-v2-source-dp0zrSWN/browser-final.json npm run test:e2e -- --workers=2 --output=/private/tmp/fridgemate-prd-v2-source-dp0zrSWN/browser-final --reporter=json
npm run lint
npm run build
```

## 한계와 다음 범위

- sourceId의 8,192자 상한은 유지하되 식단 주차 수는 더 이상 ID 길이에 영향을 주지 않는다.
  reference와 로컬 저장량은 여전히 계획 수에 따라 늘어난다. 104주 728끼 검사를 무제한 용량,
  실제 저사양 모바일 성능, 월간 기능 완료로 해석하지 않는다. 저장 공간 정리·성능 측정은 별도다.
- 미확인 양은 `양 확인 필요`로 유지한다. g/ml와 조리 전/후의 미확인 수요를 구분하며,
  수동 문자열이나 구매 메모를 정량 재고 근거로 사용하지 않는다.
- 새 저장소는 이 기기의 계정 범위 안에 있다. 서버 동기화·다른 기기 이동·내보내기/가져오기·
  구매 메모 수정·취소는 이번 단위에 포함하지 않았다. 브라우저 자료 삭제 시 기록을 잃을 수 있다.
- B3의 실제 입고·사용량·소비 이벤트·반대 이벤트 취소·멱등 재고 반영은 미구현이다.
  구매 메모의 operationId 중복 방지를 실제 입고 멱등성 구현으로 확대 해석하지 않는다.
- 검수 카탈로그 확충과 이후 PRD 단계는 여전히 남아 있다. 코드 통과는 사용자 파일럿,
  운영 배포 또는 전체 B1/B2 출시 완료를 대신하지 않는다.

## 재검증 방법과 작업 경계

Node 24와 기존 검증 의존성을 사용했다. `node_modules`는
`/private/tmp/fridgemate-weekly-pr-CtPuVjtR/node_modules`를 임시 링크로 재사용하고 검증 후
링크만 제거한다. 대상 의존성 폴더는 삭제하지 않는다. 다시 연결할 때는 package.json·lockfile
일치를 먼저 확인하고 기존 링크나 폴더를 덮어쓰지 않는다. 새 의존성 설치나 원본 `.env`
복사를 전제로 하지 않는다. 다음은 해당 전용 작업 공간에서 사용할 재검증 명령이다.
JSON 보고서를 추가로 남길 때는 기존 증거를 덮어쓰지 않는 새 경로를 지정한다.

```sh
PATH=/Users/lee/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH npm run test:run -- --exclude '.worktrees/**'
PATH=/Users/lee/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH npm run lint
PATH=/Users/lee/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH npm run build
PATH=/Users/lee/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH npm run test:e2e -- --workers=2 --reporter=list
```

최초 화면 연결에서 최종 실행한 기록 보존 명령은 위 단위 명령에
`--reporter=json --outputFile=/private/tmp/fridgemate-prd-v2-shopping-2TP2VvDa/final-verified-tests.json`을
더한 형태이며, 브라우저에는 `PLAYWRIGHT_JSON_OUTPUT_NAME`을 같은 디렉터리의
`browser-isolated.json`으로 설정하고 `--output=/private/tmp/fridgemate-prd-v2-shopping-2TP2VvDa/browser-isolated --reporter=json`
인자를 사용했다. 빌드·린트도 해당 작업 트리에서 실행했다. 모바일 RED 실행은
`e2e/meal-plan.spec.js --grep 'manual shopping and actual purchase notes' --workers=1`로 좁혔다.

원본 저장소·보관 스냅샷·기존 변경은 보존했으며 commit·push·merge·배포·실제 외부 계정 호출은
하지 않았다. 앱 코드가 바뀐 곳은 위 별도 작업 트리다. 여기서 다음 검증을 할 때도 원본 루트로
옮겨 실행하거나 별도 작업 트리의 결과를 원본 저장소 결과로 보고하지 않는다.
