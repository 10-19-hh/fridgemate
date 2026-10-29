# 전반 코드 점검과 동작 보존 리팩토링 — 2026-09-28

## 결과와 기준

계정 개인정보 UI, 레시피 요청 검증, IndexedDB 다중 저장소 트랜잭션, 임베딩 점검 스크립트의 반복 처리를 분리했다. 최종 **192개 테스트 파일 / 2,246개 단위·통합 테스트, 11개 브라우저 테스트 파일 / 52개 사례, lint, build, 공개 경로 113개 SEO 검사가 통과**했다. 커밋·푸시·배포는 하지 않았다.

- 작업 위치: `/Users/lee/fridgemate/.worktrees/prd-v2-recovered-20260919`
- 브랜치: `codex/prd-v2-recovered-20260919`
- 기준 커밋: `b6e3f10480df1cddf9ff005b44f99698befe4c86`
- 실제 시작 상태는 위 커밋에 이전 PRD v3 대조·리팩토링 **미커밋 파일 12개**가 더해진 상태다. 새 기준 실행은 190파일 / 2,204개 통과였다.
- 기존 12파일은 이번 문서 갱신 직전 보관본의 SHA-256과 전부 일치했다. 이후 README·CHANGELOG에 이번 기록만 추가했고 나머지 10파일은 그대로다. 원본 `/Users/lee/fridgemate`는 변경하지 않았다.

## 점검 범위와 깊이

- 자체 코드·설정·테스트·스키마 등의 522파일을 경로·크기·해시로 조사했다. 의존성, 빌드 산출물, 외부 vendor/public 자산, 원본 데이터셋, lockfile, 문서와 비밀 환경파일은 이 코드 인벤토리에서 제외했다. `src/data`의 네 파일은 목록에 포함했지만 콘텐츠 정확성을 전수 검증하지 않았다.
- 프런트 페이지 16개, 컴포넌트 37개, hook 13개, API 10개, `App.jsx`와 별도 `main.jsx` 본문을 읽었다. 저장소·추천·식단/장보기·인증 도메인, OCR/receiptParser·학습 보정·analytics/Sentry의 주요 구현도 검토했다.
- 서버 routes/controllers/services/lib/middleware/DB/Worker 구조와 주요 경계, 루트 설정·CI 4개 workflow, 스크립트 진입점·쓰기 가드와 이번 추출 대상 본문을 점검했다. 테스트 본문 전체, 모든 운영 스크립트·마이그레이션의 모든 분기, 쿠팡 세부 파서·정규화 사전·편집 데이터까지 줄 단위 전수 감사를 마쳤다는 의미는 아니다.
- 추가 읽기 전용 ESLint 복잡도 조사에서는 `src`, `server/src`, `scripts`의 455파일을 파싱했다. 테스트를 제외하면 14파일의 함수 16개가 임시 기준 30을 넘었다. 이는 후보 선별용이지 새 lint 정책이나 결함 판정이 아니다. OCR·임베딩·추천 UI·이력 검증은 사례별 의미가 달라 수치만 낮추기 위해 합치거나 쪼개지 않았다.

## 이번 변경 파일과 보존한 계약

| 영역 | 변경·신규 파일 | 구조 정리와 보존 사항 |
| --- | --- | --- |
| 계정 UI | `src/pages/AccountPage.jsx`, 신규 `src/components/AccountPrivacyPanel.jsx`, `src/pages/__tests__/AccountPage.test.jsx` | Page 336→212줄. 개인정보 전용 상태 5개, 내보내기·삭제 핸들러와 JSX 추출. 비밀번호·다운로드·삭제 확인·오류·부모 재렌더 시 상태, 인증·동기화·로그아웃 동작 유지. |
| 레시피 요청 | `server/src/controllers/recipeController.js`, 신규 `server/src/lib/recipeRequestValidation.js`, `server/src/controllers/__tests__/recipeController.test.js` | Controller 246→68줄. 검증/정규화 본문과 handler 본문 그대로 유지. 기존 `normalize*` 공개 export 4개 재노출. 필드 제한·오류 우선순위·민감정보 처리·서비스 호출 순서 유지. |
| IndexedDB | `src/db/indexedDB.js`, 신규 `src/db/__tests__/linkedStoreTransactions.test.js` | 구매·조리·재고량 wrapper 3개의 반복 실행부를 private `runLinkedStoreTransaction`으로 통합. store/별칭 순서·scope·readonly/readwrite·커밋 후 결과·동기 예외/실패/취소 문구와 원자성 유지. DB v7 그대로. |
| 점검 스크립트 | `scripts/checkpoint-recipe-embeddings.js`, `scripts/verify-recipe-embeddings.js`, 신규 `scripts/lib/readOnlyTransaction.js`, 신규 `scripts/__tests__/embedding-read-only-boundary.test.js` | 동일한 helper 두 개를 공유. READ ONLY 설정을 기다리는 순서·트랜잭션 한도·오류 전파·주입 client 소유권·기존 transaction 없는 client 지원 유지. 실제 DB/AI는 호출하지 않았다. |
| 문서 | `README.md`, `CHANGELOG.md`, 이 문서 | 기존 기록을 보존하며 범위·검증·보류 사항 추가. |

코드/테스트 12파일과 문서 3파일이 이번 변경 대상이다. 기존 변경과 합하면 작업트리의 변경·미추적 파일은 25개다. 추천 점수/정규화, PRD 정책, API 경로, 인증 권한, 데이터 스키마, 의존성, 테스트 설정은 변경하지 않았다. 계정·서버·스크립트 이동 본문의 동일성과 DB 공통화의 동작 보존을 별도로 교차 검토했다.

TDD·React 점검 지침을 적용했다. 기능 추가가 아닌 리팩토링이므로 기존 GREEN → 특성화 테스트 GREEN → 추출 → GREEN 순서로 진행했다. React 컴포넌트는 모듈 수준에 두어 부모 재렌더 시 입력이 재설정되지 않게 했다. 기존 assertion 삭제·기대값 완화·skip 추가는 없다.

## 검증 내역

| 검증 | 결과 |
| --- | --- |
| 변경 전 전체 기준 | 190파일 / 2,204 통과 |
| 계정 특성화, 추출 전 | 기존 2 + 신규 8 = 10 통과 |
| 계정·인증 관련, 추출 후 | 6파일 / 47 통과 |
| 서버 관련, 추출 전·후 | 기존 19 + 신규 6 = 각각 25 통과; 개별 raw JSON은 없고 실행 출력으로 확인 |
| DB 관련, 변경 전 / 추출 후 | 12파일 / 409 → 13파일 / 424 통과; 신규 15개는 추출 전에도 통과 |
| 점검 스크립트, 추출 전·후 | 기존 7 + 신규 10 = 각각 17 통과 |
| DB 교차검토 후 보강 | readonly 쓰기 거절·저장 불변 3개 추가; 이 3개는 변경 전 실행한 사례가 아님 |
| 최종 전체 단위·통합 | 192파일 / 2,246 통과, 실패·skip·todo 0; 원래 2,204개 모두 유지 |
| 전체 브라우저 | 52 통과, 실패·skip·재시도 0, 약 36.4초; local-only/API-mock 모드 |
| lint / build | 통과; 공개 경로 113개, sitemap, noindex app shell 검사 통과 |

JSON 결과의 실제 실행 파일이 지정 작업트리 내부인지 확인했다. 다른 `.worktrees/**` 결과는 섞이지 않았다. 테스트 목록 비교에서 `ingredientValidation.test.js`의 기존 `it.each([null, [], new Date()])` 사례 한 개는 실행 시각이 제목에 들어간다. 해당 파일은 변경하지 않았으며, 이 한 이름의 날짜 부분만 식별용으로 정규화하여 비교했다. 다른 제목이나 실패는 숨기지 않았다.

기존 MealPlanChanges/useAuth 계열의 React `act` 경고와 브라우저 실행의 색상 환경 경고는 남아 있다. 최초 sandbox 빌드는 SEO 생성기의 Vite WebSocket 포트에서 EPERM 경고를 냈지만 exit 0이었다. 로컬 포트 권한을 받은 재실행에서 같은 빌드·SEO 검사 통과를 확인했다. 경고를 없애기 위해 설정/코드를 바꾸지 않았다.

실제 통합 실행 명령(작업 디렉터리는 위 worktree, 기존 Node 24.19.0 의존성 재사용):

```sh
export PATH=/Users/lee/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH
npm run test:run -- --reporter=default --reporter=json --outputFile=/private/tmp/fridgemate-full-refactor-nZGcmAOC/baseline.json
npm run test:run -- --exclude '.worktrees/**' --reporter=default --reporter=json --outputFile=/private/tmp/fridgemate-full-refactor-nZGcmAOC/final-reviewed-unit.json
npm run lint
npm run build
PLAYWRIGHT_JSON_OUTPUT_NAME=/private/tmp/fridgemate-full-refactor-nZGcmAOC/e2e.json npm run test:e2e -- --reporter=list,json --workers=4
```

의존성을 새로 설치하지 않았다. CI의 새 설치 환경, 실제 PostgreSQL·Redis·Cloudflare 런타임, 운영 API·배포, 실제 사용자 데이터, 외부 AI/광고 계정은 검증하지 않았다. 테스트 통과는 이 경계의 운영 보증이나 성능 개선 측정이 아니다.

## 기존 안정성 문제 — 수정하지 않음

아래는 이번 변경과 무관한 기존 코드에서 별도 fixture로 재현한 결과다. 실제 React·브라우저·DB 통합 오류를 전부 재현한 것으로 확대하지 않는다.

1. **저장 실패가 성공으로 표시될 수 있음.** `src/pages/IngredientsPage.jsx:88`의 저장 콜백이 rejection을 삼킨다. `src/components/ShoppingListPanel.jsx:217`은 이 Promise가 해결되면 saved로 판정한다. 실제 콜백 원문을 추출한 독립 fixture에서 같은 저장 실패가 현재 경로는 `saving → saved`/“저장됨”, rejection을 그대로 전달한 대조군은 `saving → error`/“저장 실패”가 됐다. 우선 후속 작업으로 권장한다.
2. **손상된 로컬 보정 데이터.** `src/utils/import/importLearning.js:33`은 JSON 문법만 처리하고 구조는 확인하지 않는다. 저장 문자열 `null`을 실제 함수에 제공하면 :89에서 TypeError가 발생한다. `ImportPage` effect도 이를 처리하지 않는다. 메모리 storage fixture 재현이며 사용자 저장소는 변경하지 않았다.
3. **브라우저 저장소 접근 차단.** `src/utils/analyticsConsent.js:12`의 `localStorage.getItem` 예외가 호출자에 전파된다. 실제 함수에 접근 차단 fixture를 연결해 SecurityError를 확인했다. `useAnalytics` 초기 상태/동의 배너 연결은 코드로 확인했으며, 차단된 실브라우저의 화면 장애를 검증한 것은 아니다.

다음 순서는 위 오류를 실패하는 회귀 테스트로 고정하고 별도 안정성 수정 → PRD v3의 지난 미완료 끼니 배분·원자적 사용량 정정·첫 진입/파일럿 수집 진행이다. [PRD 차이 기록](PRD_V3_ALIGNMENT_AND_REFACTOR.md)의 미완료 정책을 이번 구조 정리에 섞지 않았다.

## 보관과 재현

- 시작 상태의 기존 12파일 보관본: `/Users/lee/fridgemate/.worktrees/prd-v3-refactor-evidence-20260927`.
- 이번 원본 결과/소스 스냅샷: `/Users/lee/fridgemate/.worktrees/full-refactor-evidence-20260928`. 기준·최종 JSON, 테스트 목록 비교, 소스 해시, 전체 변경 patch와 새 파일을 포함한 archive, 기존 오류 재현 fixture를 보관한다. `.env`, 비밀키, 사용자 DB, 의존성은 포함하지 않는다.
- 재현 시 원본 작업트리에 덮어쓰지 말고 별도 새 checkout에서 위 커밋을 준비한다. 시작 상태는 보관된 `starting-existing-changes.tar.gz`, 완료 상태는 `source-files.tar.gz`를 그 새 checkout에만 적용한다. 각 manifest 해시를 대조하고 같은 Node/기존 의존성 조건에서 테스트를 실행한다. archive는 자동 복원 명령이나 reset/stash가 아니며 이번 작업에서 복원을 실행하지 않았다.
