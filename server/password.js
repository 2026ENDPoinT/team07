import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const derive = promisify(scrypt);
// OWASP's 16 MiB profile reduces peak RAM use while retaining recommended work.
const options = { N: 16384, r: 8, p: 5, maxmem: 32 * 1024 * 1024 };

export async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const key = await derive(password, salt, 64, options);
  return `scrypt$16384$8$5$${salt}$${key.toString('hex')}`;
}

export async function verifyPassword(password, stored) {
  if (typeof stored !== 'string' || !/^scrypt\$16384\$8\$5\$[a-f0-9]{32}\$[a-f0-9]{128}$/.test(stored)) return false;
  const [algorithm, n, r, p, salt, hex] = stored.split('$');
  if (algorithm !== 'scrypt' || n !== '16384' || r !== '8' || p !== '5' || !salt || !hex) return false;
  const actual = await derive(password, salt, 64, options);
  const expected = Buffer.from(hex, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
