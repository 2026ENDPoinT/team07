# 병합 내역 (team07-external-base + team07-main (2))

## 유지한 external-base 부분
- PostgreSQL/Supabase 연결 (`server/db.js`, `pg` 의존성)
- 기존 `users`, `sessions`, `auth_attempts`, `user_courses` 저장 구조
- 회원가입·로그인·세션 등 인증 로직과 기존 `/api/courses` 호환 API

## 적용한 main (2) 최신 기능
- `public/index.html`, `public/dashboard.js`, `public/grade-analysis.js`, `public/css/dashboard.css`
- `js/grades/grades.js` 및 테스트
- `/js/academic-api.js`와 `/js/credits/graduation.js` 정적 파일 제공
- 학년 저장, 계절학기, 학기별 필터, 졸업 잔여학점, 과목 CRUD·성적 분석

## 핵심 연동
- `/api/academic` API 추가: `server/academic-state.js`
- 기존 `user_courses.courses_json`에 최신 과목 목록 저장 (과목명 필드 `courseName` 통일)
- `user_courses.current_year`, `user_courses.revision` 추가: PostgreSQL은 자동 스키마 보강, SQLite는 기존 파일 업그레이드
- 다른 탭의 오래된 저장 요청은 409 응답
- Render에서 `DATABASE_URL` 필수; 기본 HOST를 `0.0.0.0`으로 설정
- Render 시작 시 DB 설정 오류 종류를 (비밀값을 가리고) 로그에 기록
- `package-lock.json`에 `pg` 의존성 및 잠금 버전 반영

## 테스트
- `npm test`: 28개 통과 (Node.js 22.16.0 로컬 환경의 SQLite 기반 테스트)
- HTTP로 실제 `npm start` 후 `/` 요청 → 로그인 페이지로 302 이동 확인
- 실제 Supabase에 접속한 배포 검증은 수행하지 않음; 테스트용 Supabase·Render 환경에서 확인 필요
