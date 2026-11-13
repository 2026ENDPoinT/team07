import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

// 저장 폴더와 SQLite DB를 준비하고, 없는 테이블은 schema.sql로 생성합니다.
export function openDatabase(filename = resolve('storage/team07.db')) {
  if (filename !== ':memory:') mkdirSync(dirname(resolve(filename)), { recursive: true });
  const db = new DatabaseSync(filename);
  // DB 잠금은 최대 5초 대기하고, WAL 모드로 읽기와 쓰기의 경합을 줄입니다.
  db.exec('PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL;');
  db.exec(readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));
  return db;
}
