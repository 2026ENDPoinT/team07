# Team07: Render + Supabase 배포 안내

## 무엇이 바뀌었나요?
- `DATABASE_URL`이 있으면 Supabase PostgreSQL을 사용합니다. 없으면 로컬 개발/테스트용 SQLite를 사용합니다.
- 회원, 로그인 세션, 로그인 제한 기록 및 회원별 과목 목록을 데이터베이스에 저장합니다.
- 학업 대시보드와 성적 분석 페이지 모두 `/api/courses`에서 데이터를 읽습니다.
- 과목 추가/수정/삭제 시 서버로 전송하여 저장 성공 후 화면을 갱신합니다.
- 기존 학점 계산/그래프 모듈은 유지합니다.

## 배포 순서
1. Render > Environment에 `DATABASE_URL` (Supabase **Session pooler** URI)을 설정합니다. DB 암호가 URL 예약문자를 포함하면 URL 인코딩이 필요합니다.
2. 기존 `APP_ORIGIN`을 실제 Render 서비스의 HTTPS 주소로 설정합니다.
3. 이 프로젝트를 GitHub에 업로드합니다. Render Root Directory가 `team07-main`인지 확인합니다.
4. Build Command: `npm install`, Start Command: `npm start`.
5. Render 배포 로그에 오류가 없는지 확인합니다. 서버 시작 시 PostgreSQL 테이블이 자동 생성됩니다.
6. 새 계정으로 가입한 후 과목을 추가하고, 다른 브라우저/기기에서 같은 계정으로 로그인하여 조회합니다.
7. Render를 다시 배포하고 데이터가 유지되는지 확인합니다.

## 주의
- 기존 Render의 SQLite 회원 계정은 Supabase로 자동 이전되지 않습니다. **새로 회원가입**해야 합니다.
- 기존 브라우저 `localStorage`의 과목도 자동 이전되지 않습니다. 필요한 과목은 다시 입력해야 합니다.
- 최초 로그인 후 예시 과목이 보일 수 있지만 **예시 데이터는 저장된 본인 데이터가 아닙니다**. 첫 과목 추가/수정/삭제 시 현재 목록 전체가 서버에 저장됩니다. 예시가 필요 없다면 예시 과목을 삭제하고 저장하세요.
- 같은 계정으로 두 기기에서 동시에 수정하면 마지막 저장 내용이 반영됩니다. 공동 편집 기능은 아닙니다.
- `DATABASE_URL`은 절대로 GitHub에 올리지 마세요. Supabase 무료 플랜의 일시중지/한도/백업 정책을 확인하세요.
- 학년 선택은 현재 브라우저별 localStorage에 남습니다. 과목/성적 및 회원 데이터는 서버 DB에 저장됩니다.
- ZIP에 포함된 기존 `storage/team07.db`는 GitHub에 업로드하지 않는 것을 권장합니다.

## 기술 구현
- `server/db.js`: SQLite / PostgreSQL 공통 비동기 query 어댑터
- `server/schema.postgres.sql`: PostgreSQL 테이블
- `server/app.js`: 사용자 인증과 `GET /api/courses`, `PUT /api/courses`
- `public/dashboard.js`: 서버에서 과목 불러오기 및 저장
- `public/grade-analysis.js`: 서버에서 과목 불러오기
- `package.json`: `pg` 의존성
