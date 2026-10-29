# PRD v3 — 키보드·상태 알림 접근성 보강

작업일: 2026-09-28. 전용 작업트리 `prd-v2-recovered-20260919`, HEAD
`b6e3f10480df1cddf9ff005b44f99698befe4c86`.
시작점은 새 설치 단계의 변경/미추적 177파일이며 보관본 SHA-256은
`8f77f0c608abe9086b845460e8218649c36c93b40e80afcaa704e5d3c5ab35e4`다.
원본 루트와 이전 보관본은 실행·수정 대상으로 사용하지 않는다.

## 결과와 범위

키보드로 본문·사진 선택·분석 설정에 접근하고, 재고 수량과 장보기 메모를 저장한 뒤에도
작업 위치를 이어갈 수 있게 했다. 기존 녹색·슬레이트·흰색과 서체를 유지하며 전체 디자인을
바꾸지 않는다. 동의 전 분석 차단, 실제 수량 계산, 저장 트랜잭션, 원문 재료와 파일럿 보관
정책은 유지한다. 이것은 전체 WCAG 적합성, 실기기·스크린리더 또는 운영 배포 완료가 아니다.

- `AppShell`, `Header`: 본문 바로가기, 초점을 받을 수 있는 main, 시각적 활성 상태와 같은
  경로 규칙의 `aria-current`. 작은 활성 메뉴 글자의 배경 대비를 보강한다.
- `AnalyticsConsentBanner`: 명시적 설정 열기에서 초점 이동, 저장 성공 시 원래 버튼 또는
  main 복귀. 최초 안내·저장 실패·사용자가 다른 곳으로 이동한 경우에는 초점을 빼앗지 않는다.
  모바일 본문을 덮던 고정 배너는 footer 다음 일반 문서 영역으로 옮겼다. 거절과 허용을 모두
  제공하고 기존 동의 없는 상태를 자동 변경하지 않는다. 모달·초점 가두기를 추가하지 않는다.
- `index.css`: 동작 줄이기 설정에서 식단 페이지 밖의 부드러운 문서 스크롤도 해제한다.
- OCR `UploadBox`, `ParsedItemEditor`, `OcrResultPanel`, `ImportPage`: 실제 파일 입력을 Tab과
  Enter로 사용할 수 있게 하고 초점 테두리를 제공한다. 같은 이름의 후보도 순번으로 구분한다.
  인식 진행률·완료·빈 결과·오류를 구분하며 OCR 원문을 live region에서 읽지 않는다.
  인식 상태와 가져오기 저장 결과를 서로 다른 이름의 status로 구분한다.
- `useSavedFormFocus`, `InventoryQuantityReview`, `ShoppingNotesPanel`: 저장 후 폼 초기화로
  사라진 초점을 영역 제목으로 복원한다. 기다리는 동안 다른 컨트롤로 이동했거나 계정·컨텍스트가
  바뀌면 복원하지 않는다. 실제 입고 후 부모 목록 갱신으로 폼이 재생성되는 경우도 포함한다.
- `MealCookingForm`, `MealConsumptionCorrectionForm`와 폼 helper: 오류가 난 재고 ID·입력 종류를
  전달해 해당 입력에 초점·오류 설명을 연결한다. 같은 이름의 재고를 구분하고 기존 양 검증을 유지한다.
  `MealPlanChangePanel`은 변경안 준비/적용할 변경안 없음 상태를 알린다.
- `LoginPage`, `SignupPage`, `AccountPage`, `AccountPrivacyPanel`, `MealPlanPilotPage`: 인증·동기화·
  개인정보 작업의 오류/진행 상태와 파일럿 상태 변경을 알린다. 로그인 입력의 자동완성 의미를
  명시하고 개인정보 내보내기/삭제의 중복·경쟁 제출을 막는다. API·권한·삭제 확인 정책은 유지한다.

TDD 지침에 따라 동작 실패를 먼저 기록하고 최소 변경을 적용했다. React 지침은 임시 초점/중복
제출 표식을 ref로 관리하고 업무 요청을 이벤트 처리에 유지하는 데 적용했다. 디자인·웹 지침은
기존 화면을 유지하면서 초점 표시, 가림 방지, 상태 의미를 보강하는 데 적용했다.

## 실패 재현과 중간 결과

착수 시 새 전체 기준선은 **226파일 / 2,922개 통과**다. 시작 보관본의 177개 해시를 확인했다.

| 기록 | 실제 결과와 해석 |
| --- | --- |
| `e2e-keyboard-red-02` | 본문 건너뛰기·활성 경로 중복·설정 초점·사진 선택의 실제 동작 4개 실패 |
| `unit-ocr-red-02`, `unit-consent-red-01` | OCR 상태/후보 식별과 동의 초점 경계 실패. 후속 집중 검사 통과 |
| `meal-red-01`, `meal-receipt-red-02` | 저장 후 초점·잘못된 입력 위치·변경안 알림 11개, 실제 입고 갱신 후 초점 2개 실패 |
| `meal-green-06` | 관련 13파일 157개 통과. 새 17개 중 13개는 RED 재현, 4개는 기존 동작 보호 |
| `unit-auth-red-01`, `unit-status-red-01` | 인증/개인정보/동기화/파일럿 알림과 중복 제출 실패를 재현 |
| `e2e-visual-red-01` | 활성 메뉴 글자 대비 3.2957:1로 4.5:1 기준 미달. 첫 식단 버튼 가림 검사는 처음부터 통과한 보호 검사 |
| `e2e-tab-occlusion-red-01` | 모바일 본문 Tab 이동 중 고정 동의 배너가 컨트롤을 덮음. 초기 본문 로딩을 기다리지 않은 skip-link 검사는 준비 오류로 별도 구분 |
| `unit-consent-focus-red-02` | 새 초점 처리의 최초 동의 저장 실패 시 버튼 초점 이탈을 추가 재현. 명시적 열기 의도로 한정 후 10개 통과 |
| `e2e-motion-red-01` | reduced-motion에서 문서 스크롤이 smooth로 남는 문제. 이후 auto 확인 |
| `unit-status-role-red-01` | 새 안내 2곳의 paragraph에 이름만 부여했던 ARIA 문제. 올바른 named status 검사로 13통과/3실패 확인 |
| `unit-status-role-green-01` | 명시적 status 역할 수정 후 기존 가져오기/파일럿 결과 검사를 함께 실행해 5파일 59개 통과 |
| `e2e-keyboard-green-03` | 키보드·모바일·대비·동작 줄이기·실제 저장 후 초점 등 10개 통과 |

최초 내비게이션 검사에서 장식 아이콘까지 text로 비교한 테스트 가정과 OCR의 label 기반 검사도
별도로 바로잡았다. 잘못된 준비·선택자·관측으로 실패한 것을 제품 RED에 합산하지 않는다.
기존 가져오기·다운로드 assertion은 제거하지 않고 결과 안내의 접근성 이름으로 대상만 명확히 했다.
상태 이름은 paragraph가 아닌 status에 붙여야 한다는 근거는 [WAI-ARIA paragraph](https://www.w3.org/TR/wai-aria-1.2/#paragraph)와
[status 역할](https://www.w3.org/TR/wai-aria-1.2/#status)이다. 실제 스크린리더의 발표까지 확인한 것은 아니다.

## 최종 검증

문서·환경파일을 제외한 실제 프로젝트 코드/설정/자산 **598파일**의 해시를 고정한 뒤 최종 검사를
다시 실행했고 종료 후 일치함을 확인했다. `.worktrees/**`는 단위 테스트 실행에서 제외한다.

| 검사 | 결과 |
| --- | --- |
| `unit-final-02` | **229파일 / 2,956개 통과**, 실패·skip·todo 0 |
| `lint-final-02`, `build-final-02`, `git diff --check` | 통과. 공개 경로 113개·사이트맵·noindex app shell 포함 |
| `e2e-final-01` | **13파일 / 101개 통과**: local-only 74, 모의 API 27 |
| `built-final-01` | 실제 local-only dist의 **5파일 / 45개 통과** |
| `visual-preview.json` | 390px·1280px에서 분석 설정 열기→초점·두 선택 버튼 가림 없음·가로 넘침 없음·미동의 유지 |

기존 단위 검사 2,922개와 개발 서버 브라우저 91개·preview 35개가 최종 목록에 유지되는지 대조한다.
기존 서버 검사 하나의 Date 기반 제목은 실행 시각만 정규화한다. 새 단위 34개, 브라우저 10개이며
preview는 같은 흐름의 다른 실행 방식이다. **101+45를 서로 다른 146개 검사로 세지 않는다.**
모든 최종 브라우저 검사는 skip·flaky·자동 재시도·report error 0이다.

독립 읽기 검토에서 새 ARIA 역할 오류를 발견해 위 RED/GREEN으로 보완했고, 수정 후 명백한
새 정책 회귀를 찾지 못했다. 그 자체가 전체 안전성 증명은 아니다. 기존 React act/NO_COLOR
경고가 있으며 무경고 통과라고 기록하지 않는다.

추가 시각 검사 첫 시도는 E2E 완료로 preview 서버가 이미 종료된 뒤 접속해 connection refused로
끝났다. 실제 프로세스 종료를 확인한 뒤 별도 preview 서버를 열어 다시 검사하고 종료했다.
제품 오류나 E2E 실패를 숨긴 재시도가 아니다. 390px 사진 입력 초점과 홈 첫 행동, 두 크기의
동의 안내 스크린샷을 직접 확인했다. 모바일 viewport는 실제 휴대전화 검증이 아니다.

## 실행·변경·복원

Node 24.19.0, 기존 설치 의존성, macOS arm64의 전용 작업트리에서 실행한다.
검사 runner는 자식 환경을 허용 목록으로 만들고 운영 API·광고·분석·Sentry를 비활성화한다.
운영 DB·모델 API·실제 로그인 서버는 호출하지 않는다.

```sh
npm run test:run -- --exclude '.worktrees/**'
npm run lint
VITE_API_URL= VITE_API_URL_OVERRIDE= VITE_API_BASE_URL= VITE_ADSENSE_VERIFICATION_ENABLED=false VITE_ADSENSE_SERVING_ENABLED=false VITE_GA_MEASUREMENT_ID= VITE_SENTRY_DSN= npm run build
npm run test:e2e -- --workers=2 --retries=0
npm run test:e2e:preview -- --workers=2 --retries=0
```

실제 실행은 `run.mjs`로 각 명령에 새 JSON/log/trace 경로를 부여했다. 브라우저 두 모드는
순서대로 실행한다. 단위 테스트는 기존 검사 기대값을 새 정책에 맞춰 일괄 변경하지 않는다.

이번 단계는 앱·검사·설정 **40파일**과 README·CHANGELOG·이 문서 **3파일**, 총 **43파일**이다.
신규 코드/검사는 `useSavedFormFocus.js`, `e2e/accessibility.spec.js`,
`AccountPrivacyPanel.accessibility.test.jsx`, `OcrAccessibility.test.jsx`, `AuthFeedback.test.jsx`다.
전체 변경 상태는 기존 작업을 포함해 **193파일**이며 삭제는 없다.

인접 보관 폴더 `../prd-v3-accessibility-evidence-20260928`에 다음을 보존한다.

- `source-files.tar.gz`, `source-manifest.json`, `tracked.patch`: 기준 HEAD 위에 적용할 최종 변경 상태.
- `starting177-source-files.tar.gz`, `starting177-manifest.json`: 이번 단계 전 상태. 이전 보관본도 유지.
- `validation/`: 기준선·RED·중간·최종 JSON/log/trace/스크린샷, 실행/해시/보관 스크립트.
- `phase-summary.json`: 이번 변경 목록·검사 집계·테스트 목록 보존·archive 해시.

복원 시 별도의 깨끗한 checkout을 기준 HEAD에 맞춘 뒤 시작/최종 archive **하나만** 적용하고
대응 manifest의 파일 해시를 확인한다. 현재 작업트리·원본·기존 보관본에 덮어쓰지 않는다.
환경파일·개인 키·DB·사용자 기록·node_modules는 archive에 포함하지 않는다. 원본 루트는
status 목록 해시가 같음을 확인하며 이것을 루트 전체 내용의 해시 검증으로 과장하지 않는다.

## 아직 남은 전체 목표

- 스크린리더·실기기·타 브라우저·확대/강제 색상·앱 전체 오류/저장 실패 QA, 실제 OCR 인식 품질.
  이 단계의 키보드 회귀 통과를 전체 접근성 또는 WCAG 인증으로 표현하지 않는다.
- 실제 성능 측정과 30개 검수 메뉴 조건. 이번에는 성능 trace를 측정하지 않았다.
- 검수 메뉴 20~30개, 과정 물 등의 수용 기준 결정. 편집 16개+재료량 대조 6개를 완료 22개로 세지 않는다.
- 실제 Linux CI, 운영 호스팅/응답 헤더, Prisma 실제 쿼리·트랜잭션 호환성, 독립 server 설치 계약.
- 개인정보 export의 늦은 응답/계정 전환 처리, 로그인/회원가입의 동기 중복 제출 등 미보강 경계.
  이미 전송된 요청·저장 작업·늦은 서버 쿠키까지 되돌리는 보장은 없다.
- 승인 후 10~20명·4주 실사용 파일럿. 로컬 보관·수동 다운로드·35일 후 다음 실행 정리·분석 실패에도
  조리/입고 보존 원칙을 유지한다. 공개 소개/검색 유입, 이후 예산·개인화·공유 등 목표도 유지한다.
- 커밋·푸시·PR·병합·배포·참여자 모집은 수행하지 않았다.

추가 참고: [W3C Focus Order](https://www.w3.org/WAI/WCAG22/Understanding/focus-order.html),
[Contrast Minimum](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html),
[검토한 웹 인터페이스 지침](https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md).
