import { DatabaseSync } from 'node:sqlite';
import { randomBytes } from 'node:crypto';
import { mkdirSync, openSync, closeSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { GRADE_POINTS, CATEGORIES, STATUSES } from '../js/grades/grades.js';

const fail = (status, message) => Object.assign(new Error(message), { status });
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const onlyKeys = (value, keys) => isRecord(value) && Object.keys(value).every(key => keys.includes(key));

// 클라이언트 검증과 별개로, DB에 들어갈 모든 값을 서버에서 검증합니다.
export function validateAcademicState(body) {
  if (!onlyKeys(body, ['courses', 'profile', 'revision']) ||
      !Number.isSafeInteger(body.revision) || body.revision < 0 ||
      !onlyKeys(body.profile, ['grade']) ||
      !Number.isInteger(body.profile.grade) || body.profile.grade < 1 || body.profile.grade > 4 ||
      !Array.isArray(body.courses) || body.courses.length > 500) {
    throw fail(400, '학년, 과목 목록(최대 500개), 저장 버전을 확인해 주세요.');
  }
  const ids = new Set();
  const courses = body.courses.map(course => {
    if (!onlyKeys(course, ['id', 'courseName', 'credits', 'grade', 'gradePoint', 'semester', 'status', 'category', 'isRetake']) ||
        typeof course.id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(course.id) || ids.has(course.id) ||
        typeof course.courseName !== 'string' || !course.courseName.trim() || course.courseName.trim().length > 100 ||
        typeof course.credits !== 'number' || !Number.isFinite(course.credits) || course.credits < 0.5 || course.credits > 30 || course.credits * 2 % 1 !== 0 ||
        typeof course.semester !== 'string' || !/^\d{4}-[12]$/.test(course.semester) ||
        !CATEGORIES.includes(course.category) || !STATUSES.includes(course.status) || typeof course.isRetake !== 'boolean' ||
        (course.status === 'completed' && (typeof course.grade !== 'string' || !Object.hasOwn(GRADE_POINTS, course.grade)))) {
      throw fail(400, '과목 입력값을 확인해 주세요. 학점은 0.5~30 사이의 0.5 단위입니다.');
    }
    ids.add(course.id);
    // 평점은 요청의 gradePoint를 신뢰하지 않고 성적 등급으로 계산합니다.
    return { id: course.id, courseName: course.courseName.trim(), credits: course.credits,
      grade: course.status === 'completed' ? course.grade : '',
      gradePoint: course.status === 'completed' ? GRADE_POINTS[course.grade] : null,
      semester: course.semester, status: course.status, category: course.category, isRetake: course.isRetake };
  });
  return { courses, profile: { grade: body.profile.grade }, revision: body.revision };
}

// 사용자별 파일은 인증 DB 옆 전용 폴더에 보관합니다. 요청에서 파일 경로를 받지 않습니다.
export function createAcademicStore(authDb, authDbPath) {
  if (authDb.type === 'postgres') return createPostgresAcademicStore(authDb);
  const inMemory = authDbPath === ':memory:';
  const folder = inMemory ? null : join(dirname(resolve(authDbPath)), 'users');
  const memoryDatabases = new Map();

  function withDatabase(userId, task) {
    // userId는 검증된 세션에서만 전달하며, 난수 파일명과의 매핑은 서버에서만 관리합니다.
    authDb.prepare('INSERT INTO user_databases(user_id, storage_key) VALUES (?, ?) ON CONFLICT(user_id) DO NOTHING')
      .run(userId, randomBytes(32).toString('hex'));
    const { storage_key: key } = authDb.prepare('SELECT storage_key FROM user_databases WHERE user_id = ?').get(userId);
    if (!/^[a-f0-9]{64}$/.test(key)) throw new Error('Invalid user database key.');
    let db = memoryDatabases.get(key);
    if (!db) {
      if (folder) mkdirSync(folder, { recursive: true, mode: 0o700 });
      const filename = inMemory ? ':memory:' : join(folder, `${key}.db`);
      if (!inMemory) {
        // POSIX에서는 개인 파일 권한으로 생성합니다. Windows에서는 배포 계정의 ACL을 적용해야 합니다.
        try { closeSync(openSync(filename, 'wx', 0o600)); }
        catch (error) { if (error.code !== 'EEXIST') throw error; }
      }
      db = new DatabaseSync(filename);
      if (inMemory) memoryDatabases.set(key, db);
    }
    try {
      db.exec(`PRAGMA busy_timeout = 5000;
        CREATE TABLE IF NOT EXISTS academic_state (
          singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
          storage_key TEXT NOT NULL,
          courses TEXT NOT NULL DEFAULT '[]',
          current_year INTEGER NOT NULL DEFAULT 1 CHECK(current_year BETWEEN 1 AND 4),
          revision INTEGER NOT NULL DEFAULT 0 CHECK(revision >= 0)
        );`);
      db.prepare('INSERT OR IGNORE INTO academic_state(singleton, storage_key) VALUES (1, ?)').run(key);
      const row = db.prepare('SELECT * FROM academic_state WHERE singleton = 1').get();
      if (row.storage_key !== key) throw new Error('User database identity mismatch.');
      return task(db, row);
    } finally {
      // 디스크 DB는 요청마다 닫아 가입자 수만큼 파일 핸들이 누적되지 않게 합니다.
      if (!inMemory) db.close();
    }
  }

  const stateOf = row => ({ courses: JSON.parse(row.courses), profile: { grade: row.current_year }, revision: row.revision });
  return {
    read(userId) { return withDatabase(userId, (_db, row) => stateOf(row)); },
    write(userId, state) {
      return withDatabase(userId, db => {
        // 버전 비교와 저장을 하나의 SQL 문장으로 처리해 다른 탭의 변경을 덮어쓰지 않습니다.
        const result = db.prepare(`UPDATE academic_state SET courses = ?, current_year = ?, revision = revision + 1
          WHERE singleton = 1 AND revision = ?`).run(JSON.stringify(state.courses), state.profile.grade, state.revision);
        if (!result.changes) throw fail(409, '다른 화면에서 데이터가 변경되었습니다. 새로고침한 뒤 다시 시도해 주세요.');
        return { ...state, revision: state.revision + 1 };
      });
    },
    close() { for (const db of memoryDatabases.values()) db.close(); memoryDatabases.clear(); }
  };
}

function createPostgresAcademicStore(db) {
  const stateOf = row => row
    ? { courses: row.courses, profile: { grade: row.current_year }, revision: Number(row.revision) }
    : { courses: [], profile: { grade: 1 }, revision: 0 };
  return {
    async read(userId) {
      const { rows } = await db.query('SELECT courses, current_year, revision FROM app_private.academic_state WHERE user_id = $1', [userId]);
      return stateOf(rows[0]);
    },
    async write(userId, state) {
      await db.query('INSERT INTO app_private.academic_state(user_id) VALUES ($1) ON CONFLICT(user_id) DO NOTHING', [userId]);
      // 사용자 조건과 버전 비교를 같은 UPDATE에 넣어 다른 계정 접근 및 동시 덮어쓰기를 막습니다.
      const { rows } = await db.query(`UPDATE app_private.academic_state SET courses = $2::jsonb, current_year = $3, revision = revision + 1
        WHERE user_id = $1 AND revision = $4 RETURNING courses, current_year, revision`,
      [userId, JSON.stringify(state.courses), state.profile.grade, state.revision]);
      if (!rows.length) throw fail(409, '다른 화면에서 데이터가 변경되었습니다. 새로고침한 뒤 다시 시도해 주세요.');
      return stateOf(rows[0]);
    },
    close() {}
  };
}
