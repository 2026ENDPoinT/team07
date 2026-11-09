// Reuse this module from future pages; HttpOnly session cookies are sent automatically.
export async function authRequest(path, body) {
  const response = await fetch(`/api/auth/${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    credentials: 'same-origin',
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const result = await response.json();
  if (!response.ok) {
    const error = new Error(result.message || '요청에 실패했습니다.');
    error.status = response.status;
    throw error;
  }
  return result;
}
