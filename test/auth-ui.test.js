import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { getPasswordErrors, PASSWORD_MIN_LENGTH, PASSWORD_MAX_LENGTH } from '../public/js/auth/password-policy.js';

const source = readFileSync(new URL('../public/js/auth/login.js', import.meta.url), 'utf8')
  .replace(/^import .*;\r?\n/gm, '');

async function authScreen({ signup = true, fail = false, password = 'Welcome2026!', confirm = password, submit = true } = {}) {
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, {
      value: '', dataset: {}, listeners: {},
      addEventListener(type, listener) { this.listeners[type] = listener; },
      setCustomValidity(text) { this.validationMessage = text; },
      setAttribute(name, value) { this[name] = value; }, reportValidity() {}, focus() {},
      reset() {
        for (const id of ['name', 'email', 'password', 'confirm']) element(id).value = '';
      }
    });
    return elements.get(id);
  };
  const events = [];
  const requests = [];
  const user = { id: 1, name: '새 사용자', email: 'new@example.com' };
  await runInNewContext(`(async () => { ${source} })()`, {
    document: { getElementById: element },
    window: {
      alert: text => events.push(['alert', text]),
      location: { replace: path => events.push(['replace', path]) }
    },
    getPasswordErrors, PASSWORD_MIN_LENGTH, PASSWORD_MAX_LENGTH,
    async authRequest(path, body) {
      requests.push({ path, body });
      if (path === 'me') throw Object.assign(new Error('로그인이 필요합니다.'), { status: 401 });
      if (fail) throw new Error('이 이메일로 가입할 수 없습니다.');
      return { user };
    }
  });
  if (signup) element('switch-mode').listeners.click();
  element('name').value = user.name;
  element('email').value = user.email;
  element('password').value = password;
  element('confirm').value = confirm;
  if (submit) await element('auth-form').listeners.submit({ preventDefault() {} });
  return { events, requests, element };
}

test('signup welcomes the user before opening login, clears inputs, and makes no login request', async () => {
  const screen = await authScreen();
  assert.deepEqual(screen.requests.map(request => request.path), ['me', 'signup']);
  assert.deepEqual(screen.events, [
    ['alert', '새 사용자님, ENDPoinT 가입을 환영합니다! 로그인해 주세요.'],
    ['replace', '/login.html']
  ]);
  for (const id of ['name', 'email', 'password', 'confirm']) assert.equal(screen.element(id).value, '');
});

test('every auth password field updates only its missing conditions and clears corrected feedback', async () => {
  const { element, requests } = await authScreen({ password: 'abcdef1!', confirm: 'abcdef1!', submit: false });
  element('password').listeners.input();
  element('confirm').listeners.input();
  for (const id of ['password-hint', 'confirm-hint']) {
    assert.equal(element(id).textContent, '영문 대문자를 1개 이상 포함해 주세요.');
  }
  element('password').value = 'Abcdef1!';
  element('password').listeners.input();
  assert.equal(element('password-hint').textContent, '');
  assert.match(element('confirm-hint').textContent, /대문자.*일치하지 않습니다/);
  element('confirm').value = 'Abcdef2!';
  element('confirm').listeners.input();
  assert.equal(element('confirm-hint').textContent, '비밀번호 확인이 일치하지 않습니다.');
  await element('auth-form').listeners.submit({ preventDefault() {} });
  assert.deepEqual(requests.map(request => request.path), ['me']);
  element('confirm').value = 'Abcdef1!';
  element('confirm').listeners.input();
  assert.equal(element('confirm-hint').textContent, '');
  assert.equal(element('confirm').validationMessage, '');
  assert.equal(element('message').textContent, '');
  element('switch-mode').listeners.click();
  for (const id of ['password-hint', 'confirm-hint']) assert.equal(element(id).textContent, '');
});

test('login gives condition feedback while continuing to accept legacy passwords', async () => {
  const { element, events, requests } = await authScreen({ signup: false, password: 'legacy-password-2026', submit: false });
  element('password').listeners.input();
  assert.equal(element('password-hint').textContent, getPasswordErrors('legacy-password-2026').join(' '));
  assert.equal(element('password').validationMessage, '');
  await element('auth-form').listeners.submit({ preventDefault() {} });
  assert.deepEqual(requests.map(request => request.path), ['me', 'login']);
  assert.deepEqual(events, [['replace', '/index.html']]);
});

test('explicit login still opens the dashboard without a signup popup', async () => {
  const screen = await authScreen({ signup: false });
  assert.deepEqual(screen.requests.map(request => request.path), ['me', 'login']);
  assert.deepEqual(screen.events, [['replace', '/index.html']]);
});

test('failed signup stays on the form without a welcome popup or redirect', async () => {
  const screen = await authScreen({ fail: true });
  assert.deepEqual(screen.events, []);
  assert.equal(screen.element('message').textContent, '이 이메일로 가입할 수 없습니다.');
  assert.equal(screen.element('password').value, 'Welcome2026!');
  assert.equal(screen.element('submit').disabled, false);
});
