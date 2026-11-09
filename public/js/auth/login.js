import { authRequest } from './api.js';

const $ = id => document.getElementById(id);
let signup = false;
function message(text, error = false) {
  $('message').textContent = text;
  $('message').dataset.error = String(error);
}
function busy(value) {
  $('submit').disabled = value;
  $('switch-mode').disabled = value;
  $('logout').disabled = value;
  $('submit').textContent = signup ? '회원가입' : '로그인';
}
function showUser(user) {
  $('guest').hidden = Boolean(user);
  $('account').hidden = !user;
  $('welcome').textContent = user ? `${user.name}님, 환영합니다. (${user.email})` : '';
  $('auth-form').reset();
}
$('switch-mode').addEventListener('click', () => {
  signup = !signup;
  for (const [field, input] of [['name-field', 'name'], ['confirm-field', 'confirm']]) {
    $(field).hidden = !signup;
    $(input).disabled = !signup;
    $(input).required = signup;
  }
  $('password').autocomplete = signup ? 'new-password' : 'current-password';
  $('password').value = '';
  $('confirm').value = '';
  $('title').textContent = signup ? '회원가입' : '로그인';
  $('description').textContent = signup ? '이름과 이메일로 계정을 만들어 주세요.' : '계정으로 로그인해 주세요.';
  $('switch-mode').textContent = signup ? '이미 계정이 있나요? 로그인' : '계정이 없나요? 회원가입';
  busy(false);
  message('');
});
$('auth-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (signup && $('password').value !== $('confirm').value) {
    message('비밀번호 확인이 일치하지 않습니다.', true);
    $('confirm').focus();
    return;
  }
  busy(true);
  message('처리 중입니다…');
  try {
    const { user } = await authRequest(signup ? 'signup' : 'login', {
      email: $('email').value, password: $('password').value,
      ...(signup ? { name: $('name').value } : {})
    });
    showUser(user);
    message(signup ? '회원가입과 로그인이 완료되었습니다.' : '로그인되었습니다.');
    $('logout').focus();
  } catch (error) { message(error.message, true); }
  finally { busy(false); }
});
$('logout').addEventListener('click', async () => {
  busy(true);
  try {
    await authRequest('logout', {});
    showUser(null);
    message('로그아웃되었습니다.');
    $('email').focus();
  } catch (error) { message(error.message, true); }
  finally { busy(false); }
});
busy(true);
try {
  const { user } = await authRequest('me');
  showUser(user);
} catch (error) {
  if (error.status !== 401) message('서버 연결을 확인한 후 새로고침해 주세요.', true);
} finally { busy(false); }
