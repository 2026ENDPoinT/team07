# Render + Supabase 설정 (통합판)

1. Supabase PostgreSQL 데이터베이스를 미리 준비하고 **백업**합니다.
2. Render 서비스의 Environment에 `DATABASE_URL` (Supabase Session Pooler URI),
   `NODE_ENV=production`, `NODE_VERSION=24.12.0`, `APP_ORIGIN=https://실제서비스.onrender.com`을 설정합니다.
3. Render에서 Build: `npm install`, Start: `npm start`, Branch: 테스트 브랜치를 설정합니다.
   `package.json`이 저장소 루트에 있다면 Root Directory는 비워 둡니다.
4. 배포 완료 후 새로운 테스트 계정으로 로그인해 `자료구조`, 3학점, `2026-1`, A+ 과목을 추가합니다.
5. 과목 수정·삭제, `2026-여름` 학기 과목, 학년 변경, 성적 분석 및 졸업 잔여학점,
   재로그인/재배포 후 보존, 다른 계정과의 데이터 격리를 확인합니다.
6. 검증이 끝난 경우에만 Pull Request로 main에 병합합니다.

## DB 변경 범위

기존 `users`, `sessions`, `auth_attempts`, `user_courses` 테이블을 사용합니다.
서버는 `user_courses`에 없으면 `current_year`, `revision` 열을 추가하며 **기존 courses_json은 유지**합니다.
동일한 데이터베이스를 운영/테스트 서버에 동시에 붙이면 테스트 데이터가 운영에 영향을 미칩니다.
별도 테스트용 Supabase DB를 권장합니다.

문제가 발생하면 Render Logs에서 시작 오류 유형과 `DATABASE_URL`·`APP_ORIGIN` 등록 여부를
확인하세요. 전체 연결 문자열과 비밀번호는 로그/채팅/GitHub에 공개하지 마세요.

자세한 기능과 API는 [README.md](README.md)를 참고하세요.
