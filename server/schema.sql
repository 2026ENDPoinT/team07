-- 회원과 세션의 참조 관계를 검사하고, 회원 삭제 시 연결된 세션도 삭제합니다.
PRAGMA foreign_keys = ON;
-- 회원 정보: 비밀번호 원문 대신 해시를 저장하고 이메일 중복을 방지합니다.
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
-- 로그인 유지 정보: 세션 식별자의 해시와 유효기간을 저장합니다.
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
-- 로그인 시도 제한 정보: 서버 재시작 후에도 요청 횟수와 만료 시각을 유지합니다.
CREATE TABLE IF NOT EXISTS auth_attempts (
  bucket TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS auth_attempts_expiry ON auth_attempts(expires_at);
CREATE TABLE IF NOT EXISTS user_courses (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  courses_json TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
