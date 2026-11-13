import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addCourse, updateCourse, removeCourse } from '../js/grades/grades.js';
import { launch } from './http-helper.js';

const origin = 'http://localhost:3000';
const password = 'password-for-tests-2026';
const cookieOf = response => response.headers.get('set-cookie').split(';')[0];

// ZIP의 과목 저장 시나리오를 현재의 계정별 학사 API와 화면용 과목 함수로 검증합니다.
test('course edits persist per account; failed saves retain data and deleting all courses stays empty', async () => {
  const service = await launch(':memory:');
  try {
    async function signup(name, email) {
      const response = await service.request('/api/auth/signup', { name, email, password });
      assert.equal(response.status, 201);
      return { cookie: cookieOf(response), id: (await response.json()).user.id };
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
