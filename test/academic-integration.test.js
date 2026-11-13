import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, unlinkSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { addCourse, updateCourse, removeCourse } from '../js/grades/grades.js';
import { launch as launchHttp } from './http-helper.js';
import { calculateSemesterGpa } from '../js/graph/gradeGraph.js';

const origin = 'http://localhost:3000';
const password = 'Aa1!test2026';
const course = (overrides = {}) => ({
  id: 'course-1', courseName: '자료구조', credits: 3, grade: 'A+', gradePoint: 4.5,
  semester: '2026-1', category: 'major', status: 'completed', isRetake: false, ...overrides
});

function removeFixture(folder) {
  for (const entry of readdirSync(folder, { withFileTypes: true })) {
    const path = join(folder, entry.name);
    if (entry.isDirectory()) {
      for (const file of readdirSync(path)) unlinkSync(join(path, file));
      rmdirSync(path);
    } else unlinkSync(path);
  }
  rmdirSync(folder);
}

async function launch(dbPath) {
  const service = await launchHttp(dbPath);
  return {
    db: service.db,
    async request(path, { method = 'GET', cookie, body, accountId, requestOrigin = origin } = {}) {
      const headers = { Origin: requestOrigin, ...(cookie ? { Cookie: cookie } : {}),
        ...(accountId === undefined ? {} : { 'X-Account-Id': String(accountId) }),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) };
      const res = await service.request(path, body, cookie, requestOrigin, { method, headers });
      return { status: res.status, cookie: res.headers.get('set-cookie')?.split(';')[0],
        data: await res.json(), headers: res.headers };
    },
    stop: () => service.close()
  };
}

async function signup(s, name, email) {
  const res = await s.request('/api/auth/signup', { method: 'POST', body: { name, email, password } });
  assert.equal(res.status, 201);
  return { id: res.data.user.id, cookie: res.cookie };
}
const acad = (s, user, body) => s.request('/api/academic', {
  method: body === undefined ? 'GET' : 'PUT', cookie: user.cookie, accountId: user.id, body
});

test('seasonal semesters sort chronologically in GPA graphs', () => {
  const semesters = ['2027-1', '2026-겨울', '2026-2', '2026-여름', '2026-1'];
  const rows = calculateSemesterGpa(semesters.map((semester, index) => course({ id: `season-${index}`, semester })));
  assert.deepEqual(rows.map(row => row.semester), [...semesters].reverse());
  assert.ok(rows.every(row => row.gpa === 4.5));
});

test('merged academic API adds/edits/deletes seasonal courses and keeps grades and revision per account', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'team07-integration-'));
  const dbPath = join(folder, 'db.sqlite');
  let s = await launch(dbPath);
  try {
    assert.equal((await s.request('/api/academic', { accountId: 1 })).status, 401);
    const a = await signup(s, '학생A', 'student-a@example.com');
    const b = await signup(s, '학생B', 'student-b@example.com');
    assert.equal((await s.request('/api/academic', { cookie: a.cookie })).status, 403);
    assert.equal((await s.request('/api/academic', { cookie: a.cookie, accountId: b.id })).status, 403);
    assert.deepEqual((await acad(s, a)).data, { courses: [], profile: { grade: 1 }, revision: 0 });
    assert.deepEqual((await acad(s, b)).data, { courses: [], profile: { grade: 1 }, revision: 0 });
    const inserted = addCourse([], { courseName: '자료구조', credits: '3', grade: 'A+', semester: '2026-1', category: 'major', status: 'completed' });
    const initial = { courses: inserted, profile: { grade: 2 }, revision: 0 };
    const saved = await acad(s, a, initial);
    assert.equal(saved.status, 200);
    assert.equal(saved.data.courses[0].courseName, '자료구조');
    assert.equal(saved.data.revision, 1);
    assert.deepEqual((await acad(s, b)).data.courses, []);
    assert.equal((await acad(s, a, initial)).status, 409);
    assert.equal((await s.request('/api/academic', { method: 'PUT', cookie: a.cookie, accountId: a.id, body: saved.data, requestOrigin: 'https://evil.example' })).status, 403);
    const withSummer = addCourse(saved.data.courses, { courseName: '계절학기', credits: 2, status: 'in_progress', semester: '2026-여름', category: 'general' });
    const summer = await acad(s, a, { ...saved.data, courses: withSummer });
    assert.equal(summer.status, 200);
    assert.equal(summer.data.courses[1].semester, '2026-여름');
    assert.equal(summer.data.courses[1].gradePoint, null);
    const edit = updateCourse(summer.data.courses, inserted[0].id, { grade: 'B0' });
    const edited = await acad(s, a, { ...summer.data, courses: edit });
    assert.equal(edited.status, 200);
    assert.equal(edited.data.courses[0].gradePoint, 3);
    const removed = await acad(s, a, { ...edited.data, courses: removeCourse(edit, edit[0].id) });
    assert.equal(removed.status, 200);
    assert.equal(removed.data.courses.length, 1);
    assert.equal((await s.request('/api/courses', { cookie: a.cookie })).data.courses.length, 1);
    const { storage_key: key } = s.db.prepare('SELECT storage_key FROM user_databases WHERE user_id=?').get(a.id);
    const personalDb = new DatabaseSync(join(folder, 'users', `${key}.db`), { readOnly: true });
    try {
      const stored = personalDb.prepare('SELECT courses, current_year, revision FROM academic_state').get();
      assert.equal(JSON.parse(stored.courses).length, 1);
      assert.equal(stored.current_year, 2);
      assert.equal(stored.revision, 4);
    } finally { personalDb.close(); }
    await s.stop();
    s = await launch(dbPath);
    assert.equal((await acad(s, a)).data.revision, 4);
    assert.equal((await acad(s, a)).data.courses[0].semester, '2026-여름');
    assert.deepEqual((await acad(s, b)).data.courses, []);
  } finally { await s.stop(); removeFixture(folder); }
});

test('old external-base SQLite user_courses rows automatically gain year/revision and keep saved courses', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'team07-schema-'));
  const dbPath = join(folder, 'db.sqlite');
  const db = new DatabaseSync(dbPath);
  db.exec(`CREATE TABLE users(id INTEGER PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL, password_hash TEXT NOT NULL);
    CREATE TABLE user_courses(user_id INTEGER PRIMARY KEY REFERENCES users(id), courses_json TEXT NOT NULL DEFAULT '[]', updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    INSERT INTO users(id, email, name, password_hash) VALUES (1, 'old@example.com', '기존사용자', 'dummy');`);
  db.prepare('INSERT INTO user_courses(user_id,courses_json) VALUES(1,?)').run(JSON.stringify([course()]));
  db.close();
  const s = await launch(dbPath);
  try {
    const cols = s.db.prepare('PRAGMA table_info(user_courses)').all().map(c => c.name);
    assert.ok(cols.includes('current_year') && cols.includes('revision'));
    const row = s.db.prepare('SELECT * FROM user_courses WHERE user_id=1').get();
    assert.equal(JSON.parse(row.courses_json)[0].courseName, '자료구조');
    assert.equal(row.current_year, 1);
    assert.equal(row.revision, 0);
  } finally { await s.stop(); removeFixture(folder); }
});

test('newest HTML & modules are reachable through server route map', async () => {
  const service = await launchHttp(':memory:');
  try {
    const html = await (await service.request('/index.html')).text();
    assert.match(html, /graduation-total-remaining/);
    assert.match(html, /2026-여름/);
    for (const path of ['/js/academic-api.js', '/js/credits/graduation.js', '/js/dashboard.js', '/js/grade-analysis.js']) {
      assert.equal((await service.request(path)).status, 200, path);
    }
    assert.equal((await service.request('/server/schema.postgres.sql')).status, 404);
  } finally { await service.close(); }
});
