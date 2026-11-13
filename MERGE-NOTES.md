# 병합 기록

- 기준: `team07-external-base.zip` (Supabase/PostgreSQL 및 계정별 과목 저장 구현)
- 추가 반영: `team07-main.zip`의 졸업 잔여학점 화면, CSS, 계산 모듈 및 테스트
- `public/dashboard.js`에서 졸업 잔여학점 표시를 기존 Supabase 저장 로직에 접목
- SQLite는 `DATABASE_URL`이 없을 때 로컬 개발용으로 유지
- 브라우저별 학년 선택은 여전히 localStorage 사용
- 기존 데이터 자동 이관 없음
- 실제 Supabase 연결은 이 환경에서 검증하지 못함

배포: Render의 `DATABASE_URL`을 설정하고 `npm install`, `npm start` 사용. 기존 서비스의 환경 변수 및 `APP_ORIGIN` 확인.
