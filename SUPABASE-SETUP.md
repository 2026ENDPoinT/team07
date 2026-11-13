# Render 무료 플랜 + Supabase 배포

현재 대시보드·졸업 학점·성적 분석과 `/api/academic`을 유지하면서 ZIP의 PostgreSQL 연결을 병합했습니다. 유료 Render 디스크나 Render PostgreSQL은 필요하지 않습니다.

## 저장 방식

| 환경 | 계정·세션·로그인 제한 | 과목·학년·버전 |
| --- | --- | --- |
| `DATABASE_URL` 없음: 로컬 | 기존 `storage/team07.db` | 기존 `storage/users/<난수>.db` |
| `DATABASE_URL` 있음: 배포 | Supabase `app_private` 스키마 | `app_private.academic_state`의 사용자별 행 |

배포에서는 검증된 세션의 `user_id`로 데이터를 분리합니다. 파일 분리와 구현은 다르지만 다른 계정 지정·조회·저장을 동일하게 차단합니다. 학년과 `revision`도 서버에 저장하며 최초 과목은 빈 목록, 학년은 1입니다.

Supabase 데이터는 Render 재시작·재배포 후에도 유지됩니다. 각 무료 플랜의 휴면·할당량 정책은 제공자의 최신 안내를 확인하세요. Render 내부 SQLite에 영구 보존을 의존하지 않습니다. Render에서 `DATABASE_URL`이 없거나 연결에 실패하면 시작을 중단합니다.

## 1. Supabase

1. Supabase Free 프로젝트를 생성합니다.
2. Dashboard → **Connect → Session pooler**에서 PostgreSQL URI를 복사합니다. 주소·포트·사용자명을 직접 추측하지 마세요. 비밀번호를 URI에 직접 넣으면 예약 문자를 URL 인코딩합니다.
3. URI는 Render 서버만 보관합니다. 브라우저 Supabase SDK나 anon/service role 키는 필요하지 않습니다. 로그인은 기존 Node 쿠키 세션입니다.
4. 서버 최초 연결 시 `server/schema.postgres.sql`을 실행하므로 새 프로젝트에서 스키마·테이블을 생성할 수 있는 DB 소유자 연결을 사용합니다. 기존 `public` 테이블은 수정하지 않습니다.
5. `app_private`는 **Exposed schemas**에 추가하지 마세요. Supabase Data API를 쓰지 않는다면 비활성화해도 됩니다. 서버의 PostgreSQL 연결에는 영향이 없습니다.

스키마는 공개 역할의 권한을 회수하고 RLS를 활성화합니다. 서버의 DB 소유자는 RLS를 우회할 수 있으므로 세션 검증과 학사 쿼리의 `user_id` 조건도 계속 유지합니다. 별도 최소 권한 역할을 사용하려면 초기 생성과 역할·RLS 정책을 먼저 구성해야 합니다.

쿼리는 `app_private`를 명시하므로 연결 풀의 기본 `search_path`에 의존하지 않습니다. Session pooler 연결이 완료된 뒤 서버가 제한 시간을 설정합니다. Transaction pooler 대신 위의 Session pooler를 사용하세요.

## 2. Render

현재 소스·`package-lock.json`·`render.yaml`을 GitHub에 올립니다. `.env`, DB, 개인 키, `node_modules/`, `.zip-reference/`는 제외합니다.

Blueprint에서 저장소의 `render.yaml`을 선택하면 Free 플랜과 아래 실행 설정이 적용됩니다. `APP_ORIGIN`과 `DATABASE_URL`만 비밀 환경변수로 입력합니다. 유료 리소스나 디스크를 추가하지 않습니다.

Web Service로 직접 생성할 때는 다음 값을 사용하세요.

| 설정 | 값 |
| --- | --- |
| Runtime / Instance Type | Node / Free |
| Root Directory | `package.json`이 있는 폴더. 저장소 최상위라면 비워 둠 |
| Build / Start | `npm ci --omit=dev` / `npm start` |
| Health Check Path | `/healthz` |
| Disk | 없음 |

| 환경변수 | 값 |
| --- | --- |
| `NODE_ENV` | `production` |
| `HOST` | `0.0.0.0` |
| `APP_ORIGIN` | 실제 HTTPS 주소. 예: `https://endpoint-team07.onrender.com` |
| `DATABASE_URL` | Supabase Session pooler URI |
| `DATABASE_SSL` | `verify-full` |

`PORT`는 Render 제공 값을 사용합니다. Node는 `package.json`의 범위에 맞는 최신 24.x 패치를 사용하세요. 실제 서비스 URL이 정해진 뒤 `APP_ORIGIN`을 맞추고 재배포합니다. 커스텀 도메인을 사용할 때도 출처가 정확히 일치해야 합니다. `/healthz`는 로그인 없이 DB 연결 상태만 반환합니다.

## 3. PostgreSQL TLS

기본값은 TLS와 서버 인증서 검증입니다. URL에 `sslmode=require`가 있어도 인증서 검증을 끄지 않습니다. 시스템이 Supabase 인증서를 신뢰하지 않아 실패하면:

1. Supabase Database 설정에서 서버 루트 CA 인증서를 다운로드합니다.
2. Render **Secret Files**에 `supabase-ca.crt`로 추가합니다.
3. `DATABASE_SSL_CA_FILE=/etc/secrets/supabase-ca.crt`를 설정하고 재배포합니다.

대안은 실제 줄바꿈이 있는 PEM 전체를 `DATABASE_SSL_CA` 환경변수로 설정하는 것입니다. `rejectUnauthorized: false`나 `sslmode=no-verify`로 우회하지 않습니다. `DATABASE_SSL=disable`은 비운영 모드의 localhost/127.0.0.1/::1 개발 DB에서만 허용합니다.

## 4. 로컬 및 배포 검증

```powershell
npm.cmd ci
npm.cmd test
npm.cmd start
```

기존 로컬 SQLite를 쓰려면 `.env`와 셸에 `DATABASE_URL`을 설정하지 않습니다. 테스트는 운영 DB를 사용하지 않고 임시 SQLite 및 로컬 PostgreSQL 테스트 엔진만 사용합니다. ZIP 비교 폴더의 과거 테스트는 실행 대상에서 제외했습니다.

배포 후 A/B 계정의 과목·학년 분리, 로그아웃 후 접근 거부, 새로고침 후 유지, 같은 버전 동시 저장 시 한 요청의 409 응답, 재배포 후 유지 여부를 확인하세요. 기본 인증 제한은 전달 IP 헤더를 신뢰하지 않아 Render 프록시 뒤의 여러 사용자가 IP 제한을 공유할 수 있습니다. 임의의 `X-Forwarded-For`를 그대로 신뢰하지 마세요.

## 기존 데이터

로컬 DB·원본 ZIP·비교용 ZIP 폴더는 변경하거나 삭제하지 않습니다. 로컬 SQLite나 ZIP의 `public.user_courses`를 새 스키마에 자동 이전하지 않습니다. 새 계정으로 시작할 수 있으며 기존 데이터를 사용하려면 별도 이전이 필요합니다.

참고: [Render Blueprint](https://render.com/docs/blueprint-spec), [Render Free](https://render.com/docs/free), [Supabase 연결](https://supabase.com/docs/guides/database/connecting-to-postgres), [Supabase API 보안](https://supabase.com/docs/guides/api/securing-your-api), [node-postgres TLS](https://node-postgres.com/features/ssl).
