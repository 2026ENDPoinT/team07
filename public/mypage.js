import { authRequest } from '/js/auth/api.js';

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

function validatePasswords() {
    const password = $('password').value;
    const confirm = $('password-confirm').value;
    const mismatch = password !== confirm;
    $('password-confirm').setCustomValidity(mismatch ? '비밀번호 확인이 일치하지 않습니다.' : '');
    $('password-confirm').setAttribute('aria-invalid', String(mismatch));
    $('password-match').textContent = mismatch ? '비밀번호 확인이 일치하지 않습니다.' : password ? '비밀번호가 일치합니다.' : '';
    $('password-match').dataset.error = String(mismatch);
    return !mismatch;
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

for (const id of ['password', 'password-confirm']) $(id).addEventListener('input', validatePasswords);
for (const { checkbox, input } of majorFields) {
    $(checkbox).addEventListener('change', syncMajorFields);
    $(input).addEventListener('input', syncMajorFields);
}

$('profile-form').addEventListener('submit', async event => {
    event.preventDefault();
    if (pending || !savedUser) return;
    syncMajorFields();
    if (!validatePasswords() || !$('profile-form').reportValidity()) {
        message('입력 내용을 확인해 주세요. 비밀번호는 두 칸이 일치해야 합니다.', true);
        $('password-confirm').reportValidity();
        return;
    }
    busy(true);
    message('회원정보를 저장하는 중입니다.');
    const credentialsChanged = $('email').value.trim().toLowerCase() !== savedUser.email || Boolean($('password').value);
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
        window.alert(credentialsChanged
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
