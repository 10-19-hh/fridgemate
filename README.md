# 오늘뭐먹지 (FridgeMate)

성인 1~2인의 주간 저녁 식단을 정하고, 냉장고 재료를 활용한 장보기와 실제 조리 기록을 연결하는 로컬 우선 웹 애플리케이션입니다. 재료·유통기한 관리와 공개 메뉴 탐색도 함께 제공합니다.

- 공개 서비스: [https://오늘뭐먹지.com](https://오늘뭐먹지.com)
- 현재 마일스톤: `v1.5`
- 라이선스: [MIT](LICENSE)

최신 출시 준비 상태는 [2026-09-29 코드 보존·전체 재검증 기록](docs/RELEASE_CLOSEOUT_2026-09-29.md)을 참고하세요. 기존 204개 변경을 기능별 17개 커밋으로 보존했고, 새 단위·통합 2,989개, 브라우저 107개, 빌드 브라우저 48개(중복 검증), lint·build가 통과했습니다. 아래 기능별 과거 수치와 구분하며, 원격 CI·배포·실제 참여자 파일럿 완료를 뜻하지 않습니다.

후속 PR에서는 CodeQL 결과 경고 2개(URL 감지 테스트 경계·오프라인 파일 분석기 경합)를 재현해 수정했습니다. 수정 후 새 단위·통합 **3,001개**, 브라우저 **107개**, 빌드 브라우저 **48개**, lint·build가 통과했습니다. 자동 Preview는 기존 호스트 규칙에 따라 하위 경로가 운영 도메인으로 이동하므로 배포 스모크 완료가 아닙니다. 수정 후 검증과 남은 배포 조건도 위 기록과 PR 검사에서 구분합니다.

후속 local-only 파일럿은 [승인된 메뉴 검수 정책](docs/PILOT_MENU_REVIEW_POLICY_2026-09-29.md)을 적용합니다. 명시적 파일럿 빌드의 신규 추천만 원문 식재료량을 대조한 6개 조건부 후보로 제한하고, 일반 빌드의 22개 카탈로그와 기존 저장 기록은 유지합니다. 과정 물·추가 기름 등의 미확인 수량을 검수 완료로 바꾸지 않습니다. [로컬 파일럿 빌드·검증·배포 준비](docs/PILOT_LOCAL_BUILD_2026-09-29.md)는 실제 참가 URL 개설이나 운영 배포 완료와 구분합니다.

전용 파일럿 빌드에서 교체·건너뛰기 및 지난 확정 끼니의 미조리 이유를 선택할 수 있습니다. 실제 저장된 동작에만 별도 동의한 로컬 파일럿 이유 코드를 연결하며, 미응답·저장 실패·관측 누락을 구분합니다. [2026-10-04 이유 계측·검증 기록](docs/PILOT_REASON_INSTRUMENTATION_2026-10-04.md)과 [5명·4주 파일럿 운영 기준](docs/PILOT_RUNBOOK_2026-10-04.md)을 참고하세요.

[2026-10-17 파일럿 Preview 재개 점검](docs/PILOT_PREVIEW_RESUME_2026-10-17.md)에서 현재 소스를 다시 검증했습니다. 단위·통합 3,149개, 개발 브라우저 107개, 일반 빌드 브라우저 48개, 파일럿 빌드 브라우저 6개와 lint·일반/파일럿 빌드가 통과했습니다. 실제 조리→수동 파일럿 JSON 내보내기 연결도 확인했지만, CLI 임시 인증이 없어 원격 배포·고정 참가 URL은 아직 미확정입니다.

[2026-10-29 노출·용도·보존 정책](docs/PILOT_EXPOSURE_POLICY_2026-10-29.md)에 따라 일반 빌드에서는 파일럿 신규 참여·재개·이벤트 추가와 선택 이유 UI를 제공하지 않습니다. 재고·식단·장보기·조리 기능과 `/pilot`의 기존 기록 내려받기·철회는 유지합니다. 전용 파일럿은 별도 동의 후 제품 사용성 검증에만 사용하며 연구·모델 학습으로 용도를 확대하지 않습니다. 단위·통합 3,165개, 개발 브라우저 105개, 일반 실제 빌드 브라우저 48개, 전용 파일럿 브라우저 9개와 lint·두 빌드가 통과했습니다. 중복 검증 수치는 합산하지 않으며, 기존 파일럿 브라우저 3개는 일반 환경에서 전용 환경으로 옮겨 검증을 유지했습니다. 원격 배포·고정 참가 origin·JSON 회수 운영은 아직 미완료입니다.

2026-10-29의 [운영 의존성 보안 후속 검증](docs/DEPENDENCY_SECURITY_CLOSEOUT_2026-10-29.md)에서는 Express 하위의 `body-parser`, `proxy-addr`, `qs`만 기존 허용 범위의 수정 버전으로 갱신했습니다. 새 설치 후 운영 의존성 감사는 3건에서 0건으로 통과했습니다. 앱 코드·직접 의존성·CI 기준은 유지하며, 개발 도구까지 포함한 전체 감사의 남은 11건은 이번 수정 완료 범위가 아닙니다. 로컬 검증과 해당 커밋의 원격 CI·병합·자동 배포 결과는 구분합니다.

## 프로젝트 소개

냉장고에 무엇이 있는지 잊거나, 유통기한을 놓치거나, 남은 재료로 무엇을 먹을지 결정하지 못하는 문제를 줄이는 것이 목표입니다.

핵심 사용 흐름은 다음과 같습니다.

```text
첫 방문: 이번 주 식단 만들기 -> 날짜·인원·제외 재료 설정 -> 초안 확인·확정 (재료 등록은 선택)
식단 활용: 부족분·미확인 재료 확인 -> 실제 구매량 입고 -> 조리·사용량 확인 -> 남은 식단 조정
메뉴 둘러보기: 남은 재료 선택 -> 공개 메뉴 탐색·하나 골라보기 -> 내부 조리법 -> 준비 재료 체크
재방문: 냉장고·유통기한 확인 -> 보유 재료 추천 -> 오늘 메뉴 선택 -> 재료 소비/복구
```

브라우저의 IndexedDB를 일상적인 작업 사본으로 사용하므로 가입하지 않아도 주요 기능을 사용할 수 있습니다. 로그인한 사용자는 계정 화면에서 서버 백업과 가져오기를 직접 실행할 수 있습니다.

## 주요 기능

### 공개 소개와 검색 경계

- 공개 대표명은 **오늘뭐먹지**, 함께 쓰는 이름은 **FridgeMate**입니다. 헤더·푸터·소개에서 관계를 표시하고 홈·소개 메타에 주간 식단·장보기·실제 조리 흐름을 반영합니다. `/about`에서 가입·재고 등록 없이 식단 만들기를 시작하거나 공개 메뉴를 둘러볼 수 있습니다.
- 주간 식단·입고·조리 이력은 로그인 여부와 관계없이 이 브라우저에 저장됩니다. 공개 레시피와 개인 기록의 경계를 유지하며 미확인 재료량이나 자동 동기화를 약속하지 않습니다.
- HTML·클라이언트 메타 일치, 소개→식단 확정, 개인 재고·설정의 공개 head/정적 HTML 부재를 검사합니다. [공개 소개 검증·검색 관측·남은 범위](docs/PRD_V3_PUBLIC_INTRO_2026-09-28.md)를 참고하세요. 로컬 변경이며 실제 검색 순위·유입 전환·운영 반영을 완료했다는 뜻은 아닙니다.
- 이 단계의 브라우저 107개·실제 빌드 48개(중복 검증)·린트·빌드는 통과했습니다. 전체 단위 검사는 `--maxWorkers=2`에서 2,989개 통과했지만, 기본 작업자 수에서는 기존 지난 끼니 조회 한 건이 두 차례 시간 초과했습니다. 원인 미확정이며 테스트 설정·기대값·제한 시간을 바꾸지 않았습니다.
- 후속 [지난 끼니·조리 테스트 대기 진단](docs/PRD_V3_OVERDUE_TEST_DIAGNOSTICS_2026-09-29.md)에서는 전체 본문 조회 비용을 계측하고 세 대기를 해당 기능 영역으로 좁혔습니다. 정확한 결과·전역 유일성·기본 시간·실제 저장소 검증을 유지하며 앱 구현은 바꾸지 않았습니다. 계측 없는 기본 전체 검사 두 번에서 각각 **2,989개**, 린트·빌드가 통과했습니다. 이전·중간 실패를 별도로 보존하며 Linux CI·모든 환경의 안정화 완료를 뜻하지 않습니다. E2E는 이 단계에서 재실행하지 않았습니다.

### 냉장고와 장보기

- 재료 이름, 수량, 분류, 보관 위치, 구매일, 유통기한, 메모 관리
- D-day 기반 임박·만료 상태 표시
- 재료 소비와 복구, 다시 살 항목을 위한 장보기 패널
- 자주 쓰는 양념과 소스의 팬트리 보유 상태 관리
- 팬트리·취향 설정의 로컬 저장 실패 안내와 재시도, 읽기 미확인 상태 구분, 늦은 응답의 로컬 덮어쓰기 방지. [변경 범위·검증·남은 한계](docs/PRD_V3_PERSONALIZATION_STORAGE_2026-09-28.md)를 참고하세요.
- 재고 조회 실패는 빈 냉장고와 구분하고 **재고 다시 불러오기**를 제공합니다. 수정 대상 조회 실패·대상 없음에서는 저장을 잠그고, 수정·삭제 실패와 계정 전환의 늦은 응답을 구분합니다. 인증 재시도·세션 복구·이전 콜백·수동 동기화의 계정 경계도 보강했습니다. [검증 기록](docs/PRD_V3_INVENTORY_AUTH_2026-09-28.md)에 범위와 한계를 기록합니다.
- 새 macOS 의존성 설치 검증까지 단위·통합 **226파일 / 2,922개**, 개발 서버 브라우저 **91개**, 실제 local-only 빌드 브라우저 **35개**, 린트·빌드·공개 정적 경로 **113개** 통과입니다. preview 35개는 기존 흐름의 다른 실행 방식이며 별도 신규 35개가 아닙니다. [새 설치·CI 범위와 한계](docs/PRD_V3_CLEAN_INSTALL_2026-09-28.md)를 참고하세요. Linux CI·운영 검증이나 PRD 전체 완료를 뜻하지 않습니다. 이미 시작된 요청·저장 작업의 취소나 늦은 서버 쿠키 적용까지 보장하지 않습니다.
- 네트워크 없이도 동작하는 IndexedDB 기반 로컬 모드

### 키보드·상태 안내

- 본문 바로가기, 현재 메뉴 표시, 키보드 사진 선택과 동작 줄이기 설정을 지원합니다. 분석 설정은 본문을 덮지 않는 하단 영역에서 열며, 명시적으로 열었을 때 초점을 이동하고 저장 후 돌아옵니다.
- 수량·장보기 저장 후 초점 유지, 조리 입력 오류 위치 안내, OCR·인증·파일럿 상태 알림과 개인정보 작업 중복 제출 방지를 보강했습니다. 기존 저장·동의 정책은 유지합니다.
- 최신 접근성 단계 검증은 단위·통합 **229파일 / 2,956개**, 개발 서버 브라우저 **101개**, 실제 빌드 브라우저 **45개**, 린트·빌드 통과입니다. preview는 기존 흐름의 중복 검증이며 실기기·스크린리더·전체 WCAG 준수를 뜻하지 않습니다. [변경·실패 재현·복원·남은 한계](docs/PRD_V3_ACCESSIBILITY_2026-09-28.md)를 참고하세요.

### 등록과 OCR

- 사진과 영수증 형태의 텍스트를 읽는 Tesseract.js OCR
- 인식 결과를 바로 저장하지 않고 사용자가 검토한 뒤 반영
- 반복 교정을 재사용하는 가져오기 교정 학습
- 손상된 보정 기록은 사진 등록 화면에서 **보정 기록 초기화 → 초기화 확인**으로 이 브라우저의 현재 게스트/계정 범위만 지울 수 있습니다. 취소하면 원문을 보존하며 재고·식단·검토 중인 값·서버 기록은 삭제하지 않습니다. 다른 OCR 탭을 닫고 진행해 주세요. 기록 변경·접근/삭제 실패는 완료로 표시하지 않고 다시 확인하도록 안내합니다. 정상 자료의 용량 부족을 초기화로 해결한다고 안내하지 않습니다. [복구 범위·검증·한계](docs/PRD_V3_CORRECTION_RECOVERY_2026-09-28.md)를 참고하세요.
- 확인한 OCR 항목의 추가·기존 항목 교체·수량 확인 무효화를 하나의 로컬 트랜잭션으로 저장합니다. 저장 실패 시 편집값과 기존 재고를 보존하고, 같은 준비 요청으로 재시도합니다. 교체 대상이 바뀌면 같은 화면에서 재고를 다시 읽고 교체 여부를 확인합니다. 계정·파일 전환의 늦은 결과는 폐기합니다. [저장 경계·검증·제약](docs/PRD_V3_OCR_ATOMIC_IMPORT_2026-09-28.md)을 참고하세요. 같은 사진을 새로 인식한 별도 요청까지 자동 중복 제거하는 기능은 아닙니다.

### 레시피 추천

- 가입이나 냉장고 등록 없이 이용하는 재료별 공개 탐색과 100개 내부 레시피 상세
- 선택 재료와 가장 많이 겹치는 후보에서 메뉴 하나 골라보기, 직전 결과를 제외한 다시 고르기, 정확한 조리법으로 연결
- 상세 6개·두부/버섯 허브 2개·활용 가이드 2개의 출처 검토 기반 메뉴 선택 설명
- 탐색 재료는 `have` URL 값으로만 전달하며 냉장고에 자동 저장하지 않음
- 정확한 재료명과 검토된 동의어만 반영하는 준비 체크리스트; 냉장고·팬트리 반영은 명시적으로 선택
- 바로 만들기, 하나만 더 사기, 임박 재료 활용 추천 그룹
- 빈 재료·팬트리만 보유·필수 그룹/양념 부족을 구분하는 추천 이유와 준비 상태
- 보유 재료, 팬트리 재료, 유통기한 임박도를 반영한 규칙 기반 점수
- PostgreSQL 레시피 카탈로그와 pgvector 임베딩을 이용한 후보 검색 기반
- 추천 노출과 클릭 이벤트 저장 및 학습 데이터 내보내기

### 주간 저녁 식단

- 최신 제안 PRD v3와 구현의 [최초 대조·리팩토링 기록](docs/PRD_V3_ALIGNMENT_AND_REFACTOR.md)을 구분해 관리합니다. 이후 AT-18·원자적 사용량 정정·첫 진입·OCR 복구와 로컬 파일럿 연결은 아래 후속 기록을 따릅니다. 실제 참여자 파일럿·출시 QA·메뉴 검수 확대는 아직 남아 있습니다.
- 홈의 첫 행동을 ‘이번 주 식단 만들기’로 제공하고 직접 입력·사진 등록·공개 메뉴 탐색을 유지합니다. 재료 등록 없이도 초안을 만들 수 있으며, 미등록 재료는 실제 미보유가 아닌 ‘구매 또는 보유 확인 필요’로 안내합니다. 장보기 수량은 등록된 재고 기준 계산으로 구분합니다. [첫 진입 검증 기록](docs/PRD_V3_FIRST_PLAN_2026-09-28.md)과 위 OCR 저장 후속 기록을 참고하세요.
- 전반 코드 점검 후 계정 개인정보 UI·레시피 요청 검증·다중 저장소 트랜잭션·점검 스크립트의 공통 경계를 정리했습니다. [리팩토링 범위·검증·별도 안정성 문제](docs/CODEBASE_REFACTOR_2026-09-28.md)를 참고하세요. 제품 정책과 데이터 스키마는 유지했습니다.
- 후속 안정성 수정으로 장보기 저장 실패 표시·입력 보존, 손상된 OCR 보정 데이터의 원문 보존과 학습 실패 시 재고 저장, 분석 동의 저장 실패 시 현재 페이지 분석 차단을 보강했습니다. [변경 범위·회귀 검증·남은 한계](docs/PRD_V3_STABILITY_2026-09-28.md)를 참고하세요.
- AT-18 후속으로 지난 미완료 확정 끼니의 예정 배분 보류와 명시적 조리·건너뛰기·날짜 이동, 자정 뒤 충돌 초안 복구를 연결했습니다. 과거 부족분은 새 구매 품목과 분리합니다. 일반 분석 철회 시 대기·진행 중 요청과 다른 탭을 보강하고, 저장소 getter 차단 시 앱 초기화를 보호했습니다. [정책·검증·제약](docs/PRD_V3_OVERDUE_AND_CONSENT_2026-09-28.md)을 참고하세요. 현재 재고의 보수적 재계산이며 과거 배치 예약 이력이나 실제 배포를 뜻하지 않습니다.
- 상단 **주간 식단** 또는 `/meal-plan`에서 1~2인 가구의 7일 저녁을 생성합니다.
- 기존 편집 메뉴 16개와 원문 식재료량을 대조한 한그릇 메뉴 6개에서 보유 재료·식사일 기준 유통기한·기피 재료를 반영하고 반복을 완화합니다. 메뉴 하나 교체, 고정, 외식·건너뛰기, 다시 포함하기를 지원합니다.
- 식사 인원·기피 재료·집에서 먹는 날을 주별로 저장합니다. 고정한 메뉴는 다시 추천해도 유지하며 새 조건과 충돌하면 확인 안내를 표시합니다.
- 재료 이름 일치는 분량 확보를 뜻하지 않습니다. 대조한 메뉴는 선택 인분의 필요량과 원문량을 구분하며, 미검수 양·조리용 물·기한 미확인 재고는 확인 필요로 남깁니다. 장보기 계산만으로 실제 냉장고 수량과 기존 목록을 변경하지 않습니다.
- 식품군 표시는 선택한 구성 재료에 근거한 안내이며, KDRI 영양 충족 평가나 열량·탄단지 계산이 아닙니다. 카탈로그의 분량·영양 전문가 검수는 아직 완료되지 않았습니다.
- `mealPlans` 저장소에 `guest` / `user:<id>` 범위별로 보관하며 기존 재료와 오늘 메뉴 선택 기록을 보존합니다. PRD 전용 브랜치는 수량 확인·장보기 메모·입고 이력과 별도 파일럿 저장소를 갖춘 IndexedDB v7을 사용합니다. 저장 실패·다른 탭의 수정 충돌을 알리고 오래된 식단이나 수동 항목을 덮어쓰지 않습니다.
- 식단·수량 확인·장보기 메모·입고·조리·소비 이력은 현재 브라우저에만 저장됩니다. 게스트 재료 가져오기, 서버 동기화, JSON 백업·내보내기에 포함되지 않습니다. 입고·소비로 바뀐 원본 재고는 기존 수동 동기화 대상이지만 정량 확인값·이력까지 동기화되는 것은 아닙니다. 계정 삭제·공유기기 정리는 해당 계정의 파일럿 저장소를 포함한 일곱 저장소를 원자적으로 비우며, 손상된 자료와 다른 탭의 DB 삭제 차단을 함께 검증했습니다.
- 후속 범위: 한 끼 검수 카탈로그 확충, 계측·성능·실사용 파일럿, 공식 데이터 기반 정량 영양, 월간 식단. [최신 진행 범위](docs/PRD_V2_PROGRESS.md)를 참고하세요.
- 냉장고의 **남은 수량 확인**에서 이름·남은 양·단위·조리 상태를 직접 확인해 저장하거나 취소할 수 있습니다. 원본 메모와 별도 보관하며 원본 변경 시 확인이 해제됩니다. [수량 확인 계약과 이전 검증](docs/PRD_V2_INVENTORY_QUANTITY.md)을 확인하세요.
- 시금치 리조또·칠곡석류국수에 채소 자장면·두유 파스타·감자밥·된장비빔밥을 추가해 1/2인분 생성·저장·장보기 계산에 연결했습니다. 원문 1인분과 환산량·미정량 조리용 물을 구분합니다. 페투치네/파스타면 등 확인한 식품명은 제외 필터에 함께 사용하지만 수량 호환 근거는 아닙니다. [원문 근거·검증·한계](docs/PRD_V2_DINNER_EXPANSION.md)를 확인하세요. 직접 조리·영양 검수 완료를 뜻하지 않습니다.
- 냉장고와 주간 식단의 **장보기 메모**에서 직접 입력·수정·체크·제거와 실제 산 양의 메모를 저장합니다. 식단·수동·재구매 출처를 나누며 이름이 같아도 임의로 합치지 않습니다. 메뉴를 바꾸거나 원래 수동 항목을 제거해도 구매 당시 필요량·출처·구매량 기록은 남습니다. **체크와 구매 메모는 실제 입고가 아니며 재고를 늘리거나 부족량에서 빼지 않습니다.** [저장 계약·검증·한계](docs/PRD_V2_SHOPPING_NOTES.md)를 참고하세요.
- 구매 메모 이력의 **입고할 양 확인**에서 실제 품목·양·단위·상태를 확인하면 새 재고로 한 번만 반영합니다. 필요량을 구매량으로 복사하지 않으며 수량을 모르면 미확인으로 보존합니다. 입고 뒤 부족량을 갱신하고, 메뉴를 건너뛰어도 구매 재고는 남습니다. [입고 계약·중복 방지·검증](docs/PRD_V2_PURCHASE_RECEIVING.md)을 참고하세요.
- 긴 식단의 주차·날짜 참조는 짧은 항목 ID와 분리해 보존합니다. 104주·728끼니 산술 자료로 조회·구매 메모·재시도를 검증했으며, 기존 구매 기록은 재작성하지 않습니다. 무제한 저장이나 장기 재고 보장을 뜻하지 않습니다.
- 확정 끼니의 **만들어 먹었어요**에서 계획량과 실제 사용량을 구분해 확인합니다. 제안 200g을 실제 150g으로 바꾸면 150g만 한 번 차감하며 식단·재고·장보기를 갱신합니다. 사용량을 모르면 조리 사실만 기록하고 관련 재고를 확인 필요로 남깁니다. **조리 이력 열기**에서 재고 반영 취소와 조리 기록 취소를 따로 확인하며, 나중에 입고한 재고를 보존하고 삭제된 식단의 이력에도 접근합니다. 오래된 입력·계정 변경·저장 실패와 키보드 초점을 검증했습니다. [화면·검증·한계](docs/PRD_V2_COOKING_UI.md), [저장 계약](docs/PRD_V2_COOKING_STORAGE.md)을 참고하세요.
- 조리 이력의 **실제 사용량 정정**에서 기존 사용량과 정정 후 재고를 비교하고 명시적으로 저장합니다. 기존 소비 역반영·새 사용량·식단·이력을 한 번에 저장하며 이후 입고와 최초 조리 사실·시각을 보존합니다. 0 사용량도 별도로 확인하고, 이후 취소는 최신 사용량에만 적용합니다. 현재 재고가 삭제되거나 수량·상태가 불명확하면 정정을 막습니다. [정정 계약·회귀 검증·한계](docs/PRD_V3_CONSUMPTION_CORRECTION_2026-09-28.md)를 참고하세요. 사용량 미확인 조리를 정량 소비로 바꾸는 기능이나 기기 간 동기화는 아닙니다.
- 확정 끼니의 **날짜 이동**과 **이번 주 남은 식단 다시 맞추기**에서 변경 전후 메뉴·필요량·전체 미래 장보기를 먼저 비교합니다. 관련 주에 초안이 있으면 먼저 확정해야 하며, 새 미리보기는 저장하지 않습니다. **변경안 확정**은 관련 주를 함께 저장하고 이전 확정본을 보관합니다. 재고 추가만으로 메뉴를 바꾸지 않고, 완료·고정·외식·지난 날짜는 재조정에서 보존합니다. 제외 재료와 충돌하는 예정 메뉴는 기존 초안 확정에서도 차단합니다. [동작·검증·한계](docs/PRD_V2_PLAN_CHANGES.md)를 참고하세요.
- 파일럿 준비용 **오프라인 지표 집계와 순수 계산 성능 측정 도구**를 제공합니다. 계정/게스트·중복·두 종류 취소·관측 누락·성숙 코호트를 구분하는 합성 예제와 실행법은 [파일럿 검증 기반](docs/PRD_V2_PILOT_FOUNDATION.md)에 있습니다. 당시 22개 메뉴의 데스크톱 측정은 30개 검수 조합·실기기 성능 목표 통과가 아닙니다.
- Footer의 **식단 파일럿**(`/pilot`)에서 별도로 동의한 뒤 이 브라우저의 최소 행동 기록을 모으고 직접 JSON을 내려받을 수 있습니다. 일반 분석 동의와 별개이며 자동 전송하지 않습니다. 시작 후 35일·다음 앱 접근 시 삭제, 철회 시 파일럿 기록만 삭제하며 재고·식단·조리는 보존합니다. 새로고침 뒤 명시적 재개, 기록 누락 안내, 오래된 요청·중복 집계 방어와 실제 저장 결과 연결은 [로컬 파일럿 연결 기록](docs/PRD_V3_PILOT_CONNECTION_2026-09-28.md)에 있습니다. 누락된 과거 행동·이미 내려받은 사본은 복원/회수하지 않으며, 로컬 집계는 실제 고유 계정 수가 아닙니다.
- 2026-09-28 파일럿 연결의 최종 검증은 단위·통합 **220파일 / 2,789개**, 전체 브라우저 **78개**, 린트·빌드·공개 정적 경로 **113개** 통과입니다. 새 `/pilot`의 서버 렌더링 등록 누락도 회귀 테스트 후 수정했습니다. 실제 운영 API·실기기·참여자 성과가 아니라 전용 작업트리의 로컬/API-mock 검사이며, 자세한 증거와 보관/복원 방법은 위 파일럿 연결 기록을 따릅니다.
- 이전 2026-09-27 단계의 재검증은 단위·통합 **2,204개**, 전체 브라우저 **52개**, 린트·빌드·공개 정적 경로 **113개** 통과였습니다. 최신 검증은 위 단계별 후속 기록을 따르며 아래 과거 수치를 현재 결과로 재사용하지 않습니다.
- 2026-09-19 전용 작업 트리에서 단위·통합 **2,089개**, 전체 브라우저 **51개**, 린트·빌드·공개 정적 경로 **113개**를 통과했습니다. skip·브라우저 자동 재시도 없이 검사했습니다. 예상 RED, 테스트 준비 오류와 첫 전체 검사의 새 계산 통합 테스트 1건 timeout 및 해당 검사만의 한도 조정은 [파일럿 기반 검증 기록](docs/PRD_V2_PILOT_FOUNDATION.md)에 구분해 보존합니다. PRD 전체 완료나 운영 배포 결과가 아닙니다.
- PRD v2의 [정량 계산 계약과 테스트](docs/PRD_V2_QUANTITY_CONTRACT.md)는 검수된 인분·재료량만 호환 단위로 합산하고, 미확인 양과 부분 합계를 구분합니다. 읽기 전용 장보기 미리보기에 연결했지만 기존 16개 조합의 정량 검수는 0개이며, 현재 재고의 자유 입력 수량도 자동 검증하지 않습니다.
- 후속으로 식약처 책자의 인분·재료표·조리 단계를 대조한 구성 요소 4개와 원문 변경 시 재검토를 요구하는 카탈로그를 추가했습니다. 필수 미정량 재료는 유지하며, 완성 식단 4개나 조리·영양 검수 완료를 뜻하지 않습니다. [진행 범위와 남은 단계](docs/PRD_V2_PROGRESS.md)를 구분해 관리합니다.
- 주간 식단의 생성·편집은 초안으로 저장하고, 사용자가 명시적으로 확정한 뒤에만 기존 확정본을 교체합니다. 수정 중에도 현재 확정본을 확인할 수 있고 이전 확정본은 로컬에 보관합니다. 과거 식단은 자동 확정하지 않으며, 확정만으로 재고가 줄거나 수량 검수가 완료되지는 않습니다. [저장 계약과 검증](docs/PRD_V2_PLAN_LIFECYCLE.md)을 참고하세요.
- **식단 장보기 확인**은 같은 시점의 로컬 재고·수량 확인값·모든 주의 확정 식단을 읽고, 오늘 이후의 필요 재료를 날짜순으로 계산합니다. 확인된 부족분·미확인 항목·선택 재료를 분리하며 기존 재구매 목록이나 재고를 쓰지 않습니다. 기존 편집 메뉴는 분량 확인 항목으로 남습니다. 새 메뉴도 과정 투입량이 미확인이면 전체 구매량을 확정하지 않습니다. [계산 경계와 이전 검증](docs/PRD_V2_ALLOCATION_PREVIEW.md)을 참고하세요.

### 계정과 동기화

- 개인정보 내보내기는 요청한 계정 세대와 화면이 유지될 때만 다운로드를 시작합니다. 계정 전환·같은 계정 재로그인에서 비밀번호/삭제 확인 폼을 초기화하며, 로그인·가입의 연속 제출과 화면 이탈 뒤 늦은 이동을 차단합니다. 이미 서버에 도착한 인증·삭제 요청을 취소하는 기능은 아닙니다. [계정 화면 안정성 검증](docs/PRD_V3_AUTH_UI_2026-09-28.md)을 참고하세요.
- JWT 기반 회원가입, 로그인, 로그아웃, 세션 복구
- `httpOnly` 쿠키, 단일 사용 refresh token 회전, 사용자별 24건 제한 session history, CSRF origin 검증
- 사용자 범위를 강제하는 조회·수정·삭제와 PostgreSQL RLS
- 계정 화면에서 실행하는 수동 서버 백업과 가져오기
- `clientId + updatedAt + deletedAt` 기반 레코드별 충돌 해결
- 네트워크 오류와 5xx에서 로컬 변경 및 재시도 상태 보존
- 4xx 오류를 성공으로 처리하지 않고 사용자에게 표시

## 현재 구현 상태

구현되어 있습니다.

- 게스트용 local-only CRUD와 오프라인 사용
- 선택형 Express API 및 Cloudflare Workers 실행 경로
- Prisma + PostgreSQL/Supabase 데이터 계층
- 충돌을 고려한 수동 재료 동기화와 삭제 tombstone
- OCR 등록, 검토, 교정 학습
- 규칙 기반 추천과 DB·임베딩 혼합 후보 검색
- 추천 이벤트 수집 및 데이터 내보내기
- 게스트·로그인 사용자별 오늘 메뉴 선택, 완료, 취소와 실패 후 재시도 기반
- 사용자별 팬트리·간단 취향 저장과 멱등 제품 이벤트 API
- Vitest, React Testing Library, Playwright, ESLint, GitHub Actions CI
- 공개 서비스·연락처·개인정보처리방침·사이트맵·`ads.txt`

### 검색 노출 경계

- 홈, 메뉴 추천, 서비스 소개, 문의, 개인정보 처리 안내와 공개 레시피·재료 허브·가이드는 빌드 시 본문과 경로별 메타·JSON-LD를 HTML로 프리렌더합니다.
- 재료, 주간 식단, OCR 가져오기, 로그인, 회원가입, 계정 화면은 Vercel `X-Robots-Tag`와 `robots.txt`에서 색인을 차단합니다.
- `npm run build`의 postbuild 단계는 공개 HTML의 `h1`, canonical, structured data와 기능 화면의 빈 `noindex` 앱 셸을 자동 검증합니다.
- Google, 네이버, Bing의 URL-prefix 소유권 인증은 각각 `VITE_GOOGLE_SITE_VERIFICATION`, `VITE_NAVER_SITE_VERIFICATION`, `VITE_BING_SITE_VERIFICATION` 값이 있을 때 정적 `<meta>` 태그로 빌드되고 postbuild에서 검증됩니다.
- 공개 URL 113개를 프리렌더하며, 재료·계정 등 개인 기능 화면은 검색 결과에 노출하지 않습니다. 탐색 쿼리는 별도 색인 URL로 만들지 않고 상세의 기본 URL을 canonical로 사용합니다.
- `VITE_GA_MEASUREMENT_ID`가 설정되어도 이용자가 분석을 허용하기 전에는 Google Analytics를 불러오지 않습니다.
- 브라우저에서는 화면별 코드를 지연 로딩하고, SEO 사전 렌더링은 별도의 동기식 서버 엔트리를 사용해 공개 HTML 본문을 그대로 유지합니다.
- `llms.txt`는 공개 정보와 사용자별 비공개 영역의 경계를 설명하며, 개인정보나 개인화 추천 데이터는 인용 대상으로 제공하지 않습니다.
운영용 MFDS seed와 재료 parser도 기본값은 dry run입니다. 실제 Supabase 쓰기는 `--execute`와 현재 `SUPABASE_URL`의 정확한 `--confirm-project-ref`를 함께 지정해야 하며, 자세한 절차는 [레시피 데이터 가져오기](docs/recipe-seeding.md)에 정리되어 있습니다.

공개 카탈로그와 로컬 추천은 서로 다른 데이터입니다. 출처와 ID가 일치하거나 명시적으로 연결한 추천에만 내부 상세를 제공합니다. 준비 목록을 검토하지 않은 94개 상세는 원문 재료 줄을 사용자가 직접 체크하며 수량이나 대체 가능성을 추정하지 않습니다. 콘텐츠 검토는 실제 조리 시험을 했다는 뜻이 아닙니다.

운영 반영 후 `npm run verify:public-deployment -- --report /tmp/fridgemate-public-deployment.json`으로 실제 본문·메타·사이트맵·404를 새 빌드와 대조합니다. 보고서는 기존 디렉터리에 새 `.json` 파일로만 생성하며 기존 파일이나 링크를 덮어쓰지 않습니다. 재검사 시 새 파일명을 사용하세요. 보고서 v2는 검사 경로·HTTP 상태·고정 오류 설명·개수를 보존하고, 원격 본문·리다이렉트 대상·예상 밖 URL·예외 메시지 원문은 저장하지 않습니다. 다른 출처로의 리다이렉트는 따라가지 않고 실패로 처리하며 응답 본문은 2 MiB로 제한합니다. [개선 계획과 진행 상태](docs/adsense-improvement-plan.md), [공개 콘텐츠 삭제 원인과 배포 검증](docs/deployment-recovery-notes.md), [구현 검증 기록](docs/public-experience-validation.md)을 함께 참고하세요.

공개 레시피 원본을 갱신할 때는 네트워크 미리보기와 로컬 저장을 나눕니다. 다음 첫 명령은 저장소 안에 검토 파일을 만들고, 내용을 확인한 뒤 두 번째 명령으로 고정된 `src/data/publicRecipes.json`에 반영합니다. `--write`는 허용하지 않으며 입력·출력의 심볼릭 링크와 하드 링크도 거부합니다. MFDS API 키는 환경 변수로 설정하며 명령에 직접 넣지 않습니다.

```bash
node scripts/export-public-recipes.js --limit=100 --print-review > public-recipes-review.json
# 출처, 재료, 조리 단계와 URL을 검토한 뒤 실행
node scripts/export-public-recipes.js --write-from=public-recipes-review.json
```

현재 공개 운영 서비스의 범위 밖입니다.

- 자동 백그라운드 및 실시간 동기화
- 공유 냉장고와 다중 사용자 협업
- 행동 데이터를 학습한 ML 순위 모델
- 별도 staging 검증을 마친 semantic 추천의 운영 활성화
- 새 메뉴·이벤트·개인화 migration의 staging 및 운영 적용
- 광범위한 브라우저·실기기 E2E

## 기술 구성

| 영역 | 기술 |
| --- | --- |
| 프론트엔드 | React, Vite, JavaScript, Tailwind CSS |
| 상태·로컬 저장 | React Context, custom hooks, IndexedDB |
| 백엔드 | Express, Cloudflare Workers |
| 데이터베이스 | Prisma, PostgreSQL, Supabase, pgvector |
| 인증 | JWT, `httpOnly` cookies, refresh token rotation, PostgreSQL RLS |
| OCR | Tesseract.js |
| 선택형 AI | Anthropic API, OpenAI-compatible embedding API |
| 테스트 | Vitest, React Testing Library, Playwright |
| 배포 | Vercel, Cloudflare, Supabase |

## 아키텍처

```text
React UI
  -> hooks / API clients
  -> IndexedDB 작업 사본
  -> 선택형 Express 또는 Cloudflare Workers API
  -> Prisma
  -> PostgreSQL / Supabase
```

### 재료 저장

```text
사용자 작업
  -> IndexedDB에 생성·수정·삭제 상태 저장
  -> pendingCreate / pendingUpdate / pendingDelete 유지
  -> React 화면 갱신
```

### 수동 동기화

```text
서버 백업
  -> pending 레코드와 tombstone 전송
  -> 서버가 userId + clientId 범위에서 최신 변경 적용
  -> 전체 서버 상태를 updatedAt 기준으로 로컬에 병합

서버 가져오기
  -> 서버 레코드와 tombstone 조회
  -> 최신 pending 로컬 변경 보존
  -> 서버에서 삭제된 깨끗한 로컬 캐시 제거
```

동일한 동기화를 반복해도 `clientId` 기준으로 중복 생성되지 않습니다. 삭제에는 명시적 복원 동작이 아직 없으므로 tombstone이 활성 레코드보다 항상 우선하며, 기기 시계가 더 최신인 오래된 편집도 삭제 항목을 되살리지 못합니다. 삭제 즉시 이름, 수량, 분류, 보관 위치, 날짜, 메모 같은 업무 payload는 IndexedDB와 서버에서 제거되고 `id`, `clientId`, `userId`(서버), `updatedAt`, `deletedAt`, 로컬 동기화 상태만 남습니다. 이 최소 tombstone은 안전한 서버 세대 번호/checkpoint 프로토콜이 도입되기 전까지 자동으로 물리 삭제하지 않습니다. 자동 업로드는 아직 하지 않습니다.

자세한 내용은 [아키텍처 문서](docs/ARCHITECTURE.md)를 참고하세요.

## 빠른 시작

요구 사항:

- Node.js `24` 권장
- npm
- 백엔드 모드 사용 시 PostgreSQL

의존성을 설치합니다.

```bash
npm install
```

환경 설정 예시를 복사합니다.

```bash
cp .env.example .env
```

프론트엔드 local-only 모드를 실행합니다.

```bash
npm run dev
```

기본 주소는 `http://localhost:5173`입니다.

백엔드 모드를 함께 사용할 때는 별도 터미널에서 실행합니다.

설치 기준은 전체 저장소의 루트입니다. [격리된 실제 PostgreSQL 검사](docs/PRD_V3_LOCAL_POSTGRES_2026-09-29.md)에서 현재 Prisma 조합의 User 조회·커밋·롤백 6개를 새 임시 DB 두 개에서 확인했습니다. 전체 migration은 `pgvector` 부재로 중단됐으며, RLS·운영 인증·Workers/Hyperdrive 호환성이나 `server/` 단독 설치가 검증된 것은 아닙니다.

```bash
npm run dev:server
npm run dev
```

백엔드 상태 확인 주소:

```text
http://localhost:4000/health
http://localhost:4000/api/health
```

## 환경 변수

전체 목록과 설명은 [.env.example](.env.example)과 [server/.env.example](server/.env.example)에 있습니다. 실제 키와 데이터베이스 주소는 커밋하지 마세요.

주요 프론트엔드 변수:

```env
VITE_API_URL=
VITE_ENABLE_OCR=true
VITE_SENTRY_DSN=
VITE_ADSENSE_VERIFICATION_ENABLED=true
VITE_ADSENSE_SERVING_ENABLED=false
```

주요 백엔드 변수:

```env
PORT=4000
CLIENT_ORIGIN=http://localhost:5173
ALLOWED_ORIGINS=http://localhost:5173
DATABASE_URL=
DIRECT_URL=
JWT_SECRET=
ANTHROPIC_API_KEY=
OPENAI_API_KEY=
RECIPE_EMBEDDING_MODEL=text-embedding-3-small
RECIPE_EMBEDDING_DIMENSIONS=1536
AI_USAGE_LOGGING_ENABLED=false
SEMANTIC_RECIPE_API_ENABLED=false
API_SLOW_REQUEST_MS=1500
```

주의 사항:

- 서비스 역할 키와 AI API 키는 서버에서만 사용합니다.
- 비밀값에 `VITE_` 접두사를 붙이지 않습니다.
- 가입 제한은 실제 클라이언트 주소와 정규화 이메일 조합을 사용합니다. 로그인은 여기에 정규화 이메일 기준 30회/시간 공용 예산을 더해 다중 주소 추측을 제한합니다.
- AI·semantic 추천은 사용자 및 클라이언트 주소별로 제한합니다. semantic 추천은 요청 재료가 없을 때 최근 저장 재료를 최대 50개만 처리하고 기본 가중 비용 5를 양쪽 예산에서 차감합니다.
- OCR 교정 제안·저장 API는 처리 항목 수만큼 공용 예산을 차감합니다. 사용자 기준 분당 60개·시간당 180개, 클라이언트 주소 기준 분당 600개·시간당 1,800개를 넘으면 `429`와 `Retry-After`를 반환합니다.
- 서버 사용자 정보는 `localStorage`에 보관하지 않습니다. 시작할 때 HttpOnly 갱신 쿠키로 세션을 다시 확인하며, 확인 실패 시 사용자 전용 로컬 캐시를 잠급니다. 서버 로그아웃 결과를 확인하지 못하면 대기 표식을 남겨 다음 연결에서 로그아웃 상태를 다시 확인합니다.
- 로그인 사용자는 `GET /api/auth/data-export`로 비밀번호·세션 비밀값을 제외한 자기 데이터를 내려받을 수 있습니다. `DELETE /api/auth/account`는 현재 비밀번호 재확인, 사용자·클라이언트 주소별 시도 제한, RLS 사용자 범위 정책을 거쳐 계정과 연결 데이터를 한 트랜잭션에서 삭제합니다.
- 계정 화면에서 삭제가 성공하면 현재 기기의 해당 계정 전용 IndexedDB 재료 캐시·오늘 메뉴 선택·주간 식단·수량 확인값도 지웁니다. 다른 기기의 로컬 저장소는 해당 기기에서 사이트 데이터를 별도로 삭제해야 합니다.
- `RECIPE_EMBEDDING_DIMENSIONS`는 DB의 `recipe_embeddings.embedding` 차원과 같아야 합니다.
- `SEMANTIC_RECIPE_API_ENABLED`는 운영 임베딩 무결성과 검색 품질을 확인한 뒤에만 `true`로 전환합니다. 명시적 API는 `POST /api/recipes/recommendations/semantic`이며 인증과 요청 제한을 적용합니다.
- 핵심 앱 기능은 AI API 키 없이도 동작합니다.
- API 오류 응답에는 지원 추적용 request ID가 포함되며, 선택형 AI 사용량 로그에는 프롬프트·재료명·벡터 없이 모델, 건수, 토큰, 지연시간과 설정된 경우의 추정 비용만 기록합니다.

## 데이터베이스

Prisma schema 검증과 Client 생성:

```bash
npm run prisma:validate
npm run prisma:generate
```

로컬 migration 생성·적용:

```bash
npm run prisma:migrate
```

운영 migration은 배포 체크리스트와 SQL을 검토한 뒤 별도 작업으로 수행합니다.

```bash
npm run prisma:deploy
```

이 명령은 개발·테스트 과정에서 자동으로 실행하지 않습니다.

운영 백업 존재 여부와 PITR 설정은 Supabase Dashboard 또는 Management API의 직접 증거로 확인해야 합니다. 운영 DB를 덮어쓰지 않는 별도 프로젝트 복구 훈련과 RLS 검증 절차는 [백업·복구 런북](docs/BACKUP_RESTORE_RUNBOOK.md)을 따릅니다.

예약 백업 워크플로는 현재 Supabase 서버와 같은 PostgreSQL 17 `pg_dump`/`pg_restore`를 명시적으로 사용합니다. Supabase가 PostgreSQL major 버전을 올리면 백업 클라이언트 major도 함께 갱신해야 합니다.

Free 플랜에서 수동 논리 백업을 준비할 때는 전용 암호화 디렉터리를 저장소 밖에 먼저 만들고 다음 읽기 전용 preflight를 실행합니다. 이 명령은 `BACKUP_DATABASE_URL` 또는 `DIRECT_URL`의 비밀번호를 출력하지 않으며, transaction pooler, 다른 Supabase project ref, 저장소 내부·symlink·비어 있지 않은 출력 경로, 미설치 Supabase CLI/Docker를 거부합니다.

```bash
npm run backup:preflight -- --output-dir=ABSOLUTE_ENCRYPTED_DIRECTORY --confirm-database-host=EXACT_DB_HOST --confirm-encrypted-storage
```

preflight 성공은 백업 완료가 아닙니다. 실제 dump와 별도 프로젝트 복구는 [백업·복구 런북](docs/BACKUP_RESTORE_RUNBOOK.md)의 승인·검증 단계를 거쳐야 합니다.

## 레시피 임베딩과 검색

임베딩 저장은 모델 훈련이 아닙니다. 레시피 제목·설명·분류된 재료를 벡터로 변환해 semantic 후보를 가져오고, 최종 순위는 재료 일치도와 유통기한 규칙으로 다시 계산합니다.

현재 source of truth:

- 레시피: UUID 기반 `recipes`
- 재료: `recipe_ingredients`
- 벡터: `recipe_embeddings`
- 검색 연결: `recipe_embeddings.recipe_id -> recipes.id`

임베딩 명령은 기본적으로 쓰지 않는 안전 모드입니다.

```bash
npm run recipes:embed -- --dry-run --limit=10
```

제한적 운영 backfill은 조회 범위와 실제 쓰기 상한을 분리합니다. `--all`은 실행 시점의 전체 카탈로그 수를 자동으로 읽으며, 실제 쓰기에서는 유한한 `--max-writes`가 없으면 실행 자체를 거부합니다.

품질 fixture에 포함된 레시피만 선택적으로 점검할 때는 `--target-fixture`를 사용합니다. 이 모드는 fixture의 `id` 또는 `externalId`를 실제 카탈로그와 대조하고 이름 불일치·누락·중복을 거부하며, 실제 쓰기에서는 `--all`과 마찬가지로 `--max-writes`가 필수입니다.

대량 작업 전에는 checkpoint를 만들고, API batch·재시도·재개 상태를 사용하는 명령으로 실행합니다. checkpoint 파일에는 원시 벡터가 있으므로 `.local/` 또는 별도의 보호된 로컬 경로에만 보관합니다. 운영 1,166개 backfill은 완료됐으며 아래 명령은 재실행 지시가 아니라 복구·운영 절차의 참고입니다.

```bash
npm run recipes:checkpoint -- --dry-run
npm run recipes:verify-embeddings -- --expect-recipes=1166 --expect-embeddings=1166 --expect-current=1166 --expect-missing=0 --expect-stale=0
```

실제 backfill은 `.local/recipe-embedding-backfill-state.json`에 마지막으로 안전하게 반영된 UUID를 기록합니다. `--resume`은 operation, model, dimension이 일치할 때만 이 위치부터 keyset pagination으로 재개합니다. 429, 5xx, 네트워크 오류는 지수 backoff로 재시도하며 4xx는 즉시 실패합니다. 요약에는 API 입력·요청·재시도·예상 토큰·처리량만 표시되고 비밀값과 원시 벡터는 표시되지 않습니다.

고정 fixture를 이용한 읽기 전용 품질 평가:

```bash
npm run recipes:embed -- --evaluate --dry-run --limit=1166
npm run recipes:embed -- --evaluate --execute --limit=1166 --output=docs/recipe-search-quality-report.json
```

실제 보유 재료 3~5개, 임박 재료, `계란`/`달걀`과 `파`/`대파` 동의어를 포함한 20개 한국 가정식 fixture도 별도로 유지합니다.

```bash
npm run recipes:embed -- --evaluate --dry-run --stored-vectors --limit=1166 --fixture=scripts/fixtures/recipe-search-home-meal-evaluation.json
```

전체 카탈로그는 MFDS 1,146개와 재료 행을 갖춘 `curated_home_v1` 20개를 합친 1,166개입니다. 운영 임베딩은 `current=1,166`, `missing=0`, `stale=0`, 중복 0, 고아 0, `vector(1536)`로 검증됐습니다. 최종 저장 벡터 평가는 고정 10-query Hit@5 `9/10`, 한국 가정식 20-query 후보 100개 재현율 `19/20`, 70/30 재정렬 Hit@5 `15/20`을 기록했습니다. 벡터 단독 한국 가정식 Hit@5는 `12/20`이므로 pgvector는 후보 생성에만 사용하고 재료·유통기한 규칙 재정렬을 유지합니다. 상세 기준은 [레시피 검색 품질 문서](docs/RECIPE_SEARCH_QUALITY.md), 운영 기록은 [임베딩 운영 기록](docs/RECIPE_EMBEDDING_OPERATIONS.md)에 있습니다.

## 추천 이벤트 내보내기

추천 노출부터 선택, 관심 없음, 외부 링크, 조리 완료까지의 퍼널을 오프라인 분석용 JSONL 또는 CSV로 내보낼 수 있습니다. 내보내기는 사용자·세션 식별자를 결과 파일에서 제외하고 recipe key 형식과 catalog FK 연결률을 집계해 표시합니다.

```bash
npm run export:recommendation-training -- --format=jsonl --output=data/training/recommendation-training.jsonl
npm run export:recommendation-training -- --format=csv --output=data/training/recommendation-training.csv
```

기본 조회 범위는 실행 시각까지 최근 180일입니다. 재현 가능한 과거 구간은 `--since=2026-03-03T00:00:00.000Z --until=2026-08-30T00:00:00.000Z`처럼 명시할 수 있으며, 180일보다 넓은 범위와 미래 종료 시각은 거부됩니다. 두 쿼리 모두 클라이언트 시각이 아닌 서버 `createdAt` 경계를 사용합니다.

이 데이터는 자동 학습에 사용되지 않으며, 일반 앱 실행에도 필요하지 않습니다.

## 이벤트 보존 작업

계정 연결 원본 ProductEvent 90일, RecommendationEvent 180일 보존 정책을 적용하기 위한 수동 운영 도구입니다. 과거의 `userId IS NULL` 추천 이벤트는 현재 수집 경로에서 새로 생길 수 없는 legacy 행이므로 같은 bounded 작업에서 우선 정리합니다. 현재 저장소에는 반복 scheduler가 없으므로 이 명령을 한 번 추가한 것만으로 보존기간이 자동 집행되지는 않습니다.

```bash
# DIRECT_URL 또는 별도 EVENT_RETENTION_DATABASE_URL을 사용하는 읽기 전용 미리보기
npm run events:prune-retention

# 출력된 정확한 호스트를 확인한 뒤에만 실제 삭제
npm run events:prune-retention -- --apply --confirm-database-host=DB_HOST
```

작업은 기본 500행 배치, 실행당 최대 5,000행, 30초 제한으로 동작합니다. `--batch-size`, `--max-delete`, `--max-runtime-ms`로 더 작은 운영 한도를 정할 수 있지만 코드의 상한을 넘길 수 없습니다. 배포 API의 runtime `DATABASE_URL`과 tenant RLS에 묶인 앱 역할은 이 작업에 허용되지 않으며, 로그에는 보존 정책과 테이블별 집계만 기록됩니다. 반복 집행은 별도 권한 검토를 거친 scheduler가 배포되기 전까지 승인된 운영자가 이 명령을 실행하고 결과를 확인해야 합니다.

## 기존 재료 tombstone payload 정리

`20260830190000`~`20260830192000` 세 migration은 활성 레코드 CHECK 추가, 일반 DML을 막지 않는 제약 검증, 짧은 payload 컬럼 nullable 전환을 순서대로 수행합니다. 기존 삭제 행은 변경하지 않습니다. 세 migration을 모두 적용한 뒤 scrub-aware 서버를 배포하고 구 서버 인스턴스가 모두 종료된 것을 확인한 다음, 새 프런트엔드를 배포해야 합니다. 그 뒤에만 기존 full tombstone을 제한된 수동 작업으로 정리합니다.

```bash
# DIRECT_URL 또는 별도 INGREDIENT_TOMBSTONE_SCRUB_DATABASE_URL을 사용하는 읽기 전용 미리보기
npm run ingredients:scrub-tombstones

# 출력된 정확한 호스트를 확인한 뒤 실제 payload NULL 처리
npm run ingredients:scrub-tombstones -- --apply --confirm-database-host=DB_HOST
```

기본 한도는 500행 배치, 실행당 5,000행, 30초이며 `--batch-size`, `--max-update`, `--max-runtime-ms`로 더 작게 조정할 수 있습니다. 각 배치는 별도 DB 작업으로 커밋되고, `id`, `clientId`, `userId`, `updatedAt`, `deletedAt`은 변경하지 않으며 행을 삭제하지 않습니다. 로그는 대상 호스트와 집계만 포함합니다. `mayHaveMore` 또는 `remainingEligibleCount`가 남으면 승인된 운영자가 다시 실행해야 하며, 이 도구는 자동 반복 작업이 아닙니다.

## 검사와 테스트

주간 식단 확인: `npm run dev` 실행 후 `/meal-plan`에서 식단 생성 → 메뉴 교체 → 고정 → 다시 추천 → 새로고침을 확인합니다. 로그인·로그아웃을 해도 게스트/계정 식단이 각각 유지되고 냉장고 수량은 바뀌지 않아야 합니다.

식단 브라우저 테스트만 실행하려면 `npx playwright test e2e/meal-plan.spec.js e2e/meal-plan-account.spec.js`를 사용합니다. 로컬에 `.worktrees/` 등 다른 체크아웃이 중첩되어 있으면 Vitest의 `--exclude '.worktrees/**'`, ESLint의 `--ignore-pattern '.worktrees/**'` 옵션으로 현재 프로젝트만 검사하세요.

학습용 추천 중복 정책 실습은 [별도 보존 커밋의 기록과 재현 제약](docs/recommendation-agent-exercise-state-2026-09-13.md)을 참고하세요. 의도적으로 실패하는 실습 테스트는 main의 테스트 묶음에 포함하지 않습니다. 그 기록의 39개 통과·17개 실패는 현재 main의 검증 결과가 아닙니다.

필수 검사:

```bash
npm run lint
npm run test:run
npm run build
npm run prisma:validate
```

선택 검사:

```bash
npm run test:coverage
npm run test:e2e
npm run worker:dry-run
```

Playwright는 local-only 핵심 흐름과 API 모드의 로그인, 동기화, 삭제 충돌, 네트워크 실패, 세션 만료 흐름을 확인합니다. 오늘 메뉴 선택·재시도 E2E는 새 migration의 staging 적용 후 최종 운영 게이트로 실행합니다.

실제 빌드 파일은 local-only 설정으로 `npm run build`한 뒤 `npm run test:e2e:preview`로 별도 검사합니다. 개발 서버 대신 `dist`를 열며 재고·식단·공개 메뉴와 테스트 준비 오류를 다룹니다. CI는 API URL 별칭·광고·분석·Sentry를 끄고 테스트용 빌드를 따로 만듭니다. [정확한 실행 환경과 명령](docs/PRD_V3_CLEAN_INSTALL_2026-09-28.md)을 따르세요. preview는 운영 API·Vercel rewrite/헤더 검사나 Linux 실행 결과를 대신하지 않습니다.

## 주요 디렉터리

```text
FridgeMate/
|-- .github/              # 이슈·PR 템플릿과 CI
|-- docs/                 # 아키텍처, 배포, AI, 품질 문서
|-- e2e/                  # Playwright 테스트
|-- prisma/               # schema와 migrations
|-- scripts/              # seed, embedding, 평가, export
|-- server/src/           # Express/Workers 백엔드
|-- src/                  # React 애플리케이션
|-- .env.example
|-- package.json
`-- README.md
```

## 배포와 운영 문서

- [Cloudflare 배포](docs/CLOUDFLARE_DEPLOYMENT.md)
- [Semantic staging 실행 절차](docs/STAGING_SEMANTIC_RUNBOOK.md)
- [배포 체크리스트](docs/DEPLOY_CHECKLIST.md)
- [AdSense 설정](docs/ADSENSE_SETUP.md)
- [공개 콘텐츠·추천 경험 개선 계획](docs/adsense-improvement-plan.md)
- [2026-09-08 AdSense 후속 점검 기록](docs/adsense-followup-2026-09-08.md)
- [AI 기능과 안전 경계](docs/AI_FEATURES.md)
- [레시피 데이터 가져오기](docs/recipe-seeding.md)
- [로드맵](docs/ROADMAP.md)
- [변경 이력](CHANGELOG.md)

## 다음 단계

1. 별도 Supabase·Cloudflare staging을 만들고 레시피 카탈로그만 복사해 semantic 품질·fallback·인증·요청 제한을 검증
2. staging 통과 후 운영 Worker의 semantic flag만 제한적으로 활성화하고 24시간 오류·fallback·지연·API 사용량 관찰
3. `MenuDecision`, 추천 이벤트 FK, 팬트리·취향·제품 이벤트 migration을 staging에서 검토하고 메뉴 선택 E2E 통과
4. 운영 migration을 별도 승인·적용한 뒤 하루 한 개 메뉴 선택 루프와 행동 이벤트 수집 활성화
5. 최소 30일·5,000 impressions·500 selections/completions 이후에만 popularity/CTR 보정을 검토

## 기여하기

기여는 언제든 환영합니다. [CONTRIBUTING.md](CONTRIBUTING.md)를 확인한 뒤 이슈 또는 Pull Request를 등록해 주세요.

처음 기여하기 좋은 영역:

- 문서와 테스트 보강
- 접근성 및 반응형 UI 개선
- OCR 파서 회귀 사례 추가
- 재료 분류와 추천 점수 설명 개선

## 라이선스

이 프로젝트는 [MIT License](LICENSE)로 배포됩니다.

공개 메뉴 선택 기능의 [구현·QA 기록](docs/reference-menu-decision-2026-09-08.md)과 [배포·AdSense·콘텐츠 후속 계획](docs/public-release-plan-2026-09-08.md)을 참고하세요. 메뉴 고르기는 냉장고나 오늘 메뉴 기록을 자동 저장하지 않습니다.
