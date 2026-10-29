# PRD v2 — 작업 상태 복구와 소비·취소 계산 준비

검증일: 2026-09-19. **B3 전체 완료나 배포 기록이 아니다.**

후속 [조리·소비·취소 저장 기반](PRD_V2_COOKING_STORAGE.md)에서 저장·중복 방지·미확인 전파를
연결했다. 아래는 연결 전 단계의 당시 기록이며, 화면 연결은 후속 단위에서도 아직 남아 있다.

## 이번 완료 단위

확인한 실제 사용량을 차감하고 취소할 때 현재 재고에 원래 소비량만 더하는 순수 계산을 추가했다.
UI·저장소에서는 아직 이 함수를 호출하지 않는다. 이 단계만으로 실제 소비 저장·중복 제출 방지·
조리 기록·사용량 미확인 전파·AT-07/08/14 전체 통과를 주장하지 않는다.

테스트 우선 개발 스킬에 따라 새 58개 검사가 assertion 차이로 실패하는 것을 먼저 확인한 뒤
구현했다. 입력 재고를 직접 쓰지 않고, 다음 저장 단계가 원자적으로 반영할 변경값과 이벤트를 반환한다.

## 작업 트리 복구

- 이전 작업 폴더: `/private/tmp/fridgemate-prd-v2-b1-Lba78Azy`.
- 9월 19일 확인 시 `.git` 연결과 기준 커밋의 추적 파일 473개가 없었다. Git은 해당 작업 트리를
  `prunable`로 표시했다. 파일이 사라진 원인은 확정하지 않았다. 삭제를 실행하거나 정리하지 않았다.
- 기준 커밋 `986051a6693a20e305adaff355530c5a2779774c`의 새 작업 트리를 만들고 남은 변경 64개를
  복사했다. 기존 임시 폴더와 원본 루트의 변경은 그대로 보존했다.
- 현재 작업 트리: `/Users/lee/fridgemate/.worktrees/prd-v2-recovered-20260919`.
- 현재 브랜치: `codex/prd-v2-recovered-20260919`. 커밋·푸시·병합·배포 없음.
- 복사 당시 64개 경로와 SHA-256은 `PRD_V2_RECOVERY_MANIFEST.json`에 기록했다. 이 중 소비 모듈은
  빈 export였고 새 소비 테스트는 두 개였다. 이번에 그 두 파일의 구현과 검사를 확장했다.
- 없어진 추적 파일은 기준 커밋에서 가져왔다. 사라진 미추적 파일이 전혀 없었다는 보장은 할 수 없다.
  복구 후 과거 166개 테스트 파일 목록이 일치하고 1,471개가 다시 통과했으며 빌드·브라우저도 확인했다.
  테스트 이름 한 개는 `new Date()`가 이름에 포함되어 실행 날짜만 달랐다.

이전 의존성 경로 `/private/tmp/fridgemate-weekly-pr-CtPuVjtR/node_modules` 역시 Vitest 실행 파일 등이
없어 재사용하지 않았다. 원본 루트의 의존성은 package/lockfile이 달라 연결하지 않았다. 새 작업 트리에
**기존 lockfile 그대로** 설치했으며 package.json·package-lock.json은 기준 커밋과 일치한다.
설치 스크립트를 자동 실행하지 않고 Prisma 클라이언트 생성만 별도로 수행했다. 첫 생성은 캐시의
`utime` 권한 오류로 실패했고, 권한을 확보한 동일 명령으로 성공했다. DB 연결·마이그레이션은 없었다.

## 변경 파일과 계약

| 파일 | 역할 |
| --- | --- |
| `src/features/mealPlans/inventoryConsumptionDomain.js` | 실제 소비·반대 이벤트 계산, 범위·버전·수량 검증 |
| `src/features/mealPlans/__tests__/inventoryConsumptionDomain.test.js` | 58개 독립 수치·부정 입력·불변성 검사 |
| `README.md`, `CHANGELOG.md`, `docs/PRD_V2_PROGRESS.md` | 이번 완료 범위와 미완료 경계 |
| 이 문서, `docs/PRD_V2_RECOVERY_MANIFEST.json` | 복구·검증 근거 |

`prepareConsumption`은 확인된 재고 원본과 수량 review, 화면이 본 버전/sourceToken, 실제 사용량,
scope·operationId·slotId·시각을 받는다. 기존 수량 검증 규칙을 그대로 사용하고 g/kg·ml/l·개만
각 차원 안에서 환산한다. 0.001 기준 정수 계산으로 소수 오차를 피하며 반올림으로 잘못된 입력을
구제하지 않는다. 재고 초과·0/음수 소비·미확인량·존재하지 않는 슬롯 날짜·오래된 버전·다른 계정·
중복 배치·빈 배열/희소 배열을 거절한다. 기한에 따른 식품 안전 판정 기능은 아니다.

반환값은 `{ changes: [{ ingredient, review }], event }`이다. 남은 양과 원본 연결을 함께 갱신하고
메모·기한 등 사용자 속성은 유지한다. pendingCreate 재고는 그대로 pendingCreate이며 나머지는
pendingUpdate다. 확인된 0 재고는 기존의 boolean 소비 완료/재구매 동작으로 전환하지 않는다.

`prepareConsumptionReversal`은 보존된 소비 이벤트와 **현재** 재고를 받아 원래 소비량만 더한다.
예: 현재 650g + 취소 150g = 800g, 이후 다른 소비로 현재 100g이면 250g이다. 과거 300g 스냅샷으로
복원하지 않는다. 별도 입고 배치는 건드리지 않는다. 같은 배치의 식품 정체성·조리 상태·단위 차원이
바뀌거나 삭제·미확인 상태이면 자동 복구하지 않고 확인을 요구한다. 이벤트 원본과 입력은 변경하지 않는다.

이 함수는 저장 권한·트랜잭션·요청 중복 방지의 대체물이 아니다. 다음 단계에서 소비/취소 이벤트의
유일성 및 기존 반영 여부를 같은 트랜잭션으로 검사하고, 재고·review·식사 상태·이벤트를 함께 저장해야 한다.
완료된 슬롯의 편집 보호와 사용량 미확인 전파도 함께 구현해야 한다. 현재 구매 이력 reader는 입고
이벤트만 허용하므로 새 이벤트를 기존 저장소에 넣기 전에 종류별 검증 계약도 연결해야 한다.

## 실제 검증

| 실행 | 결과 |
| --- | --- |
| 복구 기준선, 새 소비 파일 제외 | 166파일, 1,471 통과, 실패/skip/todo 0 |
| 새 소비 검사 RED | 58개 모두 예상 assertion 실패, import/환경 오류 아님 |
| 새 소비 검사 GREEN | 58/58 통과 |
| 최종 전체 단위·통합 | 167파일, 1,529 통과, 실패/skip/todo 0 |
| 린트 | 종료 코드 0 |
| 빌드·정적 검증 | 528 모듈, 공개 경로 113개·사이트맵·개인 앱 noindex 검사 통과 |
| 기존 전체 브라우저 회귀 | 9파일 42개 통과, 자동 재시도 0, 2 workers, 44.1초 |

단위 JSON의 실제 실행 경로는 모두 새 작업 트리 내부였다. `.worktrees/**`를 제외했으며 다른 작업
트리 결과를 합산하지 않았다. 첫 빌드는 정적 생성 중 로컬 WebSocket 소켓 EPERM 경고가 있었으나
종료 코드 0이었다. 권한을 확보한 빌드를 다시 실행해 해당 오류 없이 통과했다. 브라우저는 색상 환경변수
경고와 의도적으로 재현한 가져오기 제한 오류 안내를 출력했지만 실패·flaky·skip은 없었다.
브라우저 검사는 복구한 기존 기능의 회귀 검사이며 새 순수 계산의 화면 연결 증거는 아니다.

원본 JSON/브라우저 산출물: `/private/tmp/fridgemate-prd-v2-recovered-check-PI17deyi`.
보존 사본: `/Users/lee/fridgemate/.worktrees/prd-v2-recovery-evidence-20260919/validation`.

## 실제 실행 명령

작업 경로는 위 새 작업 트리다. Node 24.19.0은
`/Users/lee/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin`을 PATH 앞에 두었다.

```sh
npm ci --ignore-scripts --no-audit --no-fund --cache /private/tmp/fridgemate-prd-v2-recovery-npm-cache-20260919
npm run prisma:generate
npm run test:run -- --exclude '.worktrees/**' --exclude 'src/features/mealPlans/__tests__/inventoryConsumptionDomain.test.js' --reporter=json --outputFile=/private/tmp/fridgemate-prd-v2-recovered-check-PI17deyi/baseline.json
npm run test:run -- src/features/mealPlans/__tests__/inventoryConsumptionDomain.test.js --exclude '.worktrees/**' --reporter=json --outputFile=/private/tmp/fridgemate-prd-v2-recovered-check-PI17deyi/consumption-red.json
npm run test:run -- src/features/mealPlans/__tests__/inventoryConsumptionDomain.test.js --exclude '.worktrees/**' --reporter=json --outputFile=/private/tmp/fridgemate-prd-v2-recovered-check-PI17deyi/consumption-green.json
npm run test:run -- --exclude '.worktrees/**' --reporter=json --outputFile=/private/tmp/fridgemate-prd-v2-recovered-check-PI17deyi/full-final.json
npm run lint
npm run build
PLAYWRIGHT_JSON_OUTPUT_NAME=/private/tmp/fridgemate-prd-v2-recovered-check-PI17deyi/browser-final.json npm run test:e2e -- --workers=2 --retries=0 --reporter=json --output=/private/tmp/fridgemate-prd-v2-recovered-check-PI17deyi/browser-artifacts
```

RED는 구현 전에 실행한 기록이다. 현재 구현에서 실패를 만들려고 기대값이나 코드를 되돌리지 않는다.

## 보관과 재현

복구 직후의 64개 파일은 임시 작업 폴더와 별도로 다음에 보관했다.
`/Users/lee/fridgemate/.worktrees/prd-v2-recovery-evidence-20260919/recovered-initial-files.tar.gz`.
SHA-256: `cd29e00184b32b3dc7fd84ad13ecff1a780d18b606ed6ab0bee7e48da42f5051`.
이 아카이브에는 `.env`·개인 키·의존성·DB가 없고 복구 manifest의 경로만 있다.

재현할 때는 기존 폴더를 초기화하지 말고 위 기준 커밋의 **새 빈 작업 트리**에 아카이브를 풀고
manifest 해시를 대조한다. 이는 소비 함수 구현 전의 복구 상태이며 새 소비 테스트 두 개는 아직
실패한다. 앞의 기준선 명령은 그 파일을 제외하고 기존 1,471개를 검사한다. 이번 완료 상태는
별도 `completed-source-files.tar.gz`와 `completed-source-manifest.json`에 보존한다. 동일하게 새
작업 트리에서만 재현하며 원본이나 기존 사용자 변경 위에 덮어쓰지 않는다. 설치된 의존성을
재사용할 때는 package/lockfile과 실제 실행 파일의 존재를 다시 확인한다.
