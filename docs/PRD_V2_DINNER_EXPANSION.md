# PRD v2: 원문 대조 한그릇 메뉴 4개 추가

기록일: 2026-09-16. 전용 작업 공간 `/private/tmp/fridgemate-prd-v2-b1-Lba78Azy`.
브랜치 `codex/prd-v2-quantity-contract`, HEAD `986051a6693a20e305adaff355530c5a2779774c`.
앞선 미커밋 작업을 유지한 후속 단위다. 원본 루트를 수정하거나 그곳의 동시 변경을 가져오지
않았으며 commit/push/merge/배포는 하지 않았다. 전체 PRD 완료 기록이 아니다.

## 변경과 원문 근거

기존 원문 대조 한그릇 2개에 4개를 추가했다. **기존 편집 메뉴 16개 / 별도 반찬 구성 요소
4개 / 식재료량 원문 대조 한그릇 6개 / 모든 과정 투입량까지 정량 완료 한그릇 0개**다.
모든 새 후보에도 양을 확인하지 못한 조리용 물이 있다. 식재료의 원문 인분·g 표기 대조와
직접 조리·영양 전문가 검수·개인에게 적절한 한 끼 분량을 구분한다.

공식 자료는 [식약처 우리 몸이 원하는 삼삼한 밥상 II](https://www.foodsafetykorea.go.kr/upload/20170417/20170417053825_1492418305244.pdf)다.
이전 단계에서 보존한 원본 PDF의 SHA-256을 다시 확인했다.
`f3ae4dce2cbde7e8024932ee7e87d20bd76230009848dbc7b3813dd4e4e42f6c`.
재료표·조리 단계를 텍스트와 렌더 이미지 양쪽에서 직접 대조했다. 책자 PDF·사진을 앱에
복제하지 않았으며 조리 흐름은 별도로 요약했다. 이 자료는 정적 원문 대조이며 원격 문서
변경 감시가 아니다. 책자의 영양 수치나 건강 효과는 사용하지 않았다.

| 추가 메뉴 | 원문 위치·인분 | 보존·미확인 경계 |
| --- | --- | --- |
| 채소 자장면 | PDF 15 / 인쇄 28–29쪽, 1인분 | 13행, 중화면 200g. 검은콩 불리기·완두콩 데치기·면 삶기·녹말물의 물 4항목 미정량. 새송이버섯 투입 시점 미명시도 대조 설명에 보존 |
| 두유 파스타 | PDF 21 / 인쇄 40–41쪽, 1인분 | 8행, 페투치네 120g·두유 400g. g→ml 변환 없음. 향내기 후 고명으로 쓰는 마늘 40g은 원문의 한 행 유지. 면 삶는 물 미정량 |
| 감자밥 | PDF 25 / 인쇄 48–49쪽, 1인분 | 7행, 쌀 200g은 불리기 전 투입량. 물과 1:1의 무게/부피·불린 쌀 기준 미명시로 물 g 계산 금지. 쌀·목이버섯 불리기와 취사 물 3항목 미정량 |
| 된장비빔밥 | PDF 28 / 인쇄 54–55쪽, 1인분 | 15행, 현미·쌀 각 60g. 재료표의 비름나물을 시금치로 대체하지 않음. 곡물 불리기·취사·데침 물 3항목 미정량 |

원문의 특이한 괄호 분량도 임의로 교정하지 않았다. 완두콩은 생물/냉동을 추정하지 않고
판매 상태로 구분했다. 목이버섯은 불리기 전, 칵테일새우는 생/가열 여부를 단정하지 않는
판매 상태다. 추가 볶음 기름이나 가식부·조리 수율을 만들어 넣지 않았다.

## 생성·제외·수량 정책

- 모든 새 메뉴를 실제 생성 후보, 1/2인분 환산, 확정 저장, 전체 미래 식단 장보기에 연결했다.
  원문 행·용도·인분은 스냅샷에 보존하고 필요량만 파생한다. 확정·장보기로 실제 재고는 바뀌지 않는다.
- 확인한 식품명 7쌍을 이 카탈로그의 `normalizedName`에 기록했다. 페투치네→파스타면,
  올리브오일→올리브유, 흰 후춧가루→후추, 파마산치즈가루→파마산 치즈,
  쇠고기(우둔)→소고기, 칵테일새우→새우, 저염간장→간장이다.
- 제외 필터는 원문 이름과 위 식품명을 모두 확인한다. 고정한 메뉴는 삭제하지 않고 원문
  재료 이름으로 충돌을 알린다. 취향 필터이며 알레르기·복합 제품 성분·교차 접촉 판정이 아니다.
- **전역 별칭 사전·추천 점수 가중치·정량 식별값은 변경하지 않았다.** 위 연결은 수량 호환
  근거가 아니다. 쌀/밥, 저염간장/간장 등은 원문 `ingredientKey`·상태를 별도로 유지한다.
- 여러 과정 물을 안정된 별도 행 ID로 보존한다. 이전 두 메뉴의 과정 ID는 그대로다.
- 엔진 `weekly-dinner-rules-v3`, 통합 카탈로그 `2026-09-16.2`, 원문 대조 버전
  `mfds-dinners-2026-09-16-v2`다. 기존 저장본을 일괄 재작성하지 않는다. 생성 입력 재현은
  동일 엔진/카탈로그 범위이며 과거 엔진 재실행이나 편집 전체 이력은 아니다.

## 검증 기록

증거 폴더 `/private/tmp/fridgemate-prd-v2-catalog-RSnMnPQ6`.

| 단계 | 실제 결과 |
| --- | --- |
| 변경 전 `baseline.json` | 이 작업 공간 163파일, 1,410/1,410 통과 |
| 새 카탈로그 RED `expansion-red.json` | 24/24 예상 assertion 실패. 메뉴 부재·선택 결과 불일치이며 import/환경 오류 아님 |
| 데이터 연결 뒤 `exclusion-red.json` | 17통과·7실패. 일반 식품명 제외에도 새 후보가 남는 문제를 재현 |
| 수정 뒤 `target-green.json` | 카탈로그·생성·저장 등 4파일, 57/57 통과 |
| 전체 중간 `integration-before-fixtures.json` | 164파일, 1,438개 중 4실패. 아래의 기존 후보 집합 전제 차이 |
| 최종 `final-tests.json` | 164파일, **1,438/1,438 통과**, skip/todo 0, 작업 공간 밖·`.worktrees` 테스트 0 |
| 린트·빌드 | 종료 코드 0. 공개 정적 경로 113개·사이트맵·noindex 검사 통과 |
| 새 브라우저 최초 `browser-target` | 2실패. 확인하지 않은 테스트 재고를 확인된 것으로 가정한 입력 오류 |
| 새 브라우저 `browser-target-confirmed` | 실제 수량 확인 UI를 거쳐 **2/2 통과**, 7.1초 |
| 최종 전체 브라우저 `browser-final.json` | **8파일, 41/41 통과**, skip/retry/flaky 0, 49.2초 |

최종 전체 단위·통합 및 브라우저 검사에 예상 밖 실패는 없다. Prisma·인증·DB 구현을
바꿔 실패를 회피하지 않았다. 브라우저와 전체 단위 검사는 동시에 실행하지 않았다.

이번 단위에서 단위·통합 테스트 28개를 추가했다. 독립적으로 옮긴 원문 행·2인분 계산·과정 물,
생성·제외·고정 충돌 24개와 실제 저장소 확정·100g 확인 재고 배분 4개다. 기존 카탈로그의
정확한 이름·쪽수·과정 행 수 기대값과 생성 버전 기대값은 추가한 메뉴/버전에 맞게 갱신했다.

중간 실패를 최종 결과로 덮지 않는다.

- 기존 domain 테스트 4개는 밥·파스타면·소면을 제외하면 모든 후보가 없다는 전제였다.
  새 쌀·중화면은 별개 재료이므로 해당 입력에 쌀·중화면을 추가했다. 브로콜리 파스타만
  남기는 사례에는 두유도 추가했다. 기존 상태·메시지·보존 assertion은 삭제하거나 약화하지 않았다.
- 기존 구매 메모 브라우저 사례도 리조또만 남기는 입력에 쌀·중화면을 추가했다. 기존 검증은 유지했다.
- 새 브라우저 두 사례의 최초 실패는 임의로 넣은 사과 재고에 수량 확인값이 없어서 생겼다.
  현재 정량 계약에서 미확인 재고는 식별값도 미확인이므로 알려진 부족량을 확정하지 않는다.
  확인 필요 9/17항목이 나온 근거를 코드·오류 화면에서 확인하고, 사과 1개·조리 전을 정상
  수량 확인 UI로 저장하는 설정 절차만 추가했다. 앱 계산과 부족량 기대값을 바꾸지 않았다.
  이 보수적인 경계의 사용성은 후속 평가 대상이다.
- 로컬 브라우저 성공은 운영 DB·실제 인증 서버·배포·실기기 성능 검증이 아니다.

390px 화면에서 두유 파스타의 원문 400g/2인분 800g과 채소 자장면의 중화면 400g·
미정량 물 4항목을 확인했다. 실제 생성·확정·새로고침과 원본 재고/메모 불변을 검사했다.
두유 파스타 상세 및 자장면 장보기 캡처를 육안으로 확인했으며 가로 넘침 검사도 통과했다.

## 변경 파일과 재실행

- 구현: `reviewedDinnerCatalog.js`, `mealPlanCatalog.js`, `mealPlanDomain.js`.
- 새 테스트: `src/features/mealPlans/__tests__/reviewedDinnerExpansion.test.js`.
- 기존 테스트: `reviewedDinnerCatalog.test.js`, `reviewedDinnerGeneration.test.js`,
  `reviewedDinnerPersistence.test.js`, `mealPlanDomain.test.js`, `e2e/meal-plan.spec.js`.
- 문서: 이 파일, README, CHANGELOG, PRD_V2_PROGRESS, 이전 한그릇 연결 기록의 후속 링크.
- 이번 단위에서 DB/인증/서버/전역 재료 사전/기존 추천 계산/패키지·설정 파일은 수정하지 않았다.
  앞선 단계의 미커밋 변경과 혼동하지 않는다.

실제로 실행한 주요 명령(위 전용 작업 공간):

```sh
npm run test:run -- src/features/mealPlans/__tests__/reviewedDinnerExpansion.test.js --exclude '.worktrees/**' --reporter=json --outputFile=/private/tmp/fridgemate-prd-v2-catalog-RSnMnPQ6/expansion-red.json
npm run test:run -- --exclude '.worktrees/**' --reporter=json --outputFile=/private/tmp/fridgemate-prd-v2-catalog-RSnMnPQ6/final-tests.json
npm run lint
npm run build
npm run test:e2e -- e2e/meal-plan.spec.js --project=local-only --grep 'expanded dinner' --workers=1 --output=/private/tmp/fridgemate-prd-v2-catalog-RSnMnPQ6/browser-target-confirmed --reporter=list
PLAYWRIGHT_JSON_OUTPUT_NAME=/private/tmp/fridgemate-prd-v2-catalog-RSnMnPQ6/browser-final.json npm run test:e2e -- --workers=2 --output=/private/tmp/fridgemate-prd-v2-catalog-RSnMnPQ6/browser-final --reporter=json,list
git diff --check
```

재실행은 새 증거 폴더를 사용한다. Node 24.19.0 PATH는
`/Users/lee/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin`.
package.json/lockfile의 동일성을 확인한 `/private/tmp/fridgemate-weekly-pr-CtPuVjtR/node_modules`를
임시 연결해 재사용했다. 검사 후 링크만 제거하며 의존성 원본은 삭제하지 않는다.
새 의존성 설치·원본 .env 복사·모델 API 호출은 없다.

PDF 스킬의 렌더 대조 절차와 테스트 우선 스킬의 예상 실패 확인을 적용했다. 원본 PDF는
`/private/tmp/fridgemate-prd-v2-meal-connection-1vw2tnp3/mfds-samsam-book2.pdf`, 이번 렌더는
증거 폴더의 `tmp/pdfs/page-{15,21,25,28}.png`에 있다. 임시 파일의 영구 보존은 보장하지 않으므로
공식 URL·해시·쪽수·앱의 대조 버전을 함께 기록했다.

## 남은 범위

B1의 20–30개 작업 목표와 실제 성인 1~2인 사용 적합성은 아직 충족하지 않았다. 확인하지 않은
양·시간·가격·영양값을 생성하지 않는다. B3 실제 입고·소비·취소, B4 이동·재조정, 이후 계측·
파일럿·예산·공유·운영 검증도 남아 있다. 구매 메모를 실제 입고로 해석하지 않는다.
