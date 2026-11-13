import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword } from '../server/password.js';
import { launch } from './http-helper.js';
import {
  PASSWORD_MIN_LENGTH, PASSWORD_MAX_LENGTH, PASSWORD_SPECIAL_CHARACTERS,
  getPasswordErrors, isValidPassword
} from '../public/js/auth/password-policy.js';

const strong = 'Aa1!abcd'; // 최소 8자
const cookieOf = response => response.headers.get('set-cookie').split(';')[0];

test('shared password policy: length, required classes and full allowlist', () => {
  assert.equal(PASSWORD_MIN_LENGTH, 8);
  assert.equal(PASSWORD_MAX_LENGTH, 20);
  assert.equal(isValidPassword(strong), true);
  assert.equal(isValidPassword(`Aa1!${'a'.repeat(16)}`), true); // 20 chars
  assert.ok(getPasswordErrors('Aa1!abc').some(e => e.includes('8자 이상')));
  assert.ok(getPasswordErrors(`Aa1!${'a'.repeat(17)}`).some(e => e.includes('20자 이하')));
  assert.ok(getPasswordErrors('aa1!abcd').some(e => e.includes('대문자')));
  assert.ok(getPasswordErrors('AA1!ABCD').some(e => e.includes('소문자')));
  assert.ok(getPasswordErrors('Aa!!abcd').some(e => e.includes('숫자')));
  assert.ok(getPasswordErrors('Aa12abcd').some(e => e.includes('특수문자')));
  assert.ok(getPasswordErrors('Aa1!a bc').some(e => e.includes('공백')));
  assert.ok(getPasswordErrors('Aa1!\tabcd').some(e => e.includes('공백')));
  assert.ok(getPasswordErrors('Aa1!한글abc').some(e => e.includes('외의 문자')));
  assert.ok(getPasswordErrors('Aa1!abc-').some(e => e.includes('외의 문자')));
  assert.ok(getPasswordErrors(null).some(e => e.includes('문자열')));
  for (const special of PASSWORD_SPECIAL_CHARACTERS) {
    assert.equal(isValidPassword(`Aa1${special}abcd`), true, `allowed special: ${special}`);
  }
  const secret = 'NoSpace1!Secret';
  assert.deepEqual(getPasswordErrors(secret), []);
  assert.ok(getPasswordErrors('bad').every(e => !e.includes('bad')));
});

test('server rejects weak signup and password updates; leaves legacy login functional', async () => {
  const service = await launch(':memory:');
  try {
    const bad = await service.request('/api/auth/signup', {
      name: '가입자', email: 'bad@example.com', password: 'NoSpecial1abc'
    });
    assert.equal(bad.status, 400);
    const badBody = await bad.json();
    assert.match(badBody.message, /특수문자/);
    assert.doesNotMatch(JSON.stringify(badBody), /NoSpecial1abc/);
    assert.equal((await service.db.query('SELECT count(*) AS total FROM users')).rows[0].total, 0);

    const signup = await service.request('/api/auth/signup', {
      name: '가입자', email: 'ok@example.com', password: strong
    });
    assert.equal(signup.status, 201);
    const user = (await signup.json()).user;
    const cookie = cookieOf(signup);
    const fields = { name: user.name, email: user.email, department: '',
      currentPassword: strong, passwordConfirm: 'Ab1!aaaaa' };
    const invalidUpdate = await service.request('/api/auth/profile', {
      ...fields, password: 'Ab1!aaaaa'.replace('!', '-')
    }, cookie, undefined, { headers: { 'X-Account-Id': String(user.id) } });
    assert.equal(invalidUpdate.status, 400);
    assert.equal((await service.request('/api/auth/login', {
      email: user.email, password: strong
    })).status, 200);

    const invalidNoChange = await service.request('/api/auth/profile', {
      ...fields, password: 'Aa1!a-bcd', passwordConfirm: 'Aa1!a-bcd'
    }, cookie, undefined, { headers: { 'X-Account-Id': String(user.id) } });
    assert.equal(invalidNoChange.status, 400);
    const rejected = await invalidNoChange.json();
    assert.match(rejected.message, /허용 특수문자 외의 문자/);

    const legacyPassword = 'legacy-simple-password-without-required-classes-2026';
    const legacyHash = await hashPassword(legacyPassword);
    await service.db.query('INSERT INTO users(email, name, password_hash) VALUES ($1, $2, $3)',
      ['legacy@example.com', '기존 회원', legacyHash]);
    assert.equal((await service.request('/api/auth/login', {
      email: 'legacy@example.com', password: legacyPassword
    })).status, 200);
    assert.equal((await service.request('/api/auth/signup', {
      name: '신규', email: 'legacy-style@example.com', password: legacyPassword
    })).status, 400);
  } finally {
    await service.close();
  }
});
