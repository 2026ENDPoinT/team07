const fail = message => Object.assign(new Error(message), { status: 400 });
const onlyKeys = (value, keys) => value !== null && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).every(key => keys.includes(key));
const isTime = value => typeof value === 'string' && (value === '' || /^([01]\d|2[0-3]):[0-5]\d$/.test(value));

// 날짜는 시간대 변환 없이 사용자의 달력 날짜(YYYY-MM-DD)로 저장합니다.
export function isCalendarDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value < '0001-01-01') return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function validateCalendarState(body) {
  if (!onlyKeys(body, ['events', 'revision']) || !Number.isSafeInteger(body.revision) || body.revision < 0
      || !Array.isArray(body.events) || body.events.length > 1000) {
    throw fail('일정 목록(최대 1,000개)과 저장 버전을 확인해 주세요.');
  }
  const ids = new Set();
  const events = body.events.map(event => {
    if (!onlyKeys(event, ['id', 'title', 'date', 'time', 'endDate', 'endTime', 'notes', 'isDday'])
        || typeof event.id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(event.id) || ids.has(event.id)
        || typeof event.title !== 'string' || !event.title.trim() || event.title.trim().length > 100
        || !isCalendarDate(event.date)
        || !isTime(event.time)
        || typeof event.notes !== 'string' || event.notes.length > 2000) {
      throw fail('일정 제목(1~100자), 날짜, 시간, 메모(최대 2,000자)를 확인해 주세요.');
    }
    if (Object.hasOwn(event, 'isDday') && typeof event.isDday !== 'boolean') {
      throw fail('디데이 설정은 켜기 또는 끄기로 선택해 주세요.');
    }
    const hasEnd = Object.hasOwn(event, 'endDate') || Object.hasOwn(event, 'endTime');
    if (hasEnd) {
      if (!isCalendarDate(event.endDate) || !isTime(event.endTime)) {
        throw fail('종료 날짜와 시간을 확인해 주세요.');
      }
      if (Boolean(event.time) !== Boolean(event.endTime)) {
        throw fail('시작 시간과 종료 시간을 모두 입력하거나, 종일 일정은 두 시간을 모두 비워 주세요.');
      }
      if (event.endDate < event.date || (event.endDate === event.date && event.endTime < event.time)) {
        throw fail('종료 시점은 시작 시점보다 빠를 수 없습니다.');
      }
    }
    ids.add(event.id);
    return { id: event.id, title: event.title.trim(), date: event.date, time: event.time,
      ...(hasEnd ? { endDate: event.endDate, endTime: event.endTime } : {}), notes: event.notes.trim(),
      ...(Object.hasOwn(event, 'isDday') ? { isDday: event.isDday } : {}) };
  });
  return { events, revision: body.revision };
}
