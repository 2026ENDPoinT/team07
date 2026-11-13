# Team07 로그인 모듈

인증 서버와 로그인 화면을 구현했으며, 현재는 학업 대시보드의 CSS·JS·학사 예시 JSON도 같은 서버에서 제공합니다. 대시보드 연결 및 예시 데이터 범위는 [index.html 실행 안내](dev_log/2026-11-13_index_html_실행방법.md)를 참고하세요.

## 실행

Node.js 24.12 이상의 24.x 최신 패치를 설치한 뒤 프로젝트 폴더에서 `npm ci`로 의존성을 설치합니다. 로컬은 Node 내장 HTTP 서버와 SQLite를 사용하고, `DATABASE_URL`이 있으면 `pg`를 통해 PostgreSQL을 사용합니다. Render 무료 플랜·Supabase 설정은 [배포 안내](SUPABASE-SETUP.md)를 참고하세요.

```powershell
npm start
```

브라우저에서 http://localhost:3000/login.html 에 접속합니다. Live Server나 HTML 파일 직접 열기는 사용하지 마세요. Node 서버가 화면과 API를 함께 제공합니다.

회원가입 버튼으로 계정을 생성하면 자동 로그인됩니다. 회원가입·로그인 성공 시 `/index.html` 대시보드로 이동합니다. 로그인 중에 `/login.html`을 열어도 대시보드로 이동합니다. 기본 주소 `/`는 미로그인 시 로그인 화면, 로그인 시 대시보드로 연결됩니다. 로그인 상태는 최대 24시간 유지되며, 서버 재시작 후에도 유효한 세션이 유지됩니다. 계정과 세션 DB는 첫 실행 시 `storage/team07.db`에 자동 생성됩니다. 각 사용자의 과목·학년 DB는 학사 데이터 최초 조회 시 `storage/users/<64자리 난수>.db`에 생성됩니다. `DB_PATH`를 변경하면 해당 인증 DB와 같은 폴더의 `users/`를 사용합니다. `:memory:` 설정에서는 사용자 DB도 메모리에서 분리하며 디스크에 기록하지 않습니다.

## 파일

위의 DB 파일 경로 설명은 `DATABASE_URL`이 없는 로컬 SQLite 모드에 해당합니다. Supabase 모드에서는 인증·과목·학년·저장 버전을 모두 PostgreSQL의 비공개 `app_private` 스키마에 저장하며, 개인 데이터는 세션의 사용자 ID로 분리합니다. 로컬 DB와 Supabase 사이의 자동 이전은 수행하지 않습니다.

- `public/login.html`: 로그인·회원가입·로그인 상태 표시 화면
- `public/css/auth.css`: 로그인 전용 스타일
- `public/js/auth/login.js`: 폼 처리
- `public/js/auth/api.js`: 다른 페이지에서도 재사용할 인증 API 함수
- `server/app.js`: Node HTTP 서버, 인증 API, 세션·출처 검사
- `server/password.js`: scrypt 비밀번호 해시 및 검증
- `server/db.js`, `server/schema.sql`: SQLite DB 및 테이블 생성
- `server/postgres.js`, `server/schema.postgres.sql`: TLS PostgreSQL 연결 및 비공개 스키마 생성
- `server/academic.js`: 사용자별 DB 선택, 학사 데이터 검증 및 버전 검사
- `public/js/academic-api.js`: 로그인 계정에 연결된 학사 API 호출
- `test/auth.test.js`: 인증 통합 테스트
- `test/course-persistence.test.js`: ZIP의 과목 저장 시나리오를 현재 학사 API로 통합한 회귀 테스트. 화면용 과목 함수로 추가·수정·전체 삭제하고 계정 분리, 저장 실패 후 기존 데이터 보존, 재로그인 후 빈 목록 유지를 검사합니다.

## API

| 메서드 | 주소 | 본문 / 응답 |
| --- | --- | --- |
| POST | `/api/auth/signup` | `{ name, email, password }` → `{ user }`, 자동 로그인 |
| POST | `/api/auth/login` | `{ email, password }` → `{ user }` |
| GET | `/api/auth/me` | `{ user: { id, email, name } }`; 미로그인 401 |
| POST | `/api/auth/logout` | `{}` → `{ message }`, 서버 세션 폐기 |
| GET | `/api/academic` | `{ courses, profile: { grade }, revision }` |
| PUT | `/api/academic` | `{ courses, profile: { grade }, revision }` → 저장된 전체 데이터와 증가한 버전 |
| GET | `/api/calendar` | `{ events, revision }` |
| PUT | `/api/calendar` | `{ events, revision }` → 저장된 일정 목록과 증가한 버전 |

이름은 공백 제거 후 1~50자, 비밀번호는 15~128자입니다. 이메일은 앞뒤 공백 제거 및 소문자 변환 후 저장합니다. 오류 응답은 `{ message }`입니다. POST 요청은 `APP_ORIGIN`과 동일한 Origin 헤더가 필요합니다. 브라우저의 같은 출처 fetch에서는 자동 전송됩니다.

학사 API는 유효한 로그인 세션과 `X-Account-Id: <현재 사용자 id>` 헤더가 필요합니다. 화면에서는 `createAcademicClient(user.id)`를 사용하세요. 이 헤더는 다른 탭에서 계정이 바뀌었는지 검사하는 용도이며, DB 선택에는 세션의 사용자 ID만 사용합니다. 누락·불일치는 403, 미로그인은 401입니다. PUT에는 같은 출처의 Origin과 JSON이 필요하며, 최신 조회 결과의 `revision`을 보내야 합니다. 다른 화면에서 먼저 수정했으면 409로 거부합니다. 저장 실패 시 화면의 기존 데이터는 유지합니다.

과목은 최대 500개, 이름은 공백 제거 후 1~100자, 학점은 0.5~30의 0.5 단위, 학기는 `YYYY-1` 또는 `YYYY-2`, 학년은 1~4입니다. 서버는 자료형·중복 과목 ID·등급·이수 구분·수강 상태를 검사하고 평점을 등급으로 다시 계산합니다. 사용자 ID·DB 경로 등 정의되지 않은 필드나 쿼리 매개변수는 거부합니다. 학사 요청 본문은 최대 256 KiB, 인증 요청은 8 KiB입니다.

일정 API도 같은 세션·`X-Account-Id`·출처 검사와 버전 비교를 적용합니다. 화면에서는 `createCalendarClient(user.id)`를 사용합니다. 일정은 최대 1,000개이며 각 항목은 `{ id, title, date, time, endDate, endTime, notes }`입니다. `date`와 `time`은 시작 시점, `endDate`와 `endTime`은 종료 시점입니다. `id`는 영문·숫자·`_`·`-` 1~80자(중복 불가), 제목은 공백 제거 후 1~100자, 날짜는 실제 존재하는 `0001-01-01`~`9999-12-31`, 시간은 `HH:mm` 또는 빈 문자열, 메모는 최대 2,000자입니다. 종료 시점은 시작 시점 이상이어야 하며, 시간은 양쪽 모두 입력하거나 비워야 합니다. 같은 날짜에 시간이 없으면 종일, 여러 날짜에 시간이 없으면 종료일까지 종일 일정입니다. 시간이 지정된 기간의 종료가 자정(00:00)이면 종료일에는 표시하지 않습니다. 기존 `endDate`·`endTime`이 모두 없는 항목은 시작과 종료가 같은 단일 시점 일정으로 호환하며, 수정 시 종료 필드를 함께 저장합니다. 날짜·시간은 시간대 변환 없이 입력한 달력 기준으로 저장합니다. 일정 요청 본문은 최대 8 MiB입니다. 기존 사용자별 SQLite 파일에 `calendar_state`를 자동 생성하며, Supabase에서는 비공개 `app_private.calendar_state`를 사용합니다. 학사 데이터와 저장 버전을 공유하지 않습니다. `test/calendar.test.js`와 PostgreSQL 통합 테스트가 사용자별 저장·수정·삭제·재시작·충돌·접근 차단·기간 표시를 검증합니다.

기존 인증 DB는 새 매핑 테이블을 추가해 호환하며 계정·세션을 유지합니다. 개인 DB는 빈 목록·1학년으로 시작합니다. 소유자가 없는 브라우저 공용 `team07.courses`와 기존 학년 저장값은 자동으로 가져오거나 삭제하지 않습니다. 예시 JSON을 개인 과목으로 자동 등록하지 않습니다. 대시보드와 성적 분석은 모두 개인 API만 사용합니다.

개인 데이터 API를 추가할 때는 `await currentUser(req)`로 로그인 사용자를 확인하고 전용 저장소를 사용하세요. 클라이언트의 사용자 ID나 파일명으로 저장소를 선택하면 안 됩니다. 화면의 로그인 여부 확인만으로 데이터 접근을 보호할 수는 없습니다. 현재 서버는 필요한 파일 경로만 명시적으로 공개하므로 새 페이지를 추가할 때 `staticFiles`에도 등록해야 합니다. 공개된 학사 JSON은 예시 데이터이며 실제 계정의 학적·과목 데이터가 아닙니다.

## 설정

기본값으로 바로 실행할 수 있습니다. 설정 변경 시 `.env.example`을 `.env`로 복사하고 수정합니다. 포트나 접속 도메인을 바꾸면 `APP_ORIGIN`도 실제 브라우저 주소와 일치시켜야 합니다. 기본 서버는 로컬 주소에만 바인딩합니다. 팀 내부 네트워크 접근이 필요하면 HOST를 조정하세요.

운영 환경은 `NODE_ENV=production`, `APP_ORIGIN=https://실제도메인`과 HTTPS 역방향 프록시가 필요합니다. 운영 모드에서는 Secure 쿠키를 사용합니다. 기본 코드는 전달된 IP 헤더를 신뢰하지 않아 프록시의 모든 사용자가 요청 제한을 공유할 수 있습니다. 운영 프록시에서 사용자별 요청 제한을 적용하거나, 실제 프록시 구성에 맞게 신뢰할 IP 전달 방식을 별도로 구현하세요.

## 보안 및 범위

비밀번호는 개별 salt와 scrypt(N=16384, r=8, p=5)로 해시합니다. 세션 식별자는 무작위로 발급하고 DB에는 식별자의 SHA-256 해시만 저장합니다. 쿠키는 HttpOnly·SameSite=Lax를 적용하며 운영 환경에서는 Secure 및 `__Host-` 접두사를 적용해 하위 도메인의 쿠키 덮어쓰기를 제한합니다. 중복된 세션 쿠키는 거부합니다. 로그인 시 현재 세션은 교체되고 로그아웃 시 폐기됩니다. 응답은 캐시하지 않습니다. SQL은 파라미터를 바인딩합니다. 화면은 사용자 입력을 `textContent`로 표시하며, CSP로 인라인 스크립트와 외부 스크립트를 제한합니다.

로그인·회원가입은 IP당 합산 15분에 30회로 제한합니다. 로그인에는 이메일별 15분에 10회의 추가 제한을 적용합니다. 계정 존재 여부와 무관하게 동일하게 적용하며 로그인 성공 시 해당 이메일의 제한은 초기화합니다. 제한 정보는 식별자를 해시하여 `auth_attempts` 테이블에 저장하므로 서버 재시작 후에도 유지됩니다. 제한은 일시적으로 다른 사람의 로그인도 지연시킬 수 있으며 최대 15분 후 해제됩니다. 비밀번호 해시 작업은 동시에 최대 2개만 수행합니다. 요청 본문은 8 KiB로 제한합니다. 여러 서버로 확장할 때는 공유 요청 제한 저장소 및 공유 DB 구성을 별도로 마련해야 합니다.

이메일 소유권 인증, 비밀번호 재설정, 학교 포털 연동은 포함하지 않습니다. 가입 이메일이 실제 본인 소유임을 확인하는 기능은 없으므로 인증된 학교 계정으로 취급하면 안 됩니다. 회원가입의 중복 응답으로 이메일의 가입 여부를 추측할 수 있습니다. 이를 숨겨야 하는 공개 서비스에서는 이메일 확인 절차와 동일한 가입 응답을 함께 설계해야 합니다. DB 및 `.env`는 공개 폴더나 Git에 넣지 마세요. DB 백업도 개인 정보와 비밀번호 해시를 포함하므로 접근 권한을 제한해야 합니다. Node 내장 SQLite는 실행 시 experimental 경고를 출력할 수 있습니다.

## 검증

```powershell
npm test
```

테스트는 임시 DB로 실행하며 회원가입, 중복 방지, 잘못된 비밀번호, 세션 교체, 계정 분리, 재시작 후 유지, 만료, 로그아웃, 출처 검사, IP·계정 요청 제한 및 재시작 후 유지, 비공개 파일 접근 차단, 운영 쿠키 설정, 잘못된 JSON·자료형·과도한 본문, SQL 입력 처리, 중복 쿠키 및 비밀번호 해시 검증을 검사합니다. 학사 데이터는 기존 스키마 갱신, 실제 파일 분리, 과목·학년 저장 및 빈 목록 유지, 다른 사용자 지정 차단, 중복·동시 저장 충돌, 업로드 중 세션 폐기, 계정 ID 재사용 시 과거 DB 재사용 방지도 검사합니다. 화면은 `/login.html`에서 직접 확인할 수 있습니다.

`test/postgres.test.js`는 테스트 전용 PGlite PostgreSQL 엔진으로 동일한 HTTP 경로의 계정·학사 저장·재시작·버전 충돌·요청 제한·업로드 중 세션 폐기와 공개 역할 접근 차단을 검사합니다. TLS 검증 설정과 Render의 DB 누락 차단도 검사합니다. 실제 Supabase 계정이나 네트워크 TLS 연결을 사용하는 테스트는 아닙니다.

인증 DB는 로컬 파일을 보존하면서 Git 추적에서 제외했으며 `storage/`는 `.gitignore`로 보호합니다. 과거 커밋에 포함된 DB는 기존 Git 이력에 남습니다. 그 파일에 실사용자 정보가 있다면 별도의 이력 정리가 필요합니다.

개인 DB의 파일명 매핑은 인증 DB의 `user_databases` 테이블에만 보관하며 API에 공개하지 않습니다. 파일 내부의 키도 검사해 다른 사용자의 DB 파일로 잘못 교체되면 요청을 거부합니다. 개인 DB는 요청마다 닫아 사용자 수만큼 열린 파일이 누적되지 않게 합니다. DB 파일을 분리해도 서버 프로세스는 모든 파일에 접근할 수 있으므로 운영에서는 저장소와 백업에 서버 실행 계정만 접근하도록 Windows ACL 또는 OS 권한을 설정해야 합니다. 파일 분리는 저장 데이터 암호화를 제공하지 않습니다.

백업·복원은 인증 DB와 `users/` 전체를 함께 보관해야 합니다. 서버를 중지한 상태에서 복사하거나 SQLite의 일관된 백업 절차를 사용하세요. 인증 DB의 WAL 파일도 고려해야 합니다. 계정을 DB에서 직접 삭제하면 파일 매핑은 삭제되지만 개인 DB 파일은 복구 가능성을 위해 자동 삭제하지 않습니다. 잔여 파일을 정리할 때는 별도 운영 절차가 필요합니다.

보안 설계 참고: [OWASP Password Storage](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html), [OWASP Authentication](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html), [OWASP Multi-Tenant Security](https://cheatsheetseries.owasp.org/cheatsheets/Multi_Tenant_Security_Cheat_Sheet.html). 보안 설정과 테스트는 알려진 위험을 줄이기 위한 것으로 모든 취약점의 부재를 보장하지 않습니다.
