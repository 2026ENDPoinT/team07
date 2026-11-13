// 학사 데이터는 브라우저 공용 저장소를 사용하지 않고 로그인 계정의 DB에서만 읽습니다.
export function createAcademicClient(userId) {
  async function request(state) {
    const response = await fetch('/api/academic', {
      method: state === undefined ? 'GET' : 'PUT',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { 'X-Account-Id': String(userId), ...(state === undefined ? {} : { 'Content-Type': 'application/json' }) },
      body: state === undefined ? undefined : JSON.stringify(state)
    });
    const result = await response.json();
    if (!response.ok) {
      if (response.status === 401) window.location.replace('/login.html');
      const error = new Error(result.message || '학사 데이터를 저장하지 못했습니다.');
      error.status = response.status;
      throw error;
    }
    return result;
  }
  return { load: () => request(), save: state => request(state) };
}
