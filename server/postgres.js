import { readFileSync } from 'node:fs';
import { configurationError, failureDetails } from './diagnostics.js';

// URL의 sslmode가 pg의 ssl 객체를 덮어쓰지 않게 접속 필드만 명시적으로 읽습니다.
export function postgresConfig({ databaseUrl, production = false,
  sslMode = 'verify-full', sslCaFile, sslCa } = {}) {
  let url;
  try { url = new URL(databaseUrl); }
  catch { throw configurationError('DATABASE_URL_INVALID', 'DATABASE_URL must be a valid PostgreSQL URL.'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname || !url.username || url.pathname.length < 2) {
    throw configurationError('DATABASE_URL_INVALID', 'DATABASE_URL must include a PostgreSQL host, user and database.');
  }
  if (!['verify-full', 'disable'].includes(sslMode)) throw configurationError('DATABASE_SSL_INVALID', 'DATABASE_SSL must be verify-full or disable.');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (sslMode === 'disable' && (production || !['localhost', '127.0.0.1', '::1'].includes(host))) {
    throw configurationError('DATABASE_SSL_LOCAL_ONLY', 'Unencrypted PostgreSQL is allowed only for local development on loopback.');
  }
  if (url.searchParams.has('sslmode') && !['require', 'verify-ca', 'verify-full'].includes(url.searchParams.get('sslmode'))) {
    throw configurationError('DATABASE_URL_TLS_INVALID', 'DATABASE_URL must not disable TLS certificate verification.');
  }
  let ca = sslCa;
  if (sslCaFile) {
    try { ca = readFileSync(sslCaFile, 'utf8'); }
    catch { throw configurationError('DATABASE_SSL_CA_UNREADABLE', 'Could not read DATABASE_SSL_CA_FILE.'); }
  }
  return {
    host, port: Number(url.port || 5432), user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password), database: decodeURIComponent(url.pathname.slice(1)),
    ssl: sslMode === 'disable' ? false : { rejectUnauthorized: true, ...(ca ? { ca } : {}) },
    // Supavisor가 시작 options를 무시할 수 있어 연결 완료 후 SET을 기다립니다.
    onConnect: client => client.query("SET search_path TO pg_catalog; SET statement_timeout = '10s'; SET lock_timeout = '5s'"),
    max: 5, connectionTimeoutMillis: 10000, idleTimeoutMillis: 30000,
    application_name: 'endpoint-team07'
  };
}

// 연결 초기화 실패 시 SQLite로 전환하지 않고 시작을 중단합니다.
export async function createPostgresDatabase(pool) {
  try {
    await pool.query(readFileSync(new URL('./schema.postgres.sql', import.meta.url), 'utf8'));
    return {
      type: 'postgres',
      query: (sql, params = []) => pool.query(sql, params),
      close: () => pool.end()
    };
  } catch (error) {
    await pool.end();
    throw error;
  }
}

export async function openPostgresDatabase(options) {
  const config = postgresConfig(options);
  const { Pool } = await import('pg');
  const pool = new Pool(config);
  // 접속 주소와 자격 증명을 로그에 남기지 않고 유휴 연결 오류를 처리합니다.
  pool.on('error', error => console.error('PostgreSQL idle connection failed.', failureDetails(error)));
  return createPostgresDatabase(pool);
}
