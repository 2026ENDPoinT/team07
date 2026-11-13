import { authRequest } from '/js/auth/api.js';
import { getPasswordErrors } from '/js/auth/password-policy.js';

const $ = id => document.getElementById(id);
let savedUser;
let pending = false;
const majorFields = [
    { checkbox: 'has-double-major', input: 'double-major', field: 'doubleMajor', label: '복수전공' },
    { checkbox: 'has-minor', input: 'minor', field: 'minor', label: '부전공' }
];

function syncMajorFields() {
    for (const { checkbox, input, label } of majorFields) {
        const selected = $(checkbox).checked;
        $(input).disabled = !selected;
        $(input).required = selected;
        $(input).setCustomValidity(selected && !$(input).value.trim() ? `${label} 전공명을 입력해 주세요.` : '');
    }
}

function message(text, error = false) {
    $('profile-message').textContent = text;
    $('profile-message').dataset.error = String(error);
}

function busy(value) {
    pending = value;
    $('profile-fields').disabled = value || !savedUser;
    $('logout-button').disabled = value;
    $('retry-profile').disabled = value;
    $('profile-form').setAttribute('aria-busy', String(value));
    $('save-profile').textContent = value && savedUser ? '저장 중…' : '변경사항 저장';
}

const touchedPasswords = new Set();
function validatePasswords() {
    const password = $('password').value;
    const confirm = $('password-confirm').value;
    let valid = true;
    for (const [id, hint] of [['password', 'password-hint'], ['password-confirm', 'password-match']]) {
        const input = $(id);
        const errors = password || confirm ? getPasswordErrors(input.value) : [];
        if (id === 'password-confirm' && password !== confirm) errors.push('비밀번호 확인이 일치하지 않습니다.');
        input.setCustomValidity(errors.join(' '));
        const visible = Boolean(input.value) || touchedPasswords.has(id);
        $(hint).textContent = visible ? errors.join(' ') : '';
        $(hint).dataset.error = String(visible && errors.length > 0);
        input.setAttribute('aria-invalid', String(visible && errors.length > 0));
        if (errors.length) valid = false;
    }
    return valid;
}

function showUser(user) {
    savedUser = user;
    $('user-name').textContent = `${user.name}님`;
    for (const field of ['name', 'email', 'department']) $(field).value = user[field];
    for (const { checkbox, input, field } of majorFields) {
        $(input).value = user[field] || '';
        $(checkbox).checked = Boolean(user[field]);
    }
    syncMajorFields();
    $('password').value = '';
    $('password-confirm').value = '';
    touchedPasswords.clear();
    validatePasswords();
}

function handleError(error) {
    if (error.status === 401) {
        window.location.replace('/login.html');
        return;
    }
    if (error.status === 403) {
        savedUser = undefined;
        $('password').value = '';
        $('password-confirm').value = '';
        touchedPasswords.clear();
        validatePasswords();
        $('retry-profile').hidden = false;
    }
    message(error.message, true);
}

async function loadProfile() {
    if (pending) return;
    busy(true);
    message('회원정보를 불러오는 중입니다.');
    $('retry-profile').hidden = true;
    try {
        const { user } = await authRequest('me');
        showUser(user);
        message('');
    } catch (error) {
        handleError(error);
        $('retry-profile').hidden = false;
    } finally { busy(false); }
}

for (const id of ['password', 'password-confirm']) {
    for (const event of ['input', 'invalid']) $(id).addEventListener(event, () => {
        touchedPasswords.add(id);
        validatePasswords();
        if (event === 'input' && $('profile-message').dataset.error === 'true') message('');
    });
}
for (const { checkbox, input } of majorFields) {
    $(checkbox).addEventListener('change', syncMajorFields);
    $(input).addEventListener('input', syncMajorFields);
}

$('profile-form').addEventListener('submit', async event => {
    event.preventDefault();
    if (pending || !savedUser) return;
    syncMajorFields();
    touchedPasswords.add('password');
    touchedPasswords.add('password-confirm');
    const passwordsValid = validatePasswords();
    if (!$('profile-form').reportValidity() || !passwordsValid) {
        message('입력 내용을 확인해 주세요.', true);
        return;
    }
    busy(true);
    message('회원정보를 저장하는 중입니다.');
    const passwordChanged = Boolean($('password').value);
    const emailChanged = $('email').value.trim().toLowerCase() !== savedUser.email;
    try {
        const { user } = await authRequest('profile', {
            name: $('name').value,
            email: $('email').value,
            department: $('department').value,
            doubleMajor: $('has-double-major').checked ? $('double-major').value : '',
            minor: $('has-minor').checked ? $('minor').value : '',
            password: $('password').value,
            passwordConfirm: $('password-confirm').value
        }, { headers: { 'X-Account-Id': String(savedUser.id) } });
        showUser(user);
        message('');
        if (passwordChanged) {
            window.alert('비밀번호가 변경되어 로그아웃되었습니다. 변경된 비밀번호로 다시 로그인해 주세요.');
            window.location.replace('/login.html');
            return;
        }
        window.alert(emailChanged
            ? '회원정보가 변경되었습니다. 다음 로그인부터 변경된 로그인 정보를 사용해 주세요.'
            : '회원정보가 변경되었습니다.');
        window.location.assign('/index.html');
    } catch (error) { handleError(error); }
    finally { busy(false); }
});

$('reset-profile').addEventListener('click', () => {
    if (pending || !savedUser) return;
    window.location.assign('/index.html');
});

$('retry-profile').addEventListener('click', loadProfile);
$('logout-button').addEventListener('click', async () => {
    if (pending) return;
    busy(true);
    try {
        await authRequest('logout', {});
        window.location.replace('/login.html');
    } catch (error) { handleError(error); }
    finally { busy(false); }
});

loadProfile();
