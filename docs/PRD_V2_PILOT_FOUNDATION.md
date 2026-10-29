# PRD v2 — 파일럿 지표·성능 검증 기반

2026-09-19. 전용 작업 트리 `prd-v2-recovered-20260919`에서 B4 완료 상태를 이어 작업했다.
목표는 PRD §12의 분자·분모를 재현하고 §14.2의 로컬 계산 성능을 실제 코드로 측정하는
것이다. **사용자 수집·파일럿 참여·동의 UI·중앙 분석을 켜는 작업이 아니다.** 전체 B5와
PRD 완료, 배포 승인 또는 실제 이용자 성과로 해석하지 않는다.

## 현재 상태와 이번 범위

직전 95파일 보관본의 모든 해시를 다시 대조했고, 수정 전 기존 184파일 1,938개 테스트를
새로 통과했다. 원본 루트는 수정하지 않았다. 기존 분석 ID는 브라우저 공통이고 기존
`activation_completed`는 재료 입력/OCR 활성화 의미이므로 식단 지표에 재사용하지 않았다.
기존 GA·제품 이벤트 서버에는 새 식단 이벤트를 연결하지 않았다.

이번에 추가한 것은 다음과 같다.

- `mealPlanPilotMetrics.js`: 최소 가명 이벤트 파일의 엄격한 검증과 KPI 순수 계산.
- `analyze-meal-plan-pilot.mjs`: 사용자가 지정한 파일만 읽는 오프라인 집계 명령.
- `meal-plan-pilot.synthetic.json`: 직접 계산한 **가상의 3범위** 예제. 실제 사용자 자료가 아니다.
- `benchmark-meal-plans.mjs`와 helper: 앱 저장소·외부 요청 없이 실제 브라우저에서
  현재 제품의 생성/교체/전체 미래 장보기 계산을 반복 측정.
- 각각의 동작 테스트. 기존 추천·인증·서버·DB·의존성·앱 UI는 이번 단위에서 바꾸지 않는다.

## 이벤트와 개인정보 경계

입력 계약 v1은 `schemaVersion`, `exportedAt`, `subjects`, `events`만 허용한다.
관측 범위는 가명 ID, account/guest 종류, 관측 시작/끝, 최초 정상 생성의 확인 여부와
관측 공백으로 표현한다. 이벤트는 무작위 가명 이벤트/작업/식단/슬롯 ID, 발생 시각,
Seoul 주간 키, 제한된 이름·결과·필요한 최소 숫자만 받는다.

필수/선택 필드는 아래 계약과 합성 예제를 따른다. 임의의 분석 속성을 추가하지 않는다.

| 객체 | 필수 필드 | 선택 필드/조건 |
| --- | --- | --- |
| 관측 범위 | `id`, `kind`, `observedFrom`, `observedThrough`, `firstGenerationKnown`, `gaps` | `kind`는 account/guest, 공백은 `from`/`through`/`reason`(opt-out/reset/missing) |
| 공통 이벤트 | `id`, `version`, `name`, `subjectId`, `occurredAt`, `weekKey`, `status`, `operationId` | `planId`, `slotId`, `reversesEventId`, `plannedSlotCount`, `engineVersion`만 허용 |

허용 이벤트 이름은 `meal_plan_generation_started`, `meal_plan_generated`,
`meal_plan_confirmed`, `meal_slot_changed`, `shopping_list_recalculated`,
`inventory_purchase_applied`, `meal_cooked_recorded`, `meal_cooked_reversed`,
`consumption_applied`, `consumption_reversed`다. 시작은 `status: started`, 나머지는
동일 이벤트 이름에 success/failure/cancelled를 명시한다. 실패·취소를 별도 접미사 이름으로
만들거나 성공으로 세지 않는다. 취소 동작의 성공과 원 동작의 취소된 시도도 구분한다.

생성 시작에는 planId, 정상 생성/확정 성공에는 planId와 0~7의 plannedSlotCount가 필요하다.
슬롯 변경·조리·소비 및 그 역동작 성공에는 planId/slotId가, 역동작 성공에는 원 성공을
가리키는 reversesEventId도 필요하다. 가명은 sub/evt/op/plan/slot 접두사와 `_` 뒤 32자리
소문자 16진수다. engineVersion은 영숫자로 시작하는 영숫자·점·밑줄·하이픈 최대 64자다.
시각은 2000~2099년의 밀리초 포함 정규 UTC ISO 문자열이며 weekKey는 그 시각의 Seoul
월요일이다. 최대 관측 범위 1,000개·입력 이벤트 50,000개·범위별 공백 100개로 제한한다.

계정 ID·이메일·재료 목록·실제 식사 날짜가 든 원장 slotId/weekStart·자유 텍스트·requestKey·
수량·개인 메모·에러 원문은 허용 목록 밖이므로 거부한다. 잘못된 입력을 조용히 필터링해
정상 데이터처럼 집계하지 않는다. 오류 메시지도 입력 원문이나 파일 경로를 반사하지 않는다.
출력은 집계 건수와 비율·경과시간뿐이며 가명 개인/식단/슬롯 ID도 출력하지 않는다.
입력 파일의 SHA-256은 같은 자료로 계산했는지 대조하기 위한 근거로 남긴다.

가명 **형식 검증은 익명성이나 적법한 동의를 증명하지 않는다.** 실제 수집 시에는 범위별
무작위 매핑과 계정 간 격리를 별도로 구현해야 한다. 브라우저별 ID만으로 여러 기기의
동일 계정을 중복 제거했다고 주장할 수 없다. 파일 제공자는 동의·범위·관측·최초 생성
근거를 확인해야 하며, 이 집계기를 조리 원장 자동 변환기처럼 사용하면 안 된다.

JSON 파일은 12 MiB 이하의 일반 파일만 읽고 .env/키/인증 파일명, 심볼릭 링크·하드 링크를
거부한다. 읽는 중 파일이 바뀌면 거부한다. 결과는 기존 디렉터리의 **새 JSON 파일**에
0600 권한으로 만들며 기존 파일을 덮어쓰지 않는다. 일반 로컬 파일 검증이지 악성 운영체제
사용자에 대한 완전한 파일시스템 sandbox는 아니다. 보고서 저장 도중 디스크 오류가 나면
불완전한 새 파일이 남을 수 있으므로 성공 종료를 확인하고 재실행에는 새 경로를 사용한다.

## 지표 계산 규칙

| 지표 | 계산 | 잘못된 해석 방지 |
| --- | --- | --- |
| KPI-1 | `occurredAt`의 Asia/Seoul 월~일에 서로 다른 조리 슬롯 2개 이상을 기록한 범위 수 | 실제 식사 예정일·원장 주차가 아님. 계정/게스트 분리, 자기보고 |
| KPI-2 | W+1이 끝난 W 활성 범위 중 W+1에도 활성인 수 / W 활성 범위 수 | 관측 누락·이탈을 분모에서 빼지 않음. 관측 유지·완전 관측 비활성·관측 누락을 분리 |
| 활성화 | 최초 정상 생성 뒤 72시간이 지난 범위 중 72시간 이내 정상 식단을 확정한 비율 | 최초 생성이 불명확하면 별도 표시. 확인되지 않은 첫 행을 ‘처음’으로 간주하지 않음 |
| 결정 부담 | 연결된 생성 시작부터 그 식단의 첫 확정까지 관측된 경과시간 중앙값 | 탭 방치가 포함된 wall time. 실제 조작시간·만족도 아님 |

조리 취소는 원 조리 기록의 주간에 소급해 제외한다. 소비 반영 취소는 조리 사실을
취소하지 않는다. 취소 후 같은 슬롯을 다시 기록할 수 있으나 한 주의 서로 다른 슬롯 수로
센다. 재전송의 동일 ID·동일 내용만 중복 제거하고 ID 충돌·중복 활성 조리·원본 없는 취소·
다른 범위/슬롯의 취소는 오류로 처리한다. 실패/취소된 시도와 소비 반영을 조리 성공으로
더하지 않는다.

`asOf`는 명시적으로 받아 그 이후 이벤트를 집계하지 않는다. 미래 관측이 끝나지 않은
코호트는 유지율 분모에 넣지 않는다. `exportedAt`과 입력 해시를 함께 기록하여 뒤늦은
과거 취소/전송으로 같은 기준 시점의 결과가 정정될 수 있음을 드러낸다. 분모 0인 비율과
표본 없는 중앙값은 0이 아니라 null이다. 0이벤트 참여자와 최초 생성 불명 범위도 숨기지 않는다.
기준 시점 이후에 관측을 시작한 범위는 그 과거 보고의 인구에서 제외한다. 입력 전체는
엄격히 검증하되 `inputSubjects`/`subjects`, `uniqueEvents`/`includedEvents`/
`afterCutoffEvents`로 입력량과 기준 시점 포함량을 분리한다. 계산 버전은
`meal-plan-pilot-v1`이다. unknownFirst와 noNormalGeneration은 서로 다른 차원이므로
한 범위가 양쪽에 포함될 수 있으며 두 수를 더해 전체 인구라고 해석하면 안 된다.

다음은 PRD의 문구를 계산 가능한 계약으로 구체화한 **작업상 결정**이다. 수집 시작 전에
운영자가 확인해야 하며 기존 사용자 성과의 사실로 간주하지 않는다.

- 정상 생성/확정은 계획된 슬롯이 하나 이상인 성공 결과다. 0끼니 생성은 활성화 시작이 아니다.
- 첫 정상 생성 이후 72시간 이내라면 다른 주의 정상 식단 확정도 활성화로 인정한다.
  결정 부담은 동일 식단과 연결된 생성 시작이 있는 경우만 계산한다.
- 72시간의 정확한 경계는 포함한다. 계정과 게스트는 합치지 않는다.
- 관측 종료 시각은 마지막 관측 시각을 포함하고, 공백은 시작 포함/끝 제외다. 주간 전체
  관측은 다음 월요일 00:00 KST까지 확보돼야 한다. 활성화는 정확히 72시간 시각도
  포함하므로 그 시각부터 시작하는 공백도 미확정 활성화의 관측 누락으로 표시한다.
- 알려진 첫 생성이 아닌 범위는 정식 활성화 분모에서 빼되 그 수를 공개한다. 반대로
  이미 W 활성인 범위의 W+1 관측 누락은 유지율 분모에서 빼지 않는다.
- 누락이 있는 유지율은 관측 기반 값으로 실제 재사용을 과소계상할 수 있다. 삭제 요청을
  무시하고 개인 행을 보관하여 분모를 지키자는 정책이 아니다.

## 합성 자료를 실행하는 방법

준비된 Node 24와 기존 의존성을 사용한다. 새 설치·API 키·DB 연결은 필요 없다.

```sh
node scripts/analyze-meal-plan-pilot.mjs \
  --input scripts/fixtures/meal-plan-pilot.synthetic.json \
  --output /private/tmp/fridgemate-pilot-synthetic-summary-NEW.json \
  --as-of 2026-09-21T00:00:00.000Z
node scripts/benchmark-meal-plans.mjs \
  --output /private/tmp/fridgemate-pilot-benchmark-NEW.json \
  --samples 100 --warmup 5 --weeks 1,4,12 --port 4185
```

예제의 9월 7일 코호트는 계정 2범위 중 다음 주 관측 활성 1범위·관측 누락 1범위로
관측 유지율 1/2다. 게스트는 1범위 중 다음 주 조리 기록이 1슬롯뿐이므로 0/1이다.
계정의 소비 반영 취소는 조리 기록 수를 줄이지 않는다. 정상 첫 생성이 확인된 계정은
72시간 이내 확정하고, 게스트는 그 경계를 넘겨 확정한다. **이 수치는 테스트 산술이며
FridgeMate의 실제 유지율·사용자 수가 아니다.**

## 성능 측정 범위

새 Chromium context의 빈 문서에서 기존 제품 계산 모듈만 읽는다. 실제 앱 화면·IndexedDB·
localStorage 쓰기·외부 API·GA를 차단한다. 합성 재고 200개, 2인·7일·고정 시각과 기존
카탈로그를 사용하며 1/4/12주의 확정 수요를 별도로 측정한다. 각 반복은 같은 초기 자료의
새 복사본이며 직전 결과를 누적하지 않는다. warmup은 통계에서 빼고 p95는 nearest-rank다.

생성은 새 한 주만, 교체+장보기는 한 메뉴를 실제로 교체한 후 모든 미래 주를 재배분한다.
모듈 로드·초기 자료/복사·검증·저장·DOM 갱신은 측정 구간에서 제외한다. CPU·메모리·
브라우저 버전·뷰포트·표본 수·소스 해시와 원시 시간 표본을 보고서에 기록한다.

현재 카탈로그는 총 22개(원문 재료량 대조 6개, 구성 검토 16개)다. 과정 물량까지 전부
확정된 조합은 0개이므로 PRD의 30개 검수 조합 조건은 충족하지 않는다. 실제 데이터가
없는데 조합을 복제하거나 양을 만들어 채우지 않는다. 시간 목표 안에 들어가더라도
`targetAssessment`는 자료 조건 미달로 미평가이며, 실제 저사양 기기·UI 지연·실사용
파일럿 통과가 아니다.

이번 실제 계산 측정은 Apple M4·RAM 16 GiB·Node 24.19.0·Chromium 151.0.7922.34,
390×844 뷰포트의 데스크톱 headless 엔진에서 CPU 제한 없이 실행했다. 각 100회 표본과
별도 warmup 5회다. 작은 뷰포트는 휴대폰 성능의 대체물이 아니다.

| 미래 확정 식단 | 새 1주 생성 p95 | 메뉴 교체 + 전체 미래 배분 p95 |
| --- | ---: | ---: |
| 1주 | 25.0 ms | 5.4 ms |
| 4주 | 24.7 ms | 5.6 ms |
| 12주 | 25.6 ms | 6.1 ms |

`browser-final.json`의 허용 정적 요청은 문서와 계산 모듈 총 11개였고 다른 요청은 없었다.
측정 실행기를 포함한 소스 11개 해시를 검사했다. 모든 결과의 목표 판정은
`not-assessed-target-dataset-incomplete`다. PRD 성능 목표 통과로 바꾸지 않는다.

## 검증과 보존

작업 트리는 `/Users/lee/fridgemate/.worktrees/prd-v2-recovered-20260919`, 브랜치는
`codex/prd-v2-recovered-20260919`, 기준 커밋은
`986051a6693a20e305adaff355530c5a2779774c`다. 기존 미커밋 개발 상태를 이어갔으며 아래
이번 단위의 변경과 기존 단위의 변경을 섞어 설명하지 않는다.

| 검사 | 결과/근거 |
| --- | --- |
| 변경 전 전체 | 184파일 1,938개 통과 (`baseline.json`) |
| 신규 지표 계산 | 85개 통과. 최초 82개 기능 부재 assertion RED, 이후 72시간 끝 관측 공백·미래 참여자·cutoff 건수 RED도 별도 보존 |
| 신규 파일 명령 | 16개 통과. 최초 15개 공개 진입점 부재 assertion RED 후 실제 파일/명령과 합성 수치 검증 |
| 신규 성능 도구 | 50개 통과. 최초 39개 기능 RED, 네트워크 허용 목록 10개 RED 보존 |
| 최종 전체 | 187파일 2,089개 통과 (`final-unit-verified.json`), 실패·skip·todo 0, 전부 현재 작업 트리 경로 |
| 전체 브라우저 | 11파일 51개 통과 (`final-browser.json`), 실패·skip·flaky 0, 자동 재시도 0, 약 80.8초 |
| 린트·빌드 | 통과. postbuild의 공개 정적 경로 113개 검사 포함 |
| 합성 집계 명령 | 종료 0, 3범위·17이벤트, 입력 원문 불변·집계만 새 파일 저장 (`synthetic-final.json`) |
| 실제 브라우저 계산 측정 | 종료 0, 각 시나리오 100표본, 실행기/계산 소스 11개 해시 일치 (`benchmark-browser-final.json`) |

첫 전체 실행 `final-unit.json`은 **2,088개 통과·1개 timeout**이며 최종 성공 파일로
덮어쓰지 않았다. 새 성능 도구의 실제 계산 통합검사(200재고·현재 카탈로그·4미래주,
warmup 2회 + 20회)가 전체 병렬 실행에서 5,823ms로 기본 5초를 넘었다. 무수정 단독
3회는 913/933/1,066ms로 통과해 자원 경합 영향으로 판단했다. 같은 파일의 다른 실제 계산
검사도 느려졌다. 정확한 운영체제 자원 원인을 계측한 것은 아니다.

실제 계산·표본·assertion을 유지하고 **해당 통합검사 하나의 hang guard만 15초**로
명시했다. 단독 재검사 50개와 전체 2,089개가 통과했고 전체 재검사의 해당 검사는 3,038ms였다.
이 검사의 시계는 통계 집계 검증용 고정 시계이며 제품 지연 기준이 아니다. 브라우저의
실측 p95 목표·계산 코드·전역 테스트 설정은 바꾸지 않았다.

성능 도구 첫 GREEN 시도의 1실패는 macOS 임시 부모 경로가 심볼릭 링크였던 테스트
준비 오류였다. 허용 정책을 완화하지 않고 fixture 경로를 realpath로 만들었다. import·환경
실패나 timeout을 예상 기능 RED로 세지 않았다. 변경 전 기준·예상 RED·중간 실패·최종
결과를 모두 보존한다.

이번 신규 파일은 다음 9개이며 기존 파일 변경은 README·CHANGELOG·진행 기록 3개뿐이다.

```text
src/features/mealPlans/mealPlanPilotMetrics.js
src/features/mealPlans/__tests__/mealPlanPilotMetrics.test.js
scripts/analyze-meal-plan-pilot.mjs
scripts/__tests__/analyze-meal-plan-pilot.test.js
scripts/fixtures/meal-plan-pilot.synthetic.json
scripts/benchmark-meal-plans.mjs
scripts/lib/mealPlanBenchmark.js
scripts/__tests__/mealPlanBenchmark.test.js
docs/PRD_V2_PILOT_FOUNDATION.md
```

전체 검증 실행 명령은 아래와 같다. PATH 앞에 준비된 Node 24 런타임
`/Users/lee/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin`을 사용했다.
초기 테스트와 단독 검사의 JSON도 보관한다. 새 의존성을 설치하지 않았다.

```sh
npm run test:run -- --reporter=json --outputFile=/private/tmp/fridgemate-prd-v2-pilot-foundation-UK4wuv8e/baseline.json
npm run test:run -- --reporter=json --outputFile=/private/tmp/fridgemate-prd-v2-pilot-foundation-UK4wuv8e/final-unit.json
npm run test:run -- --reporter=json --outputFile=/private/tmp/fridgemate-prd-v2-pilot-foundation-UK4wuv8e/final-unit-verified.json
npm run lint
npm run build
PLAYWRIGHT_JSON_OUTPUT_FILE=/private/tmp/fridgemate-prd-v2-pilot-foundation-UK4wuv8e/final-browser.json \
  npm run test:e2e -- --workers=2 --retries=0 --reporter=list,json \
  --output=/private/tmp/fridgemate-prd-v2-pilot-foundation-UK4wuv8e/final-browser-artifacts
```

원본 루트·이전 보관본·추천 실습·package/lockfile·인증·서버·DB는 이번 단위에서 변경하지
않았다. commit/push/merge/배포도 하지 않았다. 테스트의 인증/API 응답은 통제된 가짜
응답이며 운영 서버·실제 계정 또는 실제 조리 검증을 대체하지 않는다.

### 보관본과 복원 경계

현재 미커밋 소스 104개와 이번 단위 차이 12개는
`/Users/lee/fridgemate/.worktrees/prd-v2-pilot-foundation-evidence-20260919`에 별도 보존한다.
`source-files.tar.gz`, `source-manifest.json`, `source-delta.json`, `verification.json`으로
파일 목록·내용 해시·기준 커밋·압축본 해시를 대조한다. `validation/`에는 기준선, 예상 RED,
중간 실패, 최종 검사·성능 표본·합성 집계와 실행 요약을 함께 보관한다. 보존 스크립트는
대상이 이미 있으면 중단하고 이전 보관본을 바꾸지 않는다. `.env`, 비밀키, 의존성,
브라우저의 실제 사용자 자료는 소스 압축본에 넣지 않는다.

복원하려면 원본이나 기존 작업 폴더에 덮어쓰지 말고, 위 기준 커밋으로 **새 전용 작업
트리**를 만든 뒤 압축 목록과 SHA를 확인하고 그 새 위치에만 파일을 푼다. manifest의
104개 해시를 모두 대조한 뒤 별도로 준비된 Node 24·기존 의존성으로 검사를 실행한다.
보관본은 미커밋 소스를 복원하는 자료이며 node_modules·브라우저 설치까지 포함한 환경
이미지는 아니다. 이번에는 압축본을 새 임시 디렉터리에 실제로 풀어 모든 소스 해시를
대조했다. 원본에 reset/clean/restore/stash를 실행하지 않았다.

## 남아 있는 B5와 전체 목표

다음 연결에는 별도 옵트인, 범위별 가명 매핑, 보관 기간·철회·삭제 화면, 저장 성공과
이벤트 기록의 일관성, 재시도/오프라인 중복 제거, 실패·취소 계측과 내보내기 미리보기가
필요하다. 수집을 붙이기 전에 위 정상 생성/활성화 정책과 여러 기기 계정 구분도 확인한다.
기존 분석 동의를 새 수집 범위에 묵시적으로 확대하지 않는다.

검수 카탈로그 확충, 실제 기기/보조 기술 QA, 30개 검수 조합을 갖춘 성능 재측정,
P0 출시 차단 조건의 지속 검사, 동의한 참여자 모집과 4주 관찰은 남아 있다. 실제 참여자를
모집하거나 데이터 전송·서비스 배포를 자동 실행하지 않았다. 가격·공유·수익화 등 후속
단계를 이 기반 완료로 정당화하지 않는다.
