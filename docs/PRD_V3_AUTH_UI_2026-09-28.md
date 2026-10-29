# PRD v3 — 계정 화면 요청과 개인정보 다운로드 경계

작업일: 2026-09-28. 전용 작업트리 `prd-v2-recovered-20260919`, HEAD
`b6e3f10480df1cddf9ff005b44f99698befe4c86`.
시작 변경 상태 193파일은 접근성 단계 보관본과 모두 해시가 일치했다.
시작 archive SHA-256: `67e5175df3125096b626bdccf3879e829c2e6d650599ba89f91200bf70e2477b`.
원본 루트와 이전 보관본은 변경하지 않는다.

## 동작과 유지한 경계

- 개인정보 폼은 사용자 ID와 기존 인증 세대로 구분한다. 다른 계정 및 같은 계정의 새 로그인에서는
  이전 비밀번호·삭제 확인·오류·진행 상태를 재사용하지 않는다. 이메일 등 무관한 재렌더는 폼을 보존한다.
- 내보내기 시작 전과 API 응답 뒤에 인증 소유권, 컴포넌트 수명, 연결된 패널 DOM을 확인한다.
  A→B→A의 이전 응답이 새 작업을 완료하거나 잠금을 풀지 않는다. 이전 삭제 실패도 새 계정에 표시하지 않는다.
- BrowserRouter가 새 주소의 지연 로딩 동안 이전 화면을 남길 수 있으므로, 요청한 pathname과
  history entry도 대조한다. 화면 이동 뒤 늦은 응답으로 파일을 내려받지 않으며 임시 URL·anchor는
  다운로드 시작 실패 시에도 정리한다. 같은 계정의 정상 API 실패는 입력과 명시적 재시도를 보존한다.
- 로그인·가입은 같은 tick의 제출을 한 번만 보내고, 초기 세션 확인/로컬 전용 상태에서는 제출하지 않는다.
  정상 성공의 분석 이벤트·목적지 복귀와 실패 후 재시도를 유지한다. 이탈한 페이지는 늦은 성공으로
  사용자의 새 화면을 바꾸거나 완료 분석을 보내지 않는다.
- 같은 로그인·가입 경로의 새 history entry는 새 폼으로 시작한다. 이전 요청의 잠금이 남아 새
  제출을 막지 않으며, 이전 응답이 새 요청의 오류·분석·이동을 처리하지 않는다.
- API, 인증 서비스, 서버, 쿠키 정책, DB, 정량 계산·메뉴, 의존성은 변경하지 않는다.
  이미 진행 중인 인증이 Provider의 로그인 상태를 바꾸거나 서버가 요청을 처리하는 것까지 취소하지 않는다.

TDD 스킬로 동작 실패를 먼저 확인했다. React 스킬에 따라 동기 잠금과 DOM 수명 표식은 ref로,
업무 호출은 사용자 이벤트에 두고 계정 세대별 폼을 구분한다. 범용 요청 프레임워크는 추가하지 않는다.

## 재현과 검증 기록

변경 전 전체 기준선 `unit-baseline-01`: **229파일 / 2,956개 통과**.
실행 대상은 이 작업트리뿐이며 `.worktrees/**`를 제외했다.

- `unit-privacy-red-01`: 8개 예상 assertion 실패. 화면 이탈 뒤 다운로드, 계정/세대 변경의 비밀번호
  보존, 오래된 응답 반영, 다운로드 실패의 URL 정리 누락을 재현했다. import/환경 오류가 아니다.
- `unit-auth-red-01`: 신규 12개 중 8개 예상 실패, 기존 동작 보호 4개 통과. 중복 요청·비활성 제출·
  이탈 후 이동을 재현했다.
- 첫 `unit-auth-green-01`은 65통과/2실패다. 정상 인증 후 제출 잠금을 바로 풀면 기본 Navigate가
  원래 목적지를 덮는 문제를 발견했고, router commit까지 성공 경로가 목적지를 유지하도록 보완했다.
- `e2e-privacy-green-01`은 이름과 달리 1개 실패다. URL 변경만으로 이전 lazy route의 종료가
  보장되지 않는 실제 경계다. DOM 연결 검사만 추가한 `e2e-auth-ui-green-02`도 1통과/1실패였다.
  테스트 대기 시간을 늘려 숨기지 않고 요청 페이지 확인을 추가했다.
- `unit-privacy-dom-red-02`: 기존 8통과/DOM 이탈 1실패.
  `unit-privacy-navigation-red-03`: 기존 9통과/주소 전환 중 DOM 유지 1실패.
  이어 `unit-privacy-green-04` 및 브라우저 `e2e-auth-ui-green-03`의 신규 2개가 통과했다.
- 개인정보 통합 4개는 실제 AuthProvider·세션 서비스·API 클라이언트·ProtectedRoute·StrictMode를
  연결했다. 외부 fetch와 무관한 계정 패널만 대체한다. 정상 파일 내용, API 실패 재시도, 동일 계정
  재로그인, 삭제 승인 뒤 세션 정리·보호 경로 이탈을 확인했으며, 최초 통과한 보호 검사이지 RED가 아니다.
- `unit-auth-history-red-04`: 기존 12통과/페이지 주소·history entry 변경 뒤 늦은 완료 4실패.
  `unit-auth-history-retry-red-06`: 기존 16통과/같은 로그인·가입 경로로 재진입했을 때 잠금 유지 2실패.
  브라우저 주소 검사만으로 종료하지 않고 새 진입은 새 폼으로 구분하는 회귀를 추가했다.

## 최종 검증

문서를 제외한 코드·설정·자산 601파일의 해시를 고정하고 최종 검사를 실행했다.

| 검사 | 결과와 범위 |
| --- | --- |
| `unit-final-01` | **232파일 / 2,988개 통과**, 실패·skip·todo 0. 신규 32개 |
| `lint-final-01`, `build-final-01` | 종료 코드 0. 공개 정적 경로 113개·사이트맵·noindex 앱 셸 통과 |
| `e2e-final-01` | **13파일 / 104개 통과**: local-only 74, 모의 API 30. 신규 3개 |
| `built-final-01` | 실제 local-only dist의 **5파일 / 45개 통과**. 기존 흐름의 다른 실행 방식 |

브라우저 최종 검사는 자동 재시도·skip·flaky·report error 0이다. 최초 실패와 정상 로그인 목적지
회귀는 위에 보존하며 성공 실행으로 덮어쓰지 않는다. 독립 읽기 검토에서 DOM 수명 간격을
보완했고, 최종 로그인 폼의 재진입·응답 처리에서 추가 명백한 회귀를 찾지 못했다.
그 자체가 완전한 보안 증명은 아니다. 기존 React act와 NO_COLOR 관련 경고는 남아 있다.

preview 45개를 신규 검사로 더해 149개로 세지 않는다. 빌드 결과물의 실제 인증 서버 연결을
검증한 것도 아니다. 최종 검사 전후 601파일 해시를 대조하고 기존 단위 2,956개·개발 브라우저
101개·preview 45개의 파일/프로젝트/검사 이름을 보존했는지 확인한다. 기존 서버 검사 한 개의
이름에 들어가는 실행 시각만 정규화하고 기대값·검사 이름은 바꾸지 않았다.

이번 변경은 앱 4파일, 새 단위/통합 테스트 3파일, 기존 브라우저 테스트 1파일, 문서 3파일로
**11파일**이다. 누적 변경 상태는 기존 193파일에서 **197파일**이 되며 삭제는 없다.
새 테스트는 `AccountPrivacyOwnership.test.jsx`(10개), `AccountPrivacyIntegration.test.jsx`(4개),
`AuthSubmission.test.jsx`(18개)다. 구현 파일은 `AccountPrivacyPanel.jsx`, `AccountPage.jsx`,
`LoginPage.jsx`, `SignupPage.jsx`이며 기존 단위 테스트 파일은 수정하지 않았다.

## 실행과 복원

Node 24.19.0, macOS arm64, 기존 설치 의존성으로 실행한다. 자식 환경은 허용 목록만 전달하며
운영 API·광고·외부 분석·Sentry를 비활성화한다. 인증 브라우저 검사는 모의 HTTP 응답이고,
통합 테스트 DB는 fake-indexeddb다. 실제 계정 삭제나 운영 DB 요청을 하지 않는다.

```sh
npm run test:run -- --exclude '.worktrees/**'
npm run lint
VITE_API_URL= VITE_API_URL_OVERRIDE= VITE_API_BASE_URL= VITE_ADSENSE_VERIFICATION_ENABLED=false VITE_ADSENSE_SERVING_ENABLED=false VITE_GA_MEASUREMENT_ID= VITE_SENTRY_DSN= npm run build
npm run test:e2e -- --workers=2 --retries=0
npm run test:e2e:preview -- --workers=2 --retries=0
git diff --check
```

실제 실행은 `/private/tmp/fridgemate-auth-ui-5dVuQvHm/run.mjs`로 각 검사에 고유 JSON/log/trace
경로를 지정한다. 최종 보관 폴더는 인접 `../prd-v3-auth-ui-evidence-20260928`이다.
`source-manifest.json`, `tracked.patch`, `source-files.tar.gz`, `phase-summary.json`과
`validation/`의 기준선·실패·최종 JSON/log/trace 및 실행 스크립트를 함께 보존한다.
보관 파일 각각의 byte 해시를 확인하며, 원본 루트는 status 목록 해시만 대조한다.
이를 원본 루트 모든 파일 내용의 해시 검증으로 표현하지 않는다.
기준 HEAD의 별도 깨끗한 checkout에 `starting193-source-files.tar.gz` 또는 최종
`source-files.tar.gz` 중 하나만 적용하고 해당 manifest 해시를 확인한다. 기존 루트나
작업트리·보관본에 덮어쓰지 않는다. `.env`·개인 키·사용자 DB·node_modules는 보관하지 않는다.

## 전체 목표의 남은 범위

실제 서버의 계정 확인·늦은 Set-Cookie·이미 전달된 요청 취소와 다중 기기 격리는 미검증이다.
다운로드 API는 브라우저에 파일을 요청하는 것이며 사용자가 디스크에 보존했는지 보장하지 않는다.
저장소 차단 시 다른 탭 알림에도 기존 한계가 있다.

정량 검수 메뉴 20~30개와 과정 물 기준, 실기기·전체 접근성·OCR 품질·성능·저장 장애 QA,
실제 Linux CI·독립 서버 설치·Prisma 쿼리/트랜잭션·운영 배포 검증, 승인 후 10~20명/4주 파일럿은
계속 남는다. 편집 16개+원문 재료량 대조 6개를 검수 완료 22개로 세지 않는다.
로컬 보관·수동 내보내기·35일 후 다음 접근 시 삭제·분석 실패에도 조리/입고 보존 정책을 유지한다.
공개 소개/검색 유입과 이후 예산·선호 확장·공유·수익화 목표도 유지한다.
커밋·푸시·PR·병합·배포·참여자 모집은 수행하지 않는다.
