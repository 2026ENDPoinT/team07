import { authRequest } from './api.js';
import { getPasswordErrors } from './password-policy.js';

const $ = id => document.getElementById(id);
let signup = false;
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
  $('password').minLength = 8;
  $('password').maxLength = signup ? 20 : 128; // 이전 가입자의 긴 비밀번호로도 로그인 가능
  $('confirm').minLength = 8;
  $('confirm').maxLength = 20;
  $('password-hint').textContent = signup
    ? '8~20자 · 대문자·소문자·숫자·허용 특수문자를 각각 1개 이상 포함하고 공백은 사용할 수 없습니다.'
    : '가입할 때 설정한 비밀번호를 입력해 주세요. 기존 비밀번호도 계속 사용할 수 있습니다.';
  $('password').value = '';
  $('confirm').value = '';
  $('title').textContent = signup ? '반가워요, 함께 시작해요' : '다시 만나 반가워요';
  $('description').textContent = signup ? '나만의 학업 여정을 만들어 보세요.' : '오늘도 한 걸음, 목표에 가까워질 시간이에요.';
  $('switch-mode').textContent = signup ? '이미 계정이 있으신가요? 로그인' : '아직 Simplified 계정이 없으신가요? 회원가입';
  busy(false);
  updatePasswordAdvice();
  message('');
});
// 가입 시 충족하지 못한 조건만 안내합니다. 비밀번호 원문은 화면·로그에 출력하지 않습니다.
function updatePasswordAdvice() {
  const hint = $('signup-password-security');
  hint.hidden = !signup;
  const password = $('password').value;
  const errors = signup && password ? getPasswordErrors(password) : [];
  hint.textContent = !signup ? '' : !password
    ? '영문 대문자·소문자·숫자·특수문자를 포함한 8~20자로 설정해 주세요.'
    : errors.length ? errors.join('\n') : '모든 비밀번호 조건을 충족했습니다.';
  hint.dataset.error = String(Boolean(errors.length));
  $('password').setAttribute('aria-invalid', String(Boolean(errors.length)));
  return errors;
}
$('password').addEventListener('input', updatePasswordAdvice);

// 비밀번호 확인 후 로그인 또는 회원가입 API를 호출하고 결과를 화면에 반영합니다.
$('auth-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (signup && updatePasswordAdvice().length) {
    message('비밀번호 조건을 확인해 주세요.', true);
    $('password').focus();
    return;
  }
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
