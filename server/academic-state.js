import { CATEGORIES, GRADE_POINTS, STATUSES } from '../js/grades/grades.js';

const fail = (status, message) => Object.assign(new Error(message), { status });
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const onlyKeys = (value, keys) => isRecord(value) && Object.keys(value).every(key => keys.includes(key));

// 최신 main(2)의 과목·학기·학년 입력 규칙을 서버에서도 동일하게 적용합니다.
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
        typeof course.credits !== 'number' || !Number.isInteger(course.credits) || course.credits < 1 || course.credits > 12 ||
        typeof course.semester !== 'string' || !/^\d{4}-(1|2|여름|겨울)$/.test(course.semester) ||
        !CATEGORIES.includes(course.category) || !STATUSES.includes(course.status) || typeof course.isRetake !== 'boolean' ||
        (course.status === 'completed' && (typeof course.grade !== 'string' || !Object.hasOwn(GRADE_POINTS, course.grade)))) {
      throw fail(400, '과목 입력값을 확인해 주세요. 학기는 YYYY-1, YYYY-2, YYYY-여름, YYYY-겨울이며 학점은 1~12 사이의 정수여야 합니다.');
    }
    ids.add(course.id);
    return {
      id: course.id, courseName: course.courseName.trim(), credits: course.credits,
      grade: course.status === 'completed' ? course.grade : '',
      gradePoint: course.status === 'completed' ? GRADE_POINTS[course.grade] : null,
      semester: course.semester, status: course.status, category: course.category, isRetake: course.isRetake
    };
  });
  return { courses, profile: { grade: body.profile.grade }, revision: body.revision };
}

// Supabase의 기존 user_courses 행을 그대로 사용하므로 기존 회원/과목을 잃지 않습니다.
// PostgreSQL과 SQLite에 동일한 비동기 DB 인터페이스(db.query)를 사용합니다.
export function createAcademicStore(db) {
  async function read(userId) {
    const result = await db.query('SELECT courses_json, current_year, revision FROM user_courses WHERE user_id = ?', [userId]);
    const row = result.rows[0];
    return row ? { courses: JSON.parse(row.courses_json), profile: { grade: Number(row.current_year) }, revision: Number(row.revision) }
      : { courses: [], profile: { grade: 1 }, revision: 0 };
  }

  async function write(userId, state) {
    // 최초 저장 및 기존 사용자 마이그레이션 모두 과목 목록의 현재 내용을 보존합니다.
    await db.query('INSERT INTO user_courses(user_id) VALUES (?) ON CONFLICT(user_id) DO NOTHING', [userId]);
    // 다른 탭의 저장 내용을 덮어쓰지 않도록 SQL 조건으로 버전을 비교합니다.
    const updated = await db.query(`UPDATE user_courses
      SET courses_json = ?, current_year = ?, revision = revision + 1, updated_at = CURRENT_TIMESTAMP
      WHERE user_id = ? AND revision = ? RETURNING revision`,
    [JSON.stringify(state.courses), state.profile.grade, userId, state.revision]);
    if (!updated.changes) throw fail(409, '다른 화면에서 데이터가 변경되었습니다. 새로고침한 뒤 다시 시도해 주세요.');
    return { ...state, revision: Number(updated.rows[0].revision) };
  }
  return { read, write };
}
