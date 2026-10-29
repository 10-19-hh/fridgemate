# 파일럿 Preview 재개 점검 — 2026-10-17

## 결론

현재 개발 작업 트리의 조리·이유 선택·파일럿 내보내기 기능은 로컬 실제 빌드 검사까지 통과했다. 기존 자동 Preview는 운영으로 이동하므로 참가 주소가 아니다. 10월 4일 별도 인증 폴더가 없어 **정상 CLI 재인증과 실제 Preview 배포는 아직 수행하지 않았다.** 원격 스모크와 고정 참가 URL도 미확정이다.

이번에는 앱 구현을 추가 수정하지 않았다. 기존 변경을 보존하고 실제 파일럿 산출물의 조리→수동 JSON 내보내기 검사를 1개 추가했다. 원격 로그인·배포·도메인 설정, commit/push/merge, 원본 루트의 작업에는 손대지 않았다.

## 소스와 배포의 차이

- 원본 `/Users/lee/fridgemate`: `codex/weekly-meal-plan`, HEAD `6402c7b44da8bdc0ee98aa548a18c96965fba2af`. 별도의 미커밋 작업이 있으므로 구현/테스트/업로드 대상으로 사용하지 않았다.
- 검증 작업 트리: `/Users/lee/fridgemate/.worktrees/prd-v2-recovered-20260919`, HEAD `4c6e73062358f5e164f91eec078bc7e10a45322c`, 시작 시 변경/미추적 52파일.
- 10월 17일 GitHub 조회: [PR #55](https://github.com/slayer011019/fridgemate/pull/55)는 open·미병합, 원격 head는 위 `4c6e730…`, main은 `129b63772558e4209192053a3838b3f6701eb363`이다. PR head 체크 10개는 성공 9/Supabase Preview skipped 1이다. 이는 **9월 28일의 원격 커밋 검사**이며 현재 미커밋 파일에 대한 CI 결과가 아니다.
- main 커밋의 성공 Vercel 상태는 `2LEtV7QTXc3Ud7hR4Aa1mYyHvom3`, PR head는 `2qjXNbRCCmnQuPQQXv9qKXaxwb69`이다. 현재 운영 도메인의 활성 배포를 Vercel 계정에서 다시 확인한 것은 아니므로 active production commit을 단정하지 않는다.
- 10월 17일 브라우저에서 실제 [기존 브랜치 Preview의 /pilot](https://fridgemate-git-codex-prd-v2-recover-c7fe6d-fridgemates-projects.vercel.app/pilot)을 열었다. 네트워크 기록은 **Preview GET 308 → 운영 `/pilot` GET 404**였다. 이전 날짜의 화면만 재사용한 결과가 아니다.

현재 작업 트리에는 `/pilot` 라우트, 확정 식단의 조리 버튼, 이유 선택, 별도 동의와 JSON 내보내기가 있다. 이 UI들은 파일럿 빌드 플래그가 꺼지면 모두 숨겨지는 구조가 아니다. 플래그는 신규 후보 정책·외부 요청 차단·별도 산출물을 정한다. 따라서 운영에서 UI가 안 보이는 문제를 플래그 하나 때문이라고 설명하지 않는다.

## 이번 실제 실행 결과

기존 설치 의존성·Node 24·고정 작업 트리·비밀값을 상속하지 않는 검증 환경을 사용했다. 단위 JSON의 실제 241개 파일 경로가 이 작업 트리 아래에 있고 하위 `.worktrees/**` 결과가 없음을 대조했다.

| 검사 | 결과 | 새 증거 접두사 |
|---|---|---|
| 전체 단위·통합 | **3,149 PASS**, 241파일, 실패/pending 0 | `unit-current` |
| 전체 lint | exit 0; 추가 E2E 작성 뒤 재실행도 exit 0 | `lint-final` |
| 일반 빌드 | exit 0, OCR 자산 7개·공개 113경로·사이트맵·noindex 앱셸 검증 | `build-current` |
| 전체 개발 브라우저 | **107 PASS**, retries/skipped/unexpected/flaky 0 | `e2e-current` |
| 일반 실제 빌드 브라우저 | **48 PASS**, 동일 | `built-current` |
| 파일럿 빌드 | exit 0, 별도 `dist-pilot`, 동일 후처리 검증 | `pilot-build-current` |
| 파일럿 실제 빌드 브라우저 | **6 PASS**, 동일 | `pilot-e2e-final` |
| 실제 파일럿 HTML + cloud-selected 설정 대조 | 113경로/사이트맵/앱셸 verifier exit 0 | `cloud-selected-config-check.json` |

107개와 48개는 일부 시나리오의 서로 다른 실행 환경이므로 합산해 고유 사용자 흐름 수라고 쓰지 않는다. 단위의 기존 일부 React `act(...)` 경고는 실패 0과 구분한다. 최종 일반/파일럿 빌드에는 SSR 소켓 `EPERM`이 없었다.

### 추가한 조리·내보내기 연결 검사

`e2e/pilot-policy.spec.js`의 여섯 번째 시나리오는 실제 파일럿 산출물과 IndexedDB를 사용한다.

1. 별도 파일럿 동의 → 재로드 후 명시적 기록 재개.
2. 실제 6개 조건부 검수 후보로 식단 생성·확정.
3. 오늘 끼니의 조리 UI에서 **사용량 없이 조리만 기록**.
4. 조리 상태 `cooked/needs-review`, 조리 이벤트 1건, 소비 이벤트 없음, 원래 재료 보존 확인.
5. 실제 브라우저 다운로드 → 기존 export validator → `meal_cooked_recorded` 성공 1건 확인.
6. 메뉴 원문·가상 메모/이메일·원시 재료 ID가 export에 없고, 일반 분석 동의와 재고가 보존되며 금지 fetch/XHR·원격 서비스 요청이 0건임을 확인.

첫 집중 실행 1/1부터 통과한 **기존 동작 확인 검사**다. RED→GREEN을 새로 수행했다고 쓰지 않는다. 기존 다섯 테스트를 제거/skip/완화하지 않았다. 미확인 사용량을 재고 소비량으로 추정하지 않았으며 실제 참가자 조리나 OCR 실측으로도 세지 않는다.

### 이전 원격 빌드 실패와 현재 확인 범위

10월 4일 공식 CLI 62.2.0 native 경로의 원격 시도는 Preview `dpl_82Rkk2PaTaLSauMB1cgkVAwMduL9`를 만들었지만 일반 `npm run build`를 실행했고, 선택 설정의 전역 noindex를 경로별 헤더로 인정하지 않는 verifier에서 실패했다. 완료된 참가 배포가 아니다. native가 정확히 어느 request override를 빠뜨렸는지는 확정하지 않았다.

현재 verifier는 정확한 개인 경로 또는 전역 `/(.*)`의 엄격한 `noindex, nofollow, noarchive`를 인정한다. 기존 exact-path 수용, 생성된 전역 정책 수용, 엉뚱한 경로/불충분한 헤더 거절 회귀 4개가 위 단위 검사에 포함된다. 이 한 줄 수정과 회귀 테스트는 이번 시작 상태에 이미 있었고, 새로 수정한 것으로 계산하지 않는다.

이번에는 합성 HTML뿐 아니라 **이번에 빌드한 실제 `dist-pilot` HTML**을 별도 검증 복사본에 놓고 생성 Preview 설정을 그 복사본의 `vercel.json`으로 선택해 실제 verifier를 실행했다. 원본·업로드 복사본의 `vercel.json`은 그대로다. 이 검사는 이전 SEO 불일치 경계를 확인하지만 Vercel의 빌드 명령 선택·원격 빌드·라우팅 성공을 대신하지 않는다.

## 재실행 명령

명령은 변경 작업 트리에서 지원 Node 버전과 기존 의존성으로 실행한다.

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

실제 명령과 새 JSON/로그/종료 기록은 `/private/tmp/fridgemate-pilot-release-20261017-cGbqx1Ld/check.mjs`가 보존한다. 예: `node .../check.mjs pilot-e2e final`. 실행별 파일을 덮어쓰지 않으므로 다음 실행에는 새 접두사를 사용한다.

## 보존·업로드 준비

- 시작 52개 파일의 실제 사본·SHA256·binary diff는 새 증거 폴더의 `snapshot-before-files/`, `snapshot-before.json`, `snapshot-before.patch`에 있다. .env·인증·키 파일은 포함하지 않았다. reset/clean/광범위 restore/stash를 사용하지 않았다.
- 새 업로드 복사본 `/private/tmp/fridgemate-pilot-upload-20261017-qMFJuBKo`에 빌드용 **204개 소스 파일만** 복사하고 현재 검증 소스와 해시를 대조했다. 별도 `pilot-preview.vercel.json`과 `.vercelignore`를 더했으며 아직 업로드/프로젝트 link를 실행하지 않았다.
- `.env.production`이 tracked이므로 전체 git archive를 사용하지 않았다. .env/키/인증/.git/.worktrees/node_modules/서버/실제 참가자 자료를 제외했다.
- 모든 `/private/tmp` 자료는 OS 정리 대상이다. 이전 10월 4일 증거·인증 폴더는 현재 없어 재사용하지 않았다. 이것을 영구 백업이라고 부르지 않는다. 현재 실제 작업 파일은 별도 작업 트리에 그대로 남아 있다.

## 다음 배포 절차와 중단 조건

1. 사용자 승인을 받은 공식 CLI 재인증을 새 0700 임시 폴더에 저장한다. 기존 전역 계정/설정은 보존하고 인증 내용이나 토큰을 출력하지 않는다.
2. 공식 CLI의 `whoami`가 `edgar1019-5628`인지, 팀 `fridgemates-projects`, 기존 프로젝트 `fridgemate`인지 다시 조회한다. 프로젝트 ID는 `prj_Xj3J1Bk3rGDHwuS1ZfVAGyn8PUcx`다. 계정/권한이 맞지 않으면 신규 프로젝트나 다른 팀으로 우회하지 않는다.
3. 기존 공식 62.2.0 package의 Node 경로를 per-process `VERCEL_CLI_USE_NATIVE_BINARY=0`으로 선택한다. 전역 CLI 설치와 native 기본 설정은 변경하지 않는다. 검증한 업로드 복사본만 link하고 업로드 직전에 소스 해시를 다시 확인한다.
4. `--target preview`, `--scope fridgemates-projects`, 별도 `--global-config`와 `--local-config`를 명시한다. `--prod`, `promote`, 운영 alias, Production 전용 `--skip-domain`, Build Output API가 아닌 소스의 `--prebuilt`는 사용하지 않는다.
5. 원격 로그의 실제 명령이 `npm run build:pilot`, 실제 산출물이 `dist-pilot`, Environment가 Preview인지 확인한다. 성공 exit만 믿지 않고 실제 할당 URL/접근 보호/연결 대상을 확인한다.
6. 원격 `/pilot`, `/meal-plan`, `/ingredients`, `/import`, 공개 안내의 직접 접근·새로고침·CSP·전체 noindex·실제 404·금지 요청과 조리/이유/수동 JSON 흐름을 확인한 뒤 고정 참가 origin을 정한다. 미검증 자동 브랜치 alias를 참가 주소로 쓰지 않는다.

Vercel 공식 [전역 옵션](https://vercel.com/docs/cli/global-options)과 [배포 target](https://vercel.com/docs/cli/deploy)을 대조했다. npm package 62.2.0의 `dist/vc.js`에서도 per-process native opt-out을 확인했다. CLI/config 준비 완료는 실제 원격 성공이 아니다.

## 남은 파일럿 시작 조건

- Vercel 재인증·실제 Preview 및 원격 스모크·고정 참가 URL.
- 같은 origin에서 실제 배포 교체/롤백 검사. v2 기록을 과거 v1-only HEAD reader로 롤백하면 파일럿 읽기/내보내기/철회 UI가 막히므로 호환 reader 빌드만 대상으로 한다.
- 실기기/다른 OS, 실제 영수증 10~20장의 OCR 측정.
- 모집 날짜·수동 JSON 전달 채널·사본 삭제 시점과 사전 의사결정 기준 확정. [운영 기준](PILOT_RUNBOOK_2026-10-04.md)을 결과에 맞춰 변경하지 않는다.

원격 모집·참가자 데이터 수집·새 재심사/색인 요청·광고 설정 변경은 수행하지 않았다.
