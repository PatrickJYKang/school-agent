/** Real local Code API + native SRT boundary checks; no model inference is used. */
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { parse } from 'dotenv';
import { readPrivateJson, request } from './client.mjs';

const root = new URL('../../', import.meta.url);
const state = new URL('.local/terminal/', root);
const metadata = JSON.parse(await readFile(new URL('config/terminal.json', root), 'utf8'));
const env = parse(await readFile(new URL('.env', root)));
for (const [name, value] of Object.entries(env)) {
  if (name.startsWith('CODEAPI_')) process.env[name] = value;
}
const require = createRequire(import.meta.url);
const { createAttachedWorkspaceBashTool, getCodeApiAuthHeaders } = require('@librechat/api');
const account = await readPrivateJson(new URL('.local/local-account.json', root), 'Local account');
const login = await request('http://127.0.0.1:3080', '/api/auth/login', {
  method: 'POST',
  body: { email: account.email, password: account.password },
});
const user = await request('http://127.0.0.1:3080', '/api/user', { token: login.token });
const userId = user.id ?? user._id;
assert.equal(typeof userId, 'string');
const authHeaders = async () => ({
  ...(await getCodeApiAuthHeaders(
    { user: { id: userId, role: user.role, tenantId: user.tenantId } },
    metadata.workerId,
  )),
  'X-CodeAPI-Expected-Profile': 'stateful',
  'X-LibreChat-Code-Worker-ID': metadata.workerId,
});
const runId = randomUUID();
const makeTool = (name) =>
  createAttachedWorkspaceBashTool({
    baseUrl: metadata.apiUrl,
    authHeaders,
    workspaceId: metadata.workspaceId,
    workspaceInstanceId: createHash('sha256').update(`${userId}:${runId}:${name}`).digest('hex'),
    maxTimeoutMs: 30000,
    defaultTimeoutMs: 10000,
    nativeSandbox: true,
  });
const first = makeTool('first');
const second = makeTool('second');
const timed = makeTool('timeout');
const text = (value) => (typeof value === 'string' ? value : JSON.stringify(value));
const checks = {};

const unauthenticated = await fetch(metadata.apiUrl + '/workspace-tools/execute', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-CodeAPI-Expected-Profile': 'stateful',
  },
  body: JSON.stringify({
    protocolVersion: 1,
    operation: 'list_files',
    workspaceId: metadata.workspaceId,
  }),
});
assert.ok([401, 403].includes(unauthenticated.status));
checks.anonymousDenied = true;

const calculation = text(
  await first.invoke({
    command:
      "python3 - <<'PY'\nfrom pathlib import Path\ntotal = sum(x*x for x in range(1, 11))\nPath('check.md').write_text('# Calculation\\n\\nSum of squares: ' + str(total) + '\\n')\nprint(total)\nPY",
  }),
);
assert.match(calculation, /stdout:\s*385\b/);
checks.calculation = true;
const restored = text(await first.invoke({ command: 'cat check.md' }));
assert.match(restored, /Sum of squares: 385/);
checks.filesPersist = true;
const separate = text(
  await second.invoke({ command: "test ! -e check.md && printf 'separate-chat-ok\\n'" }),
);
assert.match(separate, /stdout:\s*separate-chat-ok/);
checks.chatIsolation = true;

const canary = new URL('outside-canary.txt', state);
const outsideWrite = new URL('outside-write-check.txt', state);
await writeFile(canary, 'synthetic boundary canary\n', { mode: 0o600 });
try {
  const boundaries = text(
    await first.invoke({
      command: `python3 - <<'PY'\nfrom pathlib import Path\nimport socket\nfor name, path, mode in [('outside-read', ${JSON.stringify(fileURLToPath(canary))}, 'r'), ('outside-write', ${JSON.stringify(fileURLToPath(outsideWrite))}, 'w')]:\n    try:\n        with open(path, mode) as f:\n            if mode == 'r': f.read()\n            else: f.write('unexpected')\n        print(name + '-UNSAFE')\n    except OSError:\n        print(name + '-blocked')\ntry:\n    with socket.create_connection(('127.0.0.1', 3112), timeout=2):\n        print('network-UNSAFE')\nexcept OSError:\n    print('network-blocked')\nPY`,
    }),
  );
  assert.match(boundaries, /outside-read-blocked/);
  assert.match(boundaries, /outside-write-blocked/);
  assert.match(boundaries, /network-blocked/);
  assert.doesNotMatch(boundaries, /UNSAFE/);
  checks.outsideReadsBlocked = true;
  checks.outsideWritesBlocked = true;
  checks.networkBlocked = true;
} finally {
  await unlink(canary);
  await unlink(outsideWrite).catch((error) => {
    if (error.code !== 'ENOENT') throw error;
  });
}

const timeout = text(await timed.invoke({ command: 'sleep 5', timeoutMs: 1000 }));
assert.match(timeout, /timed out|timeoutMs/);
checks.timeoutReported = true;
await writeFile(
  new URL('checks.json', state),
  JSON.stringify({ checkedAt: new Date().toISOString(), checks }, null, 2) + '\n',
  { mode: 0o600 },
);
console.log(JSON.stringify(checks));
