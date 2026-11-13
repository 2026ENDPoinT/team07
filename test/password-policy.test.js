import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isValidPassword, getPasswordErrors } from '../public/js/auth/password-policy.js';
import { launch } from './http-helper.js';

test('password policy accepts 8–20 characters and each requested special character', () => {
  for (const special of "`~!@#$%^&*|'\";:₩\\?") {
    assert.equal(isValidPassword(`Abcdef1${special}`), true, special);
  }
  assert.equal(isValidPassword('Ab1!' + 'a'.repeat(16)), true);
  for (const value of [null, undefined, 12345678, [], '', 'Abcde1!', 'Ab1!' + 'a'.repeat(17),
    'abcdef1!', 'ABCDEF1!', 'Abcdefg!', 'Abcdef12']) {
    assert.equal(isValidPassword(value), false, JSON.stringify(value));
  }
  for (const forbidden of [' ', '\t', '\n', '\r', '_', '-', '+', '=', '/', '.', ',', '(', ')', '[', ']', '{', '}', '<', '>', '한', 'é', '😀']) {
    assert.equal(isValidPassword(`Abcdef1!${forbidden}`), false, JSON.stringify(forbidden));
  }
});

test('signup enforces password policy and boundary passwords can log in unchanged', async () => {
  const service = await launch(':memory:');
  try {
    const email = 'policy@example.com';
    for (const password of ['Abcde1!', 'Ab1!' + 'a'.repeat(17), 'abcdef1!', 'ABCDEF1!',
      'Abcdefg!', 'Abcdef12', 'Abcdef1! ', 'Abcdef1!한', 'Abcdef1!_', 'Abcdef1!\n']) {
      const response = await service.request('/api/auth/signup', { name: '규칙 검사', email, password });
      assert.equal(response.status, 400, password);
      assert.equal((await response.json()).message, getPasswordErrors(password).join(' '));
    }
    assert.equal(service.db.prepare('SELECT count(*) AS total FROM users').get().total, 0);
    for (const [index, password] of ['Abcdef1!', 'Ab1!' + 'a'.repeat(16), 'Abcdef1₩', 'Abcdef1\\'].entries()) {
      const email = `boundary${index}@example.com`;
      assert.equal((await service.request('/api/auth/signup', { name: '경계 검사', email, password })).status, 201);
      assert.equal((await service.request('/api/auth/login', { email, password })).status, 200);
    }
    const module = await service.request('/js/auth/password-policy.js');
    assert.equal(module.status, 200);
    assert.match(module.headers.get('content-type'), /text\/javascript/);
  } finally { await service.close(); }
});

test('password feedback contains only unmet conditions and never echoes the password', () => {
  for (const [value, expected] of [
    ['abcdef1!', ['영문 대문자를 1개 이상 포함해 주세요.']],
    ['ABCDEF1!', ['영문 소문자를 1개 이상 포함해 주세요.']],
    ['Abcdefg!', ['숫자를 1개 이상 포함해 주세요.']],
    ['Abcde1!', ['8자 이상 입력해 주세요.']],
    ['Ab1!' + 'a'.repeat(17), ['20자 이하로 입력해 주세요.']],
    ['Abcdef1! ', ['공백을 제거해 주세요.']],
    ['Abcdef1!한', ['영문·숫자·허용 특수문자 외의 문자를 제거해 주세요.']],
    ['Abcdef1!', []]
  ]) assert.deepEqual(getPasswordErrors(value), expected);
  const missingSpecial = getPasswordErrors('Abcdef12');
  assert.equal(missingSpecial.length, 1);
  assert.match(missingSpecial[0], /^특수문자를 1개 이상/);
  assert.deepEqual(getPasswordErrors('abcdefgh'), [
    '영문 대문자를 1개 이상 포함해 주세요.', '숫자를 1개 이상 포함해 주세요.',
    missingSpecial[0]
  ]);
});
