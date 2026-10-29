# PRD v3 — 격리된 PostgreSQL의 실제 Prisma 검사

작업: 2026-09-29 KST. 작업트리 `prd-v2-recovered-20260919`.
기준 HEAD: `b6e3f10480df1cddf9ff005b44f99698befe4c86`.

## 결론

현재 루트의 Prisma Client/CLI **6.19.3**, PostgreSQL adapter **7.10.0**으로
실제 PostgreSQL **16.13(Homebrew)**에 연결했다. 서로 다른 새 임시 클러스터 두 개에서
같은 **6개 검사 각각 통과**다. 초기화만 확인했던 이전 단계보다 범위를 넓혔지만,
전체 스키마·RLS·인증·운영 배포 검증은 아니다. 앱 구현과 의존성은 변경하지 않았다.

원문 migration을 날짜순으로 적용하면 첫 4개는 성공하고, 5번째
`20260429120000_add_import_correction_embeddings`는 첫 문장의
`CREATE EXTENSION IF NOT EXISTS vector`에서 실패했다. 호스트에 `vector.control`이 없다.
이 환경의 전체 구축 검증은 **중단**이며, 누락된 타입·테이블을 가짜로 만들거나 실패한
migration을 건너뛰지 않았다. 기존 운영 DB가 실패한다는 증거는 아니다.

## 설치·운영 경로의 정적 확인

- README와 CI의 기준은 전체 저장소 루트의 npm 설치다. 서버는 루트 `src/`와 `prisma/`도 참조한다.
- `server/package.json`에는 Prisma 7.10 계열 선언과 adapter 누락이 있지만,
  이 폴더만 떼어 설치하는 경로가 현재 지원 계약이라는 근거는 확인하지 못했다.
  이번에는 독립 설치나 버전 정렬을 하지 않았다.
- `docs/CLOUDFLARE_DEPLOYMENT.md`는 Railway를 중단된 과거 경로로 설명한다.
  남아 있는 `railway.json`을 현재 운영 경로의 증거로 사용하지 않는다.
  이번 검사는 일반 Node의 DB 모듈이며 Workers/Hyperdrive 실행은 아니다.

## 실제 실행과 결과

실행 환경은 macOS arm64, Node 24.19.0이다. 새 의존성 설치 없이 기존 의존성을 사용했다.
`server/src/db/prisma.js`를 그대로 import했고 Prisma·pg·DB 응답을 mock하지 않았다.

| 검사 | 기대 결과 | attempt-02 / attempt-03 |
| --- | --- | --- |
| 연결 대상 확인 | 전용 DB·역할·data_directory, PostgreSQL 16, Unix socket 일치. 실패 시 쓰기 중단 | 통과 / 통과 |
| 파라미터 쿼리 | SQL처럼 보이는 입력이 실행되지 않고 문자열 그대로 반환 | 통과 / 통과 |
| 현재 User 모델 생성·조회 | 합성 사용자 A가 저장되고 같은 정규화 이메일로 조회 | 통과 / 통과 |
| interactive transaction commit | B·C 두 행 모두 트랜잭션 밖에서도 존재 | 통과 / 통과 |
| 콜백 오류 rollback | 트랜잭션 안에서는 존재한 행이 실패 후 0개 | 통과 / 통과 |
| UNIQUE 오류 rollback·후속 사용 | P2002, 앞선 삽입까지 취소, 이전 A·B·C 3개는 보존 | 통과 / 통과 |

두 실행은 같은 검사의 반복이며 고유 검사 12개로 합산하지 않는다.
실행 시간은 각 결과 JSON에 기록했지만 단일 호스트의 짧은 fixture 관측으로 성능 p95를 주장하지 않는다.

원문 SQL 적용 순서:

1. `20260401032024_init` — 성공
2. `20260404143000_add_user_auth_and_scoped_ingredients` — 성공
3. `20260417090000_auth_security_hardening` — 성공
4. `20260417110000_add_refresh_sessions` — 성공
5. `20260429120000_add_import_correction_embeddings` — vector 부재, psql 종료 3

4개 migration이 만든 실제 테이블은 `User`, `AuthSession`, `Ingredient` **3개**다.
최신 Ingredient 전체 스키마는 아니며 위 모델 검사는 User만 대상으로 한다.
각 SQL은 `psql -X -v ON_ERROR_STOP=1 -1 -f -`로 읽은 원문을 적용했다.
Prisma `migrate deploy`, `_prisma_migrations` 이력·checksum 검증은 실행하지 않았다.
뒤의 `CONCURRENTLY` migration까지 이 방식으로 적용할 수 있다는 뜻도 아니다.

## 격리와 첫 환경 실패

- `mktemp -d`의 전용 디렉터리와 mode 0700 소켓 디렉터리를 사용했다.
  TCP `listen_addresses`는 빈 값이고, 실제 연결의 `inet_server_addr()`도 null이다.
- DB 접속 설정은 새 fixture 전용으로 구성했다. 환경 허용 목록을 사용하고 기존
  `.env`, API 키, 사용자 DB, 비밀번호 파일·서비스 파일·psql 시작 설정을 읽지 않는다.
- fixture의 `fixture_admin`은 **관리자 역할**이다. 비소유자 런타임 역할과 RLS를 검사한 것이 아니다.
  합성 이메일은 `example.invalid`이고 저장된 비밀번호 해시 값도 명시적인 가짜 fixture다.
- 첫 sandbox 실행은 `shmget: Operation not permitted`로 initdb 단계에서 실패했다.
  initdb가 생성 중인 자기 data 디렉터리를 정리했으며, 디렉터리 부재와 pg_ctl 상태 4를 확인했다.
  프로세스 시작 전 실패이며 앱 오류나 DB 호환성 실패로 세지 않는다.
- 첫 runner의 종료 확인은 상태 3만 허용하여 위 환경 실패 뒤 추가 assertion도 발생했다.
  원본 스크립트·오류를 보존하고, 초기화 전 실패와 실제 프로세스 종료를 구분하도록 보강했다.
- 허용된 로컬 권한으로 새 attempt-02, attempt-03을 각각 초기화했다. 각 실행은 자기
  data 디렉터리만 종료하며 `pg_ctl stop` 0, 마지막 `status` 3을 확인했다.
  기존 DB·시스템 서비스를 중지하거나 바꾸지 않았다.
- attempt-02 summary의 `No network listener`라는 표현은 **TCP 리스너 없음**을 뜻한다.
  Unix 소켓은 사용했다. 원본 결과는 보존하고 attempt-03에서는 이 문구를 명확히 했다.

## 실행 명령과 보관

검증용 스크립트 및 결과: `/private/tmp/fridgemate-db-probe-1FNnxpDq`.
실제로 실행한 명령은 다음과 같다. 첫 무인자 runner는 보존된 `run-original.mjs` 버전이다.

```sh
/Users/lee/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --check /private/tmp/fridgemate-db-probe-1FNnxpDq/run.mjs
/Users/lee/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --check /private/tmp/fridgemate-db-probe-1FNnxpDq/probe.mjs
/Users/lee/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node /private/tmp/fridgemate-db-probe-1FNnxpDq/run.mjs
/Users/lee/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node /private/tmp/fridgemate-db-probe-1FNnxpDq/run.mjs 02
/Users/lee/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node /private/tmp/fridgemate-db-probe-1FNnxpDq/run.mjs 03
```

상세 initdb/pg_ctl/psql/Node 인자는 실행별 JSON에 있다. 실패 결과를 성공 결과로 덮어쓰지 않았다.
착수 시 이전 보관의 203개 변경 파일과 코드·설정·자산 601개 해시를 대조했고, 두 검사 종료 뒤에도
동일했다. 원본 루트는 기존 status 목록 해시를 확인했다. 원본 전체 내용 해시 검증은 아니다.

최종 보관은 인접 `../prd-v3-local-postgres-evidence-20260929`다. 시작 203개/완료 204개 파일의
archive·manifest, 이번 문서 3개의 diff, 정확한 검증 스크립트·로그·JSON을 보존한다.
DB data 디렉터리·소켓·환경파일·비밀키·사용자 자료·node_modules는 보관하지 않는다.
시작 archive SHA-256은 `468f5a80caf4e064dbc88d1b5730339d814da975299c0dbd3ec6e9b6bb8a2aae`다.

재현할 때는 기준 HEAD의 **새 checkout**에 시작 archive를 적용하고 manifest의 모든 파일 해시를
검증한다. 기존 작업트리에 덮어쓰지 않는다. 동일 의존성을 준비하고 보관 스크립트의 root/temporary
상수와 경로 허용 검사를 새 전용 경로로 함께 맞춘다. 기존 attempt 번호·데이터는 재사용하지 않는다.
현재 호스트 설치가 달라졌다면 vector 부재 기대가 성립하지 않을 수 있으며 결과를 임의 보정하지 않는다.

이번 프로젝트 변경은 이 보고서·README·CHANGELOG뿐이다. 앱·테스트·설정·의존성·schema는 그대로여서
단위 테스트·lint·build·E2E는 재실행하지 않았다. 이전 2,989개 결과와 이번 DB 6개 결과를 구분한다.

## 다음 검증의 실제 선행 조건

전체 DB 검증에는 실제 pgvector와 선행 카탈로그 스키마가 필요하다.
기존 `docs/sql/create_recipes_table.sql`, `supabase/sql/create_recipe_ingredients.sql`은
`anon`, `authenticated` 역할을 참조한다. `20260828100000`은 소문자 `ingredients(id)`도 참조하지만,
검토한 26개 migration과 위 두 SQL에서는 최초 생성 정의를 찾지 못했다. 대문자 `Ingredient`로
대체하거나 임의 최소 테이블로 성공 처리하지 않는다. 이는 정적 발견이며 해당 후속 SQL은 실행하지 않았다.

그 뒤 별도 비소유자·NOSUPERUSER·NOBYPASSRLS 역할로 9개 보호 테이블 존재/정책과 계정 A/B 격리,
잘못된 소유자 쓰기 거절, rollback, transaction-local scope 해제를 검사해야 한다.
`tenantScope`의 소유자 guard 통과만으로 모든 테이블·RLS가 존재한다고 판단하지 않는다.
운영 PostgreSQL 17·Hyperdrive·인증/쿠키·실제 배포·Linux CI는 계속 미검증이다.

메뉴 20~30개 검수와 과정 물/단품 기준, 실기기·OCR·접근성·성능·저장 장애 QA, 승인 후
10~20명/4주 파일럿과 검색 유입→식단 확정 관측도 남는다. 파일럿은 별도 동의·로컬 보관·수동 내보내기·
35일 뒤 다음 접근 시 정리·분석 실패에도 조리/입고 보존을 유지한다. 후속 예산·선호·공유 범위도 유지한다.
commit/push/PR/병합/배포·참여자 모집·운영 DB/API 호출은 하지 않았다.
