import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server/app.js';

const origin = 'http://localhost:3000';
async function request(base, path, { method = 'GET', body, cookie } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { Origin: origin, ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  return { status: res.status, cookie: res.headers.get('set-cookie')?.split(';')[0], data: await res.json() };
}

test('courses persist across requests and remain private per account', async () => {
  const { app, db } = await createApp({ dbPath: ':memory:', origin });
  await new Promise(resolve => app.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${app.address().port}`;
  try {
    const first = await request(base, '/api/auth/signup', { method: 'POST', body: { name: 'A', email: 'a@example.com', password: 'Aa1!test2026' } });
    assert.equal(first.status, 201);
    const initial = await request(base, '/api/courses', { cookie: first.cookie });
    assert.equal(initial.data.courses, null);
    const course = { id: 'abc-1', courseName: '자료구조', credits: 3, grade: 'A+', semester: '2026-1', status: 'completed', category: 'major', isRetake: false };
    const saved = await request(base, '/api/courses', { method: 'PUT', cookie: first.cookie, body: { courses: [course] } });
    assert.equal(saved.status, 200);
    assert.equal(saved.data.courses[0].gradePoint, 4.5);
    const loaded = await request(base, '/api/courses', { cookie: first.cookie });
    assert.equal(loaded.data.courses[0].courseName, '자료구조');
    const second = await request(base, '/api/auth/signup', { method: 'POST', body: { name: 'B', email: 'b@example.com', password: 'Aa1!test2026' } });
    const isolated = await request(base, '/api/courses', { cookie: second.cookie });
    assert.equal(isolated.data.courses, null);
    const denied = await request(base, '/api/courses');
    assert.equal(denied.status, 401);
  } finally {
    await new Promise(resolve => app.close(resolve));
    await db.close();
  }
});
