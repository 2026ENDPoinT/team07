import assert from 'node:assert/strict';

const password = 'original-test-password-2026';
const nextPassword = 'updated-test-password-2026';
const origin = 'http://localhost:3000';
const cookieOf = response => response.headers.get('set-cookie').split(';')[0];

// SQLite와 PostgreSQL에서 동일한 민감정보 재인증·세션 폐기 규칙을 검증합니다.
export async function verifyProfileFlow(service) {
  const { request } = service;
  const initial = { name: '기존 이름', email: 'profile@example.com', password };
  const signup = await request('/api/auth/signup', initial);
  assert.equal(signup.status, 201);
  const user = (await signup.json()).user;
  let cookie = cookieOf(signup);
  const otherSignup = await request('/api/auth/signup', { name: '다른 사용자', email: 'other@example.com', password });
  const otherCookie = cookieOf(otherSignup);
  const other = (await otherSignup.json()).user;
  const fields = { name: ' 새 이름 ', email: initial.email, department: ' 컴퓨터공학과 ',
    doubleMajor: ' 경영학과 ', minor: ' 수학과 ' };
  const update = (body, options = {}) => request('/api/auth/profile', body, cookie, origin,
    { headers: { 'X-Account-Id': String(user.id) }, ...options });

  assert.equal((await request('/api/auth/profile', fields)).status, 401);
  assert.equal((await request('/api/auth/profile', fields, cookie)).status, 403);
  assert.equal((await request('/api/auth/profile', fields, cookie, 'https://evil.example')).status, 403);
  assert.equal((await update(fields, { headers: { 'X-Account-Id': String(other.id) } })).status, 403);
  const before = (await (await request('/api/auth/me', undefined, cookie)).json()).user;
  assert.deepEqual({ ...before, department: '', doubleMajor: '', minor: '' }, before);

  for (const body of [null, [], {}, { ...fields, name: ' ' }, { ...fields, email: 'invalid' },
    { ...fields, department: 'x'.repeat(101) }, { ...fields, department: null }, { ...fields, id: other.id },
    { ...fields, doubleMajor: 'x'.repeat(101) }, { ...fields, minor: 'x'.repeat(101) },
    { ...fields, doubleMajor: true }, { ...fields, minor: {} }, { ...fields, doubleMajor: null },
    { ...fields, password: nextPassword }, { ...fields, passwordConfirm: nextPassword },
    { ...fields, password: nextPassword, passwordConfirm: 'different-test-password' },
    { ...fields, password: 'short', passwordConfirm: 'short' },
    { ...fields, password: 'x'.repeat(129), passwordConfirm: 'x'.repeat(129) },
    { ...fields, password: null }, { ...fields, password: [], passwordConfirm: [] },
    { ...fields, currentPassword: null }]) {
    assert.equal((await update(body)).status, 400, JSON.stringify(body));
    assert.deepEqual((await (await request('/api/auth/me', undefined, cookie)).json()).user, before);
  }

  const table = service.db.type === 'postgres' ? 'app_private.users' : 'users';
  const hashBefore = (await service.db.query(`SELECT password_hash FROM ${table} WHERE id = $1`, [user.id])).rows[0].password_hash;
  assert.equal((await update({ ...fields, email: other.email, currentPassword: password })).status, 409);
  assert.equal((await update({ ...fields, email: 'new@example.com' })).status, 400);
  assert.equal((await update({ ...fields, email: 'new@example.com', currentPassword: 'wrong-long-password-2026' })).status, 400);
  assert.equal((await update({ ...fields, password: nextPassword, passwordConfirm: nextPassword })).status, 400);
  assert.equal((await update({ ...fields, password: nextPassword, passwordConfirm: nextPassword,
    currentPassword: 'wrong-long-password-2026' })).status, 400);
  assert.equal((await update({ ...fields, password, passwordConfirm: password, currentPassword: password })).status, 400);
  assert.equal((await service.db.query(`SELECT password_hash FROM ${table} WHERE id = $1`, [user.id])).rows[0].password_hash, hashBefore);
  assert.deepEqual((await (await request('/api/auth/me', undefined, cookie)).json()).user, before);

  // 일반 회원정보 수정에는 비밀번호가 필요하지 않으며 기존 로그인 세션이 유지됩니다.
  const saved = await update({ ...fields, password: '', passwordConfirm: '' });
  assert.equal(saved.status, 200);
  let expected = { id: user.id, name: '새 이름', email: initial.email, department: '컴퓨터공학과',
    doubleMajor: '경영학과', minor: '수학과' };
  assert.deepEqual(await saved.json(), { user: expected });
  assert.deepEqual((await (await request('/api/auth/me', undefined, cookie)).json()).user, expected);
  assert.deepEqual((await (await request('/api/auth/me', undefined, otherCookie)).json()).user, other);

  // 복수전공·부전공을 생략할 때 기존 정보를 유지하며, 개별 해제도 가능합니다.
  const oldFields = { name: expected.name, email: expected.email, department: expected.department };
  assert.deepEqual(await (await update(oldFields)).json(), { user: expected });
  assert.deepEqual(await (await update({ ...oldFields, doubleMajor: '' })).json(),
    { user: { ...expected, doubleMajor: '' } });
  assert.deepEqual(await (await update({ ...oldFields, doubleMajor: '경영학과', minor: '' })).json(),
    { user: { ...expected, minor: '' } });
  assert.deepEqual(await (await update({ ...oldFields, doubleMajor: '', minor: '' })).json(),
    { user: { ...expected, doubleMajor: '', minor: '' } });
  assert.deepEqual(await (await update(fields)).json(), { user: expected });

  // 비밀번호 변경은 현재 암호 확인 후 가능하며 모든 기기의 세션을 폐기합니다.
  const extraLogin = await request('/api/auth/login', { email: initial.email, password });
  assert.equal(extraLogin.status, 200);
  const extraCookie = cookieOf(extraLogin);
  const changed = await update({ ...fields, password: nextPassword, passwordConfirm: nextPassword,
    currentPassword: password });
  assert.equal(changed.status, 200);
  assert.deepEqual(await changed.json(), { user: expected, reauthenticate: true });
  assert.match(changed.headers.get('set-cookie'), /Max-Age=0/);
  assert.equal((await request('/api/auth/me', undefined, cookie)).status, 401);
  assert.equal((await request('/api/auth/me', undefined, extraCookie)).status, 401);
  assert.equal((await request('/api/auth/login', { email: initial.email, password })).status, 401);
  const relogin = await request('/api/auth/login', { email: initial.email, password: nextPassword });
  assert.equal(relogin.status, 200);
  cookie = cookieOf(relogin);
  assert.notEqual((await service.db.query(`SELECT password_hash FROM ${table} WHERE id = $1`, [user.id])).rows[0].password_hash, hashBefore);

  // 이메일을 바꿔도 현재 비밀번호를 확인하고 모든 세션을 만료시킵니다.
  const emailChanged = await update({ ...fields, email: ' NEW@Example.com ', currentPassword: nextPassword });
  assert.equal(emailChanged.status, 200);
  expected = { ...expected, email: 'new@example.com' };
  assert.deepEqual(await emailChanged.json(), { user: expected, reauthenticate: true });
  assert.equal((await request('/api/auth/me', undefined, cookie)).status, 401);
  assert.equal((await request('/api/auth/login', { email: initial.email, password: nextPassword })).status, 401);
  assert.equal((await request('/api/auth/login', { email: expected.email, password: nextPassword })).status, 200);
  assert.deepEqual((await (await request('/api/auth/me', undefined, otherCookie)).json()).user, other);
  assert.equal((await update(fields)).status, 401);
  return expected;
}
