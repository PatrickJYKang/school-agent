/** Local hosted-browser service setup; provider/source credentials never enter the worker. */
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { parse } from 'dotenv';

const root = new URL('../', import.meta.url);
const metadata = JSON.parse(await readFile(new URL('config/browser.json', root), 'utf8'));
const command = process.argv[2] ?? 'status';
const compose = ['compose', '-f', 'compose.browser.yml'];
if (command === 'setup') {
  await mkdir(new URL('.local/', root), { recursive: true, mode: 0o700 });
  const appEnv = new URL('.env', root);
  const content = await readFile(appEnv, 'utf8');
  const values = parse(content);
  const token = values.SCHOOL_BROWSER_TOKEN || randomBytes(32).toString('hex');
  if (!/^[A-Za-z0-9_-]{32,256}$/.test(token))
    throw new Error('Existing browser token is too short. Its value was preserved.');
  if (!values.SCHOOL_BROWSER_TOKEN)
    await writeFile(appEnv, content + `\nSCHOOL_BROWSER_TOKEN=${token}\n`, { mode: 0o600 });
  await chmod(appEnv, 0o600);
  const workerEnv = new URL('.local/browser.env', root);
  await writeFile(
    workerEnv,
    `SCHOOL_BROWSER_TOKEN=${token}\nSCHOOL_BROWSER_MAX_SESSIONS=${metadata.maxSessions}\nSCHOOL_BROWSER_MAX_LIFETIME_MS=${metadata.maxLifetimeMs}\nSCHOOL_BROWSER_MAX_PAUSED_SESSIONS=${metadata.maxPausedSessions}\n`,
    { mode: 0o600 },
  );
  await chmod(workerEnv, 0o600);
}
const actions = {
  setup: ['up', '-d', '--build'],
  up: ['up', '-d'],
  stop: ['stop'],
  status: ['ps'],
};
const args = actions[command];
if (!args) throw new Error('Use setup, up, status or stop.');
const result = spawnSync('docker', [...compose, ...args], {
  cwd: fileURLToPath(root),
  stdio: 'inherit',
});
if (result.status !== 0)
  throw new Error('Browser services could not start. Private state was preserved.');
if (command === 'setup') {
  const reload = spawnSync('docker', [...compose, 'restart', 'gateway'], {
    cwd: fileURLToPath(root),
    stdio: 'inherit',
  });
  if (reload.status !== 0) throw new Error('Browser gateway could not reload its configuration.');
}
if (command === 'setup')
  console.log(
    'Browser services started. Restart LibreChat, then select School browser from School helpers.',
  );
