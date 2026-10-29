# PRD v3 — 새 설치와 빌드 산출물 검증

작업일: 2026-09-28. 전용 작업트리 `prd-v2-recovered-20260919`, HEAD
`b6e3f10480df1cddf9ff005b44f99698befe4c86`. 재고·인증 단계의 미커밋/미추적
170파일과 archive SHA-256
`5da64f447defa37035f1933f365c80a714efc4eab310d6ae85a9438388b54f99`를 시작점으로 한다.

## 결론과 격리 범위

루트의 새 `npm ci`는 663개 패키지를 설치하고 실제 Prisma Client 6.19.3을 생성했다.
현재 루트 설치에서 Prisma 오류를 재현하지 못했다. 버전 혼합만으로 실패라고
단정하거나 의존성을 업그레이드하지 않았다. 실제 dist 검사에서는 테스트 데이터 준비와
앱 부팅의 경합을 발견해 테스트 보조 함수와 검사 설정을 보강한다.

호스트는 **macOS arm64, Node 24.19.0 / npm 11.4.2**다. 기존 Linux 컨테이너/VM 도구를
찾지 못했고 GitHub Actions를 실행하지 않았다. **macOS 성공은 Linux CI 성공이 아니다.**

- `/private/tmp/fridgemate-clean-install-GWY6CyER/source`에 현재 소스 652파일을 SHA로
  대조해 복사했다. `.env.example`, `.env.production`, `.env.staging.example`,
  `server/.env.example`의 내용, 개인 환경파일, 기존 node_modules, 원본 .git은 제외했다.
- 빈 npm cache와 서로 다른 빈 user/global npmrc, 공개 registry를 사용했다. 자식 환경은
  명시한 검사 변수만 전달해 개인 npm 인증 설정·API 키·운영 DB 주소를 상속하지 않는다.
  lifecycle script를 실행했으며 `--ignore-scripts`로 성공을 만들지 않았다.
- 파일명 정책 테스트에는 원본의 실제 추적 경로/mode 592개로 만든 임시 Git 인덱스를
  썼다. blob은 빈 값이다. Git 이력 검사가 아니며 원본 Git 설정·자격증명·환경파일 내용과
  커밋을 복사/생성하지 않았다. Playwright 브라우저 실행 파일은 기존 설치를 재사용했다.
  시스템 전체나 Prisma 다운로드 cache까지 비운 cold-cache 실험은 아니다.
- 환경파일을 제외한 local-only 빌드다. 운영 API·광고 설정을 재현한 배포 검사가 아니다.

## 첫 실행의 결과와 절차 오류 구분

| 기록 | 실제 결과와 해석 |
| --- | --- |
| `install-01` | user/global npmrc에 같은 `/dev/null`을 지정한 검사 오류. 의존성 설치 전 실패 |
| `install-02` | 서로 다른 빈 npmrc로 수정 후 설치·Prisma 생성 성공. 이후 수동 생성으로 첫 설치 실패를 숨기지 않음 |
| `unit-01` | 2,921통과/1실패. 소스 export에 .git이 없어 추적 파일명 검사만 실패 |
| `unit-02` | 실제 추적 파일명 인덱스 추가 후 226파일/2,922개 통과. 앱·assertion 변경 없음 |
| `lint-01`, `build-01` | 종료 코드 0. 공개 경로 113개·사이트맵·noindex shell 통과 |
| `e2e-01` | 새 설치본의 개발 서버 검사 89개 통과, retry/skip/flaky 0 |
| `schema-01`, `generate-01` | 더미 loopback URL로 스키마 검사·생성 통과. 연결·쿼리·migration 없음 |
| `smoke-01` | 생성 스키마와 원본의 바이트 해시가 같다는 진단 가정 오류. formatter가 공백/인덱스 순서를 정리함 |
| `smoke-02` | 실제 초기화는 진행됐지만 export되지 않은 package.json require에서 진단 출력 실패 |
| `smoke-03` | 별도 원본 복사본을 같은 formatter로 정리한 결과와 생성 스키마 일치. 모델 12개·SQL helper·기본 Client·실제 서버 adapter 초기화 통과. 연결 시도/쿼리 0 |

스키마 원본 SHA는 `829083e5c153f399f5d304698b9200419917365c9bd20a8614fd24fc0b7f1ae3`,
생성/format 결과는 `0d9b8062d37e9a679e985ef0504495f370a4708298bbddc9797cb50e48df788d`다.
원본 스키마를 덮지 않았다. 위 절차 오류는 제품 버그 RED로 세지 않는다.

## 실제 dist와 테스트 초기화 경합

`preview-01`: 같은 세 파일의 33개 중 25통과/8실패. 재고 오류 주입 검사 5개는 실제
오류 주입 **이전**의 준비 재고 표시에서 실패했고, 수량 패널 2개와 돌아온 게스트 화면
1개도 예상 초기 상태가 아니었다. 기존 helper는 비동기 DB 준비와 앱 부팅을 병행했다.
`gotoAndWait`의 뒤늦은 준비 대기로 이미 실행된 앱 조회를 다시 실행하지 못한다.
fixture 초기 DB와 앱 v7의 업그레이드 경합도 가능하므로 모두 ‘빈 cache’라고 단정하지 않는다.

앱/dist를 그대로 둔 채 앱 없는 동일 origin 문서에서 준비를 마치도록 helper만 바꾼
`preview-02`는 **동일한 33개 모두 통과**했다. 실행 목록과 assertion은 같고 skip/retry가
없음을 독립 검토했다. 최초 JSON/log는 보존했지만 trace 폴더는 다음 실행이 재사용했다.
최초 trace까지 보존됐다고 하지 않으며, 후속 결과 폴더는 실행별로 분리한다.

추가 독립 검토에서 기존 `onblocked`와 `.finally()`가 준비 실패도 완료로 처리하는
경계도 확인했다. 이를 실제 브라우저 오류 주입/다른 탭 DB 연결 유지로 별도 재현한다.

## 변경 파일과 최종 검증

- `e2e/support/testApp.js`: 앱 실행 전 준비, 준비 실패·다른 탭 차단의 명시적 오류 전달.
- `e2e/seed-setup.spec.js`: 쓰기 실패와 실제 DB 삭제 차단의 회귀.
- `playwright.config.js`: 새 fixture 회귀를 개발 서버 검사에 포함.
- `playwright.preview.config.js`, `package.json`: 실제 dist를 여는 `test:e2e:preview`.
  재고·식단·공개 메뉴·fixture 범위이며 실제 API 모드는 아니다.
- `.github/workflows/ci.yml`: 더미 URL의 Prisma validate/generate와 별도 local-only
  build→preview 단계를 정의. API URL 세 변수·광고·분석·Sentry를 비활성화한다.
- README·CHANGELOG·이 문서: 범위, 결과, 실행법과 한계.

앱 구현·DB 스키마·의존성·lockfile은 변경하지 않았다. 프로젝트 변경은 위 코드/설정
6파일과 문서 3파일, 총 **9파일**이다. 기존 작업을 포함한 전체 변경/미추적은 177파일이다.

`seed-setup-red-01`에서 쓰기 실패와 실제 다른 탭의 DB 삭제 차단 모두 **reject 대신
resolve했다는 assertion 차이로 2개 실패**했다. `seed-setup-green-02`는 2개 모두 통과다.
오류 이름만 전달하고 성공한 경우에만 완료 표식을 남기며, 쓰기 실패 때 테스트용
트랜잭션을 취소하고 연결을 닫는다. 기존 89개 assertion을 제거·skip하지 않았다.

최종 프로젝트 코드/설정과 새 설치본의 654파일을 대조·고정한 뒤 다시 검사했다.

| 최종 검사 | 결과 |
| --- | --- |
| `unit-03` | 226파일 / 2,922개 통과, 실패·skip·todo 0 |
| `lint-02`, `build-02` | 종료 코드 0, 공개 경로 113개·사이트맵·noindex shell 검증 통과 |
| `e2e-02` | 12파일 / 91개 통과: local-only 64 + 모의 API 27 |
| `built-01` | 실제 local-only dist를 대상으로 4파일 / 35개 통과 |
| `schema-01`, `generate-01`, `smoke-03` | 스키마·코드 생성·DB 연결 없는 초기화 확인 통과 |

브라우저 결과는 모두 1회 실행이며 retry/skip/flaky/report error가 없다. 기존 개발
서버 89개와 기존 preview 33개의 이름이 최종 실행에 남는지 확인한다. 새 브라우저
회귀는 2개이고 35개 preview는 기존 흐름의 다른 실행 방식이므로 91+35를 서로 다른
126개 테스트라고 세지 않는다. 단위 테스트 목록도 앞선 2,922개와 대조한다.

TDD 절차로 준비 오류를 먼저 재현한 뒤 테스트 보조 함수만 보강했다. 독립 검토에서
preview/개발 서버의 분리, CI 환경 변수의 단계별 범위, lock 일치를 확인했다.
반복 실패를 없애려고 앱 코드를 바꾸거나 시간 제한/재시도 횟수를 늘리지 않았다.

## 실행과 보관

Node 24와 새 복제본에서 실행한다. 사용자 폴더의 기존 node_modules를 자동 교체하지 않는다.

```sh
npm ci
npm run lint
npm run test:run -- --exclude '.worktrees/**'
npm run test:e2e -- --workers=2 --retries=0
VITE_API_URL= VITE_API_URL_OVERRIDE= VITE_API_BASE_URL= VITE_ADSENSE_VERIFICATION_ENABLED=false VITE_ADSENSE_SERVING_ENABLED=false VITE_GA_MEASUREMENT_ID= VITE_SENTRY_DSN= npm run build
npm run test:e2e:preview
DATABASE_URL=postgresql://ci:ci@127.0.0.1:9/fridgemate_ci DIRECT_URL=postgresql://ci:ci@127.0.0.1:9/fridgemate_ci npm run prisma:validate
DATABASE_URL=postgresql://ci:ci@127.0.0.1:9/fridgemate_ci DIRECT_URL=postgresql://ci:ci@127.0.0.1:9/fridgemate_ci npm run prisma:generate
```

개발/preview E2E는 순서대로 실행한다. 기본 결과가 `test-results/`를 공유하므로 보관하려면
`--output`과 reporter 경로를 실행별로 지정한다. 실제 검사 명령·종료 코드·시간과 JSON/log는
임시 증거 폴더에 별도 이름으로 남긴다. React act 및 NO_COLOR 경고는 무경고 통과와 구분한다.

완료 보관 위치는 `../prd-v3-clean-install-evidence-20260928`이다.

- `source-files.tar.gz`와 manifest: 기준 HEAD에 덧붙일 최종 177개 변경/미추적 파일.
- `starting170-source-files.tar.gz`와 manifest: 이 단계 전의 변경 상태. 원본 보관본도 유지한다.
- `tested-source-without-env.tar.gz`: 실제 새 설치 검사에 사용한 소스 654파일. 환경파일과
  의존성은 없고, 문서는 검사 시작 시점 것이다. 최종 보고서는 위 최종 소스/현재 작업트리를 따른다.
- `validation/`: 실행 명령/종료 코드/시간/JSON/log/보관 스크립트 및 신규 fixture RED trace.
- `phase-summary.json`: 변경 9파일, 결과 집계, archive SHA, 모든 archive 파일 해시 대조 결과.

전체 변경 상태를 복원하려면 별도의 깨끗한 checkout에서 위 기준 HEAD를 준비하고
시작/완료 archive **하나만** 적용한 뒤 대응 manifest SHA를 확인한다. 현재 작업트리나
원본에 덮지 않는다. 환경파일 없는 검사본은 별도의 빈 폴더에 풀어 Node 24로 설치한다.
추적 파일명 검사에는 기록된 원본 Git 경로 목록이 필요하므로 빈 Git 인덱스로 성공을
대신하지 않는다. 환경파일·사용자 데이터·node_modules는 archive에 포함하지 않았다.
이는 범용 비밀 탐지나 실제 운영 환경 복원이 아니다.

## 남은 게이트

- 실제 Ubuntu CI, 새 Linux 브라우저 설치, 실기기·접근성·성능 검사.
- Client/CLI 6.19.3 + adapter 7.10.0의 실제 쿼리/트랜잭션/RLS/운영 연결 호환성.
  초기화만 통과했으며 DB에 연결하지 않았다.
- 별도 server/package.json은 Client/CLI 7.10.0을 선언하고 자체 lock/workspace와 adapter
  선언이 없다. 독립 서버 설치를 실행하거나 지원 계약을 변경하지 않았다.
- preview는 별도 local-only 재빌드다. CI build job의 업로드 artifact와 동일 bytes 검사나
  Vercel rewrite/응답 헤더 검사가 아니다. 기존 API E2E도 모의 응답이다.
- 메뉴 20~30개 검수, 전체 저장소 장애 QA, 실제 파일럿과 공개 소개/후속 기능 목표를 유지한다.
  과정 물 기준 응답 전에는 기존 6개를 완전 검수 완료로 승격하지 않는다.
- 원본 루트·앞선 스냅샷을 변경하지 않으며 commit/push/PR/배포/운영 API·DB 요청은 하지 않는다.
