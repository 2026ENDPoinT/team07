import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addCourse, updateCourse, removeCourse } from '../js/grades/grades.js';
import { launch } from './http-helper.js';
import { calculateGraduationCredits } from '../js/credits/graduation.js';
import { calculateCumulativeGPA } from '../js/grades/gpa.js';

const origin = 'http://localhost:3000';
const password = 'CourseTest2026!';
const cookieOf = response => response.headers.get('set-cookie').split(';')[0];

test('double-major and minor courses retain their categories after profile changes and count toward total credits', async () => {
  const service = await launch(':memory:');
  try {
    const signup = await service.request('/api/auth/signup', { name: '전공 테스트', email: 'majors@example.com', password });
    const cookie = cookieOf(await service.request('/api/auth/login', { email: 'majors@example.com', password }));
    const user = (await signup.json()).user;
    const profile = { name: user.name, email: user.email, department: '컴퓨터공학과', doubleMajor: '경영학과', minor: '수학과' };
    const headers = { 'X-Account-Id': String(user.id) };
    assert.equal((await service.request('/api/auth/profile', profile, cookie, origin, { headers })).status, 200);
    let courses = [];
    for (const [category, courseName] of [['double_major', '경영학원론'], ['minor', '선형대수']]) {
      courses = addCourse(courses, { courseName, category, credits: 3, grade: 'A0', semester: '2026-1' });
    }
    const save = state => service.request('/api/academic', state, cookie, origin, { method: 'PUT', headers });
    const first = await save({ courses, profile: { grade: 2 }, revision: 0 });
    assert.equal(first.status, 200);
    let state = await first.json();
    assert.deepEqual(state.courses.map(course => course.category), ['double_major', 'minor']);
    assert.equal(calculateCumulativeGPA(state.courses).gpa, 4);
    assert.deepEqual(calculateGraduationCredits(state.courses, { graduation: { totalCredits: 130, majorCredits: 70 } }),
      { totalRemainingCredits: 124, majorRemainingCredits: 70 });
    // 전공 선택을 해제해도 기존 과목을 수정·저장할 수 있어야 합니다.
    assert.equal((await service.request('/api/auth/profile', { ...profile, doubleMajor: '', minor: '' }, cookie, origin, { headers })).status, 200);
    const edited = await save({ ...state, courses: updateCourse(state.courses, state.courses[0].id, { courseName: '경영학원론 수정' }) });
    assert.equal(edited.status, 200);
    state = await edited.json();
    const reloaded = await service.request('/api/academic', undefined, cookie, origin, { headers });
    assert.deepEqual(await reloaded.json(), state);
    assert.equal(state.courses[0].category, 'double_major');
    assert.equal(state.courses[0].courseName, '경영학원론 수정');
  } finally { await service.close(); }
});

// ZIP의 과목 저장 시나리오를 현재의 계정별 학사 API와 화면용 과목 함수로 검증합니다.
test('course edits persist per account; failed saves retain data and deleting all courses stays empty', async () => {
  const service = await launch(':memory:');
  try {
    async function signup(name, email) {
      const response = await service.request('/api/auth/signup', { name, email, password });
      assert.equal(response.status, 201);
      const login = await service.request('/api/auth/login', { email, password });
      assert.equal(login.status, 200);
      return { cookie: cookieOf(login), id: (await response.json()).user.id };
    }
    const first = await signup('A', 'a@example.com');
    const second = await signup('B', 'b@example.com');
    const request = (account, state) => service.request('/api/academic', state, account.cookie, origin, {
      method: state === undefined ? 'GET' : 'PUT',
      headers: { 'X-Account-Id': String(account.id) }
    });
    async function load(account) {
      const response = await request(account);
      assert.equal(response.status, 200);
      return response.json();
    }
    async function save(account, state) {
      const response = await request(account, state);
      assert.equal(response.status, 200);
      const saved = await response.json();
      assert.equal(saved.revision, state.revision + 1);
      assert.deepEqual(await load(account), saved);
      return saved;
    }

    const initial = { courses: [], profile: { grade: 1 }, revision: 0 };
    assert.deepEqual(await load(first), initial);
    assert.deepEqual(await load(second), initial);
    assert.equal((await service.request('/api/academic')).status, 401);

    let courses = addCourse([], { courseName: '자료구조', credits: '3', grade: 'A+',
      semester: '2026-1', status: 'completed', category: 'major', isRetake: false });
    courses = addCourse(courses, { courseName: '진로 세미나', credits: '2',
      semester: '2026-2', status: 'in_progress', category: 'general', isRetake: false });
    let state = await save(first, { ...initial, courses, profile: { grade: 3 } });
    assert.equal(state.courses[0].gradePoint, 4.5);
    assert.equal(state.courses[1].gradePoint, null);
    assert.deepEqual(await load(second), initial);

    courses = updateCourse(state.courses, state.courses[0].id, { grade: 'F' });
    state = await save(first, { ...state, courses });
    assert.equal(state.courses[0].gradePoint, 0);
    assert.equal(state.profile.grade, 3);

    // 이전 화면의 저장과 잘못된 입력이 이미 저장된 과목·학년을 덮어쓰면 안 됩니다.
    assert.equal((await request(first, { ...state, revision: 0 })).status, 409);
    assert.equal((await request(first, { ...state, courses: [{ ...state.courses[0], credits: 31 }] })).status, 400);
    assert.deepEqual(await load(first), state);

    // 두 번째 계정도 저장한 뒤 첫 계정에서 전체 삭제해도 서로 영향을 주지 않습니다.
    const secondState = await save(second, { ...initial, courses: [state.courses[0]], profile: { grade: 2 } });
    courses = state.courses;
    for (const course of state.courses) courses = removeCourse(courses, course.id);
    state = await save(first, { ...state, courses });
    assert.deepEqual(state.courses, []);
    assert.equal(state.profile.grade, 3);
    assert.deepEqual(await load(second), secondState);

    assert.equal((await service.request('/api/auth/logout', {}, first.cookie)).status, 200);
    const login = await service.request('/api/auth/login', { email: 'a@example.com', password });
    assert.equal(login.status, 200);
    assert.deepEqual(await load({ ...first, cookie: cookieOf(login) }), state);
  } finally {
    await service.close();
  }
});
