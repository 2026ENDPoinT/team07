import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, unlinkSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { request as httpRequest } from 'node:http';
import { launch } from './http-helper.js';
import { validateCalendarState } from '../server/calendar.js';
import { MIN_CALENDAR_YEAR, MAX_CALENDAR_YEAR, calendarMonth, dateKey, monthCells, moveMonth, sortedEvents, eventRange, eventOccursOn, eventOverlapsMonth, eventPeriod, ddayLabel, todaysDdayEvents } from '../public/js/calendar-model.js';

const origin = 'http://localhost:3000';
const password = 'Calendar2026!';
const event = { id: 'exam-1', title: '자료구조 시험', date: '2026-11-18', time: '09:30', notes: '강의실 301호' };
const initial = { events: [], revision: 0 };
const calendar = (service, account, state, options = {}) => service.request('/api/calendar', state, account.cookie, origin,
  { method: state === undefined ? 'GET' : 'PUT', ...options, headers: { 'X-Account-Id': String(account.id), ...options.headers } });
async function signup(service, name) {
  const result = await service.request('/api/auth/signup', { name, email: `${name}@example.com`, password });
  assert.equal(result.status, 201);
  const login = await service.request('/api/auth/login', { email: `${name}@example.com`, password });
  assert.equal(login.status, 200);
  return { cookie: login.headers.get('set-cookie').split(';')[0], id: (await result.json()).user.id };
}

test('calendar uses each existing personal DB, preserves academic data, and persists edits and deletion across restart', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'team07-calendar-'));
  const path = join(folder, 'auth.db');
  let service = await launch(path);
  try {
    const a = await signup(service, 'one');
    const b = await signup(service, 'two');
    const academic = (body) => service.request('/api/academic', body, a.cookie, origin,
      { method: body === undefined ? 'GET' : 'PUT', headers: { 'X-Account-Id': String(a.id) } });
    await academic({ courses: [], profile: { grade: 3 }, revision: 0 });
    // 재시작 전의 개인 DB에는 달력 테이블이 없는 기존 설치도 자동 갱신합니다.
    const key = service.db.prepare('SELECT storage_key FROM user_databases WHERE user_id = ?').get(a.id).storage_key;
    const oldDb = new DatabaseSync(join(folder, 'users', `${key}.db`));
    oldDb.exec('DROP TABLE calendar_state');
    oldDb.close();
    assert.deepEqual(await (await calendar(service, a)).json(), initial);
    let saved = { events: [event], revision: 1 };
    assert.deepEqual(await (await calendar(service, a, { events: [event], revision: 0 })).json(), saved);
    assert.deepEqual(await (await calendar(service, b)).json(), initial);
    assert.equal((await academic()).status, 200);
    assert.deepEqual(await (await academic()).json(), { courses: [], profile: { grade: 3 }, revision: 1 });
    const mappings = service.db.prepare('SELECT storage_key FROM user_databases').all();
    assert.equal(mappings.length, 2);
    assert.equal(readdirSync(join(folder, 'users')).length, 2);
    const personalDb = new DatabaseSync(join(folder, 'users', `${key}.db`), { readOnly: true });
    assert.deepEqual(JSON.parse(personalDb.prepare('SELECT events FROM calendar_state').get().events), [event]);
    personalDb.close();
    await service.close();
    service = await launch(path);
    assert.deepEqual(await (await calendar(service, a)).json(), saved);
    const edited = { ...event, date: '2027-01-01', time: '', endDate: '2027-01-03', endTime: '', title: '새해 계획', isDday: true };
    saved = await (await calendar(service, a, { events: [edited], revision: 1 })).json();
    assert.equal(saved.revision, 2);
    assert.deepEqual(saved.events, [edited]);
    await service.close();
    service = await launch(path);
    assert.deepEqual(await (await calendar(service, a)).json(), saved);
    assert.equal((await calendar(service, b, { events: [event], revision: 0 })).status, 200);
    assert.equal((await calendar(service, a, { events: [], revision: 0 })).status, 409);
    assert.deepEqual(await (await calendar(service, a)).json(), saved);
    assert.equal((await calendar(service, a, { events: [], revision: 2 })).status, 200);
    await service.close();
    service = await launch(path);
    assert.deepEqual(await (await calendar(service, a)).json(), { events: [], revision: 3 });
    assert.deepEqual((await (await calendar(service, b)).json()).events, [event]);
  } finally {
    await service.close();
    // 생성한 임시 파일만 개별 삭제합니다.
    for (const file of readdirSync(join(folder, 'users'))) unlinkSync(join(folder, 'users', file));
    rmdirSync(join(folder, 'users'));
    for (const file of readdirSync(folder)) unlinkSync(join(folder, file));
    rmdirSync(folder);
  }
});

test('calendar rejects unauthenticated, wrong-account, cross-origin, malformed and conflicting writes', async () => {
  const service = await launch(':memory:');
  try {
    const a = await signup(service, 'one');
    const b = await signup(service, 'two');
    assert.equal((await service.request('/api/calendar')).status, 401);
    assert.equal((await calendar(service, { ...a, id: b.id })).status, 403);
    assert.equal((await calendar(service, a, undefined, { headers: { 'X-Account-Id': undefined } })).status, 403);
    assert.equal((await service.request('/api/calendar?userId=2', undefined, a.cookie, origin, { headers: { 'X-Account-Id': String(a.id) } })).status, 400);
    assert.equal((await service.request('/api/calendar', initial, a.cookie, 'https://other.example', { method: 'PUT' })).status, 403);
    assert.equal((await calendar(service, a, initial, { method: 'POST' })).status, 405);
    assert.equal((await calendar(service, a, initial, { headers: { 'Content-Type': 'text/plain' } })).status, 415);
    assert.equal((await calendar(service, a, initial, { rawBody: '{' })).status, 400);
    assert.equal((await calendar(service, a, { ...initial, userId: b.id })).status, 400);
    for (const invalid of [{ date: '2026-02-30' }, { time: '24:00' }, { title: ' ' }, { notes: 'x'.repeat(2001) }, { id: '../other' },
      ...['true', 1, null, {}, []].map(isDday => ({ isDday }))]) {
      assert.equal((await calendar(service, a, { events: [{ ...event, ...invalid }], revision: 0 })).status, 400);
    }
    for (const range of [
      { endDate: '2026-11-17', endTime: '09:30' },
      { endDate: event.date, endTime: '09:00' },
      { endDate: event.date, endTime: '' },
      { time: '', endDate: event.date, endTime: '10:30' },
      { endDate: '2026-02-30', endTime: '10:30' },
      { endDate: event.date, endTime: '25:00' },
      { endDate: event.date }, { endTime: '10:30' }
    ]) assert.equal((await calendar(service, a, { events: [{ ...event, ...range }], revision: 0 })).status, 400);
    assert.deepEqual(await (await calendar(service, a)).json(), initial);
    const writes = await Promise.all([calendar(service, a, { events: [event], revision: 0 }), calendar(service, a, { events: [], revision: 0 })]);
    assert.deepEqual(writes.map(result => result.status).sort(), [200, 409]);
    assert.deepEqual(await (await calendar(service, b)).json(), initial);
    for (const path of ['/calendar.html', '/css/calendar.css', '/js/calendar.js', '/js/calendar-api.js', '/js/calendar-model.js']) {
      assert.equal((await service.request(path)).status, 200);
    }
  } finally { await service.close(); }
});

test('D-day settings retain legacy schedules and can be enabled or disabled', () => {
  for (const item of [event, { ...event, isDday: true }, { ...event, isDday: false }]) {
    assert.deepEqual(validateCalendarState({ events: [item], revision: 0 }).events, [item]);
  }
});

test('D-day counts calendar days across leap days, DST, year boundaries and supported years', () => {
  const deadline = { ...event, isDday: true };
  assert.equal(ddayLabel(event, event.date), '');
  assert.equal(ddayLabel({ ...deadline, isDday: false }, event.date), '');
  for (const [date, today, label] of [
    ['2026-11-18', '2026-11-14', 'D-4'],
    ['2026-11-18', '2026-11-18', 'D-Day'],
    ['2026-11-18', '2026-11-19', 'D+1'],
    ['2028-03-01', '2028-02-28', 'D-2'],
    ['2026-03-09', '2026-03-08', 'D-1'],
    ['2027-01-01', '2026-12-31', 'D-1'],
    ['0099-01-01', '0098-12-31', 'D-1'],
    ['9999-12-31', '0001-01-01', 'D-3652058']
  ]) assert.equal(ddayLabel({ ...deadline, date }, today), label);
});

test('today notifications include all enabled start dates only, ordered by time', () => {
  const today = '2026-11-18';
  const deadline = { ...event, isDday: true };
  const allDay = { ...deadline, id: 'all-day', time: '' };
  const events = [deadline, event, { ...deadline, id: 'disabled', isDday: false },
    { ...deadline, id: 'tomorrow', date: '2026-11-19' },
    { ...deadline, id: 'ongoing', date: '2026-11-17', endDate: '2026-11-20', endTime: '10:00' }, allDay];
  assert.deepEqual(todaysDdayEvents(events, today), [allDay, deadline]);
  assert.deepEqual(todaysDdayEvents(events, '2026-11-20'), []);
  assert.deepEqual(todaysDdayEvents([], today), []);
  assert.deepEqual(events[0], deadline);
});

test('event ranges include each day and month, keep legacy events, and distinguish all-day and timed periods', () => {
  const period = { ...event, date: '2026-12-30', time: '', endDate: '2027-01-02', endTime: '' };
  assert.deepEqual(validateCalendarState({ events: [period], revision: 0 }).events, [period]);
  assert.deepEqual(eventRange(event), { date: event.date, time: event.time, endDate: event.date, endTime: event.time });
  assert.equal(eventPeriod(event), '09:30');
  const allDay = { ...period, endDate: period.date };
  assert.equal(eventPeriod(allDay), '종일');
  assert.ok(eventOccursOn(allDay, allDay.date));
  assert.equal(eventOccursOn(allDay, '2026-12-31'), false);
  for (const date of ['2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02']) {
    assert.ok(eventOccursOn(period, date));
    assert.deepEqual(sortedEvents([period], date), [period]);
  }
  assert.equal(eventOccursOn(period, '2026-12-29'), false);
  assert.equal(eventOccursOn(period, '2027-01-03'), false);
  assert.ok(eventOverlapsMonth(period, '2026-12'));
  assert.ok(eventOverlapsMonth(period, '2027-01'));
  assert.equal(eventOverlapsMonth(period, '2027-02'), false);
  assert.equal(eventPeriod(period), '2026-12-30 ~ 2027-01-02 · 종일');
  const timed = { ...period, time: '23:30', endDate: '2027-01-01', endTime: '00:00' };
  assert.doesNotThrow(() => validateCalendarState({ events: [timed], revision: 0 }));
  assert.ok(eventOccursOn(timed, '2026-12-31'));
  assert.equal(eventOccursOn(timed, '2027-01-01'), false);
  assert.equal(eventOverlapsMonth(timed, '2027-01'), false);
  assert.equal(eventPeriod(timed), '2026-12-30 23:30 ~ 2027-01-01 00:00');
  const sameDay = { ...event, endDate: event.date, endTime: '11:00' };
  assert.doesNotThrow(() => validateCalendarState({ events: [sameDay], revision: 0 }));
  assert.equal(eventPeriod(sameDay), '09:30 ~ 11:00');
  const longRange = { ...period, date: '0001-01-01', endDate: '9999-12-31' };
  assert.ok(eventOverlapsMonth(longRange, '2026-11'));
  assert.ok(eventOccursOn(longRange, '2026-11-14'));
});

test('calendar rechecks a session after receiving the upload', async () => {
  const service = await launch(':memory:');
  try {
    const a = await signup(service, 'one');
    const body = JSON.stringify({ events: [event], revision: 0 });
    const reading = new Promise(resolve => service.app.once('request', req => {
      const iterator = req.iterator;
      req.iterator = function (options) { resolve(); return iterator.call(this, options); };
    }));
    let pending;
    const response = new Promise((resolve, reject) => {
      pending = httpRequest(service.base + '/api/calendar', { method: 'PUT', headers: {
        Origin: origin, Cookie: a.cookie, 'X-Account-Id': String(a.id), 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body)
      } }, res => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
      pending.on('error', reject);
    });
    pending.write(body.slice(0, 10));
    await reading;
    await service.request('/api/auth/logout', {}, a.cookie);
    pending.end(body.slice(10));
    assert.equal(await response, 401);
    assert.equal(service.db.prepare('SELECT count(*) AS total FROM user_databases').get().total, 0);
  } finally { await service.close(); }
});

test('calendar validation and month layout handle leap years, year boundaries and all-day ordering', () => {
  assert.doesNotThrow(() => validateCalendarState({ events: [{ ...event, date: '2028-02-29' }], revision: 0 }));
  for (const date of ['2026-02-29', '2026-13-01', '0000-01-01', '2026-2-03']) {
    assert.throws(() => validateCalendarState({ events: [{ ...event, date }], revision: 0 }));
  }
  assert.throws(() => validateCalendarState({ events: [event, event], revision: 0 }));
  assert.throws(() => validateCalendarState({ events: Array(1001).fill(event), revision: 0 }));
  assert.equal(moveMonth('2026-12', 1), '2027-01');
  assert.equal(moveMonth('2026-01', -1), '2025-12');
  assert.equal(moveMonth('0001-01', -1), '0001-01');
  assert.equal(moveMonth('9999-12', 1), '9999-12');
  assert.equal(monthCells('2026-11')[0], '2026-11-01');
  assert.equal(monthCells('2026-08').filter(key => key?.startsWith('2026-08')).length, 31);
  assert.ok(monthCells('2028-02').includes('2028-02-29'));
  assert.equal(monthCells('2026-08').length, 42);
  assert.equal(monthCells('0001-01')[0], null);
  assert.equal(dateKey(new Date(2026, 10, 14, 0, 1)), '2026-11-14');
  assert.deepEqual(sortedEvents([event, { ...event, id: 'all-day', time: '' }], event.date).map(item => item.id), ['all-day', 'exam-1']);
});

test('year/month selection is bounded to stored four-digit dates and renders both boundaries safely', () => {
  assert.equal(calendarMonth(MIN_CALENDAR_YEAR, 1), '0001-01');
  assert.equal(calendarMonth(MAX_CALENDAR_YEAR, 12), '9999-12');
  assert.equal(calendarMonth(99, 2), '0099-02');
  for (const [year, month] of [[0, 1], [10000, 1], [-1, 1], [2026.5, 1], [NaN, 1], [Infinity, 1], ['2026', 1], [2026, 0], [2026, 13], [2026, 1.5]]) {
    assert.equal(calendarMonth(year, month), null);
  }
  for (const invalid of ['0000-01', '10000-01', '2026-00', '2026-13', '2026-1', '../2026-01', null]) {
    assert.throws(() => monthCells(invalid), RangeError);
    assert.throws(() => moveMonth(invalid, 1), RangeError);
  }
  assert.throws(() => moveMonth('2026-01', Infinity), RangeError);
  assert.equal(moveMonth('0001-01', -1), '0001-01');
  assert.equal(moveMonth('9999-12', 1), '9999-12');
  assert.equal(moveMonth('0099-12', 1), '0100-01');
  assert.equal(monthCells('0001-01').filter(Boolean).length, 41);
  assert.ok(monthCells('9999-12').includes('9999-12-31'));
  assert.ok(monthCells('9999-12').some(key => key === null));
  for (const date of ['0001-01-01', '0099-02-28', '9999-12-31']) {
    assert.doesNotThrow(() => validateCalendarState({ events: [{ ...event, date }], revision: 0 }));
  }
});
