# PRD v2: 원문 대조 한그릇 메뉴와 정량 식단 연결

기록일: 2026-09-16. 전체 목표는 PRD v2이며 이 단위로 전체 완료를 선언하지 않는다.
작업 공간: `/private/tmp/fridgemate-prd-v2-b1-Lba78Azy`.
브랜치: `codex/prd-v2-quantity-contract`.
HEAD: `986051a6693a20e305adaff355530c5a2779774c`.
원본 루트의 동시 변경은 가져오거나 수정하지 않았다. commit/push/merge/배포도 하지 않았다.

이 문서는 최초 두 메뉴 연결 당시의 기록이다. 이후 4개 추가, 제외 식품명 보강, 최신 검증은
[한그릇 메뉴 확충 기록](PRD_V2_DINNER_EXPANSION.md)을 따른다. 아래의 당시 숫자·버전은 보존한다.

## 구현한 범위

기존 편집 조합 16개를 보존하면서 **원문의 기준 인분·식재료량을 대조한 한그릇 메뉴 2개**를
생성·교체·건너뜀 복원 후보에 연결했다. 별도로 대조했던 반찬 구성 요소 4개를 한 끼로
승격한 것이 아니다. 두 새 메뉴도 미정량 조리용 물이 있으므로 모든 조리 투입량 검수 완료,
직접 조리, 성인에게 충분한 저녁, 영양 전문가 검수라고 표현하지 않는다.

- 새 후보: 시금치 리조또, 칠곡석류국수. 기존 16개는 여전히 인분별 수량 미확인이다.
- 원문 재료 행·용도·1인분 양은 저장한 그대로 유지하고, 선택한 1/2인분 필요량만 계산한다.
- 식단 상세에서 계산된 양, 조리 전/후/판매 상태, 원문 양·출처를 구분한다. 조리 요약은
  원문 1인분임을 명시하고 선택 인분의 필요량을 따르도록 안내한다.
- 데침물·면 삶는 물은 양 미확인으로 보존한다. 식단 장보기에도 확인 항목으로 표시하고,
  호환 재료의 미확인 수요가 있는 경우 전체 구매량을 확정하지 않는다.
- 실제 저장소의 확인된 재고와 확정 식단을 연결한다. 리조또 2인분 밥 360g에서 사용자
  확인 재고 300g을 가상 배분하면 60g 부족이다. 재고 차감·메모 수정은 일어나지 않는다.
- 생성 엔진 `weekly-dinner-rules-v2`, 통합 카탈로그 `2026-09-16.1`, 새 원문 대조 버전
  `mfds-dinners-2026-09-16-v1`을 기록한다. 이름·기한·소비 여부·팬트리와 선택 조건 등
  생성에 사용한 최소 입력을 저장한다. 재고의 원문 수량·개인 메모는 입력 기록에서 제외한다.
  `generationInput`은 **같은 엔진/카탈로그에서 마지막 생성 직후 결과**를 재현하는 기록이다.
  교체·고정·건너뜀 이후 현재 식단 전체의 편집 이력이나 과거 엔진 실행기는 아니다.
- 손상된 조리 과정 배열·원문 설명·책자 쪽수·원문량·용도를 저장 경계에서 거부한다.
  잘못된 저장 자료는 삭제하지 않는다. 배분의 직접 입력에서도 sparse 조리 과정 행을 거부한다.

## 원문 대조 근거

공식 자료: 식약처 **우리 몸이 원하는 삼삼한 밥상 II**.
[원문 PDF](https://www.foodsafetykorea.go.kr/upload/20170417/20170417053825_1492418305244.pdf).
2026-09-16 내려받은 125쪽 PDF의 SHA-256:
`f3ae4dce2cbde7e8024932ee7e87d20bd76230009848dbc7b3813dd4e4e42f6c`.
재료표와 조리 단계의 텍스트를 읽고 PDF 16·26쪽의 렌더 이미지도 직접 대조했다.
앱에 원문 PDF·사진·책자 전체 조리 문장을 복제하지 않았고 조리 흐름은 별도로 요약했다.

| 메뉴 | 원문 위치·기준 | 보존한 경계 |
| --- | --- | --- |
| 시금치 리조또 | PDF 26 / 인쇄 50–51쪽, 명시적 1인분 | 지은 밥 180g, 시금치 50g, 마 10g, 두유 150g, 소금 1g, 버터 8g, 후춧가루 1g. 두유 g→ml·밥→쌀 환산 없음. 팁의 무염버터로 교체하지 않음. 데침물 미정량 |
| 칠곡석류국수 | PDF 16 / 인쇄 30–31쪽, 명시적 1인분 | 판매 상태 소면 160g, 저염소금 4g, 식초 8g, 석류 200g, 견과류·씨앗 5종 각 4g, 오이 20g. 조리 3단계의 석류즙 물 600g 포함. 별도의 면 삶는 물은 미정량 |

견과류·씨앗 5종은 잣·아몬드·해바라기씨·호두·호박씨다. 저염소금과 일반 소금,
원재료와 조리 후 상태를 합치지 않는다. 가식부·조리 수율, 조리시간, 영양값은 추정하지 않는다.
책자의 영양값을 가져와 현재 인분에 대한 충분함이나 건강 효과를 주장하지 않는다.
검수 숫자를 채우기 위해 어린이용으로 확인된 닭죽이나 준비 상태가 불명확한 후보를 추가하지 않았다.
정적 책자 대조 자료이며 원격 PDF 변경을 실시간 감시하는 기능은 아니다.

로컬 증거 파일은 아래 검증 폴더의 `mfds-samsam-book2.pdf`다. 임시 파일이므로 영구 보관
보장은 없으며, 공식 URL·해시·쪽수·앱에 기록한 대조 버전으로 동일 원문을 확인할 수 있다.

## 검증과 중간 실패 구분

증거 폴더: `/private/tmp/fridgemate-prd-v2-meal-connection-1vw2tnp3`.

| 단계 | 실제 결과 |
| --- | --- |
| 착수 기준선 `baseline.json` | 현재 전용 작업 공간 153파일, 1,307/1,307 통과 |
| 카탈로그·생성 RED `dinner-red.json` | 13개 중 12개 예상 assertion 실패, 기존 메뉴 보호 1개 통과 |
| 재현 입력 RED `dinner-input-red.json` | 14개 중 13개 예상 assertion 실패. import/환경 오류 아님 |
| 분량 화면·배분 RED `quantity-details-red.json` | 8개 중 7개 예상 미구현 표시/계산 실패 |
| 저장 손상·원문 인분 표시 RED `dinner-review-red.json` | 32개 중 12개 예상 검증·표시 불일치 실패 |
| sparse 과정 행 RED `process-sparse-red.json` | 7개 중 1개 예상 누락 실패 |
| 최종 `final-tests.json` | **158파일, 1,350/1,350 통과**, skip/todo 0, 작업 공간 밖 테스트 0 |
| 최종 린트·빌드 | 종료 코드 0. 공개 정적 경로 113개·사이트맵·noindex 검사 통과 |
| 전체 브라우저 `browser-final.json` | **8파일, 38/38 통과**, skip/retry/flaky 0, 46.94초 |

새 테스트 5파일의 42개는 카탈로그 7, 생성 7, 배분 7, 저장 15, 상세 UI 6이다.
기존 식단 페이지 파일에 연결 검사 1개를 추가해 단위·통합 검사는 기준선보다 43개 늘었다.
브라우저는 실제 UI로 7개 재고 수량 확인 → 2인분 월요일 생성 → 원문/환산량 확인 → 확정
→ 밥 60g 부족/데침물 확인 필요 → 새로고침을 검증했다. 원문 재고와 메모는 그대로다.
390px 가로 넘침 검사와 메뉴 상세·장보기·전체 화면 캡처를 육안 확인했다.

중간에 발견한 **테스트 입력·실행 환경 문제**도 최종 통과와 구분한다.

- 카탈로그 확장 직후 `dinner-green.json`은 46개 중 4실패,
  `integration-before-ui.json`은 1,321개 중 같은 4실패다. 기존 테스트는 밥·파스타면만
  제외하면 모든 후보가 없다고 가정했다. 새 소면 메뉴는 그 어느 재료도 아니므로 후보가
  남는 것이 맞다. '모든 후보 제외' 3개와 '브로콜리 파스타만 가능' 1개의 입력에 소면을
  추가했으며 **assertion은 그대로 유지했다**. 브라우저의 빈 후보 입력도 같은 이유로 수정했다.
- `dinner-persistence.json`의 1실패는 새 페이지 테스트가 실제로 없는 문구를 선택한 문제다.
  기존 화면의 `재료 확인 · ...` 선택자로 고쳤고 앱 문구나 기대 동작을 맞춰 바꾸지 않았다.
- `process-guard-red.json`은 `it.each` 배열 인자 펼침 때문에 sparse 값이 제대로 전달되지
  않은 중간 기록이다. 이름/값 쌍으로 고친 `process-sparse-red.json`을 재현 근거로 사용했다.
- 최초 브라우저 실행은 localhost 4173 권한 EPERM으로 0개 실행했다. 이후 승인된 실행은
  새 경로 1/1, 전체 38/38 통과다. 앱 회귀로 세지 않는다.
- 최초 빌드는 종료 코드 0·113경로 통과지만 개발 WebSocket 24678 EPERM 경고가 있었다.
  승인된 로컬 실행으로 다시 빌드해 해당 경고 없이 완료했다.
- 최종 Prisma·인증·DB의 예상 밖 실패는 없다. 브라우저의 API 모드는 가짜 서버 응답을
  사용하므로 운영 DB·운영 인증·배포·실제 기기 간 동기화 검증으로 확대하지 않는다.

## 파일과 재실행

- 신규 구현: `src/features/mealPlans/reviewedDinnerCatalog.js`,
  `src/components/MealQuantityDetails.jsx`.
- 신규 테스트: `reviewedDinnerCatalog.test.js`, `reviewedDinnerGeneration.test.js`,
  `reviewedDinnerAllocation.test.js`, `reviewedDinnerPersistence.test.js`, `MealQuantityDetails.test.jsx`.
- 연결: `mealPlanCatalog.js`, `mealPlanDomain.js`, `mealPlanRepository.js`, `mealPlanAllocation.js`,
  `MealPlanShoppingPreview.jsx`, `MealPlanPage.jsx` 및 기존 domain/page/E2E 테스트.
- 문서: 이 파일, README, CHANGELOG, PRD_V2_PROGRESS, 이전 수량 확인 기록의 후속 링크.
  전용 브랜치에 앞서 있던 미커밋 저장·배분·수량 변경도 유지했다.

실제로 실행한 주요 명령(전용 작업 공간 기준):

```sh
npm run test:run -- --exclude '.worktrees/**' --reporter=json --outputFile=/private/tmp/fridgemate-prd-v2-meal-connection-1vw2tnp3/final-tests.json
npm run lint
npm run build
npm run test:e2e -- e2e/meal-plan.spec.js --project=local-only --grep 'source-reviewed dinner' --workers=1 --output=/private/tmp/fridgemate-prd-v2-meal-connection-1vw2tnp3/browser-target --reporter=list
npm run test:e2e -- --workers=2 --output=/private/tmp/fridgemate-prd-v2-meal-connection-1vw2tnp3/browser-final --reporter=json
git diff --check
```

브라우저 JSON은 명령의 전체 출력을 받아 `browser-final.json`으로 보존했다. 재실행 시
기존 증거를 덮지 말고 새 출력 폴더를 사용한다. Node 24.19.0의 PATH는
`/Users/lee/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin`이다.
package.json/lockfile 일치를 확인한 `/private/tmp/fridgemate-weekly-pr-CtPuVjtR/node_modules`를
임시 연결했다. 검사 후 연결만 제거한다. 새 의존성 설치·manifest 변경·원본 .env 복사·
실제 모델 API 호출은 하지 않았다. 다른 작업 트리 테스트 결과는 포함하지 않았다.

테스트 먼저 작성하는 스킬에 따라 예상 실패를 먼저 확인했다. React 가이드에 따라 필요량은
추가 상태·effect 없이 렌더에서 계산했고, 디자인 가이드는 기존 색상과 모바일 세로 배치를
유지하면서 원문 근거를 접어 볼 수 있게 적용했다. PDF 검토 절차로 해당 원문 쪽의 이미지를
확인했다. 별도 읽기 검토의 두 지적(원문 인분 표시·저장 자료 손상)을 반영하고 재검토했다.

## 다음 범위와 한계

B1의 20–30개 작업 목표에는 아직 못 미친다. **기존 편집 16 / 별도 반찬 구성 요소 4 /
원문 식재료량 대조 한그릇 2 / 모든 조리 투입량까지 정량 완료 한그릇 0**으로 구분한다.
직접 조리·성인 1~2인 실사용 적합성은 후속 관찰 대상이다.
원본 루트에서 별도로 작업 중인 레시피 분량 계약과 PRD의 미래 식단 배분용 실제 재고량은
목적·재료 식별 규칙이 다르다. 필드명만 맞춰 복사하거나 자동 합치지 않았다.

다음은 B2의 출처별 수동 장보기·구매 기록 보존이다. 기존 재구매 목록은 소비 완료 재료를
복원하는 기능이므로 새 식단/수동 행을 그 목록에 섞지 않는다. 수동 체크나 구매 메모가
실제 입고로 오인되지 않게 분리하고, 메뉴 변경 때 수동 기록·구매 이력을 보존해야 한다.
이는 아직 설계 검토만 했으며 구현한 기능이 아니다. B3 실제 입고·소비·취소, B4 날짜 이동,
이후 계측·파일럿·예산·공유·운영 정책도 남아 있다. 운영 변경은 별도 승인 대상이다.
