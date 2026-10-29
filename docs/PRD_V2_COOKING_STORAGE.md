# PRD v2 — 조리·실제 소비·취소 저장 기반

작업일: 2026-09-19. **B3의 저장 단위이며 화면 연결·전체 PRD 완료·운영 배포가 아니다.**

이 문서는 저장 단계 당시의 기록을 보존한다. 이후 화면 연결·최신 검증은
[조리·실제 사용량·취소 화면 연결](PRD_V2_COOKING_UI.md)을 따른다.

## 범위와 변경 전 기준

- 작업 트리: `/Users/lee/fridgemate/.worktrees/prd-v2-recovered-20260919`.
- 브랜치: `codex/prd-v2-recovered-20260919`.
- 기준 커밋: `986051a6693a20e305adaff355530c5a2779774c`.
- [이전 소비 계산 준비](PRD_V2_CONSUMPTION_PREPARATION.md)의 미커밋 변경을 보존해 이어서 작업했다.
- 착수 시 같은 작업 트리에서 **167파일 1,529개 통과**, 실패/skip/todo 0을 새로 확인했다.
- 원본 루트·추천 정책 실습·복구 아카이브를 수정하지 않았다. commit/push/merge/배포 없음.
- DB v6와 기존 여섯 저장소를 유지한다. 의존성·별칭·추천 가중치·인증·서버·DB 마이그레이션은 변경하지 않았다.

## 이번 구현

`recordMealCooking`은 확정된 예정 끼니에 조리 사실을 저장한다. 사용량을 확인한 경우에는 사용한
재고 배치별 **실제 양**을 받는다. 계획량 200g인 테스트 끼니에 실제 150g을 입력하면 150g만 차감한다.
입력 목록이 실제 사용 재고 전부라는 별도 확인이 필요하며 부분 입력을 완전한 소비로 간주하지 않는다.
원본 재고·수량 확인·식단·이벤트 네 저장소가 같은 트랜잭션에서 모두 저장된 뒤 성공을 반환한다.

사용량을 모르는 조리도 별도로 기록한다. 원본 재고의 수량 문구는 그대로 두고, 사용 가능성이 있는
재고의 확인값을 해제해 이후 장보기에서 확실한 재고로 쓰지 않는다. 필수 재료는 `selected: false`여도
포함한다. 미선택 선택 재료는 제외하며 과정 투입 재료도 확인한다. 식품 식별값을 알 수 없는 줄이
있으면 해당 범위의 활성 확인 재고를 보수적으로 미확인 처리한다. 팬트리 보유를 숫자로 바꾸지 않는다.

조리된 끼니는 미래 수요에서 제외한다. 생성·교체·고정·건너뛰기와 일반 저장·확정으로 완료 끼니의
내용을 바꾸거나 조리 상태를 위조할 수 없다. 원본 조리법·분량은 조리 시점 스냅샷으로 보존한다.
같은 끼니에 변경 중인 다른 초안이 있으면 조리 저장 전에 그 초안을 먼저 정리하도록 거절한다.

## 두 가지 취소는 다르다

1. `reverseMealConsumption`: 현재 재고에 **원래 소비량만** 더한다. 예를 들어 나중 수정·입고 후
   현재 650g이면 150g 취소로 800g이다. 나중에 생긴 별도 500g 입고 배치와 메모는 보존한다.
   조리 사실은 남고 상태는 `reversed`다. 수량 확인은 해제하며 과거 확인값을 되살리지 않는다.
2. `cancelMealCooking`: 조리 사실을 별도 반대 이벤트로 취소한다. 이미 재고를 차감했다면 먼저
   소비 반영을 취소해야 한다. 이 호출 자체는 물리적 재고를 바꾸지 않으며 끼니를 예정 상태로 돌린다.

사용량 미확인 조리는 소비 취소 없이 조리 사실만 취소할 수 있지만, 예전 재고 확인을 자동 복원하지 않는다.
재고 배치가 삭제되거나 정체성·상태·단위가 바뀌었거나 현재 수량을 모르면 임의로 취소량을 더하지 않는다.

식단 삭제는 소비 이력을 삭제하지 않는다. 삭제 후에도 반영 취소와 조리 취소가 가능하며 삭제한 식단을
재생성하지 않는다. 활성 조리 이력이 있는 같은 날짜를 다시 예정 수요로 만들려는 일반 저장은 차단한다.
소비 취소만으로 이 제한을 해제하지 않고 조리 사실 취소까지 완료해야 새 식단을 만들 수 있다.

## 중복·경쟁·손상 방어

- 비동기 저장 전에 요청을 복사하고 scope·날짜·주차·저장 버전·재고 원본 토큰·단위·정밀도를 검사한다.
- 동일 요청 재시도와 같은 끼니에 대한 동일 내용의 다른 요청 ID는 원래 결과를 돌려주며 두 번 차감하지 않는다.
  사용량·버전·요청 내용이 달라진 요청을 성공으로 바꾸지 않는다. 정확한 재시도용 입력을 보존해야 한다.
- 조리·소비·소비 취소·조리 취소 네 종류를 검증하고 원본과 연결된 주차·날짜·수량을 대조한다.
  누락된 소비 이력, 다른 날짜로 바뀐 소비, 중복 역반영, 원래 양과 다른 취소를 거절한다.
- 조리 이벤트에는 입고 전용 `purchaseNoteId`를 저장하지 않는다. 기존 장보기 reader는 검증된 입고
  이벤트만 구매 목록으로 반환하며 조리 이벤트와 공존한다. 손상된 입고도 검증을 건너뛰지 않는다.
- 게스트와 로그인 계정의 동일 요청 ID는 서로 다른 저장 범위다. 이 기능의 이력을 서버로 보내지 않는다.
- 재시도 확인값에는 로컬 재고 정보가 포함될 수 있다. 분석 이벤트·애플리케이션 로그에 전송하지 않는다.

## 변경 파일

| 경로 | 역할 |
| --- | --- |
| `src/db/indexedDB.js` | 기존 네 저장소의 원자적 조리 트랜잭션 |
| `src/features/mealPlans/mealCookingRepository.js` | 조리·소비 반영 취소·조리 사실 취소 API |
| `src/features/mealPlans/mealCookingEvents.js` | 개별 이벤트와 연결 이력 검증 |
| `src/features/mealPlans/mealPlanRepository.js` | 완료 상태 스키마, 일반 편집과 삭제 후 재생성 보호 |
| `src/features/mealPlans/mealPlanDomain.js` | 완료 끼니 보존·상태별 안내 |
| `src/features/shopping/shoppingRepository.js` | 입고·조리 이벤트 구분, 입고 검증 재사용 |
| `src/db/__tests__/mealCookingTransaction.test.js` | 네 저장소 완료·실패·범위 검사 |
| `src/features/mealPlans/__tests__/mealCookingEvents.test.js` | 개별 이벤트 형식 검사 |
| `src/features/mealPlans/__tests__/mealCookingHistory.test.js` | 원본·반대 이벤트 연결 검사 |
| `src/features/mealPlans/__tests__/mealCookingRepository.test.js` | 실제 저장·중복·미확인·취소·재생성 통합 검사 |
| `src/features/mealPlans/__tests__/mealCookingRollback.test.js` | 저장 직후 오류 주입과 원시 네 저장소 비교 |
| `src/features/mealPlans/__tests__/mealPlanCookingProtection.test.js` | 완료 끼니 생성·편집·저장 보호 |
| `src/features/shopping/__tests__/shoppingCookingEvents.test.js` | 입고/조리 이력 공존 회귀 검사 |
| `README.md`, `CHANGELOG.md`, `docs/PRD_V2_PROGRESS.md`, 이 문서 | 상태·검증·미완료 경계 |

## 검증 이력

테스트 우선 개발 스킬에 따라 정상 반환·수치·부족량·불변성 assertion의 실패를 먼저 확인하고 구현했다.
처음 통합 검사에서 존재하지 않는 함수에 대한 assertion을 `rejects.toThrow`가 잡아 입력 검증으로
오인하는 문제를 발견했다. 해당 도우미를 고치고 부정 입력 9개가 실제로 실패하는 것을 다시 확인했다.
초기 우연한 통과 9개는 입력 거부 검증 근거로 사용하지 않는다.

구현 검토에서도 필수 재료의 미확인 전파 누락, 다른 날짜의 소비 역반영, 누락된 소비의 재시도 성공,
손상된 입고를 무시하는 네 실패를 재현한 뒤 해결했다. 식단 삭제 후 수요 재생성과 이력 연결의 보호도
독립적인 실패를 먼저 확인했다. 취소 실패 롤백 7개는 이미 구현된 동작의 추가 특성 검사로 처음부터
통과했으며 RED였다고 기록하지 않는다. 테스트 삭제·skip이나 기대값 완화로 실패를 숨기지 않았다.

| 검증 | 결과 |
| --- | --- |
| 변경 전 전체 기준선 | 167파일 1,529개 통과, 실패/skip/todo 0 |
| 신규 조리 관련 검사 | 7파일 215개 추가, 최종 모두 통과 |
| 최종 전체 단위·통합 | 174파일 1,744개 통과, 실패/skip/todo 0 |
| 린트·diff 공백 검사 | 종료 코드 0 |
| 빌드·정적 페이지 | 529모듈, 공개 경로 113개·사이트맵·개인 앱 noindex 통과 |
| 기존 전체 브라우저 회귀 | 9파일 42개 통과, 실패/flaky/skip 0, 자동 재시도 0, 2 workers, 49.7초 |

실제 단위 테스트 경로 목록은 전부 위 전용 작업 트리 안이었다. `.worktrees/**`를 제외했고
다른 작업 트리 결과를 합산하지 않았다. 이번 전체 실행에서 예상 밖 실패는 없었다. 브라우저 출력의
색상 환경변수 경고와 의도적으로 재현한 가져오기 요청 제한 안내는 테스트 실패가 아니었다.
브라우저는 단위 검사가 끝난 뒤 독립적으로 실행했다. 빌드와 브라우저를 위한 localhost 소켓만
허용했으며 운영 서비스를 호출하거나 배포하지 않았다.

### 재실행 명령

위 전용 작업 트리에서 Node 24.19.0 경로
`/Users/lee/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin`을 PATH 앞에 둔다.
이번 단계에서 의존성을 다시 설치하거나 Prisma를 생성·연결하지 않았다.

```sh
npm run test:run -- --exclude '.worktrees/**' --reporter=json --outputFile=/private/tmp/fridgemate-prd-v2-cooking-yDRygCC1/full-final.json
npm run lint
npm run build
PLAYWRIGHT_JSON_OUTPUT_NAME=/private/tmp/fridgemate-prd-v2-cooking-yDRygCC1/browser-final.json npm run test:e2e -- --workers=2 --retries=0 --reporter=json --output=/private/tmp/fridgemate-prd-v2-cooking-yDRygCC1/browser-artifacts
git diff --check
git diff --exit-code -- package.json package-lock.json prisma server
```

위는 실제 최종 실행 명령이다. 다시 실행할 때는 과거 결과를 덮어쓰지 않도록 **새 결과 디렉터리**를
만들어 경로를 바꾼다. 중간 RED를 재현하려고 현재 구현이나 테스트 기대값을 되돌리지 않는다.

### 보관과 재현

원본 검증 자료: `/private/tmp/fridgemate-prd-v2-cooking-yDRygCC1`.
소스와 검증 보관본: `/Users/lee/fridgemate/.worktrees/prd-v2-cooking-evidence-20260919`.
`source-files.tar.gz`에는 위 기준 커밋 이후의 기존 변경과 이번 변경을 함께 넣으며,
`source-manifest.json`의 개별 SHA-256과 `verification.json`의 아카이브 해시로 검증한다.
`.env`·개인 키·의존성·DB·원본 루트의 변경은 넣지 않는다. 기존 복구 아카이브는 덮어쓰지 않는다.
실제 압축 해제 후 경로 목록과 모든 파일 해시를 대조한다.

복원은 기준 커밋의 **새 빈 작업 트리**에서만 한다. 해당 새 작업 트리에 소스 아카이브를 풀고
manifest의 해시를 확인한 뒤 같은 lockfile로 의존성을 준비한다. 원본이나 기존 미커밋 변경 위에
덮어쓰지 않으며 reset/clean/stash로 재현하지 않는다. 이것은 이번 저장 기능 완료 상태이며,
이전 순수 계산 단계는 별도 `prd-v2-recovery-evidence-20260919/completed-source-files.tar.gz`에 남아 있다.

## 다음 단계와 한계

- **화면에서 이 새 저장 API를 호출하지 않는다.** 현재 주간 화면의 완료 상태 표현, 실제 사용량 입력,
  수량 미확인 경고, 두 취소 행동, 삭제된 식단의 남은 이력에서 취소하는 동선을 다음 단위에 연결한다.
- 기존 브라우저 검사 통과는 기존 화면 회귀 검증이다. AT-07/08/14의 새 사용자 동선 완료 증거가 아니다.
- 구조가 손상된 이력은 자동 삭제/복구하지 않고 저장을 거절한다. 손상 복구 UI는 별도 작업이다.
- 저장 때 이력 전체를 읽고 네 저장소를 잠근다. 대규모 이력·저사양 기기 성능은 측정하지 않았다.
- 자동 업로드·다른 기기와의 소비 이력 동기화, 확인되지 않은 단위 환산, 영양·안전 판정은 없다.
- B1 카탈로그 확충, B3 화면·실제 흐름, B4 이후와 실제 사용자 파일럿은 계속 남아 있다.
