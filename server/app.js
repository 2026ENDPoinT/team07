import { createServer } from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { openDatabase } from './db.js';
import { hashPassword, verifyPassword } from './password.js';
import { createAcademicStore, validateAcademicState } from './academic.js';

const SESSION_MS = 24 * 60 * 60 * 1000;
const WINDOW_MS = 15 * 60 * 1000;
const digest = token => createHash('sha256').update(token).digest('hex');

// 화면에 필요한 파일만 등록해 서버 코드와 DB의 직접 접근을 막습니다.
const staticFiles = new Map([
  ['/login.html', ['public/login.html', 'text/html; charset=utf-8']],
  ['/index.html', ['public/index.html', 'text/html; charset=utf-8']],
  ['/grade-analysis.html', ['public/grade-analysis.html', 'text/html; charset=utf-8']],
  ['/css/auth.css', ['public/css/auth.css', 'text/css; charset=utf-8']],
  ['/css/dashboard.css', ['public/css/dashboard.css', 'text/css; charset=utf-8']],
  ['/js/auth/api.js', ['public/js/auth/api.js', 'text/javascript; charset=utf-8']],
  ['/js/auth/login.js', ['public/js/auth/login.js', 'text/javascript; charset=utf-8']],
  ['/js/academic-api.js', ['public/js/academic-api.js', 'text/javascript; charset=utf-8']],
  ['/js/dashboard.js', ['public/dashboard.js', 'text/javascript; charset=utf-8']],
  ['/js/grade-analysis.js', ['public/grade-analysis.js', 'text/javascript; charset=utf-8']],
  ...[
    'credits/current.js', 'credits/earned.js', 'credits/completion.js', 'credits/graduation.js',
    'grades/grades.js', 'grades/gpa.js',
    'graph/index.js', 'graph/dashboard.js', 'graph/gradeGraph.js', 'graph/gradeRanges.js'
  ].map(file => [`/js/${file}`, [`js/${file}`, 'text/javascript; charset=utf-8']]),
  ...['academic_requirements', 'user_info', 'courses', 'grading_policy']
    .map(name => [`/data/${name}.json`, [`data/${name}.json`, 'application/json; charset=utf-8']])
]);

// 환경 설정을 읽고 DB와 인증 요청 처리기를 준비합니다.
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
  const academic = createAcademicStore(db, dbPath);

  // 없는 계정도 해시 검증을 수행해 응답 시간으로 계정 존재를 추측하기 어렵게 합니다.
  const dummyHash = await hashPassword(randomBytes(32).toString('hex'));
  let activeHashes = 0;

  // 모든 API 응답을 JSON 형식으로 전송합니다.
  function json(res, status, body) {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(body));
  }
  // 요청 쿠키에서 형식이 올바른 세션 식별자만 읽습니다.
  function tokenFrom(req) {
    const parts = (req.headers.cookie || '').split(';').map(s => s.trim()).filter(s => s.startsWith(`${cookieName}=`));
    // 같은 이름의 쿠키가 여러 개면 어느 값도 신뢰하지 않습니다.
    const token = parts.length === 1 ? parts[0].slice(cookieName.length + 1) : null;
    return /^[a-f0-9]{64}$/.test(token || '') ? token : null;
  }
  // JavaScript가 읽을 수 없는 쿠키를 발급하며, 운영 환경에서는 HTTPS로만 전송합니다.
  function cookie(res, token, maxAge) {
    res.setHeader('Set-Cookie', `${cookieName}=${token}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${production ? '; Secure' : ''}`);
  }
  // 현재 요청의 세션을 DB에서 삭제해 더 이상 사용할 수 없게 합니다.
  function revoke(req) {
    const token = tokenFrom(req);
    if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(digest(token));
  }
  // 기존 세션을 교체하고 24시간 유효한 새 세션을 발급합니다. DB에는 해시만 저장합니다.
  function startSession(req, res, userId) {
    revoke(req);
    db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(Date.now());
    const token = randomBytes(32).toString('hex');
    db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').run(digest(token), userId, Date.now() + SESSION_MS);
    cookie(res, token, SESSION_MS / 1000);
  }
  // 만료되지 않은 세션의 사용자를 조회합니다. 개인 데이터 접근 시 이 사용자의 ID를 사용합니다.
  function currentUser(req) {
    const token = tokenFrom(req);
    return token ? db.prepare(`SELECT u.id, u.email, u.name FROM sessions s
      JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?`).get(digest(token), Date.now()) : undefined;
  }
  // IP 또는 계정별 요청 횟수를 DB에 기록하고 15분 동안의 허용 횟수를 검사합니다.
  function allowAttempt(res, bucket, limit) {
    const now = Date.now();
    db.prepare('DELETE FROM auth_attempts WHERE expires_at <= ?').run(now);
    // 식별자는 해시해 저장하며, 제한 기록이 무한히 늘어나지 않도록 개수를 제한합니다.
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
  // 비용이 큰 비밀번호 해시 작업은 동시에 최대 2개만 실행합니다.
  async function passwordWork(res, task) {
    if (activeHashes >= 2) {
      json(res, 503, { message: '로그인 요청이 많습니다. 잠시 후 다시 시도해 주세요.' });
      return null;
    }
    activeHashes++;
    try { return await task(); } finally { activeHashes--; }
  }
  // 이메일 표기를 통일하고 이메일 형식과 비밀번호 길이를 검증합니다.
  function credentials(body) {
    if (!body || typeof body.email !== 'string' || typeof body.password !== 'string') return null;
    const email = body.email.trim().toLowerCase();
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
    if (body.password.length < 15 || body.password.length > 128) return null;
    return { email, password: body.password };
  }
  // JSON 요청만 허용하고 본문 크기를 제한합니다. 인증은 기본 8 KiB입니다.
  async function readJson(req, limit = 8192) {
    if (req.headers['content-type']?.split(';')[0].trim() !== 'application/json') {
      throw Object.assign(new Error('JSON 요청이 필요합니다.'), { status: 415 });
    }
    const chunks = [];
    let size = 0;
    // 크기 초과 시에도 연결을 유지해 클라이언트에 413 오류를 전달합니다.
    for await (const chunk of req.iterator({ destroyOnReturn: false })) {
      size += chunk.length;
      if (size > limit) {
        req.resume();
        throw Object.assign(new Error('요청 본문이 너무 큽니다.'), { status: 413 });
      }
      chunks.push(chunk);
    }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
    catch { throw Object.assign(new Error('요청 형식을 확인해 주세요.'), { status: 400 }); }
  }

  // 공통 보안 헤더를 적용한 뒤 파일 요청과 인증 API 요청을 구분합니다.
  async function handle(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    const url = new URL(req.url, 'http://localhost');
    const path = url.pathname;
    // 첫 화면은 로그인 상태에 따라 이동시키고, 등록된 정적 파일만 제공합니다.
    if (!path.startsWith('/api/')) {
      if (!['GET', 'HEAD'].includes(req.method)) return json(res, 405, { message: '지원하지 않는 메서드입니다.' });
      if (path === '/') {
        res.writeHead(302, { Location: currentUser(req) ? '/index.html' : '/login.html' });
        return res.end();
      }
      const file = staticFiles.get(path);
      if (!file) return json(res, 404, { message: '존재하지 않는 페이지입니다.' });
      const contents = await readFile(new URL(`../${file[0]}`, import.meta.url));
      res.writeHead(200, { 'Content-Type': file[1] });
      return res.end(req.method === 'HEAD' ? undefined : contents);
    }
    res.setHeader('Cache-Control', 'no-store');
    // 상태를 변경하는 요청은 설정된 사이트 출처에서만 받아 CSRF를 방지합니다.
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers.origin !== origin) {
      return json(res, 403, { message: '허용되지 않은 요청 출처입니다.' });
    }
    if (path === '/api/academic') {
      const user = currentUser(req);
      if (!user) return json(res, 401, { message: '로그인이 필요합니다.' });
      // 이 헤더는 DB 선택자가 아닌 계정 변경 감지용입니다. 실제 DB 선택은 세션만 사용합니다.
      if (req.headers['x-account-id'] !== String(user.id)) {
        return json(res, 403, { message: '로그인 계정이 변경되었습니다. 새로고침해 주세요.' });
      }
      if (url.search) return json(res, 400, { message: '사용자나 DB를 지정하는 요청은 지원하지 않습니다.' });
      if (req.method === 'GET') return json(res, 200, academic.read(user.id));
      if (req.method !== 'PUT') return json(res, 405, { message: '지원하지 않는 메서드입니다.' });
      const state = validateAcademicState(await readJson(req, 256 * 1024));
      // 본문을 받는 동안 로그아웃·만료된 세션도 거부합니다.
      const authenticated = currentUser(req);
      if (!authenticated) return json(res, 401, { message: '로그인이 필요합니다.' });
      if (authenticated.id !== user.id) return json(res, 403, { message: '로그인 계정이 변경되었습니다. 새로고침해 주세요.' });
      return json(res, 200, academic.write(user.id, state));
    }
    // 로그인 상태 확인: 비밀번호 정보를 제외한 현재 사용자 정보를 반환합니다.
    if (path === '/api/auth/me' && req.method === 'GET') {
      const user = currentUser(req);
      return user ? json(res, 200, { user }) : json(res, 401, { message: '로그인이 필요합니다.' });
    }
    // 로그아웃: 서버 세션을 폐기하고 브라우저의 쿠키도 만료시킵니다.
    if (path === '/api/auth/logout' && req.method === 'POST') {
      await readJson(req);
      revoke(req);
      cookie(res, '', 0);
      return json(res, 200, { message: '로그아웃되었습니다.' });
    }
    if (['/api/auth/signup', '/api/auth/login'].includes(path) && req.method === 'POST') {
      // 위조 가능한 전달 IP 헤더는 신뢰하지 않습니다. 배포 프록시에도 요청 제한이 필요합니다.
      if (!allowAttempt(res, `ip:${digest(req.socket.remoteAddress || 'unknown')}`, authLimit)) return;
      const body = await readJson(req);
      const input = credentials(body);
      if (!input) return json(res, 400, { message: '이메일과 비밀번호(15~128자)를 확인해 주세요.' });
      // 회원가입: 입력 검증 후 비밀번호 해시를 저장하고 자동 로그인합니다.
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
      // 로그인: 계정별 요청 제한과 비밀번호를 확인한 뒤 새 세션을 발급합니다.
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
  // 요청 시간과 헤더 크기를 제한하고, 내부 오류의 상세 내용은 응답에서 숨깁니다.
  const app = createServer({ requestTimeout: 15000, headersTimeout: 10000, connectionsCheckingInterval: 1000, maxHeaderSize: 16384 }, (req, res) => {
    handle(req, res).catch(err => {
      if (res.headersSent || res.destroyed) return;
      const status = [400, 409, 413, 415].includes(err.status) ? err.status : 500;
      if (status === 500) console.error('Request failed:', err.message);
      json(res, status, { message: status === 500 ? '서버 오류가 발생했습니다.' : err.message });
    });
  });
  app.on('close', () => academic.close());
  return { app, db, currentUser };
}

// 직접 실행할 때만 서버를 시작하고, 종료 신호를 받으면 연결과 DB를 정리합니다.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 3000);
  const { app, db } = await createApp();
  app.listen(port, process.env.HOST || '127.0.0.1', () => {
    console.log(`ENDPoinT: ${process.env.APP_ORIGIN || `http://localhost:${port}`}/`);
  });
  app.on('error', err => { console.error(err.message); db.close(); process.exitCode = 1; });
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
    app.close(() => { db.close(); process.exit(0); });
  });
}
