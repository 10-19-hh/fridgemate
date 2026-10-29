# 파일럿 이유 선택·로컬 계측 검증

2026-10-04 KST. 작업 트리 `codex/prd-v2-recovered-20260919`, HEAD `4c6e73062358f5e164f91eec078bc7e10a45322c`. 이 문서는 실제 참가자 이용·OCR 실측·운영 배포 결과를 선언하지 않는다.

## 구현

- 메뉴 교체·건너뛰기·지난 확정 끼니의 명시적 미조리 전에 선택형 이유를 고를 수 있다. 취향/재료/비용/난이도/일정/반복 피로/기타의 7개와 미응답을 구분한다. 자유 입력과 지속적인 개인 선호도 변경은 없다.
- 원래 화면의 색·폰트·native select를 유지했다. 선택 상태는 현재 계정·주·슬롯·메뉴 문맥에만 남는다. 실제 저장 성공과 메뉴 변경 후 초기화하며, 같은 화면의 실패/대안 없음은 선택을 유지한다. 재로드 시 보존하는 설정이 아니다.
- 지난 **확정** 끼니에는 ‘만들지 않았어요’를 표시한다. 초안의 미조리 선택만으로 기존 확정 배분을 해제하지 않으며 명시적 식단 확정 절차는 유지한다.
- `useMealPlan`은 전달된 슬롯 ID와 실제 저장 ACK 전후 상태를 대조한다. 교체/건너뛰기/명시적 미조리와 일치하는 고정 코드만 관측 descriptor로 보낸다. 저장 실패를 성공 이유로 기록하거나 변경 없는 동작을 교체로 기록하지 않는다. 호출 당시의 primitive 값을 복사해 비동기 동안 호출자가 바꾼 값으로 오염되지 않게 한다.
- 이유는 `meal_slot_changed`의 **event version 2**에 `changeType`과 `reasonCode`로만 들어간다. 기존 event version 1과 export envelope schemaVersion 1은 유지하며 v1/v2 혼합 파일을 검증한다. 레시피 원문·식단 스냅샷·재고·일반 분석 동의에 이유를 저장하지 않는다.
- 기존 별도 기록 동의/명시적 재개/35일 다음 접근 정리/수동 JSON 내보내기 경계를 따른다. 동의하지 않은 경우에도 식단은 저장되지만 파일럿 이유 이벤트는 없다. 철회 시 파일럿 기록만 삭제하고 식단·재고는 유지한다.
- 실제 Chromium의 저장 중 disabled 버튼 blur를 확인하고 성공 후 포커스 복원을 보강했다. 한 프레임 뒤 같은 저장 문맥·연결된 활성 버튼·다른 요소로의 사용자 이동 없음·현재 body 포커스일 때만 복원한다. 이를 위한 동기화 Effect는 추가하지 않았다.

## 파일 변경 범위

- 신규: `src/features/mealPlans/mealPlanFeedback.js`, `src/hooks/__tests__/useMealPlan.feedback.test.jsx`, `src/components/mealPlans/__tests__/MealPlanEditor.feedback.test.jsx`, 이 문서와 [운영 기준](PILOT_RUNBOOK_2026-10-04.md).
- 구현: `MealPlanEditor.jsx`, `useMealPlan.js`, `mealPlanPilotCollector.js`, `mealPlanPilotMetrics.js`, `MealPlanPilotPage.jsx`.
- 검증: collector/metrics/export 기존 테스트 3개, 지난 확정 끼니 페이지 테스트의 해당 버튼 assertion, `e2e/meal-plan-changes.spec.js`의 해당 과거 끼니 버튼 assertion, 기존 미추적 `e2e/pilot-policy.spec.js`에 실제 이유 흐름 1개 추가.
- 안내: README, CHANGELOG, 9월 29일 로컬 빌드 기록의 후속 상태.

추천 점수·별칭·원문 데이터·수량/배분 엔진·서버·DB·인증 정책과 lockfile은 이번 이유 작업에서 변경하지 않았다. 별도 Preview 설정은 기존 정책 구현의 생성기를 사용하고 원래 `vercel.json`을 수정하지 않는다.

## 기존 변경 보존

시작 시 있던 38개 변경/미추적 파일을 HEAD와 별도로 보관했다. `/private/tmp/fridgemate-pilot-reasons-mmEkOuW2/snapshot-before.json`에 실제 경로·SHA256, `snapshot-before.patch`에 binary diff, `snapshot-before-files/`에 미추적 파일을 포함한 실제 사본이 있다. `.env`, 개인 키, 인증 파일은 포함하지 않았다. 기존 파일 삭제 0개다. 원본 `/Users/lee/fridgemate`는 실행·편집 대상으로 사용하지 않았다.

최종 패치와 파일 사본도 같은 증거 디렉터리에 별도 접두사로 보존한다. 임시 디렉터리는 OS 정리 대상이며 영구 백업이 아니다. 복원 검토가 필요하면 HEAD의 **새 별도 checkout**에 시작 사본/패치를 적용하고 해시를 대조한다. 현재 작업 트리에 reset/clean/광범위한 restore/stash를 적용하는 절차가 아니다.

## 실제 검증 결과

Node 24 / macOS arm64 / 기존 설치 의존성. 테스트 파일 경로는 모두 위 작업 트리 아래이며 하위 `.worktrees/**` 결과가 없다. 새로운 패키지를 FridgeMate 의존성에 추가하지 않았다.

| 검사 | 결과 | 증거 접두사 |
|---|---|---|
| 변경 전 단위 기준 | 239파일, 3,074 PASS, 실패·pending 0 | `unit-baseline` |
| 최종 전체 단위·통합 | 241파일, **3,145 PASS**, 실패·pending 0 | `unit-sealed` |
| 최종 lint | exit 0 | `lint-sealed` |
| 일반 빌드 | exit 0, OCR 자산 7개·공개 113경로·사이트맵·noindex 앱셸 검증 | `build-sealed` |
| 전체 개발 브라우저 | **107 PASS** | `e2e-sealed-full` |
| 일반 실제 빌드 브라우저 | **48 PASS** | `built-sealed` |
| 파일럿 빌드 | exit 0, 별도 `dist-pilot`, 동일 후처리 검증 | `pilot-build-sealed` |
| 파일럿 실제 빌드 브라우저 | **5 PASS** | `pilot-e2e-sealed` |

브라우저 최종 검사 모두 retries 0, skipped/unexpected/flaky 0이다. 일반 빌드 48개는 개발 검사 일부의 환경 대조이지 추가 고유 사용자 시나리오 48개가 아니다. 새 단위 assertion 71개는 공유 계약 39개, 훅 11개, UI 21개다. 단위의 일부 기존 React `act(...)` 경고는 실패 0과 별개로 남으며 이번 이유 경로 수정 범위 밖이다.

새 파일럿 브라우저 검사는 실제 IndexedDB와 hook/repository/collector를 통해 교체·미응답 건너뛰기·지난 끼니의 미조리→명시적 JSON 다운로드→v2 이유 3건 대조→기록 철회를 확인했다. 실제 fetch/XHR와 요청 목록을 감시하며 API/GA/광고/Sentry/원격 학습 등 금지 요청 0건, 일반 분석 동의 및 재고 불변, 390px 가로 넘침 없음도 확인했다. 원격 요청은 로컬 브라우저 검사에서 차단했으므로 실제 배포·서비스 검증으로 부르지 않는다.

### RED와 기타 실패 구분

- 계약 초기 RED: 195개 중 178 PASS / 새 정책 관련 17 assertion FAIL → GREEN 195 PASS.
- UI 초기 RED: 신규 16개 중 14 assertion FAIL → 기존 관련 UI를 포함한 GREEN 26 PASS.
- 훅 초기 RED: 7개 중 4 PASS / ACK 뒤 v2 이유 누락 3 assertion FAIL. 이후 clone 불가 선택값의 사업 저장 차단을 별도 RED(10 PASS / 1 FAIL)로 확인하고 primitive allowlist 복사로 해결했다.
- 슬롯 remount의 포커스 손실: 16 PASS / 1 예상 FAIL → stable key 적용 후 GREEN. 실제 Chromium에서는 busy disabled 중 blur가 별도로 남아 파일럿 E2E 첫 실행이 4 PASS / 1 FAIL이었다. 단위에서 같은 blur를 명시한 RED(19 PASS / 1 FAIL) 후 보강했고 최종 실제 브라우저 5개를 통과했다.
- 최초 busy-focus 단위 fixture 실행 오류는 기능 RED로 세지 않는다. fixture를 고친 실행에서 assertion 차이를 별도로 확인했다.
- 첫 개발 E2E는 106 PASS / 1 FAIL이었다. 기존 과거 끼니 버튼 이름 assertion을 새 ‘만들지 않았어요’에만 맞췄으며 최종 전체 107개를 재실행했다. 다른 미래/오늘 버튼의 기대값을 일괄 변경하지 않았다.
- 중간 lint에서 render 중 ref 쓰기를 지적해 commit 시점 callback ref로 바꿨다. 최종 단위/lint/일반·파일럿 빌드는 그 수정 이후의 코드다.
- 초기 일반 빌드의 SSR 소켓 `EPERM` 경고는 제품 RED로 세지 않았다. 로컬 소켓 실행 권한으로 재검사한 최종 빌드에는 해당 경고가 없다.

## 재실행

아래 명령은 **원본 루트가 아닌 변경 작업 트리에서**, 기존 의존성과 지원 Node 버전으로 실행한다. 파일럿/일반 빌드를 바꾸지 않고 각각 해당 브라우저 검사를 실행한다.

```sh
npm run test:run -- --exclude '.worktrees/**'
npm run lint
npm run build
npm run test:e2e -- --workers=2 --retries=0
npm run test:e2e:preview -- --workers=2 --retries=0
npm run build:pilot
npm exec playwright test -- --config playwright.pilot.config.js --workers=2 --retries=0
git diff --check
```

실제 실행은 증거 디렉터리의 `run.mjs`로 고정 cwd·제한된 환경·각 실행의 새 JSON/로그/종료 기록을 남겼다. 예: `node /private/tmp/fridgemate-pilot-reasons-mmEkOuW2/run.mjs unit sealed`. 같은 접두사는 덮어쓰지 않으므로 재실행 시 새 이름을 사용한다.

## Preview 배포 상태

공식 CLI 계정 접근을 사용자가 승인했고 기존 기본 CLI 계정은 보존했다. 새 인증은 별도 0700 임시 폴더에만 저장하며 인증 내용·토큰은 출력/스냅샷에 포함하지 않았다. 정상 로그인 후 `whoami=edgar1019-5628`, `teams=fridgemates-projects`, 기존 프로젝트 `fridgemate`와 Node 24.x를 확인했다.

빌드에 필요한 **204개 파일만** 별도 업로드 복사본에 보존하고 현재 실제 소스와 SHA256 일치를 확인했다. `.env.production`은 tracked 파일이므로 전체 tracked/archive 복사가 아니라 명시 allowlist를 사용했다. .env/키/.git/.worktrees/node_modules/서버/참가자 자료는 업로드하지 않는다. SEO verifier가 읽는 원래 `vercel.json`과 `--local-config`로 선택하는 별도 Preview 설정을 구분한다.

CLI 46.1.1의 Preview 요청은 `Not authorized`로 거절됐다. 팀/프로젝트 조회 성공이 배포 성공을 의미하지 않는다. 구버전 OAuth의 시간 단위 불일치가 확인돼 최신 공식 CLI 62.2.0을 프로젝트 의존성과 기존 설치를 바꾸지 않는 임시 실행으로 비교 중이다. 최신 CLI의 `--skip-domain`은 Production에만 허용돼 읽기 전용 dry 실행에서 제거했으며, 이를 위해 Production 옵션을 추가하지 않는다. **새 원격 배포·원격 스모크·고정 참가 URL은 아직 미확정**이다.

10월 4일 기존 자동 Preview `/pilot`은 운영 도메인으로 308 이동했다. 이 주소를 참가자에게 안내하지 않는다. PR #55는 main 병합이 자동 운영 배포로 이어지는 설정이므로 보류한다. 이번 작업에서 commit/push/merge/운영 설정 변경은 하지 않았다. 기존 원격 CI 통과는 현재 미커밋 변경에 대한 CI 증거가 아니다.

## 한계와 시작 조건

- v2를 저장한 origin을 **v1 전용 reader의 과거 빌드로 롤백하면** 파일럿 읽기/내보내기/철회 UI가 막힌다. 잘못된 payload를 임의 삭제하지 않으며 기존 35일 header 정리는 남지만, 이를 안전한 사용자 롤백이라고 부르지 않는다. v1/v2 reader와 네트워크 방어를 유지한 호환 빌드만 롤백 대상으로 사용하고 실제 배포 교체/롤백을 별도 검증한다.
- 테스트는 Desktop Chromium 및 모바일 viewport다. 실기기·Safari/Firefox·다른 OS·실제 저장 실패의 browser focus 복원은 미검증이다. 성공 ACK 후 포커스만 복원하므로 실패 busy 사이클에서는 body에 포커스가 남을 가능성이 있다.
- feedback helper는 UI의 객체 입력을 전제로 한다. 고정 객체 안의 잘못된 optional 값은 무시하지만, 전체 인자로 문자열/숫자를 주는 잘못된 내부 호출까지 공개 입력 API로 지원하지 않는다.
- local-only는 브라우저 앱/빌드 경계이며 OS·확장·사용자 코드까지 격리하는 보안 샌드박스가 아니다. 서버 인증/RLS/DB 검증 완료를 뜻하지 않는다.
- 모집/시작 날짜·수동 JSON 전달 채널/사본 삭제 시점·고정 origin·원격 스모크를 완료하기 전에는 모집을 시작하지 않는다. 실제 OCR 10~20장과 참가자 데이터는 아직 없다. 성공/중단 수치는 [운영 기준](PILOT_RUNBOOK_2026-10-04.md)의 사전 운영 초안이며 결과에 맞춰 바꾸지 않는다.
