// Configure the local bridge and server secret without connecting to the terminal or database.
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import nextEnv from '@next/env';

const root = fileURLToPath(new URL('../..', import.meta.url));

async function readOptional(file) {
  try {
    return await readFile(file, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') {
      return '';
    }
    throw error;
  }
}

function replaceEnv(text, values) {
  const remaining = new Map(Object.entries(values));
  const seen = new Set();
  const lines = text.split(/\r?\n/).flatMap((line) => {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    if (!match || !Object.hasOwn(values, match[1])) {
      return [line];
    }
    const key = match[1];
    if (seen.has(key)) {
      return [];
    }
    seen.add(key);
    remaining.delete(key);
    return [`${key}=${JSON.stringify(values[key]).replace(/\$/g, '\\$')}`];
  });
  for (const [key, value] of remaining) {
    lines.push(`${key}=${JSON.stringify(value).replace(/\$/g, '\\$')}`);
  }
  return `${lines.join('\n').trim()}\n`;
}

async function configure() {
  nextEnv.loadEnvConfig(root, true);
  const { values } = parseArgs({
    options: {
      host: { type: 'string' },
      serial: { type: 'string' },
      'api-url': { type: 'string' },
      config: { type: 'string', default: process.env.ZKTECO_CONFIG ?? '.local/zkteco/config.json' },
    },
  });
  const configPath = path.resolve(root, values.config);
  const configText = await readOptional(configPath);
  const config = configText ? JSON.parse(configText.replace(/^\uFEFF/, '')) : {};
  config.host = values.host ?? config.host;
  config.serialNumber = values.serial ?? config.serialNumber;
  // Existing queues and MongoDB employee links belong to this saved device identity.
  // Repair a mismatched server environment instead of renaming an enrolled terminal.
  config.deviceId = config.deviceId ?? process.env.ZKTECO_DEVICE_ID ?? 'office-terminal';
  if (typeof config.deviceId !== 'string' || !/^[\w.-]{1,128}$/.test(config.deviceId)) {
    throw new Error('deviceId must contain 1–128 letters, numbers, underscores, dots or hyphens.');
  }
  config.apiUrl = values['api-url'] ?? config.apiUrl ?? 'http://localhost:3000';
  config.port ??= 4370;
  config.password ??= 0;
  config.pollSeconds ??= 5;
  config.stateDir ??= '.local/zkteco';
  if (!config.host || !config.serialNumber) {
    throw new Error(
      'Provide --host and --serial, or set them in the existing local device config.',
    );
  }
  const token = process.env.ZKTECO_API_TOKEN || config.apiToken || randomBytes(32).toString('hex');
  if (typeof token !== 'string' || token.length < 32) {
    throw new Error('The existing device secret must contain at least 32 characters.');
  }
  const api = new URL(config.apiUrl);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(api.hostname);
  if (
    api.username ||
    api.password ||
    api.search ||
    api.hash ||
    (api.protocol !== 'https:' && !(api.protocol === 'http:' && local))
  ) {
    throw new Error(
      'Use an HTTPS app URL, or HTTP on localhost, without credentials or query parameters.',
    );
  }
  const mode = process.env.ZKTECO_PUNCH_MODE ?? 'toggle';
  const debounce = process.env.ZKTECO_DEBOUNCE_SECONDS ?? '60';
  if (
    !['toggle', 'device'].includes(mode) ||
    !Number.isFinite(Number(debounce)) ||
    Number(debounce) < 0 ||
    Number(debounce) > 300
  ) {
    throw new Error('Invalid existing device mode or debounce setting.');
  }
  config.apiToken = token;
  const envPath = path.join(root, '.env.local');
  const oldEnv = await readOptional(envPath);
  const env = replaceEnv(oldEnv, {
    ZKTECO_DEVICE_ID: config.deviceId,
    ZKTECO_API_TOKEN: token,
    ZKTECO_PUNCH_MODE: mode,
    ZKTECO_DEBOUNCE_SECONDS: debounce,
  });
  await mkdir(path.dirname(configPath), { recursive: true });
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  await writeFile(envPath, env, { mode: 0o600 });
  console.log(`Configured ${config.deviceId} at ${config.host}:${config.port}.`);
  console.log(
    `Bridge destination: ${config.apiUrl}. Matching secrets saved without displaying them.`,
  );
  console.log(
    'Restart HRMS to load .env.local. Use npm run dev:device, or run device:bridge beside an existing server.',
  );
}

configure().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
