import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export async function openDatabase(filename = resolve('storage/team07.db')) {
  if (process.env.DATABASE_URL) {
    const { default: pg } = await import('pg');
    const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 5, connectionTimeoutMillis: 10000 });
    await pool.query(readFileSync(new URL('./schema.postgres.sql', import.meta.url), 'utf8'));
    return {
      type: 'postgres',
      async query(sql, params = []) {
        let i = 0;
        let converted = sql.replace(/\?/g, () => `$${++i}`)
          .replace(/\bmin\(auth_attempts\.count \+ 1, /g, 'LEAST(auth_attempts.count + 1, ');
        if (/INSERT INTO users\(/i.test(converted) && !/RETURNING/i.test(converted)) converted += ' RETURNING id';
        const result = await pool.query(converted, params);
        return { rows: result.rows, changes: result.rowCount, lastInsertRowid: result.rows[0]?.id };
      },
      async close() { await pool.end(); }
    };
  }
  if (filename !== ':memory:') mkdirSync(dirname(resolve(filename)), { recursive: true });
  const db = new DatabaseSync(filename);
  db.exec('PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL;');
  db.exec(readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));
  return {
    type: 'sqlite',
    prepare(sql) { return db.prepare(sql); },
    async query(sql, params = []) {
      const stmt = db.prepare(sql);
      if (/^\s*(SELECT|WITH)\b/i.test(sql) || /\bRETURNING\b/i.test(sql)) {
        const rows = stmt.all(...params);
        return { rows, changes: rows.length, lastInsertRowid: rows[0]?.id };
      }
      const result = stmt.run(...params);
      return { rows: [], changes: result.changes, lastInsertRowid: result.lastInsertRowid };
    },
    close() { db.close(); }
  };
}
