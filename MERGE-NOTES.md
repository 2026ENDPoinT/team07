# main 병합 내역

현재 calander 브랜치의 달력 기능과 원격 main의 계절학기·대시보드 변경을 통합합니다.

## 유지한 저장 구조

- 로컬 SQLite: 인증 DB와 사용자별 학사·일정 DB 파일 분리
- Supabase: 비공개 app_private 스키마의 인증·학사·일정 테이블
- PostgreSQL TLS 인증서 검증, 배포 진단, Render 설정과 /healthz
- 기존 달력 조회·편집·기간 표시 및 학사/일정의 독립적인 버전 검사

## 적용한 main 변경

- 여름·겨울 계절학기 입력 및 학기 순서에 따른 필터·GPA 그래프
- 과목 학점 입력: 화면과 서버 모두 1~12 정수
- 기존 /api/courses 호환 API를 동일한 계정별 저장소에 연결
- 이전 server/academic-state.js 모듈 경로도 server/academic.js로 연결

## 데이터 및 검증

- 로컬 SQLite와 Supabase 사이, public.user_courses와 app_private 사이의 자동 데이터 이전은 수행하지 않습니다. 기존 SQLite user_courses 행은 보존하고 학년/버전 열만 보강합니다. 신규 저장은 현재 브랜치의 계정별 저장소를 사용합니다.
- 실제 Supabase 접속 검증과 운영 데이터 이전은 포함하지 않습니다.
- 기존 인증·학사·달력·PostgreSQL 테스트에 main의 계절학기·구버전 API·스키마 보존 테스트를 통합합니다.
- 비교 ZIP 폴더는 Git 및 테스트 대상에서 제외합니다.
- 달력 연도 범위를 기존 문서·검증과 같은 1~9999년으로 맞췄습니다.
- 검증: Node.js 24.12.0에서 npm test 47개 전부 통과. 실제 Supabase 연결은 수행하지 않았습니다.
