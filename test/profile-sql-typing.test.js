import { test } from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './http-helper.js';

// PostgreSQL에서는 `$n IS NULL`에 타입 문맥이 없으면 42P18이 발생할 수 있습니다.
// 변경 전에는 SQLite 테스트만 통과하던 버그를 방지하기 위해 SQL 형태와 두 업데이트 경로를 검사합니다.
test('profile SQL explicitly types nullable original password hash and keeps profile/password updates working', async () => {
  const service = await launch(':memory:');
  const originalQuery = service.db.query;
  const checked = [];
  service.db.query = async (sql, params) => {
    if (/UPDATE\s+users\s+SET/i.test(sql)) {
      assert.match(sql, /CAST\(\$10 AS TEXT\) IS NULL OR password_hash = \$10/);
      assert.equal(params.length, 10);
      checked.push(params[9]);
    }
    return originalQuery(sql, params);
  };

  try {
    const originalPassword = 'Aa1!example';
    const newPassword = 'Bb2@nextpass';
    const signup = await service.request('/api/auth/signup', {
      name: 'SQL 검증 계정', email: 'sql-typing@example.com', password: originalPassword
    });
    assert.equal(signup.status, 201);
    const user = (await signup.json()).user;
    const cookie = signup.headers.get('set-cookie').split(';')[0];
    const headers = { 'X-Account-Id': String(user.id) };
    const body = { name: user.name, email: user.email, department: '컴퓨터공학과', doubleMajor: '', minor: '' };

    const ordinary = await service.request('/api/auth/profile', body, cookie, undefined, { headers });
    assert.equal(ordinary.status, 200, JSON.stringify(await ordinary.json()));
    assert.equal(checked[0], null);

    const change = await service.request('/api/auth/profile', {
      ...body, currentPassword: originalPassword, password: newPassword, passwordConfirm: newPassword
    }, cookie, undefined, { headers });
    assert.equal(change.status, 200, JSON.stringify(await change.json()));
    assert.equal((await change.json()).reauthenticate, true);
    assert.match(checked[1], /^scrypt\$/);
    assert.equal((await service.request('/api/auth/me', undefined, cookie)).status, 401);
    assert.equal((await service.request('/api/auth/login', {
      email: user.email, password: originalPassword
    })).status, 401);
    assert.equal((await service.request('/api/auth/login', {
      email: user.email, password: newPassword
    })).status, 200);
  } finally {
    await service.close();
  }
});
