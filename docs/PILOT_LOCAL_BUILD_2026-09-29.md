# local-only 파일럿 구현·검증·배포 준비

기준: `4c6e73062358f5e164f91eec078bc7e10a45322c` 이후의 로컬 변경, `codex/prd-v2-recovered-20260919` 작업 트리. [승인된 메뉴 정책과 원격 배포 사전 점검](PILOT_MENU_REVIEW_POLICY_2026-09-29.md)을 구현한다. 이 문서는 운영 출시나 실제 참가 URL 개설을 선언하지 않는다.

## 구현 경계

- `VITE_LOCAL_PILOT_ENABLED=true`를 명시한 빌드에서만 새 식단 후보 정책을 적용한다. 분석 동의와 관계없으며, 일반 빌드의 22개 카탈로그와 조회 API는 유지한다.
- 신규 생성·교체·건너뛰기 해제·남은 식단 재조정은 공통 정책에서 후보를 고른다. 승인된 6개 ID라도 원문 대조 등급·기준 인분·단품/main 역할·주식·필수 식재료량 근거가 부족하면 제외한다. 미검수 메뉴를 자동 보충하지 않는다.
- 과거 식단을 읽는 것만으로 새 정책을 상속하거나 데이터를 다시 쓰지 않는다. 잠금·조리 완료·지난 확정 끼니와 원문 행을 보존한다. 명시적 신규 재추천에서는 바꿀 수 있는 날짜만 현재 정책의 후보로 선택한다.
- 새 파일럿 생성/재조정의 `generationInput.candidatePolicy`는 나중에 같은 후보 정책으로 재생하기 위한 기록이다. 알 수 없는 정책은 새 후보를 허용하지 않는다. 저장소 스키마를 바꾸거나 기존 계획에 일괄로 값을 추가하지 않는다.
- 건너뛴 기존 편집 메뉴를 다시 포함할 때 후보가 없다면 기존 상태를 유지한다. 화면도 포함 성공으로 안내하ㅊ지 않고 검수 기준과 제외 조건을 확인하도록 한다.
- 화면에서 원문 식재료량 대조 / 편집 조합 / 미검수를 구분한다. 정량 행 61개, 별도 미정량 과정 물 13개와 원문의 추가 기름·조리 설명을 바꾸지 않는다. 모든 조리 투입량 확인·영양 검수·실제 재고 충분을 보장하지 않는다.

## local-only 방어

파일럿 빌드는 서버 주소와 운영 도메인 기본값을 사용하지 않는다. 직접 API 호출도 네트워크 실행 전에 거절한다. 일반 분석에 동의했거나 빌드 환경에 기존 값이 남아 있어도 GA·Sentry·광고·외부 AI·원격 OCR 보정 학습을 활성화하지 않는다. 브라우저 OCR과 로컬 수동 JSON 내보내기는 유지한다.

이 방어는 브라우저 앱과 빌드 경계의 제한이지 OS·브라우저 확장·사용자 코드까지 격리하는 샌드박스가 아니다. 원격 정적 레시피 이미지 등 데이터 API와 무관한 통신까지 전혀 없는 오프라인 앱을 뜻하지 않는다. 서버 인증·RLS·Hyperdrive 검증을 완료한 것도 아니다.

## 로컬 실행과 별도 설정 파일

명령은 원본 루트가 아니라 이 변경이 있는 작업 트리에서 실행한다. 기존 의존성을 사용하며 새 패키지를 추가하지 않는다. 빌드와 설정 생성은 배포 명령이 아니다.

```bash
npm run test:run -- --exclude '.worktrees/**'
npm run lint
npm run build
npm run test:e2e -- --workers=2 --retries=0
npm run test:e2e:preview -- --workers=2 --retries=0
npm run build:pilot
npm exec playwright test -- --config playwright.pilot.config.js --workers=2 --retries=0
```

일반 빌드 `dist/`와 파일럿 `dist-pilot/`은 별개다. 파일럿 wrapper는 빌드에 필요한 환경만 전달하고 API·계측·외부 AI 설정을 고정한다. 기존 `.env`를 수정하지 않으며 파일럿 Vite 설정은 dotenv 자동 입력을 사용하지 않는다. dotenv에만 파일럿 플래그가 있으면 산출물·런타임·후처리 모드가 달라질 수 있으므로 명시 오류로 중단하고 `npm run build:pilot` 사용을 안내한다. `VERCEL_ENV` 또는 `VERCEL_TARGET_ENV`가 Production이면 파일럿 빌드를 시작하지 않는다. 운영 배포를 할 권한을 가진 사람이 다른 명령·산출물로 우회하는 것까지 막는 보안 장치는 아니다.

Preview 전용 설정 파일은 아직 없는 출력 파일에 생성한다. 기존 운영 `vercel.json`을 덮어쓰지 않는다.

```bash
node scripts/prepare-pilot-preview.mjs --output /private/tmp/fridgemate-pilot-preview.vercel.json
```

위 출력 경로가 이미 있으면 다른 새 이름을 사용한다. 설정 파일은 `build:pilot`, `dist-pilot`, 운영 리다이렉트 제거, 전체 noindex 및 외부 API·분석 주소를 허용하지 않는 CSP를 포함한다. 기존 개인/공개 경로 rewrite는 보존한다.

**별도 파일은 현재 자동 Git Preview에 자동 적용되지 않는다.** Vercel은 CLI의 `--local-config`로 별도 설정 파일을 지정할 수 있지만, 실제 프로젝트·Preview 대상·환경·할당 URL과 보호 설정을 확인하고 별도 배포 단계에서 적용해야 한다. 이 단계에서는 CLI 설치·배포·도메인 연결·원격 환경변수 변경을 하지 않는다. [Vercel 공식 local config 설명](https://vercel.com/docs/cli/global-options#local-config)

이 설정은 Build Output API 산출물이 아니므로 `--prebuilt`로 배포하는 방식이 아니다. 로컬 산출물을 확인했다는 것과 Vercel이 같은 설정으로 배포했다는 것을 구분한다.

## 참가 주소와 업데이트 절차

1. 현재 운영으로 이동하는 자동 Preview를 참가자에게 안내하지 않는다. 운영 main 병합과 도메인 자동 연결은 그대로 유지돼 있으므로 PR 병합도 별도로 판단한다.
2. 비운영 검증 배포에 파일럿 전용 설정을 적용하고 원격에서 `/pilot`, `/meal-plan`, `/ingredients`, `/import` 및 공개 안내의 직접 접근·새로고침·헤더·실제 404·외부 요청을 확인한다. 로컬 `vite preview`는 Vercel의 redirect/headers/rewrites를 재현하지 않는다.
3. 검증 후 고정된 참가 브랜치 URL 또는 승인된 고정 alias를 확정한다. CLI 배포가 브랜치 URL을 자동으로 제공한다고 가정하거나 URL을 조합해 만들어내지 않는다. 배포 화면에서 실제 연결 대상을 확인한다.
4. 참가 중에는 같은 origin을 유지한다. 별도 검증 후 참가 주소로 승격하는 업데이트 절차를 정한다. 자동 최신 배포로 전환되는 브랜치에 미검증 변경을 직접 push하지 않는다.
5. 합성 데이터로 이전 버전 → 새 버전 → 롤백의 저장소 호환성을 확인한다. 단순 새로고침과 이전 스키마 fixture 열람 검사는 실제 배포 교체·롤백 검증을 대신하지 않는다. 코드 롤백으로 브라우저 DB가 되돌아가지는 않는다.

## 남은 출시 검증

- 실제 Preview 배포, 고정 참가 URL, 배포 보호/접근 방식, 원격 CSP·noindex·리다이렉트 스모크.
- 실제 이전/새 빌드 교체와 롤백, 실기기·다른 OS 브라우저.
- 실제 영수증·주문 캡처 10~20장의 OCR 정답 대조 및 수정률. 합성 OCR 검사를 실측으로 부르지 않는다.
- 수동 JSON 전달 채널·담당자·내보낸 사본 보관/삭제 절차. 앱의 35일 다음 실행 정리는 이미 전달한 사본을 지우지 않는다.
- 추가 메뉴 검수, 적격 메뉴 30개·재고 200개 성능 조건. 이번 후보 제한을 메뉴 검수 확대 완료로 세지 않는다. 이유 선택 UI는 [10월 4일 후속 구현·검증](PILOT_REASON_INSTRUMENTATION_2026-10-04.md)에서 완료했다.

원본 루트의 기존 변경, 데이터 원문·별칭·점수 가중치, 서버·DB·인증 정책, 의존성/lockfile과 운영 배포 설정은 이번 범위에서 바꾸지 않는다. 파일럿 빌드에 한정된 클라이언트 API 차단은 위에 별도로 기록한다.

## 이번 실행 결과

2026-09-29 KST, macOS arm64 / Node 24 / 기존 설치 의존성. 최종 코드 보완 후 다시 실행했다. 이전 보고의 3,001개 결과를 재사용한 것이 아니다.

| 검사 | 최종 결과 | 증거 파일 접두사 |
|---|---|---|
| 전체 단위·통합 | 239파일, **3,074/3,074 PASS**, 실패·pending 0 | `unit-final-02` |
| 전체 lint | exit 0 | `lint-final-02` |
| 일반 빌드 + OCR/SEO 후처리 | exit 0, OCR 자산 7개, 공개 경로 113개·사이트맵·noindex 앱셸 검사 통과 | `build-final-02` |
| 기존 개발 서버 브라우저 | **107/107 PASS** | `e2e-final-02` |
| 일반 실제 빌드 브라우저 | **48/48 PASS** | `built-final-02` |
| 파일럿 빌드 + OCR/SEO 후처리 | exit 0, 별도 `dist-pilot` 및 동일 후처리 통과 | `pilot-build-final-02` |
| 파일럿 실제 빌드 브라우저 | **4/4 PASS** | `pilot-e2e-final-04` |

브라우저 검사 모두 retry 0, skipped/unexpected/flaky 0, 실행 오류 없음. 48개는 기존 검사의 빌드 환경 재검증이므로 107개에 더해 고유 사용자 시나리오 수로 표시하지 않는다. 단위 JSON에 기록된 239개 실제 파일 경로가 모두 이 작업 트리 아래에 있고 하위 `.worktrees/**` 결과가 없음을 확인했다. 일반 빌드와 파일럿 빌드는 각각 다른 산출물로 검사했다.

파일럿 브라우저 4개는 다음 경계를 확인했다.

1. 일반 분석·파일럿 기록에 동의하지 않아도 6개 후보로 생성·교체·고정·재추천·재로드 가능. 미정량 과정 물/검수 범위를 유지하고 재고는 변경하지 않음.
2. 합성 이전 편집 조합 식단을 자동 마이그레이션 없이 열람. 명시적 재추천에서도 잠금·기존 확정본 유지, 바뀌는 날만 새 후보 적용.
3. 별도 기록 동의·명시적 재개 후 실제 파일 다운로드와 기존 JSON 검증기로 수동 내보내기 확인. 일반 분석 동의는 변경하지 않음.
4. 합성 과거 인증/분석 동의가 있는 브라우저에서도 API·GA·광고·Sentry 등의 금지 요청 0. 상대 `/auth/*`를 포함한 비정적 fetch/XHR도 검사. 모든 원격 요청은 테스트에서 차단했으며 원격 서비스를 실제 검증한 것이 아님.

390px 모바일 스크린샷을 직접 확인했고 가로 넘침 검사를 통과했다. 실기기·다른 OS 검증이나 실제 배포 교체/롤백의 대체 증거는 아니다.

### 실패 증거와 환경 오류의 구분

TDD 절차로 기능별 assertion 실패를 확인하고 구현했다. 메뉴 제한/기존 기록 보존, 검수 UI, 후보 0개 복원 안내, 런타임 외부 요청 차단, 빌드 환경/Production 거절/기존 파일 보존에 대한 RED→GREEN을 보존했다. React 지침에 따라 빌드 여부는 기존 화면에서 직접 도출하며 이를 위한 새 Effect나 동기화 상태는 추가하지 않았다.

- 런타임 첫 검사 `unit-deploy-runtime-red-01`: 6 PASS / 10 예상 assertion FAIL.
- 실행 가능한 빌드 경계 `unit-deploy-build-behavior-red-02`: 5 PASS / 6 예상 assertion FAIL. 외부 proxy rewrite `unit-deploy-proxy-red-03`: 2 예상 assertion FAIL.
- `.env` 단독 플래그의 모드 불일치: 합성 임시 dotenv로 `unit-deploy-dotenv-red-01`의 13 PASS / 1 예상 assertion FAIL을 확인한 뒤 명시적 오류를 구현했다. 최종 집중 `unit-deploy-dotenv-green-01`은 9파일 58 PASS다.
- 최초 `unit-deploy-build-red-01`에 포함된 진입점 미존재 7개 실패는 정책 불일치 재현으로 세지 않았다. 위 실행 가능한 경계 검사로 별도 확인했다.
- 첫 파일럿 브라우저 실행 `pilot-e2e-pilot-01`은 preview listen `EPERM`으로 실제 테스트 전에 중단됐다. 제품 실패/RED로 세지 않고 로컬 소켓 권한을 받아 재실행했다.
- 첫 파일럿 빌드는 exit 0이었지만 기존 SEO SSR의 HMR 소켓 `EPERM` 경고가 있었다. 최종 일반/파일럿 빌드를 로컬 소켓 권한으로 재실행했으며 두 최종 로그에는 해당 오류가 없다.
- 최종 전체 결과에는 예상 밖 실패가 없다. 로컬 통과는 신규 원격 CI·CodeQL·실제 DB/RLS·배포 통과를 의미하지 않는다.

### 실행 명령과 증거 보존

위 명령들은 `/private/tmp/fridgemate-pilot-policy-PD0H55w3/run.mjs`를 통해 실행했다. 이 래퍼는 고정 작업 트리, 제한된 환경, JSON reporter, 실행별 새 로그와 종료 기록을 사용한다. 원본 결과·중간 실패·스크린샷·생성 Preview 설정은 같은 임시 디렉터리에 있다. 임시 디렉터리는 OS 정리 대상이므로 영구 운영 증거 저장소가 아니다.

```bash
node /private/tmp/fridgemate-pilot-policy-PD0H55w3/run.mjs unit final-02
node /private/tmp/fridgemate-pilot-policy-PD0H55w3/run.mjs lint final-02
node /private/tmp/fridgemate-pilot-policy-PD0H55w3/run.mjs build final-02
node /private/tmp/fridgemate-pilot-policy-PD0H55w3/run.mjs pilot-build final-02
node /private/tmp/fridgemate-pilot-policy-PD0H55w3/run.mjs e2e final-02
node /private/tmp/fridgemate-pilot-policy-PD0H55w3/run.mjs built final-02
node /private/tmp/fridgemate-pilot-policy-PD0H55w3/run.mjs pilot-e2e final-04
node scripts/prepare-pilot-preview.mjs --output /private/tmp/fridgemate-pilot-policy-PD0H55w3/preview-only.vercel.json
git diff --check
```

래퍼의 같은 접두사는 덮어쓸 수 없으므로 재실행할 때 새 접두사를 사용한다. 임시 래퍼가 없어도 위 로컬 실행 절의 npm 명령과 저장소 테스트를 사용할 수 있다.

### 파일 변경과 배포 상태

- 메뉴 정책: `mealPlanReviewPolicy.js` 신규, `mealPlanCatalog.js`·`mealPlanDomain.js` 수정, 정책/후보 테스트 2개 신규.
- UI: `MealPlanEditor.jsx`·`MealQuantityDetails.jsx`, 수량 상세 기존 테스트 수정, 편집기 정책 테스트 신규.
- 런타임: `pilotMode.js`와 테스트 2개 신규, `backendConfig`·`adsenseConfig`·`googleAnalytics`·`apiClient`·`externalAiRequest`·`importCorrectionsApi`·`main.jsx` 수정.
- 빌드: 독립 build/config 스크립트 3개와 테스트 신규, Vite·package scripts·OCR/광고/SEO 후처리 수정. `.gitignore`·ESLint·Vitest에는 `dist-pilot` 산출물 제외만 추가.
- 브라우저: `playwright.pilot.config.js`·`e2e/pilot-policy.spec.js` 신규.
- 문서: 기존 미추적 메뉴 정책 초안을 승인 상태로 갱신, 이 구현 기록 신규, README·CHANGELOG 수정.

최종 작업 트리 상태는 추적 파일 수정 23개와 미추적 파일 15개(기존 정책 초안 포함)다. `vercel.json`, lockfile, 서버, 원문 데이터와 수량/배분 엔진, 기존 추천 구현은 HEAD와 차이가 없음을 별도 확인했다. 원본 루트는 수정하지 않았으며 커밋·푸시·PR 변경·병합·배포는 하지 않았다. 생성한 설정은 로컬 준비물일 뿐 실제 자동 Preview 리다이렉트나 Production 연결을 바꾸지 않았다.

## 2026-10-04 후속 상태

위 실행 결과와 배포 경계는 9월 29일의 기록이다. 이후 이유 선택 UI·로컬 v2 계측과 파일럿 운영 기준을 추가하고 전체 검사를 다시 실행했다. 현재 결과, 정상 CLI 인증 및 실제 Preview 시도/차단 상태는 [10월 4일 검증 기록](PILOT_REASON_INSTRUMENTATION_2026-10-04.md)에 구분한다. 과거 임시 디렉터리의 일부 로그가 OS 정리돼 새 증거 디렉터리를 사용했으며, 이전 통과 수치를 새 결과로 재사용하지 않았다.
