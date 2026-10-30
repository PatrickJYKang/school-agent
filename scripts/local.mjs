/** Create a local-only environment without overwriting an existing configuration. */
import { randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const target = new URL('.env', root);
const values = {
  HOST: '127.0.0.1',
  PORT: '3080',
  MONGO_URI: 'mongodb://127.0.0.1:27019/school_agent_local',
  DOMAIN_CLIENT: 'http://localhost:3080',
  DOMAIN_SERVER: 'http://localhost:3080',
  TRUST_PROXY: '0',
  SEARCH: 'false',
  CONFIG_PATH: 'config/local.yaml',
  ADMIN_PANEL_URL: 'http://localhost:3000',
  SCHEDULES_SINGLE_PROCESS: 'true',
  CREDS_KEY: randomBytes(32).toString('hex'),
  CREDS_IV: randomBytes(16).toString('hex'),
  JWT_SECRET: randomBytes(32).toString('hex'),
  JWT_REFRESH_SECRET: randomBytes(32).toString('hex'),
};

let content = await readFile(new URL('.env.example', root), 'utf8');
for (const [key, value] of Object.entries(values)) {
  const pattern = new RegExp(`^(?:# )?${key}=.*$`, 'm');
  if (!pattern.test(content)) {
    throw new Error(`The upstream environment template no longer defines ${key}.`);
  }
  content = content.replace(pattern, `${key}=${value}`);
}

try {
  await writeFile(target, content, { flag: 'wx', mode: 0o600 });
  console.log(`Created ${fileURLToPath(target)} with unique local secrets.`);
} catch (error) {
  if (error.code !== 'EEXIST') {
    throw error;
  }
  console.log('Existing .env preserved. No settings or secrets were changed.');
}
