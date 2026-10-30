/** Run the upstream admin panel on loopback, using a private local session secret. */
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { parse } from 'dotenv';

const root = new URL('../', import.meta.url);
const panel = new URL('.local/admin-panel/', root);
const metadata = JSON.parse(await readFile(new URL('config/admin.json', root), 'utf8'));
const checkout = spawnSync('git', ['rev-parse', 'HEAD'], {
  cwd: fileURLToPath(panel),
  encoding: 'utf8',
});
if (checkout.status !== 0 || checkout.stdout.trim() !== metadata.revision)
  throw new Error('Admin panel checkout does not match config/admin.json. See docs/school.md.');
for (const reference of metadata.patches ?? [metadata.patch]) {
  const patch = fileURLToPath(new URL(reference, root));
  const alreadyApplied =
    spawnSync('git', ['apply', '--reverse', '--check', patch], {
      cwd: fileURLToPath(panel),
      stdio: 'ignore',
    }).status === 0;
  if (!alreadyApplied) {
    const applied = spawnSync('git', ['apply', patch], {
      cwd: fileURLToPath(panel),
      stdio: 'inherit',
    });
    if (applied.status !== 0)
      throw new Error(
        'The admin compatibility patch could not be applied. Local changes were preserved.',
      );
  }
}
const envFile = new URL('.env', panel);
try {
  await writeFile(
    envFile,
    `SESSION_SECRET=${randomBytes(32).toString('hex')}\nSESSION_COOKIE_SECURE=false\nAPI_SERVER_URL=http://localhost:3080\nVITE_API_BASE_URL=http://localhost:3080\n`,
    { flag: 'wx', mode: 0o600 },
  );
} catch (error) {
  if (error.code !== 'EEXIST') throw error;
}
const local = parse(await readFile(envFile));
const bun = fileURLToPath(new URL('.local/admin-runtime/node_modules/.bin/bun', root));
const child = spawn(bun, ['run', 'dev', '--host', '127.0.0.1', '--port', '3000', '--strictPort'], {
  cwd: fileURLToPath(panel),
  env: { ...process.env, ...local, NODE_ENV: 'development' },
  stdio: 'inherit',
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('exit', (code) => {
  process.exitCode = code ?? 0;
});
child.on('error', () => {
  console.error('Admin panel is not installed. See docs/school.md.');
  process.exitCode = 1;
});
