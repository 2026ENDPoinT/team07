import assert from 'node:assert/strict';

const password = 'original-test-password-2026';
const nextPassword = 'updated-test-password-2026';
const origin = 'http://localhost:3000';
const cookieOf = response => response.headers.get('set-cookie').split(';')[0];

// SQLite와 PostgreSQL에서 같은 HTTP 동작을 검증합니다.
export async function verifyProfileFlow(service) {
  const { request } = service;
  const initial = { name: '기존 이름', email: 'profile@example.com', password };
  const signup = await request('/api/auth/signup', initial);
  assert.equal(signup.status, 201);
  const user = (await signup.json()).user;
  const cookie = cookieOf(signup);
  const second = await request('/api/auth/signup', { name: '다른 사용자', email: 'other@example.com', password });
  const otherCookie = cookieOf(second);
  const other = (await second.json()).user;
  const fields = { name: ' 새 이름 ', email: ' NEW@Example.com ', department: ' 컴퓨터공학과 ',
    doubleMajor: ' 경영학과 ', minor: ' 수학과 ' };
  const update = (body, options = {}) => request('/api/auth/profile', body, cookie, origin,
    { headers: { 'X-Account-Id': String(user.id) }, ...options });

  assert.equal((await request('/api/auth/profile', fields)).status, 401);
  assert.equal((await request('/api/auth/profile', fields, cookie)).status, 403);
  assert.equal((await request('/api/auth/profile', fields, cookie, 'https://evil.example')).status, 403);
  assert.equal((await update(fields, { headers: { 'X-Account-Id': String(other.id) } })).status, 403);
  const before = (await (await request('/api/auth/me', undefined, cookie)).json()).user;
  assert.equal(before.department, '');
  assert.equal(before.doubleMajor, '');
  assert.equal(before.minor, '');

  for (const body of [null, [], {}, { ...fields, name: ' ' }, { ...fields, email: 'invalid' },
    { ...fields, department: 'x'.repeat(101) }, { ...fields, department: null }, { ...fields, id: other.id },
    { ...fields, doubleMajor: 'x'.repeat(101) }, { ...fields, minor: 'x'.repeat(101) },
    { ...fields, doubleMajor: true }, { ...fields, minor: {} }, { ...fields, doubleMajor: null },
    { ...fields, password: nextPassword }, { ...fields, passwordConfirm: nextPassword },
    { ...fields, password: nextPassword, passwordConfirm: 'different-test-password' },
    { ...fields, password: 'short', passwordConfirm: 'short' },
    { ...fields, password: 'x'.repeat(129), passwordConfirm: 'x'.repeat(129) },
    { ...fields, password: null }, { ...fields, password: [], passwordConfirm: [] }]) {
    assert.equal((await update(body)).status, 400, JSON.stringify(body));
    assert.deepEqual((await (await request('/api/auth/me', undefined, cookie)).json()).user, before);
  }
  const table = service.db.type === 'postgres' ? 'app_private.users' : 'users';
  const hashBefore = (await service.db.query(`SELECT password_hash FROM ${table} WHERE id = $1`, [user.id])).rows[0].password_hash;
  assert.equal((await update({ ...fields, email: other.email, password: nextPassword, passwordConfirm: nextPassword })).status, 409);
  assert.deepEqual((await (await request('/api/auth/me', undefined, cookie)).json()).user, before);
  assert.equal((await service.db.query(`SELECT password_hash FROM ${table} WHERE id = $1`, [user.id])).rows[0].password_hash, hashBefore);

  const saved = await update({ ...fields, password: '', passwordConfirm: '' });
  assert.equal(saved.status, 200);
  const expected = { id: user.id, name: '새 이름', email: 'new@example.com', department: '컴퓨터공학과',
    doubleMajor: '경영학과', minor: '수학과' };
  assert.deepEqual(await saved.json(), { user: expected });
  assert.deepEqual((await (await request('/api/auth/me', undefined, cookie)).json()).user, expected);
  assert.deepEqual((await (await request('/api/auth/me', undefined, otherCookie)).json()).user, other);
  assert.equal((await service.db.query(`SELECT password_hash FROM ${table} WHERE id = $1`, [user.id])).rows[0].password_hash, hashBefore);
  assert.equal((await request('/api/auth/login', { email: initial.email, password })).status, 401);
  assert.equal((await request('/api/auth/login', { email: expected.email, password })).status, 200);

  // 구형 화면이 새 필드를 생략해도 저장된 복수전공·부전공은 유지합니다.
  const oldFields = { name: expected.name, email: expected.email, department: expected.department };
  assert.deepEqual(await (await update(oldFields)).json(), { user: expected });
  // 한 항목의 해제는 다른 항목이나 주전공을 변경하지 않습니다.
  assert.deepEqual(await (await update({ ...oldFields, doubleMajor: '' })).json(),
    { user: { ...expected, doubleMajor: '' } });
  assert.deepEqual(await (await update({ ...oldFields, doubleMajor: '경영학과', minor: '' })).json(),
    { user: { ...expected, minor: '' } });
  assert.deepEqual(await (await update({ ...oldFields, doubleMajor: '', minor: '' })).json(),
    { user: { ...expected, doubleMajor: '', minor: '' } });
  assert.deepEqual(await (await update(fields)).json(), { user: expected });

  const changed = await update({ ...fields, password: nextPassword, passwordConfirm: nextPassword });
  assert.equal(changed.status, 200);
  assert.deepEqual(await changed.json(), { user: expected });
  assert.equal((await request('/api/auth/login', { email: expected.email, password })).status, 401);
  assert.equal((await request('/api/auth/login', { email: expected.email, password: nextPassword })).status, 200);
  assert.notEqual((await service.db.query(`SELECT password_hash FROM ${table} WHERE id = $1`, [user.id])).rows[0].password_hash, nextPassword);
  await request('/api/auth/logout', {}, cookie);
  assert.equal((await update(fields)).status, 401);
  return expected;
}
