// Prepare private receiver settings and the shared HRMS secret; never contact the device.
import { randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { isIP } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import nextEnv from '@next/env';
import { readOptional, replaceEnv } from '../shared/config-files.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));

async function main() {
  nextEnv.loadEnvConfig(root, process.env.NODE_ENV !== 'production');
  const { values } = parseArgs({
    options: {
      help: { type: 'boolean' },
      config: {
        type: 'string',
        default: process.env.ZKTECO_ADMS_CONFIG ?? '.local/zkteco/adms/config.json',
      },
      serial: { type: 'string' },
      'device-id': { type: 'string' },
      listen: { type: 'string' },
      port: { type: 'string' },
      'allow-source': { type: 'string', multiple: true },
      'api-url': { type: 'string' },
      'state-dir': { type: 'string' },
      since: { type: 'string' },
    },
  });
  if (values.help) {
    console.log(
      'Usage: npm run adms:configure -- --serial SERIAL [--device-id ID] [--listen IP] [--port 8081] [--allow-source IP_OR_CIDR] [--api-url URL] [--since ISO_TIME] [--state-dir DIR] [--config FILE]',
    );
    return;
  }
  const file = path.resolve(root, values.config);
  const previous = await readOptional(file);
  const config = previous ? JSON.parse(previous.replace(/^\uFEFF/, '')) : {};
  const pullText = await readOptional(
    path.resolve(root, process.env.ZKTECO_CONFIG ?? '.local/zkteco/config.json'),
  );
  const pull = pullText ? JSON.parse(pullText.replace(/^\uFEFF/, '')) : {};
  const serial = values.serial ?? config.serialNumber ?? pull.serialNumber;
  const deviceId =
    values['device-id'] ??
    config.deviceId ??
    pull.deviceId ??
    process.env.ZKTECO_DEVICE_ID ??
    'office-terminal';
  for (const [key, value] of Object.entries({ serialNumber: serial, deviceId })) {
    if (
      !value ||
      !/^[A-Za-z0-9_.-]{1,128}$/.test(value) ||
      value === 'SET_FROM_DEVICE_INSPECTION'
    ) {
      throw new Error(
        `Provide a valid ${key}. Use --serial for the physical device serial number.`,
      );
    }
    if (config[key] && config[key] !== value) {
      throw new Error(
        `Existing ${key} cannot be changed. Use a separate config and state directory for another terminal.`,
      );
    }
  }
  if (
    (pull.deviceId && pull.deviceId !== deviceId) ||
    (process.env.ZKTECO_DEVICE_ID && process.env.ZKTECO_DEVICE_ID !== deviceId)
  ) {
    throw new Error('Keep the existing HRMS/pull deviceId so employee links continue to resolve.');
  }
  if (pull.serialNumber && pull.serialNumber !== serial) {
    throw new Error('The ADMS serial must match the terminal already configured for polling.');
  }
  const apiUrl = values['api-url'] ?? config.apiUrl ?? pull.apiUrl ?? 'http://localhost:3000';
  const api = new URL(apiUrl);
  if (
    api.username ||
    api.password ||
    api.search ||
    api.hash ||
    (api.protocol !== 'https:' &&
      !(api.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(api.hostname)))
  ) {
    throw new Error(
      'Use HTTPS for remote HRMS, or HTTP on localhost, without credentials, query or fragment.',
    );
  }
  const listenHost = values.listen ?? config.listenHost ?? '127.0.0.1';
  const listenPort = Number(values.port ?? config.listenPort ?? 8081);
  if (!isIP(listenHost) || !Number.isInteger(listenPort) || listenPort < 1 || listenPort > 65535) {
    throw new Error('Provide an IP address for --listen and a valid TCP port.');
  }
  const allowedSources = values['allow-source'] ?? config.allowedSources ?? ['127.0.0.1/32'];
  if (!allowedSources.length || allowedSources.length > 32) {
    throw new Error('Provide between 1 and 32 allowed source networks.');
  }
  for (const source of allowedSources) {
    const [host, prefix, extra] = source.split('/');
    const family = isIP(host);
    if (
      !family ||
      extra !== undefined ||
      (prefix !== undefined &&
        (!/^\d+$/.test(prefix) || Number(prefix) < 1 || Number(prefix) > (family === 4 ? 32 : 128)))
    ) {
      throw new Error(`Invalid or unrestricted source network: ${source}`);
    }
  }
  const since = values.since ?? config.since ?? new Date().toISOString();
  if (!/(?:Z|[+-]\d{2}:\d{2})$/.test(since) || !Number.isFinite(Date.parse(since))) {
    throw new Error('--since must be an ISO timestamp with a timezone.');
  }
  if (config.since && Date.parse(config.since) !== Date.parse(since)) {
    throw new Error(
      'The existing import cutoff is fixed. Use a new config/state directory for a deliberate historical import.',
    );
  }
  const token =
    process.env.ZKTECO_API_TOKEN ||
    config.apiToken ||
    pull.apiToken ||
    randomBytes(32).toString('hex');
  if (typeof token !== 'string' || token.length < 32) {
    throw new Error('The HRMS API token must contain at least 32 characters.');
  }
  Object.assign(config, {
    deviceId,
    serialNumber: serial,
    listenHost,
    listenPort,
    allowedSources,
    apiUrl,
    apiToken: token,
    stateDir: values['state-dir'] ?? config.stateDir ?? path.dirname(values.config),
    since: new Date(since).toISOString(),
    timezoneOffsetMinutes: config.timezoneOffsetMinutes ?? 330,
    retrySeconds: config.retrySeconds ?? 10,
    maxBodyBytes: config.maxBodyBytes ?? 1048576,
    maxBatchRecords: config.maxBatchRecords ?? 5000,
    maxPendingRecords: config.maxPendingRecords ?? 100000,
  });
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  const envFile = path.join(root, '.env.local');
  await writeFile(
    envFile,
    replaceEnv(await readOptional(envFile), {
      ZKTECO_DEVICE_ID: deviceId,
      ZKTECO_API_TOKEN: token,
    }),
    { mode: 0o600 },
  );
  console.log(`ADMS configured at ${listenHost}:${listenPort}; HRMS destination ${api.origin}.`);
  console.log(
    `Import cutoff: ${config.since}. Older uploads are retained locally, not sent to HRMS.`,
  );
  console.log(
    'Secrets saved privately. Run adms:check, restart HRMS to load its environment, then run adms:start.',
  );
  console.log(
    'Device settings and employee links were not changed. A remote HRMS needs the same device ID and token configured there.',
  );
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
