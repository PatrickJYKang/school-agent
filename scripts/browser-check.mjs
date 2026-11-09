/** Synthetic public-browser checks. No model inference or source-account credentials. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { parse } from 'dotenv';

const root = new URL('../', import.meta.url);
const require = createRequire(import.meta.url);
const {
  schoolBrowserSettingsSchema,
  schoolBrowserResultSchema,
} = require('librechat-data-provider');
const { serviceUrl, tokenEnv, ...settings } = schoolBrowserSettingsSchema.parse({ enabled: true });
const env = parse(await readFile(new URL('.local/browser.env', root)));
const token = env[tokenEnv];
assert.ok(token?.length >= 32, 'Run node scripts/browser.mjs setup first.');
const first = createHash('sha256').update(randomUUID()).digest('hex');
const second = createHash('sha256').update(randomUUID()).digest('hex');
const checks = {};
async function request(scope, input, control) {
  const response = await fetch(serviceUrl + '/session', {
    method: 'POST',
    signal: AbortSignal.timeout(30000),
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify({ scope, settings, input, control }),
  });
  assert.equal(response.status, 200);
  return schoolBrowserResultSchema.parse(await response.json());
}
function value(result) {
  assert.ok(result.ok, result.ok ? '' : result.error.code);
  return result.value;
}
try {
  const anonymous = await fetch(serviceUrl + '/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  assert.equal(anonymous.status, 401);
  checks.anonymousDenied = true;
  const parallel = await Promise.all([
    request(first, { operation: 'open', url: 'https://demo.playwright.dev/todomvc/#/' }),
    request(first, { operation: 'open', url: 'https://demo.playwright.dev/todomvc/#/' }),
  ]);
  assert.equal(parallel.filter((result) => result.ok).length, 1);
  assert.equal(parallel.find((result) => !result.ok)?.error.code, 'browser_busy');
  checks.parallelOwnership = true;
  const page = value(parallel.find((result) => result.ok));
  assert.match(page.text, /todos/i);
  checks.javascriptRendering = true;
  const image = value(await request(first, { operation: 'view' }));
  assert.ok(image.image?.startsWith('iVBOR'));
  checks.screenshot = true;
  const isolated = value(await request(second));
  assert.equal(isolated.status, 'closed');
  assert.equal(isolated.url, undefined);
  checks.separateSessions = true;
  const ref = /- link .*\[ref=(e\d+)\]/.exec(page.text)?.[1];
  if (ref) {
    value(await request(first, { operation: 'follow', ref }));
    checks.followObservedLink = true;
  }
  const stopped = value(await request(first, undefined, 'stop'));
  assert.equal(stopped.stopped, true);
  const blocked = await request(first, { operation: 'open', url: 'https://playwright.dev' });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.error.code, 'browser_stopped');
  checks.stopFencesReopen = true;
  if (process.argv.includes('--restart-check')) {
    const restart = spawnSync(
      'docker',
      ['compose', '-f', 'compose.browser.yml', 'restart', 'browser'],
      { cwd: root, stdio: 'ignore' },
    );
    assert.equal(restart.status, 0);
    let restored;
    for (let attempt = 0; attempt < 30; attempt++) {
      try {
        restored = value(await request(first));
        break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    }
    assert.equal(restored?.stopped, true);
    const stillBlocked = await request(first, { operation: 'open', url: 'https://playwright.dev' });
    assert.equal(stillBlocked.ok, false);
    assert.equal(stillBlocked.error.code, 'browser_stopped');
    checks.stopSurvivesWorkerRestart = true;
  }
  value(await request(first, undefined, 'restart'));
  const restarted = value(await request(first));
  assert.equal(restarted.stopped, false);
  checks.explicitRestart = true;
  const opening = request(first, {
    operation: 'open',
    url: 'https://demo.playwright.dev/todomvc/#/',
  });
  for (let attempt = 0; attempt < 20; attempt++) {
    if (value(await request(first)).status === 'busy') break;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  value(await request(first, undefined, 'stop'));
  const interrupted = await opening;
  assert.equal(interrupted.ok, false);
  assert.equal(interrupted.error.code, 'browser_stopped');
  assert.equal(value(await request(first)).stopped, true);
  checks.stopDuringLaunch = true;
  for (const url of [
    'http://127.0.0.1:3080',
    'http://169.254.169.254',
    'file:///etc/passwd',
    'https://webb.instructure.com',
  ]) {
    const denied = await request(second, { operation: 'open', url });
    assert.equal(denied.ok, false);
    assert.equal(denied.error.code, 'browser_forbidden');
  }
  checks.privateAndAccountSitesDenied = true;
  const rebinding = await request(second, { operation: 'open', url: 'http://localtest.me' });
  assert.equal(rebinding.ok, false);
  checks.privateDnsDestinationDenied = true;
  const unknown = await fetch(serviceUrl + '/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify({
      scope: first,
      settings,
      input: { operation: 'evaluate', code: 'process.env' },
    }),
  });
  assert.equal(unknown.status, 400);
  checks.arbitraryCodeDenied = true;
  const directory = new URL('.local/browser/', root);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await writeFile(
    new URL('checks.json', directory),
    JSON.stringify({ checkedAt: new Date().toISOString(), checks }, null, 2) + '\n',
    { mode: 0o600 },
  );
  console.log(JSON.stringify(checks));
} finally {
  await Promise.allSettled([
    request(first, undefined, 'restart'),
    request(second, undefined, 'restart'),
  ]);
}
