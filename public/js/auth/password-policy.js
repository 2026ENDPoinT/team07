// 회원가입과 비밀번호 변경 시 브라우저·서버가 동일하게 적용하는 규칙입니다.
// 로그인에는 적용하지 않습니다. 변경 이전에 가입한 기존 사용자를 보호합니다.
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 20;
export const PASSWORD_SPECIAL_CHARACTERS = "`~!@#$%^&*|'\";:₩\\?";

// 충족하지 못한 조건만 반환하며 비밀번호 원문은 안내에 포함하지 않습니다.
export function getPasswordErrors(password) {
  if (typeof password !== 'string') return ['비밀번호를 문자열로 입력해 주세요.'];
  const errors = [];
  if (password.length < PASSWORD_MIN_LENGTH) errors.push('8자 이상 입력해 주세요.');
  if (password.length > PASSWORD_MAX_LENGTH) errors.push('20자 이하로 입력해 주세요.');
  if (!/[A-Z]/.test(password)) errors.push('영문 대문자를 1개 이상 포함해 주세요.');
  if (!/[a-z]/.test(password)) errors.push('영문 소문자를 1개 이상 포함해 주세요.');
  if (!/[0-9]/.test(password)) errors.push('숫자를 1개 이상 포함해 주세요.');
  if (![...password].some(character => PASSWORD_SPECIAL_CHARACTERS.includes(character))) {
    errors.push(`특수문자를 1개 이상 포함해 주세요. 허용 특수문자: ${[...PASSWORD_SPECIAL_CHARACTERS].join(' ')}`);
  }
  if (/\s/u.test(password)) errors.push('공백을 제거해 주세요.');
  if ([...password].some(character => !/[A-Za-z0-9\s]/u.test(character) && !PASSWORD_SPECIAL_CHARACTERS.includes(character))) {
    errors.push('영문·숫자·허용 특수문자 외의 문자를 제거해 주세요.');
  }
  return errors;
}

export function isValidPassword(password) {
  return getPasswordErrors(password).length === 0;
}
