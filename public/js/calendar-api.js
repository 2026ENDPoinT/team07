export function createCalendarClient(userId) {
  async function request(state) {
    const response = await fetch('/api/calendar', {
      method: state === undefined ? 'GET' : 'PUT', credentials: 'same-origin', cache: 'no-store',
      headers: { 'X-Account-Id': String(userId), ...(state === undefined ? {} : { 'Content-Type': 'application/json' }) },
      body: state === undefined ? undefined : JSON.stringify(state)
    });
    const result = await response.json();
    if (!response.ok) throw Object.assign(new Error(result.message || '일정을 불러오거나 저장하지 못했습니다.'), { status: response.status });
    return result;
  }
  return { load: () => request(), save: state => request(state) };
}
