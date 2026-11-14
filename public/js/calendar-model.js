export const MIN_CALENDAR_YEAR = 1900;
export const MAX_CALENDAR_YEAR = 2100;

export function calendarMonth(year, month) {
  if (!Number.isInteger(year) || year < MIN_CALENDAR_YEAR || year > MAX_CALENDAR_YEAR
      || !Number.isInteger(month) || month < 1 || month > 12) return null;
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`;
}

function requireCalendarMonth(month) {
  if (typeof month !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)
      || calendarMonth(Number(month.slice(0, 4)), Number(month.slice(5))) !== month) {
    throw new RangeError('지원하는 연도는 1~9999년, 월은 1~12월입니다.');
  }
}

export function dateKey(date = new Date()) {
  return `${String(date.getFullYear()).padStart(4, '0')}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

// 로컬 달력의 날짜끼리 비교하되, 일수 계산에는 UTC를 써서 서머타임 영향을 피합니다.
export function ddayLabel(event, today = dateKey()) {
  if (event.isDday !== true) return '';
  const days = Math.round((Date.parse(`${event.date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000);
  return days === 0 ? 'D-Day' : days > 0 ? `D-${days}` : `D+${-days}`;
}

export function todaysDdayEvents(events, today = dateKey()) {
  return sortedEvents(events.filter(event => event.isDday === true && event.date === today));
}

export function monthCells(month) {
  requireCalendarMonth(month);
  const [year, number] = month.split('-').map(Number);
  const first = new Date(0);
  first.setUTCFullYear(year, number - 1, 1);
  first.setUTCHours(0, 0, 0, 0);
  const start = first.getTime() - first.getUTCDay() * 86400000;
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start + index * 86400000);
    return date.getUTCFullYear() < MIN_CALENDAR_YEAR || date.getUTCFullYear() > MAX_CALENDAR_YEAR ? null : date.toISOString().slice(0, 10);
  });
}

export function moveMonth(month, delta) {
  requireCalendarMonth(month);
  if (!Number.isSafeInteger(delta)) throw new RangeError('월 이동 값은 정수여야 합니다.');
  const [year, number] = month.split('-').map(Number);
  const total = year * 12 + number - 1 + delta;
  if (!Number.isSafeInteger(total) || total < MIN_CALENDAR_YEAR * 12 || total >= (MAX_CALENDAR_YEAR + 1) * 12) return month;
  return `${String(Math.floor(total / 12)).padStart(4, '0')}-${String(total % 12 + 1).padStart(2, '0')}`;
}

// 이전에 저장한 단일 날짜 일정도 같은 시작·종료 시점으로 읽습니다.
export function eventRange(event) {
  return { date: event.date, time: event.time, endDate: event.endDate ?? event.date, endTime: event.endTime ?? event.time };
}

export function eventOccursOn(event, date) {
  const range = eventRange(event);
  return range.date <= date && date <= range.endDate
    && !(range.time && range.endTime === '00:00' && range.endDate > range.date && date === range.endDate);
}

export function eventOverlapsMonth(event, month) {
  const range = eventRange(event);
  if (range.date.slice(0, 7) > month || range.endDate.slice(0, 7) < month) return false;
  return range.endDate.slice(0, 7) !== month || range.endDate !== `${month}-01` || eventOccursOn(event, `${month}-01`);
}

export function eventPeriod(event) {
  const { date, time, endDate, endTime } = eventRange(event);
  if (date === endDate) return time ? (time === endTime ? time : `${time} ~ ${endTime}`) : '종일';
  return time ? `${date} ${time} ~ ${endDate} ${endTime}` : `${date} ~ ${endDate} · 종일`;
}

export function sortedEvents(events, date) {
  return events.filter(event => !date || eventOccursOn(event, date)).sort((a, b) =>
    a.date.localeCompare(b.date) || a.time.localeCompare(b.time) || a.title.localeCompare(b.title, 'ko'));
}


// Week navigation is based on local calendar dates, but UTC arithmetic avoids DST shifts.
export function shiftCalendarDate(key, days) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key) || !Number.isSafeInteger(days)) throw new RangeError('날짜를 확인해 주세요.');
  const [year, month, day] = key.split('-').map(Number);
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, month - 1, day + days);
  if (date.getUTCFullYear() < MIN_CALENDAR_YEAR || date.getUTCFullYear() > MAX_CALENDAR_YEAR) return null;
  return date.toISOString().slice(0, 10);
}

export function weekDates(key) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) throw new RangeError('날짜를 확인해 주세요.');
  const [year, month, day] = key.split('-').map(Number);
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  const mondayOffset = (date.getUTCDay() + 6) % 7;
  const monday = shiftCalendarDate(key, -mondayOffset);
  // At the supported calendar boundaries, omit dates beyond 0001/9999.
  return Array.from({ length: 7 }, (_, index) => monday ? shiftCalendarDate(monday, index) : null);
}

// Events are not assigned a fabricated category: the existing schema has no `type`.
export function upcomingCalendarEvents(events, today = dateKey(), currentTime = '00:00', limit = 5) {
  const upcoming = events.filter(event => {
    const range = eventRange(event);
    if (range.endDate < today) return false;
    if (range.endDate > today) return true;
    if (!range.endTime) return true; // All-day events remain visible throughout today.
    return range.endTime > currentTime;
  });
  return upcoming.sort((a, b) => {
    const aKey = a.date < today ? today : a.date;
    const bKey = b.date < today ? today : b.date;
    return aKey.localeCompare(bKey) || a.time.localeCompare(b.time) || a.title.localeCompare(b.title, 'ko');
  }).slice(0, limit);
}
