import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { getPasswordErrors } from '../public/js/auth/password-policy.js';

// 실제 화면 스크립트를 실행해 저장 결과에 따른 팝업과 이동을 확인합니다.
const source = readFileSync(new URL('../public/mypage.js', import.meta.url), 'utf8')
  .replace(/^import .*;\r?\n/gm, '');
async function profileScreen({ password = '', confirm = password, email = 'user@example.com', fail = false, submit = true } = {}) {
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, {
      value: '', checked: false, dataset: {}, listeners: {},
      setAttribute(name, value) { this[name] = value; },
      setCustomValidity(text) { this.validationMessage = text; },
      reportValidity() { return [...elements.values()].every(input => !input.validationMessage); },
      addEventListener(type, listener) { this.listeners[type] = listener; }
    });
    return elements.get(id);
  };
  const user = { id: 1, name: '사용자', email: 'user@example.com', department: '', doubleMajor: '', minor: '' };
  const alerts = [];
  const destinations = [];
  const requests = [];
  runInNewContext(source, {
    document: { getElementById: element },
    window: {
      alert: text => alerts.push(text),
      location: {
        replace: path => destinations.push(['replace', path]),
        assign: path => destinations.push(['assign', path])
      }
    },
    getPasswordErrors,
    async authRequest(path, body) {
      requests.push(path);
      if (path === 'me') return { user };
      if (fail) throw Object.assign(new Error('저장에 실패했습니다.'), { status: 409 });
      return { user: { ...user, email: body.email } };
    }
  });
  await new Promise(resolve => setImmediate(resolve));
  element('email').value = email;
  element('password').value = password;
  element('password-confirm').value = confirm;
  if (submit) await element('profile-form').listeners.submit({ preventDefault() {} });
  return { alerts, destinations, requests, element };
}

test('password change announces logout and opens login; other profile edits keep the dashboard flow', async () => {
  const changed = await profileScreen({ password: 'UpdatedTest2026!' });
  assert.deepEqual(changed.requests, ['me', 'profile']);
  assert.deepEqual(changed.alerts, ['비밀번호가 변경되어 로그아웃되었습니다. 변경된 비밀번호로 다시 로그인해 주세요.']);
  assert.deepEqual(changed.destinations, [['replace', '/login.html']]);

  const unchanged = await profileScreen();
  assert.deepEqual(unchanged.alerts, ['회원정보가 변경되었습니다.']);
  assert.deepEqual(unchanged.destinations, [['assign', '/index.html']]);

  const emailOnly = await profileScreen({ email: 'new@example.com' });
  assert.match(emailOnly.alerts[0], /다음 로그인부터 변경된 로그인 정보/);
  assert.deepEqual(emailOnly.destinations, [['assign', '/index.html']]);

  const failed = await profileScreen({ password: 'UpdatedTest2026!', fail: true });
  assert.deepEqual(failed.alerts, []);
  assert.deepEqual(failed.destinations, []);
  assert.equal(failed.element('profile-message').textContent, '저장에 실패했습니다.');
});

test('both profile password fields show only their missing conditions and reset when cleared', async () => {
  const { element, requests } = await profileScreen({ password: 'abcdef1!', submit: false });
  element('password').listeners.input();
  element('password-confirm').listeners.input();
  assert.equal(element('password-hint').textContent, '영문 대문자를 1개 이상 포함해 주세요.');
  assert.equal(element('password-match').textContent, '영문 대문자를 1개 이상 포함해 주세요.');
  await element('profile-form').listeners.submit({ preventDefault() {} });
  assert.deepEqual(requests, ['me']);
  element('password').value = 'Abcdef1!';
  element('password').listeners.input();
  assert.equal(element('password-hint').textContent, '');
  assert.match(element('password-match').textContent, /대문자.*일치하지 않습니다/);
  element('password-confirm').value = 'Abcdef1!';
  element('password-confirm').listeners.input();
  assert.equal(element('password-match').textContent, '');
  element('password-confirm').value = '';
  element('password-confirm').listeners.input();
  assert.match(element('password-match').textContent, /8자 이상.*일치하지 않습니다/);
  element('password').value = '';
  element('password').listeners.input();
  for (const id of ['password-hint', 'password-match']) assert.equal(element(id).textContent, '');
  for (const id of ['password', 'password-confirm']) assert.equal(element(id).validationMessage, '');
});
