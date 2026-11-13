// 오류 원문에는 DB URI·비밀번호·SQL 값이 들어갈 수 있으므로 정해진 코드와 안내만 기록합니다.
const hints = new Map(Object.entries({
  APP_ORIGIN_INVALID: 'APP_ORIGIN must be a valid HTTP(S) origin.',
  APP_ORIGIN_HTTPS_REQUIRED: 'Set APP_ORIGIN to the actual HTTPS service URL.',
  DATABASE_URL_REQUIRED: 'Set DATABASE_URL in the Render service environment.',
  DATABASE_URL_INVALID: 'Copy the PostgreSQL URI from Supabase Connect > Session pooler; URL-encode the password.',
  DATABASE_SSL_INVALID: 'Set DATABASE_SSL to verify-full.',
  DATABASE_SSL_LOCAL_ONLY: 'DATABASE_SSL=disable is allowed only for local development; use verify-full on Render.',
  DATABASE_URL_TLS_INVALID: 'Remove TLS downgrade parameters from DATABASE_URL; use certificate verification.',
  DATABASE_SSL_CA_UNREADABLE: 'Check that DATABASE_SSL_CA_FILE names an existing readable Secret File.',
  AUTH_LIMITS_INVALID: 'Authentication limits must be positive integers.',
  ENETUNREACH: 'Database network is unreachable. If IPv6 is unavailable, use the Supabase Session pooler URI.',
  EHOSTUNREACH: 'Database host is unreachable. Check the Session pooler URI and database network restrictions.',
  ENOTFOUND: 'Database hostname could not be resolved. Copy the Session pooler URI again.',
  EAI_AGAIN: 'Database DNS lookup failed temporarily. Check DNS and retry.',
  ECONNREFUSED: 'Database connection was refused. Check the host, port and Supabase project status.',
  ETIMEDOUT: 'Database connection timed out. Check the pooler, network restrictions and connection limits.',
  ECONNRESET: 'Database connection was reset. Check Supabase project status and pooler connections.',
  SELF_SIGNED_CERT_IN_CHAIN: 'Database TLS certificate is not trusted. Configure the Supabase CA with DATABASE_SSL_CA_FILE.',
  DEPTH_ZERO_SELF_SIGNED_CERT: 'Database TLS certificate is not trusted. Configure the Supabase CA with DATABASE_SSL_CA_FILE.',
  UNABLE_TO_VERIFY_LEAF_SIGNATURE: 'Database TLS certificate chain could not be verified. Configure the Supabase CA.',
  UNABLE_TO_GET_ISSUER_CERT_LOCALLY: 'Database TLS issuer is not trusted. Configure the Supabase CA.',
  CERT_HAS_EXPIRED: 'Database TLS certificate has expired. Check the database certificate and CA.',
  ERR_TLS_CERT_ALTNAME_INVALID: 'Database TLS hostname does not match its certificate. Check the pooler hostname.',
  '28P01': 'PostgreSQL authentication failed. Check the database password and pooler username; URL-encode the password.',
  '28000': 'PostgreSQL rejected the connection authorization. Check the pooler username and connection settings.',
  '3D000': 'PostgreSQL database does not exist. Check the database name in DATABASE_URL.',
  '42501': 'PostgreSQL permission denied. Initial schema setup requires a DB owner connection, not a Supabase API key.',
  '42P01': 'PostgreSQL table is missing. Check app_private schema initialization and the deployed code version.',
  '42703': 'PostgreSQL column is missing. Check database schema compatibility with the deployed code.',
  '53300': 'PostgreSQL connection limit reached. Check pooler capacity and other active deployments.',
  '57P03': 'PostgreSQL is not ready to accept connections. Check Supabase project status.',
  '57014': 'PostgreSQL statement timed out or was cancelled. Check database locks and workload.',
  EADDRINUSE: 'HTTP port is already in use. Check the service start command and PORT.',
  ERR_MODULE_NOT_FOUND: 'A runtime dependency is missing. Build with npm ci --omit=dev using the committed lockfile.'
}));

export function configurationError(code, message) {
  return Object.assign(new Error(message), { code });
}

export function failureDetails(error) {
  const pending = [error];
  const seen = new Set();
  while (pending.length && seen.size < 20) {
    const current = pending.shift();
    if (!current || seen.has(current)) continue;
    seen.add(current);
    if (hints.has(current.code)) return `[${current.code}] ${hints.get(current.code)}`;
    if (current.cause) pending.push(current.cause);
    if (Array.isArray(current.errors)) pending.push(...current.errors.slice(0, 10));
  }
  return '[UNKNOWN] Check database availability and deployment configuration; raw error details are withheld.';
}
