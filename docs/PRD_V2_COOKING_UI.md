# PRD v2 — 조리·실제 사용량·취소 화면 연결

작업일: 2026-09-19. **이 UI 단위의 로컬 검증 완료.** B3의 화면 연결 작업 기록이며 전체 PRD 완료·출시·운영 배포 기록이 아니다.

## 범위와 기준

- 작업 트리: `/Users/lee/fridgemate/.worktrees/prd-v2-recovered-20260919`.
- 브랜치: `codex/prd-v2-recovered-20260919`.
- 기준 커밋: `986051a6693a20e305adaff355530c5a2779774c`. 이전 단계의 미커밋 변경 위에서 이어서 작업했다.
- 이번 UI 작업 착수 시 같은 작업 트리에서 **174파일 1,744개 통과**, 실패/skip/todo 0을 다시 확인했다.
- [조리·소비·취소 저장 기반](PRD_V2_COOKING_STORAGE.md)의 API를 주간 식단 화면에 연결한다. 그 문서의 ‘화면에서 호출하지 않는다’는 설명은 저장 단계 당시의 상태다.
- 원본 루트의 기존 변경은 작업 대상이 아니다. 커밋·푸시·병합·배포는 하지 않는다. 기존 DB v6·정량 규칙·카탈로그 자료를 사용한다.

## 사용자 흐름과 수량의 의미

주간 식단의 확정된 예정 끼니에서 **‘만들어 먹었어요’**를 누르면 해당 끼니의 계획량과 실제 사용량 입력을 보여준다. 초안은 먼저 확정하도록 안내한다. 완료된 끼니에는 **‘조리 기록 확인’**을 제공하고, 식단과 별개로 **‘조리 이력 열기’**에서도 저장 이력을 확인한다.

계획량은 실제 소비의 확정값이 아니다. 확인된 닭고기 300g과 계획량 200g을 가진 산술 검사에서는 200g을 초기 제안하되 사용자가 150g으로 수정하고 ‘실제로 쓴 재고를 모두 확인했어요’를 체크하면 **150g만 차감**한다. 이어지는 200g 끼니의 부족분은 50g이다. 이 예시는 테스트용 수치 계약이며 검수 카탈로그에 실제 닭고기 조리법을 추가했다는 뜻이 아니다.

자동 제안에는 다음 제한을 둔다.

- 전체 필요량이 확인되고 식품 식별값·조리 상태·단위가 맞는 재고가 하나일 때만 제안한다. 재고량을 초과하거나 식사일 기준 기한 확인이 안 되는 경우에는 자동 입력하지 않는다.
- 같은 재료의 여러 배치는 사용자가 직접 나눠 적는다. 다른 확인 재고를 실제로 사용했으면 해당 행에 직접 입력할 수 있다.
- 미확인 양·호환되지 않는 단위·조리 과정 투입량을 임의로 추정하거나, 선택 재료를 자동 소비하지 않는다. 알려진 부분 합계와 전체 양 미확인을 구분한다.
- 빈칸과 0은 해당 재고를 쓰지 않았다는 입력으로 제외한다. 실제 소비로 저장하려면 양수가 하나 이상이고 전체 사용 재고 확인이 필요하다. 음수·초과 사용량·지원하지 않는 정밀도는 저장하지 않는다.
- 수량 미확인·소비 완료·삭제된 재고는 실제 사용량 입력 후보에서 제외한다. 단위·상태·보관 장소·기한은 확인 정보일 뿐 식품 안전 보장이 아니다.

사용량을 모르면 **‘사용량 없이 조리만 기록’**을 선택할 수 있다. 물리적인 수량 문구를 임의로 줄이지 않고 관련 확인 재고를 미확인으로 전환한다. 완료 끼니는 미래 수요에서 빠지지만 후속 식단은 예전 확인량을 그대로 사용하지 않는다. 조리 사실과 재고 반영 상태를 화면에서도 구분한다.

## 두 취소와 삭제된 식단의 이력

1. **재고 반영 취소:** 확인 화면을 거쳐 원래 소비량만 현재의 호환되는 재고 배치에 더한다. 이후 입고한 다른 배치·메모는 유지한다. 조리 사실은 남고, 되돌린 재고량은 다시 확인해야 한다.
2. **조리 기록 취소:** 조리 사실을 취소한다. 이미 재고를 차감한 기록은 재고 반영 취소를 먼저 하도록 버튼과 설명으로 안내한다. 이 행동 자체는 재고를 바꾸거나 예전 수량 확인을 되살리지 않는다.

사용량 없이 기록한 조리는 소비 취소 없이 조리 사실만 취소할 수 있다. 두 취소 모두 설명을 열어 보는 것만으로 저장하지 않는다. 취소할 배치가 없어졌거나 현재 수량을 모르면 냉장고에서 확인하도록 안내하며 임의 복구하지 않는다.

식단을 삭제해도 조리·소비 이력은 남는다. 이력 화면에서 재고 반영과 조리 사실을 각각 취소할 수 있고, 삭제한 식단을 다시 만들지는 않는다. 예전 기록과 현재 메뉴가 다르면 현재 메뉴와 별도로 보관한 기록임을 표시한다. 식단 삭제 후 재생성을 막는 저장 계층의 보호는 유지한다.

## 일관된 조회·오래된 입력·계정 경계

`getMealCookingWorkspace(scope)`는 재고 원본·수량 확인·식단·이벤트를 **하나의 읽기 전용 트랜잭션**으로 조회한다. 반환 계약은 `{ scope, records, inventory, history }`다.

- `records`는 초안·확정본·보관본까지 검증한 식단 레코드다.
- `inventory`는 기존 수량 투영 규칙을 적용한다. 소비 완료·삭제된 원본도 미확인 상태로 반환할 수 있으며 입력 화면은 이를 제외한다.
- `history`에는 연결 관계까지 검증한 조리·소비·두 취소 이력만 반환한다. 같은 저장소의 입고 이력도 엄격히 검증하지만 조리 이력으로 표시하지 않는다.
- 고아 수량 확인·다른 범위 자료·손상된 보관본·누락된 연결 이벤트를 조용히 버리거나 조회 중 고치지 않는다. 식단이 없는 활성 조리 이력은 유지한다.

폼은 열린 시점의 입력 자료와 현재 자료를 비교해 오래된 입력을 막고, 저장 계층에서도 식단 버전·재고 확인 버전·원본 토큰을 대조한다. 창에 다시 포커스하면 이전 입력을 닫고 명시적인 새로고침을 요구한다. 포커스 통지가 없는 다른 탭 변경도 저장 버전 검사로 거부한다. 조회가 뒤늦게 끝나도 최신 조회를 덮어쓰지 않는다.

계정·주차·대상 끼니가 바뀌면 조리 세션을 분리한다. 이전 계정의 지연 조회·저장 응답이 새 계정의 이력·성공 안내·부모 갱신으로 이어지지 않도록 제한한다. 로그인 자체로 게스트 이력을 가져오거나 병합하지 않는다.

중복 제출은 즉시 닫히는 요청 게이트와 동일 입력의 재시도 ID, 저장 계층의 중복 검사로 방어한다. 저장이 실제로 완료되면 조리 창의 재조회 실패나 포커스 변경과 별개로 같은 계정의 주간 식단·재고·장보기 표시를 갱신하도록 알린다. 저장 완료와 화면 갱신 실패는 다른 안내다. 실패한 저장을 성공으로 표시하거나 재조회 실패 때문에 같은 사용량을 자동 재적용하지 않는다.

조리 창이 열려 있는 동안 해당 페이지의 식단 편집·주차 이동·장보기 입력을 잠근다. 초기 제목 초점과 닫은 뒤 호출 버튼 또는 페이지 제목으로의 복귀를 연결했다. 취소 검토를 열면 확인 제목으로, 돌아가면 호출 버튼으로, 조리·취소 저장이 끝나면 패널 제목으로 초점을 옮긴다. 저장 실패의 구체적 오류는 하나의 경고로 읽히며 입력을 유지한다. 초점 소실 3개·중복 경고 1개의 assertion 실패를 확인한 뒤 보강했고 단위·브라우저에서 검증했다. 보조 기술 전체 조합의 접근성 통과를 뜻하지 않는다.

기존 화면의 초록 계열·서체를 유지하며 계획량과 실제량을 세로로 나누고, 미확인 저장과 두 취소의 의미를 구분했다. 390px 모바일의 사용량/입고 후 취소 화면과 데스크톱 이력 캡처를 직접 확인했다. 모바일 가로 넘침 검사도 통과했다. 새 디자인 체계나 외부 이미지·의존성을 추가하지 않았다.

## 파일 역할

| 파일 | 역할 |
| --- | --- |
| `src/features/mealPlans/mealCookingForm.js` | 계획량 제안·배치 후보·오래된 입력 비교·실제 소비 요청 작성 |
| `src/components/MealCookingForm.jsx` | 계획량/실제량 분리, 전체 사용 재고 확인, 사용량 없는 조리 입력 |
| `src/components/MealCookingPanel.jsx` | 이력·두 취소 확인, 요청/조회 수명 관리, 저장과 갱신 결과 안내 |
| `src/pages/MealPlanPage.jsx` | 끼니별 진입, 완료 상태 표시, 편집 잠금, 식단·재고·장보기 갱신 |
| `src/features/mealPlans/mealCookingRepository.js` | 기존 변경 API에 추가한 읽기 전용 조리 작업 자료 조회 |
| `src/features/mealPlans/__tests__/mealCookingForm.test.js` | 수량 제안·실제 입력 계약 |
| `src/components/__tests__/MealCookingForm.test.jsx` | 실제 폼 입력·확인·실패·오래된 입력 동작 |
| `src/features/mealPlans/__tests__/mealCookingWorkspace.test.js` | 원자적 조회·검증·계정·삭제 후 이력·조회 중단 |
| `src/pages/__tests__/MealPlanCooking.test.jsx` | 실제 로컬 저장과 연결된 주간 화면·장보기·두 취소 |
| `src/components/__tests__/MealCookingPanel.test.jsx` | StrictMode와 저장 완료 후 포커스/재조회 실패 |
| `src/components/__tests__/MealCookingPanel.boundaries.test.jsx` | 계정 변경·언마운트·지연 응답·조회 순서 경계 |
| `e2e/meal-cooking.spec.js` | 모바일 사용량/입고 보존, 실제 카탈로그의 미확인 조리, 탭 충돌, 계정 동선, 저장 중단 |
| `playwright.config.js` | 기존 api-mode 프로젝트에 신규 조리 검사 파일만 추가 |
| `README.md`, `CHANGELOG.md`, `docs/PRD_V2_PROGRESS.md`, 저장 단계 문서, 이 문서 | 최신 기능·결과와 과거 기록의 경계 |

## 검증 결과

아래는 각 실행의 결과다. 중간 결과와 최종 결과를 합산하지 않는다. 마지막 코드 변경 이후 전체 단위·린트·빌드를 마친 뒤 전체 브라우저 검사를 별도로 실행했다.

| 실행 | 확인된 결과 | 근거 |
| --- | --- | --- |
| UI 착수 전 전체 기준 | 174파일 1,744개 통과, 실패/skip/todo 0 | `PZmoID38/baseline.json` |
| 폼 도메인·컴포넌트 | 유효한 RED 39개 실패 → 첫 GREEN 39개 통과 | `IhtWCG/red-verified.json`, `green-first.json` |
| 읽기 전용 workspace | 정리된 RED 22개 실패 → GREEN 22개 통과 | `hRTtj8a4/red-clean.json`, `green.json` |
| 주간 페이지 연결 | 최초 RED 4개 실패, 후속 첫 GREEN 5개 통과 | `PZmoID38/page-red.json`, `page-integration-green-first.json` |
| 패널 수명 오류 | RED 3개 실패 → GREEN 3개 통과 | `PZmoID38/panel-races-red.json`, `panel-races-green.json` |
| 계정·지연 응답 경계 | 4개 특성 검사 최초 통과; RED라고 주장하지 않음 | `ObCheJv6/characterization.json` |
| 신규 브라우저 첫 실행 | 3개 통과·2개 실패, skip/flaky 0 | `BFNqzFjA/first.json` |
| 절차 수정 후 신규 브라우저 | 5개 통과, 29.7초, 실패/skip/flaky/재시도 0 | `BFNqzFjA/recheck.json` |
| 오류 안내·키보드 초점 보강 | 10개 중 예상 assertion 4개 실패 → 관련 4파일 23개 통과 | `PZmoID38/accessibility-red.json`, `accessibility-green.json` |
| 최종 전체 단위·통합 | 180파일 **1,819개 통과**, 실패/skip/todo 0, 이 작업 트리 밖 실행 0 | `PZmoID38/final-unit.json` |
| 최종 전체 브라우저 | 10파일 **47개 통과**, 56.2초, 실패/skip/flaky/재시도 0 | `PZmoID38/final-browser.json` |
| 최종 린트·빌드 | 둘 다 종료 코드 0, 공개 경로 113개·사이트맵·비공개 셸 검사 통과 | 완료된 실행 결과와 보관본 `validation/run-summary.json` |

표의 실제 결과 디렉터리는 다음과 같다.

- `PZmoID38`: `/private/tmp/fridgemate-prd-v2-cooking-ui-PZmoID38`.
- `IhtWCG`: `/private/tmp/fridgemate-cooking-form-IhtWCG`.
- `hRTtj8a4`: `/private/tmp/fridgemate-cooking-workspace-hRTtj8a4`.
- `ObCheJv6`: `/private/tmp/fridgemate-cooking-panel-boundaries-ObCheJv6`.
- `BFNqzFjA`: `/private/tmp/fridgemate-meal-cooking-browser-BFNqzFjA`.

폼 검사에는 처음 테스트 파일 문법 오류가 있었으며 수정 후의 `red-verified.json`만 RED 근거다. workspace 검사도 최초 두 연결 정리 오류를 고친 `red-clean.json`에서 22개가 모두 예상 assertion 차이로 실패한 뒤 구현했다. import·실행 환경·테스트 준비 오류를 기능 재현 성공으로 계산하지 않는다. 부정 입력 검사는 없는 함수 때문에 발생한 오류를 입력 거부 성공으로 오인하지 않도록 구성했다.

브라우저 첫 실패 두 건은 테스트 절차 문제로 구분했다. 구매 반영 검사에서는 필수 보관 장소 입력을 빠뜨려 비활성 버튼을 기다렸고, 다른 탭 검사에서는 headless 브라우저의 페이지 전환이 실제 창 포커스 변화를 일으킨다고 전제했다. 첫 결과를 전체 성공으로 기록하지 않는다. 수정된 절차는 보관 장소를 입력하고 포커스 유무와 독립적인 저장 버전 거부를 검사한다. 별도 `recheck.json`의 5개가 통과했으며, 이후 초점·단일 오류 안내 assertion을 추가한 최종 전체 실행의 47개도 통과했다. 창 포커스 무효화 자체는 실제 저장소와 지연 응답을 쓰는 컴포넌트 검사로 별도 확인했다.

브라우저의 200g/150g 시나리오는 산술 전용 식단 fixture이며 실제 카탈로그의 정량 검수를 대체하지 않는다. 실제 카탈로그 시나리오는 시금치 리조또의 사용량 미확인 경로를 별도로 검사한다. 계정 동선은 실제 화면과 분리된 로컬 저장을 사용하되 인증 API 응답은 테스트용이다. 운영 계정 로그인·운영 DB·배포 검증이 아니다.

## 재확인 방법과 남은 경계

전용 작업 트리에서 Node 24.19.0을 사용했다. 기존 테스트 설정의 `.worktrees/**` 제외를 유지하며 결과 JSON의 실제 파일 목록 180개가 이 작업 트리 아래인 것을 확인했다. 과거 결과를 덮어쓰지 않도록 매 실행에 새 결과 경로를 사용했다. 브라우저 목록도 이 작업 트리의 `e2e` 10파일과 일치한다. 새 설치·Prisma 생성·외부 API·운영 DB 작업 없이 기존 의존성을 사용했다.

주요 실제 실행 명령(작업 디렉터리는 위 전용 작업 트리):

```sh
export PATH=/Users/lee/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH
npm run test:run -- --reporter=json --outputFile=/private/tmp/fridgemate-prd-v2-cooking-ui-PZmoID38/baseline.json
./node_modules/.bin/vitest run src/pages/__tests__/MealPlanCooking.test.jsx src/components/__tests__/MealCookingPanel.test.jsx --reporter=json --outputFile=/private/tmp/fridgemate-prd-v2-cooking-ui-PZmoID38/accessibility-red.json
./node_modules/.bin/vitest run src/pages/__tests__/MealPlanCooking.test.jsx src/components/__tests__/MealCookingPanel.test.jsx src/components/__tests__/MealCookingPanel.boundaries.test.jsx src/components/__tests__/MealCookingForm.test.jsx --reporter=json --outputFile=/private/tmp/fridgemate-prd-v2-cooking-ui-PZmoID38/accessibility-green.json
npm run test:run -- --reporter=json --outputFile=/private/tmp/fridgemate-prd-v2-cooking-ui-PZmoID38/final-unit.json
npm run lint
npm run build
PLAYWRIGHT_JSON_OUTPUT_NAME=/private/tmp/fridgemate-prd-v2-cooking-ui-PZmoID38/final-browser.json npm run test:e2e -- --workers=2 --retries=0 --reporter=list,json --output=/private/tmp/fridgemate-prd-v2-cooking-ui-PZmoID38/final-browser-artifacts
git diff --check
```

재검사할 때는 위 JSON/산출물 경로를 새로운 폴더로 바꾼다. 기준선 명령은 당시 실행 기록이며 현재 코드에서 실행하면 변경 전 1,744개가 아니라 현재 테스트 목록을 실행한다.

수동 확인은 `/meal-plan`의 ‘확정 식단 → 실제 사용량 수정·확인 → 완료 끼니와 부족분 갱신 → 새로고침 → 이력의 재고 반영 취소 → 조리 사실 취소’ 순서다. 사용량 미확인·삭제된 식단·계정 변경·저장 실패도 별도 검사했다. 전체 테스트 결과만으로 모든 실제 환경의 동작을 보장하지 않는다.

## 보관과 재현

- 변경 전 76개 파일은 `/Users/lee/fridgemate/.worktrees/prd-v2-cooking-evidence-20260919`의 기존 아카이브·manifest와 모두 일치함을 확인하고 시작했다. 그 보관본을 덮어쓰지 않았다.
- 이번 완료 상태는 `/Users/lee/fridgemate/.worktrees/prd-v2-cooking-ui-evidence-20260919`에 보관한다. `source-files.tar.gz`와 `source-manifest.json`은 위 기준 커밋에 추가할 전체 미커밋/미추적 소스다. `source-delta.json`은 이번 UI 단위의 변경 목록이다. `verification.json`의 아카이브 해시·추출 검증 결과를 확인한다.
- 복원은 기존 루트나 작업 트리에 덮어쓰지 말고 기준 커밋의 **새 빈 작업 트리**에 아카이브를 적용한 뒤 모든 manifest 해시를 비교한다. 의존성은 이 소스 아카이브에 포함하지 않았다. 테스트할 때 Node 버전·lockfile과 호환되는 의존성을 별도로 준비한다.
- `validation/`에 기준선·RED·중간 실패·GREEN·최종 JSON과 브라우저 캡처/실패 추적을 함께 보관한다. `.env`, 비밀키, 의존성 폴더는 보관 대상이 아니다.
- 원본 루트의 `git status --short --untracked-files=all` 해시는 변경 전후 `38604c7944808ec67998739b9ae8240012f835b514885991c30e1876d579b7a1`로 같다. 이 비교는 변경 목록 동일성 검사이며 원본의 모든 파일 내용 해시를 검사했다는 뜻은 아니다. 원본 루트에 쓰기 작업을 하지 않았다.
- 이 단위에서는 구현·테스트·문서와 기존 브라우저 검사 목록만 바꿨다. `package.json`·lockfile·서버·Prisma·추천 실습 파일은 기준 커밋 대비 변경이 없다.

- 조리 이력·확인량은 현재 기기/계정의 로컬 자료이며 클라우드 백업이 아니다. 원본 재고가 기존 동기화 경로를 사용할 수 있다는 사실과 새 조리 이력의 서버 동기화를 혼동하지 않는다.
- 현재 수량을 모르는 원래 배치의 소비를 취소하려면 먼저 남은 양을 확인해야 한다. 손상된 이력 자동 복구나 삭제된 배치의 임의 재생성 UI는 없다.
- 미확인 양·출처·조리 과정 투입량을 확정값으로 만들지 않았다. 검수 카탈로그 확충은 별도 미완료 범위다.
- 날짜 이동·남은 식단 재조정, 파일럿 계측·실사용 관찰, 후속 예산·공유 등 B4 이후는 이 UI 연결만으로 완료되지 않는다.
- 실사용 모바일 기기·보조 기술 전체 조합, 대규모 이력의 성능, 실제 사용자 조리·재사용은 검증하지 않았다. 좁은 테스트 결과를 제품 전체의 안전·영양·사용성 보장으로 확대하지 않는다.

**이 UI 단위의 로컬 검증 완료. 전체 PRD는 진행 중이며 커밋·푸시·배포 없음.**
