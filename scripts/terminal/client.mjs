import { readFile } from 'node:fs/promises';

export async function readPrivateJson(url, label) {
  const content = await readFile(url, 'utf8');
  try {
    return JSON.parse(content);
  } catch {
    throw new Error(`${label} could not be parsed. Its private contents were not logged.`);
  }
}

export async function request(base, path, { token, body, method = 'GET' } = {}) {
  const response = await fetch(base + path, {
    method,
    redirect: 'error',
    signal: AbortSignal.timeout(30_000),
    headers: {
      // The authenticated local browser API requires an identified browser-compatible client.
      'User-Agent': 'LibreChat-Study-Setup/1.0 Chrome/131.0.0.0',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) throw new Error(`Local terminal request failed (${response.status}).`);
  if (!response.headers.get('content-type')?.includes('application/json')) {
    throw new Error(
      'Local terminal setup received an unexpected response. Check the private backend log.',
    );
  }
  return response.json();
}
