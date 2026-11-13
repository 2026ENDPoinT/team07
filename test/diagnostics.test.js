import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { configurationError, failureDetails } from '../server/diagnostics.js';

test('deployment diagnostics identify known causes without exposing error details or credentials', () => {
  const secret = 'postgresql://private-user:private-password@private-host/postgres';
  for (const code of ['28P01', '42501', 'ENETUNREACH', 'SELF_SIGNED_CERT_IN_CHAIN']) {
    const error = Object.assign(new Error(secret), { code, detail: secret, query: secret });
    const result = failureDetails(new Error(secret, { cause: error }));
    assert.ok(result.startsWith(`[${code}]`));
    assert.doesNotMatch(result, /private-user|private-password|private-host/);
  }
  const networkError = new AggregateError([Object.assign(new Error(secret), { code: 'ETIMEDOUT' })]);
  assert.match(failureDetails(networkError), /^\[ETIMEDOUT\]/);
  assert.match(failureDetails(Object.assign(new Error(secret), { code: '42P18' })), /^\[42P18\]/);
  const unknownPostgresError = failureDetails(Object.assign(new Error(secret), { code: '23502' }));
  assert.match(unknownPostgresError, /^\[23502\]/);
  assert.doesNotMatch(unknownPostgresError, /private-user|private-password|private-host/);
  const unknown = new Error(secret);
  unknown.cause = unknown;
  assert.match(failureDetails(unknown), /^\[UNKNOWN\]/);
  assert.doesNotMatch(failureDetails(unknown), /private-/);
  assert.match(failureDetails(configurationError('DATABASE_URL_REQUIRED', secret)), /^\[DATABASE_URL_REQUIRED\]/);
});

test('server startup reports configuration causes and exits before connecting to a database', async () => {
  const run = promisify(execFile);
  const baseEnv = { ...process.env, NODE_ENV: 'production', RENDER: 'true',
    APP_ORIGIN: 'https://example.com', DATABASE_URL: '', DATABASE_SSL: 'verify-full',
    DATABASE_SSL_CA_FILE: '', DATABASE_SSL_CA: '' };
  const cases = [
    [{ APP_ORIGIN: 'http://example.com' }, 'APP_ORIGIN_HTTPS_REQUIRED'],
    [{ APP_ORIGIN: 'not-a-url' }, 'APP_ORIGIN_INVALID'],
    [{ APP_ORIGIN: 'file:///private-folder' }, 'APP_ORIGIN_INVALID'],
    [{}, 'DATABASE_URL_REQUIRED'],
    [{ DATABASE_URL: 'https://private-user:private-password@private-host' }, 'DATABASE_URL_INVALID']
  ];
  for (const [env, code] of cases) {
    await assert.rejects(run(process.execPath, ['server/app.js'], {
      cwd: new URL('../', import.meta.url), env: { ...baseEnv, ...env }, timeout: 10000
    }), error => {
      assert.equal(error.code, 1);
      assert.ok(error.stderr.includes(`Server startup failed. [${code}]`), error.stderr);
      assert.doesNotMatch(error.stderr, /private-user|private-password|private-host|private-folder/);
      return true;
    });
  }
});
