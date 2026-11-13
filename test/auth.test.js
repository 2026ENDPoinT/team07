import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, unlinkSync, rmdirSync, existsSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/app.js';
import { request as httpRequest } from 'node:http';
import { hashPassword, verifyPassword } from '../server/password.js';
import { launch } from './http-helper.js';

const origin = 'http://localhost:3000';
const password = 'a-long-test-password-2026';
const cookieOf = response => response.headers.get('set-cookie').split(';')[0];

const exampleCourse = (overrides = {}) => ({ id: 'course-1', courseName: '자료구조', credits: 3,
  grade: 'A+', gradePoint: 4.5, semester: '2026-1', status: 'completed', category: 'major', isRetake: false, ...overrides });
const academicRequest = (service, cookie, userId, body, options = {}) => service.request('/api/academic', body, cookie, origin,
  { method: body === undefined ? 'GET' : 'PUT', ...options, headers: { 'X-Account-Id': String(userId), ...options.headers } });

test('legacy accounts migrate; academic databases isolate users, persist across restart, and retain empty lists', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'team07-academic-'));
  const path = join(folder, 'test.db');
  let service = await launch(path);
  try {
    const first = await service.request('/api/auth/signup', { name: 'One', email: 'one@example.com', password });
    const second = await service.request('/api/auth/signup', { name: 'Two', email: 'two@example.com', password });
    const a = { cookie: cookieOf(first), id: (await first.json()).user.id };
    const b = { cookie: cookieOf(second), id: (await second.json()).user.id };
    // 이번 변경 전의 인증 스키마를 재현합니다. 재시작해도 계정과 세션은 그대로 유지됩니다.
    service.db.exec('DROP TABLE user_databases');
    await service.close();
    service = await launch(path);
    const initial = await academicRequest(service, a.cookie, a.id);
    assert.equal(initial.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await initial.json(), { courses: [], profile: { grade: 1 }, revision: 0 });
    assert.deepEqual(await (await academicRequest(service, b.cookie, b.id)).json(), await initial.json());

    const aState = { courses: [exampleCourse()], profile: { grade: 3 }, revision: 0 };
    assert.equal((await academicRequest(service, a.cookie, a.id, aState)).status, 200);
    // 같은 과목 ID라도 다른 사용자의 파일에서만 변경됩니다.
    const bState = { courses: [exampleCourse({ courseName: '사용자 2 과목', grade: 'F', gradePoint: 99 })], profile: { grade: 2 }, revision: 0 };
    const bSaved = await academicRequest(service, b.cookie, b.id, bState);
    assert.equal(bSaved.status, 200);
    assert.equal((await bSaved.json()).courses[0].gradePoint, 0);
    const mapping = service.db.prepare('SELECT * FROM user_databases ORDER BY user_id').all();
    assert.equal(mapping.length, 2);
    assert.notEqual(mapping[0].storage_key, mapping[1].storage_key);
    assert.deepEqual(readdirSync(join(folder, 'users')).sort(), mapping.map(row => `${row.storage_key}.db`).sort());
    for (const [index, name] of ['자료구조', '사용자 2 과목'].entries()) {
      const privateDb = new DatabaseSync(join(folder, 'users', `${mapping[index].storage_key}.db`), { readOnly: true });
      try {
        const row = privateDb.prepare('SELECT * FROM academic_state').get();
        assert.equal(JSON.parse(row.courses)[0].courseName, name);
        assert.equal(privateDb.prepare("SELECT name FROM sqlite_master WHERE name IN ('users', 'sessions')").all().length, 0);
      } finally { privateDb.close(); }
      assert.equal((await service.request(`/storage/users/${mapping[index].storage_key}.db`, undefined, a.cookie)).status, 404);
    }
    await service.close();
    service = await launch(path);
    assert.deepEqual(await (await academicRequest(service, a.cookie, a.id)).json(), { ...aState, revision: 1 });
    assert.equal((await (await academicRequest(service, b.cookie, b.id)).json()).profile.grade, 2);
    const edited = await academicRequest(service, a.cookie, a.id, { ...aState, revision: 1,
      courses: [exampleCourse({ grade: 'B0', gradePoint: 4.5 })] });
    assert.equal((await edited.json()).courses[0].gradePoint, 3);
    const empty = { courses: [], profile: { grade: 4 }, revision: 2 };
    assert.equal((await academicRequest(service, a.cookie, a.id, empty)).status, 200);
    await service.close();
    service = await launch(path);
    assert.deepEqual(await (await academicRequest(service, a.cookie, a.id)).json(), { ...empty, revision: 3 });
    assert.equal((await (await academicRequest(service, b.cookie, b.id)).json()).courses[0].courseName, '사용자 2 과목');
    // 계정 ID가 재사용되어도 삭제된 계정의 DB 파일에 연결되면 안 됩니다.
    service.db.prepare('DELETE FROM users WHERE id = ?').run(b.id);
    const replacement = await service.request('/api/auth/signup', { name: 'New account', email: 'new@example.com', password });
    const replacementId = (await replacement.json()).user.id;
    assert.equal(replacementId, b.id);
    assert.deepEqual(await (await academicRequest(service, cookieOf(replacement), replacementId)).json(),
      { courses: [], profile: { grade: 1 }, revision: 0 });
    assert.notEqual(service.db.prepare('SELECT storage_key FROM user_databases WHERE user_id = ?').get(replacementId).storage_key,
      mapping[1].storage_key);
  } finally {
    await service.close();
    if (existsSync(join(folder, 'users'))) {
      for (const file of readdirSync(join(folder, 'users'))) unlinkSync(join(folder, 'users', file));
      rmdirSync(join(folder, 'users'));
    }
    for (const suffix of ['', '-wal', '-shm']) if (existsSync(path + suffix)) unlinkSync(path + suffix);
    rmdirSync(folder);
  }
});

test('academic API rejects unauthenticated access, account spoofing, CSRF, stale writes and invalid input', async () => {
  const service = await launch(':memory:');
  try {
    assert.equal((await service.request('/api/academic')).status, 401);
    const signup = await service.request('/api/auth/signup', { name: 'One', email: 'one@example.com', password });
    const cookie = cookieOf(signup);
    const id = (await signup.json()).user.id;
    const second = await service.request('/api/auth/signup', { name: 'Two', email: 'two@example.com', password });
    const secondCookie = cookieOf(second);
    const state = { courses: [exampleCourse()], profile: { grade: 1 }, revision: 0 };
    assert.equal((await service.request('/api/academic', undefined, cookie)).status, 403);
    assert.equal((await academicRequest(service, cookie, id + 1)).status, 403);
    assert.equal((await academicRequest(service, secondCookie, id, state)).status, 403);
    assert.equal((await academicRequest(service, `${cookie}; ${cookie}`, id, state)).status, 401);
    assert.equal((await service.request(`/api/academic?userId=${id + 1}`, undefined, cookie, origin,
      { headers: { 'X-Account-Id': String(id) } })).status, 400);
    for (const badOrigin of ['https://evil.example', undefined]) {
      assert.equal((await academicRequest(service, cookie, id, state, { headers: { Origin: badOrigin } })).status, 403);
    }
    assert.equal((await academicRequest(service, cookie, id, state, { method: 'POST' })).status, 405);
    assert.equal((await academicRequest(service, cookie, id, state, { headers: { 'Content-Type': 'text/plain' } })).status, 415);
    assert.equal((await academicRequest(service, cookie, id, state, { rawBody: '{' })).status, 400);
    assert.equal((await academicRequest(service, cookie, id, state, { rawBody: JSON.stringify({ padding: 'x'.repeat(270000) }) })).status, 413);
    const invalidStates = [null, [], {}, { ...state, userId: id + 1 }, { ...state, dbPath: '../other.db' },
      { ...state, revision: -1 }, { ...state, revision: '0' }, { ...state, profile: { grade: 5 } },
      { ...state, profile: { grade: 1, userId: id } }, { ...state, courses: {} },
      { ...state, courses: Array.from({ length: 501 }, (_, i) => exampleCourse({ id: `course-${i}` })) },
      { ...state, courses: [exampleCourse(), exampleCourse()] }];
    for (const overrides of [{ credits: '3' }, { credits: 0 }, { credits: 0.5 }, { credits: 13 }, { credits: 31 }, { credits: 1.1 },
      { courseName: ' ' }, { courseName: 'x'.repeat(101) }, { semester: '2026-3' }, { grade: 'constructor' },
      { category: 'other' }, { status: 'other' }, { isRetake: 'false' }, { id: '../other' }, { userId: id + 1 }]) {
      invalidStates.push({ ...state, courses: [exampleCourse(overrides)] });
    }
    for (const invalid of invalidStates) {
      assert.equal((await academicRequest(service, cookie, id, invalid)).status, 400, JSON.stringify(invalid)?.slice(0, 200));
    }
    assert.deepEqual(await (await academicRequest(service, cookie, id)).json(), { courses: [], profile: { grade: 1 }, revision: 0 });
    const attackText = "<img src=x onerror=alert(1)>'); DROP TABLE academic_state;--";
    const [one, two] = await Promise.all([
      academicRequest(service, cookie, id, { ...state, courses: [exampleCourse({ courseName: attackText })] }),
      academicRequest(service, cookie, id, state)
    ]);
    assert.deepEqual([one.status, two.status].sort(), [200, 409]);
    const saved = await (await academicRequest(service, cookie, id)).json();
    assert.equal(saved.revision, 1);
    assert.equal(saved.courses.length, 1);
    assert.equal((await academicRequest(service, cookie, id, state)).status, 409);
    assert.deepEqual(await (await academicRequest(service, secondCookie, id + 1)).json(), { courses: [], profile: { grade: 1 }, revision: 0 });
    // 과목 수가 늘어도 인증 요청의 8 KiB 제한과 별개의 제한으로 정상 저장됩니다.
    const large = { ...state, revision: 1, courses: Array.from({ length: 120 }, (_, i) => exampleCourse({ id: `course-${i}` })) };
    assert.equal((await academicRequest(service, cookie, id, large)).status, 200);
    await service.request('/api/auth/logout', {}, cookie);
    assert.equal((await academicRequest(service, cookie, id)).status, 401);
    service.db.prepare('UPDATE sessions SET expires_at = 0').run();
    assert.equal((await academicRequest(service, secondCookie, id + 1, state)).status, 401);
  } finally { await service.close(); }
});

test('academic writes reject sessions revoked while a request body is uploading', async () => {
  const service = await launch(':memory:');
  try {
    const signup = await service.request('/api/auth/signup', { name: 'One', email: 'one@example.com', password });
    const cookie = cookieOf(signup);
    const id = (await signup.json()).user.id;
    const body = JSON.stringify({ courses: [exampleCourse()], profile: { grade: 4 }, revision: 0 });
    let onRequest;
    const accepted = new Promise(resolve => {
      onRequest = req => {
        if (req.url !== '/api/academic') return;
        const iterator = req.iterator;
        req.iterator = function (options) {
          const result = iterator.call(this, options);
          resolve();
          return result;
        };
      };
      service.app.on('request', onRequest);
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
    // readJson이 실제 요청 스트림을 읽기 시작했음을 확인한 후 세션을 폐기합니다.
    await accepted;
    service.app.off('request', onRequest);
    await service.request('/api/auth/logout', {}, cookie);
    pending.end(body.slice(10));
    assert.equal(await response, 401);
    assert.equal(service.db.prepare('SELECT count(*) AS total FROM user_databases').get().total, 0);
  } finally { await service.close(); }
});

test('dashboard assets, module imports, sample data and authenticated entry route', async () => {
  const service = await launch(':memory:');
  try {
    const guest = await service.request('/');
    assert.equal(guest.status, 302);
    assert.equal(guest.headers.get('location'), '/login.html');

    const page = await service.request('/index.html');
    assert.equal(page.status, 200);
    assert.match(page.headers.get('content-type'), /^text\/html/);
    const html = await page.text();
    assert.match(html, /href="\/grade-analysis\.html"/);
    const analysis = await service.request('/grade-analysis.html');
    assert.equal(analysis.status, 200);
    assert.match(analysis.headers.get('content-type'), /^text\/html/);
    const analysisHtml = await analysis.text();
    assert.match(analysisHtml, /id="grade-dashboard"/);
    assert.match(analysisHtml, /href="\/index\.html"/);
    // Follow actual HTML references and recursive ES module imports through HTTP.
    const pending = [...(html + analysisHtml).matchAll(/(?:src|href)="(\/(?:css|js)\/[^"#]+)"/g)].map(match => match[1]);
    const visited = new Set();
    while (pending.length) {
      const path = pending.pop();
      if (visited.has(path)) continue;
      visited.add(path);
      const asset = await service.request(path);
      assert.equal(asset.status, 200, path);
      assert.match(asset.headers.get('content-type'), path.endsWith('.js') ? /^text\/javascript/ : /^text\/css/);
      const source = await asset.text();
      if (path.endsWith('.js')) {
        for (const match of source.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)) {
          pending.push(new URL(match[1], `http://localhost${path}`).pathname);
        }
      }
    }
    assert.ok(visited.has('/js/graph/dashboard.js'));
    assert.ok(visited.has('/js/graph/gradeRanges.js'));
    assert.ok(visited.has('/js/auth/api.js'));
    for (const name of ['academic_requirements', 'user_info', 'courses', 'grading_policy']) {
      const response = await service.request(`/data/${name}.json`);
      assert.equal(response.status, 200);
      assert.match(response.headers.get('content-type'), /^application\/json/);
      assert.equal(typeof await response.json(), 'object');
    }
    const head = await service.request('/index.html', undefined, null, origin, { method: 'HEAD' });
    assert.equal(head.status, 200);
    assert.equal(await head.text(), '');
    assert.equal((await service.request('/index.html', {})).status, 405);
    for (const path of ['/package.json', '/server/schema.sql', '/js/grades/grades.test.js', '/js/graph/README.md', '/data/unknown.json', '/storage/team07.db', '/.env']) {
      assert.equal((await service.request(path)).status, 404, path);
    }
    const signup = await service.request('/api/auth/signup', { name: 'Dashboard Test', email: 'dashboard@example.com', password });
    assert.equal(signup.status, 201);
    const cookie = cookieOf(signup);
    const entry = await service.request('/', undefined, cookie);
    assert.equal(entry.status, 302);
    assert.equal(entry.headers.get('location'), '/index.html');
    assert.equal((await service.request('/api/auth/logout', {}, cookie)).status, 200);
    assert.equal((await service.request('/', undefined, cookie)).headers.get('location'), '/login.html');
  } finally { await service.close(); }
});

test('signup, isolation, session rotation, restart persistence, expiry and logout', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'team07-auth-'));
  const path = join(folder, 'test.db');
  let service = await launch(path);
  try {
    assert.equal((await service.request('/api/auth/me')).status, 401);
    assert.equal((await service.request('/api/auth/signup', { name: 'Test', email: 'bad', password })).status, 400);
    assert.equal((await service.request('/api/auth/signup', { name: 'Test', email: 'one@example.com', password: 'short' })).status, 400);
    assert.equal((await service.request('/api/auth/signup', { name: 'Test', email: 'one@example.com', password }, null, 'https://evil.example')).status, 403);
    const signup = await service.request('/api/auth/signup', { name: '사용자 1', email: 'One@Example.com', password });
    assert.equal(signup.status, 201);
    assert.match(signup.headers.get('set-cookie'), /HttpOnly/);
    assert.match(signup.headers.get('set-cookie'), /SameSite=Lax/);
    const oldCookie = cookieOf(signup);
    const first = (await signup.json()).user;
    assert.equal(first.email, 'one@example.com');
    assert.equal('password_hash' in first, false);
    assert.equal(service.db.prepare('SELECT password_hash FROM users').get().password_hash.includes(password), false);
    assert.notEqual(service.db.prepare('SELECT token_hash FROM sessions').get().token_hash, oldCookie.split('=')[1]);
    assert.equal((await service.request('/api/auth/signup', { name: 'Duplicate', email: 'one@example.com', password })).status, 409);
    assert.equal((await service.request('/api/auth/login', { email: first.email, password: 'wrong-password-long-enough' })).status, 401);
    assert.equal((await service.request('/api/auth/login', { email: 'unknown@example.com', password })).status, 401);
    const login = await service.request('/api/auth/login', { email: first.email, password }, oldCookie);
    assert.equal(login.status, 200);
    const cookie = cookieOf(login);
    assert.notEqual(cookie, oldCookie);
    assert.equal((await service.request('/api/auth/me', undefined, oldCookie)).status, 401);
    const second = await service.request('/api/auth/signup', { name: '사용자 2', email: 'two@example.com', password });
    const secondCookie = cookieOf(second);
    assert.equal((await (await service.request('/api/auth/me', undefined, cookie)).json()).user.id, first.id);
    assert.notEqual((await (await service.request('/api/auth/me', undefined, secondCookie)).json()).user.id, first.id);
    await service.close();
    service = await launch(path);
    assert.equal((await service.request('/api/auth/me', undefined, cookie)).status, 200);
    assert.equal((await service.request('/api/auth/logout', {}, cookie)).status, 200);
    assert.equal((await service.request('/api/auth/me', undefined, cookie)).status, 401);
    assert.equal((await service.request('/api/auth/me', undefined, secondCookie)).status, 200);
    service.db.prepare('UPDATE sessions SET expires_at = 0').run();
    assert.equal((await service.request('/api/auth/me', undefined, secondCookie)).status, 401);
    for (const privatePath of ['/storage/team07.db', '/server/app.js', '/.env']) {
      assert.equal((await service.request(privatePath)).status, 404);
    }
    const page = await service.request('/login.html');
    assert.equal(page.status, 200);
    assert.match(page.headers.get('content-security-policy'), /script-src/);
    assert.equal((await service.request('/js/auth/login.js')).status, 200);
  } finally {
    await service.close();
    // Remove only these known test DB files (no recursive directory traversal).
    for (const suffix of ['', '-wal', '-shm']) {
      if (existsSync(path + suffix)) unlinkSync(path + suffix);
    }
    rmdirSync(folder);
  }
});

test('rate limiting and production HTTPS configuration', async () => {
  const service = await launch(':memory:', { authLimit: 2 });
  try {
    for (let i = 0; i < 2; i++) assert.equal((await service.request('/api/auth/login', {})).status, 400);
    assert.equal((await service.request('/api/auth/login', {})).status, 429);
  } finally { await service.close(); }
  await assert.rejects(createApp({ dbPath: ':memory:', production: true, origin }), /HTTPS/);
  const production = await launch(':memory:', { production: true, origin: 'https://example.com' });
  try {
    const response = await production.request('/api/auth/signup', { name: 'Test', email: 'test@example.com', password }, null, 'https://example.com');
    assert.equal(response.status, 201);
    assert.match(response.headers.get('set-cookie'), /Secure/);
    assert.match(response.headers.get('set-cookie'), /^__Host-team07_session=/);
    assert.equal((await production.request('/api/auth/me', undefined, cookieOf(response))).status, 200);
  } finally { await production.close(); }
});

test('request validation, CSRF, SQL input and ambiguous session cookies', async () => {
  const service = await launch(':memory:');
  try {
    for (const body of [null, [], {}, { email: {}, password }, { email: 'a@example.com', password: ['invalid'] }]) {
      assert.equal((await service.request('/api/auth/signup', body)).status, 400);
    }
    assert.equal((await service.request('/api/auth/login', {}, null, origin, { rawBody: '{' })).status, 400);
    assert.equal((await service.request('/api/auth/login', {}, null, origin, { headers: { 'Content-Type': 'text/plain' } })).status, 415);
    assert.equal((await service.request('/api/auth/login', { padding: 'x'.repeat(9000) })).status, 413);
    assert.equal((await service.request('/api/auth/login', {}, null, origin, { headers: { Origin: undefined } })).status, 403);
    const name = "<b>'); DROP TABLE users;--</b>";
    const signup = await service.request('/api/auth/signup', { name, email: 'sql@example.com', password });
    assert.equal(signup.status, 201);
    assert.equal((await signup.json()).user.name, name);
    const cookie = cookieOf(signup);
    assert.equal((await service.request('/api/auth/me', undefined, `${cookie}; ${cookie}`)).status, 401);
    assert.equal((await service.request('/api/auth/me', undefined, 'team07_session=invalid')).status, 401);
    assert.equal((await service.request('/api/auth/logout', {}, cookie, 'https://evil.example')).status, 403);
    assert.equal((await service.request('/api/auth/me', undefined, cookie)).status, 200);
    assert.equal(service.db.prepare('SELECT count(*) AS total FROM users').get().total, 1);
  } finally { await service.close(); }
});

test('account and IP throttles survive restart; expiry and successful login clear account counters', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'team07-throttle-'));
  const path = join(folder, 'test.db');
  let service = await launch(path, { accountLimit: 2 });
  try {
    await service.request('/api/auth/signup', { name: 'Test', email: 'test@example.com', password });
    for (let i = 0; i < 2; i++) {
      assert.equal((await service.request('/api/auth/login', { email: 'test@example.com', password: 'incorrect-long-password' })).status, 401);
    }
    await service.close();
    service = await launch(path, { accountLimit: 2 });
    const blocked = await service.request('/api/auth/login', { email: 'TEST@example.com', password });
    assert.equal(blocked.status, 429);
    assert.ok(Number(blocked.headers.get('retry-after')) > 0);
    service.db.prepare("UPDATE auth_attempts SET expires_at = 0 WHERE bucket LIKE 'account:%'").run();
    assert.equal((await service.request('/api/auth/login', { email: 'test@example.com', password })).status, 200);
    assert.equal(service.db.prepare("SELECT count(*) AS total FROM auth_attempts WHERE bucket LIKE 'account:%'").get().total, 0);
    service.db.prepare("UPDATE auth_attempts SET count = 30 WHERE bucket LIKE 'ip:%'").run();
    await service.close();
    service = await launch(path);
    assert.equal((await service.request('/api/auth/login', {}, null, origin, { headers: { 'X-Forwarded-For': '203.0.113.99' } })).status, 429);
  } finally {
    await service.close();
    for (const suffix of ['', '-wal', '-shm']) if (existsSync(path + suffix)) unlinkSync(path + suffix);
    rmdirSync(folder);
  }
});

test('salted password hashes verify correctly and reject malformed storage', async () => {
  const first = await hashPassword(password);
  const second = await hashPassword(password);
  assert.notEqual(first, second);
  assert.equal(await verifyPassword(password, first), true);
  assert.equal(await verifyPassword('wrong', first), false);
  for (const value of [null, '', first + '$extra', first.slice(0, -1), 'scrypt$1$8$5$salt$hash']) {
    assert.equal(await verifyPassword(password, value), false);
  }
});
