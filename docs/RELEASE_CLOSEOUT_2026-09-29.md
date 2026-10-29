# 출시 마감 1단계: 코드 보존과 새 전체 검증

기준일: 2026-09-29 KST. 새 기능 확대보다 기존 작업 보존 → PR/CI → 배포 대상 확정 → 배포 후 검증을 우선한다. 이 기록은 출시 완료 선언이 아니다.

## 보존 범위

- 작업 브랜치: `codex/prd-v2-recovered-20260919`.
- 시작 커밋: `b6e3f10480df1cddf9ff005b44f99698befe4c86`. 이전 PRD v2 구현이 이미 포함된 커밋이며, 이번 204개 미커밋 변경과 구분한다.
- 204개 변경·미추적 파일은 기능 단계별로 보관했던 17개 스냅샷의 경로·SHA-256을 검증한 뒤 순서대로 커밋했다. 누적 파일 수는 12 → 25 → 42 → 78 → 93 → 99 → 108 → 112 → 138 → 149 → 170 → 177 → 193 → 197 → 202 → 203 → 204다.
- 마지막 보존 커밋은 `e6d2711dbf`. 이 시점에 204개 작업 파일이 마지막 스냅샷과 byte-for-byte 일치하며, 그 밖의 고정 코드 601개도 해시가 같았다. 작업 트리는 clean이었다.
- 스냅샷에서 manifest 대상 파일만 Git index에 순차 반영했다. 작업 파일을 과거 버전으로 덮어쓰거나 reset/clean/stash하지 않았다. archive, AppleDouble/PAX 부가 파일, 환경 파일, 의존성 디렉터리, 테스트 실행 결과는 커밋하지 않았다.
- 원본 루트 체크아웃은 수정하지 않았다. 해당 루트의 상태 목록이 시작 때와 동일함을 추가 확인했다. 상태 목록 비교만으로 원본의 모든 내용 해시를 검증했다고 주장하지 않는다.
- 이후 `origin/main`의 `129b637`을 `933a00a`로 병합했다. main 쪽 변경은 AdSense·추천 실습 관련 Markdown 7개뿐이었다. CHANGELOG 충돌은 양쪽 항목을 보존해 해결했으며 소스·테스트·설정은 바뀌지 않았다.

## 기능별 커밋

| 커밋 | 보존한 단계 |
|---|---|
| `8d03137` | 식단 편집기와 파일럿 공통 정책 분리 |
| `ebd6a26` | 개인정보 UI·요청 검증·트랜잭션 보조 함수 분리 |
| `91a0028` | 보조 저장 실패 시 장보기·OCR 작업 보존 |
| `bcb622c` | 지난 미완료 끼니 보호·분석 철회 경계 |
| `246a365` | 실제 소비량의 원자적 정정 |
| `15d7a3c` | 가입 전 식단 시작·미등록 재고 안내 |
| `bc418ae` | 검토한 OCR 재료의 원자적 저장·재시도 |
| `356c372` | 손상된 OCR 보정 기록의 명시적 복구 |
| `14bfa09` | 별도 동의 기반 로컬 파일럿 기록·수동 내보내기 |
| `8fefa07` | 팬트리·취향 저장 실패 및 경합 보호 |
| `f8e15aa` | 재고 오류·인증 세대·늦은 응답 보호 |
| `a2f3cc2` | 새 설치 검증·Prisma 준비·빌드 브라우저 CI |
| `b5630f3` | 키보드 초점·오류 연결·상태 알림 |
| `fb35e3f` | 인증·개인정보 폼 중복 제출과 오래된 응답 보호 |
| `7920e53` | 공개 소개와 주간 식단 진입 연결 |
| `5540c27` | 지난 끼니·조리 테스트의 조회 범위 개선 |
| `e6d2711` | 격리 PostgreSQL 검증 및 제한 기록 |

중간 17개 트리를 각각 이번에 다시 시험한 것은 아니다. 아래 결과는 커밋 전 최종 204개 파일 상태를 새로 실행한 결과이며, 단계별 과거 검증은 각 문서를 따른다.

## 이번에 새로 실행한 검증

macOS arm64, Node 24.19.0, npm 11.4.2, 기존 설치 의존성으로 실행했다. 별도 작업 트리가 섞이지 않도록 단위 검사의 실제 파일 목록 232개가 모두 해당 체크아웃 아래인지 확인했다.

| 검사 | 새 결과 | 범위 |
|---|---:|---|
| 전체 단위·통합 | 232파일 / 2,989개 통과 | 실패·skip·todo 0, 기본 작업자 수 |
| 전체 개발 서버 브라우저 | 107개 통과 | local-only 77개 + 모의 API 30개, retry/skip/flaky 0 |
| ESLint | 통과 | 현재 체크아웃 |
| production build + postbuild | 통과 | 공개 경로 113개·사이트맵·noindex app shell 검사 포함 |
| 실제 빌드 브라우저 | 48개 통과 | local-only Chromium, retry/skip/flaky 0 |

48개 preview 검사는 기존 사용자 흐름을 다른 실행 환경에서 확인한 것으로 107개와 별개의 새 기능 48개가 아니다. 모의 API 검사는 운영 인증·쿠키·서버 DB 검사도 아니다. 과거 타임아웃과 진단 기록은 삭제하지 않는다.

실행 시 상속 환경을 제한하고 아래 빌드 값을 명시적으로 고정했다. 저장소의 기존 production 환경 파일을 삭제·수정하지 않았고, 비밀값을 읽거나 로그에 남기지 않았다.

```text
CI=true
VITE_API_URL=
VITE_API_URL_OVERRIDE=
VITE_API_BASE_URL=
VITE_ADSENSE_VERIFICATION_ENABLED=false
VITE_ADSENSE_SERVING_ENABLED=false
VITE_GA_MEASUREMENT_ID=
VITE_SENTRY_DSN=
```

실제 실행 명령의 npm 인자는 다음과 같다. 결과 경로는 매 실행마다 새로 만든 저장소 밖 임시 디렉터리였다. `RESULT_DIR`는 이미 존재하는 증거를 덮어쓰지 않는 새 디렉터리로 지정해야 한다.

```bash
npm run test:run -- --exclude '.worktrees/**' --reporter=default --reporter=json --outputFile="$RESULT_DIR/unit-precommit-01.json"
npm run test:e2e -- --workers=2 --retries=0 --reporter=list,json --output="$RESULT_DIR/e2e-precommit-01-results"
npm run lint
npm run build
npm run test:e2e:preview -- --workers=2 --retries=0 --reporter=list,json --output="$RESULT_DIR/built-precommit-01-results"
```

브라우저 JSON 경로는 각 실행의 `PLAYWRIGHT_JSON_OUTPUT_NAME`으로 지정했다. 단위 검사 → 개발 서버 브라우저 → 빌드 → 빌드 브라우저 순서였으며, lint만 개발 서버 브라우저 검사 후반에 겹쳤다.

## PR #55에서 발견한 차단과 후속 수정

`b31ff17`의 Linux CI는 단위·통합 2,989개, 개발 서버 브라우저 107개, 빌드 브라우저 48개, lint·build·Prisma 검증/생성을 통과했다. production dependency audit와 secret scan도 통과했다. 그러나 **CodeQL 분석 job의 성공과 분석 결과 체크는 별개**다. 결과 체크에 high 경고 2개가 발생해 PR이 차단됐으며 이를 전체 CI 성공으로 보고하지 않는다.

- `e2e/analytics-consent.spec.js`의 URL 정규식은 호스트 앞부분과 URL 시작을 제한하지 않았다. 테스트용 요청 감지 패턴이지 앱의 접근 허가 로직은 아니다. 기존 패턴으로 위장 호스트·경로/쿼리에 포함된 주소를 잘못 감지하는 4개 assertion 실패를 확인했다. E2E가 실제 사용하는 패턴을 작은 공용 테스트 보조 파일로 옮기고 HTTPS URL 시작과 정확한 호스트 경계를 제한했다. 정상 4개·비대상 7개, 총 11개가 통과한다.
- `scripts/analyze-meal-plan-pilot.mjs`의 경로 `lstat` → `open` 사이에 입력이 FIFO로 교체되면 쓰기측을 기다리며 멈췄다. 실제 임시 파일·child process를 사용하는 회귀에서 기존 25개 통과와 `ETIMEDOUT` assertion 1개 실패를 확인했다. `O_NOFOLLOW | O_NONBLOCK`으로 열고 **실제 열린 descriptor**에서 일반 파일·단일 링크·12MiB 제한을 확인하도록 고쳤다. 읽기 전후 크기/시간 검사·최대 읽기량·비공개 오류·출력 독점 생성은 유지했고 26개가 두 번 통과했다.
- 첫 FIFO GREEN 시도에는 child 인자가 CLI 진입점도 실행하게 한 테스트 fixture 오류가 있었다. 인자를 바로잡은 뒤 기존 구현에서 유효 RED를 다시 확인했다. 이 중간 오류를 코드 결함 재현 성공으로 세지 않는다.
- 파일 입력의 기준은 사전 경로 검사 시점의 inode가 아니라 open 시점의 descriptor다. 부모 디렉터리 교체 경합까지 격리하는 샌드박스가 아니며, 비정규 파일도 열고 나서 거절할 수 있다. `O_NOFOLLOW`는 마지막 경로 요소만 보호한다.

수정 후 새 전체 단위·통합 검사는 **233파일 / 3,001개**(실패·skip·todo 0), 개발 서버 브라우저 **107개**, 실제 빌드 브라우저 **48개**(둘 다 retry/skip/flaky 0), lint·build가 통과했다. 명령과 환경은 앞의 검증과 동일하며 증거 파일 이름은 `unit/e2e/built-security-final-01`, 최종 동결 뒤 lint·build는 `security-final-02`로 구분한다. 추가 12개는 URL 경계 11개와 파일 경합 1개다.

위 수정은 메뉴 정책·파일럿 새 기능·운영 배포 설정을 바꾸지 않는다. 최신 원격 결과는 [PR #55 검사](https://github.com/slayer011019/fridgemate/pull/55/checks)에서 해당 커밋과 함께 확인해야 한다.

## 자동 Preview의 공개 HTTP 검사

GitHub deployment 메타데이터로 `b31ff17`의 Vercel 대상이 `Preview`, `production_environment:false`임을 확인했다. 기존 `verify:public-deployment` 검사기를 해당 URL에 실행했다.

- 홈은 HTTP 200이며 본문·메타·링크 차이는 없었지만 Preview의 `X-Robots-Tag: noindex` 때문에 운영 색인 기준에서는 실패다.
- 나머지 공개 경로 112개, 사이트맵, 없는 경로 4개는 다른 origin으로 이동해 검사를 중단했다. `/about`을 별도로 HEAD 조회한 결과 운영 도메인으로 가는 HTTP 308이었다.
- 근거는 기존 `vercel.json`의 모든 `*.vercel.app` 호스트를 운영 도메인으로 보내는 규칙이다. 리다이렉트 목적지를 따라가 운영 페이지를 Preview 성공으로 계산하지 않았다.
- 검사기 원본 결과는 **0/113, exit 1**이다. Preview의 의도된 noindex와 기존 호스트 리다이렉트 때문에 운영 기준 검증을 완료할 수 없으며, 이를 운영 사이트 장애나 출시 스모크 성공으로 해석하지 않는다.

이 단계에서 리다이렉트·운영 환경변수는 변경하지 않았다. 별도 local-only 파일럿을 선택할 경우, 계측 동의와 분리된 빌드/후보 정책 및 실제 테스트 가능한 Preview 호스트 범위를 먼저 정해야 한다.

## PR 이후 출시 게이트

1. 현재 브랜치를 원격에 보존하고 main 대상 PR에서 Linux CI, 의존성 감사, secret scan, CodeQL을 확인한다. 위 macOS 결과를 원격 CI 결과로 대신하지 않는다.
2. 별도 local-only 파일럿 배포인지 기존 backend-connected 운영 배포인지 확정한다. 파일럿 계측이 로컬 저장이라는 사실만으로 앱 전체가 local-only라고 단정하지 않는다. 운영 환경변수·DB·광고 설정은 이 보존 단계에서 바꾸지 않는다.
3. 메뉴 검수 등급, 파일럿 노출 기준, 과정 물·양념·단품 정책을 확정한다. 현재 편집 조합 16개와 원문 식재료량 대조 6개는 완전한 수량 검수 메뉴 22개가 아니다. 미정량 과정 물 때문에 `수량 확인 필요`인 상태는 결함으로 제거하지 않는다. 파일럿 참여 동의를 메뉴 기능 필터로 사용하지 않는다.
4. 교체·건너뛰기·미조리 이유는 한 번 탭하는 선택 항목으로 별도 구현·검증한다. 현재 generic 변경 이벤트에 이유가 이미 수집된다고 주장하지 않는다.
5. 검수 기준을 충족한 카탈로그로 30개 메뉴·재고 200개 성능 조건을 확인한다. 기존 22개 후보의 벤치마크를 그 조건의 달성으로 간주하지 않는다.
6. 제공받은 실제 영수증/주문 캡처 10~20장으로 OCR 수정률을 측정하고, 실제 폰과 다른 OS 브라우저에서 핵심 흐름을 확인한다. 합성 fixture나 Chromium emulation으로 대체 완료 처리하지 않는다.
7. 합의한 대상에 배포한 후 시작 → 확정 → 장보기 → 입고 → 조리 → 수동 파일럿 JSON 내보내기 스모크를 수행한다. 기존 사용자 기록·개인정보를 검증 fixture로 쓰지 않는다.

로컬 파일럿을 선택하면 수동 JSON 회수 절차와 35일 다음 접근 삭제를 명시하고, 서버 인증·전체 스키마·RLS·Hyperdrive는 별도 backend 출시 게이트로 남긴다. 현재 PostgreSQL 검사는 pgvector 없는 원본 SQL 구축의 제한을 포함하므로 이를 전체 DB 검증 성공으로 확대하지 않는다. 예산·포장 단위, 공유·가져오기·공동 테마, 유입별 전환 분석은 이번 출시 마감에서 확장하지 않는다.
