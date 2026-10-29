# 운영 의존성 보안 검사 마감 — 2026-10-29

## 요약과 범위

- PR #55의 운영 의존성 감사 실패를 로컬에서 재현하고, 전이 의존성 세 개만 수정 버전으로 올렸다.
- `package-lock.json`의 변경은 정확히 `body-parser`, `proxy-addr`, `qs` 세 package entry다. 의존성 변경 diff는 16줄 추가·12줄 삭제다.
- 앱·서버 구현, 테스트, `package.json`, CI 설정, DB 스키마는 변경하지 않았다. 문서는 이번 보안 마감 기록을 추가한다.
- 이 문서는 커밋 전 로컬 검증 기록이다. 이 문서를 포함한 최종 커밋의 원격 CI 결과와 PR 병합 여부는 해당 head의 GitHub 검사 및 최종 작업 보고에서 별도로 확인한다. 이전 CI 성공이나 이 로컬 결과를 최신 원격 CI 통과로 대체하지 않는다.

## 출발점과 수정 근거

- 작업 트리: `.worktrees/prd-v2-recovered-20260919`
- 기준 커밋: `cfbb3fd376617b6940fa6fed24b1384268de40e1`
- 기준 CI: [Security 실행 40859658880 / Production dependency audit 실패](https://github.com/10-19-hh/fridgemate/actions/runs/40859658880/job/123399367750).
- 실패한 필수 명령은 `npm audit --omit=dev --audit-level=high`다. Moderate 한 건만으로 실패한 것이 아니라 High·Critical 항목이 함께 있었다.

| 전이 의존성 | 변경 전 → 후 | 공식 공지의 심각도·수정 버전 |
| --- | --- | --- |
| `body-parser` | `2.3.0` → `2.4.0` | High, `2.4.0` — [GHSA-27r3-jxmh-p828](https://github.com/advisories/GHSA-27r3-jxmh-p828) |
| `proxy-addr` | `2.0.7` → `2.0.8` | Critical, `2.0.8` — [GHSA-jqcg-44mw-7w3h](https://github.com/advisories/GHSA-jqcg-44mw-7w3h) |
| `qs` | `6.16.0` → `6.16.1` | Moderate, `6.16.1` — [GHSA-6pq8-jhm2-2vcw](https://github.com/advisories/GHSA-6pq8-jhm2-2vcw) |

Express `5.2.1`의 기존 범위는 각각 `body-parser ^2.2.1`, `proxy-addr ^2.0.7`, `qs ^6.14.0`이다. 세 수정 버전은 이 범위를 충족하므로 직접 의존성이나 override를 추가하지 않았다.

`body-parser 2.4.0`이 요구하는 `content-type ^2.1.0`과 `iconv-lite ^0.7.3`도 기존 lock의 중첩 `content-type 2.1.0`, 루트 `iconv-lite 0.7.3`으로 충족한다. 새 `qs ^6.16.1` 범위는 이번 수정 버전으로 충족한다.

## 최소 변경 유지 과정

1. 수정 전 로컬 감사에서 Moderate 1·High 1·Critical 1, 합계 3건과 종료 코드 1을 확인했다.
2. 대상 세 패키지로 제한한 `npm update ... --package-lock-only`도 npm 11.4.2에서 무관한 `libc` 메타데이터 26개를 제거하고 `qs 6.17.1`을 선택하는 것을 발견했다.
3. 무관한 26개 메타데이터를 기준 상태로 보존하고, 공식 npm registry의 `qs@6.16.1` tarball·integrity·의존성 정보를 확인해 최소 수정 버전으로 정리했다. 최종 lock 전체 package entry를 기준과 비교해 변경 대상이 정확히 세 개임을 독립 검토했다.
4. 최종 lock으로 `npm ci --ignore-scripts --no-audit --no-fund`를 실행해 663개 패키지를 새로 설치했다. 이전 `node_modules`의 버전으로 검증 결과를 대신하지 않았다.
5. 새 `node_modules`의 세 `package.json`을 직접 읽어 `2.4.0`, `2.0.8`, `6.16.1`이 실제 설치됐음을 확인했다. 설치 후 운영 의존성 감사는 총 0건·종료 코드 0이다.

첫 감사 시도인 `audit-before.log`는 user/global npm config가 모두 `/dev/null`을 가리켜 설정 로딩 단계에서 종료한 기록이다. 취약점 재현으로 세지 않았다. 서로 다른 안전한 config 경로로 다시 실행한 `audit-baseline.log`가 위의 유효한 변경 전 기준이다.

## 실행 환경과 명령

Node 24를 PATH의 첫 항목으로 사용했다. 임시 실행기는 `shell: false`로 명령 인자를 전달하고 npm registry를 `https://registry.npmjs.org`로 고정했다. API 키·실제 DB 연결 정보를 전달하지 않았다.

작업 트리에서 실행한 핵심 명령은 다음과 같다. 감사의 JSON 출력·종료 코드·실행 시간은 별도 로그와 메타데이터에 보존했다.

```sh
npm audit --omit=dev --audit-level=high --json
npm update body-parser proxy-addr qs --package-lock-only --ignore-scripts --no-audit --no-fund
npm view body-parser@2.4.0 version dependencies dist.integrity --json
npm view qs@6.16.1 version dependencies engines license funding dist.tarball dist.integrity --json
npm ci --ignore-scripts --no-audit --no-fund
npm run prisma:validate
npm run prisma:generate
npm run test:run -- --reporter=json --outputFile=/private/tmp/fridgemate-dependency-audit-20261029-DeRuES5g/unit.json
npm run lint
npm run build
npm run build:pilot
npm run test:e2e -- --workers=2 --reporter=json
npm run test:e2e:preview -- --reporter=json
npm run test:e2e -- --config playwright.pilot.config.js --reporter=json
npm audit --audit-level=high --json
```

Prisma 검증·생성에만 `DATABASE_URL`과 `DIRECT_URL`을 `postgresql://ci:ci@127.0.0.1:9/fridgemate_ci`라는 더미 주소로 설정했다. 스키마 검증과 클라이언트 생성은 통과했다. 마이그레이션이나 실제 DB 접속 검증은 하지 않았다.

## 로컬 검증 결과

| 검사 | 결과 | 증거 |
| --- | --- | --- |
| 변경 전 운영 의존성 감사 | 3건, 종료 코드 1 | `audit-baseline.log`, `audit-baseline.meta.json` |
| 최종 lock의 새 의존성 설치 | 663개 설치, 종료 코드 0 | `install-locked.log`, `install-locked.meta.json` |
| 설치 후 운영 의존성 감사 | 0건, 종료 코드 0 | `audit-installed.log`, `audit-installed.meta.json` |
| Prisma 스키마 검증·클라이언트 생성 | 둘 다 종료 코드 0 | `prisma-validate.*`, `prisma-generate.*` |
| 단위·통합 테스트 | 실제 파일 242개, 3,165개 통과, 실패·pending·todo 0 | `unit.json`, `unit.meta.json` |
| lint | 종료 코드 0 | `lint.meta.json` |
| 일반 빌드 | 종료 코드 0 | `build.meta.json` |
| 파일럿 빌드 | 종료 코드 0 | `pilot-build.meta.json` |
| 일반 개발 브라우저 E2E | 105/105 통과, skip·unexpected·flaky·런타임 오류 0 | `e2e.log`, `e2e.meta.json` |
| 일반 실제 빌드 브라우저 | 48/48 통과, skip·unexpected·flaky·런타임 오류 0 | `built-e2e.log`, `built-e2e.meta.json` |
| 전용 파일럿 브라우저 | 9/9 통과, skip·unexpected·flaky·런타임 오류 0 | `pilot-e2e.log`, `pilot-e2e.meta.json` |
| 개발 도구를 포함한 전체 감사 | 11건(High 7·Moderate 4), 종료 코드 1; 이번 수정 범위 밖 | `audit-all.log`, `audit-all.meta.json` |

단위 테스트의 실제 수집 파일 경로를 확인해 작업 트리 안의 추가 `.worktrees/**` 결과가 섞이지 않았음을 확인했다. 서로 중복될 수 있는 단위·브라우저·일반 빌드·파일럿 검증 수는 하나의 고유 테스트 수로 합산하지 않는다.

로컬 원본 증거 디렉터리는 `/private/tmp/fridgemate-dependency-audit-20261029-DeRuES5g`다. OS 정리 대상인 임시 경로이므로 이 문서와 달리 영구 보관이 보장되지는 않는다. 인증 자료나 `.env`를 이 보고서에 첨부하지 않았다.

## 한계와 원격 완료 조건

- 이번 검증은 수정 버전 설치·감사 결과 및 기존 기능 회귀 검사다. 취약점 공격 PoC나 운영 서버 대상 공격 시험은 실행하지 않았다. 단위 테스트 통과를 CVE 공격 차단 검증으로 표현하지 않는다.
- `--omit=dev` 감사가 0건이라는 결과는 해당 시점 npm advisory 기준의 운영 의존성 결과다. 개발 의존성 전체나 미공개 취약점까지 안전하다는 보증이 아니다.
- 개발 도구를 포함한 전체 감사에는 `@vitest/mocker`, `brace-expansion`, `miniflare`, `postcss-selector-parser`, `sharp`, `source-map-js`, `undici`, `vite`, `vitest`, `wrangler`, `zod` 관련 11건(High 7·Moderate 4)이 남았다. 승인된 세 운영 의존성 외의 패키지나 CI 감사 범위를 바꾸지 않았으며, 전체 무취약 상태로 보고하지 않는다.
- 서버 기능 검사는 모의 DB·직접 핸들러 호출을 포함한다. 실제 사용자 인증·DB·운영 요청 경로의 전면 검증과 구분한다.
- 최종 commit/push 뒤 PR #55의 **동일 head**에 대해 필수 검사·보안 감사·빌드 결과를 확인한 뒤 병합한다. 성공하지 않은 검사를 우회하거나 과거 성공을 최신 결과로 사용하지 않는다.
- main 병합에 따른 자동 배포가 시작될 수 있다. PR 병합·Vercel Ready·배포 후 스모크·고정 파일럿 origin은 각각 별도 확인 대상이며, 이 문서만으로 완료를 선언하지 않는다.
