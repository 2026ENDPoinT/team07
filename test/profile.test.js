import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, unlinkSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { hashPassword } from '../server/password.js';
import { launch } from './http-helper.js';
import { verifyProfileFlow } from './profile-helper.js';

test('profile updates validate both passwords, reject duplicates, isolate accounts and persist after restart', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'team07-profile-'));
  const path = join(folder, 'auth.db');
  let service;
  try {
    // 새 학과 컬럼이 없는 실제 구형 계정도 마이페이지를 사용할 수 있어야 합니다.
    const legacy = new DatabaseSync(path);
    legacy.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL, password_hash TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
    legacy.prepare('INSERT INTO users(email, name, password_hash) VALUES (?, ?, ?)')
      .run('legacy@example.com', '기존 회원', await hashPassword('legacy-test-password-2026'));
    legacy.close();
    service = await launch(path);
    const login = await service.request('/api/auth/login', { email: 'legacy@example.com', password: 'legacy-test-password-2026' });
    assert.equal(login.status, 200);
    const legacyUser = (await login.json()).user;
    assert.equal(legacyUser.department, '');
    assert.equal(legacyUser.doubleMajor, '');
    assert.equal(legacyUser.minor, '');
    const expected = await verifyProfileFlow(service);
    await service.close();
    service = await launch(path);
    const relogin = await service.request('/api/auth/login', { email: expected.email, password: 'UpdatedTest2026!' });
    assert.equal(relogin.status, 200);
    assert.deepEqual((await relogin.json()).user, expected);
    for (const path of ['/mypage.html', '/css/mypage.css', '/js/mypage.js']) {
      assert.equal((await service.request(path)).status, 200);
    }
    for (const path of ['/index.html', '/grade-analysis.html', '/calendar.html']) {
      assert.match(await (await service.request(path)).text(), /href="\/mypage.html"/);
    }
  } finally {
    if (service) await service.close();
    for (const suffix of ['', '-wal', '-shm']) if (existsSync(path + suffix)) unlinkSync(path + suffix);
    rmdirSync(folder);
  }
});
