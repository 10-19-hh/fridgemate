# PRD v3 후속 1단계 — 저장 실패 경계 안정화

## 결과와 범위

2026-09-28, 이전 전반 점검에서 발견한 세 문제를 회귀 테스트로 재현하고 수정했다. 최종 **196파일 / 2,299개 단위·통합 테스트, 11파일 / 57개 브라우저 테스트, lint, build, 공개 경로 113개 SEO 검사**가 통과했다. 기존 2,246개 단위·통합 및 52개 브라우저 사례는 유지하고 각각 53개·5개를 추가했다. skip·todo·브라우저 재시도는 없다.

- 작업트리: `/Users/lee/fridgemate/.worktrees/prd-v2-recovered-20260919`
- 브랜치: `codex/prd-v2-recovered-20260919`
- 기준 커밋: `b6e3f10480df1cddf9ff005b44f99698befe4c86`
- 시작 상태는 위 커밋뿐 아니라 이전 리팩토링 미커밋 파일 25개를 포함한다. 이번 수정 전 전체 실행에서 192파일 / 2,246개가 통과했다.
- 기존 25파일의 해시를 보관본과 대조했다. 이번 README·CHANGELOG의 안내 한 줄씩을 제외하면 전부 그대로다. 별도 원본 `/Users/lee/fridgemate`는 수정하지 않았다.
- AT-18 지난 미완료 끼니 배분, 원자적 사용량 정정, 첫 진입 UX, 파일럿 수집은 이번 범위에 넣지 않았다. 커밋·푸시·PR·배포도 하지 않았다.

## 수정한 동작

### 장보기 저장 실패

`IngredientsPage`의 저장 콜백이 `updateIngredient`의 rejection을 삼키지 않고 패널에 전달한다. 실패 시 패널은 “저장됨” 대신 “저장 실패”를 표시하며 편집한 수량·메모를 유지한다. 실제 저장소의 원본도 보존되고 기존 450ms 자동 재시도가 성공하면 저장 표시와 저장소 값이 함께 갱신된다. 다른 CRUD 핸들러나 패널의 재시도 정책은 바꾸지 않았다.

### OCR 보정 학습의 손상·쓰기 실패

- JSON `null`, 배열·원시값·깨진 문법·빈 문자열·잘못된 행을 보정 값으로 사용하지 않는다. 같은 맵 안의 안전한 행은 읽을 수 있지만, 손상 원문을 자동 삭제하거나 부분 복구본으로 덮어쓰지 않는다.
- 이름·분류·보관 위치 일부만 있는 안전한 legacy 행의 기존 fallback, 게스트/계정 분리, 최신 300개 제한을 유지한다. 상속된 객체 속성을 보정 행으로 쓰지 않는다. 빈 문자열은 키 없음(`null`)과 구분한다.
- 보정 저장소의 getter·읽기·쓰기 예외는 재고 가져오기를 중단시키지 않는다. 학습 저장 실패는 `false`, 정리 실패 역시 실패로 반환한다.
- 실제 재고 저장이 성공했지만 학습만 실패하면 가져오기 화면에 성공과 학습 실패를 함께 알리고 기존 냉장고 링크를 제공한다. 저장 완료된 후보 편집기는 숨긴다. 정상 성공은 기존처럼 냉장고로 이동한다. 새 OCR/파일은 다시 검토할 수 있다.
- 실제 재고 저장도 실패하면 성공으로 표시하지 않고 편집값·선택을 보존해 재시도한다. 재고 갱신/rollback은 검토값을 초기화하지 않는다. 초기 중복 선택은 기존처럼 한 후보만 선택하며, 이를 해제했다고 다른 후보를 자동 선택하지 않는다.

### 분석 동의와 식별자 저장소 예외

- 동의 읽기 예외는 미동의로 처리한다. 선택은 쓰기뿐 아니라 다시 읽기까지 확인해야 저장 성공으로 인정한다.
- 허용·철회 저장 또는 철회 시 식별자 정리가 실패하면 현재 문서에서 분석을 차단한다. 기존 `granted`가 디스크에 남아도 같은 문서의 이동/재렌더만으로 다시 활성화되지 않는다. 명시적 선택이 정상 저장되어야 차단을 해제한다.
- 철회 정리는 항목별로 독립 시도한다. 실패해도 다른 식별자의 정리는 시도하고 메모리 이벤트를 비운다. 배너는 실패를 표시하고 열린 상태를 유지하며, 이전 설정이 다른 탭·새 페이지에 남을 수 있음을 설명한다.
- 분석 ID·세션 저장소의 getter·읽기·쓰기 예외도 사용자 동작으로 전파하지 않는다. ID를 확보하지 못하면 새 분석 payload를 만들지 않는다. 분석 설정 키·정상 허용/거절 값·전송 API는 변경하지 않았다. 파일럿 동의/수집과는 별개 기능이다.

## 변경 파일

| 영역 | 이번 변경/추가 파일 |
| --- | --- |
| 구현 6개 | `src/pages/IngredientsPage.jsx`, `src/pages/ImportPage.jsx`, `src/utils/import/importLearning.js`, `src/utils/analyticsConsent.js`, `src/utils/analytics.js`, `src/components/AnalyticsConsentBanner.jsx` |
| 기존 테스트 보강 3개 | `src/utils/import/__tests__/importLearning.test.js`, `src/utils/__tests__/analytics.test.js`, `src/components/__tests__/AnalyticsConsentBanner.test.jsx` |
| 신규 테스트 4개 | `src/pages/__tests__/IngredientsPage.shoppingSave.test.jsx`, `src/pages/__tests__/ImportPage.storage.test.jsx`, `src/utils/__tests__/analyticsConsent.test.js`, `src/hooks/__tests__/useAnalytics.test.jsx` |
| 브라우저 테스트 3개 | `e2e/local-only.spec.js`, `e2e/ocr-import.spec.js`, `e2e/analytics-consent.spec.js` |
| 문서 3개 | `README.md`, `CHANGELOG.md`, 이 문서 |

이번 범위는 총 19파일이다. 이전 변경과 합한 worktree 변경·미추적 파일은 42개다. DB/스키마·인증·API 구현·추천 정책·의존성·테스트 설정은 바꾸지 않았다. 기존 assertion 삭제/완화나 skip은 없다. TDD 스킬에 따라 실패 확인 후 구현했고, React 지침에 따라 편집 원본과 재고에서 파생하는 중복 안내를 구분했다.

## 재현과 검증

| 검사 | 결과와 의미 |
| --- | --- |
| 변경 전 전체 기준 | 192파일 / 2,246 통과 |
| 장보기 유효 RED | 신규 실제 페이지/provider/IndexedDB 테스트 1개에서 실패한 저장이 “저장됨”으로 나타나는 assertion 실패 |
| 보정 유효 RED | 초기 34개 중 22개 실패: 손상 구조·저장 예외·결과 반환·실제 페이지 저장 완료 안내 차이. 이어 학습/재고 이중 실패에서 편집값 유실 확인 |
| 추가 경계 RED | 빈 문자열 관련 3개, 검토 상태 정리 과정에서 발견한 중복 후보 자동 선택 1개를 수정 전 실패로 확인 |
| 분석 유효 RED | 기존 12개 통과 / 신규 21개 실패: 예외 전파·저장 실패 안내·승인 readback·철회 실패 차단 차이 |
| 최종 집중 검사 | 장보기 3파일 20개, 보정 5파일 79개, 분석/GA 5파일 45개 통과 |
| 새 브라우저 사례 | 장보기 1개, 보정 2개, 분석 2개 통과. 기존 분석 정상 경로 1개도 별도 확인 |
| 최종 전체 단위·통합 | 196파일 / 2,299 통과, 약 21.6초 |
| 최종 전체 브라우저 | 11파일 / 57 통과, 약 38.5초, local-only/API-mock |
| lint / build | exit 0; 113 공개 경로·sitemap·noindex 앱 셸 검사 통과 |

Vitest JSON의 실제 파일 경로와 테스트 목록을 비교해 다른 작업트리 결과가 섞이지 않았음을 확인했다. 이전부터 `new Date()`를 제목에 넣는 `ingredientValidation.test.js` 한 사례만 날짜 표시를 식별용으로 정규화했다. 해당 파일과 다른 제목은 변경하지 않았다. 브라우저 목록도 이전 52개가 모두 포함됐는지 확인했다.

실패가 모두 버그 재현인 것은 아니다. 첫 장보기 fixture scope 오류, 첫 가져오기 UI label 오류, 분석 spy cleanup 순서 문제, 중복 후보 fixture가 한 항목으로만 파싱된 오류는 유효 RED로 세지 않았다. 보정 구현 중간 `import-green-05/06.json`의 입력/비동기 대기 검사 실패도 보존했다. 파일명에 `green`이 있다고 성공을 뜻하지 않는다. 첫 OCR 브라우저 검사에서는 fixture 수량이 자동 파싱된다고 가정해 `1모`를 기대했지만 실제 검토값은 빈 문자열이었다. 테스트에서 사용자가 `1모`를 명시적으로 확인하도록 절차만 보완한 뒤 통과했으며 파서나 기대 결과는 바꾸지 않았다. 원래 단위 테스트의 React `act` 경고, 브라우저 색상 환경 경고, 기존 API-mock OCR 예산 제한 경고는 남아 있다.

실행한 핵심 명령(위 worktree, 기존 Node 24.19.0/설치된 의존성 재사용):

```sh
export PATH=/Users/lee/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH
npm run test:run -- --exclude '.worktrees/**' --reporter=default --reporter=json --outputFile=/private/tmp/fridgemate-stability-VvIAkppt/baseline.json
npm run test:run -- --exclude '.worktrees/**' --reporter=default --reporter=json --outputFile=/private/tmp/fridgemate-stability-VvIAkppt/final-unit.json
npm run lint
npm run build
PLAYWRIGHT_JSON_OUTPUT_NAME=/private/tmp/fridgemate-stability-VvIAkppt/final-e2e.json npm run test:e2e -- --reporter=list,json --workers=4
```

새 저장 실패 브라우저 사례는 각 `local-only.spec.js`, `analytics-consent.spec.js`, `ocr-import.spec.js`를 `--project=local-only --workers=1`로 먼저 실행했다. OCR recognition은 기존 테스트 응답을 사용하고 파서·검토 UI·IndexedDB는 실제 경로를 사용했다. 외부 Google 스크립트 요청은 테스트에서 차단했다. 실제 AI/운영 DB/운영 분석 서비스는 검증하지 않았다.

## 한계와 다음 순서

- 이번 보장은 해당 모듈의 예외 경계다. 전역 `window.localStorage` 자체가 막힌 환경에서 앱 전체가 정상 동작한다고 보장하지 않는다. 예를 들어 기존 `ingredientsScopeState.getStoredLastSyncedAt`은 getter를 try 밖에서 읽으며 이번 범위에서는 수정하지 않았다. 전체 앱 브라우저 사례는 분석 동의 키만 차단했고, 전역 getter 단위 검사는 격리된 Provider/보정 모듈 검사다.
- 분석의 현재 문서 차단은 새 이벤트 생성/기록에 적용된다. 기존 전송 대기열·진행 중 요청 취소, 다른 탭의 설정 동기화, 영속 저장에 실패한 철회의 새 문서 보장은 후속 범위다.
- 보정 손상 자료의 복구 UI는 추가하지 않았다. 완료 후보 재제출 차단은 진행 중 연속 클릭 전체나 OCR 교체 삭제/추가의 원자성·멱등성을 보장하지 않는다. 원격 보정 저장은 기존 별도 비동기 경로다.
- 실제 기기/브라우저 저장 공간 고갈, 새 의존성 설치 CI, 운영 배포·계정·실사용 데이터는 검증하지 않았다.
- 다음 제품 작업은 [PRD 대조 기록](PRD_V3_ALIGNMENT_AND_REFACTOR.md)에 따라 **AT-18 지난 미완료 끼니 배분 유지**부터, 이후 원자적 사용량 정정으로 진행한다.

## 보관과 재현

현재 원본 결과는 `/private/tmp/fridgemate-stability-VvIAkppt`에 있다. 별도 보관본 `/Users/lee/fridgemate/.worktrees/prd-v3-stability-evidence-20260928`에는 유효/무효 RED와 중간·최종 JSON, 이전 25파일 시작 상태 archive, 현재 42파일 archive, manifest, 전체 tracked patch, 테스트 목록 비교 결과와 보관 검증 스크립트를 둔다. `.env`, 비밀키, 사용자 DB, 의존성은 포함하지 않는다.

재현 시 기존 작업트리에 덮어쓰지 말고 위 기준 커밋의 새 checkout을 사용한다. 시작 상태는 `starting-existing-changes.tar.gz`, 완료 상태는 `source-files.tar.gz`를 그 새 checkout에만 적용하고 해당 manifest의 SHA-256을 확인한다. 기존 실행환경/의존성 조건을 맞춰 위 테스트를 실행한다. 이번에는 복원·reset·stash를 실행하지 않았다.
