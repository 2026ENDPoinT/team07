import { createServer } from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { openDatabase } from './db.js';
import { hashPassword, verifyPassword } from './password.js';
import { createAcademicStore, validateAcademicState } from './academic.js';
import { validateCalendarState } from './calendar.js';
import { configurationError, failureDetails } from './diagnostics.js';

const SESSION_MS = 24 * 60 * 60 * 1000;
const WINDOW_MS = 15 * 60 * 1000;
const digest = token => createHash('sha256').update(token).digest('hex');

// 화면에 필요한 파일만 등록해 서버 코드와 DB의 직접 접근을 막습니다.
const staticFiles = new Map([
  ['/login.html', ['public/login.html', 'text/html; charset=utf-8']],
  ['/index.html', ['public/index.html', 'text/html; charset=utf-8']],
  ['/mypage.html', ['public/mypage.html', 'text/html; charset=utf-8']],
  ['/css/mypage.css', ['public/css/mypage.css', 'text/css; charset=utf-8']],
  ['/js/mypage.js', ['public/mypage.js', 'text/javascript; charset=utf-8']],
  ['/grade-analysis.html', ['public/grade-analysis.html', 'text/html; charset=utf-8']],
  ['/calendar.html', ['public/calendar.html', 'text/html; charset=utf-8']],
  ['/css/calendar.css', ['public/css/calendar.css', 'text/css; charset=utf-8']],
  ['/js/calendar.js', ['public/calendar.js', 'text/javascript; charset=utf-8']],
  ['/js/calendar-api.js', ['public/js/calendar-api.js', 'text/javascript; charset=utf-8']],
  ['/js/calendar-model.js', ['public/js/calendar-model.js', 'text/javascript; charset=utf-8']],
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
  databaseUrl = process.env.DATABASE_URL || null,
  database,
  requirePostgres = process.env.RENDER === 'true',
  databaseSsl = process.env.DATABASE_SSL || 'verify-full',
  databaseSslCaFile = process.env.DATABASE_SSL_CA_FILE,
  databaseSslCa = process.env.DATABASE_SSL_CA,
  origin = process.env.APP_ORIGIN || 'http://localhost:3000',
  production = process.env.NODE_ENV === 'production',
  authLimit = 30,
  accountLimit = 10
} = {}) {
  try {
    const parsedOrigin = new URL(origin);
    if (!['http:', 'https:'].includes(parsedOrigin.protocol)) throw new Error();
    origin = parsedOrigin.origin;
  } catch { throw configurationError('APP_ORIGIN_INVALID', 'APP_ORIGIN must be a valid HTTP(S) origin.'); }

  if (production && !origin.startsWith('https://')) throw configurationError('APP_ORIGIN_HTTPS_REQUIRED', 'Production APP_ORIGIN must use HTTPS.');
  if (![authLimit, accountLimit].every(value => Number.isSafeInteger(value) && value > 0)) {
    throw configurationError('AUTH_LIMITS_INVALID', 'Authentication limits must be positive integers.');
  }
  if (requirePostgres && !databaseUrl && database?.type !== 'postgres') {
    throw configurationError('DATABASE_URL_REQUIRED', 'DATABASE_URL is required on Render. Refusing ephemeral SQLite fallback.');
  }
  const cookieName = production ? '__Host-team07_session' : 'team07_session';
  const db = database || await openDatabase(dbPath, { databaseUrl, production,
    sslMode: databaseSsl, sslCaFile: databaseSslCaFile, sslCa: databaseSslCa });
  const academic = createAcademicStore(db, dbPath);
  // PostgreSQL의 search_path나 pooler 설정에 의존하지 않고 비공개 테이블을 지정합니다.
  const usersTable = db.type === 'postgres' ? 'app_private.users' : 'users';
  const sessionsTable = db.type === 'postgres' ? 'app_private.sessions' : 'sessions';
  const attemptsTable = db.type === 'postgres' ? 'app_private.auth_attempts' : 'auth_attempts';

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
  async function revoke(req) {
    const token = tokenFrom(req);
    if (token) await db.query(`DELETE FROM ${sessionsTable} WHERE token_hash = $1`, [digest(token)]);
  }
  // 기존 세션을 교체하고 24시간 유효한 새 세션을 발급합니다. DB에는 해시만 저장합니다.
  async function startSession(req, res, userId) {
    await revoke(req);
    await db.query(`DELETE FROM ${sessionsTable} WHERE expires_at <= $1`, [Date.now()]);
    const token = randomBytes(32).toString('hex');
    await db.query(`INSERT INTO ${sessionsTable} (token_hash, user_id, expires_at) VALUES ($1, $2, $3)`, [digest(token), userId, Date.now() + SESSION_MS]);
    cookie(res, token, SESSION_MS / 1000);
  }
  // 만료되지 않은 세션의 사용자를 조회합니다. 개인 데이터 접근 시 이 사용자의 ID를 사용합니다.
  async function currentUser(req) {
    const token = tokenFrom(req);
    return token ? (await db.query(`SELECT u.id, u.email, u.name, u.department,
      u.double_major AS "doubleMajor", u.minor FROM ${sessionsTable} s
      JOIN ${usersTable} u ON u.id = s.user_id WHERE s.token_hash = $1 AND s.expires_at > $2`, [digest(token), Date.now()])).rows[0] : undefined;
  }
  // IP 또는 계정별 요청 횟수를 DB에 기록하고 15분 동안의 허용 횟수를 검사합니다.
  async function allowAttempt(res, bucket, limit) {
    const now = Date.now();
    await db.query(`DELETE FROM ${attemptsTable} WHERE expires_at <= $1`, [now]);
    // 식별자는 해시해 저장하며, 제한 기록이 무한히 늘어나지 않도록 개수를 제한합니다.
    if (!(await db.query(`SELECT 1 FROM ${attemptsTable} WHERE bucket = $1`, [bucket])).rows[0] &&
        Number((await db.query(`SELECT count(*) AS total FROM ${attemptsTable}`)).rows[0].total) >= 20000) {
      json(res, 503, { message: '요청이 많습니다. 잠시 후 다시 시도해 주세요.' });
      return false;
    }
    const record = (await db.query(`INSERT INTO ${attemptsTable}(bucket, count, expires_at) VALUES ($1, 1, $2)
      ON CONFLICT(bucket) DO UPDATE SET count = CASE WHEN auth_attempts.count < $3 THEN auth_attempts.count + 1 ELSE $3 END
      RETURNING count, expires_at`, [bucket, now + WINDOW_MS, limit + 1])).rows[0];
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
    if (path === '/healthz' && ['GET', 'HEAD'].includes(req.method)) {
      try {
        await db.query('SELECT 1');
        return json(res, 200, { status: 'ok' });
      } catch { return json(res, 503, { status: 'unavailable' }); }
    }
    // 첫 화면은 로그인 상태에 따라 이동시키고, 등록된 정적 파일만 제공합니다.
    if (!path.startsWith('/api/')) {
      if (!['GET', 'HEAD'].includes(req.method)) return json(res, 405, { message: '지원하지 않는 메서드입니다.' });
      if (path === '/') {
        res.writeHead(302, { Location: await currentUser(req) ? '/index.html' : '/login.html' });
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
    if (path === '/api/academic' || path === '/api/calendar') {
      const isCalendar = path === '/api/calendar';
      const user = await currentUser(req);
      if (!user) return json(res, 401, { message: '로그인이 필요합니다.' });
      // 이 헤더는 DB 선택자가 아닌 계정 변경 감지용입니다. 실제 DB 선택은 세션만 사용합니다.
      if (req.headers['x-account-id'] !== String(user.id)) {
        return json(res, 403, { message: '로그인 계정이 변경되었습니다. 새로고침해 주세요.' });
      }
      if (url.search) return json(res, 400, { message: '사용자나 DB를 지정하는 요청은 지원하지 않습니다.' });
      if (req.method === 'GET') return json(res, 200, await (isCalendar ? academic.readCalendar(user.id) : academic.read(user.id)));
      if (req.method !== 'PUT') return json(res, 405, { message: '지원하지 않는 메서드입니다.' });
      const state = (isCalendar ? validateCalendarState : validateAcademicState)(await readJson(req, isCalendar ? 8 * 1024 * 1024 : 256 * 1024));
      // 본문을 받는 동안 로그아웃·만료된 세션도 거부합니다.
      const authenticated = await currentUser(req);
      if (!authenticated) return json(res, 401, { message: '로그인이 필요합니다.' });
      if (authenticated.id !== user.id) return json(res, 403, { message: '로그인 계정이 변경되었습니다. 새로고침해 주세요.' });
      return json(res, 200, await (isCalendar ? academic.writeCalendar(user.id, state) : academic.write(user.id, state)));
    }
    // 구버전 화면도 같은 계정별 저장소를 사용해 최신 학사 API와 데이터가 어긋나지 않게 합니다.
    if (path === '/api/courses' && ['GET', 'PUT'].includes(req.method)) {
      const user = await currentUser(req);
      if (!user) return json(res, 401, { message: '로그인이 필요합니다.' });
      const existing = await academic.read(user.id);
      if (req.method === 'GET') return json(res, 200, { courses: existing.revision ? existing.courses : null });
      const body = await readJson(req, 256 * 1024);
      const state = validateAcademicState({ courses: body?.courses, profile: existing.profile, revision: existing.revision });
      const authenticated = await currentUser(req);
      if (!authenticated) return json(res, 401, { message: '로그인이 필요합니다.' });
      if (authenticated.id !== user.id) return json(res, 403, { message: '로그인 계정이 변경되었습니다. 새로고침해 주세요.' });
      const saved = await academic.write(user.id, state);
      return json(res, 200, { courses: saved.courses });
    }
    // 로그인 상태 확인: 비밀번호 정보를 제외한 현재 사용자 정보를 반환합니다.
    if (path === '/api/auth/me' && req.method === 'GET') {
      const user = await currentUser(req);
      return user ? json(res, 200, { user }) : json(res, 401, { message: '로그인이 필요합니다.' });
    }
    // 계정 선택은 세션으로만 수행하며, 화면을 연 뒤 계정이 바뀐 경우 수정을 거부합니다.
    if (path === '/api/auth/profile' && req.method === 'POST') {
      const user = await currentUser(req);
      if (!user) return json(res, 401, { message: '로그인이 필요합니다.' });
      if (req.headers['x-account-id'] !== String(user.id)) {
        return json(res, 403, { message: '로그인 계정이 변경되었습니다. 새로고침해 주세요.' });
      }
      if (url.search) return json(res, 400, { message: '사용자를 지정하는 요청은 지원하지 않습니다.' });
      const body = await readJson(req);
      const fields = ['name', 'email', 'department', 'doubleMajor', 'minor', 'password', 'passwordConfirm'];
      if (!body || Array.isArray(body) || typeof body !== 'object' ||
          Object.keys(body).some(key => !fields.includes(key)) ||
          !['name', 'email', 'department'].every(key => typeof body[key] === 'string')) {
        return json(res, 400, { message: '회원정보 입력 형식을 확인해 주세요.' });
      }
      const name = body.name.trim();
      const email = body.email.trim().toLowerCase();
      const department = body.department.trim();
      if (!name || name.length > 50) return json(res, 400, { message: '이름은 1~50자로 입력해 주세요.' });
      if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return json(res, 400, { message: '아이디는 올바른 이메일 주소로 입력해 주세요.' });
      }
      if (department.length > 100) return json(res, 400, { message: '학과는 100자 이내로 입력해 주세요.' });
      // 빈 문자열은 미선택, 생략은 기존 선택 유지입니다. 전공명으로 선택 여부를 함께 저장합니다.
      const majors = {};
      for (const [key, label] of [['doubleMajor', '복수전공'], ['minor', '부전공']]) {
        if (body[key] !== undefined && (typeof body[key] !== 'string' || body[key].trim().length > 100)) {
          return json(res, 400, { message: `${label} 전공명은 100자 이내의 문자열로 입력해 주세요.` });
        }
        majors[key] = body[key] === undefined ? null : body[key].trim();
      }
      const password = body.password === undefined ? '' : body.password;
      const passwordConfirm = body.passwordConfirm === undefined ? '' : body.passwordConfirm;
      if (typeof password !== 'string' || typeof passwordConfirm !== 'string') {
        return json(res, 400, { message: '비밀번호 입력 형식을 확인해 주세요.' });
      }
      if (password !== passwordConfirm) return json(res, 400, { message: '비밀번호 확인이 일치하지 않습니다.' });
      if (password && (password.length < 15 || password.length > 128)) {
        return json(res, 400, { message: '비밀번호는 15~128자로 입력해 주세요.' });
      }
      let hash = null;
      if (password) {
        if (!await allowAttempt(res, `profile:${digest(String(user.id))}`, accountLimit)) return;
        hash = await passwordWork(res, () => hashPassword(password));
        if (hash === null) return;
      }
      // 본문 수신·해시 작업 중 폐기되거나 만료된 세션으로는 저장할 수 없습니다.
      let saved;
      try {
        saved = (await db.query(`UPDATE ${usersTable}
          SET name = $1, email = $2, department = $3, password_hash = COALESCE($4, password_hash),
            double_major = COALESCE($8, double_major), minor = COALESCE($9, minor)
          WHERE id = $5 AND EXISTS (SELECT 1 FROM ${sessionsTable}
            WHERE token_hash = $6 AND user_id = $5 AND expires_at > $7)
          RETURNING id, email, name, department, double_major AS "doubleMajor", minor`,
        [name, email, department, hash, user.id, digest(tokenFrom(req)), Date.now(), majors.doubleMajor, majors.minor])).rows[0];
      } catch (error) {
        if (error.code === '23505' || error.errcode === 2067) {
          return json(res, 409, { message: '이미 사용 중인 아이디(이메일)입니다.' });
        }
        throw error;
      }
      return saved ? json(res, 200, { user: saved }) : json(res, 401, { message: '로그인이 필요합니다.' });
    }
    // 로그아웃: 서버 세션을 폐기하고 브라우저의 쿠키도 만료시킵니다.
    if (path === '/api/auth/logout' && req.method === 'POST') {
      await readJson(req);
      await revoke(req);
      cookie(res, '', 0);
      return json(res, 200, { message: '로그아웃되었습니다.' });
    }
    if (['/api/auth/signup', '/api/auth/login'].includes(path) && req.method === 'POST') {
      // 위조 가능한 전달 IP 헤더는 신뢰하지 않습니다. 배포 프록시에도 요청 제한이 필요합니다.
      if (!await allowAttempt(res, `ip:${digest(req.socket.remoteAddress || 'unknown')}`, authLimit)) return;
      const body = await readJson(req);
      const input = credentials(body);
      if (!input) return json(res, 400, { message: '이메일과 비밀번호(15~128자)를 확인해 주세요.' });
      // 회원가입: 입력 검증 후 비밀번호 해시를 저장하고 자동 로그인합니다.
      if (path.endsWith('/signup')) {
        const name = typeof body.name === 'string' ? body.name.trim() : '';
        if (!name || name.length > 50) return json(res, 400, { message: '이름은 1~50자로 입력해 주세요.' });
        const hash = await passwordWork(res, () => hashPassword(input.password));
        if (hash === null) return;
        const result = await db.query(`INSERT INTO ${usersTable}(email, name, password_hash) VALUES ($1, $2, $3)
          ON CONFLICT(email) DO NOTHING RETURNING id`, [input.email, name, hash]);
        if (!result.rows.length) return json(res, 409, { message: '이 이메일로 가입할 수 없습니다. 기존 계정이 있다면 로그인해 주세요.' });
        const user = { id: result.rows[0].id, email: input.email, name, department: '', doubleMajor: '', minor: '' };
        await startSession(req, res, user.id);
        return json(res, 201, { user });
      }
      // 로그인: 계정별 요청 제한과 비밀번호를 확인한 뒤 새 세션을 발급합니다.
      const accountBucket = `account:${digest(input.email)}`;
      if (!await allowAttempt(res, accountBucket, accountLimit)) return;
      const row = (await db.query(`SELECT * FROM ${usersTable} WHERE email = $1`, [input.email])).rows[0];
      const valid = await passwordWork(res, () => verifyPassword(input.password, row?.password_hash || dummyHash));
      if (valid === null) return;
      if (!row || !valid) return json(res, 401, { message: '이메일 또는 비밀번호가 올바르지 않습니다.' });
      await db.query(`DELETE FROM ${attemptsTable} WHERE bucket = $1`, [accountBucket]);
      await startSession(req, res, row.id);
      return json(res, 200, { user: { id: row.id, email: row.email, name: row.name, department: row.department,
        doubleMajor: row.double_major, minor: row.minor } });
    }
    return json(res, 404, { message: '존재하지 않는 API입니다.' });
  }
  // 요청 시간과 헤더 크기를 제한하고, 내부 오류의 상세 내용은 응답에서 숨깁니다.
  const app = createServer({ requestTimeout: 15000, headersTimeout: 10000, connectionsCheckingInterval: 1000, maxHeaderSize: 16384 }, (req, res) => {
    handle(req, res).catch(err => {
      if (res.headersSent || res.destroyed) return;
      const status = [400, 409, 413, 415].includes(err.status) ? err.status : 500;
      if (status === 500) console.error('Request failed.', failureDetails(err));
      json(res, status, { message: status === 500 ? '서버 오류가 발생했습니다.' : err.message });
    });
  });
  app.on('close', () => academic.close());
  return { app, db, currentUser };
}

// 직접 실행할 때만 서버를 시작하고, 종료 신호를 받으면 연결과 DB를 정리합니다.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 3000);
  // 시작 오류에 연결 문자열이나 인증 정보가 포함되어도 공개하지 않습니다.
  let service;
  try { service = await createApp(); }
  catch (error) { console.error('Server startup failed.', failureDetails(error)); process.exit(1); }
  const { app, db } = service;
  app.listen(port, process.env.HOST || '127.0.0.1', () => {
    console.log(`ENDPoinT: ${process.env.APP_ORIGIN || `http://localhost:${port}`}/`);
  });
  app.on('error', async error => { console.error('HTTP server failed.', failureDetails(error)); await db.close(); process.exitCode = 1; });
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
    app.close(async () => { await db.close(); process.exit(0); });
  });
}
