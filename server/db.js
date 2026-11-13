import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { openPostgresDatabase } from './postgres.js';

// 저장 폴더와 SQLite DB를 준비하고, 없는 테이블은 schema.sql로 생성합니다.
export async function openDatabase(filename = resolve('storage/team07.db'), options = {}) {
  if (options.databaseUrl) return openPostgresDatabase(options);
  if (filename !== ':memory:') mkdirSync(dirname(resolve(filename)), { recursive: true });
  const db = new DatabaseSync(filename);
  // DB 잠금은 최대 5초 대기하고, WAL 모드로 읽기와 쓰기의 경합을 줄입니다.
  db.exec('PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL;');
  db.exec(readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));
  db.type = 'sqlite';
  // 서버 쿼리는 PostgreSQL의 $1 형식을 사용하며, 값은 양쪽 DB에서 바인딩합니다.
  // SQL은 서버 상수만 허용합니다. 사용자 입력을 SQL 문자열에 연결하지 않습니다.
  db.query = async (sql, params = []) => {
    const ordered = [];
    const sqliteSql = sql.replace(/\$(\d+)/g, (_match, index) => {
      ordered.push(params[Number(index) - 1]);
      return '?';
    });
    const stmt = db.prepare(sqliteSql);
    if (/^\s*(SELECT|WITH)\b/i.test(sql) || /\bRETURNING\b/i.test(sql)) {
      const rows = stmt.all(...ordered);
      return { rows, rowCount: rows.length };
    }
    const result = stmt.run(...ordered);
    return { rows: [], rowCount: result.changes };
  };
  return db;
}
