import { createApp } from '../server/app.js';
import { request as httpRequest } from 'node:http';
const origin = 'http://localhost:3000';
export async function launch(dbPath, options = {}) {
  const { app, db } = await createApp({ dbPath, databaseUrl: null, requirePostgres: false, origin, ...options });
  const server = await new Promise(resolve => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    app,
    db,
    base,
    async request(path, body, cookie, requestOrigin = origin, options = {}) {
      return new Promise((resolve, reject) => {
        const headers = { Origin: requestOrigin, 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...options.headers };
        for (const key of Object.keys(headers)) if (headers[key] === undefined) delete headers[key];
        const request = httpRequest(base + path, { method: options.method || (body === undefined ? 'GET' : 'POST'),
          headers
        }, response => {
          const chunks = [];
          response.on('data', chunk => chunks.push(chunk));
          response.on('error', reject);
          response.on('end', () => {
            resolve({ status: response.statusCode,
            headers: { get: key => {
              const value = response.headers[key.toLowerCase()];
              return Array.isArray(value) ? value.join(', ') : value || null;
            } },
            json: async () => JSON.parse(Buffer.concat(chunks).toString('utf8')),
            text: async () => Buffer.concat(chunks).toString('utf8')
          });
          });
        });
        request.on('error', reject);
        request.end(options.rawBody ?? (body === undefined ? undefined : JSON.stringify(body)));
      });
    },
    async close() {
      await new Promise(resolve => server.close(resolve));
      await db.close();
    }
  };
}
