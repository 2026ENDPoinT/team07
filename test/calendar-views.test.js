import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shiftCalendarDate, weekDates, upcomingCalendarEvents } from '../public/js/calendar-model.js';

const sample = (id, date, time = '', endDate = date, endTime = time) =>
  ({ id, title: id, date, time, endDate, endTime, notes: '', isDday: false });

test('calendar week starts Monday, passes through Sunday, and moves between months and years', () => {
  assert.deepEqual(weekDates('2026-11-13'), [
    '2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12',
    '2026-11-13', '2026-11-14', '2026-11-15'
  ]);
  assert.deepEqual(weekDates('2027-01-01'), [
    '2026-12-28', '2026-12-29', '2026-12-30', '2026-12-31',
    '2027-01-01', '2027-01-02', '2027-01-03'
  ]);
  assert.equal(shiftCalendarDate('2026-12-30', 7), '2027-01-06');
  assert.equal(shiftCalendarDate('2026-01-02', -7), '2025-12-26');
});

test('upcoming panel excludes ended events, includes ongoing multi-day and all-day events', () => {
  const events = [
    sample('past', '2026-11-12', '10:00', '2026-11-12', '11:00'),
    sample('ended-today', '2026-11-13', '08:00', '2026-11-13', '09:00'),
    sample('today', '2026-11-13', '15:00', '2026-11-13', '16:00'),
    sample('ongoing', '2026-11-12', '10:00', '2026-11-14', '12:00'),
    sample('all-day', '2026-11-13'),
    sample('tomorrow', '2026-11-14', '10:00', '2026-11-14', '11:00'),
    sample('later', '2026-11-18')
  ];
  assert.deepEqual(upcomingCalendarEvents(events, '2026-11-13', '12:00', 4).map(e => e.id),
    ['all-day', 'ongoing', 'today', 'tomorrow']);
  assert.equal(upcomingCalendarEvents(events, '2026-11-20', '12:00').length, 0);
  assert.equal(upcomingCalendarEvents([sample('midnight', '2026-11-12', '23:00', '2026-11-13', '00:00')], '2026-11-13', '12:00').length, 0);
});
