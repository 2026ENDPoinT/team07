import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { mkdtempSync, existsSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request as httpRequest } from 'node:http';
import { createApp } from '../server/app.js';
import { openDatabase } from '../server/db.js';
import { postgresConfig, createPostgresDatabase } from '../server/postgres.js';
import { launch } from './http-helper.js';

const origin = 'http://localhost:3000';
const password = 'test-only-password-2026';
const course = { id: 'test-course', courseName: '자료구조', credits: 3, grade: 'A+', gradePoint: 99,
  semester: '2026-1', category: 'major', status: 'completed', isRetake: false };
const cookieOf = response => response.headers.get('set-cookie').split(';')[0];
const academic = (service, cookie, id, state, options = {}) => service.request('/api/academic', state, cookie, origin,
  { method: state === undefined ? 'GET' : 'PUT', ...options,
    headers: { 'X-Account-Id': String(id), ...options.headers } });

// 네트워크나 실제 계정 없이 PostgreSQL 엔진에서 같은 SQL과 HTTP 경로를 검증합니다.
async function fixture() {
  const engine = new PGlite();
  await engine.exec(`CREATE ROLE anon; CREATE ROLE authenticated;
    CREATE TABLE public.users (id INTEGER PRIMARY KEY, marker TEXT);
    INSERT INTO public.users VALUES (99, 'existing-zip-data');
    SET search_path TO public, pg_catalog;`);
  async function connect() {
    let closed = false;
    return createPostgresDatabase({
      async query(sql, params) {
        if (closed) throw new Error('Pool closed');
        let result;
        if (params === undefined) result = (await engine.exec(sql)).at(-1) || {};
        else result = await engine.query(sql, params);
        const rows = result.rows || [];
        // node-postgres의 기본 int8 파서처럼 ID·시각·count를 문자열로 반환합니다.
        for (const field of result.fields || []) {
          if (field.dataTypeID === 20) for (const row of rows) {
            if (row[field.name] !== null) row[field.name] = String(row[field.name]);
          }
        }
        return { rows, rowCount: result.affectedRows ?? rows.length };
      },
      async end() { closed = true; }
    });
  }
  return { engine, connect, close: () => engine.close() };
}

test('PostgreSQL config enforces certificate verification and rejects remote TLS downgrade', async () => {
  const config = postgresConfig({ databaseUrl: 'postgresql://app:p%40ss%3Aword@db.example.com:6543/postgres?sslmode=require&options=unsafe', production: true });
  assert.equal(config.password, 'p@ss:word');
  assert.equal(config.port, 6543);
  assert.equal(config.ssl.rejectUnauthorized, true);
  assert.equal(config.options, undefined);
  let setup;
  await config.onConnect({ async query(sql) { setup = sql; } });
  assert.match(setup, /search_path TO pg_catalog/);
  assert.match(setup, /statement_timeout = '10s'/);
  assert.doesNotMatch(setup, /unsafe/);
  assert.equal(config.connectionString, undefined);
  assert.equal(postgresConfig({ databaseUrl: 'postgres://app:pass@localhost/db', sslMode: 'disable' }).ssl, false);
  for (const databaseUrl of ['not a URL', 'https://db.example.com/db', 'postgres://db.example.com/db',
    'postgres://app:pass@db.example.com/db?sslmode=no-verify', 'postgres://app:pass@db.example.com/db?sslmode=disable']) {
    assert.throws(() => postgresConfig({ databaseUrl }), /DATABASE_URL/);
  }
  assert.throws(() => postgresConfig({ databaseUrl: 'postgres://app:pass@db.example.com/db', sslMode: 'disable' }), /loopback/);
  assert.throws(() => postgresConfig({ databaseUrl: 'postgres://app:pass@localhost/db', sslMode: 'disable', production: true }), /loopback/);
  assert.throws(() => postgresConfig({ databaseUrl: 'postgres://app:pass@localhost/db', sslMode: 'prefer' }), /DATABASE_SSL/);
});

test('Render configuration and PostgreSQL failures never silently create a local database', async () => {
  await assert.rejects(createApp({ databaseUrl: null, requirePostgres: true, production: false }), /DATABASE_URL is required/);
  const folder = mkdtempSync(join(tmpdir(), 'team07-config-'));
  try {
    const path = join(folder, 'should-not-exist.db');
    await assert.rejects(openDatabase(path, { databaseUrl: 'not a valid URL' }), /DATABASE_URL/);
    assert.equal(existsSync(path), false);
  } finally { rmdirSync(folder); }
  let closed = false;
  await assert.rejects(createPostgresDatabase({
    async query() { throw new Error('Database initialization failed'); },
    async end() { closed = true; }
  }), /initialization failed/);
  assert.equal(closed, true);
});

test('PostgreSQL HTTP flow keeps sessions, academic isolation, revisions and private schema across restart', async () => {
  const pg = await fixture();
  let service;
  try {
    service = await launch(':memory:', { database: await pg.connect() });
    assert.equal(service.db.type, 'postgres');
    assert.equal((await service.request('/')).headers.get('location'), '/login.html');
    assert.equal((await service.request('/api/academic')).status, 401);
    const aSignup = await service.request('/api/auth/signup', { name: 'A', email: 'a@example.com', password });
    const bSignup = await service.request('/api/auth/signup', { name: 'B', email: 'b@example.com', password });
    assert.equal(aSignup.status, 201);
    assert.equal(bSignup.status, 201);
    let aCookie = cookieOf(aSignup);
    const bCookie = cookieOf(bSignup);
    const a = (await aSignup.json()).user;
    const b = (await bSignup.json()).user;
    assert.equal(typeof a.id, 'string');
    assert.notEqual(a.id, b.id);
    assert.equal((await service.request('/', undefined, aCookie)).headers.get('location'), '/index.html');
    assert.deepEqual(await (await academic(service, aCookie, a.id)).json(), { courses: [], profile: { grade: 1 }, revision: 0 });
    const state = { courses: [course], profile: { grade: 3 }, revision: 0 };
    const saved = await academic(service, aCookie, a.id, state);
    assert.equal(saved.status, 200);
    assert.deepEqual(await saved.json(), { ...state, courses: [{ ...course, gradePoint: 4.5 }], revision: 1 });
    assert.deepEqual(await (await academic(service, bCookie, b.id)).json(), { courses: [], profile: { grade: 1 }, revision: 0 });
    assert.equal((await academic(service, bCookie, a.id, state)).status, 403);
    assert.equal((await academic(service, aCookie, a.id, state, { headers: { Origin: 'https://evil.example' } })).status, 403);
    assert.equal((await academic(service, aCookie, a.id, { ...state, user_id: b.id })).status, 400);
    assert.equal((await academic(service, aCookie, a.id, { ...state, profile: { grade: 5 } })).status, 400);
    assert.equal((await academic(service, aCookie, a.id, { ...state, courses: [course, course] })).status, 400);
    assert.equal((await academic(service, aCookie, a.id, state)).status, 409);
    const updates = await Promise.all([
      academic(service, aCookie, a.id, { ...state, revision: 1, profile: { grade: 4 } }),
      academic(service, aCookie, a.id, { ...state, revision: 1, profile: { grade: 2 } })
    ]);
    assert.deepEqual(updates.map(response => response.status).sort(), [200, 409]);
    const committed = await (await academic(service, aCookie, a.id)).json();
    assert.equal(committed.revision, 2);
    const sqlText = "<img src=x onerror=alert(1)>'); DROP TABLE users;--";
    const injected = await academic(service, bCookie, b.id, { ...state, courses: [{ ...course, courseName: sqlText }] });
    assert.equal(injected.status, 200);
    assert.equal((await injected.json()).courses[0].courseName, sqlText);
    assert.equal((await academic(service, aCookie, a.id, state, { rawBody: JSON.stringify({ padding: 'x'.repeat(270000) }) })).status, 413);
    assert.equal((await service.request('/api/auth/login', { email: a.email, password: 'incorrect-long-password' })).status, 401);
    const login = await service.request('/api/auth/login', { email: a.email, password }, aCookie);
    assert.equal(login.status, 200);
    assert.equal((await service.request('/api/auth/me', undefined, aCookie)).status, 401);
    aCookie = cookieOf(login);
    assert.equal((await service.request('/healthz')).status, 200);
    assert.deepEqual(await (await service.request('/healthz')).json(), { status: 'ok' });
    const query = service.db.query;
    service.db.query = async () => { throw new Error('private database details'); };
    try {
      const unavailable = await service.request('/healthz');
      assert.equal(unavailable.status, 503);
      assert.deepEqual(await unavailable.json(), { status: 'unavailable' });
    } finally { service.db.query = query; }
    await service.close();
    service = await launch(':memory:', { database: await pg.connect() });
    assert.equal((await service.request('/api/auth/me', undefined, aCookie)).status, 200);
    assert.deepEqual(await (await academic(service, aCookie, a.id)).json(), committed);
    assert.equal((await academic(service, aCookie, a.id, { ...committed, courses: [] })).status, 200);
    assert.deepEqual((await (await academic(service, aCookie, a.id)).json()).courses, []);
    await service.request('/api/auth/logout', {}, aCookie);
    assert.equal((await academic(service, aCookie, a.id)).status, 401);
    await service.db.query('UPDATE app_private.sessions SET expires_at = 0');
    assert.equal((await academic(service, bCookie, b.id, state)).status, 401);
    assert.equal((await pg.engine.query('SELECT marker FROM public.users')).rows[0].marker, 'existing-zip-data');
    const tables = (await pg.engine.query("SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname = 'app_private'")).rows;
    assert.equal(tables.length, 4);
    assert.ok(tables.every(table => table.rowsecurity));
    for (const role of ['anon', 'authenticated']) {
      assert.equal((await pg.engine.query("SELECT has_schema_privilege($1, 'app_private', 'USAGE') AS allowed", [role])).rows[0].allowed, false);
      await pg.engine.exec(`SET ROLE ${role}`);
      try { await assert.rejects(pg.engine.query('SELECT * FROM app_private.users'), /permission denied/); }
      finally { await pg.engine.exec('RESET ROLE'); }
    }
  } finally {
    if (service) await service.close();
    await pg.close();
  }
});

test('PostgreSQL refuses a write if its session is revoked during upload', async () => {
  const pg = await fixture();
  let service;
  try {
    service = await launch(':memory:', { database: await pg.connect() });
    const signup = await service.request('/api/auth/signup', { name: 'A', email: 'a@example.com', password });
    const cookie = cookieOf(signup);
    const id = (await signup.json()).user.id;
    const body = JSON.stringify({ courses: [course], profile: { grade: 4 }, revision: 0 });
    const reading = new Promise(resolve => {
      service.app.once('request', req => {
        const iterator = req.iterator;
        req.iterator = function (options) {
          const result = iterator.call(this, options);
          resolve();
          return result;
        };
      });
    });
    let pending;
    const response = new Promise((resolve, reject) => {
      pending = httpRequest(service.base + '/api/academic', { method: 'PUT', headers: {
        Origin: origin, Cookie: cookie, 'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body), 'X-Account-Id': String(id)
      } }, res => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
      pending.on('error', reject);
    });
    pending.write(body.slice(0, 10));
    await reading;
    await service.request('/api/auth/logout', {}, cookie);
    pending.end(body.slice(10));
    assert.equal(await response, 401);
    assert.equal((await service.db.query('SELECT count(*) AS total FROM app_private.academic_state')).rows[0].total, '0');
  } finally {
    if (service) await service.close();
    await pg.close();
  }
});

test('PostgreSQL account throttles persist across restart and production cookies keep their protections', async () => {
  const pg = await fixture();
  const secureOrigin = 'https://endpoint.example.com';
  let service;
  try {
    service = await launch(':memory:', { database: await pg.connect(), accountLimit: 2, origin: secureOrigin, production: true });
    const signup = await service.request('/api/auth/signup', { name: 'A', email: 'a@example.com', password }, null, secureOrigin);
    assert.match(signup.headers.get('set-cookie'), /^__Host-team07_session=.*HttpOnly; SameSite=Lax; Secure$/);
    for (let i = 0; i < 2; i++) {
      assert.equal((await service.request('/api/auth/login', { email: 'a@example.com', password: 'incorrect-long-password' }, null, secureOrigin)).status, 401);
    }
    await service.close();
    service = await launch(':memory:', { database: await pg.connect(), accountLimit: 2, origin: secureOrigin, production: true });
    assert.equal((await service.request('/api/auth/login', { email: 'a@example.com', password }, null, secureOrigin)).status, 429);
    await service.db.query('UPDATE app_private.auth_attempts SET expires_at = 0');
    assert.equal((await service.request('/api/auth/login', { email: 'a@example.com', password }, null, secureOrigin)).status, 200);
  } finally {
    if (service) await service.close();
    await pg.close();
  }
});
