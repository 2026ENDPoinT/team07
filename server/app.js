import { createServer } from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { openDatabase } from './db.js';
import { hashPassword, verifyPassword } from './password.js';

const SESSION_MS = 24 * 60 * 60 * 1000;
const WINDOW_MS = 15 * 60 * 1000;
const digest = token => createHash('sha256').update(token).digest('hex');
const staticFiles = new Map([
  ['/login.html', ['login.html', 'text/html; charset=utf-8']],
  ['/css/auth.css', ['css/auth.css', 'text/css; charset=utf-8']],
  ['/js/auth/api.js', ['js/auth/api.js', 'text/javascript; charset=utf-8']],
  ['/js/auth/login.js', ['js/auth/login.js', 'text/javascript; charset=utf-8']]
]);

export async function createApp({
  dbPath = process.env.DB_PATH || resolve('storage/team07.db'),
  origin = process.env.APP_ORIGIN || 'http://localhost:3000',
  production = process.env.NODE_ENV === 'production',
  authLimit = 30,
  accountLimit = 10
} = {}) {
  origin = new URL(origin).origin;
  if (production && !origin.startsWith('https://')) throw new Error('Production APP_ORIGIN must use HTTPS.');
  if (![authLimit, accountLimit].every(value => Number.isSafeInteger(value) && value > 0)) {
    throw new Error('Authentication limits must be positive integers.');
  }
  const cookieName = production ? '__Host-team07_session' : 'team07_session';
  const db = openDatabase(dbPath);
  const dummyHash = await hashPassword(randomBytes(32).toString('hex'));
  let activeHashes = 0;

  function json(res, status, body) {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(body));
  }
  function tokenFrom(req) {
    const parts = (req.headers.cookie || '').split(';').map(s => s.trim()).filter(s => s.startsWith(`${cookieName}=`));
    // Ambiguous cookies are rejected instead of choosing an attacker-supplied value.
    const token = parts.length === 1 ? parts[0].slice(cookieName.length + 1) : null;
    return /^[a-f0-9]{64}$/.test(token || '') ? token : null;
  }
  function cookie(res, token, maxAge) {
    res.setHeader('Set-Cookie', `${cookieName}=${token}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${production ? '; Secure' : ''}`);
  }
  function revoke(req) {
    const token = tokenFrom(req);
    if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(digest(token));
  }
  function startSession(req, res, userId) {
    revoke(req);
    db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(Date.now());
    const token = randomBytes(32).toString('hex');
    db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').run(digest(token), userId, Date.now() + SESSION_MS);
    cookie(res, token, SESSION_MS / 1000);
  }
  // Future private APIs must use this user's id as their data owner.
  function currentUser(req) {
    const token = tokenFrom(req);
    return token ? db.prepare(`SELECT u.id, u.email, u.name FROM sessions s
      JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?`).get(digest(token), Date.now()) : undefined;
  }
  function allowAttempt(res, bucket, limit) {
    const now = Date.now();
    db.prepare('DELETE FROM auth_attempts WHERE expires_at <= ?').run(now);
    // Store hashed identifiers, persist across restarts, and bound storage growth.
    if (!db.prepare('SELECT 1 FROM auth_attempts WHERE bucket = ?').get(bucket) &&
        db.prepare('SELECT count(*) AS total FROM auth_attempts').get().total >= 20000) {
      json(res, 503, { message: '요청이 많습니다. 잠시 후 다시 시도해 주세요.' });
      return false;
    }
    const record = db.prepare(`INSERT INTO auth_attempts(bucket, count, expires_at) VALUES (?, 1, ?)
      ON CONFLICT(bucket) DO UPDATE SET count = min(auth_attempts.count + 1, ?)
      RETURNING count, expires_at`).get(bucket, now + WINDOW_MS, limit + 1);
    if (record.count <= limit) return true;
    res.setHeader('Retry-After', String(Math.ceil((record.expires_at - now) / 1000)));
    json(res, 429, { message: '요청이 너무 많습니다. 15분 후 다시 시도해 주세요.' });
    return false;
  }
  async function passwordWork(res, task) {
    if (activeHashes >= 2) {
      json(res, 503, { message: '로그인 요청이 많습니다. 잠시 후 다시 시도해 주세요.' });
      return null;
    }
    activeHashes++;
    try { return await task(); } finally { activeHashes--; }
  }
  function credentials(body) {
    if (!body || typeof body.email !== 'string' || typeof body.password !== 'string') return null;
    const email = body.email.trim().toLowerCase();
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
    if (body.password.length < 15 || body.password.length > 128) return null;
    return { email, password: body.password };
  }
  async function readJson(req) {
    if (req.headers['content-type']?.split(';')[0].trim() !== 'application/json') {
      throw Object.assign(new Error('JSON 요청이 필요합니다.'), { status: 415 });
    }
    const chunks = [];
    let size = 0;
    // Keep the socket usable for the 413 response when a streaming body exceeds the limit.
    for await (const chunk of req.iterator({ destroyOnReturn: false })) {
      size += chunk.length;
      if (size > 8192) {
        req.resume();
        throw Object.assign(new Error('요청 본문이 너무 큽니다.'), { status: 413 });
      }
      chunks.push(chunk);
    }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
    catch { throw Object.assign(new Error('요청 형식을 확인해 주세요.'), { status: 400 }); }
  }

  async function handle(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    const path = new URL(req.url, 'http://localhost').pathname;
    if (!path.startsWith('/api/')) {
      if (!['GET', 'HEAD'].includes(req.method)) return json(res, 405, { message: '지원하지 않는 메서드입니다.' });
      if (path === '/') { res.writeHead(302, { Location: '/login.html' }); return res.end(); }
      const file = staticFiles.get(path);
      if (!file) return json(res, 404, { message: '존재하지 않는 페이지입니다.' });
      const contents = await readFile(new URL(`../public/${file[0]}`, import.meta.url));
      res.writeHead(200, { 'Content-Type': file[1] });
      return res.end(req.method === 'HEAD' ? undefined : contents);
    }
    res.setHeader('Cache-Control', 'no-store');
    // Require same-origin requests for every mutation, including login and logout.
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers.origin !== origin) {
      return json(res, 403, { message: '허용되지 않은 요청 출처입니다.' });
    }
    if (path === '/api/auth/me' && req.method === 'GET') {
      const user = currentUser(req);
      return user ? json(res, 200, { user }) : json(res, 401, { message: '로그인이 필요합니다.' });
    }
    if (path === '/api/auth/logout' && req.method === 'POST') {
      await readJson(req);
      revoke(req);
      cookie(res, '', 0);
      return json(res, 200, { message: '로그아웃되었습니다.' });
    }
    if (['/api/auth/signup', '/api/auth/login'].includes(path) && req.method === 'POST') {
      // Forwarded IP headers are not trusted; the deployment proxy must limit traffic too.
      if (!allowAttempt(res, `ip:${digest(req.socket.remoteAddress || 'unknown')}`, authLimit)) return;
      const body = await readJson(req);
      const input = credentials(body);
      if (!input) return json(res, 400, { message: '이메일과 비밀번호(15~128자)를 확인해 주세요.' });
      if (path.endsWith('/signup')) {
        const name = typeof body.name === 'string' ? body.name.trim() : '';
        if (!name || name.length > 50) return json(res, 400, { message: '이름은 1~50자로 입력해 주세요.' });
        const hash = await passwordWork(res, () => hashPassword(input.password));
        if (hash === null) return;
        const result = db.prepare(`INSERT INTO users(email, name, password_hash) VALUES (?, ?, ?)
          ON CONFLICT(email) DO NOTHING`).run(input.email, name, hash);
        if (!result.changes) return json(res, 409, { message: '이 이메일로 가입할 수 없습니다. 기존 계정이 있다면 로그인해 주세요.' });
        const user = { id: Number(result.lastInsertRowid), email: input.email, name };
        startSession(req, res, user.id);
        return json(res, 201, { user });
      }
      const accountBucket = `account:${digest(input.email)}`;
      if (!allowAttempt(res, accountBucket, accountLimit)) return;
      const row = db.prepare('SELECT * FROM users WHERE email = ?').get(input.email);
      const valid = await passwordWork(res, () => verifyPassword(input.password, row?.password_hash || dummyHash));
      if (valid === null) return;
      if (!row || !valid) return json(res, 401, { message: '이메일 또는 비밀번호가 올바르지 않습니다.' });
      db.prepare('DELETE FROM auth_attempts WHERE bucket = ?').run(accountBucket);
      startSession(req, res, row.id);
      return json(res, 200, { user: { id: row.id, email: row.email, name: row.name } });
    }
    return json(res, 404, { message: '존재하지 않는 API입니다.' });
  }
  const app = createServer({ requestTimeout: 15000, headersTimeout: 10000, connectionsCheckingInterval: 1000, maxHeaderSize: 16384 }, (req, res) => {
    handle(req, res).catch(err => {
      if (res.headersSent || res.destroyed) return;
      const status = [400, 413, 415].includes(err.status) ? err.status : 500;
      if (status === 500) console.error('Request failed:', err.message);
      json(res, status, { message: status === 500 ? '서버 오류가 발생했습니다.' : err.message });
    });
  });
  return { app, db, currentUser };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 3000);
  const { app, db } = await createApp();
  app.listen(port, process.env.HOST || '127.0.0.1', () => {
    console.log(`Team07 login: ${process.env.APP_ORIGIN || `http://localhost:${port}`}/login.html`);
  });
  app.on('error', err => { console.error(err.message); db.close(); process.exitCode = 1; });
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
    app.close(() => { db.close(); process.exit(0); });
  });
}
