# PRD v3 — 지난 끼니·조리 통합 검사의 대기 비용 진단

작업: 2026-09-28 밤 ~ 2026-09-29 KST. 전용 작업트리 `prd-v2-recovered-20260919`.
기준 HEAD: `b6e3f10480df1cddf9ff005b44f99698befe4c86`.
착수 시 공개 소개 단계의 202개 변경/미추적 파일 모두 보관 manifest와 SHA-256이 일치했다.
시작 archive SHA-256: `649a67f30a23b944ab8c68dccff1e845c144653c62d4aa1cd4bc46fc5d9d2713`.

## 결론과 변경 범위

전체 페이지의 반복 조회·오류 DOM 직렬화가 테스트 대기에 비용을 더함을 계측했다.
확인된 세 대기의 탐색/관찰 범위만 실제 결과를 소유하는 영역으로 좁혔다.
과거 시간 초과의 **유일한 원인을 입증하거나 앱 성능 문제를 고쳤다는 뜻은 아니다**.
기본 병렬 실행에는 호스트 부하·실시간 스케줄링이 영향을 주며 Linux CI 검증도 별도다.

- `MealPlanOverdue.test.jsx`: 오래된 주 버튼은 지난 끼니 영역에서 기다린다. 실제 조리 저장
  안내는 조리와 재고 기록 영역에서 기다린다.
- `MealPlanCooking.test.jsx`: 계획 200g→실제 150g·두 번 클릭 사례의 완료 안내를 조리 영역에서 기다린다.
- 세 대기 모두 성공 직후 전역 `getByRole`/`getByText`로 같은 노드인지 확인해 전역 유일성을 유지한다.
- 역할·정확한 이름/문구·접근 가능 조건·기본 1초·실제 IndexedDB·StrictMode·고정 날짜·fixture·
  재고/메모/식단/장보기/재로드 후속 assertion을 유지한다. 조리 영역은 제출 전에 확보한다.
- `noticeReady` 대기를 추가하거나 retry/skip/timeout/worker 설정을 바꾸지 않았다.
- 앱 구현·저장/조리 정책·계정·DB·의존성·설정·배포 파일은 이 단계에서 바꾸지 않았다.

테스트 우선 원칙에 따라 기존 실패와 후속 실제 실패를 보존하고, 결과 누락·중복을 주입해 검사
강도를 확인했다. React 지침은 효과/갱신 의존성 검토에 사용했으나, 근거 없이 캐싱·요청 합치기를
도입하지 않았다. 문서까지 이번 변경은 5파일이며 누적 변경/미추적은 203파일이다.

## 관측과 해석

설치된 Testing Library의 `findBy*`는 즉시, 간격, 컨테이너 DOM 변경 시 동기 조회를 다시 한다.
실패마다 `getElementError`가 컨테이너를 직렬화한다. 출력 길이 제한은 이 작업량의 상한이 아니다.
fake-indexeddb의 요청/완료와 React 갱신은 그 사이에 진행해야 한다.

임시 config/setup에서 실제 저장소 호출과 transaction/getAll 완료, DOM busy 상태,
20ms heartbeat, 스타일 조회 합계, 오류 생성 시간을 기록했다. 앱에 계측을 넣거나 DB 응답을
가짜 성공으로 대체하지 않았다. 원문 사용자 자료 없이 테스트 fixture와 시각/작업 종류만 기록한다.

- 고립 첫 사례는 약 25ms에 초기 snapshot 두 개가 시작되고, 현재 주 revision 반영 후 세 번째가
  약 111ms에 시작돼 113ms 부근에 목록이 보였다. StrictMode와 revision 갱신으로 설명되는
  별도 요청이며, 이 사실만으로 캐싱이 필요하거나 안전하다고 판단하지 않는다.
- 전체 계측의 첫 사례는 `BODY` 오류 생성 5회/합계 74.869ms였다. 첫 수정 후에는 `SECTION`
  2회/합계 1.654ms였다. 서로 다른 단일 실행 관측이며 제품 속도 향상률이나 통계적 성능 결과가 아니다.
- 첫 수정 후 계측 전체에서 다른 조리 사례의 완료 안내가 시간 초과했다. 실제 조리 transaction은
  약 881→1403ms에 완료했지만, 후속 workspace 재조회는 1479ms에 시작해 테스트 종료 전
  완료가 관측되지 않았다. 성공 문구는 이 재조회 뒤에 표시되므로 저장 실패로 해석하지 않는다.
- 이 사례의 전체 오류 생성은 25회/약 614ms였다. 조리 transaction 시작 이후만 보면 약 455ms이며
  그 구간 스타일 호출은 0이었다. 따라서 이 실패에 접근성 이름 계산을 원인으로 붙이지 않는다.
- 계측 없는 전체 실행에서도 별도 Cooking 첫 사례가 같은 완료 문구 대기에서 실패해 세 번째
  대기 범위를 보강했다. 나머지 테스트를 일괄 변경하지 않았다.

계측의 함수 감싸기/관찰자/시계 조회에는 오버헤드가 있다. repository probe는 원본 Promise에
`.then()`을 연결해 반환하므로 microtask 경계도 하나 추가한다. 스타일 합계는 테스트 내 전체
호출이며 마지막 heartbeat 뒤 비용이 모두 포함된 것은 아니다. 이 수치를 순수 DB 시간이나
사용자 실기기 지연으로 해석하지 않는다. 원인 분리의 한계와 실패 기록을 통과 결과로 덮지 않는다.

## 실행 기록

| 실행 | 결과/의미 |
| --- | --- |
| 이전 공개 소개 `unit-final-01/02` | 각 2,988통과/1실패. 최초 지난 끼니 버튼 대기 시간 초과 |
| 이번 `unit-baseline-01` | 변경 전 기본 전체 232파일/2,989통과. 간헐적 실패임을 확인 |
| `unit-diagnostic-isolated-01` | 실제 DB를 유지한 고립 계측 8통과 |
| `unit-diagnostic-full-01`, `unit-diagnostic-cost-before-01` | 변경 전 계측 전체 각각 2,989통과 |
| `unit-diagnostic-cost-after-01` | 첫 대기만 보강한 상태에서 2,988통과/1실패. Overdue 조리 완료 문구 대기 |
| `unit-diagnostic-cost-after-02` | 두 대기 보강 후 계측 전체 2,989통과 |
| `unit-final-01` | 계측 없는 기본 전체 2,988통과/1실패. 별도 Cooking 첫 사례의 완료 문구 대기 |
| `unit-negative-missing-01`, `unit-negative-duplicate-01` | 각각 대상 1개가 버튼 누락/전역 중복 assertion으로 예상 실패 |
| `unit-negative-cooking-notice-01` | 완료 문구 제거 시 대상 2개 모두 missing text assertion으로 예상 실패 |
| `unit-focused-final-01` | 보강한 두 파일 13통과 |
| `unit-final-02`, `unit-final-03` | 계측 없는 기본 전체 각각 **232파일/2,989통과**, 실패·skip·todo 0 |
| `lint-final-01`, `build-final-01` | 종료 코드 0. 공개 정적 경로 113개·사이트맵·noindex 앱 셸 검증 통과 |

부정 검증은 임시 Vite transform으로 메모리 안에서만 결과를 누락/중복시켰다. 실제 구현 파일은
덮어쓰지 않았고 import/환경 오류가 아닌 assertion 차이를 확인했다. 이 실행의 7개 또는 11개
pending은 `-t`로 지정하지 않은 사례이며 전체 검사를 skip한 것이 아니다.

최종 두 실행은 별도 retry나 `--maxWorkers` 없이 같은 코드로 실행했다. 기준선의 2,989개
검사 이름과 실제 실행 파일을 대조했다. 기존 `server/src/lib/__tests__/ingredientValidation.test.js`의
`new Date()` 기반 이름 한 건만 실행 시각을 정규화했으며 테스트 내용·기대값은 바꾸지 않았다.
최종 검사 전후 코드·설정·자산 601개 해시를 대조했다. 직전 단계와 다른 코드 파일은 위 테스트
두 개뿐이다. 중간 보관 manifest `01`~`03`도 남기며 최종 검증 대상은 `tested-code-04`다.

기존 React act 및 NO_COLOR 경고는 남아 있으며 무경고 통과로 표현하지 않는다.
앱·E2E 구현은 바꾸지 않아 이번에는 E2E를 재실행하지 않았다. 이전 브라우저 107개/preview 48개를
이번 단계의 새 실행 결과로 재사용하지 않는다. 두 번의 기본 전체 통과는 확인한 로컬 표본이며
이전 실패를 무효화하거나 모든 환경에서 간헐적 실패가 제거됐음을 보장하지 않는다.

## 재실행·보관·제한

Node 24.19.0/macOS arm64와 기존 설치 의존성을 사용한다. 새 설치나 운영 서버 검사가 아니다.
runner는 환경 변수 허용 목록만 전달하고 API/광고/분석/Sentry를 비활성화하며, 실행마다 새
로그·JSON을 사용한다. `.worktrees/**`를 제외하고 실제 파일·검사 목록을 기준선과 비교한다.

```sh
npm run test:run -- --exclude '.worktrees/**' src/pages/__tests__/MealPlanOverdue.test.jsx src/pages/__tests__/MealPlanCooking.test.jsx
npm run test:run -- --exclude '.worktrees/**'
npm run lint
VITE_API_URL= VITE_API_URL_OVERRIDE= VITE_API_BASE_URL= VITE_ADSENSE_VERIFICATION_ENABLED=false VITE_ADSENSE_SERVING_ENABLED=false VITE_GA_MEASUREMENT_ID= VITE_SENTRY_DSN= npm run build
git diff --check
```

임시 실행기/계측/결과: `/private/tmp/fridgemate-overdue-loading-6WUMr9nj`.
보관 위치: 인접 `../prd-v3-overdue-diagnostics-evidence-20260929`.
시작 202개와 완료 203개 파일 archive·manifest, 이 단계 diff, 기준/실패/최종 결과와
진단 스크립트를 함께 둔다. archive를 별도 임시 폴더에 풀어 모든 내용 해시를 검증한다.
새 깨끗한 checkout을 기준 HEAD에 맞춘 뒤 시작/완료 archive 하나만
적용하고 해당 manifest의 모든 파일 SHA를 확인한다. 현재 작업트리나 원본에 덮어쓰지 않는다.
환경파일·비밀키·사용자 DB·node_modules는 포함하지 않는다. 원본 루트는 status 목록 해시를
대조하며 원본 전체 파일 내용의 해시 검증으로 과장하지 않는다.

검수 메뉴 20~30개와 과정 물/단품 기준, 실기기·전체 접근성·OCR·저장 장애·성능 QA,
실제 Linux CI·독립 서버 설치·Prisma 쿼리/트랜잭션·운영 인증·배포 검증은 여전히 남는다.
실제 10~20명/4주 파일럿과 검색 유입→식단 확정 전환도 미완료다. 로컬 보관·수동 내보내기·
35일 후 다음 접근 시 정리·분석 실패에도 조리/입고 보존 정책과 후속 PRD 범위를 유지한다.
이번 단계에서는 commit/push/PR/병합/배포/모집을 하지 않는다.
