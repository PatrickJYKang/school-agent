/** Import a local test token into the signed-in user's encrypted Canvas connection. */
import { readFile } from 'node:fs/promises';
import { parse } from 'dotenv';

const root = new URL('../', import.meta.url);
const settings = parse(await readFile(new URL('.local/canvas.env', root)));
if (!settings.CANVAS_API_TOKEN?.trim()) {
  console.log(
    'Put the token after CANVAS_API_TOKEN= in .local/canvas.env, then rerun this command.',
  );
  process.exitCode = 2;
} else {
  const account = JSON.parse(await readFile(new URL('.local/local-account.json', root), 'utf8'));
  const base = 'http://localhost:3080';
  async function request(path, method = 'GET', body, token) {
    const response = await fetch(base + path, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await response.json();
    if (!response.ok) {
      const code =
        typeof data.code === 'string' && /^[a-z_]+$/.test(data.code) ? data.code : 'request_failed';
      throw new Error(`Local Canvas setup failed (${response.status}, ${code}).`);
    }
    return data;
  }
  const login = await request('/api/auth/login', 'POST', {
    email: account.email,
    password: account.password,
  });
  const status = await request('/api/school', 'GET', undefined, login.token);
  if (!status.canvas.enabled || new URL(settings.CANVAS_BASE_URL).origin !== status.canvas.baseUrl)
    throw new Error(
      'The token file site does not match the school-configured Canvas site. No token was sent.',
    );
  await request(
    '/api/school/canvas/connection',
    'PUT',
    { token: settings.CANVAS_API_TOKEN.trim() },
    login.token,
  );
  const courses = await request('/api/school/canvas/courses', 'GET', undefined, login.token);
  console.log(
    `Canvas connected for ${account.email}. ${courses.items.length} accessible courses returned${courses.truncated ? ' (configured page limit reached)' : ''}.`,
  );
  console.log(
    'No course content was sent to a model. Select material in the Canvas picker to attach it to a chat.',
  );
}
