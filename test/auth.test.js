import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, unlinkSync, rmdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/app.js';
import { request as httpRequest } from 'node:http';
import { hashPassword, verifyPassword } from '../server/password.js';

const origin = 'http://localhost:3000';
const password = 'a-long-test-password-2026';
async function launch(dbPath, options = {}) {
  const { app, db } = await createApp({ dbPath, origin, ...options });
  const server = await new Promise(resolve => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    db,
    async request(path, body, cookie, requestOrigin = origin, options = {}) {
      return new Promise((resolve, reject) => {
        const headers = { Origin: requestOrigin, 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...options.headers };
        for (const key of Object.keys(headers)) if (headers[key] === undefined) delete headers[key];
        const request = httpRequest(base + path, { method: options.method || (body === undefined ? 'GET' : 'POST'),
          headers
        }, response => {
          const chunks = [];
          response.on('data', chunk => chunks.push(chunk));
          response.on('error', reject);
          response.on('end', () => {
            resolve({ status: response.statusCode,
            headers: { get: key => {
              const value = response.headers[key.toLowerCase()];
              return Array.isArray(value) ? value.join(', ') : value || null;
            } },
            json: async () => JSON.parse(Buffer.concat(chunks).toString('utf8')),
            text: async () => Buffer.concat(chunks).toString('utf8')
          });
          });
        });
        request.on('error', reject);
        request.end(options.rawBody ?? (body === undefined ? undefined : JSON.stringify(body)));
      });
    },
    async close() {
      await new Promise(resolve => server.close(resolve));
      db.close();
    }
  };
}
const cookieOf = response => response.headers.get('set-cookie').split(';')[0];

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
