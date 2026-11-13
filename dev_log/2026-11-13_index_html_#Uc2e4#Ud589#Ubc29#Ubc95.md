# index.html 실행 방법

갱신일: 2026년 11월 13일 (한국 시간)

`public/index.html`의 CSS·JavaScript·학사 JSON과 인증 서버 연결을 완료했다. Node 서버 하나로 로그인·회원가입과 학업 대시보드를 실행할 수 있다.

## 1. 서버 실행

Node.js **24.12.0 이상**이 필요하다. 외부 npm 패키지 의존성이 없으므로 별도 `npm install`은 필요하지 않다.

```powershell
Set-Location -LiteralPath 'D:\programming_folder\2026 ENDPoinT'
npm.cmd start
```

브라우저에서 [ENDPoinT](http://localhost:3000/)에 접속한다.

1. 로그인하지 않았다면 로그인 화면으로 이동한다.
2. 회원가입 또는 로그인에 성공하면 `/index.html`로 이동한다.
3. 로그인 중에 `/` 또는 `/login.html`을 열어도 대시보드로 이동한다.
4. 대시보드의 로그아웃 버튼은 서버 세션을 종료한 뒤 로그인 화면으로 돌아간다.

회원가입 비밀번호는 15~128자다. 첫 실행 시 `storage/team07.db`가 없으면 생성하고, 기존 DB가 있으면 그대로 사용한다. 종료는 실행 터미널에서 `Ctrl+C`를 누른다.

파일을 직접 더블클릭하거나 Live Server로 열면 인증 API가 실행되지 않는다. 반드시 Node 서버의 HTTP 주소로 접속한다.

개발 중 서버 코드 변경을 자동 반영하려면 다음을 사용한다. 화면 수정 후에는 브라우저를 새로고침한다.

```powershell
npm.cmd run dev
```

## 2. 연결된 파일

서버는 필요한 파일만 명시적으로 공개한다. 프로젝트 전체를 정적 웹 루트로 제공하지 않는다.

| 요청 경로 | 실제 파일 |
| --- | --- |
| `/index.html` | `public/index.html` |
| `/css/dashboard.css` | `public/css/dashboard.css` |
| `/js/dashboard.js` | `public/dashboard.js` |
| `/js/auth/api.js`, `/js/auth/login.js` | `public/js/auth/`의 해당 파일 |
| `/js/credits/current.js`, `earned.js`, `completion.js` | `js/credits/`의 해당 파일 |
| `/js/grades/grades.js`, `gpa.js` | `js/grades/`의 해당 파일 |
| `/js/graph/index.js`, `dashboard.js`, `gradeGraph.js`, `gradeRanges.js` | `js/graph/`의 해당 파일 |
| `/data/academic_requirements.json` | `data/academic_requirements.json` |
| `/data/user_info.json` | `data/user_info.json` |
| `/data/courses.json` | `data/courses.json` |
| `/data/grading_policy.json` | `data/grading_policy.json` |

로그인 화면과 `/css/auth.css`도 계속 제공한다. 브라우저에서 `public`을 URL에 붙이지 않는다. `/public/index.html`은 공개 경로가 아니다. 서버 소스, DB, `.env`, 테스트 파일 등은 공개하지 않는다.

## 3. 화면에서 확인할 수 있는 내용

- 누적 GPA, 취득 학점, 현재 수강 학점, 학년 수료까지 남은 학점
- 과목·성적·학기·이수 상태 목록
- 전체·전공·교양별 학기 성적 그래프
- 수강자 수와 A+~D0의 개별 비율(%)을 입력하는 상대평가 예상 인원 표

기존 `team07.courses` 브라우저 저장소에 비어 있지 않은 과목 배열이 있으면 사용한다. 과목이 없으면 `data/courses.json`의 예시 과목을 표시하며, 예시 데이터를 저장소에 덮어쓰지 않는다. 기본 예시 결과는 **GPA 3.00 / 취득 12학점 / 수강 중 2학점 / 수료까지 21학점**이다.

상단 사용자 이름은 인증 API의 로그인 계정 이름이다. **학과·학년·수료 기준·평가 기준은 예시 JSON**이며 로그인 계정의 실제 학적 정보가 아니다. 화면에도 데이터 출처를 표시한다. 과목 저장소는 브라우저 공용이며 계정별 분리나 서버 동기화는 구현하지 않았다. 이번 연결 작업에 과목 등록·수정 UI 또는 계정별 학사 저장 API를 추가하지는 않았다.

평가 비율은 현재 JSON과 그래프 모듈 모두 `15 = 15%` 형태의 개별 비율을 사용한다. 8개 등급 입력란을 연결해 초기 인원 계산과 입력 변경이 동작하도록 수정했다.

## 4. 문제 해결

- `node` 또는 `npm`을 찾을 수 없음: Node.js 설치 및 PATH를 확인하고 PowerShell을 새로 연다.
- PowerShell의 `npm.ps1` 실행 정책 오류: `npm.cmd start`를 사용한다.
- `EADDRINUSE`: 실행 중인 기존 서버를 확인하거나 다음처럼 포트와 출처를 함께 바꾼다.

```powershell
$env:PORT = '3001'
$env:APP_ORIGIN = 'http://localhost:3001'
npm.cmd start
```

이 경우 [3001번 포트](http://localhost:3001/)로 접속한다. `APP_ORIGIN`의 프로토콜·호스트·포트는 실제 브라우저 주소와 일치해야 한다. 기본 설정에는 `.env` 파일이 필요하지 않다.

## 5. 검증 결과

- `npm.cmd test`: **22개 테스트 통과**.
- 대시보드 HTML의 CSS·JS 참조 및 재귀적인 ES 모듈 import를 실제 HTTP로 요청해 200 응답과 MIME 형식을 확인했다.
- 학사 JSON 4개, GET·HEAD, 로그인 상태에 따른 기본 주소 이동, 비공개 파일 접근 차단을 확인했다.
- 별도 메모리 DB와 3107번 테스트 서버에서 브라우저 로그인 → 대시보드 표시 → 새로고침 → 로그아웃 → 미로그인 대시보드 재접근 시 로그인 이동을 확인했다.
- 브라우저에서 요약 숫자, 예시 과목 6개, 성적 그래프, 8개 등급 인원 표를 확인했다. 전공 필터 및 수강자 수 40명 → 20명 변경도 반영됐다. 확인 시 브라우저 콘솔 오류·경고는 없었다.
- 검증 서버는 종료했으며 기존 `storage/team07.db`는 검증에 사용하지 않았다. 실제 사용하려면 위의 `npm.cmd start`로 실행한다.
