# Team07 통합 웹사이트 (Supabase DB + main(2) 최신 기능)

이 프로젝트는 `team07-external-base`의 **Supabase PostgreSQL 사용자/세션/과목 저장 구조**에
`team07-main (2)`의 **최신 대시보드·성적 분석·졸업 잔여학점·학기 필터·과목 CRUD·학년 저장**을 통합한 버전입니다.

## 주요 기능

- 회원가입, 로그인, 로그아웃 및 사용자별 세션 관리
- 사용자별 과목 추가/수정/삭제, 전체·학기별 과목 조회
- 전체/전공 이수학점, 현재 수강학점, 누적·학기별 GPA
- 전체 및 전공 졸업 잔여학점, 그래프와 성적 분석
- 1·2학기 및 여름·겨울 계절학기 입력
- 학년(1~4학년)과 과목을 **계정별 DB**에 함께 저장
- 다중 탭 수정 시 버전(revision) 검사로 기존 데이터를 덮어쓰지 않도록 보호

## 로컬 실행

Node.js **24.12.0 이상**을 권장합니다.

```bash
npm install
npm test
npm start
```

브라우저에서 `http://localhost:3000/`으로 접속합니다. 로컬에 `DATABASE_URL`이 없으면 개발용
SQLite(`storage/team07.db`)를 사용합니다. `.env`가 없다는 출력은 환경 변수를 별도 설정했다면 정상입니다.

## Render + Supabase 운영 배포

| Render 설정 | 값 |
| --- | --- |
| Branch | 통합 코드를 올린 테스트 브랜치 (테스트 후 main으로 병합) |
| Root Directory | `package.json`이 있는 폴더 (저장소 루트에 파일을 올렸다면 비워 둠) |
| Build Command | `npm install` |
| Start Command | `npm start` |
| `NODE_VERSION` | `24.12.0` |
| `NODE_ENV` | `production` |
| `APP_ORIGIN` | **Render 서비스의 실제 HTTPS 주소** (끝에 `/` 없이, 예: `https://example.onrender.com`) |
| `DATABASE_URL` | Supabase PostgreSQL 연결 URI (비밀값, Render Environment에만 입력) |
| `HOST` | `0.0.0.0` (설정 생략해도 기본값) |

Render에서는 `DATABASE_URL`이 없으면 **임시 SQLite로 잘못 배포하지 않도록 시작을 중단**합니다.
`APP_ORIGIN`이 HTTPS가 아니면 운영 모드에서 서버가 시작되지 않습니다.

Supabase Session Pooler를 사용한다면 프로젝트별 정확한 호스트, 포트, 사용자명(`postgres.<프로젝트ref>`)을
사용하세요. 비밀번호에 특수문자가 있으면 URI 형식에 맞게 인코딩해야 합니다.
**전체 연결 문자열을 GitHub에 올리거나 채팅에 공유하지 마세요.**

서버 시작 시 `server/schema.postgres.sql`을 실행하여 기존 `users`, `sessions`,
`auth_attempts`, `user_courses`를 유지하고, `user_courses`에 `current_year`, `revision`
열만 필요한 경우 추가합니다. **기존 외부 DB의 `courses_json` 및 회원 정보는 삭제하지 않습니다.**
다만 운영 데이터베이스의 스키마를 변경하기 전에 **Supabase 백업**을 확보하세요.

기존 external-base의 `/api/courses`도 호환성을 위해 남겨두었습니다.
새 화면은 `/api/academic`을 통해 과목·학년·revision을 조회/저장합니다.
새 UI에서 저장하면 기존 DB의 `user_courses` 행을 업데이트합니다.

## API 간단 정리

| 메서드 | 경로 | 동작 |
| --- | --- | --- |
| POST | `/api/auth/signup` | 회원가입 |
| POST | `/api/auth/login` | 로그인 |
| GET | `/api/auth/me` | 현재 사용자 |
| POST | `/api/auth/logout` | 로그아웃 |
| GET | `/api/academic` | `{courses,profile:{grade},revision}` 조회 |
| PUT | `/api/academic` | 과목·학년 저장 (버전 일치 필요) |
| GET, PUT | `/api/courses` | 기존 external-base용 호환 API |

`/api/academic`은 로그인 쿠키 및 `X-Account-Id`가 필요하고,
모든 변경 요청은 `APP_ORIGIN`과 일치하는 Origin 헤더가 필요합니다.
학점 입력은 최신 main(2) UI 규칙인 **1~12 정수**, 학기는
`YYYY-1`, `YYYY-2`, `YYYY-여름`, `YYYY-겨울`를 사용합니다.

## 검증과 주의사항

`npm test`는 로컬 SQLite DB로 회원가입·세션·과목 추가/수정/삭제·로그인 계정 분리·
학년 저장·계절학기·재시작 후 보존·기존 SQLite 스키마 업그레이드·정적 파일 제공 등을 검사합니다.
**실제 Supabase에 연결해 실행하는 검증은 별도 DB 접속 정보가 없어 수행하지 못했습니다.**

통합 ZIP을 바로 운영 `main`에 올리기보다는 별도 브랜치와 테스트용 Render 서비스에서 확인하고,
문제가 없을 때 Pull Request로 `main`에 병합하기를 권장합니다. 테스트 환경에서는 가능하면
별도 Supabase 프로젝트를 사용하세요. 실제 운영 DB에 테스트 과목을 넣으면 그대로 저장됩니다.
