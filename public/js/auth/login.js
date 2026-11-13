import { authRequest } from './api.js';
import { getPasswordErrors, PASSWORD_MIN_LENGTH, PASSWORD_MAX_LENGTH } from './password-policy.js';

const $ = id => document.getElementById(id);
let signup = false;

const touchedPasswords = new Set();
function validatePasswords() {
  let valid = true;
  for (const [id, hint] of [['password', 'password-hint'], ['confirm', 'confirm-hint']]) {
    const input = $(id);
    const active = id === 'password' || signup;
    const errors = active ? getPasswordErrors(input.value) : [];
    if (signup && id === 'confirm' && input.value !== $('password').value) {
      errors.push('비밀번호 확인이 일치하지 않습니다.');
    }
    const feedback = errors.join(' ');
    // 로그인에서는 이전 정책의 비밀번호도 허용하고 조건은 안내만 합니다.
    input.setCustomValidity(signup ? feedback : '');
    if (signup && errors.length) valid = false;
    const visible = active && (Boolean(input.value) || touchedPasswords.has(id));
    $(hint).textContent = visible ? feedback : '';
    $(hint).dataset.error = String(visible && errors.length > 0);
    input.setAttribute('aria-invalid', String(signup && visible && errors.length > 0));
  }
  return valid;
}
for (const id of ['password', 'confirm']) {
  for (const event of ['input', 'invalid']) $(id).addEventListener(event, () => {
    touchedPasswords.add(id);
    validatePasswords();
    if (event === 'input' && $('message').dataset.error === 'true') message('');
  });
}
// 안내 및 오류 메시지는 HTML로 해석하지 않고 텍스트로 표시합니다.
function message(text, error = false) {
  $('message').textContent = text;
  $('message').dataset.error = String(error);
}
// 요청 처리 중에는 버튼을 비활성화해 중복 요청을 줄입니다.
function busy(value) {
  $('submit').disabled = value;
  $('switch-mode').disabled = value;
  $('logout').disabled = value;
  $('submit').textContent = signup ? '회원가입' : '로그인';
}
// 로그인 상태에 따라 입력 폼과 사용자 화면을 전환하고 입력값을 비웁니다.
function showUser(user) {
  if (user) {
    window.location.replace('/index.html');
    return;
  }
  $('guest').hidden = Boolean(user);
  $('account').hidden = !user;
  $('welcome').textContent = user ? `${user.name}님, 환영합니다. (${user.email})` : '';
  $('auth-form').reset();
  touchedPasswords.clear();
  validatePasswords();
}
// 로그인과 회원가입 모드를 전환하며 필요한 입력 항목만 활성화합니다.
$('switch-mode').addEventListener('click', () => {
  signup = !signup;
  for (const [field, input] of [['name-field', 'name'], ['confirm-field', 'confirm']]) {
    $(field).hidden = !signup;
    $(input).disabled = !signup;
    $(input).required = signup;
  }
  $('password').autocomplete = signup ? 'new-password' : 'current-password';
  $('password').minLength = signup ? PASSWORD_MIN_LENGTH : 1;
  $('password').maxLength = signup ? PASSWORD_MAX_LENGTH : 128;
  $('password').value = '';
  $('confirm').value = '';
  touchedPasswords.clear();
  validatePasswords();
  $('title').textContent = signup ? '반가워요, 함께 시작해요' : '다시 만나 반가워요';
  $('description').textContent = signup ? '나만의 학업 여정을 만들어 보세요.' : '오늘도 한 걸음, 목표에 가까워질 시간이에요.';
  $('switch-mode').textContent = signup ? '이미 계정이 있으신가요? 로그인' : '아직 ENDPoinT 계정이 없으신가요? 회원가입';
  busy(false);
  message('');
});
// 비밀번호 확인 후 로그인 또는 회원가입 API를 호출하고 결과를 화면에 반영합니다.
$('auth-form').addEventListener('submit', async event => {
  event.preventDefault();
  touchedPasswords.add('password');
  if (signup) touchedPasswords.add('confirm');
  if (!validatePasswords()) {
    const invalid = $('password').validationMessage ? $('password') : $('confirm');
    message(invalid.validationMessage, true);
    invalid.reportValidity();
    return;
  }
  busy(true);
  message('처리 중입니다…');
  try {
    const { user } = await authRequest(signup ? 'signup' : 'login', {
      email: $('email').value, password: $('password').value,
      ...(signup ? { name: $('name').value } : {})
    });
    if (signup) {
      $('auth-form').reset();
      window.alert(`${user.name}님, ENDPoinT 가입을 환영합니다! 로그인해 주세요.`);
      window.location.replace('/login.html');
      return;
    }
    showUser(user);
    message('로그인되었습니다.');
    $('logout').focus();
  } catch (error) { message(error.message, true); }
  finally { busy(false); }
});
// 로그아웃 API 호출이 성공하면 로그인 입력 화면으로 돌아갑니다.
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
// 페이지를 열거나 새로고침할 때 서버에서 기존 로그인 상태를 확인합니다.
busy(true);
try {
  const { user } = await authRequest('me');
  showUser(user);
} catch (error) {
  if (error.status !== 401) message('서버 연결을 확인한 후 새로고침해 주세요.', true);
} finally { busy(false); }
