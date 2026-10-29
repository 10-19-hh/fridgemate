# PRD v3 — 공개 소개와 검색 경계

작업일: 2026-09-28. 작업트리 `prd-v2-recovered-20260919`, HEAD
`b6e3f10480df1cddf9ff005b44f99698befe4c86`.
시작 변경 197파일은 직전 계정 UI 단계의 manifest와 모두 내용 해시가 일치했다.
시작 소스 archive SHA-256:
`ca1dd449a1d093855c756d716f6d2acecc03b197c1a2eb12edb687e2df11ec7b`.
원본 루트·이전 보관본을 변경하지 않는다.

## 변경 계약과 범위

- ACQ-01: 공개 대표명 **오늘뭐먹지**를 유지하고 **FridgeMate**가 같은 서비스임을 헤더·푸터·소개에
  표시한다. 홈의 기존 첫 식단 CTA는 유지하며 소개 본문에도 `/meal-plan`과 `/recipes` 시작 링크를 제공한다.
- 소개는 성인 1~2인의 날짜·인원·제외 재료 선택 → 초안 확인·확정 → 부족분 확인 → 실제 입고·조리로
  연결한다. 재료 미등록을 미보유로 단정하지 않으며 식단 확정만으로 재고가 차감되지 않음을 설명한다.
- 홈·소개 메타를 이 흐름에 맞춘다. 초기 HTML과 클라이언트가 갱신하는 홈 title/description/OG/canonical을
  대조한다. `WebSite.alternateName`은 이미 있었으므로 새로 추가했다고 하지 않는다. 기존 대표명·별칭,
  `og:site_name`, 원문 Recipe schema와 공개 경로 113개를 유지한다.
- 미검수 분량·정량 영양·알레르기 안전성·AI 효과·절약 성과를 새로 약속하지 않는다.
  주간 식단·입고·조리 이력의 브라우저 로컬 저장, 자동 동기화 부재, 데이터 삭제 시 손실 가능성을 안내한다.
- 서버·인증·DB·카탈로그·계산·광고·분석/파일럿 수집 정책·의존성·배포 설정은 이번 단계에서 변경하지 않는다.

디자인 스킬에 따라 기존 녹색/흰색 토큰·글꼴·PageHeader를 유지했다. 소개의 순서는 세 개의 판촉 카드가
아닌 하나의 실제 사용 순서 목록으로 표현한다. React 지침에 따라 새 상태·효과·의존성 없이 정적 화면과
기존 라우트 링크를 사용한다. 390px/1280px 화면과 키보드 시작을 확인한다. 실기기 접근성 인증은 아니다.

## 실패 재현과 검증

변경 전 전체 기준선 `unit-baseline-01`: **232파일 / 2,988개 통과**, 실패·skip·todo 0.
실제 실행 목록은 이 작업트리 안이며 중첩 `.worktrees/**`를 제외했다.

- `unit-metadata-red-01`: 기존 2개 통과, 신규 1개는 초기 HTML description/OG description과
  클라이언트 갱신 결과가 다르다는 assertion으로 실패했다. `hydrateRoot` 자체의 검사는 아니다.
- `e2e-introduction-red-01`: 모바일/데스크톱 2개 모두 소개 본문의 식단 시작 링크 부재로 실패했다.
  import 오류나 환경 오류를 기능 RED로 세지 않는다.
- `unit-metadata-green-01`: 메타·schema·서버 렌더 집중 검사 통과.
  `e2e-introduction-green-01`: 소개에서 키보드로 진입해 가입·재고 등록 없이 2인/선택일 초안→확정까지
  2개 통과. 재고·인증 저장소 불변과 개인 경로 noindex/JSON-LD 제거를 확인했다.
- ACQ-02 신규 보호 검사는 실제 재고 편집폼의 이름·양·메모·날짜와 식단의 제외 재료·인원·선택일을
  먼저 확인한다. 식단은 실제 생성·저장·재로드를 거친다. 홈에 개인 재고가 표시되는 것을 확인한 뒤
  홈·소개·공개 레시피의 head 및 원본 응답에 개인 표식이 없는지 확인한다.
  개발 서버의 빈 shell과 preview의 실제 `/_seo` 생성 HTML을 구분하고, preview에서는 본문·schema가
  존재하는 것을 먼저 확인한다. preview의 호스팅 rewrite나 로그인 계정 응답을 검증한 것은 아니며,
  `noindex`를 접근 권한 통제나 인증의 대체 수단으로 취급하지 않는다.
- `e2e-privacy-check-01/02`는 메모 textarea와 인원 select의 잘못된 exact label 선택자 때문에 실패했다.
  접근성 role/name으로 보정한 `03`은 통과했다. 앱이나 기존 assertion을 바꾸거나 제한 시간을 늘리지
  않았다. 이 두 실패는 제품 RED가 아닌 테스트 준비 오류다.
- 첫 전체 `unit-final-01`은 **2,988통과/1실패**다. 기존 지난 끼니 조회 검사에서 로딩 중 기본 대기 시간을
  넘었다. 해당 테스트·구현은 시작본과 같으며 `unit-overdue-check-01` 집중 재실행은 통과했다.
  첫 실행은 lint/build/브라우저와 겹쳤지만 이것만으로 부하가 원인이라고 확정하지 않는다.
  무거운 다른 검사를 분리한 `unit-final-02`에서도 같은 한 건이 실패했다. 독립 읽기 검토에서 이번
  변경의 화면·메타가 이 테스트에 렌더되지 않으며 해당 테스트·페이지·공지·hook·DB·저장소·설정이
  시작본과 같은 것을 확인했다. StrictMode의 무시된 요청과 revision 변경으로 여러 전체 주 조회가
  생기지만 어느 대기 구간이 원인인지는 계측하지 않았으므로 원인 미확정으로 남긴다.
- 같은 소스·assertion·제한 시간으로 CLI에만 `--maxWorkers=2`를 지정한 `unit-bounded-final-03`은
  **232파일 / 2,989개 통과**, 실패·skip·todo 0이다. 프로젝트 테스트 설정은 바꾸지 않았다.
  **기본 작업자 수의 전체 실행이 안정화됐다는 뜻은 아니다.** 두 기본 실행의 실패를 이 결과로 덮지 않는다.
- 첫 전체 검사 도중 ACQ-02 선택자를 보정했으므로 `tested-code-01` 대신 `02`로 최종 코드 601파일을
  다시 고정한다. 두 manifest의 차이는 신규 E2E 선택자뿐이며 이전 실패 로그도 보존한다.

| 검사 | 최종 결과와 범위 |
| --- | --- |
| `unit-bounded-final-03` | **232파일 / 2,989개 통과**, `--maxWorkers=2`. 기본 작업자 수 실패는 위와 별개 |
| `lint-final-02`, `build-final-02` | 종료 코드 0. 공개 정적 경로 113개·사이트맵·noindex 앱 셸 통과 |
| `e2e-final-02` | **13파일 / 107개 통과**: local-only 77 + 모의 API 30 |
| `built-final-02` | 실제 local-only 빌드의 **5파일 / 48개 통과** |

브라우저 최종 검사는 skip·flaky·자동 재시도·report error 0이다. preview 48개는 기존 흐름의 다른
실행 방식이므로 107+48을 155개의 서로 다른 검사로 세지 않는다. 기존 단위 2,988개·개발 브라우저
104개·preview 45개의 파일/프로젝트/검사 이름이 보존됐음을 대조했다. 기존 서버 검사 하나의 이름에 들어가는
실행 시각만 정규화하며 검사 본문·기대값은 그대로다. 최종 검사 전후 코드·설정·자산 601파일의 해시를
대조해 변하지 않았음을 확인했다. 기존 React act 및 NO_COLOR 경고는 남아 있다. 무경고 통과나 기본 전체 단위 검사 통과로
표현하지 않는다. 개발 서버와 최종 빌드의 390px/1280px 소개 화면도 직접 확인했다.

이번 변경 **11파일**: 앱/HTML 5개(`AboutPage.jsx`, `Header.jsx`, `SiteFooter.jsx`, `routeMetadata.js`,
`index.html`), 검사 3개(`RouteMetadata.test.jsx`, `e2e/meal-plan.spec.js`, `e2e/public-recipes.spec.js`),
문서 3개(README·CHANGELOG·이 문서)다. 누적 변경은 **202파일**, 삭제는 없다.
기존 홈 구현·구조화 데이터 생성기·서버·계산·설정은 이번 단계에서 바꾸지 않았다.

## 실제 공개 HTTP와 검색 관측

2026-09-28 **23:25 KST** 전후, 로그인·쿠키 없는 GET으로 `/`, `/about`, `/meal-plan`, `/robots.txt`,
`/sitemap.xml` **5개가 모두 HTTP 200**임을 확인했다. 사이트맵에는 113개 URL이 있었다.
홈과 소개는 여전히 기존 냉장고/단일 메뉴 설명이고, 식단 응답에는 `X-Robots-Tag: noindex, nofollow,
noarchive`와 noindex 메타가 있었다. **이번 로컬 변경은 운영에 반영되지 않았다.**
홈/about의 `hasMealPlanLink`는 공통 내비게이션도 포함하므로 새 본문 CTA가 배포됐다는 증거가 아니다.
웹 열기 도구는 두 URL에 Internal Error를 반환했으나 위 직접 HTTP 조회가 성공했다. 도구 오류를
사이트 장애로 보고하지 않는다. 이는 113개 전체 URL이나 실제 서버 로그인 검사가 아니다.

같은 날 **23:29 KST** 전후 웹 검색 도구로 아래 쿼리를 각각 조회했다.

| 쿼리 | 반환 결과에서 확인한 범위 | 실제 유입 |
| --- | --- | --- |
| `오늘뭐먹지` | 다른 동명 서비스·콘텐츠가 반환됐고 대상 도메인은 확인하지 못함 | 미확인 |
| `오늘 뭐 먹지` | 메뉴·레시피·언어 관련 결과가 반환됐고 대상 도메인은 확인하지 못함 | 미확인 |
| `dhsmfanjajrwl` | 관련 없는 결과가 반환됐고 대상 도메인은 확인하지 못함 | 미확인 |
| `"FridgeMate" "오늘뭐먹지"` | 도구가 빈 결과라고 보고 | 미확인 |

도구의 반환 결과는 특정 지역·기기에서의 Google 검색 순위나 미색인 증명이 아니다. Search Console의
노출·클릭·검색어별 유입, 실제 소개→식단 확정 전환은 확인하지 않았다. 오타 문자열을 페이지에 넣거나
색인 요청·재심사·광고 캠페인을 실행하지 않았다. ACQ-03은 제한된 관측 기록이며 ACQ-04는 계속 남는다.
관측 쿼리·반환 URL 목록·시각과 HTTP 메타/본문 해시는 보관본 validation의 JSON에 남긴다.

[Google 사이트 이름 공식 안내](https://developers.google.com/search/docs/appearance/site-names)에 따라
화면과 구조화 데이터의 명칭을 일관되게 유지하며 기존 WebSite 노드를 중복 생성하지 않는다.
표시 이름의 최종 선택은 검색엔진의 자동 처리이므로 코드 변경만으로 노출 이름·순위를 보장하지 않는다.

## 실행·보관·남은 목표

Node 24.19.0, macOS arm64, 기존 설치 의존성을 사용한다. 실행기는 허용한 환경 변수만 전달하고
운영 API·광고·외부 분석·Sentry를 비활성화한다. API 모드 E2E는 모의 응답이다.

```sh
npm run test:run -- --exclude '.worktrees/**'
# 위 기본 실행은 이 단계에서 1건 시간 초과가 재현됨. 조건 비교 전수 검사는 다음과 같음:
npm run test:run -- --exclude '.worktrees/**' --maxWorkers=2
npm run lint
VITE_API_URL= VITE_API_URL_OVERRIDE= VITE_API_BASE_URL= VITE_ADSENSE_VERIFICATION_ENABLED=false VITE_ADSENSE_SERVING_ENABLED=false VITE_GA_MEASUREMENT_ID= VITE_SENTRY_DSN= npm run build
npm run test:e2e -- --workers=2 --retries=0
npm run test:e2e:preview -- --workers=2 --retries=0
git diff --check
```

고유 로그/JSON/trace 경로를 지정하는 실제 runner는 `/private/tmp/fridgemate-public-intro-MkFU4bFO/run.mjs`다.
최종 보관은 인접 `../prd-v3-public-intro-evidence-20260928`로 하며 현재 폴더에 덮어쓰지 않는다.
기준 HEAD의 별도 깨끗한 checkout에 `starting197-source-files.tar.gz` 또는 최종 `source-files.tar.gz`
하나만 적용하고 대응 `source-manifest.json`/`starting197-manifest.json`의 파일 SHA를 확인한다.
`.env`·개인 키·사용자 DB·node_modules는 포함하지 않는다. 원본 루트는 status 목록 해시만 대조한다.

기본 작업자 수의 전체 단위 검사에서 지난 끼니 조회 시간 초과 원인을 재현·계측해야 한다.
메뉴 20~30개 검수와 과정 물/단품 범위 결정, 전체 실기기·저장 장애·OCR 품질·성능 QA, 실제 Linux CI·
독립 서버 설치·Prisma 쿼리/트랜잭션·운영 인증 검증, 승인 후 10~20명·4주 파일럿이 계속 남는다.
로컬 보관·수동 내보내기·35일 후 다음 접근 시 삭제·분석 실패에도 조리/입고 보존 정책은 유지한다.
후속 예산·선호 확장·공유·사업 목표도 완료로 바꾸지 않는다. commit/push/PR/병합/배포/모집은 하지 않았다.
