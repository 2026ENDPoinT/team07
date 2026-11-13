# Team07 인증·저장 구조 안내

본 통합판의 서버 인증은 `server/app.js`, DB 접근은 `server/db.js`,
학사 데이터 검증 및 저장은 `server/academic-state.js`에서 처리합니다.

- 운영 환경: `DATABASE_URL`로 연결한 Supabase PostgreSQL에서 회원·세션·과목·학년 저장
- 로컬 환경: `DATABASE_URL`이 없으면 SQLite 개발용 DB 사용
- 과목 데이터: `user_courses.courses_json` (기존 external-base와 동일한 테이블/열)
- 추가 열: `user_courses.current_year`, `user_courses.revision` (기존 과목 보존)
- API: `/api/auth/*`, `/api/academic`, 기존 호환 `/api/courses`
- 로그인은 15~128자 비밀번호, scrypt 해시, SHA-256 세션 토큰 해시, HttpOnly 세션 쿠키 사용
- 운영 모드에는 HTTPS `APP_ORIGIN`과 `__Host-` Secure 쿠키 사용
- 저장 요청에는 동일 출처(Origin) 검사 및 계정별 데이터 격리 적용

최신 배포 및 설정은 반드시 [README.md](README.md)를 참고하세요.
