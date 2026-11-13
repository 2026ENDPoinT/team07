// 인증 API 공통 호출: 본문이 없으면 GET, 있으면 POST로 보내며 같은 출처의 쿠키를 함께 전송합니다.
export async function authRequest(path, body, { headers = {} } = {}) {
  const response = await fetch(`/api/auth/${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    credentials: 'same-origin',
    headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const result = await response.json();
  // 서버의 오류 메시지와 상태 코드를 화면 처리 코드에 전달합니다.
  if (!response.ok) {
    const error = new Error(result.message || '요청에 실패했습니다.');
    error.status = response.status;
    throw error;
  }
  return result;
}
