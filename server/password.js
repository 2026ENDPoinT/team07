import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const derive = promisify(scrypt);
// OWASP의 scrypt 설정 중 메모리 약 16 MiB를 사용하는 조합입니다.
const options = { N: 16384, r: 8, p: 5, maxmem: 32 * 1024 * 1024 };

// 비밀번호마다 무작위 salt를 생성하고, 검증에 필요한 설정과 해시를 함께 반환합니다.
export async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const key = await derive(password, salt, 64, options);
  return `scrypt$16384$8$5$${salt}$${key.toString('hex')}`;
}

// 저장 형식을 검사한 뒤 같은 설정으로 해시하고, 일정 시간 비교 함수로 검증합니다.
export async function verifyPassword(password, stored) {
  if (typeof stored !== 'string' || !/^scrypt\$16384\$8\$5\$[a-f0-9]{32}\$[a-f0-9]{128}$/.test(stored)) return false;
  const [algorithm, n, r, p, salt, hex] = stored.split('$');
  if (algorithm !== 'scrypt' || n !== '16384' || r !== '8' || p !== '5' || !salt || !hex) return false;
  const actual = await derive(password, salt, 64, options);
  const expected = Buffer.from(hex, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
